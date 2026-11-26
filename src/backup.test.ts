import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import * as storage from './storage';
import {newBook} from './model';

it('backs up every persisted preference and restores it with complete local text and source state',async()=>{
  const book={...newBook('Backup fixture','txt',[{title:'第一章',content:'正文𠮷'}]),rawText:'第一章\n正文𠮷',offset:.42};
  await storage.put('books',book.id,book);
  await storage.put('settings','futurePreference',{unknown:'retained'});
  const source={bookSourceUrl:'https://backup.example.test',bookSourceName:'Backup fixture',extra:{retained:true}};
  await storage.saveSources([source]);await storage.saveSourceState(source.bookSourceUrl,{'source:loginInfo':{value:'fixture'}});
  const json=await storage.backup();
  expect(JSON.parse(json).managerPreferences.futurePreference).toEqual({unknown:'retained'});
  await storage.remove('books',book.id);await storage.remove('settings','futurePreference');
  await storage.restore(json);
  expect((await storage.all<any>('books')).find(row=>row.id===book.id)).toEqual(book);
  expect(await storage.preference('futurePreference',null)).toEqual({unknown:'retained'});
});
