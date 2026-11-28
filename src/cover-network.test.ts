import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {openDB} from 'idb';
import {CoverNetworkContext,coverConnection,loadCoverImage,useCoverConnection,useCoverImage} from './cover-network';

const native=vi.hoisted(()=>({enabled:true}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>native.enabled,invoke:vi.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const wifi={wifi:true,online:true},other={wifi:false,online:true};
const url=(name:string)=>'https://cover-fixture.test/'+name+'.png';
const png={mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='};
const data='data:image/png;base64,'+png.base64;
const agent=(value='Android')=>vi.stubGlobal('navigator',{userAgent:value,onLine:true,maxTouchPoints:1});
const response=(value:unknown)=>({json:JSON.stringify({value})});
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks();native.enabled=true;});

it('uses native connectivity on Android and iPad, never WebView effectiveType',async()=>{
  agent();vi.mocked(invoke).mockResolvedValue(response(other));
  expect(await coverConnection()).toEqual(other);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('java_bridge',{payload:'{"operation":"coverNetwork"}'});
  agent('iPad');vi.mocked(invoke).mockResolvedValueOnce(response(wifi));expect(await coverConnection()).toEqual(wifi);
  expect(invoke).toHaveBeenLastCalledWith('source_browser',{request:{mode:'coverNetwork'}});
});
it('distinguishes real browser connection types, offline and unknown',async()=>{
  native.enabled=false;
  for(const [type,expected] of [['wifi',wifi],['cellular',other],['ethernet',other],['none',{wifi:false,online:false}],['unknown',null],[undefined,null]] as const){
    vi.stubGlobal('navigator',{userAgent:'browser',onLine:true,connection:{type,effectiveType:'4g'}});
    expect(await coverConnection()).toEqual(expected);
  }
  vi.stubGlobal('navigator',{onLine:false,connection:{type:'wifi'}});expect(await coverConnection()).toEqual({wifi:false,online:false});expect(invoke).not.toHaveBeenCalled();
});
it('blocks unknown and non-WiFi before any request, preserves local data, and lets cache survive reconnect and reload',async()=>{
  agent();vi.mocked(invoke).mockResolvedValue(response(png));
  expect(await loadCoverImage(url('cache'),true,null)).toBeUndefined();expect(await loadCoverImage(url('cache'),true,other)).toBeUndefined();
  expect(await loadCoverImage(data,true,other)).toBe(data);expect(invoke).not.toHaveBeenCalled();
  expect(await loadCoverImage(url('cache'),true,wifi)).toBe(data);expect(invoke).toHaveBeenCalledTimes(1);
  expect(JSON.parse((vi.mocked(invoke).mock.calls[0][1] as any).payload)).toEqual({operation:'coverImage',url:url('cache'),onlyWifi:true});
  expect(await loadCoverImage(url('cache'),true,other)).toBe(data);expect(invoke).toHaveBeenCalledTimes(1);
  const db=await openDB('legado-cover-cache',1);expect((await db.get('images',url('cache'))).data).toBe(data);db.close();
});
it('shares concurrent downloads while isolating restricted from unrestricted work and propagates failures',async()=>{
  agent();vi.mocked(invoke).mockResolvedValue(response(png));
  expect(await Promise.all([loadCoverImage(url('shared'),true,wifi),loadCoverImage(url('shared'),true,wifi)])).toEqual([data,data]);expect(invoke).toHaveBeenCalledTimes(1);
  let finish!:(v:any)=>void;vi.mocked(invoke).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  const unrestricted=loadCoverImage(url('flight'),false,other);await vi.waitFor(()=>expect(invoke).toHaveBeenCalledTimes(2));
  expect(await loadCoverImage(url('flight'),true,other)).toBeUndefined();expect(invoke).toHaveBeenCalledTimes(2);finish(response(png));await unrestricted;
  vi.mocked(invoke).mockRejectedValueOnce(new Error('WiFi lost'));await expect(loadCoverImage(url('failed'),true,wifi)).rejects.toThrow('WiFi lost');
  expect(await loadCoverImage(url('failed'),true,other)).toBeUndefined();
});
it('bounds the persistent cache and rejects oversized or non-image responses',async()=>{
  agent();vi.mocked(invoke).mockResolvedValue(response(png));
  for(let n=0;n<66;n++)await loadCoverImage(url('bounded'+n),false,wifi);
  const db=await openDB('legado-cover-cache',1);expect(await db.count('images')).toBe(64);expect(await db.get('images',url('bounded0'))).toBeUndefined();db.close();
  vi.mocked(invoke).mockResolvedValueOnce(response({mime:'text/html',base64:'PGh0bWw+'}));expect(await loadCoverImage(url('html'),true,wifi)).toBeUndefined();
  vi.mocked(invoke).mockResolvedValueOnce(response({mime:'image/png',base64:'A'.repeat(5600000)}));await expect(loadCoverImage(url('large'),true,wifi)).rejects.toThrow('4 MiB');
});
it('preserves unrestricted browser display but blocks missing types even when effectiveType claims fast internet',async()=>{
  native.enabled=false;vi.stubGlobal('navigator',{userAgent:'browser',onLine:true,connection:{effectiveType:'4g'}});
  expect(await loadCoverImage(url('web'),true,other)).toBeUndefined();expect(await loadCoverImage(url('web'),true,wifi)).toBeUndefined();
  expect(await loadCoverImage(url('web'),false,null)).toBe(url('web'));
  vi.stubGlobal('navigator',{userAgent:'browser',onLine:true,connection:{type:'wifi'}});expect(await loadCoverImage(url('web'),true,wifi)).toBe(url('web'));expect(invoke).not.toHaveBeenCalled();
});
it('discards stale connectivity responses after network events, resume and unmount',async()=>{
  agent();let resolveFirst!:(v:any)=>void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise(resolve=>{resolveFirst=resolve;})).mockResolvedValue(response(other));
  const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
  function Probe(){return createElement('output',null,JSON.stringify(useCoverConnection(true)));}
  try{
    await act(async()=>root.render(createElement(Probe)));
    await act(async()=>window.dispatchEvent(new Event('legado-network-change')));expect(host.textContent).toBe(JSON.stringify(other));
    await act(async()=>resolveFirst(response(wifi)));expect(host.textContent).toBe(JSON.stringify(other));
    vi.mocked(invoke).mockResolvedValueOnce(response(wifi));await act(async()=>window.dispatchEvent(new Event('focus')));expect(host.textContent).toBe(JSON.stringify(wifi));
  }finally{await act(async()=>root.unmount());host.remove();}
  const count=vi.mocked(invoke).mock.calls.length;window.dispatchEvent(new Event('legado-network-change'));expect(invoke).toHaveBeenCalledTimes(count);
});
it('removes a restricted image immediately on network loss, retains local covers and leaves explicit detail access unrestricted',async()=>{
  agent();vi.mocked(invoke).mockResolvedValue(response(png));
  const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
  function Image({address,restricted=true}:{address:string;restricted?:boolean}){const image=useCoverImage(address,restricted);return createElement('img',{src:image});}
  const show=async(connection:typeof wifi|null,address:string,restricted=true)=>act(async()=>root.render(createElement(CoverNetworkContext.Provider,{value:{onlyWifi:true,connection}},createElement(Image,{address,restricted}))));
  try{
    await show(wifi,url('changing'));await act(async()=>{await new Promise(r=>setTimeout(r,30));});expect(host.querySelector('img')!.src).toBe(data);
    await show(other,url('uncached'));expect(host.querySelector('img')!.getAttribute('src')).toBeNull();expect(invoke).toHaveBeenCalledTimes(1);
    await show(null,data);expect(host.querySelector('img')!.src).toBe(data);
    await show(other,url('explicit'),false);expect(host.querySelector('img')!.src).toBe(url('explicit'));expect(invoke).toHaveBeenCalledTimes(1);
  }finally{await act(async()=>root.unmount());host.remove();}
});
