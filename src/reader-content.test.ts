import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { processReaderContent } from './reader-content';
import { newBook } from './model';
import { newReplaceRule, replaceText } from './replacement-engine';
import * as storage from './storage';
import { resegmentContent } from './resegment';

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
  const book={...newBook('编辑验收','txt',[{title:'章',content:'编辑',originalContent:'原文',reversedOriginal:'倒序原文',keepSameTitle:true}]),reSegment:true};
  await storage.put('books',book.id,book);await storage.put('settings','contentEditPlainText',false);
  const backup=await storage.backup();await storage.put('settings','contentEditPlainText',true);await storage.restore(backup);
  expect(await storage.preference('contentEditPlainText',true)).toBe(false);
  const saved=(await storage.all<typeof book>('books')).find(item=>item.id===book.id)!;expect(saved.chapters[0]).toEqual(book.chapters[0]);expect(saved.reSegment).toBe(true);
  const invalid=JSON.parse(backup);invalid.books[0].chapters[0].originalContent=42;
  await expect(storage.restore(JSON.stringify(invalid))).rejects.toThrow('章节损坏');
  const badSetting=JSON.parse(backup);badSetting.books[0].reSegment='true';await expect(storage.restore(JSON.stringify(badSetting))).rejects.toThrow('正文设置损坏');
});
it('runs resegmentation before conversion and replacement without changing the cached original',async()=>{
  let terminated=0;
  class ContentWorker {onmessage?: (event:{data:unknown})=>void;postMessage(data:any){queueMicrotask(()=>this.onmessage?.({data:{text:data.rule?replaceText(data.text,data.rule):resegmentContent(data.content,data.title,()=>1)}}));}terminate(){terminated++;}}
  vi.stubGlobal('Worker',ContentWorker);
  const chapter={title:'第一章',content:'第一章\n我來到\n窗前。'},book={...newBook('书','txt',[chapter]),reSegment:true};
  const rule={...newReplaceRule(),pattern:'我来到窗前',replacement:'合并成功',isRegex:false};
  expect((await processReaderContent(chapter.content,book,chapter,[rule],'simple')).content).toBe('合并成功。');
  expect((await processReaderContent(chapter.content,{...book,reSegment:false},chapter,[],'none')).content).toBe('我來到\n窗前。');
  expect(chapter.content).toBe('第一章\n我來到\n窗前。');expect(terminated).toBe(2);
});
it('keeps reading available after a malformed original rule and continues the remaining rules',async()=>{
  class RuleWorker {onmessage?: (event:{data:unknown})=>void;postMessage(data:any){queueMicrotask(()=>{try{this.onmessage?.({data:{text:replaceText(data.text,data.rule)}});}catch{this.onmessage?.({data:{error:'Invalid pattern'}});}});}terminate(){}}
  vi.stubGlobal('Worker',RuleWorker);
  const book=newBook('fixture','txt',[{title:'章',content:'原文'}]),invalid={...newReplaceRule(),id:1,pattern:'['},valid={...newReplaceRule(),id:2,pattern:'原文',replacement:'正文',isRegex:false};
  const result=await processReaderContent('原文',book,book.chapters[0],[invalid,valid],'none');
  expect(result.content).toBe('正文');expect(result.failedRules.map(rule=>rule.id)).toEqual([1]);expect(result.effectiveRules.map(rule=>rule.id)).toEqual([2]);
});
