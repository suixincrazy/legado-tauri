import 'fake-indexeddb/auto';
import {afterEach,expect,it} from 'vitest';
import {DEFAULT_SETTINGS,newBook,type Book,type BookGroup} from './model';
import {bookInGroup,effectiveShelfSort,groupBookSort,isUserBookGroup,sortBooks} from './bookshelf-model';
import * as storage from './storage';

const group=(id:string,bookSort=-1):BookGroup=>({id,name:id,bookSort,order:0,show:true,enableRefresh:true});
afterEach(async()=>{for(const b of await storage.all<Book>('books'))await storage.remove('books',b.id);});
it('lets each group override global ordering and return to live inheritance without mutating books',()=>{
  const books=[{...newBook('Z','txt',[{title:'Original',content:'Keep'}],'A'),id:'z',lastRead:20,order:1,latestChapterTime:1},{...newBook('A','txt',[],'Z'),id:'a',lastRead:10,order:2,latestChapterTime:30}],before=structuredClone(books);
  const names=group('names',2),recent=group('recent',0);
  expect(sortBooks(books,effectiveShelfSort(names,'author')).map(b=>b.id)).toEqual(['a','z']);
  expect(sortBooks(books,effectiveShelfSort(recent,'author')).map(b=>b.id)).toEqual(['z','a']);
  expect(effectiveShelfSort({...names,bookSort:-1},'author')).toBe('author');
  expect(effectiveShelfSort({...names,bookSort:-1},'manual')).toBe('manual');
  expect(effectiveShelfSort(undefined,'updated')).toBe('updated');
  expect(Array.from({length:6},(_,i)=>effectiveShelfSort(group('g',i),'author'))).toEqual(['recent','updated','name','manual','combined','author']);
  expect(books).toEqual(before);
});
it('reads older SQLite groups from legacy data but a new explicit default takes precedence',()=>{
  const old={...group('old'),bookSort:undefined,legacy:{bookSort:5,cover:'keep'}};
  expect(groupBookSort(old)).toBe(5);expect(groupBookSort({...old,bookSort:-1})).toBe(-1);
  for(const bad of [null,'2',99,-9,1.1])expect(groupBookSort({...group('g'),bookSort:bad as any})).toBe(-1);
});
it('filters imported built-in groups and keeps them out of manual assignments without relying on names',()=>{
  const groups=[group('custom'),group('legado-group--2'),group('legado-group--9223372036854775808')];
  const local={...newBook('Public','txt',[{title:'A'},{title:'B'},{title:'C'}]),groups:['custom'],chapter:1,lastRead:12};
  expect(bookInGroup(local,'legado-group--2',groups)).toBe(true);
  expect(bookInGroup(local,'legado-group--5',groups)).toBe(false);
  expect(bookInGroup({...local,groups:[]},'legado-group--5',groups)).toBe(true);
  expect(bookInGroup({...local,kind:'online',groups:[]},'legado-group--4',groups)).toBe(true);
  expect(bookInGroup({...local,kind:'online',legacy:{type:32}} as any,'legado-group--3',groups)).toBe(true);
  expect(bookInGroup(local,'legado-group--20',groups)).toBe(true);
  expect(bookInGroup(local,'legado-group--1',groups)).toBe(true);
  expect(bookInGroup(local,'custom',groups)).toBe(true);expect(bookInGroup(local,'missing',groups)).toBe(false);
  expect(groups.filter(isUserBookGroup).map(g=>g.id)).toEqual(['custom','legado-group--9223372036854775808']);
});
it('persists filtered manual reordering atomically with hidden slots and current book contents intact',async()=>{
  const initial=['a','x','b','y'].map((id,i)=>({...newBook(id,'txt',[{title:'Latest',content:'Original '+id}]),id,order:i+1,groups:id==='x'||id==='y'?['g']:[],bookmarks:[{chapter:0,offset:0,title:'Keep',created:12}]}));
  for(const book of initial)await storage.put('books',book.id,book);
  await storage.put('books','y',{...initial[3],note:'Latest concurrent note'});
  await storage.saveShelfOrder(['missing','y','x','y']);
  const result=sortBooks(await storage.all<Book>('books'),'manual');expect(result.map(b=>b.id)).toEqual(['a','y','b','x']);
  for(const book of result)expect({...book,order:undefined}).toEqual({...initial.find(b=>b.id===book.id),note:book.id==='y'?'Latest concurrent note':'',order:undefined});
  expect((await storage.saveShelfOrder(['missing'])).size).toBe(0);
  expect(DEFAULT_SETTINGS.shelfSort).toBe('recent');
});
