import {afterEach,expect,it,vi} from 'vitest';
import {newBook,type Book,type BookGroup} from './model';
import {bookInGroup,booksForShelfUpdate,groupOnlyUpdateRead} from './bookshelf-model';
import {bindShelfRefresh} from './shelf-refresh';

const group=(id:string,onlyUpdateRead=false):BookGroup=>({id,name:id,order:0,show:true,enableRefresh:true,onlyUpdateRead});
const online=(name:string,chapter=0):Book=>({...newBook(name,'online',[{title:'First'},{title:'Middle'},{title:'Last'}]),id:name,chapter,groups:['a']});
afterEach(()=>vi.restoreAllMocks());
it('updates caught-up catalogs, not merely opened or manually marked finished books',()=>{
  const books=[online('Unread'),{...online('Opened',1),lastRead:20},{...online('Marked',1),finished:true},online('Caught up',2),{...online('Disabled',2),canUpdate:false},{...online('Local',2),kind:'txt' as const}];
  expect(booksForShelfUpdate(books,group('a',true)).map(b=>b.id)).toEqual(['Caught up']);
  expect(booksForShelfUpdate(books,group('a')).map(b=>b.id)).toEqual(['Unread','Opened','Marked','Caught up']);
  expect(booksForShelfUpdate(books,undefined).map(b=>b.id)).toEqual(['Unread','Opened','Marked','Caught up']);
});
it('uses imported progress before a catalog loads and includes a known empty catalog',()=>{
  const inherited={...online('Original'),chapters:[],legacy:{totalChapterNum:12},legacyPosition:{chapter:10,position:20,indent:2,titleVisible:true}};
  expect(booksForShelfUpdate([inherited],group('a',true))).toEqual([]);
  const last={...inherited,legacyPosition:{...inherited.legacyPosition,chapter:11}};
  expect(booksForShelfUpdate([last],group('a',true))).toEqual([last]);
  const empty={...online('Empty'),chapters:[]};expect(booksForShelfUpdate([empty],group('a',true))).toEqual([empty]);
});
it('keeps the active group scope and permits overlapping books in a manually refreshed group',()=>{
  const a=group('a',true),b={...group('b'),enableRefresh:false},groups=[a,b];
  const books=[{...online('Both',2),groups:['a','b']},online('A unread'),{...online('B unread'),groups:['b']}];
  const update=(id:string,g:BookGroup|undefined)=>booksForShelfUpdate(books.filter(book=>bookInGroup(book,id,groups)),g).map(book=>book.id);
  expect(update('a',a)).toEqual(['Both']);expect(update('b',b)).toEqual(['Both','B unread']);
  expect(update('全部',undefined)).toEqual(['Both','A unread','B unread']);
  expect(update('全部',group('legado-group--1',true))).toEqual(['Both']);
  expect(update('missing',undefined)).toEqual([]);
});
it('reads old SQLite values and lets an explicit unchecked selection override preserved legacy data',()=>{
  expect(groupOnlyUpdateRead({legacy:{onlyUpdateRead:1}})).toBe(true);
  expect(groupOnlyUpdateRead({onlyUpdateRead:false,legacy:{onlyUpdateRead:true}})).toBe(false);
  expect(groupOnlyUpdateRead(undefined)).toBe(false);
  expect(groupOnlyUpdateRead({legacy:{onlyUpdateRead:'false'}})).toBe(false);
});
it('uses the pinned simulated-reading day component including month boundaries and legacy date objects',()=>{
  const current=new Date(2026,10,28),base={...online('Simulated'),chapters:[],legacyPosition:{chapter:0,position:0,indent:2,titleVisible:true}};
  const eligible=(config:Record<string,unknown>,chapter:number)=>booksForShelfUpdate([{...base,legacyPosition:{...base.legacyPosition,chapter},legacy:{totalChapterNum:100,readConfig:config}}],group('a',true),current).length===1;
  expect(eligible({readSimulating:true,startDate:'2026-11-26',dailyChapters:2},4)).toBe(false);
  expect(eligible({readSimulating:true,startDate:'2026-11-26',dailyChapters:2},5)).toBe(true);
  expect(eligible({readSimulating:true,startDate:'2026-10-28',dailyChapters:2},1)).toBe(true);
  expect(eligible({readSimulating:true,startDate:{year:2026,month:10,day:31},dailyChapters:1},27)).toBe(false);
  expect(eligible({readSimulating:true,startDate:'2026-10-31',dailyChapters:1},28)).toBe(true);
  expect(eligible({readSimulating:true,startDate:'2026-12-01',dailyChapters:2},0)).toBe(true);
  expect(eligible({readSimulating:true,startChapter:4},5)).toBe(false);
  expect(eligible({readSimulating:true,startChapter:4},6)).toBe(true);
});
it('refreshes only a completed vertical touch pull at the top, cancels retreat, horizontal and multiple touches, and excludes reorder grips',()=>{
  const main=document.createElement('main'),grip=document.createElement('button');grip.className='shelf-reorder';main.append(grip);document.body.append(main);
  const refreshed=vi.fn(),off=bindShelfRefresh(main,refreshed);
  const event=(type:string,x:number,y:number,target:Element=main,multi=false)=>{
    const touch={identifier:1,clientX:x,clientY:y},e=new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(e,{touches:{value:type==='touchend'?[]:multi?[touch,{...touch,identifier:2}]:[touch]},changedTouches:{value:[touch]}});target.dispatchEvent(e);return e;
  };
  const pull=(target:Element=main)=>{event('touchstart',100,50,target);event('touchmove',102,190,target);event('touchend',102,190,target);};
  try{
    pull();expect(refreshed).toHaveBeenCalledTimes(1);
    event('touchstart',100,50);event('touchmove',100,210);event('touchend',100,100);expect(refreshed).toHaveBeenCalledTimes(1);
    event('touchstart',100,50);event('touchmove',250,70);event('touchend',102,200);expect(refreshed).toHaveBeenCalledTimes(1);
    event('touchstart',100,50);event('touchmove',100,210,main,true);event('touchend',100,210);
    event('touchstart',100,50);event('touchcancel',100,190);event('touchend',100,190);
    main.scrollTop=20;pull();main.scrollTop=0;pull(grip);expect(refreshed).toHaveBeenCalledTimes(1);
    off();pull();expect(refreshed).toHaveBeenCalledTimes(1);
  }finally{off();main.remove();}
});
