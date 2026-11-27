import type {Book,Bookmark,Settings} from './model';
import {legacyTextPosition,toLegacyPosition} from './legacy-position';

type BookmarkBook = Pick<Book,'name'|'author'|'bookmarks'> & {chapters?:Pick<Book['chapters'][number],'title'>[]};
export type LegadoBookmark = {time:number;bookName:string;bookAuthor:string;chapterIndex:number;chapterPos:number;chapterName:string;bookText:string;content:string};
type Layout = NonNullable<Bookmark['positionLayout']>;
export type DetachedBookmark = {record:LegadoBookmark;positionLayout:Layout;bookmark?:Bookmark};
export const bookIdentity=(name:string,author:string)=>JSON.stringify([name,author]);
export const recordIdentity=(row:LegadoBookmark)=>JSON.stringify([row.bookName,row.bookAuthor,row.time]);
const natural = (value:unknown) => Number.isSafeInteger(value) && (value as number)>=0;

export function validBookmark(value:unknown):value is Bookmark {
  const m=value as Bookmark|null;
  return !!m&&natural(m.chapter)&&Number.isFinite(m.offset)&&m.offset>=0&&m.offset<=1&&natural(m.created)&&typeof m.title==='string'&&
    (m.chapterPos===undefined||natural(m.chapterPos))&&[m.chapterName,m.bookText,m.content].every(v=>v===undefined||typeof v==='string')&&
    (m.positionLayout===undefined||!!m.positionLayout&&natural(m.positionLayout.indent)&&typeof m.positionLayout.titleVisible==='boolean');
}
export function readLegadoBookmark(row:LegadoBookmark,layout:Layout):Bookmark {
  if(!row||!natural(row.time)||!natural(row.chapterIndex)||!natural(row.chapterPos)||
    [row.bookName,row.bookAuthor,row.chapterName,row.bookText,row.content].some(v=>typeof v!=='string'))throw new Error('原版书签数据损坏');
  if(!layout||!natural(layout.indent)||typeof layout.titleVisible!=='boolean')throw new Error('书签排版位置损坏');
  return {...row,chapter:row.chapterIndex,title:row.chapterName,offset:0,created:row.time,positionLayout:layout};
}
export function bookmarkRecord(book:BookmarkBook,mark:Bookmark):LegadoBookmark {
  const chapterName=mark.chapterName??book.chapters?.[mark.chapter]?.title??mark.title;
  return {time:mark.created,bookName:book.name,bookAuthor:book.author,chapterIndex:mark.chapter,chapterPos:mark.chapterPos??0,chapterName,
    bookText:mark.bookText??(mark.title!==chapterName?mark.title:''),content:mark.content??''};
}
export function detachBookmark(book:BookmarkBook,mark:Bookmark,layout:Layout):DetachedBookmark {
  return {record:bookmarkRecord(book,mark),positionLayout:mark.positionLayout??layout,bookmark:mark};
}
export function detachedMark(item:DetachedBookmark):Bookmark {
  const mark=readLegadoBookmark(item.record,item.positionLayout);
  if(!item.bookmark)return mark;
  if(!validBookmark(item.bookmark))throw new Error('备份书签损坏');
  return {...mark,...item.bookmark,created:mark.created,chapter:mark.chapter,chapterName:mark.chapterName,bookText:mark.bookText,content:mark.content,
    chapterPos:item.bookmark.chapterPos===undefined?undefined:mark.chapterPos,positionLayout:item.positionLayout};
}
export function reconcileBookmarks(books:Book[],items:DetachedBookmark[],incoming=new Set<string>()) {
  const groups=new Map<string,DetachedBookmark[]>();
  for(const item of new Map(items.map(item=>[recordIdentity(item.record),item])).values()){
    const key=bookIdentity(item.record.bookName,item.record.bookAuthor),group=groups.get(key)||[];group.push(item);groups.set(key,group);
  }
  const matched=new Set<string>();
  const next=books.map(book=>{
    const key=bookIdentity(book.name,book.author),group=groups.get(key);if(!group)return book;
    const marks=new Map(book.bookmarks.map(mark=>[mark.created,mark]));
    for(const item of group)if(!marks.has(item.record.time)||incoming.has(recordIdentity(item.record)))marks.set(item.record.time,detachedMark(item));
    matched.add(key);return {...book,bookmarks:[...marks.values()]};
  });
  return {books:next,detached:[...groups].filter(([key])=>!matched.has(key)).flatMap(([,group])=>group)};
}
export function createBookmark(book:Book,offset:number,start:number,text:string,title:string,paragraphs:{text:string;start:number}[],prefs:Settings,now=Date.now()):Bookmark {
  const layout={indent:prefs.textIndent,titleVisible:prefs.titleAlign!=='hidden'};
  while(book.bookmarks.some(mark=>mark.created===now))now++;
  return {chapter:book.chapter,offset,created:now,title,chapterName:title,bookText:text,content:'',
    chapterPos:toLegacyPosition(start,title,paragraphs,layout.indent,layout.titleVisible),positionLayout:layout};
}
export function atBookmark(book:Book,mark:Bookmark,prefs:Settings):Book {
  if(!book.chapters[mark.chapter])throw new Error('当前目录中没有这条书签的章节');
  const layout=mark.positionLayout??{indent:prefs.textIndent,titleVisible:prefs.titleAlign!=='hidden'};
  return {...book,chapter:mark.chapter,offset:mark.offset,syncPosition:undefined,
    legacyPosition:mark.chapterPos===undefined?undefined:{chapter:mark.chapter,position:mark.chapterPos,...layout}};
}
export function bookmarksOnPage(book:Book,range:{start:number;end:number},title:string,paragraphs:{text:string;start:number}[],prefs:Settings) {
  const last=paragraphs[paragraphs.length-1];
  return book.bookmarks.filter(mark=>{
    if(mark.chapter!==book.chapter||mark.chapterPos===undefined)return false;
    const anchor=atBookmark(book,mark,prefs),layout=anchor.legacyPosition!;
    const length=last?toLegacyPosition(last.start+last.text.length-1,title,paragraphs,layout.indent,layout.titleVisible)+1:layout.titleVisible?title.length:0;
    if(mark.chapterPos>=length)return false;
    const pos=legacyTextPosition(anchor,title,paragraphs);
    return pos!==null&&pos>=range.start&&pos<range.end;
  });
}
function compareRows(a:{record:LegadoBookmark;mark:Bookmark},b:{record:LegadoBookmark;mark:Bookmark}) {
  return a.record.bookName.localeCompare(b.record.bookName,'zh-CN')||a.record.bookAuthor.localeCompare(b.record.bookAuthor,'zh-CN')||
    a.mark.chapter-b.mark.chapter||(a.mark.chapterPos??0)-(b.mark.chapterPos??0)||a.mark.offset-b.mark.offset||a.mark.created-b.mark.created;
}
function attachedRows<T extends BookmarkBook>(books:readonly T[]) {
  return books.flatMap(book=>book.bookmarks.map((mark,index)=>({book,mark,index,record:bookmarkRecord(book,mark)})));
}
export function bookmarkRows<T extends BookmarkBook>(books:readonly T[]) {
  return attachedRows(books).sort(compareRows);
}
export function managedBookmarkRows(books:Book[],detached:DetachedBookmark[]=[]) {
  type Row={key:string;book?:Book;mark:Bookmark;index:number;record:LegadoBookmark;detached?:DetachedBookmark};
  const rows:Row[]=[],seen=new Set<string>(),shelf=new Map<string,Book>();
  for(const book of books){const key=bookIdentity(book.name,book.author);if(!shelf.has(key))shelf.set(key,book);}
  for(const row of attachedRows(books)){
    const key=recordIdentity(row.record);if(seen.has(key))continue;seen.add(key);rows.push({...row,key});
  }
  for(const item of detached){
    const identity=recordIdentity(item.record);if(seen.has(identity))continue;seen.add(identity);
    const mark=detachedMark(item),record=bookmarkRecord({name:item.record.bookName,author:item.record.bookAuthor,bookmarks:[]},mark);
    rows.push({key:identity,book:shelf.get(bookIdentity(record.bookName,record.bookAuthor)),mark,index:-1,record,detached:item});
  }
  return rows.sort(compareRows);
}
export function bookmarkFile(books:Book[],format:'json'|'md',single?:Book,date=new Date(),detached:DetachedBookmark[]=[]) {
  const rows=managedBookmarkRows(single?[single]:books,single?[]:detached);
  const stamp=[date.getFullYear()%100,date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds()].map(n=>String(n).padStart(2,'0')).join('');
  const suffix=single?(single.name+' '+single.author).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().slice(0,100):stamp;
  const name='bookmark-'+suffix+'.'+format;
  if(format==='json')return {name,text:JSON.stringify(rows.map(row=>row.record),null,2)};
  let text=single?'## '+single.name+' '+single.author+'\n\n':'',previous=single?bookIdentity(single.name,single.author):undefined;
  for(const {record} of rows){
    const identity=bookIdentity(record.bookName,record.bookAuthor);
    if(previous!==identity)text+='## '+record.bookName+' '+record.bookAuthor+'\n\n';
    previous=identity;
    text+='#### '+record.chapterName+'\n\n###### 原文\n '+record.bookText+'\n\n###### 摘要\n '+record.content+'\n\n';
  }
  return {name,text};
}
