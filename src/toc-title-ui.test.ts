import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReaderToc} from './ReaderToc';
import {newBook,type Book} from './model';
import {newReplaceRule} from './replacement';
import * as storage from './storage';

let root:Root,host:HTMLDivElement,book:Book,enabled:boolean,reverse:boolean,count:boolean;
const notify=vi.fn(),jump=vi.fn(),rule={...newReplaceRule(),id:1,name:'Public',pattern:'Raw',replacement:'Display',scopeTitle:true,scopeContent:false,isRegex:false};
const save=vi.fn(async(value:boolean)=>{await storage.put('settings','reader',{...await storage.settings(),tocUiUseReplace:value});enabled=value;await render();});
const render=()=>act(async()=>root.render(createElement(ReaderToc,{key:book.id,book,reverse,setReverse:v=>{reverse=v;void render();},countWords:count,saveCountWords:async v=>{count=v;await render();},saveExpanded:async()=>{},useReplace:enabled,saveUseReplace:save,replaceDefault:true,conversion:'none',notify,jump})));
const check=(s:string)=>[...host.querySelectorAll<HTMLInputElement>('label input')].find(n=>n.parentElement?.textContent===s)!;
const titles=()=>[...host.querySelectorAll('.toc-list button span')].map(n=>n.textContent);
const until=async(check:()=>void)=>vi.waitFor(async()=>{await act(async()=>new Promise(r=>setTimeout(r,5)));check();});
const search=(v:string)=>act(async()=>{const input=host.querySelector<HTMLInputElement>('input[type=search]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,v);input.dispatchEvent(new Event('input',{bubbles:true}));});
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();enabled=reverse=false;count=true;await storage.remove('settings','reader');await storage.put('settings','replaceRules',[rule]);book={...newBook('Public','txt',[{title:'Raw volume',isVolume:true},{title:'Raw One',content:'One.',wordCount:'4字'},{title:'Raw Two',content:'Two.'}]),chapter:1};host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('replaces displayed volume and chapter titles, searches the raw names and retains the raw locator and jump index',async()=>{
  const original=structuredClone(book);await render();expect(check('使用替换').checked).toBe(false);await act(async()=>check('使用替换').click());await until(()=>expect(titles()[1]).toBe('Display One'));
  expect(titles()[0]).toBe('Display volume');expect(host.querySelector('.toc-current')?.textContent).toContain('Raw One');
  await search('Display');expect(titles()).toEqual([]);await search('Raw One');expect(titles()).toEqual(['Display volume','Display One']);
  await search('');await act(async()=>host.querySelector<HTMLButtonElement>('.toc-tools button')!.click());expect(titles()).toEqual(['Display volume','Display Two','Display One']);
  await act(async()=>check('加载字数').click());expect(check('使用替换').checked).toBe(true);expect(host.querySelector('.toc-word-count')).toBeNull();
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-toc-index="1"]')!.click());expect(jump).toHaveBeenCalledWith(1);expect(book).toEqual(original);
  book={...newBook('Second','txt',[{title:'Raw other'}]),useReplaceRule:false};enabled=(await storage.settings()).tocUiUseReplace;await render();await until(()=>expect(titles()).toEqual(['Raw other']));expect(check('使用替换').checked).toBe(true);
});
it('ignores outdated title work after switching off, and leaves an unsuccessful setting save off',async()=>{
  const queue:(()=>void)[]=[];class SlowWorker {onmessage?:(event:{data:unknown})=>void;postMessage(){queue.push(()=>this.onmessage?.({data:{text:'Stale title'}}));}terminate(){}}
  vi.stubGlobal('Worker',SlowWorker);await storage.put('settings','replaceRules',[{...rule,isRegex:true}]);await render();
  save.mockRejectedValueOnce(new Error('persist failed'));await act(async()=>check('使用替换').click());await until(()=>expect(check('使用替换').disabled).toBe(false));expect(check('使用替换').checked).toBe(false);expect(notify).toHaveBeenCalledWith('Error: persist failed');
  await act(async()=>check('使用替换').click());await until(()=>{expect(queue.length).toBeGreaterThan(0);expect(check('使用替换').disabled).toBe(false);});
  await act(async()=>check('使用替换').click());await until(()=>expect(check('使用替换').checked).toBe(false));await act(async()=>queue.splice(0).forEach(f=>f()));
  expect(titles()).toEqual(['Raw volume','Raw One','Raw Two']);expect(jump).not.toHaveBeenCalled();
});
