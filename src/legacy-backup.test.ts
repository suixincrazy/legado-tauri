import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {strToU8,zipSync} from 'fflate';
import {legacyRule,legacyUrl,legacyUrls,convertLegacySource} from './legacy-backup';
import {inspectBackup,restoreBackup,defaultBackupConfig} from './backup';
import {parseSources,searchSource} from './sources';
import * as storage from './storage';
import {newBook} from './model';
import oracle from './legacy-url-oracle.json';

it('matches 82 cases executed by the unmodified pinned upstream Kotlin conversion methods',()=>{
  for(const row of oracle){let actual:string|null;try{actual=(row.kind==='rule'?legacyRule(row.input??undefined):row.kind==='url'?legacyUrl(row.input??undefined):legacyUrls(row.input??undefined))??null;}catch{actual='ERROR';}
    if(actual&&row.expected&&row.kind!=='rule'&&actual.includes(',{')&&row.expected.includes(',{')){
      expect(actual.slice(0,actual.indexOf(',{')),JSON.stringify(row)).toBe(row.expected.slice(0,row.expected.indexOf(',{')));
      expect(JSON.parse(actual.slice(actual.indexOf(',{')+1)),JSON.stringify(row)).toEqual(JSON.parse(row.expected.slice(row.expected.indexOf(',{')+1)));
    }else expect(actual,JSON.stringify(row)).toBe(row.expected);
  }
});

it('converts the upstream old URL/rule examples without changing scripts or replacement alternatives',()=>{
  expect(legacyUrls('https://example.com/a\n   \nhttps://example.com/b')).toBe('https://example.com/a\nhttps://example.com/b');
  expect(legacyUrls('https://example.com/searchKey&&   &&https://example.net/searchPage')).toBe('https://example.com/{{key}}\nhttps://example.net/{{page}}');
  expect(legacyUrls('  && \n &&  ')).toBeUndefined();
  for(const script of ["<js>return 'https://example.com'","@js:return 'https://example.com'"])expect(legacyUrls(script)).toBe(script);
  expect(legacyRule('a|b#x|y#')).toBe('a||b##x|y##');
  expect(legacyRule('a&b')).toBe('a&&b');expect(legacyRule('-+a|b')).toBe('-+a||b');
  for(const rule of ['@CSS:a|b','//a|b','@js:result.split("|")','<js>result&1</js>'])expect(legacyRule(rule)).toBe(rule);
  const result=legacyUrl('https://example.test/search@q=searchKey&page={searchPage+1}@Header:{"X-Test":"fixture"}|char=gbk')!;
  expect(result.slice(0,result.indexOf(',{'))).toBe('https://example.test/search');
  expect(JSON.parse(result.slice(result.indexOf(',{')+1))).toEqual({headers:'{"X-Test":"fixture"}',charset:'gbk',method:'POST',body:'q={{key}}&page={{page+1}}'});
  expect(legacyUrl('https://example.test/{{searchKey.toUpperCase()}}/searchPage-1')).toBe('https://example.test/{{key.toUpperCase()}}/{{page-1}}');
});
const source={bookSourceUrl:'https://old-backup.example.test',bookSourceName:'Old source',ruleSearchUrl:'data:text/html,<div class="item"><a href="https://old-backup.example.test/book">Fixture</a></div>',ruleSearchList:'class.item',ruleSearchName:'tag.a@text',ruleSearchNoteUrl:'tag.a@href',ruleChapterList:'tag.a',ruleChapterName:'text',ruleContentUrl:'href',ruleBookContent:'tag.p@text',enable:false,httpUserAgent:'fixture-agent',extra:{retained:true}};
it('imports legacy sources through the normal source parser and executes converted search rules',async()=>{
  const converted=parseSources(JSON.stringify(source))[0];
  expect(converted).toMatchObject({enabled:false,customOrder:0,ruleSearch:{bookList:'class.item'},extra:{retained:true}});
  expect(converted.header).toBe('{"User-Agent":"fixture-agent"}');
  const results=await searchSource(converted,'test');expect(results).toHaveLength(1);expect(results[0]).toMatchObject({name:'Fixture',url:'https://old-backup.example.test/book'});
  expect(convertLegacySource({...source,bookSourceType:'AUDIO'}).bookSourceType).toBe(1);
});
it('previews old folder files, preserves raw originals, skips existing books, and merges rules after confirmation',async()=>{
  const url='https://old-backup.example.test/book',existing={...newBook('Keep current','online',[{title:'Current',content:'Keep text'}]),url,offset:.7};
  await storage.put('books',existing.id,existing);await storage.put('settings','reader',{fontSize:29,lineHeight:1.8});
  await storage.put('settings','legacyMigration',{format:'previous-migration',tables:{unknown:[{keep:1}]}});await storage.put('settings','legacyBackupFiles',{'unknown.bin':'AQID'});
  await storage.put('settings','replaceRules',[{id:501,name:'Current rule',pattern:'x',replacement:'y',isRegex:false,isEnabled:true,scopeContent:true,scopeTitle:false,order:0,timeoutMillisecond:3000}]);
  const files={'myBookShelf.json':strToU8(JSON.stringify([{noteUrl:url,bookInfoBean:{name:'Do not overwrite'},durChapter:9},{noteUrl:'/storage/test.txt',tag:'loc_book',bookInfoBean:{name:'Old local',author:'Author',introduce:'Intro'},durChapter:12,durChapterPage:3,finalDate:42,variable:'{"x":1}',useReplaceRule:false}])), 'myBookSource.json':strToU8(JSON.stringify([source])),'myBookReplaceRule.json':strToU8('[{"id":502,"regex":"广告","replacement":"","replaceSummary":"Old rule","enable":true,"isRegex":false,"serialNumber":4}]')};
  const preview=await inspectBackup(zipSync(files),'');expect(preview.data.legacyVersion).toBe(2);expect(preview.data.books).toHaveLength(2);
  const local=preview.data.books[1];expect(local.legacyPosition).toMatchObject({chapter:12,position:3});expect(local).toMatchObject({kind:'txt',name:'Old local',lastRead:42,useReplaceRule:false});
  expect(preview.data.managerPreferences.legacyBackupFiles['myBookShelf.json']).toBeTruthy();expect(await storage.all('books')).not.toContainEqual(local);
  await restoreBackup(preview.data,{...defaultBackupConfig,deviceName:'legacy-test'});
  expect((await storage.all<any>('books')).find(book=>book.id===existing.id)).toEqual(existing);expect((await storage.settings()).fontSize).toBe(29);
  expect((await storage.preference<any[]>('replaceRules',[])).map(rule=>rule.id)).toEqual([501,502]);
  expect((await storage.preference<any>('legacyMigration',{})).tables.unknown).toEqual([{keep:1}]);expect((await storage.preference<any>('legacyBackupFiles',{}))['unknown.bin']).toBe('AQID');
  expect((await storage.all<any>('backups')).some(item=>item.name.startsWith('backup-before-restore-'))).toBe(true);
});
it('rejects malformed old files before changing any stored books',async()=>{
  const before=await storage.all('books');
  await expect(inspectBackup(zipSync({'myBookShelf.json':strToU8('[{"noteUrl":"new","bookInfoBean":{"name":"Test"}}]'),'myBookSource.json':strToU8('{invalid')}),'')).rejects.toThrow('JSON');
  expect(await storage.all('books')).toEqual(before);
});
