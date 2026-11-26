import {afterEach,expect,it,vi} from 'vitest';
import {DEFAULT_SETTINGS,newBook} from './model';
import {newReplaceRule,replaceText} from './replacement-engine';
import {resegmentContent} from './resegment';
import {chapterSearchResults,makeSearchAnchor,readerSearchLimit,resolveSearchAnchor,searchCachedContent,searchDocument,type ReaderSearchScope} from './reader-search';

afterEach(()=>vi.unstubAllGlobals());
const origin={chapter:0,position:0};
const results=(title:string,body:string,query:string,scope:ReaderSearchScope='all',position=0,hidden=false,limit=1000)=>chapterSearchResults('public-book',0,undefined,title,body,query,scope,{chapter:0,position},hidden,limit);
it('finds every case-sensitive non-overlapping literal occurrence using UTF-16 offsets and trimmed reader paragraphs',()=>{
  const doc=searchDocument('章😀','  😀猫 CAT 猫cat猫  \n\n下一猫段  ');
  const hits=results('章😀','  😀猫 CAT 猫cat猫  \n\n下一猫段  ','猫');
  expect(hits).toHaveLength(4);expect(hits.map(hit=>hit.start)).toEqual([6,12,16,20]);
  expect(hits.every(hit=>doc.text.slice(hit.start,hit.end)==='猫')).toBe(true);
  expect(results('Title','cat Cat CAT','cat')).toHaveLength(1);
  expect(results('Title','a.b axb a.b','a.b')).toHaveLength(2);
  expect(results('Title','aaa','aa')).toHaveLength(1);expect(results('Title','Text','   ')).toEqual([]);
});
it('includes directional boundaries and returns the nearest upward results when limited',()=>{
  const all=results('Title','word word word','word');
  expect(results('Title','word word word','word','down',all[1].start).map(hit=>hit.start)).toEqual(all.slice(1).map(hit=>hit.start));
  expect(results('Title','word word word','word','up',all[1].start).map(hit=>hit.start)).toEqual(all.slice(0,2).reverse().map(hit=>hit.start));
  const long=results('Title','x '.repeat(2000),'x','up',10000,false,2);
  expect(long).toHaveLength(3);expect(long.map(hit=>hit.start)).toEqual([4004,4002,4000]);
});
it('does not return hidden title hits and resolves visible title and title/body-spanning hits',()=>{
  expect(results('Needle','Body','Needle','all',0,true)).toEqual([]);
  const title=results('Needle','Body','Needle')[0],doc=searchDocument('Needle','Body');
  expect(resolveSearchAnchor(title.anchor,doc.text,doc.titleLength)).toEqual({start:0,end:6});
  expect(resolveSearchAnchor(title.anchor,doc.text,doc.titleLength,true)).toBeNull();
  const cross=results('Needle','Body','le\nBo')[0];
  expect(resolveSearchAnchor(cross.anchor,doc.text,doc.titleLength)).toEqual({start:4,end:9});
});
it('keeps repeated-text ordinals with a body fingerprint and ignores title length changes',()=>{
  const body=('same text '.repeat(200)).trim(),doc=searchDocument('Title',body),hit=results('Title',body,'text')[88];
  const next=searchDocument('A much longer title',body);
  expect(resolveSearchAnchor(hit.anchor,doc.text,doc.titleLength)).toEqual({start:hit.start,end:hit.end});
  expect(resolveSearchAnchor(hit.anchor,next.text,next.titleLength)).toEqual({start:hit.start+next.titleLength-doc.titleLength,end:hit.end+next.titleLength-doc.titleLength});
});
it('relocates by unique neighboring text and rejects missing or ambiguous changed content',()=>{
  const doc=searchDocument('Title','unique before needle unique after'),hit=results('Title','unique before needle unique after','needle')[0];
  const shifted=searchDocument('Title','An inserted paragraph.\nunique before needle unique after');
  expect(resolveSearchAnchor(hit.anchor,shifted.text,shifted.titleLength)?.start).toBe(shifted.text.indexOf('needle'));
  const ambiguous=searchDocument('Title','unique before needle unique after\nunique before needle unique after');
  expect(resolveSearchAnchor(hit.anchor,ambiguous.text,ambiguous.titleLength)).toBeNull();
  expect(resolveSearchAnchor(hit.anchor,doc.text.replace('needle','removed'),doc.titleLength)).toBeNull();
});
it('uses the current conversion and purification pipeline for every cached chapter and skips unavailable content',async()=>{
  class RuleWorker{onmessage?:(event:{data:unknown})=>void;postMessage(data:any){queueMicrotask(()=>this.onmessage?.({data:data.rule?{text:replaceText(data.text,data.rule)}:{text:resegmentContent(data.content,data.title)}}));}terminate(){}}
  vi.stubGlobal('Worker',RuleWorker);
  const chapters=[{title:'第一章',content:'第一章\n閱讀文字 阅读文字'},{title:'第二章',content:'閱讀文字'},{title:'未缓存'},{title:'分卷',content:'閱讀文字',isVolume:true}];
  const book=newBook('公开','txt',chapters),rule={...newReplaceRule(),id:1,pattern:'阅读',replacement:'读书',isRegex:false};
  const options={scope:'all' as const,origin,prefs:{...DEFAULT_SETTINGS,chineseConversion:'simple' as const},rules:[rule],signal:new AbortController().signal};
  const result=await searchCachedContent(book,'读书',options);
  expect(result.cached).toBe(2);expect(result.searched).toBe(2);expect(result.results.map(hit=>hit.chapter)).toEqual([0,0,1]);
  expect(result.results[0].start).toBe(4);expect(result.failedRules).toBe(0);
  expect((await searchCachedContent({...book,useReplaceRule:false},'读书',options)).results).toEqual([]);
});
it('walks upward chapters in reverse and filters only the current chapter by the reader origin',async()=>{
  const book=newBook('Public','txt',[{title:'A',content:'hit hit'},{title:'B',content:'hit hit'},{title:'C',content:'hit hit'}]);
  const base={origin:{chapter:1,position:6},prefs:DEFAULT_SETTINGS,rules:[],signal:new AbortController().signal};
  const upward=await searchCachedContent(book,'hit',{...base,scope:'up'});
  expect(upward.results.map(hit=>[hit.chapter,hit.start])).toEqual([[1,6],[1,2],[0,6],[0,2]]);
  const downward=await searchCachedContent(book,'hit',{...base,scope:'down'});
  expect(downward.results.map(hit=>[hit.chapter,hit.start])).toEqual([[1,6],[2,2],[2,6]]);
});
it('stops between chapters, rejects an already cancelled run and limits retained results explicitly',async()=>{
  const controller=new AbortController(),book=newBook('Public','txt',[{title:'A',content:'hit'},{title:'B',content:'hit'}]),seen:number[]=[];
  const options={scope:'all' as const,origin,prefs:DEFAULT_SETTINGS,rules:[],signal:controller.signal,progress:(value:any)=>{seen.push(value.searched);controller.abort();}};
  await expect(searchCachedContent(book,'hit',options)).rejects.toMatchObject({name:'AbortError'});expect(seen).toEqual([1]);
  await expect(searchCachedContent(book,'hit',options)).rejects.toMatchObject({name:'AbortError'});expect(seen).toEqual([1]);
  const many=await searchCachedContent(newBook('Public','txt',[{title:'A',content:'hit '.repeat(2000)}]),'hit',{...options,progress:undefined,signal:new AbortController().signal});
  expect(many.results).toHaveLength(readerSearchLimit);expect(many.limited).toBe(true);
});
it('stores bounded context per match instead of retaining the whole chapter',()=>{
  const text='x'.repeat(20000)+'needle'+'y'.repeat(20000),start=20000,anchor=makeSearchAnchor(text,0,start,start+6);
  expect(anchor.before).toHaveLength(32);expect(anchor.after).toHaveLength(32);expect(anchor.match).toBe('needle');expect(JSON.stringify(anchor).length).toBeLessThan(300);
});
