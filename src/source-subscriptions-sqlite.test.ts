import 'fake-indexeddb/auto';
import {spawnSync} from 'node:child_process';
import {strFromU8,unzipSync} from 'fflate';
import {expect,it} from 'vitest';
import {createBackupArchive} from './backup-archive';
import * as storage from './storage';

it('converts SQLite ruleSubs without collapsing adjacent 64-bit IDs and re-exports exact upstream entries',async()=>{
  const code=`import importlib.util,json,pathlib,sqlite3,tempfile
spec=importlib.util.spec_from_file_location('convert_fixture','scripts/convert-legado-backup.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory);dbdir=root/'extracted/data/user/0/com.legado.app.release/databases';dbdir.mkdir(parents=True)
 db=sqlite3.connect(dbdir/'legado.db');db.execute('create table ruleSubs (id integer primary key,name text,url text,type integer,customOrder integer,autoUpdate integer,"update" integer)')
 db.executemany('insert into ruleSubs values (?,?,?,?,?,?,?)',[(9223372036854775806,'Public books','https://subscriptions.example.test/books',0,2,1,1700000000000),(9223372036854775807,'Public RSS','https://subscriptions.example.test/rss',1,1,0,1700000000001)]);db.commit();db.close()
 data,_=module.convert(root);print(json.dumps(data))`;
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-B','-c',code],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);const data=JSON.parse(result.stdout);
  expect(data.managerPreferences.sourceSubscriptions.map((row:any)=>row.id)).toEqual(['9223372036854775807','9223372036854775806']);
  await storage.restore(JSON.stringify(data));
  const exported=strFromU8(unzipSync(await createBackupArchive())['sourceSub.json']);
  expect(exported).toContain('"id":9223372036854775806');expect(exported).toContain('"id":9223372036854775807');
  expect((await storage.sourceSubscriptions()).map(row=>row.type)).toEqual([1,0]);
});
