import 'fake-indexeddb/auto';
import {beforeEach,expect,it} from 'vitest';
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate';
import {createBackupArchive,defaultContent,readBackupArchive} from './backup-archive';
import {inspectBackup} from './backup';
import {newBook} from './model';
import * as storage from './storage';

const original={time:1700000000000,bookName:'Bookmark fixture',bookAuthor:'Author',chapterIndex:2,chapterPos:371,chapterName:'Chapter three',bookText:'Quoted 😀 text\nsecond line',content:'A saved note'};
beforeEach(async()=>{
  for(const book of await storage.all<any>('books'))await storage.remove('books',book.id);
  for(const key of ['legacyBackupFiles','legacyMigration','detachedBookmarks'])await storage.remove('settings',key);
});
it('previews without writes and preserves original text, note and character position through restore and ZIP re-export',async()=>{
  const zip=zipSync({'bookshelf.json':strToU8(JSON.stringify([{bookUrl:'https://bookmark.example.test/book',name:original.bookName,author:original.bookAuthor,type:0}])),'bookmark.json':strToU8(JSON.stringify([{...original,future:{kept:true}}])),'readConfig.json':strToU8('[{"paragraphIndent":"　","titleMode":2}]')});
  const before=JSON.parse(await storage.backup()),preview=await inspectBackup(zip,'');
  expect(JSON.parse(await storage.backup()).books).toEqual(before.books);
  const mark=preview.data.books[0].bookmarks[0];
  expect(mark).toMatchObject({chapter:2,chapterPos:371,chapterName:'Chapter three',bookText:original.bookText,content:original.content,positionLayout:{indent:1,titleVisible:false},future:{kept:true}});
  await storage.restore(JSON.stringify(preview.data));
  const archive=unzipSync(await createBackupArchive());expect(JSON.parse(strFromU8(archive['bookmark.json']))).toEqual([original]);
  expect((await readBackupArchive(await createBackupArchive())).books[0].bookmarks[0]).toEqual(mark);
});
it('keeps bookmark-only exports populated and restores edits by book ID while omitted annotations remain absent',async()=>{
  const book={...newBook('Standalone','txt',[{title:'Chapter',content:'Text'}],'Author'),bookmarks:[{chapter:0,offset:.4,title:'Chapter',created:1,chapterPos:12,bookText:'Text',content:'Note'}]};
  await storage.put('books',book.id,book);
  const bytes=await createBackupArchive({...defaultContent,bookshelf:false}),files=unzipSync(bytes),data=await readBackupArchive(bytes);
  expect(data.books).toEqual([]);expect(data.annotations[0]).toMatchObject({id:book.id,name:book.name,author:book.author});
  expect(JSON.parse(strFromU8(files['bookmark.json']))).toEqual([{time:1,bookName:book.name,bookAuthor:'Author',chapterIndex:0,chapterPos:12,chapterName:'Chapter',bookText:'Text',content:'Note'}]);
  await storage.put('books',book.id,{...book,note:'keep this note',bookmarks:[]});await storage.restore(JSON.stringify(data));
  expect((await storage.all<any>('books'))[0]).toMatchObject({note:'keep this note',bookmarks:book.bookmarks});
  const omitted=unzipSync(await createBackupArchive({...defaultContent,annotations:false}));
  expect(omitted['bookmark.json']).toBeUndefined();expect(JSON.parse(strFromU8(omitted['legado-tauri.json'])).books[0].bookmarks).toEqual([]);
});
it('validates annotations before any restore writes and respects annotation exclusions',async()=>{
  const book={...newBook('Integrity','txt',[{title:'C',content:'T'}]),bookmarks:[{chapter:0,offset:.1,title:'C',created:2,chapterPos:3,bookText:'T',content:'Keep'}]};
  await storage.put('books',book.id,book);
  const originalData=JSON.parse(await storage.backup()),invalid=JSON.parse(JSON.stringify(originalData));
  invalid.books[0].name='Should not persist';invalid.books[0].bookmarks[0].chapterPos=-1;
  await expect(storage.restore(JSON.stringify(invalid))).rejects.toThrow('书签');expect((await storage.all<any>('books'))[0]).toEqual(book);
  invalid.books=[];invalid.annotations=[{id:book.id,bookmarks:[{...book.bookmarks[0],content:{bad:true}}],highlights:[]}];
  await expect(storage.restore(JSON.stringify(invalid))).rejects.toThrow('书签');
  const replacement=JSON.parse(JSON.stringify(originalData));replacement.books[0].bookmarks=[];
  await storage.restore(JSON.stringify(replacement),['annotations']);expect((await storage.all<any>('books'))[0].bookmarks).toEqual(book.bookmarks);
});
it('rejects damaged upstream bookmark fields before presenting a restore preview',async()=>{
  await expect(inspectBackup(zipSync({'bookmark.json':strToU8(JSON.stringify([{...original,chapterPos:'371'}]))}), '')).rejects.toThrow('书签');
});
it('restores a bookmark-only archive by title and author and preserves unmatched bookmarks for later restore',async()=>{
  const matching={...newBook(original.bookName,'txt',[{title:'Local',content:'Local text'}],original.bookAuthor),id:'matching',offset:.6,note:'Library note',bookmarks:[{chapter:0,offset:0,title:'Keep',created:5}]};
  const other={...newBook(original.bookName,'txt',[{title:'Other',content:'Other text'}],'Different'),id:'other'};
  await storage.put('books',matching.id,matching);await storage.put('books',other.id,other);
  const unmatched={...original,time:1700000000001,bookName:'Not in library'},data=(await inspectBackup(zipSync({'bookmark.json':strToU8(JSON.stringify([original,unmatched]))}), '')).data;
  expect(data.books).toEqual([]);expect(data.managerPreferences.detachedBookmarks).toHaveLength(2);
  expect((await inspectBackup(zipSync({'bookmark.json':strToU8(JSON.stringify([original,unmatched]))}), '')).summary).toContain('2 条书签');
  await storage.restore(JSON.stringify(data),['annotations']);expect((await storage.all<any>('books')).find(book=>book.id===matching.id).bookmarks).toEqual(matching.bookmarks);
  await storage.restore(JSON.stringify(data));const restored=await storage.all<any>('books');
  expect(restored.find(book=>book.id===matching.id)).toMatchObject({offset:.6,note:'Library note',chapters:matching.chapters});
  expect(restored.find(book=>book.id===matching.id).bookmarks).toHaveLength(2);expect(restored.find(book=>book.id===other.id)).toEqual(other);
  expect((await storage.preference<any[]>('detachedBookmarks',[])).map(item=>item.record)).toEqual([unmatched]);
  const records=JSON.parse(strFromU8(unzipSync(await createBackupArchive())['bookmark.json']));expect(records).toContainEqual(original);expect(records).toContainEqual(unmatched);
  const ignored=await readBackupArchive(await createBackupArchive({...defaultContent,annotations:false}));expect(ignored.managerPreferences.detachedBookmarks).toBeUndefined();
  const newBookData={format:'legado-tauri',version:1,books:[{...newBook(unmatched.bookName,'txt',[{title:'Text',content:'Text'}],unmatched.bookAuthor),id:'later'}],sources:[],feeds:[],records:[],settings:{},managerPreferences:{}};
  await storage.restore(JSON.stringify(newBookData));expect((await storage.all<any>('books')).find(book=>book.id==='later').bookmarks[0]).toMatchObject({created:unmatched.time,chapterPos:unmatched.chapterPos,content:unmatched.content});
  expect(await storage.preference('detachedBookmarks',[])).toEqual([]);
});
