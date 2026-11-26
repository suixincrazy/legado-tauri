import 'fake-indexeddb/auto';
import {expect,it,vi} from 'vitest';
import {strToU8} from 'fflate';
import {newBook} from './model';
import * as storage from './storage';
import {defaultBackupConfig} from './backup';
import {newerBookProgress,applyBookProgress,bookProgress,uploadBookProgress,uploadLocalBook,downloadLocalBook} from './webdav-books';
import {toLegacyPosition} from './legacy-position';
const request=vi.hoisted(()=>vi.fn());
vi.mock('./backup-transport',async original=>({...await original<typeof import('./backup-transport')>(),davRequest:request}));
it('asks for newer cloud progress, retains Unicode character positions, and ignores older progress',async()=>{
  await storage.put('settings','backupConfig',{...defaultBackupConfig,username:'fixture',password:'fixture',deviceName:'test'});
  const book={...newBook('Progress fixture','online',[{title:'第一章',content:'正文'},{title:'第二章',content:'另一章'}]),lastRead:1000,offset:.3};
  let remote={name:book.name,author:book.author,durChapterIndex:1,durChapterPos:123,durChapterTime:2000,durChapterTitle:'第二章'};
  request.mockImplementation(async()=>({status:200,bytes:strToU8(JSON.stringify(remote))}));
  const next=await newerBookProgress(book);expect(next).toEqual(remote);expect(applyBookProgress(book,next!).legacyPosition?.position).toBe(123);
  remote={...remote,durChapterTime:500};expect(await newerBookProgress(book)).toBeNull();
  expect(bookProgress({...book,legacyPosition:{chapter:0,position:30,titleVisible:true,indent:2}}).tauriOffset).toBeUndefined();
  expect(toLegacyPosition(7,'第一章',[{start:4,text:'中文𠮷测试'},{start:11,text:'下一段'}],2,true)).toBe(9);
});
it('uploads the actual saved progress and only advances its sync marker after success',async()=>{
  request.mockClear();
  const book={...newBook('Upload progress','online',[{title:'第一章'}]),lastRead:3000,offset:.6,syncPosition:{chapter:0,position:20}};
  request.mockImplementation(async req=>req.method==='PROPFIND'?{status:207,text:'<multistatus xmlns="DAV:"/>'}:{status:201,text:''});
  await uploadBookProgress(book);expect(await storage.preference('webdavProgressSynced:'+book.id,0)).toBe(3000);
  const sent=request.mock.calls.find(([req])=>req.method==='PUT')![0];expect(JSON.parse(new TextDecoder().decode(sent.body))).toMatchObject({durChapterPos:20,tauriOffset:.6});
  request.mockImplementation(async()=>({status:401,text:''}));await expect(uploadBookProgress({...book,lastRead:4000})).rejects.toThrow('401');expect(await storage.preference('webdavProgressSynced:'+book.id,0)).toBe(3000);
});
it('keeps legacy progress filenames byte-compatible including leading and trailing spaces and URL reserved characters',async()=>{
  request.mockClear();await storage.put('settings','backupConfig',{...defaultBackupConfig,url:'https://dav.example.test/dav/',username:'fixture',password:'fixture',deviceName:'test',directory:'legado'});
  const book=newBook(' Leading / Title + %','online',[{title:'Chapter'}],'Author: ');
  request.mockImplementation(async req=>req.method==='PROPFIND'?{status:207,text:'<multistatus xmlns="DAV:"/>'}:{status:201,text:''});
  await uploadBookProgress(book);
  const req=request.mock.calls.find(([req])=>req.method==='PUT')![0];
  expect(decodeURIComponent(new URL(req.url).pathname.split('/').pop()!)).toBe(' Leading _ Title + %_Author_ .json');
});
it('compares the current chapter position and clears positions belonging to a different chapter',async()=>{
  await storage.put('settings','backupConfig',{...defaultBackupConfig,username:'fixture',password:'fixture',deviceName:'test'});
  const book={...newBook('Position fixture','online',[{title:'One'},{title:'Two'}]),chapter:1,lastRead:1000,syncPosition:{chapter:0,position:900}};
  const remote={name:book.name,author:book.author,durChapterIndex:1,durChapterPos:15,durChapterTime:2000,durChapterTitle:'Two'};
  request.mockImplementation(async()=>({status:200,bytes:strToU8(JSON.stringify(remote))}));
  expect(await newerBookProgress(book)).toEqual(remote);
  expect(applyBookProgress(book,remote).syncPosition).toEqual({chapter:1,position:15});
  const clamped=applyBookProgress(book,{...remote,durChapterIndex:20,durChapterPos:900,tauriOffset:.9});
  expect(clamped).toMatchObject({chapter:1,offset:0,syncPosition:{chapter:1,position:0}});
});
it('uploads and recovers exact local-book bytes and performs no request when synchronization is disabled',async()=>{
  request.mockClear();await storage.put('settings','backupConfig',{...defaultBackupConfig,url:'https://dav.example.test/dav/',username:'fixture',password:'fixture',deviceName:'test',bookAutoUpload:true,bookAutoRestore:true});
  const bytes=strToU8('正文𠮷\r\nChapter 1\nPublic fixture');
  request.mockImplementation(async req=>req.method==='PROPFIND'?{status:207,text:'<multistatus xmlns="DAV:"/>'}:req.method==='GET'?{status:200,bytes}:{status:201,text:''});
  await uploadLocalBook('原文 + %.txt',bytes);
  const book={...newBook('Saved title','txt',[]),localFileName:'原文 + %.txt'};
  expect(await downloadLocalBook(book)).toEqual({name:'原文 + %.txt',bytes});
  const upload=request.mock.calls.find(([req])=>req.method==='PUT')![0],download=request.mock.calls.find(([req])=>req.method==='GET')![0];
  expect(upload.body).toEqual(bytes);expect(download.url).toBe(upload.url);
  request.mockClear();await storage.put('settings','backupConfig',{...defaultBackupConfig,username:'fixture',password:'fixture',deviceName:'test',syncProgress:false});
  await uploadLocalBook('ignored.txt',bytes);expect(await downloadLocalBook(book)).toBeNull();await uploadBookProgress(book);expect(await newerBookProgress(book)).toBeNull();expect(request).not.toHaveBeenCalled();
});
