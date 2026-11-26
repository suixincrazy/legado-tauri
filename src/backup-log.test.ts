import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {backupError,recordBackupEvent,backupLog,clearBackupLog,backupLogText} from './backup-log';
import {createBackupArchive,readBackupArchive} from './backup-archive';

it('serializes concurrent backup logs, masks credentials, and excludes logs from exported backups',async()=>{
  await clearBackupLog();
  await Promise.all(Array.from({length:205},(_,i)=>recordBackupEvent('fixture-'+i,'error','password=hidden https://private.example.test/key Bearer token123 fixture-secret',['fixture-secret'])));
  const rows=await backupLog();expect(rows).toHaveLength(200);expect(rows[0].operation).toBe('fixture-204');expect(rows.at(-1)?.operation).toBe('fixture-5');
  const text=backupLogText(rows);for(const secret of ['hidden','private.example','token123','fixture-secret'])expect(text).not.toContain(secret);
  expect(backupError(new SyntaxError('Unexpected private body'))).toBe('备份文件格式无效');
  const archive=await readBackupArchive(await createBackupArchive(),'');expect(archive.managerPreferences.backupLog).toBeUndefined();
  await clearBackupLog();expect(await backupLog()).toEqual([]);
});
