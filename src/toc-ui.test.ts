import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReaderToc} from './ReaderToc';
import {newBook,type Book} from './model';
import {bookTocExpanded} from './toc-config';
import * as storage from './storage';

const chapters=[{title:'Preface',content:'Opening'},{title:'First volume',isVolume:true},{title:'River A',content:'A'},{title:'River B',content:'B'},{title:'Second volume',isVolume:true},{title:'Valley Needle',content:'C'},{title:'Valley D',content:'D'},{title:'Empty volume',isVolume:true}];
let host:HTMLDivElement,root:Root,book:Book,reverse:boolean;
const jump=vi.fn(),notify=vi.fn();
const save=vi.fn(async(value:boolean)=>{book={...book,tocExpanded:value};await storage.put('books',book.id,book);await render();});
const render=()=>act(async()=>root.render(createElement(ReaderToc,{key:book.id,book,reverse,setReverse:value=>{reverse=value;void render();},saveExpanded:save,countWords:true,saveCountWords:async()=>{},jump,notify})));
const labels=()=>[...host.querySelectorAll('.toc-list button span')].map(n=>n.textContent);
const button=(title:string)=>[...host.querySelectorAll<HTMLButtonElement>('.toc-list button')].find(n=>n.querySelector('span')?.textContent===title)!;
const click=(title:string)=>act(async()=>button(title).click());
const search=(query:string)=>act(async()=>{const input=host.querySelector<HTMLInputElement>('input[type=search]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,query);input.dispatchEvent(new Event('input',{bubbles:true}));});
const checkbox=()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
const setDefault=async()=>{await act(async()=>checkbox().click());await vi.waitFor(async()=>{await act(async()=>new Promise(resolve=>setTimeout(resolve,5)));expect(checkbox().disabled).toBe(false);});};
beforeEach(async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();reverse=false;
  for(const entry of await storage.all<Book>('books'))await storage.remove('books',entry.id);
  book={...newBook('Public volumes','txt',chapters,'Public Author'),id:'public-volumes',chapter:2};
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('defaults to expanded and keeps the current volume visible when the per-book preference is off',async()=>{
  await render();expect(checkbox().checked).toBe(true);expect(labels()).toHaveLength(8);
  await setDefault();expect(checkbox().checked).toBe(false);
  expect(labels()).toEqual(['Preface','First volume','River A','River B','Second volume','Empty volume']);
  expect((await storage.all<Book>('books'))[0].tocExpanded).toBe(false);
  expect(button('First volume').getAttribute('aria-expanded')).toBe('true');
  expect(button('River A').getAttribute('aria-current')).toBe('location');
  expect(button('Empty volume').getAttribute('aria-expanded')).toBeNull();
});
it('searches folded volumes case-insensitively, includes only matching ancestors, and preserves manual folds after clearing',async()=>{
  await render();await click('Second volume');expect(labels()).not.toContain('Valley Needle');
  await search('nEeDlE');expect(labels()).toEqual(['Second volume','Valley Needle']);expect(host.textContent).toContain('1 章匹配');
  expect(button('Second volume').getAttribute('aria-expanded')).toBe('true');await click('Second volume');expect(labels()).toEqual(['Second volume','Valley Needle']);
  await search('');expect(labels()).not.toContain('Valley Needle');expect(labels()).toContain('River B');
  await search('Second volume');expect(labels()).toEqual(['Second volume']);expect(host.textContent).toContain('卷名匹配');
  await search('missing');expect(labels()).toEqual([]);expect(host.textContent).toContain('没有匹配章节');
  expect(save).not.toHaveBeenCalled();
});
it('resets the temporary fold on reopen using the saved preference, and opens the destination volume',async()=>{
  book={...book,tocExpanded:false};await render();await click('Second volume');expect(labels()).toContain('Valley Needle');
  await act(async()=>root.unmount());root=createRoot(host);await render();expect(labels()).not.toContain('Valley Needle');
  book={...book,chapter:5};await render();expect(labels()).toContain('Valley Needle');expect(labels()).not.toContain('River A');
  await click('Valley Needle');expect(jump).toHaveBeenCalledWith(5);
});
it('keeps reverse volume headers ahead of their children and restores search order without mutating chapters',async()=>{
  const original=structuredClone(book.chapters);await render();
  await act(async()=>host.querySelector<HTMLButtonElement>('.toc-tools button')!.click());
  expect(labels()).toEqual(['Empty volume','Second volume','Valley D','Valley Needle','First volume','River B','River A','Preface']);
  await search('river');expect(labels()).toEqual(['First volume','River B','River A']);
  expect(book.chapters).toEqual(original);
});
it('does not transfer collapse preference, query or manual volume state between books',async()=>{
  await render();await setDefault();const first=book;
  await search('Valley');book={...newBook('Other public volumes','txt',chapters),id:'other',chapter:2};await render();
  expect(checkbox().checked).toBe(true);expect(labels()).toHaveLength(8);
  await click('Second volume');book=first;await render();expect(checkbox().checked).toBe(false);expect(labels()).not.toContain('Valley Needle');
});
it('keeps saved state and manual folds unchanged when saving the default fails',async()=>{
  await render();await click('Second volume');save.mockRejectedValueOnce(new Error('Storage unavailable'));
  await setDefault();expect(checkbox().checked).toBe(true);expect(checkbox().disabled).toBe(false);expect(labels()).not.toContain('Valley Needle');expect(notify).toHaveBeenCalledWith('Error: Storage unavailable');
});
it('reads previously preserved original settings while explicit Tauri choices take precedence',()=>{
  expect(bookTocExpanded(book)).toBe(true);
  expect(bookTocExpanded({...book,legacy:{readConfig:'{"tocExpanded":false,"future":7}'}})).toBe(false);
  expect(bookTocExpanded({...book,tocExpanded:true,legacy:{readConfig:{tocExpanded:false}}})).toBe(true);
  expect(bookTocExpanded({...book,legacy:{readConfig:'broken'}})).toBe(true);
});
