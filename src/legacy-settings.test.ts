import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {strToU8,zipSync} from 'fflate';
import {base64ToBytes,bytesToBase64,createBackupArchive,defaultContent,readBackupArchive,selectBackup} from './backup-archive';
import {DEFAULT_SETTINGS,newBook} from './model';
import {readerColors,dayTheme,nightTheme,defaultCover} from './theme-model';
import {legacyMedia} from './legacy-settings';
import * as storage from './storage';

const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
const image='data:image/png;base64,'+bytesToBase64(png);
const archive=(files:Record<string,Uint8Array>)=>readBackupArchive(zipSync(files));

it('restores an archived cover referenced by its old Android path',async()=>{
  const data=await archive({'bookshelf.json':strToU8(JSON.stringify([{bookUrl:'https://fixture.example.test/book',name:'Public fixture',coverUrl:'/storage/emulated/0/Android/data/io.legado.app.release/files/covers/book.png'}])),'covers/book.png':png});
  expect(data.books[0].cover).toBe(image);
});

it('does not turn the official thin weight into bold or reset unrelated current settings',async()=>{
  await storage.put('settings','reader',{fontSize:29,lineHeight:2,font:'serif',shelfColumns:5});
  const data=await archive({'config.xml':strToU8('<map><int name="readStyleSelect" value="0"/></map>'),'readConfig.json':strToU8('[{"textBold":2}]')});
  expect(data.settings.readBold).toBe(false);
  expect(data.settings.readThin).toBe(true);
  await storage.restore(JSON.stringify(data));
  expect(await storage.settings()).toMatchObject({fontSize:29,lineHeight:2,font:'serif',shelfColumns:5,readBold:false,readThin:true});
});

it('preserves existing book covers when cover restoration is ignored',async()=>{
  const book={...newBook('Cover fixture','txt',[]),cover:image};
  await storage.put('books',book.id,book);
  const data=JSON.parse(await storage.backup());
  data.books.find((row:any)=>row.id===book.id).cover='https://fixture.example.test/replaced.png';
  await storage.restore(JSON.stringify(data),['covers']);
  expect((await storage.all<any>('books')).find(row=>row.id===book.id).cover).toBe(image);
});

it('removes saved-theme background media when backgrounds are excluded',async()=>{
  const data=JSON.parse(await storage.backup());
  data.managerPreferences.themeConfigs=[{themeName:'Fixture',backgroundImgPath:image}];
  const selected=selectBackup(data,{...defaultContent,backgrounds:false});
  expect(selected.managerPreferences.themeConfigs[0].backgroundImgPath).toBe('');
});

it('applies shared layout, selected day/night/eink colors, theme and shelf preferences through restore and re-backup',async()=>{
  const font=new Uint8Array([0,1,0,0,0,0,0,0]);
  const data=await archive({
    'config.xml':strToU8('<map><boolean name="shareLayout" value="true"/><int name="readStyleSelect" value="1"/><string name="themeMode">2</string><int name="colorPrimaryNight" value="-15654349"/><string name="durThemeNameNight">Fixture night</string><int name="bookshelfLayout" value="4"/><int name="bookshelfSort" value="5"/><int name="bookshelfReadProgressMode" value="2"/><int name="showBooknameLayout" value="2"/><boolean name="showUnread" value="false"/><int name="bookGroupStyle" value="1"/><boolean name="coverHorizontal" value="true"/><int name="coverTitleSmallSize" value="120"/></map>'),
    'readConfig.json':strToU8(JSON.stringify([{}, {textSize:16,bgType:2,bgStr:'/storage/emulated/0/Android/data/io.legado.app.release/files/bg/nested/public.png',textColor:'#FF123456',bgTypeNight:0,bgStrNight:'#FF112233',textColorNight:'#FFC0D0E0',bgTypeEInk:0,bgStrEInk:'#FFFFFF',textColorEInk:'#000000'}])),
    'shareReadConfig.json':strToU8(JSON.stringify({textSize:26,textBold:2,titleSize:4,titleMode:1,paragraphIndent:'',lineSpacingExtra:15,paragraphSpacing:4,paddingLeft:23,letterSpacing:.12,pageAnim:3,bgStr:'#FF0000'})),
    'bg/nested/public.png':png,'coverFont.ttf':font,
  });
  expect(data.settings).toMatchObject({fontSize:26,readBold:false,readThin:true,titleSize:30,titleAlign:'center',textIndent:0,lineHeight:1.5,paragraphSpace:.4,readerPaddingLeft:23,letterSpacing:.12,pageMode:'scroll',themeMode:'night',dark:true,layout:'grid',shelfColumns:4,shelfSort:'author',shelfProgress:4,shelfName:'overlay',shelfUnread:false,shelfGroupStyle:'folder',coverConfig:{horizontal:true,titleSmall:120,fontData:'data:font/ttf;base64,'+bytesToBase64(font)},themeNight:{primaryColor:'#ff112233',themeName:'Fixture night'}});
  await storage.restore(JSON.stringify(data));
  const settings=await storage.settings();
  expect(readerColors(settings)).toMatchObject({readerBackground:'',readerBackgroundColor:'#112233FF',readerTextColor:'#C0D0E0FF'});
  expect(readerColors({...settings,dark:false,readerTheme:'paper',themeMode:'day'})).toMatchObject({readerBackground:image,readerTextColor:'#123456FF'});
  expect(readerColors({...settings,themeMode:'eink'})).toMatchObject({readerBackgroundColor:'#FFFFFF',readerTextColor:'#000000'});
  expect(settings.themeNight).toMatchObject({...nightTheme,primaryColor:'#ff112233',themeName:'Fixture night'});
  expect(settings.coverConfig).toMatchObject({...defaultCover,horizontal:true,titleSmall:120,fontData:'data:font/ttf;base64,'+bytesToBase64(font),fontName:'coverFont.ttf'});
  const roundTrip=await readBackupArchive(await createBackupArchive());
  expect(roundTrip.settings).toEqual(settings);
  expect(roundTrip.managerPreferences.legacyBackupFiles['bg/nested/public.png']).toBe(bytesToBase64(png));
});

it('matches media only inside the archive and preserves usable remote covers when a custom file is missing',async()=>{
  const files={'bg/a/public.png':png,'covers/public.png':png,'public.png':png,'bg/bad.png':strToU8('not an image')};
  expect(legacyMedia('/unrelated/public.png',files,'bg')).toBeUndefined();
  expect(legacyMedia('/storage/emulated/0/Android/data/io.legado.app.release/files/bg/b/public.png',files,'bg')).toBeUndefined();
  expect(legacyMedia('../public.png',files,'bg')).toBeUndefined();
  expect(legacyMedia('bad.png',files,'bg')).toBeUndefined();
  expect(legacyMedia('public.png',files,'covers')).toBe(image);
  const data=await archive({...files,'bookshelf.json':strToU8(JSON.stringify([{bookUrl:'https://fixture.example.test/missing',name:'Missing media fixture',customCoverUrl:'/old/covers/missing.png',coverUrl:'https://fixture.example.test/fallback.png'}])),'readConfig.json':strToU8('[{"bgType":2,"bgStr":"missing.png","textFont":"/unavailable/font.ttf"}]')});
  expect(data.books[0].cover).toBe('https://fixture.example.test/fallback.png');
  expect(data.books[0].legacy.customCoverUrl).toBe('/old/covers/missing.png');
  expect(data.settings.fontData).toBeUndefined();expect(data.settings.readerColors).toBeUndefined();
});

it('preserves each excluded current setting category and merges only supplied legacy fields',async()=>{
  const current={fontSize:32,lineHeight:2,font:'serif',themeMode:'day',dark:false,themeDay:{...dayTheme,backgroundImgPath:image},coverConfig:{...defaultCover,image},layout:'compact',shelfColumns:5,readerColors:{day:{readerBackground:image}}};
  await storage.put('settings','reader',current);
  const data=await archive({'config.xml':strToU8('<map><string name="themeMode">2</string><int name="bookshelfLayout" value="2"/><boolean name="coverHorizontal" value="true"/></map>'),'readConfig.json':strToU8('[{"textSize":19,"bgType":0,"bgStr":"#abcdef"}]')});
  await storage.restore(JSON.stringify(data),['reader','theme','layout','covers']);
  expect(await storage.settings()).toMatchObject(current);
  await storage.restore(JSON.stringify(data));
  expect(await storage.settings()).toMatchObject({fontSize:19,font:'serif',themeMode:'night',layout:'grid',shelfColumns:2,coverConfig:{image,horizontal:true}});
});

it('omits selected media from nested migration JSON and XML, while retaining colors and unknown data',async()=>{
  const raw=JSON.parse(await storage.backup());
  raw.managerPreferences.legacyMigration={preferences:{defaultCover:image,backgroundImage:image,unrelated:7},configFiles:{'readConfig.json':[{bgType:2,bgStr:image,bgTypeNight:0,bgStrNight:'#112233',textFont:'data:font/ttf;base64,AAEA'}]}};
  raw.managerPreferences.legacyBackupFiles={
    'config.xml':bytesToBase64(strToU8(`<map><string name="backgroundImage">${image}</string><string name="defaultCover">${image}</string><int name="colorPrimary" value="123"/></map>`)),
    'readConfig.json':bytesToBase64(strToU8(JSON.stringify(raw.managerPreferences.legacyMigration.configFiles['readConfig.json']))),
    'covers/public.png':bytesToBase64(png),'bg/public.png':bytesToBase64(png),'custom/unknown.bin':'AID/',
  };
  const selected=selectBackup(raw,{...defaultContent,covers:false,backgrounds:false});
  const migration=selected.managerPreferences.legacyMigration,files=selected.managerPreferences.legacyBackupFiles;
  expect(migration.preferences).toEqual({defaultCover:'',backgroundImage:'',unrelated:7});
  expect(migration.configFiles['readConfig.json'][0]).toEqual({bgType:2,bgStr:'',bgTypeNight:0,bgStrNight:'#112233',textFont:''});
  expect(files['covers/public.png']).toBeUndefined();expect(files['bg/public.png']).toBeUndefined();expect(files['custom/unknown.bin']).toBe('AID/');
  expect(new TextDecoder().decode(base64ToBytes(files['config.xml']))).not.toContain(image);
  expect(JSON.parse(new TextDecoder().decode(base64ToBytes(files['readConfig.json'])))).toEqual(migration.configFiles['readConfig.json']);
  const noSettings=selectBackup(raw,{...defaultContent,settings:false});expect(noSettings.managerPreferences.legacyMigration.configFiles).toBeUndefined();
});

it('loads the original built-in reading background without fetching remote or missing files',async()=>{
  const data=await archive({'readConfig.json':strToU8('[{"bgType":1,"bgStr":"羊皮纸1.jpg"}]')});
  expect(data.settings.readerColors.day.readerBackground).toMatch(/^data:image\/jpeg;base64,/);
});

it('does not alter source rules or unknown source fields when media is omitted',async()=>{
  const data=JSON.parse(await storage.backup()),source={bookSourceUrl:'https://fixture.example.test/rules',bookSourceName:'Media rules',ruleSearch:{cover:'img@src'},cover:'custom source data',backgroundImage:'custom source state'};
  data.sources=[source];data.managerPreferences.legacyBackupFiles={'bookSource.json':bytesToBase64(strToU8(JSON.stringify([source])))};
  const selected=selectBackup(data,{...defaultContent,covers:false,backgrounds:false});
  expect(selected.sources).toEqual([source]);
  expect(selected.managerPreferences.legacyBackupFiles['bookSource.json']).toBe(data.managerPreferences.legacyBackupFiles['bookSource.json']);
});

it('preserves current saved-theme and per-mode images when a backup excludes backgrounds',async()=>{
  const current=JSON.parse(await storage.backup());
  current.settings.readerColors={day:{readerBackground:image,readerTextColor:'#123456'}};
  current.managerPreferences.themeConfigs=[{...dayTheme,backgroundImgPath:image}];
  await storage.restore(JSON.stringify(current));
  const incoming=selectBackup(current,{...defaultContent,backgrounds:false});
  incoming.settings.readerColors.day.readerTextColor='#654321';
  await storage.restore(JSON.stringify(incoming));
  expect((await storage.settings()).readerColors?.day).toEqual({readerBackground:image,readerTextColor:'#654321'});
  expect((await storage.preference<any[]>('themeConfigs',[]))[0].backgroundImgPath).toBe(image);
});

it('follows a light system theme after restoring a night-mode reader preset',()=>{
  const settings={...DEFAULT_SETTINGS,themeMode:'system' as const,dark:false,readerTheme:'night' as const,readerColors:{day:{readerTextColor:'#123456'},night:{readerTextColor:'#abcdef'}}};
  expect(readerColors(settings).readerTextColor).toBe('#123456');
});
