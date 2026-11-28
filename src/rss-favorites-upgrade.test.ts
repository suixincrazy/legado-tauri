import 'fake-indexeddb/auto';
import {openDB} from 'idb';
import {expect,it} from 'vitest';

it('upgrades the previous database and preserves all existing stores and saved content',async()=>{
  const old=await openDB('legado-reader',3,{upgrade(db){for(const name of ['books','sources','settings','records','feeds','sourceState','backups'])db.createObjectStore(name);}});
  const sentinel={id:'kept',body:'Previously saved local data'};
  for(const store of old.objectStoreNames)await old.put(store,sentinel,'kept');
  old.close();
  const storage=await import('./storage');expect(await storage.all('rssFavorites')).toEqual([]);
  const current=await openDB('legado-reader');expect(current.version).toBe(5);
  for(const store of ['books','sources','settings','records','feeds','sourceState','backups'])expect(await current.get(store,'kept')).toEqual(sentinel);
  current.close();
});
