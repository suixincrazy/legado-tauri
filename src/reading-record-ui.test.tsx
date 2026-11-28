import 'fake-indexeddb/auto';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {ReadingRecords} from './ReadingRecords';
import {CoverNetworkContext,loadCoverImage} from './cover-network';
import {DEFAULT_SETTINGS,newBook,type ReadingRecord,type Settings} from './model';

vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:vi.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const png='iVBORw0KGgoAAAANSUhEUgAAABgAAAAgCAIAAACHPC9vAAAANElEQVR4nGNUrtjHQA3ARBVTGEYNIgaMBjZhMBpGhMFoGBEGo2FEGIyGEWEwGkaEweALIwB2tgGZup0EOgAAAABJRU5ErkJggg==';
const local='data:image/png;base64,'+png,snapshot='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',wifi={wifi:true,online:true},other={wifi:false,online:true};
const books=[{...newBook('Public','txt',[{title:'Current',content:'Keep'}],'Author'),id:'public',cover:'https://record.test/current.png'}];
const record:ReadingRecord={id:'rec',bookId:'public',bookName:'Public',author:'Author',cover:snapshot,chapter:'Saved',seconds:90,started:10};
afterEach(()=>{vi.resetAllMocks();vi.unstubAllGlobals();});
async function fixture(){
  vi.stubGlobal('navigator',{userAgent:'Android'});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),save=vi.fn();
  const show=(prefs:Partial<Settings>,rows=[record],connection:typeof wifi|null=other)=>act(async()=>root.render(<CoverNetworkContext.Provider value={{onlyWifi:true,connection}}><ReadingRecords records={rows} books={books} prefs={{...DEFAULT_SETTINGS,...prefs}} save={save} close={()=>{}}/></CoverNetworkContext.Provider>));
  const done=async()=>{await act(async()=>root.unmount());host.remove();};
  const image=()=>host.querySelector<HTMLImageElement>('article img');
  const settled=()=>act(async()=>{await new Promise(r=>setTimeout(r,20));});
  return {host,root,save,show,done,image,settled};
}
it('defaults to simple layout with zero image requests and changes only the saved preference',async()=>{
  const f=await fixture();const before=structuredClone(record);
  try{
    await f.show({});expect(f.host.querySelectorAll('.record-cover')).toHaveLength(0);expect(invoke).not.toHaveBeenCalled();
    await act(async()=>f.host.querySelector<HTMLButtonElement>('[aria-label="阅读记录菜单"]')!.click());
    const button=f.host.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;expect(button.getAttribute('aria-checked')).toBe('true');
    await act(async()=>button.click());expect(f.save).toHaveBeenCalledWith({...DEFAULT_SETTINGS,readRecordSimpleLayout:false});
    expect(record).toEqual(before);expect(f.host.textContent).toContain('1 分钟');
  }finally{await f.done();}
});
it('falls back from blocked shelf cover to local snapshot and then the imported default on image error',async()=>{
  const f=await fixture();
  try{
    await f.show({readRecordSimpleLayout:false,readRecordCover:local});await f.settled();
    expect(f.image()?.src).toBe(snapshot);expect(invoke).not.toHaveBeenCalled();
    await act(async()=>f.image()!.dispatchEvent(new Event('error')));await f.settled();
    expect(f.image()?.src).toBe(local);expect(f.host.querySelector('article')!.textContent).toContain('Current');expect(invoke).not.toHaveBeenCalled();
    await f.show({readRecordSimpleLayout:true});expect(f.host.querySelectorAll('.record-cover')).toHaveLength(0);
  }finally{await f.done();}
});
it('uses native cache offline and retries the current row on WiFi without changing duration or records',async()=>{
  vi.stubGlobal('navigator',{userAgent:'Android'});
  vi.mocked(invoke).mockResolvedValue({json:JSON.stringify({value:{mime:'image/png',base64:png}})});
  await loadCoverImage('https://record.test/cached.png',true,wifi);vi.mocked(invoke).mockClear();
  const f=await fixture(),rec={...record,bookId:'removed',bookName:'Removed',cover:'https://record.test/cached.png'},before=structuredClone(rec);
  try{
    await f.show({readRecordSimpleLayout:false},[rec]);await f.settled();expect(f.image()?.src).toBe(local);expect(invoke).not.toHaveBeenCalled();
    await f.show({readRecordSimpleLayout:false},[{...rec,cover:'https://record.test/new.png'}]);await f.settled();expect(f.image()).toBeNull();expect(invoke).not.toHaveBeenCalled();
    await f.show({readRecordSimpleLayout:false},[{...rec,cover:'https://record.test/new.png'}],wifi);await f.settled();expect(f.image()?.src).toBe(local);expect(invoke).toHaveBeenCalledTimes(1);
    expect(f.host.textContent).toContain('1 分钟');expect(rec).toEqual(before);
  }finally{await f.done();}
});
it('continues to snapshot after a native download error and selects the night fallback without premature parallel downloads',async()=>{
  const f=await fixture();vi.mocked(invoke).mockRejectedValue(new Error('not found'));
  try{
    await f.show({readRecordSimpleLayout:false,readRecordCover:local,readRecordCoverDark:snapshot,dark:true},[{...record,cover:''}],wifi);await f.settled();
    expect(f.image()?.src).toBe(snapshot);
    expect(vi.mocked(invoke).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(invoke).mock.calls.every(([,args]:any)=>JSON.parse(args.payload).url===books[0].cover)).toBe(true);
    await f.show({readRecordSimpleLayout:false},[{...record,bookId:'gone',bookName:'Gone',cover:'file:///outside.png'}],other);await f.settled();expect(f.image()).toBeNull();
  }finally{await f.done();}
});
