import 'fake-indexeddb/auto';
import {afterEach,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {newBook,type Book,type BookGroup} from './model';
import {createBackupArchive,readBackupArchive,defaultContent} from './backup-archive';
import * as storage from './storage';

afterEach(async()=>{
  for(const b of await storage.all<Book>('books'))await storage.remove('books',b.id);
  for(const key of ['reader','bookGroups','legacyBackupFiles','legacyMigration','legacySourceState','sourceSubscriptionsVersion'])await storage.remove('settings',key);
});
const groups:BookGroup[]=[{id:'legado-group-1',name:'Read',order:0,show:true,enableRefresh:false,onlyUpdateRead:false,legacy:{onlyUpdateRead:true,future:'keep'}}];
it('imports original group flags, defaults missing flags and exports current values over stale metadata',async()=>{
  const zip=zipSync({'bookGroup.json':strToU8(JSON.stringify([{groupId:1,groupName:'Read',onlyUpdateRead:true},{groupId:2,groupName:'Default'}]))});
  const data=await readBackupArchive(zip);expect(data.managerPreferences.bookGroups.map((g:BookGroup)=>g.onlyUpdateRead)).toEqual([true,false]);
  await storage.put('settings','bookGroups',groups);
  const raw=await createBackupArchive(),legacy=JSON.parse(strFromU8(unzipSync(raw)['bookGroup.json']));
  expect(legacy).toHaveLength(1);expect(legacy[0]).toMatchObject({onlyUpdateRead:false,enableRefresh:false,future:'keep'});
  expect((await readBackupArchive(raw)).managerPreferences.bookGroups).toEqual(groups);
});
it('restores group flags with bookshelf-only backups and leaves them untouched when the shelf is excluded',async()=>{
  await storage.put('settings','bookGroups',groups);
  const shelf=await createBackupArchive({...defaultContent,settings:false}),excluded=await createBackupArchive({...defaultContent,bookshelf:false});
  await storage.put('settings','bookGroups',[{...groups[0],onlyUpdateRead:true}]);
  await storage.restore(JSON.stringify(await readBackupArchive(excluded)));expect((await storage.preference<BookGroup[]>('bookGroups',[]))[0].onlyUpdateRead).toBe(true);
  await storage.restore(JSON.stringify(await readBackupArchive(shelf)));expect((await storage.preference<BookGroup[]>('bookGroups',[]))[0].onlyUpdateRead).toBe(false);
});
it('rejects malformed imported flags before changing books or group preferences',async()=>{
  const original={...newBook('Public','txt',[]),id:'public'};await storage.put('books',original.id,original);await storage.put('settings','bookGroups',groups);
  const data=JSON.parse(await storage.backup());data.books[0].name='Changed';data.managerPreferences.bookGroups=[{...groups[0],onlyUpdateRead:'false'}];
  await expect(storage.restore(JSON.stringify(data))).rejects.toThrow('分组');expect(await storage.all('books')).toEqual([original]);expect(await storage.preference('bookGroups',[])).toEqual(groups);
});
it('migrates SQLite boolean columns and defaults absent columns while retaining all unknown fields',()=>{
  const code=`import importlib.util,json,pathlib,sqlite3,tempfile
spec=importlib.util.spec_from_file_location('fixture','scripts/convert-legado-backup.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
results=[]
for has_flag in [True,False]:
 with tempfile.TemporaryDirectory() as d:
  root=pathlib.Path(d);app=root/'extracted/data/user/0/com.legado.app.release';(app/'databases').mkdir(parents=True);(app/'shared_prefs').mkdir()
  db=sqlite3.connect(app/'databases/legado.db')
  db.execute('create table book_groups (groupId integer,groupName text,"order" integer,show integer,enableRefresh integer,future text'+(',onlyUpdateRead integer' if has_flag else '')+')')
  for i,v in enumerate([1,0,None]): db.execute('insert into book_groups values ('+','.join('?' for _ in range(7 if has_flag else 6))+')',(1<<i,str(i),i,1,0,'keep')+((v,) if has_flag else ()))
  db.commit();db.close();data,_=m.convert(root);results.append(data['managerPreferences']['bookGroups'])
print(json.dumps(results))`;
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-B','-c',code],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);const [current,old]=JSON.parse(result.stdout);
  expect(current.map((g:BookGroup)=>g.onlyUpdateRead)).toEqual([true,false,false]);expect(old.map((g:BookGroup)=>g.onlyUpdateRead)).toEqual([false,false,false]);
  expect(current[0]).toMatchObject({enableRefresh:false,legacy:{onlyUpdateRead:1,future:'keep'}});expect(old[0].legacy.future).toBe('keep');
});
it('merges a returning catalog with current reading data and never resurrects removed or changed-source books',async()=>{
  const request={...newBook('Public','online',[{title:'First',url:'/1',content:'Body'},{title:'Last',url:'/2',content:'End'}]),id:'book',url:'https://public.example/book',sourceUrl:'https://public.example',groups:['group'],order:7};
  const fresh={...newBook('Public','online',[{title:'First revised',url:'/1'},{title:'Last',url:'/2'},{title:'New',url:'/3'}]),url:request.url,sourceUrl:request.sourceUrl};
  const latest={...request,chapter:1,offset:.65,lastRead:123,note:'Latest note',bookmarks:[{chapter:1,offset:.65,title:'Keep',created:32}],chapters:[request.chapters[0],{...request.chapters[1],content:'Latest edit'}]};
  await storage.put('books',request.id,latest);expect(await storage.saveShelfCatalog(request,fresh)).toBe(true);
  const result=(await storage.all<Book>('books'))[0];
  expect(result).toMatchObject({id:request.id,chapter:1,offset:.65,lastRead:123,note:'Latest note',groups:['group'],order:7,bookmarks:latest.bookmarks});
  expect(result.chapters.map(c=>c.content)).toEqual(['Body','Latest edit',undefined]);
  const changed={...latest,sourceUrl:'https://other.example'};await storage.put('books',request.id,changed);
  expect(await storage.saveShelfCatalog(request,fresh)).toBe(false);expect(await storage.all('books')).toEqual([changed]);
  await storage.put('books',request.id,{...latest,canUpdate:false});expect(await storage.saveShelfCatalog(request,fresh)).toBe(false);
  await storage.remove('books',request.id);expect(await storage.saveShelfCatalog(request,fresh)).toBe(false);expect(await storage.all('books')).toEqual([]);
});
