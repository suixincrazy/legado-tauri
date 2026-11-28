import 'fake-indexeddb/auto';
import {openDB} from 'idb';
import {expect,it} from 'vitest';

it('adds history to the previous own database while retaining all saved data including favorites',async()=>{
  const names=['books','sources','settings','records','feeds','sourceState','backups','rssFavorites'];
  const old=await openDB('legado-reader',4,{upgrade(db){for(const name of names)db.createObjectStore(name);}});
  const sentinel={id:'kept',content:'Existing offline data'};
  for(const name of names)await old.put(name,sentinel,name==='rssFavorites'?['https://feed.test','https://article.test']:'kept');
  old.close();
  const storage=await import('./storage');expect(await storage.all('rssHistory')).toEqual([]);
  const current=await openDB('legado-reader');expect(current.version).toBe(5);
  for(const name of names)expect(await current.getAll(name)).toEqual([sentinel]);current.close();
});
