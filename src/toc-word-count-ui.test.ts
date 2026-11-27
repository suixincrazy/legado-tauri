import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReaderToc} from './ReaderToc';
import {newBook,type Book} from './model';
import * as storage from './storage';

let host:HTMLDivElement,root:Root,book:Book,reverse:boolean,countWords:boolean;
const notify=vi.fn(),jump=vi.fn();
const save=vi.fn(async(value:boolean)=>{await storage.put('settings','reader',{...await storage.settings(),tocCountWords:value});countWords=value;await render();});
const render=()=>act(async()=>root.render(createElement(ReaderToc,{key:book.id,book,reverse,setReverse:value=>{reverse=value;void render();},useReplace:false,saveUseReplace:async()=>{},replaceDefault:true,conversion:'none',saveExpanded:async()=>{},countWords,saveCountWords:save,notify,jump})));
const toggle=()=>[...host.querySelectorAll<HTMLInputElement>('label input')].find(n=>n.parentElement?.textContent==='加载字数')!;
const counts=()=>[...host.querySelectorAll('.toc-word-count')].map(n=>[n.parentElement?.querySelector('span')?.textContent,n.textContent]);
const query=(value:string)=>act(async()=>{const input=host.querySelector<HTMLInputElement>('input[type=search]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
beforeEach(async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();reverse=false;
  await storage.remove('settings','reader');countWords=(await storage.settings()).tocCountWords;
  book={...newBook('Public','online',[{title:'Volume',isVolume:true,wordCount:'hide'},{title:'Trail',content:'Public',wordCount:'来源 1.20万字'},{title:'Absent'},{title:'Zero',wordCount:'0字'},{title:'Empty',wordCount:''},{title:'Null',wordCount:null}]),chapter:1,offset:.25,bookmarks:[{chapter:1,offset:0,title:'Keep',created:1}]};
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('displays metadata independently of caching, hides volume and missing counts, and preserves navigation data',async()=>{
  const before=structuredClone(book);await render();expect(toggle().checked).toBe(true);
  expect(counts()).toEqual([['Trail','来源 1.20万字'],['Zero','0字']]);
  await query('zero');expect(counts()).toEqual([['Zero','0字']]);await query('');
  await act(async()=>host.querySelector<HTMLButtonElement>('.toc-tools button')!.click());
  expect(counts()).toEqual([['Zero','0字'],['Trail','来源 1.20万字']]);
  expect(book).toEqual(before);expect(jump).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
it('persists a global off choice across books and remounts without deleting metadata',async()=>{
  await render();await act(async()=>toggle().click());await vi.waitFor(()=>expect(toggle().disabled).toBe(false));
  expect(counts()).toEqual([]);expect((await storage.settings()).tocCountWords).toBe(false);
  const before=book.chapters;book={...newBook('Other','txt',[{title:'Other',wordCount:'8字'}]),id:'second'};
  countWords=(await storage.settings()).tocCountWords;await render();expect(counts()).toEqual([]);expect(toggle().checked).toBe(false);
  await act(async()=>root.unmount());root=createRoot(host);await render();expect(toggle().checked).toBe(false);
  await act(async()=>toggle().click());await vi.waitFor(()=>expect(toggle().disabled).toBe(false));expect(counts()).toEqual([['Other','8字']]);expect(before[1].wordCount).toBe('来源 1.20万字');
  expect(jump).not.toHaveBeenCalled();
});
it('keeps the previous choice and list when saving the global preference fails',async()=>{
  await render();save.mockRejectedValueOnce(new Error('public persistence failure'));
  await act(async()=>toggle().click());await vi.waitFor(()=>expect(toggle().disabled).toBe(false));
  expect(toggle().checked).toBe(true);expect(counts()).toHaveLength(2);expect(notify).toHaveBeenCalledWith('Error: public persistence failure');
  expect((await storage.settings()).tocCountWords).toBe(true);
});
