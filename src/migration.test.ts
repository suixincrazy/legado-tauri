import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {newBook} from './model';
import * as storage from './storage';
import {SourceRuntime} from './source-runtime';
import {strToU8,zipSync} from 'fflate';

it('restores original source login, cookies and cache while retaining unmapped fields in the next backup',async()=>{
  const source={bookSourceUrl:'https://migration.example.org',bookSourceName:'Migration fixture'};
  const book={...newBook('fixture','txt',[{title:'章',content:'正文',start:8} as any]),legacy:{bookUrl:'original-id'},legacyPosition:{chapter:0,position:4,titleVisible:true,indent:2}};
  const payload={format:'legado-tauri',version:1,books:[book],sources:[source],records:[],feeds:[],settings:{},sourceState:{[source.bookSourceUrl]:{'source:loginInfo':{value:'{"user":"fixture"}'}}},managerPreferences:{legacyMigration:{tables:{httpTTS:[{name:'retained'}]}},legacySourceState:{sources:[source.bookSourceUrl],state:{'cookie:example.org':{value:'session=fixture'},'cache:fixture-key':{value:'original-cache'}}}}};
  await storage.restoreFile(zipSync({'legado-tauri.json':strToU8(JSON.stringify(payload))}));
  let cookie='';const runtime=new SourceRuntime(source,{},async request=>{cookie=request.headers?.Cookie||'';return {url:request.url,status:200,body:'ok'};});
  try{await runtime.initialize();expect(await runtime.evaluate('source.getLoginInfo()')).toBe('{"user":"fixture"}');expect(await runtime.evaluate('cache.get("fixture-key")')).toBe('original-cache');await runtime.fetch('https://sub.example.org/book');expect(cookie).toBe('session=fixture');await runtime.evaluate('cookie.setCookie("example.org", "")');}finally{await runtime.close();}
  const reopened=new SourceRuntime(source);try{await reopened.initialize();expect(await reopened.evaluate('cookie.getCookie("example.org")')).toBe('');}finally{await reopened.close();}
  const backup=JSON.parse(await storage.backup()),restored=backup.books.find((b:any)=>b.id===book.id);
  expect(restored.legacyPosition).toEqual(book.legacyPosition);expect(restored.legacy).toEqual(book.legacy);expect(restored.chapters[0].start).toBe(8);
  expect(backup.managerPreferences.legacyMigration.tables.httpTTS).toHaveLength(1);
  expect(await storage.sourceState('https://unrelated.test')).toEqual({});
  await storage.clearSourceState(source.bookSourceUrl,'cache:');expect((await storage.sourceState(source.bookSourceUrl))['cache:fixture-key'].value).toBe('');
  await storage.clearSourceState(source.bookSourceUrl);expect(await storage.sourceState(source.bookSourceUrl)).toEqual({});
});

it.skipIf(!process.env.LEGADO_PRIVATE_MIGRATION)('validates the private conversion and re-exports every original entry without displaying private values',async()=>{
  const raw=JSON.parse(readFileSync(process.env.LEGADO_PRIVATE_MIGRATION!,'utf8'));
  try{await storage.restore(JSON.stringify(raw));}catch(error){throw new Error('Private migration restore failed: '+(error instanceof Error?error.name:'unknown'));}
  const exported=JSON.parse(await storage.backup()),books=new Map(exported.books.map((b:any)=>[b.id,b]));
  expect(raw.books.every((book:any)=>JSON.stringify(books.get(book.id))===JSON.stringify(book))).toBe(true);
  expect(raw.sources.every((source:any)=>exported.sources.some((entry:any)=>JSON.stringify(entry)===JSON.stringify(source)))).toBe(true);
  expect(JSON.stringify(exported.managerPreferences.legacyMigration)===JSON.stringify(raw.managerPreferences.legacyMigration)).toBe(true);
  expect(raw.managerPreferences.legacyMigration.originalCounts.chapters).toBe(raw.books.reduce((sum:number,book:any)=>sum+book.chapters.length,0));
},30000);
