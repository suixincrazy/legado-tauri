import 'fake-indexeddb/auto';
import {beforeEach,expect,it} from 'vitest';
import {strToU8,zipSync} from 'fflate';
import {createBackupArchive,defaultContent,readBackupArchive} from './backup-archive';
import * as storage from './storage';

beforeEach(async()=>{for(const key of ['contentSearchScope','contentSearchReplace','legacyBackupFiles','legacyMigration'])await storage.remove('settings',key);});
it('imports official scope ordinals and the replacement flag without changing missing preferences',async()=>{
  const source=(extra:string)=>zipSync({'config.xml':strToU8('<map>'+extra+'</map>')});
  for(const [ordinal,scope] of ['all','down','up'].entries()){
    const data=await readBackupArchive(source('<int name="contentSearchScope" value="'+ordinal+'"/><boolean name="contentSearchReplace" value="true"/>'));
    expect(data.managerPreferences).toMatchObject({contentSearchScope:scope,contentSearchReplace:true});
    await storage.restore(JSON.stringify(data));expect(await storage.preference('contentSearchScope','all')).toBe(scope);expect(await storage.preference('contentSearchReplace',false)).toBe(true);
  }
  const absent=await readBackupArchive(source('<int name="contentSearchScope" value="99"/>'));expect(absent.managerPreferences.contentSearchScope).toBe('all');expect(absent.managerPreferences.contentSearchReplace).toBeUndefined();
  await storage.restore(JSON.stringify(absent));expect(await storage.preference('contentSearchReplace',false)).toBe(true);
  const wrongType=await readBackupArchive(source('<string name="contentSearchScope">2</string><string name="contentSearchReplace">true</string>'));
  expect(wrongType.managerPreferences.contentSearchScope).toBeUndefined();expect(wrongType.managerPreferences.contentSearchReplace).toBeUndefined();
});
it('round-trips search preferences while excluded settings and ignored reading configuration preserve current choices',async()=>{
  await storage.put('settings','contentSearchScope','up');await storage.put('settings','contentSearchReplace',true);
  const full=await readBackupArchive(await createBackupArchive()),omitted=await readBackupArchive(await createBackupArchive({...defaultContent,settings:false}));
  expect(full.managerPreferences).toMatchObject({contentSearchScope:'up',contentSearchReplace:true});expect(omitted.managerPreferences.contentSearchScope).toBeUndefined();expect(omitted.managerPreferences.contentSearchReplace).toBeUndefined();
  await storage.put('settings','contentSearchScope','down');await storage.put('settings','contentSearchReplace',false);
  await storage.restore(JSON.stringify(full),['reader']);expect(await storage.preference('contentSearchScope','all')).toBe('down');expect(await storage.preference('contentSearchReplace',true)).toBe(false);
  await storage.restore(JSON.stringify(omitted));expect(await storage.preference('contentSearchScope','all')).toBe('down');
  await storage.restore(JSON.stringify(full));expect(await storage.preference('contentSearchScope','all')).toBe('up');expect(await storage.preference('contentSearchReplace',false)).toBe(true);
});
