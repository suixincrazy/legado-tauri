import {backupConfig} from './backup';
import {WebDav} from './webdav';
import {strFromU8,strToU8} from 'fflate';
import type {Book} from './model';
import * as storage from './storage';

export type CloudProgress={name:string;author:string;durChapterIndex:number;durChapterPos:number;durChapterTime:number;durChapterTitle:string;tauriOffset?:number};
export const remoteBookName=(name:string)=>name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim()||'book';
const progressName=(book:Book)=>`${book.name}_${book.author}`.replace(/[\\/:*?"<>|]/g,'_')+'.json';
export function bookProgress(book:Book):CloudProgress {
  return {name:book.name,author:book.author,durChapterIndex:book.chapter,durChapterPos:book.legacyPosition?.position??(book.syncPosition?.chapter===book.chapter?book.syncPosition.position:0),durChapterTime:book.lastRead,durChapterTitle:book.chapters[book.chapter]?.title||'',tauriOffset:book.legacyPosition?undefined:book.offset};
}
export async function uploadBookProgress(book:Book) {
  const config=await backupConfig();if(!config.syncProgress||!config.username||!config.password)return;
  await new WebDav({...config,directory:[config.directory,'bookProgress'].filter(Boolean).join('/'),keepCount:0}).put(progressName(book),strToU8(JSON.stringify(bookProgress(book))),'application/json');
  await storage.put('settings','webdavProgressSynced:'+book.id,book.lastRead);
}
export async function newerBookProgress(book:Book,enhanced=false):Promise<CloudProgress|null> {
  const config=await backupConfig();if(!config.syncProgress||enhanced&&!config.syncProgressPlus||!config.username||!config.password)return null;
  let bytes:Uint8Array;
  try{bytes=await new WebDav({...config,directory:[config.directory,'bookProgress'].filter(Boolean).join('/')}).download(progressName(book));}catch(error){if(String(error).includes('404'))return null;throw error;}
  const value=JSON.parse(strFromU8(bytes)) as CloudProgress;
  if(value.name!==book.name||value.author!==book.author||!Number.isInteger(value.durChapterIndex)||value.durChapterIndex<0||!Number.isInteger(value.durChapterPos)||value.durChapterPos<0||!Number.isFinite(value.durChapterTime))throw new Error('云端阅读进度无效');
  if(value.tauriOffset!==undefined&&(!Number.isFinite(value.tauriOffset)||value.tauriOffset<0||value.tauriOffset>1))throw new Error('云端阅读进度无效');
  const synced=await storage.preference('webdavProgressSynced:'+book.id,0);
  const localPosition=book.legacyPosition?.chapter===book.chapter?book.legacyPosition.position:book.syncPosition?.chapter===book.chapter?book.syncPosition.position:0;
  const ahead=value.durChapterIndex>book.chapter||(value.durChapterIndex===book.chapter&&(value.tauriOffset!==undefined?value.tauriOffset>book.offset:value.durChapterPos>localPosition));
  return ahead&&value.durChapterTime>Math.max(synced,book.lastRead)?value:null;
}
export function applyBookProgress(book:Book,value:CloudProgress):Book {
  const chapter=Math.min(value.durChapterIndex,Math.max(0,book.chapters.length-1));
  const clamped=chapter!==value.durChapterIndex,position=clamped?0:value.durChapterPos;
  return {...book,chapter,offset:clamped?0:value.tauriOffset??0,lastRead:value.durChapterTime,syncPosition:{chapter,position},legacyPosition:value.tauriOffset!==undefined?undefined:{chapter,position,indent:2,titleVisible:true}};
}
export async function uploadLocalBook(name:string,bytes:Uint8Array) {
  const config=await backupConfig();if(!config.bookAutoUpload||!config.username||!config.password)return;
  await new WebDav({...config,directory:[config.directory,'books'].filter(Boolean).join('/'),keepCount:0}).put(remoteBookName(name),bytes);
}
export async function downloadLocalBook(book:Book):Promise<{name:string;bytes:Uint8Array}|null> {
  const config=await backupConfig();if(!config.bookAutoRestore||!config.username||!config.password)return null;
  const name=(book as any).localFileName||(book as any).legacy?.originName||book.name+(book.kind==='epub'?'.epub':'.txt');
  const bytes=await new WebDav({...config,directory:[config.directory,'books'].filter(Boolean).join('/')}).download(remoteBookName(name));
  return {name,bytes};
}
