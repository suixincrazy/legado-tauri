import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {newBook,type ReadingRecord} from './model';
import {originalReadingRecords,readingRecordRows,readingRecordSnapshot,startReadingRecord} from './reading-records';
import * as storage from './storage';

const book=(id:string,author:string,cover='data:image/png;base64,eA==')=>({...newBook('Same title','txt',[{title:'Current',content:'Original body'}],author),id,cover,lastRead:5});
const record=(id:string,bookId:string,extra:Partial<ReadingRecord>={}):ReadingRecord=>({id,bookId,bookName:'Same title',chapter:'Saved chapter',started:100,seconds:7,...extra});

it('sums display time by name and known author without changing raw sessions or mixing namesakes',()=>{
  const books=[book('a','Author A'),book('b','Author B'),{...book('new','Author A'),lastRead:9,cover:'https://example.test/latest.png'}];
  const records=[record('one','a',{started:10,seconds:20}),record('two','a',{author:'Author A',started:30,seconds:40,cover:'saved'}),record('three','b',{author:'Author B',seconds:5})];
  const before=structuredClone({books,records});const rows=readingRecordRows(records,books);
  expect(rows).toHaveLength(2);expect(rows.find(r=>r.author==='Author A')).toMatchObject({seconds:60,cover:'saved',book:{id:'new'}});
  expect(rows.reduce((n,r)=>n+r.seconds,0)).toBe(65);expect({books,records}).toEqual(before);
});
it('keeps unknown identities separate and never borrows a same-name author or cover',()=>{
  const rows=readingRecordRows([record('one',''),record('two',''),record('three','deleted'),record('four','deleted'),record('five','a',{author:'Wrong author'})],[book('a','Author A')]);
  expect(rows).toHaveLength(4);expect(rows.every(r=>r.book===undefined)).toBe(true);
  expect(rows.find(r=>r.seconds===14)?.author).toBeUndefined();
  expect(readingRecordRows([record('empty','',{legacy:{author:''}})],[book('blank','')])[0].book?.id).toBe('blank');
});
it('uses preserved original display identities without rewriting original record keys',()=>{
  const books=[{...book('renamed','Display author'),name:'Display title'}];
  const rec=record('edited','',{author:'Original author',legacy:{displayBookName:'Display title',displayAuthor:'Display author',metadataEditedAt:50}});
  expect(readingRecordRows([rec],books)[0]).toMatchObject({name:'Display title',author:'Display author',book:{id:'renamed'}});
  expect(originalReadingRecords([rec],books)[0]).toMatchObject({bookName:'Same title',author:'Original author',displayAuthor:'Display author',metadataEditedAt:50});
});
it('captures metadata when reading starts and when removing only the matching book',async()=>{
  const current={...book('delete-me','Author A'),bookmarks:[{chapter:0,offset:.2,title:'Bookmark',created:1}],note:'Original'};
  const next=book('keep-me','Author B');await storage.saveBook(current);await storage.saveBook(next);
  const rec=record('record',current.id,{legacy:{future:'preserve'}});const unrelated=record('different','keep-me',{author:'Author B'});
  await storage.put('records',rec.id,rec);await storage.put('records',unrelated.id,unrelated);await storage.removeBooks([current.id]);
  expect(await storage.all('books')).toEqual([next]);
  const all=await storage.all<ReadingRecord>('records');expect(all.find(r=>r.id===rec.id)).toEqual({...rec,author:'Author A',cover:current.cover});
  expect(all.find(r=>r.id===unrelated.id)).toEqual(unrelated);
  expect((await storage.preference<any[]>('detachedBookmarks',[]))[0].record.bookName).toBe(current.name);
  const opened=startReadingRecord(current,'Actual chapter',50);expect(opened).toMatchObject({bookId:current.id,author:'Author A',cover:current.cover,started:50,seconds:0,chapter:'Actual chapter'});
  expect(readingRecordSnapshot({...rec,author:'Author B'},current)).toEqual({...rec,author:'Author B'});
});
it('projects compatible history as one total per device/name/author with newest snapshot and unknown fields',()=>{
  const a=record('a','',{author:'Author A',started:1,seconds:11,legacy:{deviceId:'device-a',future:1},cover:'old'});
  const b={...a,id:'b',started:4,seconds:20,cover:'new',legacy:{deviceId:'device-a',future:2}};
  const c={...b,id:'c',seconds:3,legacy:{deviceId:'device-b'}},d={...b,id:'d',seconds:2,author:'Author B'};
  const raw=[a,b,c,d],copy=structuredClone(raw),out=originalReadingRecords(raw,[]);
  expect(out).toHaveLength(3);expect(out.find(row=>row.deviceId==='device-a'&&row.author==='Author A')).toMatchObject({readTime:31000,coverUrl:'new',lastRead:4,future:2});
  expect(out.reduce((n,row)=>n+row.readTime,0)).toBe(36000);expect(raw).toEqual(copy);
});
