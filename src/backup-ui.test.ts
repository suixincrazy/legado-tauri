import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {BackupSettings,BackupPage} from './BackupSettings';
import {defaultBackupConfig} from './backup';
import * as storage from './storage';
import {strToU8} from 'fflate';
import {newBook} from './model';
import {pickLegacyBackupFiles} from './backup-transport';
vi.mock('./backup-transport',async original=>({...await original<any>(),pickLegacyBackupFiles:vi.fn()}));
const service=vi.hoisted(()=>({download:vi.fn(),connect:vi.fn(),list:vi.fn(),remove:vi.fn()}));
vi.mock('./webdav',()=>({WebDav:class{connect=service.connect;list=service.list;download=service.download;remove=service.remove;}}));
it('persists WebDAV fields and restores only after preview confirmation, retaining a rollback backup',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  await storage.put('settings','backupConfig',{...defaultBackupConfig,deviceName:'test',username:'fixture',password:'fixture-password'});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),notify=vi.fn(),refresh=vi.fn(async()=>{});
  const wait=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  const click=async(text:string)=>{await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent?.trim()===text)!.click();});await wait();};
  try{
    await act(async()=>root.render(createElement(BackupSettings,{notify,refresh})));await wait();
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent?.startsWith('服务器地址'))!.click());
    await act(async()=>{const input=host.querySelector('input[aria-label="服务器地址"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'https://fixture.example.test/dav/');input.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await wait();
    expect((await storage.preference<any>('backupConfig',{})).url).toBe('https://fixture.example.test/dav/');
    await click('检查 WebDAV 连接');expect(service.connect).toHaveBeenCalledOnce();expect(notify).toHaveBeenCalledWith('WebDAV 连接成功');
    const book={...newBook('UI restore fixture','txt',[{title:'章',content:'正文'}]),id:'ui-restore-fixture'};
    const data={format:'legado-tauri',version:1,books:[book],sources:[],records:[],feeds:[],settings:{},managerPreferences:{}};
    service.list.mockResolvedValue([{name:'backup-fixture.zip',size:1000,modified:Date.now()}]);service.download.mockResolvedValue(strToU8(JSON.stringify(data)));
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent?.startsWith('恢复优先'))!.click());await wait();
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent?.startsWith('backup-fixture.zip'))!.click());await wait();
    expect(host.textContent).toContain('1 本书');expect((await storage.all<any>('books')).some(row=>row.id===book.id)).toBe(false);
    await click('恢复');await act(async()=>{await vi.waitFor(()=>expect(refresh).toHaveBeenCalledOnce());});expect((await storage.all<any>('books')).some(row=>row.id===book.id)).toBe(true);
    expect((await storage.all<any>('backups')).some(row=>row.name.startsWith('backup-before-restore-'))).toBe(true);
  }finally{await act(async()=>root.unmount());host.remove();delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
});
it('opens official backup help and old folder preview, preserves data on cancel, then imports only after confirmation',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),notify=vi.fn(),refresh=vi.fn(async()=>{});
  const wait=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  const click=async(text:string)=>{await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent?.trim()===text)!.click());await wait();};
  try{
    vi.mocked(pickLegacyBackupFiles).mockResolvedValue({'myBookShelf.json':strToU8('[{"noteUrl":"https://old-ui.example.test/book","bookInfoBean":{"name":"Old UI fixture"}}]')});
    await act(async()=>root.render(createElement(BackupPage,{close:vi.fn(),notify,refresh})));await wait();
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="备份帮助"]')!.click());expect(host.textContent).toContain('坚果云配置步骤');
    await act(async()=>host.querySelector<HTMLElement>('[aria-label="备份与恢复帮助"]')!.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());
    const menu=async()=>{await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="备份菜单"]')!.click());await click('导入旧版数据');await click('选择旧版目录');};
    await menu();expect(host.textContent).toContain('阅读 2.x');expect((await storage.all<any>('books')).some(book=>book.name==='Old UI fixture')).toBe(false);
    await click('取消');expect(refresh).not.toHaveBeenCalled();
    await act(async()=>host.querySelector<HTMLElement>('[aria-label="导入旧版数据"]')!.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());
    await menu();await click('恢复');await act(async()=>{await vi.waitFor(()=>expect(refresh).toHaveBeenCalledOnce());});
    expect((await storage.all<any>('books')).some(book=>book.name==='Old UI fixture')).toBe(true);
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="备份菜单"]')!.click());await click('日志');expect(host.textContent).toContain('读取旧版备份目录');
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="清空备份日志"]')!.click());await click('取消');expect(host.textContent).toContain('读取旧版备份目录');
  }finally{await act(async()=>root.unmount());host.remove();delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
});
