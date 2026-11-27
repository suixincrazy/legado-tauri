import 'fake-indexeddb/auto';
import {afterEach,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {DEFAULT_SETTINGS,newBook,type Book,type BookGroup} from './model';
import {createBackupArchive,readBackupArchive,defaultContent} from './backup-archive';
import {bookInGroup,effectiveShelfSort} from './bookshelf-model';
import {newBookGroupId,parseShelfRows} from './legacy-book-groups';
import * as storage from './storage';

const group=(id:string,bookSort:number):BookGroup=>({id,name:id,bookSort,order:0,show:true,enableRefresh:true});
afterEach(async()=>{
  for(const b of await storage.all<Book>('books'))await storage.remove('books',b.id);
  for(const key of ['reader','bookGroups','legacyBackupFiles','legacyMigration','legacySourceState','sourceSubscriptionsVersion'])await storage.remove('settings',key);
});
it('reads real original masks above 32/53 bits and the signed last bit with group overrides intact',async()=>{
  const groups='[{"groupId":4294967296,"groupName":"High","bookSort":2,"future":{"keep":true}},{"groupId":18014398509481984,"groupName":"Higher","bookSort":3},{"groupId":-9223372036854775808,"groupName":"Last","bookSort":5},{"groupId":-2,"groupName":"Local","bookSort":0}]';
  const shelf='[{"bookUrl":"public:a","name":"A","type":256,"group":-9205357634050326528}]';
  const data=await readBackupArchive(zipSync({'bookGroup.json':strToU8(groups),'bookshelf.json':strToU8(shelf),'config.xml':strToU8('<map><int name="bookshelfSort" value="4"/></map>')}));
  expect(data.managerPreferences.bookGroups.map((g:BookGroup)=>effectiveShelfSort(g,'updated'))).toEqual(['name','manual','author','recent']);
  expect(data.books[0].groups).toEqual(['legado-group-4294967296','legado-group-18014398509481984','legado-group--9223372036854775808']);
  expect(data.managerPreferences.bookGroups[0].legacy.future).toEqual({keep:true});expect(data.settings.shelfSort).toBe('combined');
});
it('exports current sort choices and stable original membership for new groups while preserving book data',async()=>{
  const groups=[{...group('legado-group-1',-1),legacy:{groupId:1,bookSort:5,future:'preserved'}},group('new-b',2),group('new-a',3)];
  const book={...newBook('Public','txt',[{title:'Keep',content:'Keep body',wordCount:'9字'}]),groups:groups.map(g=>g.id),bookmarks:[{chapter:0,offset:0,title:'Keep',created:1}]};
  await storage.put('books',book.id,book);await storage.put('settings','bookGroups',groups);await storage.put('settings','reader',{...DEFAULT_SETTINGS,shelfSort:'author'});
  const raw=await createBackupArchive(),files=unzipSync(raw),data=await readBackupArchive(raw);
  expect(data.books).toEqual([book]);expect(data.managerPreferences.bookGroups).toEqual(groups);
  const exported=parseShelfRows(strFromU8(files['bookGroup.json']),'groupId');
  expect(exported.map(g=>g.groupId)).toEqual([1,4,2]);expect(exported.map(g=>g.bookSort)).toEqual([-1,2,3]);expect(exported[0].future).toBe('preserved');
  expect(parseShelfRows(strFromU8(files['bookshelf.json']),'group')[0].group).toBe(7);
  const plain=await readBackupArchive(zipSync({'bookGroup.json':files['bookGroup.json'],'bookshelf.json':files['bookshelf.json'],'config.xml':files['config.xml']}));
  expect(plain.settings.shelfSort).toBe('author');expect(plain.books[0].groups).toEqual(['legado-group-1','legado-group-4','legado-group-2']);
  expect(plain.managerPreferences.bookGroups.map((g:BookGroup)=>g.bookSort)).toEqual([-1,2,3]);
});
it('round trips the complete signed mask without floating point loss',async()=>{
  const groups=[group('legado-group-1',2),group('legado-group-18014398509481984',3),group('legado-group--9223372036854775808',4)];
  await storage.put('settings','bookGroups',groups);
  const b={...newBook('Public','txt',[]),groups:groups.map(g=>g.id)};await storage.put('books',b.id,b);
  const files=unzipSync(await createBackupArchive());expect(strFromU8(files['bookshelf.json'])).toContain('"group":-9205357638345293823');
  const data=await readBackupArchive(zipSync({'bookshelf.json':files['bookshelf.json'],'bookGroup.json':files['bookGroup.json']}));
  expect(data.books[0].groups).toEqual(b.groups);expect(data.managerPreferences.bookGroups.map((g:BookGroup)=>g.id)).toEqual(groups.map(g=>g.id));
});
it('preserves update sorting and built-in metadata through an original-format round trip',async()=>{
  const rows=[{bookUrl:'public:update',name:'Update',author:'Author',type:40,latestChapterTime:321,durChapterTime:123,durChapterIndex:7,durChapterPos:20,totalChapterNum:12,group:1}],groups=[{groupId:1,groupName:'Group',bookSort:1}];
  const old=await readBackupArchive(zipSync({'bookshelf.json':strToU8(JSON.stringify(rows)),'bookGroup.json':strToU8(JSON.stringify(groups))}));
  expect(old.books[0]).toMatchObject({latestChapterTime:321,lastRead:123});expect(bookInGroup(old.books[0],'legado-group--20',old.managerPreferences.bookGroups)).toBe(true);
  await storage.restore(JSON.stringify(old));
  const files=unzipSync(await createBackupArchive()),row=parseShelfRows(strFromU8(files['bookshelf.json']),'group')[0];
  expect(row).toMatchObject({latestChapterTime:321,durChapterTime:123,type:40,group:1,totalChapterNum:12});
});
it('assigns new groups an unused original bit and preserves all groups in the Tauri payload past the bit limit',async()=>{
  expect(newBookGroupId([group('legado-group-1',2),group('legado-group-4294967296',3)])).toBe('legado-group-2');
  const rows=Array.from({length:64},(_,i)=>group('legado-group-'+BigInt.asIntN(64,1n<<BigInt(i)),2));
  const id=newBookGroupId(rows);expect(id).not.toMatch(/^legado-group-/);rows.push(group(id,4));
  await storage.put('settings','bookGroups',rows);const raw=await createBackupArchive();
  expect((await readBackupArchive(raw)).managerPreferences.bookGroups).toHaveLength(65);
  expect(parseShelfRows(strFromU8(unzipSync(raw)['bookGroup.json']),'groupId')).toHaveLength(64);
});
it('keeps group choices with bookshelf-only backups and preserves existing choices when shelf is excluded',async()=>{
  await storage.put('settings','bookGroups',[group('g',2)]);await storage.put('settings','reader',{...DEFAULT_SETTINGS,shelfSort:'author'});
  const noSettings=await createBackupArchive({...defaultContent,settings:false}),noShelf=await createBackupArchive({...defaultContent,bookshelf:false});
  expect(unzipSync(noSettings)['config.xml']).toBeUndefined();expect(unzipSync(noShelf)['bookGroup.json']).toBeUndefined();
  await storage.put('settings','bookGroups',[group('g',3)]);await storage.put('settings','reader',{...DEFAULT_SETTINGS,shelfSort:'manual'});
  await storage.restore(JSON.stringify(await readBackupArchive(noShelf)));expect((await storage.preference<BookGroup[]>('bookGroups',[]))[0].bookSort).toBe(3);
  await storage.restore(JSON.stringify(await readBackupArchive(noSettings)));expect((await storage.preference<BookGroup[]>('bookGroups',[]))[0].bookSort).toBe(2);expect((await storage.settings()).shelfSort).toBe('author');
});
it('rejects malformed group sorting before writing any imported books',async()=>{
  const old={...newBook('Old','txt',[]),id:'one'};await storage.put('books',old.id,old);
  const data=JSON.parse(await storage.backup());data.books[0].name='Changed';data.managerPreferences.bookGroups=[group('g',7)];
  await expect(storage.restore(JSON.stringify(data))).rejects.toThrow('分组');expect(await storage.all('books')).toEqual([old]);
});
it('migrates SQLite group sorting, the shared default and legacy metadata from original columns',()=>{
  const code=`import importlib.util,json,pathlib,sqlite3,tempfile
spec=importlib.util.spec_from_file_location('fixture','scripts/convert-legado-backup.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d);app=root/'extracted/data/user/0/com.legado.app.release';(app/'databases').mkdir(parents=True);(app/'shared_prefs').mkdir()
 (app/'shared_prefs/com.legado.app.release_preferences.xml').write_text('<map><int name="bookshelfSort" value="5"/></map>')
 db=sqlite3.connect(app/'databases/legado.db')
 db.execute('create table book_groups (groupId integer,groupName text,"order" integer,show integer,enableRefresh integer,bookSort integer,future text)')
 for i,s in enumerate([-1,0,1,2,3,4,5,99]): db.execute('insert into book_groups values (?,?,?,?,?,?,?)',(1<<i,str(i),i,1,1,s,'keep'))
 db.commit();db.close();data,_=m.convert(root);print(json.dumps(data))`;
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-B','-c',code],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);const d=JSON.parse(result.stdout);expect(d.settings.shelfSort).toBe('author');
  expect(d.managerPreferences.bookGroups.map((g:BookGroup)=>g.bookSort)).toEqual([-1,0,1,2,3,4,5,-1]);expect(d.managerPreferences.bookGroups[7].legacy).toMatchObject({bookSort:99,future:'keep'});
});
