import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReaderSearch,markSearchText} from './ReaderSearch';
import {chapterSearchResults,searchCachedContent,type ReaderSearchProgress} from './reader-search';
import {DEFAULT_SETTINGS,newBook,type Book} from './model';
import * as storage from './storage';

vi.mock('./reader-search',async original=>({...await original<typeof import('./reader-search')>(),searchCachedContent:vi.fn()}));
let host:HTMLDivElement,root:Root,book:Book,query:string;
const origin={chapter:0,position:12},jump=vi.fn(async()=>{}),search=vi.mocked(searchCachedContent);
const result=(word:string):ReaderSearchProgress=>({results:chapterSearchResults(book.id,0,undefined,'Chapter','first '+word+' and '+word,word,'all',origin,false),searched:1,cached:1,limited:false,failedRules:0});
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const render=async()=>{
  await act(async()=>root.render(createElement(ReaderSearch,{book,prefs:DEFAULT_SETTINGS,origin,query,setQuery:value=>{query=value;void render();},jump})));
  await vi.waitFor(async()=>{await act(async()=>wait(5));expect(button('全局').disabled).toBe(false);});
};
const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===label)!;
const click=(label:string)=>act(async()=>{expect(button(label)).toBeTruthy();button(label).click();});
const advance=()=>act(async()=>wait(230));
beforeEach(async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();
  book=newBook('Public','txt',[{title:'Chapter',content:'first Needle and Needle'}]);query='Needle';
  search.mockImplementation(async(_book,word,options)=>{const value=result(word);options.progress?.(value);return value;});
  await storage.put('settings','contentSearchScope','all');await storage.remove('settings','contentSearchReplace');host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;});
it('persists the chosen scope and uses the captured reader origin when reopened',async()=>{
  await render();await click('向上');await advance();
  expect(search).toHaveBeenLastCalledWith(book,'Needle',expect.objectContaining({scope:'up',origin}));
  expect(await storage.preference('contentSearchScope','all')).toBe('up');
  await act(async()=>root.unmount());root=createRoot(host);await render();await advance();
  expect(button('向上').getAttribute('aria-pressed')).toBe('true');
  expect(search).toHaveBeenLastCalledWith(book,'Needle',expect.objectContaining({scope:'up',origin}));
});
it('stops before the debounce begins and allows an explicit new search',async()=>{
  await render();await click('停止');await advance();expect(search).not.toHaveBeenCalled();expect(host.textContent).toContain('已停止');
  await click('搜索');await advance();expect(search).toHaveBeenCalledOnce();expect(host.querySelectorAll('.reader-search-result')).toHaveLength(2);
});
it('ignores late progress and failures from a stopped query after a new query starts',async()=>{
  let oldProgress:((value:ReaderSearchProgress)=>void)|undefined,rejectOld:(reason:Error)=>void=()=>{};
  search.mockImplementationOnce((_book,_word,options)=>{oldProgress=options.progress;return new Promise((_resolve,reject)=>{rejectOld=reject;});});
  await render();await advance();await click('停止');query='Later';await render();await advance();
  await act(async()=>{oldProgress?.(result('Needle'));rejectOld(new Error('obsolete failure'));});
  expect([...host.querySelectorAll('.reader-search-result mark')].map(node=>node.textContent)).toEqual(['Later','Later']);expect(host.textContent).not.toContain('obsolete failure');
  query='';await render();await advance();expect(host.querySelectorAll('.reader-search-result')).toHaveLength(0);
});
it('passes each repeated hit and its exact anchor to navigation, retaining errors for retry',async()=>{
  await render();await advance();const hits=result('Needle').results;
  await act(async()=>(host.querySelectorAll<HTMLButtonElement>('.reader-search-result')[1]).click());expect(jump).toHaveBeenLastCalledWith(hits[1]);
  jump.mockRejectedValueOnce(new Error('正文已变化，请重新搜索'));
  await act(async()=>(host.querySelectorAll<HTMLButtonElement>('.reader-search-result')[0]).click());expect(jump).toHaveBeenLastCalledWith(hits[0]);expect(host.querySelector('[role=alert]')?.textContent).toContain('请重新搜索');expect(host.querySelectorAll('.reader-search-result')).toHaveLength(2);
});
it('marks text across existing styled segments without changing text, attributes or surrounding styles',async()=>{
  const range={start:3,end:9};
  await act(async()=>root.render(createElement('p',null,...[{text:'😀Ne',start:0},{text:'edleEnd',start:4}].map(part=>createElement('span',{key:part.start,'data-highlight':true,style:{fontWeight:700}},markSearchText(part.text,part.start,range))))));
  expect(host.textContent).toBe('😀NeedleEnd');expect([...host.querySelectorAll('mark')].map(node=>node.textContent).join('')).toBe('eedleE');
  expect([...host.querySelectorAll('span')].every(node=>node.style.fontWeight==='700'&&node.dataset.highlight==='true')).toBe(true);
  expect(markSearchText('untouched',20,range)).toBe('untouched');
});
it('defaults replacement off, reruns on toggle, persists the choice and respects the book setting',async()=>{
  book={...book,useReplaceRule:false};await render();await advance();
  const checkbox=()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  expect(checkbox().checked).toBe(false);expect(search).toHaveBeenLastCalledWith(book,'Needle',expect.objectContaining({replace:false}));
  await act(async()=>checkbox().click());await advance();expect(await storage.preference('contentSearchReplace',false)).toBe(true);
  expect(search).toHaveBeenLastCalledWith(book,'Needle',expect.objectContaining({replace:true}));expect(host.textContent).toContain('本书已关闭替换');
  await act(async()=>root.unmount());root=createRoot(host);await render();await advance();expect(checkbox().checked).toBe(true);expect(book.useReplaceRule).toBe(false);
});
it('isolates late replacement results when the search replacement option changes',async()=>{
  let oldProgress:((value:ReaderSearchProgress)=>void)|undefined,resolveOld:(value:ReaderSearchProgress)=>void=()=>{};
  search.mockImplementationOnce((_book,_query,options)=>{oldProgress=options.progress;return new Promise(resolve=>{resolveOld=resolve;});});
  await render();await advance();
  await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await advance();
  await act(async()=>{oldProgress?.(result('obsolete raw text'));resolveOld(result('obsolete raw text'));});
  expect(host.querySelectorAll('.reader-search-result')).toHaveLength(2);expect(host.textContent).not.toContain('obsolete raw text');expect(host.textContent).not.toContain('正在搜索');
});
