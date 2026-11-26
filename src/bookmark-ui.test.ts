import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BookmarkList,BookmarkEditor} from './BookmarkManager';
import {bookmarkFile,bookmarkRows} from './bookmarks';
import {newBook,type Book} from './model';

const files=vi.hoisted(()=>({save:vi.fn()}));
vi.mock('./files',()=>({saveFile:files.save}));
let host:HTMLDivElement,root:Root,books:Book[];
const notify=vi.fn(),jump=vi.fn(async()=>{}),save=vi.fn(async(book:Book)=>{books=books.map(b=>b.id===book.id?book:b);await render();});
const mark={chapter:0,offset:.4,title:'章一',chapterName:'章一',created:1700000000000,chapterPos:117,bookText:'原文😀',content:'原摘要',positionLayout:{indent:2,titleVisible:true},future:'retained'};
let single=false;
const render=()=>act(async()=>root.render(createElement(BookmarkList,{books,single:single?books[0]:undefined,save,jump,notify})));
const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent?.trim()===label)!;
const click=(label:string)=>act(async()=>{const node=button(label);expect(node).toBeTruthy();node.click();});
const fill=(node:HTMLInputElement|HTMLTextAreaElement,value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();files.save.mockResolvedValue(true);single=false;
  books=[{...newBook('第一本','txt',[{title:'章一',content:'正文'}],'同作者'),id:'first',bookmarks:[{...mark}]},{...newBook('第二本','txt',[{title:'章一',content:'其他'}],'同作者'),id:'second',bookmarks:[{...mark,content:'独有摘要'}]}];
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{vi.useRealTimers();await act(async()=>root.unmount());host.remove();delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;});
it('cancels drafts without saving, edits only the chosen book and retains identity and exact position',async()=>{
  single=true;
  await render();await click('编辑书签：章一');
  await fill(host.querySelectorAll('textarea')[0],'discard');await fill(host.querySelectorAll('textarea')[1],'discard note');await click('取消');
  expect(save).not.toHaveBeenCalled();expect(books[0].bookmarks[0]).toEqual(mark);
  await click('编辑书签：章一');await fill(host.querySelectorAll('textarea')[0],'修订原文');await fill(host.querySelectorAll('textarea')[1],'修订摘要');await click('确定');
  expect(books[0].bookmarks[0]).toEqual({...mark,bookText:'修订原文',content:'修订摘要'});expect(books[1].bookmarks[0].content).toBe('独有摘要');
  expect(host.querySelector('[role=dialog]')).toBeNull();
});
it('keeps chapter and summary searches within the selected book while export still covers all its bookmarks',async()=>{
  single=true;await render();
  await fill(host.querySelector('input')!,'独有摘要');expect(host.textContent).toContain('没有匹配');expect(host.textContent).not.toContain('第二本');
  await fill(host.querySelector('input')!,'原摘要');expect(host.querySelectorAll('.bookmark-row')).toHaveLength(1);
  await click('导出 JSON');expect(files.save).toHaveBeenLastCalledWith('bookmark-第一本 同作者.json',bookmarkFile(books,'json',books[0]).text);
  await fill(host.querySelector('input')!,'没有');await click('导出 MD');expect(files.save).toHaveBeenLastCalledWith('bookmark-第一本 同作者.md',bookmarkFile(books,'md',books[0]).text);
});
it('opens and deletes one exact bookmark even when two books share the same timestamp',async()=>{
  const target=bookmarkRows(books)[0];
  await render();await act(async()=>(host.querySelector('.bookmark-target') as HTMLButtonElement).click());
  expect(jump).toHaveBeenCalledWith(target.book,target.mark);
  await click('编辑书签：章一');await click('删除');
  expect(books.find(book=>book.id===target.book.id)!.bookmarks).toEqual([]);expect(books.find(book=>book.id!==target.book.id)!.bookmarks).toHaveLength(1);expect(host.querySelector('[role=dialog]')).toBeNull();
});
it('long-press edits without navigating and scroll movement cancels the hold',async()=>{
  await render();vi.useFakeTimers();const node=host.querySelector('.bookmark-target')!;
  const pointer=(type:string,x=0)=>act(async()=>{node.dispatchEvent(new MouseEvent(type,{button:0,bubbles:true,clientX:x,clientY:0}));});
  await pointer('pointerdown');await pointer('pointermove',20);await act(async()=>{vi.advanceTimersByTime(600);});expect(host.querySelector('[role=dialog]')).toBeNull();await pointer('pointercancel');
  await pointer('pointerdown');await act(async()=>{vi.advanceTimersByTime(550);});expect(host.querySelectorAll('textarea')).toHaveLength(2);
  await pointer('pointerup');await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));});expect(jump).not.toHaveBeenCalled();
});
it('does not report success when file save is cancelled and surfaces export failures',async()=>{
  await render();files.save.mockResolvedValue(false);await click('导出 JSON');expect(notify).not.toHaveBeenCalled();
  files.save.mockRejectedValue(new Error('disk unavailable'));await click('导出 MD');expect(notify).toHaveBeenCalledWith('Error: disk unavailable');
});
it('new bookmark drafts require confirmation and failed saves retain their editable contents',async()=>{
  const commit=vi.fn(async()=>{throw Error('write failed');}),close=vi.fn();
  await act(async()=>root.render(createElement(BookmarkEditor,{mark,chapterName:'章一',text:'选中文本',commit,close,notify})));
  expect(commit).not.toHaveBeenCalled();await fill(host.querySelectorAll('textarea')[1],'New note');await click('确定');
  expect(commit).toHaveBeenCalledWith('选中文本','New note');expect(close).not.toHaveBeenCalled();expect(host.querySelectorAll('textarea')[1].value).toBe('New note');expect(notify).toHaveBeenCalledWith('Error: write failed');
  await click('取消');expect(close).toHaveBeenCalledOnce();
});
