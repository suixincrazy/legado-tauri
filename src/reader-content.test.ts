import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { processReaderContent } from './reader-content';
import { newBook } from './model';
import { newReplaceRule, replaceText } from './replacement-engine';
import * as storage from './storage';

afterEach(()=>vi.unstubAllGlobals());
it('uses converted body text for replacement and reports only effective rules',async()=>{
  class RuleWorker { onmessage?: (event:{data:unknown})=>void; postMessage(data:{text:string;rule:ReturnType<typeof newReplaceRule>}){queueMicrotask(()=>this.onmessage?.({data:{text:replaceText(data.text,data.rule)}}));}terminate(){} }
  vi.stubGlobal('Worker',RuleWorker);
  const chapter={title:'第一章',content:'第一章\n閱讀文字'},book=newBook('书','txt',[chapter]);
  const rule={...newReplaceRule(),id:1,pattern:'阅读',replacement:'读书',isRegex:false};
  const result=await processReaderContent(chapter.content,book,chapter,[rule,{...rule,id:2,pattern:'无匹配'}],'simple');
  expect(result.content).toBe('读书文字');expect(result.sameTitleRemoved).toBe(true);expect(result.effectiveRules.map(item=>item.id)).toEqual([1]);
  const disabled=await processReaderContent(chapter.content,{...book,useReplaceRule:false},{...chapter,keepSameTitle:true},[rule],'none');
  expect(disabled.content).toBe(chapter.content);expect(disabled.effectiveRules).toEqual([]);
});
it('preserves edited originals and a false plain-text preference through backup restore',async()=>{
  const book=newBook('编辑验收','txt',[{title:'章',content:'编辑',originalContent:'原文',reversedOriginal:'倒序原文',keepSameTitle:true}]);
  await storage.put('books',book.id,book);await storage.put('settings','contentEditPlainText',false);
  const backup=await storage.backup();await storage.put('settings','contentEditPlainText',true);await storage.restore(backup);
  expect(await storage.preference('contentEditPlainText',true)).toBe(false);
  const saved=(await storage.all<typeof book>('books')).find(item=>item.id===book.id)!;expect(saved.chapters[0]).toEqual(book.chapters[0]);
  const invalid=JSON.parse(backup);invalid.books[0].chapters[0].originalContent=42;
  await expect(storage.restore(JSON.stringify(invalid))).rejects.toThrow('章节损坏');
});
