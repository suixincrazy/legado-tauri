import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import * as storage from './storage';
import {newBook} from './model';
import {inspectBackup} from './backup';
import {strToU8,zipSync} from 'fflate';

it('backs up every persisted preference and restores it with complete local text and source state',async()=>{
  const book={...newBook('Backup fixture','txt',[{title:'第一章',content:'正文𠮷'}]),rawText:'第一章\n正文𠮷',offset:.42};
  await storage.put('books',book.id,book);
  await storage.put('settings','futurePreference',{unknown:'retained'});
  const source={bookSourceUrl:'https://backup.example.test',bookSourceName:'Backup fixture',extra:{retained:true}};
  await storage.saveSources([source]);await storage.saveSourceState(source.bookSourceUrl,{'source:loginInfo':{value:'fixture'}});
  const json=await storage.backup();
  expect(JSON.parse(json).managerPreferences.futurePreference).toEqual({unknown:'retained'});
  await storage.remove('books',book.id);await storage.remove('settings','futurePreference');
  await storage.restore(json);
  expect((await storage.all<any>('books')).find(row=>row.id===book.id)).toEqual(book);
  expect(await storage.preference('futurePreference',null)).toEqual({unknown:'retained'});
});

it('previews subscription-only ZIPs independently from sources without writing or migrating stored preferences',async()=>{
  const entries=[{id:1,url:'https://fixture.example.test/books',type:0},{id:2,url:'https://fixture.example.test/rss',type:1},{id:3,url:'@js:result',type:19}];
  const before=JSON.parse(await storage.backup()),preview=await inspectBackup(zipSync({'sourceSub.json':strToU8(JSON.stringify(entries))}),'');
  expect(preview.summary).toBe('0 本书 · 0 个书源 · 3 条规则订阅 · 0 条阅读记录');
  expect(preview.data.managerPreferences.sourceSubscriptions).toEqual(entries);
  const after=JSON.parse(await storage.backup());delete before.created;delete after.created;expect(after).toEqual(before);
});
it('counts subscriptions after migrating archived copies and keeps mixed backup counts separate',async()=>{
  const entries=[{id:1,url:'https://fixture.example.test/books',type:0},{id:2,url:'https://fixture.example.test/rss',type:1}];
  const data={format:'legado-tauri',version:1,books:[newBook('Mixed backup','txt',[])],sources:[{bookSourceUrl:'https://source.example.test',bookSourceName:'Public source'}],records:[{id:'fixture-record',seconds:10}],feeds:[],settings:{},managerPreferences:{legacyBackupFiles:{'sourceSub.json':btoa(JSON.stringify(entries))}}};
  const preview=await inspectBackup(strToU8(JSON.stringify(data)),'');
  expect(preview.summary).toBe('1 本书 · 1 个书源 · 2 条规则订阅 · 1 条阅读记录');
  expect(preview.data.managerPreferences.sourceSubscriptions).toEqual(entries);
});
it('counts zero for backups without subscriptions and rejects malformed subscription data before preview',async()=>{
  const data={format:'legado-tauri',version:1,books:[],sources:[],records:[],feeds:[],settings:{}};
  expect((await inspectBackup(strToU8(JSON.stringify(data)), '')).summary).toContain('0 条规则订阅');
  const before=await storage.preference('sourceSubscriptions',null);
  await expect(inspectBackup(strToU8(JSON.stringify({...data,managerPreferences:{sourceSubscriptions:[{url:12}]}})),'')).rejects.toThrow('订阅');
  expect(await storage.preference('sourceSubscriptions',null)).toEqual(before);
});
