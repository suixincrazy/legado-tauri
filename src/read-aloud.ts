import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Book } from './model';

export type SpeechChunk = { text:string; chapter:number; start:number; end:number; title:string };
export type SpeechSettings = { engine:string; rate:number; followSystem:boolean; timer:number; skipTitle:boolean };
export type SpeechState = { state:'idle'|'loading'|'playing'|'paused'|'ended'|'error'; bookId:string; index:number; position:number; total:number; chapter:number; error:string; remaining:number; chapterStop:number };
export type SpeechEngine = { id:string; name:string; language?:string };
export const defaultSpeechSettings:SpeechSettings = {engine:'',rate:1,followSystem:true,timer:0,skipTitle:false};
export const idleSpeechState:SpeechState = {state:'idle',bookId:'',index:0,position:0,total:0,chapter:0,error:'',remaining:0,chapterStop:0};

export function speechChunks(text:string,chapter:number,title:string,start=0,end=text.length):SpeechChunk[] {
  const chunks:SpeechChunk[]=[];
  const pattern=/[^\n]+/g;let match:RegExpExecArray|null;
  while((match=pattern.exec(text))){
    let from=Math.max(start,match.index),to=Math.min(end,match.index+match[0].length);
    while(from<to&&/\s/.test(text[from]))from++;
    while(to>from&&/\s/.test(text[to-1]))to--;
    while(from<to){
      let limit=Math.min(to,from+1500);
      if(limit<to){const part=text.slice(from,limit),punctuation=Math.max(part.lastIndexOf('。'),part.lastIndexOf('！'),part.lastIndexOf('？'),part.lastIndexOf('；'));if(punctuation>300)limit=from+punctuation+1;else if(/[\uD800-\uDBFF]/.test(text[limit-1]))limit--;}
      chunks.push({text:text.slice(from,limit),chapter,start:from,end:limit,title});from=limit;
    }
  }
  return chunks;
}
export function cachedSpeechQueue(book:Book,currentText:string,start:number,skipTitle=false):SpeechChunk[] {
  const chunks:SpeechChunk[]=[];
  for(let index=book.chapter;index<book.chapters.length;index++){
    const chapter=book.chapters[index];if(chapter.isVolume)continue;
    if(index!==book.chapter&&chapter.content===undefined)break;
    const text=index===book.chapter?currentText:chapter.title+'\n'+chapter.content;
    chunks.push(...speechChunks(text,index,chapter.title,index===book.chapter?Math.max(start,skipTitle?chapter.title.length+1:0):skipTitle?chapter.title.length+1:0));
  }
  return chunks;
}

let webState={...idleSpeechState},webQueue:SpeechChunk[]=[],webPrefs={...defaultSpeechSettings},webGeneration=0,webDeadline=0,webTimer:ReturnType<typeof setTimeout>|undefined,webStopChapter=-1;
function stopWebTimer(){if(webTimer)clearTimeout(webTimer);webTimer=undefined;webDeadline=0;webStopChapter=-1;}
function webSpeak(){
  const chunk=webQueue[webState.index];if(!chunk){webState.state='ended';stopWebTimer();return;}
  const generation=++webGeneration;speechSynthesis.cancel();
  const position=Math.max(chunk.start,Math.min(chunk.end,webState.position));
  const utterance=new SpeechSynthesisUtterance(chunk.text.slice(position-chunk.start));
  utterance.lang='zh-CN';utterance.rate=webPrefs.followSystem?1:webPrefs.rate;
  if(webPrefs.engine)utterance.voice=speechSynthesis.getVoices().find(voice=>voice.voiceURI===webPrefs.engine)||null;
  webState={...webState,state:'playing',chapter:chunk.chapter,position,error:''};
  utterance.onboundary=event=>{if(generation===webGeneration)webState.position=position+event.charIndex;};
  utterance.onend=()=>{if(generation!==webGeneration)return;const next=webQueue[webState.index+1];if(webStopChapter>=0&&(!next||next.chapter>=webStopChapter)){webState.state='paused';stopWebTimer();return;}webState.index++;webState.position=next?.start||0;webSpeak();};
  utterance.onerror=event=>{if(generation===webGeneration&&event.error!=='canceled'&&event.error!=='interrupted'){webState.state='error';webState.error='系统朗读失败：'+event.error;stopWebTimer();}};
  speechSynthesis.speak(utterance);
}
async function webCommand(action:string,args:Record<string,unknown>):Promise<SpeechState|SpeechEngine[]> {
  if(action==='status'){webState.remaining=Math.max(0,Math.ceil((webDeadline-Date.now())/1000));return {...webState};}
  if(!('speechSynthesis' in window))throw new Error('当前浏览器没有朗读引擎');
  if(action==='engines')return speechSynthesis.getVoices().map(voice=>({id:voice.voiceURI,name:voice.name,language:voice.lang}));
  if(action==='start'){
    stopWebTimer();webQueue=args.chunks as SpeechChunk[];webPrefs={...defaultSpeechSettings,...args.settings as SpeechSettings};
    webState={...idleSpeechState,bookId:String(args.bookId),total:webQueue.length,position:webQueue[0]?.start||0};webSpeak();
  }else if(action==='pause'){webGeneration++;speechSynthesis.cancel();webState.state='paused';}
  else if(action==='resume'){if(webState.state==='ended'){webState.index=0;webState.position=webQueue[0]?.start||0;}webSpeak();}
  else if(action==='stop'){webGeneration++;speechSynthesis.cancel();stopWebTimer();webState={...idleSpeechState};webQueue=[];}
  else if(action==='skip'){
    const direction=Number(args.direction)||1;let index=webState.index+direction;
    if(args.chapter){index=direction>0?webQueue.findIndex(chunk=>chunk.chapter>webState.chapter):webQueue.findIndex(chunk=>chunk.chapter===webState.chapter-1);}
    if(index>=0&&index<webQueue.length){webState.index=index;webState.position=webQueue[index].start;webSpeak();}
  }else if(action==='settings'){webPrefs={...webPrefs,...args.settings as SpeechSettings};if(webState.state==='playing')webSpeak();}
  if(action==='timer'||action==='start'){
    stopWebTimer();const minutes=action==='start'?webPrefs.timer:Number(args.minutes)||0;const chapters=Number(args.chapters)||0;
    webState.chapterStop=chapters;webStopChapter=chapters?webState.chapter+chapters:-1;
    if(minutes>0){webDeadline=Date.now()+minutes*60000;webTimer=setTimeout(()=>{void webCommand('pause',{});stopWebTimer();},minutes*60000);}
  }
  return {...webState};
}
export async function speechCommand<T=SpeechState>(action:string,args:Record<string,unknown>={}):Promise<T> {
  if(!isTauri())return await webCommand(action,args) as T;
  const request={operation:'readAloud',mode:'readAloud',action,...args};
  const response=/Android/i.test(navigator.userAgent)?await invoke<{json:string}>('java_bridge',{payload:JSON.stringify(request)}):await invoke<{json:string}>('source_browser',{request});
  const result=JSON.parse(response.json);if(result.error&&result.state!=='error')throw new Error(result.error);return result as T;
}
