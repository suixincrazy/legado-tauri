import 'fake-indexeddb/auto';
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReaderToc} from './ReaderToc';
import {newBook,type Book, type Chapter} from './model';

const chapters:Chapter[]=[];
for(let volume=0;volume<3;volume++){
  chapters.push({title:'Volume '+volume,isVolume:true});
  for(let i=0;i<40;i++)chapters.push({title:'Chapter '+volume+'-'+i,content:'Public text'});
}
let host:HTMLDivElement,root:Root,book:Book,reverse:boolean;
const jump=vi.fn(),save=vi.fn(async()=>{}),notify=vi.fn();
const list=()=>host.querySelector<HTMLDivElement>('.toc-list')!;
const row=(index:number)=>host.querySelector<HTMLButtonElement>('[data-toc-index="'+index+'"]')!;
const render=()=>act(async()=>root.render(createElement(StrictMode,null,createElement(ReaderToc,{key:book.id,book,reverse,setReverse:value=>{reverse=value;void render();},saveExpanded:save,jump,notify}))));
const click=(label:string)=>act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="'+label+'"]')!.click());
const query=async(value:string)=>act(async()=>{const input=host.querySelector<HTMLInputElement>('input[type=search]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
const rows=()=>[...host.querySelectorAll<HTMLElement>('.toc-list [data-toc-index]')];
const rect=(top:number,height=40)=>({x:0,y:top,top,bottom:top+height,left:0,right:350,width:350,height,toJSON(){}});
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();reverse=false;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  book={...newBook('Long public TOC','txt',structuredClone(chapters)),id:'long',chapter:65,offset:.4};
  // jsdom has no layout: emulate a bounded 200px list with 40px rows.
  const original=HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    if(this.classList.contains('toc-list'))return rect(100,200);
    if(this.dataset.tocIndex!==undefined)return rect(100+rows().indexOf(this)*40-list().scrollTop);
    return original.call(this);
  });
  vi.spyOn(Element.prototype,'scrollHeight','get').mockImplementation(function(this:Element){return this.classList.contains('toc-list')?rows().length*40:0;});
  const values=new WeakMap<Element,number>();
  vi.spyOn(Element.prototype,'scrollTop','get').mockImplementation(function(this:Element){return values.get(this)||0;});
  vi.spyOn(Element.prototype,'scrollTop','set').mockImplementation(function(this:Element,value:number){values.set(this,Math.max(0,Math.min(value,rows().length*40-200)));});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
it('positions the initial current chapter and leaves manual scrolling alone through equivalent renders and StrictMode effects',async()=>{
  await render();expect(row(65).getBoundingClientRect().top).toBe(100);
  list().scrollTop=400;book={...book,lastRead:book.lastRead+1,chapters:book.chapters.map(c=>({...c}))};await render();
  expect(list().scrollTop).toBe(400);expect(jump).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
it('scrolls to visual edges and current chapter without changing reading position',async()=>{
  const before=structuredClone(book);await render();await click('滚动到顶部');expect(list().scrollTop).toBe(0);
  await click('滚动到底部');expect(rows().at(-1)!.getBoundingClientRect().bottom).toBe(300);
  await click('定位当前章节');expect(row(65).getBoundingClientRect().top).toBe(100);
  expect(book).toEqual(before);expect(jump).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
it('reopens a manually folded current volume only on explicit locate and keeps the saved default',async()=>{
  book={...book,tocExpanded:false};await render();await act(async()=>row(41).click());expect(row(65)).toBeNull();
  await click('定位当前章节');expect(row(65).getBoundingClientRect().top).toBe(100);
  expect(row(41).getAttribute('aria-expanded')).toBe('true');expect(book.tocExpanded).toBe(false);expect(save).not.toHaveBeenCalled();
});
it('starts search at the first result, locates a matching current chapter, and restores current position after clearing',async()=>{
  await render();await query('Chapter 1-');expect(list().scrollTop).toBe(0);
  await click('定位当前章节');expect(row(65).getBoundingClientRect().top).toBe(100);
  expect(host.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('Chapter 1-');
  await query('');expect(row(65).getBoundingClientRect().top).toBe(100);expect(jump).not.toHaveBeenCalled();
});
it('uses the visible containing volume as a filtered fallback and preserves queries that exclude the entire current volume',async()=>{
  await render();await query('Chapter 1-39');list().scrollTop=400;await click('定位当前章节');
  expect(row(41).getBoundingClientRect().top).toBe(100);expect(row(65)).toBeNull();expect(notify).not.toHaveBeenCalled();
  await query('Chapter 2-');list().scrollTop=200;await click('定位当前章节');
  expect(list().scrollTop).toBe(200);expect(notify).toHaveBeenCalledWith('当前章节不在搜索结果中');
  expect(host.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('Chapter 2-');
});
it('repositions current after reversing and keeps a visible anchor when expanding an earlier volume',async()=>{
  await render();await act(async()=>host.querySelector<HTMLButtonElement>('.toc-tools button')!.click());
  expect(row(65).getBoundingClientRect().top).toBe(100);expect(rows()[0].dataset.tocIndex).toBe('82');
  await click('滚动到底部');expect(rows().at(-1)!.dataset.tocIndex).toBe('1');
  await click('定位当前章节');expect(row(65).getBoundingClientRect().top).toBe(100);
  await act(async()=>row(82).click());expect(row(65).getBoundingClientRect().top).toBe(100);
  await act(async()=>row(82).click());expect(row(65).getBoundingClientRect().top).toBe(100);
});
it('handles an empty catalog without locating or changing the reader',async()=>{
  book={...book,chapters:[],chapter:0};await render();expect(list().scrollTop).toBe(0);
  expect([...host.querySelectorAll<HTMLButtonElement>('.toc-navigation button')].every(b=>b.disabled)).toBe(true);
  expect(jump).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
