import 'fake-indexeddb/auto';
import {spawnSync} from 'node:child_process';
import {afterEach,expect,it} from 'vitest';
import {zipSync,strToU8,strFromU8,unzipSync} from 'fflate';
import {createBackupArchive,defaultContent,readBackupArchive,selectBackup,bytesToBase64} from './backup-archive';
import {DEFAULT_SETTINGS,newBook} from './model';
import {defaultCover} from './theme-model';
import * as storage from './storage';
const image='data:image/png;base64,aGVsbG8=';
const original=(value:boolean)=>readBackupArchive(zipSync({'config.xml':strToU8('<map><boolean name="loadCoverOnlyWifi" value="'+value+'"/><string name="futureCover">keep</string></map>')}));
afterEach(async()=>{await storage.put('settings','reader',DEFAULT_SETTINGS);});

it('defaults disabled, validates stored flags, imports original settings and preserves unknown preferences',async()=>{
  expect(defaultCover.onlyWifi).toBe(false);
  const data=await original(true);await storage.restore(JSON.stringify(data));
  expect((await storage.settings()).coverConfig?.onlyWifi).toBe(true);
  expect(JSON.parse(await storage.backup()).managerPreferences.legacyMigration.preferences.futureCover).toBe('keep');
  await storage.restore(JSON.stringify(await original(false)));expect((await storage.settings()).coverConfig?.onlyWifi).toBe(false);
  const broken=JSON.parse(await storage.backup());broken.settings.coverConfig.onlyWifi='true';expect(()=>storage.validateBackup(broken)).toThrow('封面设置');
});
it('exports actual flag to compatible XML and restores it with all existing book metadata intact',async()=>{
  const book={...newBook('Public fixture','txt',[{title:'One',content:'Body'}]),cover:image,legacy:{future:'keep'},note:'Keep',offset:.5};
  await storage.saveBook(book);await storage.put('settings','reader',{...DEFAULT_SETTINGS,coverConfig:{...defaultCover,onlyWifi:true}});
  const bytes=await createBackupArchive(),files=unzipSync(bytes),data=await readBackupArchive(bytes);
  expect(strFromU8(files['config.xml'])).toContain('name="loadCoverOnlyWifi" value="true"');
  await storage.put('settings','reader',DEFAULT_SETTINGS);await storage.restore(JSON.stringify(data));
  expect((await storage.settings()).coverConfig?.onlyWifi).toBe(true);expect((await storage.all('books')).find((b:any)=>b.id===book.id)).toEqual(book);
});
it('honors omit settings, omit covers and ignore covers without reintroducing original XML flags',async()=>{
  await storage.restore(JSON.stringify(await original(true)));
  const raw=JSON.parse(await storage.backup());raw.settings.coverConfig={...defaultCover,onlyWifi:true};
  raw.managerPreferences.legacyBackupFiles={'config.xml':bytesToBase64(strToU8('<map><boolean name="loadCoverOnlyWifi" value="true"/></map>'))};
  raw.managerPreferences.legacyMigration.preferences.loadCoverOnlyWifi=true;
  const selected=selectBackup(raw,{...defaultContent,covers:false});
  expect(selected.settings.coverConfig).toBeUndefined();expect(selected.managerPreferences.legacyMigration.preferences.loadCoverOnlyWifi).toBeUndefined();
  expect(strFromU8(Uint8Array.from(atob(selected.managerPreferences.legacyBackupFiles['config.xml']),c=>c.charCodeAt(0)))).not.toContain('loadCoverOnlyWifi');
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,coverConfig:{...defaultCover,onlyWifi:false}});
  await storage.restore(JSON.stringify(raw),['covers']);expect((await storage.settings()).coverConfig?.onlyWifi).toBe(false);
  await storage.restore(JSON.stringify(selectBackup(raw,{...defaultContent,settings:false})));expect((await storage.settings()).coverConfig?.onlyWifi).toBe(false);
  await storage.restore(JSON.stringify(selected));expect((await storage.settings()).coverConfig?.onlyWifi).toBe(false);
});
it('converts the original SQLite preference without treating a string as a boolean',()=>{
  const code=`import importlib.util,pathlib,sqlite3,tempfile,json
spec=importlib.util.spec_from_file_location('fixture','scripts/convert-legado-backup.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
out=[]
for entry in ['<boolean name="loadCoverOnlyWifi" value="true"/>','<boolean name="loadCoverOnlyWifi" value="false"/>','<string name="loadCoverOnlyWifi">true</string>','']:
 with tempfile.TemporaryDirectory() as d:
  root=pathlib.Path(d);app=root/'extracted/data/user/0/com.legado.app.release';(app/'databases').mkdir(parents=True);(app/'shared_prefs').mkdir()
  sqlite3.connect(app/'databases/legado.db').close()
  (app/'shared_prefs/com.legado.app.release_preferences.xml').write_text('<map>'+entry+'</map>')
  data,_=m.convert(root);out.append(data['settings'].get('coverConfig',{}).get('onlyWifi'))
print(json.dumps(out))`;
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-B','-c',code],{encoding:'utf8'});expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toEqual([true,false,null,null]);
});
