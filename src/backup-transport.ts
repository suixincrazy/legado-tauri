import {invoke,isTauri} from '@tauri-apps/api/core';
import {createId} from './model';
import * as storage from './storage';
import {legacyBackupNames} from './legacy-backup';

type NativeReply={status:number;body:string;size:number};
const native=(request:Record<string,unknown>)=>invoke<NativeReply>('backup_transfer',{request});
const CHUNK=256*1024;
export function checkBackupCancelled(signal?:AbortSignal) {if(signal?.aborted)throw new DOMException('操作已取消','AbortError');}
export async function stageBackup(bytes:Uint8Array,id:string,signal?:AbortSignal) {
  for(let offset=0;offset<Math.max(1,bytes.length);offset+=CHUNK){
    checkBackupCancelled(signal);
    const hex=Array.from(bytes.subarray(offset,offset+CHUNK),byte=>byte.toString(16).padStart(2,'0')).join('');
    await native({operation:'write',id,offset,hex});
  }
}
export async function readStagedBackup(id:string,size:number,signal?:AbortSignal) {
  if(size>512*1024*1024)throw new Error('备份超过 512 MB');
  const bytes=new Uint8Array(size);
  for(let offset=0;offset<size;){
    checkBackupCancelled(signal);
    const reply=await native({operation:'read',id,offset});
    checkBackupCancelled(signal);
    if(!reply.body||reply.body.length%2||!/^[\da-f]+$/i.test(reply.body))throw new Error('备份传输不完整');
    const chunk=Uint8Array.from(reply.body.match(/../g)!,value=>parseInt(value,16));
    if(offset+chunk.length>size)throw new Error('备份长度不一致');
    bytes.set(chunk,offset);offset+=chunk.length;
  }
  return bytes;
}
export type DavRequest={url:string;method:string;headers:Record<string,string>;body?:string|Uint8Array;signal?:AbortSignal};
export type DavResponse={status:number;text:string;bytes?:Uint8Array};
export async function davRequest(request:DavRequest):Promise<DavResponse> {
  const {signal,...payload}=request;checkBackupCancelled(signal);
  if(isTauri()){
    const id=createId();let cancel:Promise<unknown>|undefined;
    const abort=()=>{cancel=native({operation:'requestCancel',id}).catch(()=>{});};
    try{
      if(signal){await native({operation:'requestPrepare',id});signal.addEventListener('abort',abort,{once:true});checkBackupCancelled(signal);}
      if(request.body instanceof Uint8Array)await stageBackup(request.body,id,signal);
      checkBackupCancelled(signal);
      const response=await native({operation:'request',id,...payload,body:typeof request.body==='string'?request.body:undefined});
      checkBackupCancelled(signal);
      return {status:response.status,text:response.body,bytes:request.method==='GET'&&response.status>=200&&response.status<300?await readStagedBackup(id,response.size,signal):undefined};
    }catch(error){checkBackupCancelled(signal);throw error;}
    finally{signal?.removeEventListener('abort',abort);await cancel;await native({operation:'discard',id}).catch(()=>{});}
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),300000);
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  try{
    const response=await fetch(request.url,{method:request.method,headers:request.headers,body:request.body as BodyInit,signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'});
    if(request.method==='GET'&&response.ok){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>512*1024*1024)throw new Error('备份超过 512 MB');return{status:response.status,text:'',bytes};}
    return {status:response.status,text:await response.text()};
  }catch(error){checkBackupCancelled(signal);if(error instanceof TypeError)throw new Error('WebDAV 连接失败，请检查地址、网络和证书；浏览器测试还需要服务器允许跨域');throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export type BackupEntry={name:string;size:number;modified:number;url?:string};
export async function pickBackupDirectory():Promise<string|null> {
  if(!isTauri())return null;
  const android=/Android/i.test(navigator.userAgent);
  const reply=await invoke<{json:string}>(android?'java_bridge':'source_browser',android?{payload:JSON.stringify({operation:'backupDirectory',action:'pick'})}:{request:{mode:'backupDirectory',action:'pick'}});
  return JSON.parse(reply.json).value;
}
export async function pickLegacyBackupFiles():Promise<Record<string,Uint8Array>|null> {
  if(!isTauri())return new Promise(resolve=>{
    const input=document.createElement('input');input.type='file';input.multiple=true;input.setAttribute('webkitdirectory','');
    input.oncancel=()=>resolve(null);input.onchange=async()=>{
      const files=Array.from(input.files||[]),result:Record<string,Uint8Array>={};
      for(const file of files)if(legacyBackupNames.includes(file.name)&&file.webkitRelativePath.split('/').length<=2)result[file.name]=new Uint8Array(await file.arrayBuffer());
      resolve(result);
    };input.click();
  });
  const directory=await pickBackupDirectory();if(!directory)return null;
  const response=await native({operation:'legacyList',directory}),entries=JSON.parse(response.body).files as BackupEntry[],result:Record<string,Uint8Array>={};
  for(const entry of entries)if(legacyBackupNames.includes(entry.name))result[entry.name]=await loadLocalBackup(directory,entry.name);
  return result;
}
export async function listLocalBackups(directory:string):Promise<{directory:string;files:BackupEntry[]}> {
  if(isTauri())return JSON.parse((await native({operation:'localList',directory})).body);
  return {directory:'浏览器本地',files:(await storage.all<{name:string;bytes:Uint8Array;modified:number}>('backups')).map(item=>({name:item.name,size:item.bytes.length,modified:item.modified}))};
}
export async function saveLocalBackup(directory:string,name:string,bytes:Uint8Array) {
  if(!isTauri()){await storage.put('backups',name,{name,bytes,modified:Date.now()});return;}
  const id=createId();try{await stageBackup(bytes,id);await native({operation:'localSave',id,directory,name});}finally{await native({operation:'discard',id}).catch(()=>{});}
}
export async function loadLocalBackup(directory:string,name:string):Promise<Uint8Array> {
  if(!isTauri()){
    const entry=(await storage.all<{name:string;bytes:Uint8Array}>('backups')).find(item=>item.name===name);
    if(!entry)throw new Error('本地备份不存在');return entry.bytes;
  }
  const id=createId();try{const response=await native({operation:'localLoad',id,directory,name});return await readStagedBackup(id,response.size);}finally{await native({operation:'discard',id}).catch(()=>{});}
}
export async function deleteLocalBackup(directory:string,name:string) {
  if(!isTauri())return storage.remove('backups',name);
  await native({operation:'localDelete',directory,name});
}
