import type { Book, Chapter, Settings } from './model';
import { removeDuplicateTitle } from './content-processing';
import { applyReplacement, scopedRules, type ReplaceRule } from './replacement';

async function resegment(text:string,title:string):Promise<string> {
  const worker=new Worker(new URL('./resegment.worker.ts',import.meta.url),{type:'module'});
  try{return await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('重新分段超时')),5000);worker.onmessage=event=>{clearTimeout(timer);event.data.error?reject(new Error(event.data.error)):resolve(event.data.text);};worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message));};worker.postMessage({content:text,title});});}
  finally{worker.terminate();}
}

export async function processReaderContent(text:string,book:Book,chapter:Chapter,rules:ReplaceRule[],conversion:Settings['chineseConversion']) {
  const enabled=book.useReplaceRule===false?[]:rules,applied:ReplaceRule[]=[],failed:ReplaceRule[]=[];
  const title=await applyReplacement(chapter.title,scopedRules(enabled,book,'title'),rule=>applied.push(rule),rule=>failed.push(rule));
  let duplicate=chapter.keepSameTitle?{text,removed:false}:removeDuplicateTitle(text,book.name,chapter.title);
  if(!chapter.keepSameTitle&&!duplicate.removed)duplicate=removeDuplicateTitle(text,book.name,title);
  const convert=conversion==='none'?(value:string)=>value:(await import('opencc-js')).Converter({from:conversion==='simple'?'tw':'cn',to:conversion==='simple'?'cn':'tw'});
  const segmented=book.reSegment?await resegment(duplicate.text,chapter.title):duplicate.text;
  const body=await applyReplacement(convert(segmented),scopedRules(enabled,book,'content'),rule=>applied.push(rule),rule=>failed.push(rule));
  return {content:body,title:convert(title),sameTitleRemoved:duplicate.removed,effectiveRules:[...new Map(applied.map(rule=>[rule.id,rule])).values()],failedRules:[...new Map(failed.map(rule=>[rule.id,rule])).values()]};
}
