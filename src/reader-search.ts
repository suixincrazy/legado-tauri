import CryptoJS from 'crypto-js';
import type {Book,Settings} from './model';
import type {ReplaceRule} from './replacement';
import {processReaderContent} from './reader-content';
import {readingParagraphs} from './highlight-engine';

export type ReaderSearchScope='all'|'down'|'up';
export type ReaderSearchOrigin={chapter:number;position:number};
export type ReaderSearchAnchor={inTitle:boolean;spansTitle:boolean;position:number;length:number;digest:string;before:string;match:string;after:string};
export type ReaderSearchResult={bookId:string;chapter:number;chapterUrl?:string;title:string;start:number;end:number;excerpt:string;excerptStart:number;anchor:ReaderSearchAnchor};
export type ReaderSearchProgress={results:ReaderSearchResult[];searched:number;cached:number;limited:boolean;failedRules:number};
export const readerSearchLimit=1000;
export function searchDocument(title:string,content:string) {
  const titleLength=title.length+1,paragraphs=readingParagraphs(content,titleLength);
  return {text:title+'\n'+paragraphs.map(item=>item.text).join('\n'),titleLength};
}
const digest=(text:string)=>CryptoJS.SHA256(CryptoJS.enc.Utf16.parse(text)).toString();
export function makeSearchAnchor(text:string,titleLength:number,start:number,end:number,hash?:string):ReaderSearchAnchor {
  const inTitle=start<titleLength,spansTitle=inTitle&&end>titleLength,base=inTitle?0:titleLength,limit=inTitle&&!spansTitle?titleLength:text.length,section=text.slice(base,limit);
  return {inTitle,spansTitle,position:start-base,length:section.length,digest:hash??digest(section),before:text.slice(Math.max(base,start-32),start),match:text.slice(start,end),after:text.slice(end,Math.min(limit,end+32))};
}
export function resolveSearchAnchor(anchor:ReaderSearchAnchor,text:string,titleLength:number,hideTitle=false):{start:number;end:number}|null {
  if(hideTitle&&anchor.inTitle)return null;
  const base=anchor.inTitle?0:titleLength,limit=anchor.inTitle&&!anchor.spansTitle?titleLength:text.length,section=text.slice(base,limit);
  if(!anchor.match)return null;
  if(section.length===anchor.length&&digest(section)===anchor.digest&&section.slice(anchor.position,anchor.position+anchor.match.length)===anchor.match)
    return {start:base+anchor.position,end:base+anchor.position+anchor.match.length};
  const context=anchor.before+anchor.match+anchor.after,first=section.indexOf(context);
  if(first<0||section.indexOf(context,first+1)>=0)return null;
  const start=base+first+anchor.before.length;return {start,end:start+anchor.match.length};
}
export function chapterSearchResults(bookId:string,chapter:number,chapterUrl:string|undefined,title:string,content:string,query:string,scope:ReaderSearchScope,origin:ReaderSearchOrigin,hideTitle:boolean,limit=readerSearchLimit):ReaderSearchResult[] {
  if(!query.trim())return [];
  const {text,titleLength}=searchDocument(title,content),ranges:{start:number;end:number}[]=[];
  let cursor=hideTitle?titleLength:0,count=0;
  while(cursor<=text.length-query.length){
    const start=text.indexOf(query,cursor);if(start<0)break;
    const end=start+query.length;cursor=end;
    if(chapter===origin.chapter&&(scope==='up'?start>origin.position:scope==='down'&&start<origin.position))continue;
    if(scope==='up'){ranges[count%(limit+1)]={start,end};count++;}
    else{ranges.push({start,end});if(ranges.length>limit)break;}
  }
  const selected=scope==='up'?Array.from({length:Math.min(count,limit+1)},(_,i)=>ranges[(count-1-i)%(limit+1)]):ranges;
  const hashes=new Map<number,string>();
  return selected.map(({start,end})=>{
    const section=start>=titleLength?1:end>titleLength?2:0;if(!hashes.has(section))hashes.set(section,digest(section===0?text.slice(0,titleLength):section===1?text.slice(titleLength):text));
    const from=Math.max(start<titleLength?0:titleLength,start-20),to=Math.min(text.length,end+20);
    return {bookId,chapter,chapterUrl,title,start,end,excerpt:text.slice(from,to),excerptStart:start-from,anchor:makeSearchAnchor(text,titleLength,start,end,hashes.get(section))};
  });
}
export async function searchCachedContent(book:Book,query:string,options:{scope:ReaderSearchScope;origin:ReaderSearchOrigin;prefs:Settings;rules:ReplaceRule[];signal:AbortSignal;progress?:(value:ReaderSearchProgress)=>void}):Promise<ReaderSearchProgress> {
  const {scope,origin,prefs,rules,signal}=options;
  const chapters=book.chapters.map((chapter,index)=>({chapter,index})).filter(({chapter,index})=>chapter.content!==undefined&&!chapter.isVolume&&(scope==='all'||(scope==='up'?index<=origin.chapter:index>=origin.chapter)));
  if(scope==='up')chapters.reverse();
  const state:ReaderSearchProgress={results:[],searched:0,cached:chapters.length,limited:false,failedRules:0};
  const check=()=>{if(signal.aborted)throw new DOMException('搜索已停止','AbortError');};
  check();if(!query.trim())return state;
  for(const {chapter,index} of chapters){
    check();const processed=await processReaderContent(chapter.content!,book,chapter,rules,prefs.chineseConversion);check();
    const hits=chapterSearchResults(book.id,index,chapter.url,processed.title||chapter.title,processed.content,query,scope,origin,prefs.titleAlign==='hidden',readerSearchLimit-state.results.length);
    state.results.push(...hits);state.searched++;state.failedRules+=processed.failedRules.length;
    if(state.results.length>readerSearchLimit){state.results.length=readerSearchLimit;state.limited=true;}
    options.progress?.({...state,results:[...state.results]});
    if(state.limited)break;
    await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  check();return state;
}
