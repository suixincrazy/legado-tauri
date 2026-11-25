import { expect,it } from 'vitest';
import { newBook } from './model';
import { sortBooks,unreadChapters } from './bookshelf-model';

it('keeps pinned books first and separates reading, update, manual and comprehensive ordering',()=>{
  const first={...newBook('A','txt',[{title:'1'},{title:'2'},{title:'3'}]),lastRead:20,latestChapterTime:1,order:2};
  const second={...first,id:'second',name:'B',lastRead:10,latestChapterTime:30,order:1};
  expect(sortBooks([first,second],'recent')[0].id).toBe(first.id);
  for(const sort of ['updated','combined','manual'] as const)expect(sortBooks([first,second],sort)[0].id).toBe(second.id);
  expect(sortBooks([first,{...second,pinned:true}],'name')[0].id).toBe(second.id);
  expect(unreadChapters({...first,chapter:1})).toBe(1);
  expect(unreadChapters({...first,finished:true})).toBe(0);
  expect(first.order).toBe(2);
});
