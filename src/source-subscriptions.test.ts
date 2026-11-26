import 'fake-indexeddb/auto';
import {strToU8,strFromU8,zipSync,unzipSync} from 'fflate';
import {beforeEach,expect,it} from 'vitest';
import {createBackupArchive,defaultContent,readBackupArchive} from './backup-archive';
import * as storage from './storage';
import {updateBookSubscription} from './source-subscriptions';

const subscriptions=[
  {id:101,name:'Books',url:'https://subscriptions.example.test/books',type:0,customOrder:2,autoUpdate:true,update:1700000000000,updateInterval:24,silentUpdate:true,js:'result',showRule:'name',sourceUrl:'https://source.example.test',futureField:{kept:true}},
  {id:102,name:'RSS sources',url:'https://subscriptions.example.test/rss',type:1,customOrder:5,autoUpdate:false,update:1700000000001},
  {id:103,name:'Replacement rules',url:'https://subscriptions.example.test/replace',type:2,customOrder:6,autoUpdate:true,update:1700000000002},
  {id:104,name:'MD3 auto',url:'https://subscriptions.example.test/auto',type:3,customOrder:8,autoUpdate:false,update:1700000000003},
  {id:105,name:'Future rules',url:'https://subscriptions.example.test/future',type:19,customOrder:9,autoUpdate:false,update:1700000000004,futureOptions:['keep']},
];
const archive=(entries:unknown,onlySubscriptions=false)=>zipSync({'sourceSub.json':strToU8(JSON.stringify(entries)),...onlySubscriptions?{}:{'bookshelf.json':strToU8('[]')}});
beforeEach(async()=>{await storage.remove('settings','sourceSubscriptions');await storage.remove('settings','sourceSubscriptionsVersion');await storage.remove('settings','legacyBackupFiles');await storage.remove('settings','legacyMigration');});

it('preserves every upstream subscription type, identifier, order and unknown field in both archive formats',async()=>{
  const data=await readBackupArchive(archive(subscriptions));
  expect(data.managerPreferences.sourceSubscriptions).toEqual(subscriptions);
  await storage.restore(JSON.stringify(data));
  const files=unzipSync(await createBackupArchive());
  expect(JSON.parse(strFromU8(files['sourceSub.json']))).toEqual(subscriptions);
  expect(JSON.parse(strFromU8(files['legado-tauri.json'])).managerPreferences.sourceSubscriptions).toEqual(subscriptions);
  delete files['legado-tauri.json'];
  expect((await readBackupArchive(zipSync(files))).managerPreferences.sourceSubscriptions).toEqual(subscriptions);
});
it('keeps adjacent 64-bit Room primary keys distinct and emits exact numeric IDs in the upstream ZIP',async()=>{
  const raw='[{"id":9223372036854775806,"url":"https://subscriptions.example.test/shared","type":0},{"id":9223372036854775807,"url":"https://subscriptions.example.test/shared","type":1}]';
  const data=await readBackupArchive(zipSync({'sourceSub.json':strToU8(raw)}));
  await storage.restore(JSON.stringify(data));
  const files=unzipSync(await createBackupArchive());
  expect(strFromU8(files['sourceSub.json'])).toBe(raw);
  expect((await readBackupArchive(zipSync(files))).managerPreferences.sourceSubscriptions.map((row:any)=>String(row.id))).toEqual(['9223372036854775806','9223372036854775807']);
});
it('accepts a sourceSub-only upstream backup and keeps subscriptions independent of general settings',async()=>{
  const data=await readBackupArchive(archive(subscriptions,true));await storage.restore(JSON.stringify(data));
  const files=unzipSync(await createBackupArchive({...defaultContent,settings:false}));
  expect(JSON.parse(strFromU8(files['sourceSub.json']))).toEqual(subscriptions);
  const omitted=unzipSync(await createBackupArchive({...defaultContent,sources:false}));
  expect(omitted['sourceSub.json']).toBeUndefined();
  expect(JSON.parse(strFromU8(omitted['legado-tauri.json'])).managerPreferences.sourceSubscriptions).toBeUndefined();
});
it('merges restored upstream subscriptions by ID without discarding unrelated entries or collapsing shared URLs',async()=>{
  const retained={...subscriptions[0],id:200,name:'Existing separate entry'},changed={...subscriptions[0],name:'Updated books'};
  await storage.put('settings','sourceSubscriptions',[retained,subscriptions[0]]);
  await storage.restore(JSON.stringify(await readBackupArchive(archive([changed,subscriptions[1]]))));
  expect(await storage.preference('sourceSubscriptions',[])).toEqual([retained,changed,subscriptions[1]]);
});
it('preserves future subscription URLs as data without attempting to fetch or execute them',async()=>{
  const entries=[{...subscriptions[4],url:'@js:result'}];
  await storage.restore(JSON.stringify(await readBackupArchive(archive(entries))));
  expect(JSON.parse(strFromU8(unzipSync(await createBackupArchive())['sourceSub.json']))).toEqual(entries);
});
it('recovers non-book subscriptions retained by older backups and does not resurrect later removals',async()=>{
  const old={format:'legado-tauri',version:1,books:[],sources:[],records:[],feeds:[],settings:{},managerPreferences:{sourceSubscriptions:[{url:subscriptions[0].url,updated:1700000000005,count:4}],legacyBackupFiles:{'sourceSub.json':btoa(JSON.stringify(subscriptions))}}};
  await storage.restore(JSON.stringify(old));
  const saved=await storage.preference<any[]>('sourceSubscriptions',[]);
  expect(saved).toHaveLength(5);expect(saved[0]).toEqual({...subscriptions[0],updated:1700000000005,count:4});
  await storage.put('settings','sourceSubscriptions',saved.filter(row=>row.id!==102));
  const files=unzipSync(await createBackupArchive());
  expect(JSON.parse(strFromU8(files['sourceSub.json'])).map((row:any)=>row.id)).toEqual([101,103,104,105]);
});
it('includes subscriptions retained by SQLite conversion when no canonical list exists',async()=>{
  const data={format:'legado-tauri',version:1,books:[],sources:[],records:[],feeds:[],settings:{},managerPreferences:{legacyMigration:{tables:{ruleSubs:subscriptions}}}};
  await storage.restore(JSON.stringify(data));
  expect(await storage.preference('sourceSubscriptions',[])).toEqual(subscriptions);
  expect(JSON.parse(strFromU8(unzipSync(await createBackupArchive())['sourceSub.json']))).toEqual(subscriptions);
});
it('migrates an existing database lazily for display and export without reviving explicitly removed subscriptions',async()=>{
  await storage.put('settings','sourceSubscriptions',[subscriptions[0]]);
  await storage.put('settings','legacyBackupFiles',{'sourceSub.json':btoa(JSON.stringify(subscriptions))});
  expect(await storage.sourceSubscriptions()).toEqual(subscriptions);
  expect(JSON.parse(strFromU8(unzipSync(await createBackupArchive())['sourceSub.json']))).toEqual(subscriptions);
  const retained=subscriptions.filter(row=>row.id!==102);await storage.saveSourceSubscriptions(retained);
  expect(await storage.sourceSubscriptions()).toEqual(retained);
  expect(JSON.parse(strFromU8(unzipSync(await createBackupArchive())['sourceSub.json']))).toEqual(retained);
});
it('keeps lazy-migrated existing subscriptions when restoring another archive',async()=>{
  await storage.put('settings','sourceSubscriptions',[subscriptions[0]]);
  await storage.put('settings','legacyBackupFiles',{'sourceSub.json':btoa(JSON.stringify(subscriptions))});
  const changed={...subscriptions[0],name:'New title'};
  await storage.restore(JSON.stringify(await readBackupArchive(archive([changed]))));
  expect(await storage.sourceSubscriptions()).toEqual([changed,...subscriptions.slice(1)]);
});
it('appends a new book subscription after the maximum order with a unique ID and preserves same-URL RSS entries',()=>{
  const rows=[{...subscriptions[1],id:123,customOrder:20}];
  const next=updateBookSubscription(rows,rows[0].url,2,123);
  expect(next[0]).toEqual(rows[0]);expect(next[1]).toMatchObject({id:124,url:rows[0].url,type:0,customOrder:21,count:2,update:123,autoUpdate:false});
});
it('converts older URL-only book subscriptions without losing custom metadata or their array position',()=>{
  const old={url:'https://subscriptions.example.test/old',updated:1,count:1,custom:'keep'};
  const next=updateBookSubscription([subscriptions[1],old],old.url,2,123);
  expect(next[0]).toEqual(subscriptions[1]);expect(next[1]).toMatchObject({id:123,type:0,custom:'keep',customOrder:6,updated:123,count:2});
});
it.each([null,{},[null],[{url:12}],[{url:'https://example.test',type:'rss'}]])('rejects malformed subscription data before any database writes',async value=>{
  const data=await readBackupArchive(archive([]));data.managerPreferences.sourceSubscriptions=value;
  const before=await storage.backup();await expect(storage.restore(JSON.stringify(data))).rejects.toThrow('订阅');
  expect(JSON.parse(await storage.backup()).managerPreferences).toEqual(JSON.parse(before).managerPreferences);
});
