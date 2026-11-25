import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {newReplaceRule,replacementPattern} from './replacement-engine';
import {expandScriptReplacement,scriptReplacements} from './replacement-script';
import {newBook} from './model';

it('evaluates each matched string as a replacement script and retains rule-local variables',async()=>{
  const rule={...newReplaceRule(),pattern:'[A-Z]\\d+',replacement:'@js:java.put("count",String(Number(java.get("count")||0)+1)); result.toLowerCase()+java.get("count")'};
  expect(await scriptReplacements(['A1','B2'],rule)).toEqual(['a11','b22']);
  expect(await scriptReplacements(['A1'],rule)).toEqual(['a11']);
  const chapter={title:'第一章',index:3},book=newBook('书','txt',[chapter]);
  expect(await scriptReplacements(['原文'],{...rule,replacement:'@js:book.name+chapter.title+chapter.index+result'},{book,chapter})).toEqual(['书第一章3原文']);
  await expect(scriptReplacements(['A1'],{...rule,replacement:'@js:book.name'})).rejects.toThrow();
});

it('preserves Java capture expansion and literal backslashes in script results',()=>{
  const [match]=Array.from('A12'.matchAll(replacementPattern('(?<letter>[A-Z])(\\d+)')));
  expect(expandScriptReplacement('$2\\path/${letter}/$10/$0',match)).toBe('12\\path/A/A0/A12');
  expect(()=>expandScriptReplacement('$3',match)).toThrow();
  expect(()=>expandScriptReplacement('${missing}',match)).toThrow();
  expect(()=>expandScriptReplacement('$',match)).toThrow();
});

it('interrupts a nonterminating replacement script without changing cached content',async()=>{
  const rule={...newReplaceRule(),pattern:'.',replacement:'@js:while(true){}',timeoutMillisecond:100};
  await expect(scriptReplacements(['原文'],rule)).rejects.toThrow();
});
