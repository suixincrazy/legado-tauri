import {isTauri} from '@tauri-apps/api/core';
import {strToU8,zipSync} from 'fflate';
import * as storage from './storage';
import {createBackupArchive,readBackupArchive,defaultContent,type BackupContent} from './backup-archive';
import {saveLocalBackup,listLocalBackups,loadLocalBackup,deleteLocalBackup,type BackupEntry} from './backup-transport';
import {WebDav,type DavConfig} from './webdav';
import type {Book} from './model';

export type BackupConfig=DavConfig&{deviceName:string;localDirectory:string;content:BackupContent;ignore:string[];onlyLatest:boolean;autoEnabled:boolean;autoWebDav:boolean;autoDays:number;checkNew:boolean;syncProgress:boolean;syncProgressPlus:boolean;bookAutoUpload:boolean;bookAutoRestore:boolean};
export const defaultBackupConfig:BackupConfig={url:'https://dav.jianguoyun.com/dav/',username:'',password:'',directory:'legado',deviceName:'',keepCount:0,localDirectory:'',content:defaultContent,ignore:[],onlyLatest:true,autoEnabled:false,autoWebDav:false,autoDays:1,checkNew:true,syncProgress:true,syncProgressPlus:false,bookAutoUpload:false,bookAutoRestore:false};
export type BackupRuntime={lastBackup?:number;lastRemote?:number;lastCheck?:number;noticedRemote?:number;lastError?:string;lastRestore?:number;lastAutoAttempt?:number;autoFailure?:string};
let busy=false;
export async function backupConfig():Promise<BackupConfig> {
  let saved=await storage.preference<Partial<BackupConfig>|null>('backupConfig',null);
  if(!saved){
    const migration=await storage.preference<any>('legacyMigration',{}),all=migration.preferences||{};
    const original=all['com.legado.app.release_preferences.xml']||all;
    saved=original.web_dav_account?{url:original.web_dav_url||defaultBackupConfig.url,username:original.web_dav_account,password:original.web_dav_password||'',directory:original.webDavDir||'legado',keepCount:Number(original.webDavBackupKeepCount)||0}:{};
  }
  const result={...defaultBackupConfig,...saved,content:{...defaultContent,...saved.content}};
  if(!result.deviceName){result.deviceName=(typeof navigator!=='undefined'&&/iPad|Macintosh/.test(navigator.userAgent)?'iPad':typeof navigator!=='undefined'&&/Android/.test(navigator.userAgent)?'Android':'Reader')+'-'+crypto.getRandomValues(new Uint32Array(1))[0].toString(16);await storage.put('settings','backupConfig',result);}
  return result;
}
export function validateBackupConfig(config:BackupConfig) {
  if(!Number.isInteger(config.keepCount)||config.keepCount<0)throw new Error('备份保留数量必须是 0 或正整数');
  if(!Number.isInteger(config.autoDays)||config.autoDays<1)throw new Error('备份间隔至少为 1 天');
  if(!config.deviceName.trim()||/[\\/:*?"<>|]/.test(config.deviceName)||config.deviceName.length>80)throw new Error('设备名称不能为空或包含文件名特殊字符');
}
async function locked<T>(action:()=>Promise<T>) {
  if(busy)throw new Error('已有备份或恢复任务正在进行');busy=true;
  try{return await action();}finally{busy=false;}
}
export function backupName(config:BackupConfig,date=new Date()) {
  const day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  return `backup${day}-${config.deviceName}.zip`;
}
export async function performBackup(config:BackupConfig,remote:boolean,password:string) {
  return locked(async()=>{
    validateBackupConfig(config);
    const bytes=await createBackupArchive(config.content,password),name=backupName(config);
    await saveLocalBackup(config.localDirectory,config.onlyLatest?'backup.zip':name,bytes);
    const runtime=await storage.preference<BackupRuntime>('backupRuntime',{});runtime.lastBackup=Date.now();
    await storage.put('settings','backupRuntime',runtime);
    let warnings:string[]=[];
    if(remote)try{warnings=await new WebDav(config).upload(name,bytes);runtime.lastRemote=Date.now();}catch(error){runtime.lastError=error instanceof Error?error.message:String(error);await storage.put('settings','backupRuntime',runtime);throw new Error(`本地备份已保存；${runtime.lastError}`);}
    runtime.lastError='';await storage.put('settings','backupRuntime',runtime);
    return {name,bytes,warnings};
  });
}
export async function inspectBackup(bytes:Uint8Array,password:string) {
  const data=await readBackupArchive(bytes,password);storage.validateBackup(data);
  return {data,summary:`${data.books.length} 本书 · ${data.sources.length} 个书源 · ${data.records.length} 条阅读记录`,legacy:!!data.legacyArchive};
}
export async function restoreBackup(data:any,config:BackupConfig) {
  return locked(async()=>{
    storage.validateBackup(data);
    const original=await storage.backup();
    await saveLocalBackup(config.localDirectory,`backup-before-restore-${Date.now()}.zip`,zipSync({'legado-tauri.json':strToU8(original)},{level:6}));
    if(data.legacyArchive){
      const oldBooks=new Map((await storage.all<Book>('books')).map(book=>[book.url||book.id,book]));
      data.books=data.books.map((book:any)=>{
        const old=oldBooks.get(book.url);if(!old)return book;
        return {...old,...book,id:old.id,chapters:old.chapters,rawText:old.rawText,chapter:Math.min(book.legacyPosition.chapter,Math.max(0,old.chapters.length-1))};
      });
    }
    await storage.restore(JSON.stringify(data),config.ignore);
    await storage.put('settings','backupRuntime',{...await storage.preference<BackupRuntime>('backupRuntime',{}),lastRestore:Date.now()});
  });
}
export async function automaticBackupTick(notify:(message:string)=>void,offerRestore:(entry:BackupEntry)=>void) {
  if(busy||document.hidden)return;
  const config=await backupConfig(),runtime=await storage.preference<BackupRuntime>('backupRuntime',{}),now=Date.now();
  if(config.autoEnabled&&now-(runtime.lastBackup||0)>=config.autoDays*86400000&&now-(runtime.lastAutoAttempt||0)>3600000){
    await storage.put('settings','backupRuntime',{...runtime,lastAutoAttempt:now});
    try{await performBackup(config,config.autoWebDav,await storage.preference('backupPassword',''));notify('自动备份完成');}
    catch(error){const message=error instanceof Error?error.message:String(error);const current=await storage.preference<BackupRuntime>('backupRuntime',{});await storage.put('settings','backupRuntime',{...current,autoFailure:message});notify(`自动备份失败：${message}`);}
    return;
  }
  if(config.checkNew&&config.username&&config.password&&now-(runtime.lastCheck||0)>3600000){
    await storage.put('settings','backupRuntime',{...runtime,lastCheck:now});
    try{const latest=(await new WebDav(config).list())[0];if(latest&&latest.modified>Math.max(runtime.lastRemote||0,runtime.noticedRemote||0,runtime.lastRestore||0)){await storage.put('settings','backupRuntime',{...runtime,lastCheck:now,noticedRemote:latest.modified});offerRestore(latest);}}
    catch(error){await storage.put('settings','backupRuntime',{...runtime,lastCheck:now,lastError:error instanceof Error?error.message:String(error)});}
  }
}
export {listLocalBackups,loadLocalBackup,deleteLocalBackup,isTauri};
