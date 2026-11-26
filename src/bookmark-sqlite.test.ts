import 'fake-indexeddb/auto';
import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {bookmarkRows} from './bookmarks';
import {validateBackup} from './storage';

it('converts actual SQLite bookmark rows with original content and position instead of leaving every book empty',()=>{
  const code = `import importlib.util,json,pathlib,sqlite3,tempfile
spec=importlib.util.spec_from_file_location('convert_fixture','scripts/convert-legado-backup.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory);dbdir=root/'extracted/data/user/0/com.legado.app.release/databases';dbdir.mkdir(parents=True)
 db=sqlite3.connect(dbdir/'legado.db')
 db.execute('create table books (bookUrl text,name text,author text,type integer,origin text,tocUrl text,durChapterIndex integer,durChapterPos integer,durChapterTime integer,canUpdate integer,"order" integer,latestChapterTime integer,"group" integer)')
 db.execute("insert into books values ('https://book.example.test','Public book','Author',0,'https://book.example.test','https://book.example.test/toc',0,10,1700000000000,1,0,0,0)")
 db.execute('create table bookmarks (time integer,bookName text,bookAuthor text,chapterIndex integer,chapterPos integer,chapterName text,bookText text,content text)')
 db.executemany('insert into bookmarks values (?,?,?,?,?,?,?,?)',[(1700000000001,'Public book','Author',3,671,'Chapter four','Quoted text','Saved summary'),(1700000000002,'Public book','Different',3,99,'Other','Foreign text','Do not mix')])
 db.commit();db.close();data,_=module.convert(root);print(json.dumps(data))`;
  const converted=spawnSync(process.platform==='win32'?'python':'python3',['-B','-c',code],{encoding:'utf8'});
  expect(converted.status,converted.stderr).toBe(0);const data=JSON.parse(converted.stdout);validateBackup(data);
  expect(data.books[0].bookmarks).toHaveLength(1);
  expect(data.books[0].bookmarks[0]).toMatchObject({chapter:3,chapterPos:671,bookText:'Quoted text',content:'Saved summary',positionLayout:{indent:2,titleVisible:true}});
  expect(bookmarkRows(data.books)[0].record).toEqual({time:1700000000001,bookName:'Public book',bookAuthor:'Author',chapterIndex:3,chapterPos:671,chapterName:'Chapter four',bookText:'Quoted text',content:'Saved summary'});
});
