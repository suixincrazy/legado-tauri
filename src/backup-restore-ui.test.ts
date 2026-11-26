import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {strToU8} from 'fflate';
import {BackupSettings} from './BackupSettings';
import {defaultBackupConfig} from './backup';
import * as storage from './storage';
import {newBook} from './model';

const mocks=vi.hoisted(()=>({list:vi.fn(),download:vi.fn(),pick:vi.fn()}));
vi.mock('./webdav',()=>({WebDav:class{list=mocks.list;download=mocks.download;}}));
vi.mock('./files',async original=>({...await original<any>(),pickFiles:mocks.pick}));
let host:HTMLDivElement,root:Root;
const notify=vi.fn(),refresh=vi.fn(async()=>{});
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===label)!;
const restoreButton=()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.startsWith('恢复优先'))!;
const click=async(node:HTMLElement)=>{expect(node).toBeTruthy();await act(async()=>node.click());await flush();};
const entries=[{name:'backup2.zip',size:100,modified:10},{name:'backup10.zip',size:100,modified:1}];
const backup=()=>strToU8(JSON.stringify({format:'legado-tauri',version:1,books:[{...newBook('Restore cancellation fixture','txt',[{title:'Test',content:'Public text'}]),id:'cancel-fixture'}],sources:[],records:[],feeds:[],settings:{},managerPreferences:{}}));
function deferred<T>() {let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function mount() {await act(async()=>root.render(createElement(BackupSettings,{notify,refresh})));await flush();}
beforeEach(async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();mocks.list.mockReset();mocks.download.mockReset();mocks.pick.mockReset();
  await storage.put('settings','backupConfig',{...defaultBackupConfig,deviceName:'test',url:'https://dav.example.test/',username:'fixture',password:'fixture-password'});
  await storage.put('settings','backupPassword','');host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{vi.useRealTimers();await act(async()=>root.unmount());host.remove();delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;});

it('loads cloud backups on click and sorts by natural filename instead of response date',async()=>{
  mocks.list.mockResolvedValue(entries);await mount();await click(restoreButton());
  expect(mocks.list).toHaveBeenCalledOnce();expect(mocks.pick).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="选择恢复文件"]')).not.toBeNull();
  expect([...host.querySelectorAll('.backup-file-row .setting-row span')].map(node=>node.firstChild?.textContent)).toEqual(['backup10.zip','backup2.zip']);
  expect(mocks.download).not.toHaveBeenCalled();
});
it.each(['empty','error','unconfigured'])('offers local fallback only after confirmation for %s cloud state',async(mode)=>{
  if(mode==='unconfigured')await storage.put('settings','backupConfig',{...defaultBackupConfig,deviceName:'test'});
  if(mode==='error')mocks.list.mockRejectedValue(new Error('Denied password=fixture-password https://private.example.test/file'));
  else mocks.list.mockResolvedValue([]);
  mocks.pick.mockResolvedValue([]);await mount();const before=await storage.backup();
  await click(restoreButton());expect(host.textContent).toContain('是否从本地备份恢复');expect(host.textContent).not.toContain('fixture-password');expect(host.textContent).not.toContain('private.example.test');
  expect(mocks.pick).not.toHaveBeenCalled();await click(button('取消'));expect(mocks.pick).not.toHaveBeenCalled();expect(host.querySelector('[aria-label="恢复"]')).toBeNull();
  await click(restoreButton());await click(button('从本地恢复'));expect(mocks.pick).toHaveBeenCalledOnce();expect(refresh).not.toHaveBeenCalled();
  expect(JSON.parse(await storage.backup()).books).toEqual(JSON.parse(before).books);
  if(mode==='unconfigured')expect(mocks.list).not.toHaveBeenCalled();
});
it('cancels a delayed listing, ignores its late result and accepts a fresh request',async()=>{
  const old=deferred<typeof entries>();mocks.list.mockReturnValueOnce(old.promise).mockResolvedValueOnce(entries);await mount();await click(restoreButton());
  const signal=mocks.list.mock.calls[0][0] as AbortSignal;await click(button('取消'));expect(signal.aborted).toBe(true);
  await click(restoreButton());expect(host.querySelector('[aria-label="选择恢复文件"]')).not.toBeNull();
  await act(async()=>old.resolve([{name:'backup-obsolete.zip',size:1,modified:99}]));await flush();
  expect(host.textContent).not.toContain('backup-obsolete.zip');expect(host.textContent).toContain('backup10.zip');expect(notify).not.toHaveBeenCalled();
});
it('cancels a download before preview without restoring or creating a rollback snapshot',async()=>{
  const pending=deferred<Uint8Array>();mocks.list.mockResolvedValue(entries);mocks.download.mockReturnValue(pending.promise);await mount();
  const before=await storage.all('backups'),books=await storage.all('books');await click(restoreButton());await click(host.querySelector('.backup-file-row .setting-row')!);
  const signal=mocks.download.mock.calls[0][1] as AbortSignal;await click(button('取消'));expect(signal.aborted).toBe(true);
  await act(async()=>pending.resolve(backup()));await flush();
  expect(host.querySelector('[aria-label="恢复备份"]')).toBeNull();expect(await storage.all('books')).toEqual(books);expect(await storage.all('backups')).toEqual(before);expect(refresh).not.toHaveBeenCalled();
});
it('aborts a pending request on page unmount and ignores late failure',async()=>{
  const pending=deferred<typeof entries>();mocks.list.mockReturnValue(pending.promise);await mount();await click(restoreButton());const signal=mocks.list.mock.calls[0][0] as AbortSignal;
  await act(async()=>root.render(null));expect(signal.aborted).toBe(true);await act(async()=>pending.reject(new Error('late error')));await flush();expect(notify).not.toHaveBeenCalled();
});
it('returns from cancelled preview to the cloud file list without restoring data',async()=>{
  mocks.list.mockResolvedValue(entries);mocks.download.mockResolvedValue(backup());await mount();await click(restoreButton());await click(host.querySelector('.backup-file-row .setting-row')!);
  expect(host.textContent).toContain('1 本书');await click(button('取消'));expect(host.querySelector('[aria-label="选择恢复文件"]')).not.toBeNull();expect(refresh).not.toHaveBeenCalled();
});
function pointer(node:HTMLElement,type:string,x:number,y:number) {const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,{button:0,clientX:x,clientY:y,pointerId:1});node.dispatchEvent(event);}
it('opens the local picker on long press and suppresses the release click',async()=>{
  mocks.pick.mockResolvedValue([]);await mount();vi.useFakeTimers();const node=restoreButton();
  await act(async()=>{pointer(node,'pointerdown',50,50);vi.advanceTimersByTime(550);});expect(mocks.pick).toHaveBeenCalledOnce();
  await act(async()=>{pointer(node,'pointerup',50,50);node.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));});expect(mocks.list).not.toHaveBeenCalled();
});
it('does not open either restore action when a long press becomes scrolling',async()=>{
  mocks.pick.mockResolvedValue([]);await mount();vi.useFakeTimers();const node=restoreButton();
  await act(async()=>{pointer(node,'pointerdown',50,50);pointer(node,'pointermove',50,90);vi.advanceTimersByTime(700);pointer(node,'pointercancel',50,90);node.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));});
  expect(mocks.list).not.toHaveBeenCalled();expect(mocks.pick).not.toHaveBeenCalled();
});
