import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {GroupManager} from './LibraryManager';
import {Bookshelf} from './Bookshelf';
import {DEFAULT_SETTINGS,newBook,type BookGroup} from './model';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const base:BookGroup={id:'legado-group-1',name:'Original',order:0,show:true,enableRefresh:true,legacy:{bookSort:5,future:'keep'}};
it('edits inherited or overridden sorting, cancels changes and keeps a failed save editable',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),save=vi.fn(async (_next:BookGroup[])=>{});
  function Harness(){const [groups,setGroups]=useState([base]);return createElement(GroupManager,{groups,save:async(next:BookGroup[])=>{await save(next);setGroups(next);}});}
  const click=async(text:string)=>{await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!.click());};
  const select=async(value:string)=>{await act(async()=>{const s=host.querySelector('select')!;s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));});};
  try{
    await act(async()=>root.render(createElement(Harness)));await click('Original');expect(host.querySelector('select')!.value).toBe('5');
    await select('2');await click('取消');expect(save).not.toHaveBeenCalled();await click('Original');expect(host.querySelector('select')!.value).toBe('5');
    await select('-1');await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(save.mock.calls[0][0][0]).toEqual({...base,bookSort:-1,onlyUpdateRead:false});await click('Original');expect(host.querySelector('select')!.value).toBe('-1');
    save.mockRejectedValueOnce(new Error('Save failed'));await select('3');await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(host.querySelector('[role=alert]')!.textContent).toContain('Save failed');expect(host.querySelector('select')!.value).toBe('3');
  }finally{await act(async()=>root.unmount());host.remove();}
});
it('uses the effective group sort for keyboard and mouse drop eligibility',async()=>{
  const books=[{...newBook('A','txt',[]),id:'a'},{...newBook('B','txt',[]),id:'b'}],reorder=vi.fn(),open=vi.fn(),detail=vi.fn();
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const render=(sort:'manual'|'name')=>act(async()=>root.render(createElement(Bookshelf,{books,prefs:{...DEFAULT_SETTINGS,shelfSort:sort==='manual'?'name':'manual'},sort,reorder,open,detail})));
  const drop=()=>{const e=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:{getData:()=>books[1].id}});host.querySelector('article')!.dispatchEvent(e);};
  try{
    await render('manual');expect([...host.querySelectorAll('article')].every(a=>a.draggable)).toBe(true);
    await act(async()=>host.querySelector('[aria-label="移动 A"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
    expect(reorder).toHaveBeenCalledWith('a','b');expect(open).not.toHaveBeenCalled();
    await render('name');expect(host.querySelector('.shelf-reorder')).toBeNull();expect([...host.querySelectorAll('article')].every(a=>!a.draggable)).toBe(true);
    reorder.mockClear();await act(async()=>drop());expect(reorder).not.toHaveBeenCalled();
  }finally{await act(async()=>root.unmount());host.remove();}
});
it('edits and cancels only-read choices without losing an older imported flag or changing another group',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),save=vi.fn(async (_next:BookGroup[])=>{});
  const initial:BookGroup[]=[{...base,legacy:{...base.legacy,onlyUpdateRead:1}},{...base,id:'legado-group-2',name:'Other',onlyUpdateRead:false}];
  function Harness(){const [groups,setGroups]=useState(initial);return createElement(GroupManager,{groups,save:async(next:BookGroup[])=>{await save(next);setGroups(next);}});}
  const click=async(text:string)=>act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!.click());
  const toggle=async()=>act(async()=>host.querySelector<HTMLInputElement>('form input[type=checkbox]')!.click());
  const submit=async()=>act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  const checked=()=>host.querySelector<HTMLInputElement>('form input[type=checkbox]')!.checked;
  try{
    await act(async()=>root.render(createElement(Harness)));expect(checked()).toBe(false);
    await click('Original');expect(checked()).toBe(true);await toggle();await click('取消');expect(save).not.toHaveBeenCalled();
    await click('Original');expect(checked()).toBe(true);await toggle();await submit();
    expect(save.mock.calls[0][0]).toEqual([{...initial[0],bookSort:5,onlyUpdateRead:false},initial[1]]);
    await click('Original');expect(checked()).toBe(false);await toggle();save.mockRejectedValueOnce(new Error('Flag save failed'));await submit();
    expect(checked()).toBe(true);expect(host.querySelector('[role=alert]')!.textContent).toContain('Flag save failed');
    await click('取消');await click('Original');expect(checked()).toBe(false);
  }finally{await act(async()=>root.unmount());host.remove();}
});
