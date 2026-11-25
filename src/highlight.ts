import type { HighlightRule,HighlightRange } from './highlight-engine';
export * from './highlight-engine';
export async function applyHighlightRules(text:string,rules:HighlightRule[],titleLength:number):Promise<HighlightRange[]> {
  if(!rules.length)return [];
  const worker=new Worker(new URL('./highlight.worker.ts',import.meta.url),{type:'module'}),ranges:HighlightRange[]=[];
  try{for(const rule of rules){const result=await new Promise<HighlightRange[]>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`高亮规则“${rule.name||rule.pattern}”执行超时`)),Math.max(100,Math.min(30000,rule.timeoutMillisecond||3000)));worker.onmessage=event=>{clearTimeout(timer);event.data.error?reject(new Error(event.data.error)):resolve(event.data.ranges);};worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message));};worker.postMessage({text,rule,titleLength});});ranges.push(...result);if(ranges.length>=10000)break;}return ranges.slice(0,10000);}finally{worker.terminate();}
}
