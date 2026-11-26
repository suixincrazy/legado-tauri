import {expect,it} from 'vitest';
import {atBookmark,bookmarkFile,bookmarkRows,createBookmark,readLegadoBookmark,validBookmark} from './bookmarks';
import {DEFAULT_SETTINGS,newBook,type Bookmark} from './model';
import {readingParagraphs} from './highlight-engine';
import {legacyTextPosition,toLegacyPosition} from './legacy-position';

const record={time:1700000000000,bookName:'公开书签',bookAuthor:'甲',chapterIndex:0,chapterPos:9,chapterName:'章一',bookText:'甲😀乙\n丙丁',content:'保留的摘要'};
it('round-trips official UTF-16 positions including title, indentation and hidden-title settings',()=>{
  const book=newBook(record.bookName,'txt',[{title:'章一',content:record.bookText}],record.bookAuthor),paragraphs=readingParagraphs(record.bookText,3);
  for(const titleVisible of [true,false])for(const indent of [0,2]){
    const prefs={...DEFAULT_SETTINGS,textIndent:indent,titleAlign:titleVisible?'left' as const:'hidden' as const};
    for(const start of [3,4,5,6,8,9]){
      const mark=createBookmark(book,.7,start,'节选','章一',paragraphs,prefs);
      expect(legacyTextPosition(atBookmark(book,mark,{...prefs,textIndent:4}),'章一',paragraphs)).toBe(start);
    }
  }
  expect(toLegacyPosition(0,'章一',paragraphs,2,true)).toBe(0);
  expect(toLegacyPosition(1,'章一',paragraphs,2,true)).toBe(1);
});
it('keeps distinct creation IDs, uses legacy offset fallback and rejects missing target chapters',()=>{
  const original:Bookmark={chapter:0,offset:.75,title:'Old selection',created:123};
  const book={...newBook('Old','txt',[{title:'Chapter',content:'Text'}]),bookmarks:[original],legacyPosition:{chapter:0,position:99,indent:2,titleVisible:true},syncPosition:{chapter:0,position:99}};
  const mark=createBookmark(book,.6,8,'text','Chapter',[],DEFAULT_SETTINGS,123);expect(mark.created).toBe(124);expect(book.bookmarks).toEqual([original]);
  expect(atBookmark(book,original,DEFAULT_SETTINGS)).toMatchObject({chapter:0,offset:.75,legacyPosition:undefined,syncPosition:undefined});
  expect(()=>atBookmark(book,{...original,chapter:4},DEFAULT_SETTINGS)).toThrow('没有');
});
it('exports all official JSON fields without exposing local identifiers or metadata and retains old selected text',()=>{
  const mark={...readLegadoBookmark(record,{indent:2,titleVisible:true}),privateExtra:'not exported'};
  const book={...newBook(record.bookName,'txt',[{title:'renamed chapter'}],record.bookAuthor),bookmarks:[mark]};
  const file=bookmarkFile([book],'json',book);
  expect(file.name).toBe('bookmark-公开书签 甲.json');expect(JSON.parse(file.text)).toEqual([record]);expect(file.text).not.toContain('privateExtra');
  const old={...book,bookmarks:[{chapter:0,offset:.8,created:12,title:'selected old text'}]};
  expect(bookmarkRows([old])[0].record).toMatchObject({chapterName:'renamed chapter',bookText:'selected old text',chapterPos:0,content:''});
});
it('sorts by book and chapter without mutating stored order and emits headings when either author or title changes',()=>{
  const mark=readLegadoBookmark(record,{indent:2,titleVisible:true});
  const a={...newBook('A','txt',[], 'Same'),bookmarks:[{...mark,chapter:2,created:3},{...mark,chapter:1,created:2}]};
  const b={...a,id:'b',name:'B'},c={...b,id:'c',author:'Different'};
  const before=JSON.stringify([b,a,c]),file=bookmarkFile([b,a,c],'md',undefined,new Date(2026,10,27,4,5,6));
  expect(file.name).toBe('bookmark-261127040506.md');
  expect(file.text.match(/^## /gm)).toHaveLength(3);expect(file.text).toContain('## A Same\n\n');expect(file.text).toContain('## B Same\n\n');expect(file.text).toContain('## B Different\n\n');
  expect(file.text).toContain('###### 原文\n 甲😀乙\n丙丁\n\n###### 摘要\n 保留的摘要\n\n');
  expect(bookmarkRows([a]).map(row=>row.mark.chapter)).toEqual([1,2]);expect(JSON.stringify([b,a,c])).toBe(before);
  expect(bookmarkFile([a],'json',{...a,name:'Bad/:?*',author:'X\\Y'}).name).toBe('bookmark-Bad____ X_Y.json');
});
it('rejects malformed text and character anchors while accepting old bookmarks without the new fields',()=>{
  const mark=readLegadoBookmark(record,{indent:2,titleVisible:true});
  for(const partial of [{chapterPos:-1},{chapterPos:1.5},{chapterPos:Infinity},{bookText:{}},{content:7},{positionLayout:{indent:-1,titleVisible:true}},{positionLayout:null}]){
    expect(validBookmark({...mark,...partial})).toBe(false);
  }
  expect(validBookmark({chapter:0,offset:.2,title:'Old',created:0})).toBe(true);
  expect(()=>readLegadoBookmark({...record,chapterPos:-1},{indent:2,titleVisible:true})).toThrow('损坏');
});
