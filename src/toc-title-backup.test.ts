import 'fake-indexeddb/auto';
import {afterEach,expect,it} from 'vitest';
import {strToU8,strFromU8,zipSync,unzipSync} from 'fflate';
import {newBook,DEFAULT_SETTINGS} from './model';
import * as storage from './storage';
import {bookUsesReplace} from './replacement-engine';
import {readBackupArchive,createBackupArchive,defaultContent} from './backup-archive';

afterEach(async()=>{for(const key of ['reader','contentSearchReplace','legacyBackupFiles','legacyMigration'])await storage.remove('settings',key);for(const b of await storage.all<any>('books'))await storage.remove('books',b.id);});
it('imports typed original preferences, respects per-book overrides and ignores string flags',async()=>{
  const xml='<map><boolean name="tocUiUseReplace" value="true"/><boolean name="replaceEnableDefault" value="false"/><boolean name="tocCountWords" value="true"/></map>';
  const shelves=[{name:'Book',bookUrl:'book:1',type:8},{name:'Override',bookUrl:'book:2',type:8,readConfig:{useReplaceRule:true}}];
  const migrated=await readBackupArchive(zipSync({'config.xml':strToU8(xml),'bookshelf.json':strToU8(JSON.stringify(shelves))}));expect(migrated.settings).toMatchObject({tocUiUseReplace:true,replaceEnableDefault:false,tocCountWords:true});
  expect(migrated.books.map((b:any)=>b.useReplaceRule)).toEqual([undefined,true]);expect(migrated.books.map((b:any)=>bookUsesReplace(b,migrated.settings.replaceEnableDefault))).toEqual([false,true]);expect(migrated.managerPreferences.contentSearchReplace).toBeUndefined();
  const bad=await readBackupArchive(zipSync({'config.xml':strToU8('<map><string name="tocUiUseReplace">true</string></map>')}));expect(bad.settings.tocUiUseReplace).not.toBe(true);
});
it('preserves raw chapter and per-book data, writes each compatible flag once and restores only included settings',async()=>{
  const book={...newBook('Public','txt',[{title:'Raw title',url:'/raw',content:'Original',wordCount:'7字'}]),useReplaceRule:false,bookmarks:[{chapter:0,offset:0,title:'Keep',created:2}]};
  await storage.put('books',book.id,book);await storage.put('settings','reader',{...DEFAULT_SETTINGS,tocUiUseReplace:true,tocCountWords:false});await storage.put('settings','contentSearchReplace',false);
  const full=await createBackupArchive(),files=unzipSync(full),data=await readBackupArchive(full),xml=new DOMParser().parseFromString(strFromU8(files['config.xml']),'application/xml');
  expect(data.books[0]).toEqual(book);expect(data.managerPreferences.contentSearchReplace).toBe(false);
  for(const [name,value] of [['tocUiUseReplace','true'],['tocCountWords','false'],['replaceEnableDefault','true']]){const nodes=xml.querySelectorAll('[name="'+name+'"]');expect(nodes).toHaveLength(1);expect(nodes[0].getAttribute('value')).toBe(value);}
  expect(JSON.parse(strFromU8(files['bookshelf.json']))[0].readConfig.useReplaceRule).toBe(false);
  const partial=await createBackupArchive({...defaultContent,settings:false});expect(unzipSync(partial)['config.xml']).toBeUndefined();
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,tocUiUseReplace:false,tocCountWords:true});
  await storage.restore(JSON.stringify(data),['reader']);expect((await storage.settings()).tocUiUseReplace).toBe(false);
  await storage.restore(JSON.stringify(await readBackupArchive(partial)));expect((await storage.settings()).tocUiUseReplace).toBe(false);
  await storage.restore(JSON.stringify(data));expect(await storage.settings()).toMatchObject({tocUiUseReplace:true,tocCountWords:false});expect((await storage.all('books'))[0]).toEqual(book);
});
it('rejects a corrupt flag before writing and resolves old snapshots to the default',async()=>{
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,tocUiUseReplace:true});
  const data=JSON.parse(await storage.backup());for(const key of ['tocUiUseReplace','replaceEnableDefault']){const invalid=structuredClone(data);invalid.settings[key]='false';await expect(storage.restore(JSON.stringify(invalid))).rejects.toThrow('目录替换');}
  expect((await storage.settings()).tocUiUseReplace).toBe(true);delete data.settings.tocUiUseReplace;await storage.restore(JSON.stringify(data));expect((await storage.settings()).tocUiUseReplace).toBe(false);
});
