import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it } from 'vitest';
import { ReaderProgress } from './ReaderProgress';

it('previews a drag, commits on release and confirms chapter jumps once per reading session',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),pages:number[]=[],chapters:number[]=[];
  const render=(behavior:'page'|'chapter')=>act(async()=>root.render(createElement(ReaderProgress,{chapter:0,chapters:8,page:0,pages:12,behavior,loading:false,seekPage:page=>pages.push(page),turnChapter:chapter=>chapters.push(chapter)})));
  const event=(name:string)=>act(async()=>host.querySelector('input')!.dispatchEvent(new Event(name,{bubbles:true})));
  const change=(value:string)=>act(async()=>{const input=host.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
  try{
    await render('page');await event('pointerdown');await change('4');expect(pages).toEqual([]);await event('pointerup');expect(pages).toEqual([4]);
    await event('pointerdown');await change('7');await event('pointercancel');expect(pages).toEqual([4]);
    await render('chapter');await event('pointerdown');await change('3');await event('pointerup');expect(chapters).toEqual([]);expect(host.querySelector('[role=dialog]')?.textContent).toContain('确定要跳转章节吗');
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='否')!.click());expect(chapters).toEqual([]);
    await change('2');await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='是')!.click());expect(chapters).toEqual([2]);
    await change('5');expect(chapters).toEqual([2,5]);expect(host.querySelector('[role=dialog]')).toBeNull();
  }finally{await act(async()=>root.unmount());host.remove();delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
});
