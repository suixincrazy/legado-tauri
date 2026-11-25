import { newBook, type Book, type Chapter } from './model';
import { SourceRuntime } from './source-runtime';
import { chaptersFromHeadings, type Heading, type TxtTocRule } from './txt-rules-engine';
export * from './txt-rules-engine';

export async function scanHeadings(text:string,pattern:string):Promise<Heading[]> {
  const worker=new Worker(new URL('./txt-rules.worker.ts',import.meta.url),{type:'module'});
  try{return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('目录正则执行超时')),3000);
    worker.onmessage=event=>{clearTimeout(timer);event.data.error?reject(new Error(event.data.error)):resolve(event.data.headings);};
    worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message));};
    worker.postMessage({text,pattern});
  });}finally{worker.terminate();}
}
export async function applyTxtRule(text:string,rule:TxtTocRule,book:Partial<Book>={}):Promise<Chapter[]> {
  let headings=await scanHeadings(text,rule.rule);
  const volumes=new Map<number,string[]>();
  if(rule.replacement.trim() && headings.length) {
    const vm=new SourceRuntime({bookSourceName:'TXT目录规则',bookSourceUrl:'legado:txt-rules'},{book});
    const kept:Heading[]=[];
    try {
      await vm.initialize();
      await vm.evaluate('var index=0,prevTitle=null,prevLength=-1,lastVolumeTitle="",__volumes=[]; java.putVolume=function(title){lastVolumeTitle=String(title);__volumes.push(lastVolumeTitle)};');
      let previousEnd=0;
      for(const heading of headings) {
        await vm.evaluate(`result=${JSON.stringify(heading.title)};index=${kept.length+1};prevLength=${heading.start-previousEnd};__volumes=[];`);
        const title=String(await vm.evaluate(rule.replacement)??'');
        const added=await vm.evaluate('__volumes');
        if(title){if(added.length)volumes.set(kept.length,added);kept.push({...heading,title});previousEnd=heading.end;await vm.evaluate(`prevTitle=${JSON.stringify(title)}`);}
      }
      headings=kept;
    }finally{await vm.close();}
  }
  const chapters=chaptersFromHeadings(text,headings),offset=headings.length && text.slice(0,headings[0].start).trim()?1:0;
  return chapters.flatMap((chapter,index)=>[...(volumes.get(index-offset)||[]).map(title=>({title,isVolume:true,content:''})),chapter]);
}
export async function importTxtWithRules(text:string,filename:string,rules:TxtTocRule[]):Promise<Book> {
  text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  if(!text.trim())throw new Error('文件没有可阅读的文字');
  const enabled=rules.filter(rule=>rule.enable && rule.rule).sort((a,b)=>a.serialNumber-b.serialNumber);
  let chosen:TxtTocRule|undefined,best=-1;
  for(const rule of enabled) {
    const headings=await scanHeadings(text.slice(0,512000),rule.rule);
    let valid=0,short=0,end=0;
    for(const heading of headings){const length=heading.start-end;if(!end || length>1000){valid++;end=heading.end;}else if(length<100)short++;}
    if(headings.length && valid>=short*3 && valid>best+2){chosen=rule;best=valid;if(valid>70)break;}
    if(!chosen && headings.length){chosen=rule;best=valid;}
  }
  const chapters=chosen?await applyTxtRule(text,chosen,{name:filename}):chaptersFromHeadings(text,[]);
  return {...newBook(filename.replace(/\.txt$/i,''),'txt',chapters),rawText:text,txtTocRuleId:chosen?.id};
}
export async function reparseTxtBook(book:Book,rule:TxtTocRule):Promise<Book> {
  const text=book.rawText||book.chapters.map(c=>`${c.title}\n${c.content||''}`).join('\n\n');
  const chapters=await applyTxtRule(text,rule,book);
  const current=chapters.findIndex(c=>c.title===book.chapters[book.chapter]?.title);
  return {...book,rawText:text,chapters,chapter:current<0?Math.min(book.chapter,chapters.length-1):current,offset:current<0?0:book.offset,txtTocRuleId:rule.id,bookmarks:book.bookmarks.map(mark=>{const index=chapters.findIndex(c=>c.title===book.chapters[mark.chapter]?.title);return {...mark,chapter:index<0?Math.min(mark.chapter,chapters.length-1):index};})};
}
