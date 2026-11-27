import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {strToU8,zipSync} from 'fflate';
import {bookmarksOnPage,createBookmark} from './bookmarks';
import {DEFAULT_SETTINGS,newBook} from './model';
import {readingParagraphs} from './highlight-engine';
import {createBackupArchive,defaultContent,readBackupArchive} from './backup-archive';
import * as storage from './storage';

it('finds exact marks in a half-open page range across title and indentation changes',()=>{
  const book=newBook('Public','txt',[{title:'Title',content:'One😀two\nThree end'},{title:'Other'}]),paragraphs=readingParagraphs(book.chapters[0].content!,6);
  book.bookmarks=[createBookmark(book,0,6,'One','Title',paragraphs,DEFAULT_SETTINGS,10),createBookmark(book,.5,11,'two','Title',paragraphs,{...DEFAULT_SETTINGS,titleAlign:'hidden',textIndent:4},11),
    createBookmark(book,.8,14,'Three','Title',paragraphs,DEFAULT_SETTINGS,12)];
  book.bookmarks.push({...book.bookmarks[0],chapter:1,created:13},{...book.bookmarks[0],chapterPos:9999,created:14},{chapter:0,offset:0,title:'legacy ratio',created:15});
  expect(bookmarksOnPage(book,{start:6,end:14},'Title',paragraphs,{...DEFAULT_SETTINGS,textIndent:0,titleAlign:'hidden'}).map(m=>m.created)).toEqual([10,11]);
  expect(bookmarksOnPage(book,{start:14,end:23},'Title',paragraphs,DEFAULT_SETTINGS).map(m=>m.created)).toEqual([12]);
  expect(book.bookmarks).toHaveLength(6);
});
it('imports only correctly typed official preferences and retains unrelated settings',async()=>{
  expect(DEFAULT_SETTINGS).toMatchObject({pullToToggleBookmark:false,pullBookmarkDistance:0});
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,fontSize:27,pullToToggleBookmark:true,pullBookmarkDistance:96});
  const archive=(xml:string)=>readBackupArchive(zipSync({'config.xml':strToU8('<map>'+xml+'</map>')}));
  const full=await archive('<boolean name="pullToToggleBookmark" value="true"/><int name="pullBookmarkDistance" value="120"/>');
  expect(full.settings).toMatchObject({pullToToggleBookmark:true,pullBookmarkDistance:120});
  await storage.restore(JSON.stringify(full));expect(await storage.settings()).toMatchObject({pullToToggleBookmark:true,pullBookmarkDistance:120,fontSize:27});
  const wrong=await archive('<string name="pullToToggleBookmark">false</string><string name="pullBookmarkDistance">3</string>');
  expect(wrong.settings.pullToToggleBookmark).toBeUndefined();expect(wrong.settings.pullBookmarkDistance).toBeUndefined();
  await storage.restore(JSON.stringify(wrong));expect((await storage.settings()).pullToToggleBookmark).toBe(true);
});
it('round-trips both settings, respects ignored/excluded settings and rejects invalid backup thresholds',async()=>{
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,pullToToggleBookmark:true,pullBookmarkDistance:124});
  const full=await readBackupArchive(await createBackupArchive()),omitted=await readBackupArchive(await createBackupArchive({...defaultContent,settings:false}));
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,pullToToggleBookmark:false,pullBookmarkDistance:52});
  await storage.restore(JSON.stringify(full),['reader']);expect(await storage.settings()).toMatchObject({pullToToggleBookmark:false,pullBookmarkDistance:52});
  await storage.restore(JSON.stringify(omitted));expect(await storage.settings()).toMatchObject({pullToToggleBookmark:false,pullBookmarkDistance:52});
  await storage.restore(JSON.stringify(full));expect(await storage.settings()).toMatchObject({pullToToggleBookmark:true,pullBookmarkDistance:124});
  for(const value of [-1,10000,1.5,'40',null])expect(()=>storage.validateBackup({...full,settings:{...full.settings,pullBookmarkDistance:value}})).toThrow('下拉书签设置');
});
