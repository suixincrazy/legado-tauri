import 'fake-indexeddb/auto';
import {webcrypto} from 'node:crypto';
import {beforeAll,expect,it,vi} from 'vitest';
import {zipSync,unzipSync,strToU8} from 'fflate';
import {createBackupArchive,readBackupArchive,defaultContent,selectBackup} from './backup-archive';
import {inspectBackup,restoreBackup,defaultBackupConfig} from './backup';
import {newBook} from './model';
import * as storage from './storage';
beforeAll(()=>vi.stubGlobal('crypto',webcrypto));

it('encrypts the complete archive including login state, rejects wrong passwords, and restores all selected data',async()=>{
  const source={bookSourceName:'Archive fixture',bookSourceUrl:'https://archive.example.test',customField:{kept:true}};
  const book={...newBook('Archive fixture','txt',[{title:'章一',content:'正文𠮷'},{title:'章二',content:'第二章'}]),rawText:'原文',chapter:1,offset:.75,bookmarks:[{chapter:1,offset:.75,title:'章二',created:1}]};
  await storage.put('books',book.id,book);await storage.saveSources([source]);
  await storage.saveSourceState(source.bookSourceUrl,{'cookie:example.test':{value:'cookie-fixture'},'source:loginInfo':{value:'login-fixture'}});
  await storage.put('settings','futurePreference',{arbitrary:true});
  const bytes=await createBackupArchive({...defaultContent,cookies:true,sourceState:true},'fixture-password');
  expect(new TextDecoder().decode(bytes)).not.toContain('login-fixture');
  await expect(readBackupArchive(bytes,'wrong')).rejects.toThrow('密码');
  const data=await readBackupArchive(bytes,'fixture-password');expect(data.books.find((row:BookLike)=>row.id===book.id)).toEqual(book);
  await storage.remove('books',book.id);await storage.restore(JSON.stringify(data));
  expect((await storage.all<any>('books')).find(row=>row.id===book.id)).toEqual(book);
  expect(await storage.sourceState(source.bookSourceUrl)).toEqual({'cookie:example.test':{value:'cookie-fixture'},'source:loginInfo':{value:'login-fixture'}});
  expect(data.managerPreferences.futurePreference).toEqual({arbitrary:true});
});
type BookLike={id:string};
it('encrypts the pre-restore snapshot with the entered key and keeps full local data recoverable',async()=>{
  const source='https://snapshot.example.test';
  await storage.put('settings','backupPassword','');
  await storage.put('settings','backupConfig',{...defaultBackupConfig,deviceName:'test',password:'dav-fixture-secret'});
  await storage.saveSourceState(source,{'cookie:snapshot.example.test':{value:'snapshot-cookie'},'source:loginInfo':{value:'snapshot-login'}});
  const original=JSON.parse(await storage.backup()),prior=new Set((await storage.all<any>('backups')).map(row=>row.name));
  await restoreBackup({format:'legado-tauri',version:1,books:[],sources:[],records:[],feeds:[],settings:{},managerPreferences:{}},{...defaultBackupConfig,deviceName:'test'},'entered-fixture-key');
  const snapshot=(await storage.all<any>('backups')).find(row=>!prior.has(row.name));
  expect(Object.keys(unzipSync(snapshot.bytes))).toEqual(['legado-encrypted.json']);
  await expect(readBackupArchive(snapshot.bytes,'wrong-fixture-key')).rejects.toThrow('密码');
  const decoded=await readBackupArchive(snapshot.bytes,'entered-fixture-key');
  expect(decoded.books).toEqual(original.books);expect(decoded.sourceState[source]).toEqual(original.sourceState[source]);
  expect(decoded.managerPreferences.backupConfig.password).toBe('dav-fixture-secret');
  expect(decoded.managerPreferences.backupPassword).toBeUndefined();
});
it('excludes credentials and login state from an unencrypted rollback snapshot',async()=>{
  await storage.put('settings','backupPassword','');
  const prior=new Set((await storage.all<any>('backups')).map(row=>row.name));
  await restoreBackup({format:'legado-tauri',version:1,books:[],sources:[],records:[],feeds:[],settings:{},managerPreferences:{}},{...defaultBackupConfig,deviceName:'test'});
  const snapshot=(await storage.all<any>('backups')).find(row=>!prior.has(row.name)),data=await readBackupArchive(snapshot.bytes);
  expect(data.managerPreferences.backupConfig.password).toBe('');
  expect(Object.values(data.sourceState).every(state=>Object.keys(state as object).length===0)).toBe(true);
  const original=JSON.parse(await storage.backup());expect(data.books).toEqual(original.books);
});
it('omitted categories and restore exclusions preserve current annotations, settings, cookies, and local books',async()=>{
  const book={...newBook('Selective fixture','txt',[{title:'章',content:'正文'}]),bookmarks:[{chapter:0,offset:.4,title:'章',created:2}]};
  await storage.put('books',book.id,book);await storage.put('settings','reader',{fontSize:27,lineHeight:1.8});
  const original=JSON.parse(await storage.backup()),selected=selectBackup(original,{...defaultContent,annotations:false,settings:false,cookies:false,sourceState:false});
  selected.books.find((row:BookLike)=>row.id===book.id).name='Restored title';
  await storage.restore(JSON.stringify(selected));
  expect((await storage.all<any>('books')).find(row=>row.id===book.id).bookmarks).toEqual(book.bookmarks);expect((await storage.settings()).fontSize).toBe(27);
  original.settings.fontSize=14;original.books.find((row:BookLike)=>row.id===book.id).name='Should ignore';await storage.restore(JSON.stringify(original),['reader','localBooks']);
  expect((await storage.all<any>('books')).find(row=>row.id===book.id).name).toBe('Restored title');expect((await storage.settings()).fontSize).toBe(27);
  await expect(createBackupArchive({...defaultContent,cookies:true})).rejects.toThrow('密码');
});
it('imports official ZIP files, preserves unknown entries, and saves a full pre-restore snapshot',async()=>{
  const zip=zipSync({
    'bookshelf.json':strToU8(JSON.stringify([{bookUrl:'https://legacy.example.test/book',origin:'https://legacy.example.test',name:'Legacy fixture',author:'Author',durChapterIndex:17,durChapterPos:333,type:0,group:1}])),
    'bookSource.json':strToU8(JSON.stringify([{bookSourceUrl:'https://legacy.example.test',bookSourceName:'Legacy source',ruleSearch:{name:'.title'},unknownField:123}])),
    'bookGroup.json':strToU8('[{"groupId":1,"groupName":"Fixture group"}]'),
    'config.xml':strToU8('<map><int name="readStyleSelect" value="0"/><boolean name="doubleHorizontalPage" value="false"/></map>'),
    'readConfig.json':strToU8('[{"textSize":24,"paragraphIndent":"　","titleMode":2}]'),
    'httpTTS.json':strToU8('[{"name":"Unimplemented preserved"}]'),
    'custom/unknown.bin':new Uint8Array([0,128,255]),
  });
  const preview=await inspectBackup(zip,'');expect(preview.legacy).toBe(true);expect(preview.data.books[0].legacyPosition).toEqual({chapter:17,position:333,indent:1,titleVisible:false});expect(preview.data.sources[0].unknownField).toBe(123);
  await restoreBackup(preview.data,{...defaultBackupConfig,deviceName:'test'});
  expect((await storage.all<any>('backups')).some(entry=>entry.name.startsWith('backup-before-restore-'))).toBe(true);
  const exported=await readBackupArchive(await createBackupArchive(),'');expect(exported.managerPreferences.legacyBackupFiles['custom/unknown.bin']).toBe('AID/');
  expect((await storage.settings()).fontSize).toBe(24);
});
it('rejects corrupt input before any library writes',async()=>{
  const before=await storage.backup();
  const damaged=JSON.parse(before);damaged.books.push({id:'broken',name:'broken',chapters:[],bookmarks:[],chapter:-1,offset:0});
  await expect(inspectBackup(strToU8(JSON.stringify(damaged)), '')).rejects.toThrow('损坏');
  expect(JSON.parse(await storage.backup()).books).toEqual(JSON.parse(before).books);
});
it('restores upstream sync choices even without a WebDAV account while retaining local directory and scheduling ownership',async()=>{
  const files={'bookshelf.json':strToU8('[]'),'config.xml':strToU8('<map><boolean name="syncBookProgress" value="false"/><boolean name="syncBookProgressPlus" value="true"/><boolean name="webDavBookAutoUpload" value="true"/><boolean name="webDavBookAutoRestore" value="true"/><boolean name="onlyLatestBackup" value="false"/><boolean name="autoCheckNewBackup" value="false"/><boolean name="autoBackupWebDav" value="true"/><boolean name="autoBackup" value="true"/><int name="autoBackupIntervalDays" value="4"/><string name="backupUri">content://fixture/folder</string><string name="webDavDeviceName">Fixture device</string></map>')};
  const preview=await inspectBackup(zipSync(files),'');
  expect(preview.data.managerPreferences.backupConfig).toEqual({syncProgress:false,syncProgressPlus:true,bookAutoUpload:true,bookAutoRestore:true,onlyLatest:false,checkNew:false,autoWebDav:true,autoDays:4});
  await storage.put('settings','backupConfig',{...defaultBackupConfig,deviceName:'Current fixture',localDirectory:'content://current/folder',autoEnabled:false});
  await storage.restore(JSON.stringify(preview.data));
  expect(await storage.preference('backupConfig',{})).toMatchObject({deviceName:'Current fixture',localDirectory:'content://current/folder',autoEnabled:false,syncProgress:false,bookAutoUpload:true});
});
