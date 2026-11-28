import 'fake-indexeddb/auto';
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {Cover,CoverSettingsContext} from './ui';
import {CoverNetworkContext} from './cover-network';
import {ThemeSettings} from './ThemeSettings';
import {DEFAULT_SETTINGS} from './model';
import {defaultCover} from './theme-model';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:vi.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks();});
it('persists the WiFi switch without resetting other cover choices and renders the original default',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),save=vi.fn();
  function Harness(){const [prefs,setPrefs]=useState({...DEFAULT_SETTINGS,coverConfig:{...defaultCover,horizontal:true}});return createElement(ThemeSettings,{prefs,save:next=>{save(next);setPrefs(next as typeof prefs);},welcome:vi.fn(),notify:vi.fn()});}
  const click=async(text:string)=>act(async()=>[...host.querySelectorAll('button')].find(b=>b.querySelector('span')?.firstChild?.textContent===text)!.click());
  try{
    await act(async()=>root.render(createElement(Harness)));await click('封面设置');
    const toggle=()=>host.querySelector<HTMLInputElement>('[aria-label="仅 WiFi"]')!;
    expect(toggle().checked).toBe(false);await act(async()=>toggle().click());expect(save).toHaveBeenLastCalledWith(expect.objectContaining({coverConfig:expect.objectContaining({onlyWifi:true,horizontal:true})}));expect(toggle().checked).toBe(true);
    await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await click('封面设置');expect(toggle().checked).toBe(true);
  }finally{await act(async()=>root.unmount());host.remove();}
});
it('protects result images and configured background images while preserving explicit shelf/detail loading',async()=>{
  vi.stubGlobal('navigator',{userAgent:'Android'});vi.mocked(invoke).mockRejectedValue(new Error('No download expected'));
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const book={name:'Public',author:'Author',cover:'https://cover.test/book.png'},config={...defaultCover,night:false,image:'https://cover.test/default.png'};
  const render=async(restricted:boolean,useDefault=false)=>act(async()=>root.render(createElement(CoverNetworkContext.Provider,{value:{onlyWifi:true,connection:{wifi:false,online:true}}},createElement(CoverSettingsContext.Provider,{value:{...config,useDefault}},createElement(Cover,{book,restricted})))));
  try{
    await render(true);await act(async()=>{await new Promise(r=>setTimeout(r,30));});expect(host.querySelector('img')).toBeNull();expect(host.querySelector<HTMLElement>('.cover')!.style.backgroundImage).toBe('');expect(invoke).not.toHaveBeenCalled();
    await render(false);expect(host.querySelector('img')!.src).toBe(book.cover);expect(host.querySelector<HTMLElement>('.cover')!.style.backgroundImage).toContain(config.image);expect(invoke).not.toHaveBeenCalled();
    await render(true,true);await act(async()=>{await new Promise(r=>setTimeout(r,30));});expect(host.querySelector('img')).toBeNull();expect(host.querySelector('svg')).not.toBeNull();expect(invoke).not.toHaveBeenCalled();
  }finally{await act(async()=>root.unmount());host.remove();}
});
