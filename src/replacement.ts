import type { ReplaceRule } from './replacement-engine';
import {invoke,isTauri} from '@tauri-apps/api/core';
export * from './replacement-engine';

export async function applyReplacement(text: string, rules: ReplaceRule[], applied?:(rule:ReplaceRule)=>void,failed?:(rule:ReplaceRule)=>void): Promise<string> {
  if (!rules.length) return text;
  if(isTauri()&&/Android/i.test(navigator.userAgent)){
    for(const rule of rules){
      try{
      const result=await invoke<{json:string}>('java_bridge',{payload:JSON.stringify({operation:'replace',text,pattern:rule.pattern,replacement:rule.replacement,isRegex:rule.isRegex,timeout:rule.timeoutMillisecond})});
      const next=JSON.parse(result.json).value as string;if(next!==text)applied?.(rule);text=next;
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
        worker.postMessage({ text, rule });
      });
      if(before!==text)applied?.(rule);
      }catch(error){if(!failed)throw error;failed(rule);worker.terminate();worker=new Worker(new URL('./replacement.worker.ts',import.meta.url),{type:'module'});}
    }
    return text;
  } finally { worker.terminate(); }
}
