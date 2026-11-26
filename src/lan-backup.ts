import {invoke,isTauri} from '@tauri-apps/api/core';
import {stageBackup,davRequest} from './backup-transport';
import {createBackupArchive,type BackupContent} from './backup-archive';
import {createId} from './model';

export type LanDescriptor={protocol:string;version:number;hosts:string[];port:number;token:string;key:string;iv:string;size:number;sha256:string;deviceName:string;expiresAt:number};
const hex=(bytes:Uint8Array)=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const unhex=(value:string)=>Uint8Array.from(value.match(/../g)!,byte=>parseInt(byte,16));
export function parseLanDescriptor(text:string):LanDescriptor {
  const value=JSON.parse(text)as LanDescriptor,now=Date.now();
  if(value.protocol!=='legado-lan-backup'||value.version!==1)throw new Error('不是阅读局域网备份二维码');
  const host=(ip:string)=>{const parts=ip.split('.').map(Number);return parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(parts[0]===10||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31);};
  if(!Array.isArray(value.hosts)||!value.hosts.length||value.hosts.length>8||!value.hosts.every(ip=>typeof ip==='string'&&host(ip)))throw new Error('无效的局域网地址');
  if(!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw new Error('无效的局域网端口');
  for(const [key,length]of [['token',32],['key',64],['iv',24],['sha256',64]]as const)if(typeof value[key]!=='string'||!new RegExp(`^[0-9a-f]{${length}}$`).test(value[key]))throw new Error('无效的传输密钥或摘要');
  if(!Number.isInteger(value.size)||value.size<17||value.size>32*1024*1024||!Number.isFinite(value.expiresAt)||value.expiresAt<now||value.expiresAt>now+600000||typeof value.deviceName!=='string'||value.deviceName.length>80)throw new Error('传输会话已过期或参数无效');
  return value;
}
export async function encryptLanArchive(bytes:Uint8Array,token:string,key:Uint8Array,iv:Uint8Array) {
  const secret=await crypto.subtle.importKey('raw',key as BufferSource,'AES-GCM',false,['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:iv as BufferSource,additionalData:new TextEncoder().encode('legado-lan-backup:1:'+token)},secret,bytes as BufferSource));
}
export async function decryptLanArchive(bytes:Uint8Array,descriptor:LanDescriptor) {
  if(bytes.length!==descriptor.size||hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)))!==descriptor.sha256)throw new Error('传输备份长度或校验值不一致');
  try{const key=await crypto.subtle.importKey('raw',unhex(descriptor.key) as BufferSource,'AES-GCM',false,['decrypt']);return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(descriptor.iv) as BufferSource,additionalData:new TextEncoder().encode('legado-lan-backup:1:'+descriptor.token)},key,bytes as BufferSource));}catch{throw new Error('局域网备份解密失败');}
}
export async function sendLanBackup(content:BackupContent,deviceName:string) {
  if(!isTauri())throw new Error('请在 Android 或 iOS 应用中发送局域网备份');
  const archive=await createBackupArchive({...content,cookies:false,sourceState:false},'',true);
  if(archive.length>32*1024*1024-16)throw new Error('局域网备份超过原版 32 MB 限制，请减少备份内容或使用 WebDAV');
  const token=hex(crypto.getRandomValues(new Uint8Array(16))),key=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12)),id=createId();
  const bytes=await encryptLanArchive(archive,token,key,iv);
  try{await stageBackup(bytes,id);const reply=await invoke<{body:string}>('backup_transfer',{request:{operation:'lanStart',id,token}});const connection=JSON.parse(reply.body);
    const descriptor:LanDescriptor={protocol:'legado-lan-backup',version:1,...connection,token,key:hex(key),iv:hex(iv),size:bytes.length,sha256:hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))),deviceName,expiresAt:Date.now()+300000};
    return {id,descriptor};
  }catch(error){await stopLanBackup(id);throw error;}
}
export async function stopLanBackup(id:string) {
  await invoke('backup_transfer',{request:{operation:'lanStop',id}});
  await invoke('backup_transfer',{request:{operation:'discard',id}}).catch(()=>{});
}
export async function receiveLanBackup(descriptor:LanDescriptor) {
  parseLanDescriptor(JSON.stringify(descriptor));
  for(const host of descriptor.hosts){try{
    const response=await davRequest({method:'GET',url:`http://${host}:${descriptor.port}/backup/${descriptor.token}`,headers:{'Accept-Encoding':'identity'}});
    if(response.status!==200||!response.bytes)continue;
    return await decryptLanArchive(response.bytes,descriptor);
  }catch(error){if(String(error).includes('校验')||String(error).includes('解密'))throw error;}}
  throw new Error('无法连接发送设备，请确认同一局域网且发送窗口仍打开');
}
