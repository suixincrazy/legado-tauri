import 'fake-indexeddb/auto';
import {spawnSync} from 'node:child_process';
import {openDB} from 'idb';
import {beforeEach,expect,it} from 'vitest';
import {strToU8,strFromU8,zipSync,unzipSync} from 'fflate';
import {createBackupArchive,readBackupArchive,defaultContent,selectBackup,base64ToBytes} from './backup-archive';
import {DEFAULT_SETTINGS,type ReadingRecord} from './model';
import * as storage from './storage';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAgCAIAAACHPC9vAAAANElEQVR4nGNUrtjHQA3ARBVTGEYNIgaMBjZhMBpGhMFoGBEGo2FEGIyGEWEwGkaEweALIwB2tgGZup0EOgAAAABJRU5ErkJggg==';
const png=base64ToBytes(image.split(',')[1]);
const original={deviceId:'Public device',bookName:'Removed book',author:'Author A',readTime:7500,lastRead:10,lastChapterTitle:'Saved chapter',coverUrl:'/public/readRecordCovers/snapshot.png',future:{keep:true}};
const nativeRecord:ReadingRecord={id:'native',bookId:'gone',bookName:'Public',author:'Author B',chapter:'Chapter',cover:image,started:20,seconds:5};
beforeEach(async()=>{const db=await openDB('legado-reader',3);for(const name of ['books','records','settings','sources','feeds','sourceState'])await db.clear(name);db.close();});
const originalZip=()=>zipSync({'readRecord.json':strToU8(JSON.stringify([original])),'readRecordCovers/snapshot.png':png,'covers/fallback.png':png,'config.xml':strToU8('<map><boolean name="readRecordSimpleLayout" value="false"/><string name="readRecordCover">/public/covers/fallback.png</string><string name="future">keep</string></map>')});

it('imports detached original records and archived images while preserving unknown metadata and precise seconds',async()=>{
  const data=await readBackupArchive(originalZip());
  expect(data.records[0]).toMatchObject({bookId:'',author:'Author A',cover:image,chapter:'Saved chapter',seconds:7.5,legacy:original});
  expect(data.settings).toMatchObject({readRecordSimpleLayout:false,readRecordCover:image});
  await storage.restore(JSON.stringify(data));const backup=await readBackupArchive(await createBackupArchive());
  expect(backup.records).toEqual(data.records);expect(backup.managerPreferences.legacyMigration.preferences.future).toBe('keep');
  const files=unzipSync(await createBackupArchive()),legacy=JSON.parse(strFromU8(files['readRecord.json']));
  expect(legacy[0]).toMatchObject({...original,coverUrl:image});
  expect(strFromU8(files['config.xml'])).toContain('name="readRecordSimpleLayout" value="false"');
  expect(strFromU8(files['config.xml'])).toContain(image);
});
it('keeps raw sessions in Tauri and exports summed original records without losing time on repeated legacy restore',async()=>{
  await storage.put('records','native',nativeRecord);await storage.put('records','second',{...nativeRecord,id:'second',seconds:9,started:21});
  const bytes=await createBackupArchive(),files=unzipSync(bytes),data=await readBackupArchive(bytes);
  expect(data.records).toHaveLength(2);expect(JSON.parse(strFromU8(files['readRecord.json']))).toHaveLength(1);
  expect(JSON.parse(strFromU8(files['readRecord.json']))[0]).toMatchObject({author:'Author B',readTime:14000,lastRead:21,coverUrl:image});
  delete files['legado-tauri.json'];const legacy=await readBackupArchive(zipSync(files));
  expect(legacy.records[0].seconds).toBe(14);expect(legacy.settings.readRecordSimpleLayout).toBe(true);
  const db=await openDB('legado-reader',3);await db.clear('records');db.close();
  await storage.restore(JSON.stringify(legacy));await storage.restore(JSON.stringify(legacy));
  expect((await storage.all<ReadingRecord>('records')).reduce((sum,r)=>sum+r.seconds,0)).toBe(14);
});
it('restoring an original record with the older SQLite id updates it once; native sessions stay separate',async()=>{
  const data=await readBackupArchive(originalZip()),row=data.records[0];
  const old={...row,id:'legado-record-'+'a'.repeat(64),seconds:1};
  const local={...nativeRecord,id:'local',bookName:row.bookName,legacy:row.legacy};
  await storage.put('records',old.id,old);await storage.put('records',local.id,local);
  await storage.restore(JSON.stringify(data));await storage.restore(JSON.stringify(data));
  const restored=await storage.all<ReadingRecord>('records');expect(restored).toHaveLength(2);
  expect(restored.find(r=>r.id===old.id)).toEqual({...row,id:old.id});expect(restored.find(r=>r.id===local.id)).toEqual(local);
});
it('excludes record media through every backup copy and preserves old images when restoring without covers',async()=>{
  await storage.restore(JSON.stringify(await readBackupArchive(originalZip())));
  const before=JSON.parse(await storage.backup()),id=before.records[0].id;
  const selected=selectBackup(before,{...defaultContent,covers:false});
  expect(selected.records[0].cover).toBe('');expect(selected.records[0].legacy.coverUrl).toBe('');
  expect(selected.managerPreferences.legacyBackupFiles['readRecordCovers/snapshot.png']).toBeUndefined();
  expect(strFromU8(base64ToBytes(selected.managerPreferences.legacyBackupFiles['config.xml']))).not.toContain('readRecordCover');
  const out=unzipSync(await createBackupArchive({...defaultContent,covers:false}));
  expect(JSON.parse(strFromU8(out['readRecord.json']))[0].coverUrl).toBe('');
  expect(strFromU8(out['config.xml'])).not.toContain('name="readRecordCover"');
  await storage.restore(JSON.stringify(selected));const after=(await storage.all<ReadingRecord>('records'))[0];
  expect(after.id).toBe(id);expect(after.cover).toBe(image);expect(after.legacy).toEqual(original);
  expect((await storage.settings()).readRecordCover).toBe(image);
  const changed=structuredClone(before);changed.records[0].cover='https://example.test/new.png';changed.settings.readRecordCover='https://example.test/default.png';
  await storage.restore(JSON.stringify(changed),['covers']);expect((await storage.all<ReadingRecord>('records'))[0].cover).toBe(image);
  expect((await storage.settings()).readRecordCover).toBe(image);
});
it('honors independent history and settings selections and rejects invalid new metadata before changing storage',async()=>{
  await storage.put('records','native',nativeRecord);await storage.put('settings','reader',{...DEFAULT_SETTINGS,readRecordSimpleLayout:false});
  const raw=JSON.parse(await storage.backup());raw.settings.readRecordSimpleLayout=true;
  await storage.restore(JSON.stringify(selectBackup(raw,{...defaultContent,settings:false})));expect((await storage.settings()).readRecordSimpleLayout).toBe(false);
  expect(selectBackup(raw,{...defaultContent,history:false}).records).toEqual([]);
  for(const value of [{...raw,settings:{...raw.settings,readRecordSimpleLayout:'false'}},{...raw,records:[{...nativeRecord,author:4}]},{...raw,records:[{...nativeRecord,cover:{}}]}]){
    await expect(storage.restore(JSON.stringify(value))).rejects.toThrow('阅读记录');
    expect(await storage.all('records')).toEqual([nativeRecord]);
  }
});
it('converts SQLite detached records, PNG paths, fractions and layout without treating strings as booleans',()=>{
  const code=`import pathlib,tempfile,sqlite3,json,base64,importlib.util
spec=importlib.util.spec_from_file_location('convert','scripts/convert-legado-backup.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
out=[]
for flag in ['<boolean name="readRecordSimpleLayout" value="false"/>','<string name="readRecordSimpleLayout">false</string>','']:
 with tempfile.TemporaryDirectory() as d:
  root=pathlib.Path(d);app=root/'extracted/data/user/0/com.legado.app.release';(app/'databases').mkdir(parents=True);(app/'shared_prefs').mkdir()
  img=root/'extracted/sdcard/Android/data/com.legado.app.release/files/readRecordCovers/a.png';img.parent.mkdir(parents=True);img.write_bytes(base64.b64decode(${JSON.stringify(image.split(',')[1])}))
  db=sqlite3.connect(app/'databases/legado.db');db.execute('CREATE TABLE readRecord(deviceId TEXT,bookName TEXT,author TEXT,readTime INTEGER,lastRead INTEGER,lastChapterTitle TEXT,coverUrl TEXT,unknown TEXT)');db.execute('INSERT INTO readRecord VALUES (?,?,?,?,?,?,?,?)',('public','Gone','Author',1500,4,'Last','/public/readRecordCovers/a.png','keep'));db.commit();db.close()
  (app/'shared_prefs/com.legado.app.release_preferences.xml').write_text('<map>'+flag+'</map>')
  data,_=m.convert(root);rec=data['records'][0];out.append(dict(simple=data['settings']['readRecordSimpleLayout'],author=rec['author'],cover=rec['cover'],seconds=rec['seconds'],unknown=rec['legacy']['unknown'],bad=m.record_image('/public/readRecordCovers/../a.png',root)))
print(json.dumps(out))`;
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-B','-c',code],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toEqual([false,true,true].map(simple=>({simple,author:'Author',cover:image,seconds:1.5,unknown:'keep',bad:''})));
});
