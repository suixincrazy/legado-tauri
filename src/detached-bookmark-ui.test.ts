import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BookmarkList} from './BookmarkManager';
import {newBook,type Book} from './model';
import {recordIdentity,type LegadoBookmark,type DetachedBookmark} from './bookmarks';

const files=vi.hoisted(()=>({save:vi.fn()}));
vi.mock('./files',()=>({saveFile:files.save}));
let host:HTMLDivElement,root:Root,books:Book[],detached:DetachedBookmark[];
const record={time:1700000000000,bookName:'未入架公开书',bookAuthor:'同作者',chapterIndex:4,chapterPos:681,chapterName:'第五章',bookText:'保留原文😀',content:'保留摘要'};
const jump=vi.fn(async()=>{}),notify=vi.fn(),save=vi.fn(async()=>{});
const saveGlobal=vi.fn(async(item:LegadoBookmark,change?:{bookText:string;content:string})=>{
  detached=detached.flatMap(current=>recordIdentity(current.record)===recordIdentity(item)?change?[{...current,record:{...current.record,...change}}]:[]:[current]);await render();
});
const render=()=>act(async()=>root.render(createElement(BookmarkList,{books,detached,saveGlobal,save,jump,notify})));
const click=(label:string)=>act(async()=>{const node=[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.getAttribute('aria-label')===label||button.textContent?.trim()===label);expect(node).toBeTruthy();node!.click();});
const fill=(node:HTMLInputElement|HTMLTextAreaElement,value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});
const openFirst=()=>act(async()=>(host.querySelector('.bookmark-target') as HTMLButtonElement).click());
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();files.save.mockResolvedValue(true);books=[];
  detached=[{record:{...record},positionLayout:{indent:3,titleVisible:false}}];
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;});
it('opens an unlisted row in the editor without navigation and cancels without writing',async()=>{
  await render();await openFirst();expect(jump).not.toHaveBeenCalled();expect(host.querySelectorAll('textarea')).toHaveLength(2);
  await fill(host.querySelectorAll('textarea')[0],'Discard');await click('取消');
  expect(saveGlobal).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(detached[0].record).toEqual(record);
});
it('saves and deletes an unlisted row while preserving exact time, position and independent book identities',async()=>{
  detached.push({record:{...record,bookAuthor:'另一作者',content:'Do not edit'},positionLayout:{indent:2,titleVisible:true}});
  await render();await fill(host.querySelector('input')!,'同作者');await openFirst();
  await fill(host.querySelectorAll('textarea')[0],'修订原文');await fill(host.querySelectorAll('textarea')[1],'修订摘要');await click('确定');
  expect(detached[0]).toEqual({record:{...record,bookText:'修订原文',content:'修订摘要'},positionLayout:{indent:3,titleVisible:false}});
  expect(detached[1].record.content).toBe('Do not edit');expect(save).not.toHaveBeenCalled();
  await openFirst();await click('删除');expect(detached).toHaveLength(1);expect(detached[0].record.bookAuthor).toBe('另一作者');
});
it('search filters unlisted rows while both global exports include attached and unlisted records',async()=>{
  books=[{...newBook('在架公开书','txt',[{title:'第一章'}],'同作者'),bookmarks:[{created:5,chapter:0,offset:0,title:'第一章',content:'在架摘要'}]}];
  await render();await fill(host.querySelector('input')!,'保留摘要');expect(host.querySelectorAll('.bookmark-row')).toHaveLength(1);
  await click('导出 JSON');expect(JSON.parse(files.save.mock.lastCall![1])).toHaveLength(2);expect(JSON.parse(files.save.mock.lastCall![1])).toContainEqual(record);
  await fill(host.querySelector('input')!,'不存在');await click('导出 MD');
  const text=files.save.mock.lastCall![1];expect(text).toContain('未入架公开书');expect(text).toContain('在架公开书');expect(text).toContain('保留原文😀');
});
it('navigates when a matching shelf book is available and keeps other authors unassociated',async()=>{
  const exact={...newBook(record.bookName,'txt',[],record.bookAuthor),id:'exact'};
  books=[newBook(record.bookName,'txt',[],'不同作者')];await render();await openFirst();expect(jump).not.toHaveBeenCalled();await click('取消');
  books.push(exact);await render();await openFirst();
  expect(jump).toHaveBeenCalledWith(exact,expect.objectContaining({chapter:4,chapterPos:681,created:record.time}));
  expect(host.querySelector('[role=dialog]')).toBeNull();
});
