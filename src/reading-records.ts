import {createId,type Book,type ReadingRecord} from './model';

const string=(value:unknown)=>typeof value==='string'?value:undefined;
export function originalRecordIdentity(record:ReadingRecord){
  const row=record.legacy;
  if(!/^legado-record-[a-f\d]{64}$/.test(record.id)||!row||typeof row.deviceId!=='string'||typeof row.bookName!=='string'||typeof row.author!=='string')return undefined;
  return JSON.stringify([row.deviceId,row.bookName,row.author]);
}
export function readingRecordAuthor(record:ReadingRecord,books:Book[]):string|undefined {
  return record.author??string(record.legacy?.author)??books.find(book=>book.id===record.bookId&&book.name===record.bookName)?.author;
}
export function readingRecordSnapshot(record:ReadingRecord,book:Book):ReadingRecord {
  const author=readingRecordAuthor(record,[]);
  if(record.bookId!==book.id||record.bookName!==book.name||author!==undefined&&author!==book.author)return record;
  return {...record,author:book.author,cover:book.cover||record.cover||string(record.legacy?.coverUrl)||''};
}
export function startReadingRecord(book:Book,chapter:string,started=Date.now()):ReadingRecord {
  return {id:createId(),bookId:book.id,bookName:book.name,author:book.author,cover:book.cover||'',chapter,started,seconds:0};
}
export type ReadingRecordRow={key:string;name:string;author?:string;seconds:number;started:number;chapter:string;cover?:string;book?:Book};
export function readingRecordRows(records:ReadingRecord[],books:Book[]):ReadingRecordRow[] {
  const byIdentity=new Map<string,Book>();
  for(const book of [...books].sort((a,b)=>a.lastRead-b.lastRead))byIdentity.set(JSON.stringify([book.name,book.author]),book);
  const rows=new Map<string,ReadingRecordRow>();
  for(const record of [...records].sort((a,b)=>b.started-a.started)){
    const name=string(record.legacy?.displayBookName)?.trim()||record.bookName;
    const originalAuthor=readingRecordAuthor(record,books);
    const author=string(record.legacy?.displayAuthor)??(originalAuthor===''?string(record.legacy?.resolvedAuthor)??'':originalAuthor);
    const key=author===undefined?JSON.stringify(['unknown',name,record.bookId||record.id]):JSON.stringify([name,author]);
    const cover=record.cover??string(record.legacy?.coverUrl),old=rows.get(key);
    if(old){old.seconds+=record.seconds;continue;}
    const book=author===undefined?undefined:byIdentity.get(JSON.stringify([name,author]));
    rows.set(key,{key,name,author,seconds:record.seconds,started:record.started,chapter:book?.chapters[book.chapter]?.title||record.chapter,cover,book});
  }
  return [...rows.values()];
}
export function originalReadingRecords(records:ReadingRecord[],books:Book[]){
  const rows=new Map<string,Record<string,unknown>&{readTime:number}>();
  for(const record of [...records].sort((a,b)=>b.started-a.started)){
    const author=readingRecordAuthor(record,books)??'',deviceId=string(record.legacy?.deviceId)??'';
    const key=JSON.stringify([deviceId,record.bookName,author]),old=rows.get(key);
    const millis=Math.round(record.seconds*1000);
    if(old){old.readTime+=millis;continue;}
    rows.set(key,{...record.legacy,deviceId,bookName:record.bookName,author,coverUrl:record.cover??record.legacy?.coverUrl??'',readTime:millis,lastRead:record.started,lastChapterTitle:record.chapter});
  }
  return [...rows.values()];
}
