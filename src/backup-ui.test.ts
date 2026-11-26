import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {BackupSettings} from './BackupSettings';
import {defaultBackupConfig} from './backup';
import * as storage from './storage';
import {strToU8} from 'fflate';
import {newBook} from './model';
const service=vi.hoisted(()=>({download:vi.fn(),connect:vi.fn(),list:vi.fn(),remove:vi.fn()}));
vi.mock('./webdav',()=>({WebDav:class{connect=service.connect;list=service.list;download=service.download;remove=service.remove;}}));
it('persists WebDAV fields and restores only after preview confirmation, retaining a rollback backup',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  await storage.put('settings','backupConfig',{...defaultBackupConfig,deviceName:'test'});
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
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent?.startsWith('恢复备份'))!.click());await click('WebDAV 备份');
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent?.startsWith('backup-fixture.zip'))!.click());await wait();
    expect(host.textContent).toContain('1 本书');expect((await storage.all<any>('books')).some(row=>row.id===book.id)).toBe(false);
    await click('恢复');expect((await storage.all<any>('books')).some(row=>row.id===book.id)).toBe(true);expect(refresh).toHaveBeenCalledOnce();
    expect((await storage.all<any>('backups')).some(row=>row.name.startsWith('backup-before-restore-'))).toBe(true);
  }finally{await act(async()=>root.unmount());host.remove();delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
});
