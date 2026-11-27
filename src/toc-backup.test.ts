import 'fake-indexeddb/auto';
import {strToU8,strFromU8,zipSync,unzipSync} from 'fflate';
import {spawnSync} from 'node:child_process';
import {beforeEach,expect,it} from 'vitest';
import {newBook,type Book} from './model';
import * as storage from './storage';
import {inspectBackup} from './backup';
import {createBackupArchive,readBackupArchive,defaultContent} from './backup-archive';
import {updatedBook} from './book-update';
import {bookTocExpanded} from './toc-config';

const upstream=(readConfig:unknown,index=0)=>({bookUrl:'https://public.example.test/book/'+index,name:'Public volumes '+index,author:'Public Author',type:0,readConfig});
beforeEach(async()=>{for(const book of await storage.all<Book>('books'))await storage.remove('books',book.id);for(const key of ['legacyBackupFiles','legacyMigration','detachedBookmarks'])await storage.remove('settings',key);});
it('imports object and serialized original settings without writes during preview, preserving unknown config fields',async()=>{
  const rows=[upstream({tocExpanded:false,future:{kept:true}}),upstream('{"tocExpanded":true,"future":7}',1),upstream(undefined,2),upstream('null',3),upstream(null,4)];
  const preview=await inspectBackup(zipSync({'bookshelf.json':strToU8(JSON.stringify(rows))}),'');
  expect(await storage.all('books')).toEqual([]);expect(preview.data.books.map((b:Book)=>b.tocExpanded)).toEqual([false,true,true,true,true]);
  await storage.restore(JSON.stringify(preview.data));expect((await storage.all<Book>('books')).map(bookTocExpanded).sort()).toEqual([false,true,true,true,true].sort());
  const converted=unzipSync(await createBackupArchive());const original=JSON.parse(strFromU8(converted['bookshelf.json']));
  expect(original.find((b:any)=>b.bookUrl.endsWith('/0')).readConfig).toEqual({tocExpanded:false,future:{kept:true}});
  expect(original.find((b:any)=>b.bookUrl.endsWith('/1')).readConfig).toEqual({tocExpanded:true,future:7});
});
it('round-trips independent choices in Tauri and compatible original archives, including settings exclusion',async()=>{
  const first={...newBook('First','txt',[{title:'Text',content:'Original'}]),tocExpanded:false,legacy:{readConfig:'{"tocExpanded":true,"future":7}'},bookmarks:[{chapter:0,offset:0,title:'Keep',created:1}]};
  const second={...newBook('Second','txt',[{title:'Text',content:'Other'}]),tocExpanded:true};
  await storage.put('books',first.id,first);await storage.put('books',second.id,second);
  const bytes=await createBackupArchive({...defaultContent,settings:false}),files=unzipSync(bytes),data=await readBackupArchive(bytes);
  expect(data.books.find((b:Book)=>b.id===first.id)).toEqual(first);
  const shelf=JSON.parse(strFromU8(files['bookshelf.json']));expect(shelf.find((b:any)=>b.name==='First').readConfig).toEqual({tocExpanded:false,future:7});
  await storage.put('books',first.id,{...first,tocExpanded:true});await storage.restore(JSON.stringify(data));
  expect((await storage.all<Book>('books')).find(b=>b.id===first.id)).toEqual(first);
  const original=await readBackupArchive(zipSync({'bookshelf.json':files['bookshelf.json']}));
  expect(original.books.find((b:Book)=>b.name==='First').tocExpanded).toBe(false);expect(original.books.find((b:Book)=>b.name==='Second').tocExpanded).toBe(true);
  const omitted=unzipSync(await createBackupArchive({...defaultContent,bookshelf:false}));expect(omitted['bookshelf.json']).toBeUndefined();expect(JSON.parse(strFromU8(omitted['legado-tauri.json'])).books).toEqual([]);
});
it('rejects malformed preferences before restoring any books and retains defaults for older backups',async()=>{
  const book=newBook('Keep','txt',[{title:'T',content:'C'}]);await storage.put('books',book.id,book);
  for(const wrong of ['false',0,{}]){
    const data=JSON.parse(await storage.backup());data.books[0]={...book,name:'Changed',tocExpanded:wrong};
    await expect(storage.restore(JSON.stringify(data))).rejects.toThrow('目录展开');
    expect((await storage.all<Book>('books'))[0]).toEqual(book);
    await expect(inspectBackup(zipSync({'bookshelf.json':strToU8(JSON.stringify([upstream({tocExpanded:wrong})]))}),'')).rejects.toThrow('目录展开');
  }
  const old=JSON.parse(await storage.backup());await storage.restore(JSON.stringify(old));expect(bookTocExpanded((await storage.all<Book>('books'))[0])).toBe(true);
});
it('retains the book preference after catalogue refresh and source change',()=>{
  const old={...newBook('Same','online',[{title:'T',url:'https://one.example.test/t',content:'C'}]),sourceUrl:'https://one.example.test',tocExpanded:false};
  const fresh={...newBook('Same','online',[{title:'T',url:'https://two.example.test/t'}]),sourceUrl:'https://two.example.test',tocExpanded:true};
  expect(updatedBook(old,fresh).tocExpanded).toBe(false);expect(updatedBook(old,{...fresh,sourceUrl:old.sourceUrl}).tocExpanded).toBe(false);
});
it('migrates the per-book flag from a real original SQLite readConfig column',()=>{
  const code = `import importlib.util,json,pathlib,sqlite3,tempfile
spec=importlib.util.spec_from_file_location('convert_fixture','scripts/convert-legado-backup.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory);dbdir=root/'extracted/data/user/0/com.legado.app.release/databases';dbdir.mkdir(parents=True)
 db=sqlite3.connect(dbdir/'legado.db')
 db.execute('create table books (bookUrl text,name text,author text,type integer,origin text,tocUrl text,durChapterIndex integer,durChapterPos integer,durChapterTime integer,canUpdate integer,"order" integer,latestChapterTime integer,"group" integer,readConfig text)')
 for i,config in enumerate([{'tocExpanded':False,'future':7},{'tocExpanded':True},{},None,{'tocExpanded':None}]):
  db.execute('insert into books values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(f'https://public.example.test/{i}',f'Public {i}','Author',0,'https://public.example.test','https://public.example.test/toc',0,0,0,1,0,0,0,json.dumps(config)))
 db.commit();db.close();data,_=module.convert(root);print(json.dumps(data))`;
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-B','-c',code],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);const data=JSON.parse(result.stdout);storage.validateBackup(data);
  expect(data.books.map((b:Book)=>b.tocExpanded)).toEqual([false,true,true,true,true]);
  expect(JSON.parse(data.books[0].legacy.readConfig)).toEqual({tocExpanded:false,future:7});
});
