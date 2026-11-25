import type { ReplaceRule } from './replacement-engine';
import {invoke,isTauri} from '@tauri-apps/api/core';
import type { ReplacementContext } from './replacement-script';
export * from './replacement-engine';

export async function applyReplacement(text: string, rules: ReplaceRule[], applied?:(rule:ReplaceRule)=>void,failed?:(rule:ReplaceRule)=>void,context:ReplacementContext={}): Promise<string> {
  if (!rules.length) return text;
  if(isTauri()&&/Android/i.test(navigator.userAgent)){
    for(const rule of rules){
      try{
      const deadline=Date.now()+Math.max(100,Math.min(30000,rule.timeoutMillisecond||3000));
      const request=async(operation:string,extra:Record<string,unknown>={})=>{
        const timeout=deadline-Date.now();if(timeout<=0)throw new Error('替换规则执行超时');
        const response=JSON.parse((await invoke<{json:string}>('java_bridge',{payload:JSON.stringify({operation,text,pattern:rule.pattern,replacement:rule.replacement,isRegex:rule.isRegex,timeout,...extra})})).json);
        if(response.error)throw new Error(response.error);return response.value;
      };
      let next:string;
      if(rule.isRegex&&rule.replacement.startsWith('@js:')){
        const matches=await request('replaceMatches') as string[];
        if(!matches.length)continue;
        const {scriptReplacements}=await import('./replacement-script');
        const results=await scriptReplacements(matches,rule,context,deadline);
        next=await request('replaceResults',{results});
      }else next=await request('replace');
      if(next!==text)applied?.(rule);text=next;
      }catch(error){if(!failed)throw error;failed(rule);}
    }
    return text;
  }
  let worker = new Worker(new URL('./replacement.worker.ts', import.meta.url), { type: 'module' });
  try {
    for (const rule of rules) {
      const before=text;
      try{
      text = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`替换规则“${rule.name}”执行超时`)), Math.max(100, Math.min(30000, rule.timeoutMillisecond || 3000)));
        worker.onmessage = event => { clearTimeout(timer); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.text); };
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        const book=context.book;
        worker.postMessage({ text, rule,context:{...context,book:book?{...book,chapters:[],rawText:undefined}:undefined} });
      });
      if(before!==text)applied?.(rule);
      }catch(error){if(!failed)throw error;failed(rule);worker.terminate();worker=new Worker(new URL('./replacement.worker.ts',import.meta.url),{type:'module'});}
    }
    return text;
  } finally { worker.terminate(); }
}
