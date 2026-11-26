import type {Book,Bookmark,Settings} from './model';
import {toLegacyPosition} from './legacy-position';

type BookmarkBook = Pick<Book,'name'|'author'|'bookmarks'> & {chapters?:Pick<Book['chapters'][number],'title'>[]};
export type LegadoBookmark = {time:number;bookName:string;bookAuthor:string;chapterIndex:number;chapterPos:number;chapterName:string;bookText:string;content:string};
type Layout = NonNullable<Bookmark['positionLayout']>;
export type DetachedBookmark = {record:LegadoBookmark;positionLayout:Layout};
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
export function bookmarkRows<T extends BookmarkBook>(books:readonly T[]) {
  return books.flatMap(book=>book.bookmarks.map((mark,index)=>({book,mark,index,record:bookmarkRecord(book,mark)}))).sort((a,b)=>
    a.book.name.localeCompare(b.book.name,'zh-CN')||a.book.author.localeCompare(b.book.author,'zh-CN')||
    a.mark.chapter-b.mark.chapter||(a.mark.chapterPos??0)-(b.mark.chapterPos??0)||a.mark.offset-b.mark.offset||a.mark.created-b.mark.created);
}
export function bookmarkFile(books:Book[],format:'json'|'md',single?:Book,date=new Date()) {
  const rows=bookmarkRows(single?[single]:books);
  const stamp=[date.getFullYear()%100,date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds()].map(n=>String(n).padStart(2,'0')).join('');
  const suffix=single?(single.name+' '+single.author).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().slice(0,100):stamp;
  const name='bookmark-'+suffix+'.'+format;
  if(format==='json')return {name,text:JSON.stringify(rows.map(row=>row.record),null,2)};
  let text=single?'## '+single.name+' '+single.author+'\n\n':'',previous=single;
  for(const {book,record} of rows){
    if(!previous||previous.name!==book.name||previous.author!==book.author)text+='## '+book.name+' '+book.author+'\n\n';
    previous=book;
    text+='#### '+record.chapterName+'\n\n###### 原文\n '+record.bookText+'\n\n###### 摘要\n '+record.content+'\n\n';
  }
  return {name,text};
}
