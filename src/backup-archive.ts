import {strToU8,strFromU8,zip,unzip} from 'fflate';
import CryptoJS from 'crypto-js';
import {newBook,type Book} from './model';
import {bookTocExpanded,originalReadConfig} from './toc-config';
import * as storage from './storage';
import {convertLegacyFiles,legacyBackupNames} from './legacy-backup';
import {legacyLayout,legacyMedia,legacySettings} from './legacy-settings';
import {parseSubscriptions,serializeSubscriptions} from './source-subscriptions';
import {managedBookmarkRows,bookIdentity,readLegadoBookmark,type DetachedBookmark} from './bookmarks';

export const contentLabels={bookshelf:'书架及本地正文',annotations:'书签、笔记与高亮',sources:'书源、订阅源与书源订阅',rules:'规则',history:'阅读记录与搜索历史',settings:'设置',covers:'封面与字体',backgrounds:'背景图片',cookies:'Cookie',sourceState:'书源变量与登录状态'};
export type BackupContent=Record<keyof typeof contentLabels,boolean>;
export const defaultContent:BackupContent={bookshelf:true,annotations:true,sources:true,rules:true,history:true,settings:true,covers:true,backgrounds:true,cookies:false,sourceState:false};
export const ignoreLabels={reader:'阅读配置',theme:'主题配置及模式',covers:'封面配置',layout:'书架布局',localBooks:'本地书籍',annotations:'书签与高亮',cookies:'Cookie',sourceState:'书源变量与登录状态'};
export const bytesToBase64=(bytes:Uint8Array)=>{let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);};
export const base64ToBytes=(value:string)=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const compress=(files:Record<string,Uint8Array>)=>new Promise<Uint8Array>((resolve,reject)=>zip(files,{level:6},(error,data)=>error?reject(error):resolve(data)));
const decompress=(bytes:Uint8Array)=>new Promise<Record<string,Uint8Array>>((resolve,reject)=>{let total=0;unzip(bytes,{filter:file=>{total+=file.originalSize;if(total>1024*1024*1024)throw new Error('解压后的备份超过 1 GB');return true;}},(error,data)=>error?reject(new Error('备份 ZIP 损坏或无法解压')):resolve(data));});
const ruleKeys=['replaceRules','txtTocRules','dictRules','speechSettings'];
const sourceKeys=['sourceManager','sourceSubscriptions','sourceSubscriptionsVersion'];
function legacyCategory(name:string):keyof BackupContent {
  if(/^(covers|readRecordCovers)\//i.test(name))return 'covers';if(/^bg\//i.test(name))return 'backgrounds';
  if(name==='myBookShelf.json')return 'bookshelf';if(name==='myBookSource.json')return 'sources';if(name==='myBookReplaceRule.json')return 'rules';
  if(/cookies/i.test(name))return 'cookies';if(/runtimeSourceCache|cache/i.test(name))return 'sourceState';
  if(/^(bookshelf|bookGroup|bookMemo)/.test(name))return 'bookshelf';if(/^(bookmark|highlight)/.test(name))return 'annotations';
  if(/^(bookSource|rss|sourceSub)/.test(name))return 'sources';if(/^(readRecord|searchHistory)/.test(name))return 'history';
  if(/^(replaceRule|txtTocRule|httpTTS|keyboardAssists|dictRule|autoTask|servers|directLink)/.test(name))return 'rules';
  if(/cover|font/i.test(name))return 'covers';if(/background|^bg\//i.test(name))return 'backgrounds';return 'settings';
}
function omittedMediaKey(key:string,content:BackupContent) {
  return !content.covers&&/^(cover|coverUrl|customCoverUrl|coverConfig|defaultCover|defaultCoverDark|coverFont|textFont|titleFont|fontData|fontName)$/.test(key)||!content.backgrounds&&/^(backgroundImgPath|backgroundImage(?:Night)?|welcomeImage(?:Dark|Path|PathDark)?|readerBackground)$/.test(key);
}
function omitMedia(value:any,content:BackupContent):any {
  if(!value||typeof value!=='object')return value;
  for(const [key,item]of Object.entries(value)){
    if(omittedMediaKey(key,content)){if(key==='coverConfig')delete value[key];else value[key]='';}
    else if(!content.backgrounds&&/^bgStr(Night|EInk)?$/.test(key)&&Number(value[key.replace('bgStr','bgType')])!==0)value[key]='';
    else omitMedia(item,content);
  }
  return value;
}
export function selectBackup(raw:any,content:BackupContent) {
  const data=JSON.parse(JSON.stringify(raw));data.backupContent=content;
  const prefs=data.managerPreferences||{};delete prefs.backupPassword;delete prefs.backupRuntime;delete prefs.backupLog;
  for(const book of data.books){for(const key of ['cover','coverUrl','customCoverUrl'])if(!content.covers){if(key in book)book[key]='';if(book.legacy&&key in book.legacy)book.legacy[key]='';}}
  omitMedia(data.settings,content);omitMedia(prefs.themeConfigs,content);
  if(prefs.legacyMigration){
    for(const key of ['preferences','files','configFiles'])omitMedia(prefs.legacyMigration[key],content);
    omitMedia(prefs.legacyMigration.tables?.readRecord,content);
  }
  if(!content.annotations){for(const book of data.books){book.bookmarks=[];book.highlights=[];}delete prefs.highlightRules;delete prefs.highlightLastStyle;delete prefs.detachedBookmarks;}
  if(!content.bookshelf){if(content.annotations)data.annotations=data.books.map((book:Book)=>({id:book.id,name:book.name,author:book.author,bookmarks:book.bookmarks,highlights:book.highlights||[]}));data.books=[];delete prefs.bookGroups;}
  if(!content.sources){data.sources=[];data.feeds=[];sourceKeys.forEach(key=>delete prefs[key]);}
  if(!content.history){data.records=[];delete prefs.searchHistory;}
  if(!content.rules)ruleKeys.forEach(key=>delete prefs[key]);
  if(!content.settings){data.settings={};for(const key of Object.keys(prefs))if(![...sourceKeys,...ruleKeys,'bookGroups','searchHistory','highlightRules','highlightLastStyle','detachedBookmarks','legacyMigration','legacySourceState','legacyBackupFiles'].includes(key))delete prefs[key];}
  if(!content.covers){for(const book of data.books)if(book.cover?.startsWith('data:'))book.cover='';delete data.settings.coverConfig;data.settings.fontData='';data.settings.fontName='';}
  if(!content.backgrounds){for(const key of ['welcomeImage','welcomeImageDark','readerBackground'])data.settings[key]='';for(const key of ['themeDay','themeNight'])if(data.settings[key])data.settings[key].backgroundImgPath='';}
  const selectState=(state:Record<string,unknown>)=>Object.fromEntries(Object.entries(state||{}).filter(([key])=>key.startsWith('cookie:')?content.cookies:content.sourceState));
  data.sourceState=Object.fromEntries(Object.entries(data.sourceState||{}).map(([key,state])=>[key,selectState(state as any)]));
  if(prefs.legacySourceState)prefs.legacySourceState.state=selectState(prefs.legacySourceState.state);
  if(prefs.legacyMigration){
    const migration=prefs.legacyMigration;
    if(!content.cookies)delete migration.tables?.cookies;
    if(!content.sourceState)delete migration.tables?.caches;
    const map:Record<string,keyof BackupContent>={book_groups:'bookshelf',bookmarks:'annotations',book_highlights:'annotations',highlight_rules:'annotations',readRecord:'history',search_keywords:'history',replace_rules:'rules',txtTocRules:'rules',dictRules:'rules',httpTTS:'rules',autoTask:'rules',rss_sources:'sources',ruleSubs:'sources'};
    for(const key of Object.keys(migration.tables||{}))if(map[key]&&!content[map[key]])delete migration.tables[key];
    if(!content.settings){delete migration.preferences;delete migration.files;delete migration.configFiles;}
  }
  if(prefs.legacyBackupFiles)for(const name of Object.keys(prefs.legacyBackupFiles)){
    if(!content[legacyCategory(name)]){delete prefs.legacyBackupFiles[name];continue;}
    if(content.covers&&content.backgrounds)continue;
    const bytes=base64ToBytes(prefs.legacyBackupFiles[name]);
    if(name==='config.xml'){
      const doc=new DOMParser().parseFromString(strFromU8(bytes),'application/xml');
      if(doc.querySelector('parsererror')){delete prefs.legacyBackupFiles[name];continue;}
      for(const element of [...doc.documentElement.children])if(omittedMediaKey(element.getAttribute('name')||'',content))element.remove();
      prefs.legacyBackupFiles[name]=bytesToBase64(strToU8(new XMLSerializer().serializeToString(doc)));
    }else if(/^(bookshelf|myBookShelf|readRecord|readConfig|shareReadConfig|themeConfig)\.json$/i.test(name)){
      try{prefs.legacyBackupFiles[name]=bytesToBase64(strToU8(JSON.stringify(omitMedia(JSON.parse(strFromU8(bytes)),content))));}catch{/* Encrypted state and unknown binary entries are preserved. */}
    }
  }
  return data;
}
async function encryptionKey(password:string,salt:Uint8Array) {
  const material=await crypto.subtle.importKey('raw',strToU8(password) as BufferSource,'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt as BufferSource,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function legacyFiles(data:any,annotationBooks:Book[]):Record<string,Uint8Array> {
  const files:Record<string,Uint8Array>={};const add=(name:string,value:unknown)=>{files[name]=strToU8(JSON.stringify(value));};
  const prefs=data.managerPreferences||{},content:BackupContent=data.backupContent;
  for(const [name,base64]of Object.entries(prefs.legacyBackupFiles||{}))if(!name.includes('..')&&!name.startsWith('/'))files[name]=base64ToBytes(base64 as string);
  if(content.bookshelf){
    add('bookshelf.json',data.books.map((book:any)=>({...book.legacy,readConfig:{...originalReadConfig(book.legacy?.readConfig),tocExpanded:bookTocExpanded(book)},bookUrl:book.url||book.id,name:book.name,author:book.author,origin:book.sourceUrl||'local',type:book.kind==='online'?0:256,tocUrl:book.tocUrl||book.url||'',durChapterIndex:book.legacyPosition?.chapter??book.chapter,durChapterPos:book.legacyPosition?.position??book.syncPosition?.position??0,durChapterTime:book.lastRead,durChapterTitle:book.chapters[book.chapter]?.title||'',totalChapterNum:book.chapters.length,coverUrl:book.cover||'',customTag:book.note,canUpdate:book.canUpdate!==false,order:book.order||0,group:(book.groups||[]).reduce((n:number,id:string)=>n|(Number(id.replace('legado-group-',''))||0),0)})));
    add('bookGroup.json',(prefs.bookGroups||[]).map((g:any)=>({...g.legacy,groupId:Number(g.id.replace('legado-group-',''))||0,groupName:g.name,order:g.order,show:g.show,enableRefresh:g.enableRefresh})));
  }
  if(content.annotations){
    add('bookmark.json',managedBookmarkRows(annotationBooks,prefs.detachedBookmarks).map(row=>row.record));
    add('highlight.json',[...data.books,...(data.annotations||[])].flatMap((book:Book)=>book.highlights||[]));if(prefs.highlightRules)add('highlightRule.json',prefs.highlightRules);
  }
  if(content.sources){add('bookSource.json',data.sources);add('rssSources.json',data.feeds.map((feed:any)=>({...feed.legacy,sourceName:feed.name,sourceUrl:feed.url})));files['sourceSub.json']=strToU8(serializeSubscriptions(prefs.sourceSubscriptions||[]));}
  if(content.rules)for(const [key,name]of Object.entries({replaceRules:'replaceRule.json',txtTocRules:'txtTocRule.json',dictRules:'dictRule.json'}))if(prefs[key])add(name,prefs[key]);
  if(content.history){add('readRecord.json',data.records.map((record:any)=>({...record.legacy,bookName:record.bookName,readTime:record.seconds*1000,lastRead:record.started,lastChapterTitle:record.chapter})));add('searchHistory.json',(prefs.searchHistory||[]).map((word:string)=>({word,usage:1,lastUseTime:Date.now()})));}
  if(content.settings&&prefs.themeConfigs)add('themeConfig.json',prefs.themeConfigs);
  return files;
}
export async function createBackupArchive(content=defaultContent,password='',lanTransfer=false):Promise<Uint8Array> {
  if((content.cookies||content.sourceState)&&!password)throw new Error('备份 Cookie 或书源登录状态前，请先设置备份密码');
  const snapshot=JSON.parse(await storage.backup()),data=selectBackup(snapshot,content);
  if(data.managerPreferences.backupConfig){data.managerPreferences.backupConfig.localDirectory='';if(!password)data.managerPreferences.backupConfig.password='';}
  if(!password){
    const migration=data.managerPreferences.legacyMigration;
    if(migration?.preferences){
      const clean=(value:any):any=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!/password|passwd|token|secret/i.test(key)).map(([key,item])=>[key,clean(item)])):value;
      migration.preferences=clean(migration.preferences);
    }
    if(migration?.tables)delete migration.tables.servers;
    for(const name of Object.keys(data.managerPreferences.legacyBackupFiles||{}))if(/^(config.xml|servers.json)/.test(name))delete data.managerPreferences.legacyBackupFiles[name];
  }
  if(lanTransfer){
    delete data.managerPreferences.backupConfig;delete data.managerPreferences.legacySourceState;data.sourceState={};
    if(data.managerPreferences.legacyMigration){delete data.managerPreferences.legacyMigration.preferences;delete data.managerPreferences.legacyMigration.tables?.servers;}
    for(const book of data.books){delete book.variables;if(book.legacy)delete book.legacy.variable;}
    for(const name of Object.keys(data.managerPreferences.legacyBackupFiles||{}))if(/^(config.xml|servers.json|cookies.json|runtimeSourceCache.json|directLink)/.test(name))delete data.managerPreferences.legacyBackupFiles[name];
  }
  const files={...legacyFiles(data,snapshot.books),'legado-tauri.json':strToU8(JSON.stringify(data))};
  const bytes=await compress(files);
  if(!password)return bytes;
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(password,salt),bytes as BufferSource);
  return compress({'legado-encrypted.json':strToU8(JSON.stringify({format:'legado-tauri-encrypted',version:1,salt:bytesToBase64(salt),iv:bytesToBase64(iv),data:bytesToBase64(new Uint8Array(encrypted))}))});
}
function parsePreferences(text:string) {
  const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error('原版设置文件损坏');
  return Object.fromEntries([...doc.documentElement.children].map(el=>[el.getAttribute('name'),el.tagName==='boolean'?el.getAttribute('value')==='true':['int','long','float'].includes(el.tagName)?Number(el.getAttribute('value')):el.tagName==='set'?[...el.children].map(c=>c.textContent):el.textContent]));
}
function decryptLegacy(text:string,password:string) {
  try{return CryptoJS.AES.decrypt(text,CryptoJS.enc.Utf8.parse(CryptoJS.MD5(password).toString().slice(0,16)),{mode:CryptoJS.mode.ECB,padding:CryptoJS.pad.Pkcs7}).toString(CryptoJS.enc.Utf8);}catch{throw new Error('原版备份密码不正确或加密内容损坏');}
}
export function convertLegacyArchive(files:Record<string,Uint8Array>,password:string):any {
  if(legacyBackupNames.some(name=>files[name])&&!['bookshelf.json','bookSource.json','replaceRule.json'].some(name=>files[name])){
    const data=convertLegacyArchive(convertLegacyFiles(files),password);data.legacyVersion=2;
    data.managerPreferences.legacyMigration.format='legado-2.x';return data;
  }
  const recognized=['bookshelf.json','bookSource.json','config.xml','readConfig.json','shareReadConfig.json','themeConfig.json','coverFont.ttf','replaceRule.json','rssSources.json','sourceSub.json','readRecord.json','bookGroup.json','bookmark.json','dictRule.json'];
  if(!recognized.some(name=>files[name]))throw new Error('压缩文件中没有可识别的阅读备份');
  const read=(name:string,fallback:any=[])=>files[name]?JSON.parse(strFromU8(files[name])):fallback;
  const prefs=files['config.xml']?parsePreferences(strFromU8(files['config.xml'])):{},configs=read('readConfig.json');
  const sharedStyle=read('shareReadConfig.json',{}),style=legacyLayout(prefs,configs,sharedStyle).layout;
  const groups=read('bookGroup.json').map((row:any)=>({...row,id:'legado-group-'+row.groupId,name:row.groupName,order:row.order||0,show:row.show!==false,enableRefresh:row.enableRefresh!==false,legacy:row}));
  const sources=read('bookSource.json').map((row:any)=>{const result={...row};for(const key of ['ruleSearch','ruleBookInfo','ruleToc','ruleContent','ruleExplore'])if(typeof result[key]==='string')result[key]=JSON.parse(result[key]);return result;});
  const books=read('bookshelf.json').map((row:any)=>{
    if(typeof row.bookUrl!=='string'||typeof row.name!=='string')throw new Error('原版备份书架数据损坏');
    const config=(typeof row.readConfig==='string'?JSON.parse(row.readConfig):row.readConfig)??{};
    const chapter=Math.max(0,row.durChapterIndex||0);
    return {...newBook(row.name,(row.type&256)?'txt':'online',[],row.author||''),id:'legado-'+CryptoJS.SHA256(row.bookUrl).toString(),url:row.bookUrl,sourceUrl:row.origin,tocUrl:row.tocUrl,cover:row.customCoverUrl||row.coverUrl,intro:row.customIntro||row.intro,note:row.customTag||'',lastRead:row.durChapterTime||0,order:row.order||0,canUpdate:row.canUpdate!==false,groups:groups.filter((g:any)=>g.groupId>0&&(row.group&g.groupId)).map((g:any)=>g.id),useReplaceRule:config.useReplaceRule??true,reSegment:config.reSegment??false,tocExpanded:config.tocExpanded??true,legacyPosition:{chapter,position:Math.max(0,row.durChapterPos||0),indent:(style.paragraphIndent??'　　').length,titleVisible:style.titleMode!==2},legacy:row};
  });
  const bookmarks=read('bookmark.json'),bookmarkLayout={indent:(style.paragraphIndent??'　　').length,titleVisible:style.titleMode!==2};
  if(!Array.isArray(bookmarks))throw new Error('原版书签数据损坏');
  const grouped=new Map<string,Book['bookmarks']>(),names=new Set(books.map((book:Book)=>bookIdentity(book.name,book.author))),detached:DetachedBookmark[]=[];
  for(const record of bookmarks){
    const mark=readLegadoBookmark(record,bookmarkLayout),key=bookIdentity(record.bookName,record.bookAuthor);
    if(!names.has(key)){detached.push({record,positionLayout:bookmarkLayout});continue;}
    const group=grouped.get(key)||[];group.push(mark);grouped.set(key,group);
  }
  for(const book of books){book.bookmarks=grouped.get(bookIdentity(book.name,book.author))||[];book.highlights=read('highlight.json').filter((mark:any)=>mark.bookUrl===book.url||(mark.bookName===book.name&&mark.bookAuthor===book.author));}
  const shared:Record<string,unknown>={},sourceState:Record<string,Record<string,unknown>>={};
  for(const name of ['cookies.json','runtimeSourceCache.json'])if(files[name]){
    const value=strFromU8(files[name]);let rows:any[];
    try{rows=JSON.parse(value.trim().startsWith('[')?value:decryptLegacy(value,password));}catch{throw new Error('原版备份密码不正确或加密内容损坏');}
    for(const row of rows){
      if(name==='cookies.json')shared['cookie:'+row.url]={value:row.cookie};
      else {
        shared['cache:'+row.key]={value:row.value,expires:row.deadline};
        for(const [prefix,key]of [['sourceVariable_','variable'],['loginHeader_','loginHeader'],['userInfo_','loginInfo']]as const)if(row.key.startsWith(prefix)){
          const url=row.key.slice(prefix.length);sourceState[url]??={};
          if(prefix!=='userInfo_'||typeof row.value==='string'&&/^\s*[{[]/.test(row.value))sourceState[url]['source:'+key]={value:row.value,expires:row.deadline};
        }
      }
    }
  }
  const settings=legacySettings(prefs,configs,sharedStyle,files);
  for(const book of books)book.cover=legacyMedia(book.legacy.customCoverUrl,files,'covers')||legacyMedia(book.legacy.coverUrl,files,'covers')||'';
  const managerPreferences:any={legacyMigration:{format:'legado-zip',version:1,preferences:prefs},legacyBackupFiles:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,bytesToBase64(bytes)])),legacySourceState:{sources:sources.map((s:any)=>s.bookSourceUrl),state:shared}};
  if(files['bookGroup.json'])managerPreferences.bookGroups=groups;
  if(typeof prefs.contentSearchReplace==='boolean')managerPreferences.contentSearchReplace=prefs.contentSearchReplace;
  if(typeof prefs.contentSearchScope==='number')managerPreferences.contentSearchScope=['all','down','up'][prefs.contentSearchScope]??'all';
  if(detached.length)managerPreferences.detachedBookmarks=detached;
  for(const [name,key]of Object.entries({'replaceRule.json':'replaceRules','txtTocRule.json':'txtTocRules','dictRule.json':'dictRules','themeConfig.json':'themeConfigs','highlightRule.json':'highlightRules'}))if(files[name])managerPreferences[key]=read(name).map((row:any)=>({...row,...(key==='replaceRules'?{order:row.sortOrder??row.order??0}:{})}));
  if(files['sourceSub.json']){managerPreferences.sourceSubscriptions=parseSubscriptions(strFromU8(files['sourceSub.json']));managerPreferences.sourceSubscriptionsVersion=1;}
  if(managerPreferences.themeConfigs)managerPreferences.themeConfigs=managerPreferences.themeConfigs.map((theme:any)=>({...theme,backgroundImgPath:legacyMedia(theme.backgroundImgPath,files)||''}));
  if(files['searchHistory.json'])managerPreferences.searchHistory=read('searchHistory.json').map((row:any)=>typeof row==='string'?row:row.word);
  if(prefs.web_dav_url||prefs.web_dav_account)managerPreferences.backupConfig={url:prefs.web_dav_url||'https://dav.jianguoyun.com/dav/',username:prefs.web_dav_account||'',password:prefs.web_dav_password?decryptLegacy(prefs.web_dav_password,password):'',directory:prefs.webDavDir||'legado',keepCount:Number(prefs.webDavBackupKeepCount)||0};
  for(const [from,to]of Object.entries({syncBookProgress:'syncProgress',syncBookProgressPlus:'syncProgressPlus',webDavBookAutoUpload:'bookAutoUpload',webDavBookAutoRestore:'bookAutoRestore',onlyLatestBackup:'onlyLatest',autoCheckNewBackup:'checkNew',autoBackupWebDav:'autoWebDav'}))if(typeof prefs[from]==='boolean'){
    managerPreferences.backupConfig??={};managerPreferences.backupConfig[to]=prefs[from];
  }
  if(Number.isInteger(prefs.autoBackupIntervalDays)&&prefs.autoBackupIntervalDays>0){managerPreferences.backupConfig??={};managerPreferences.backupConfig.autoDays=prefs.autoBackupIntervalDays;}
  return {format:'legado-tauri',version:1,books,sources,records:read('readRecord.json').map((row:any)=>({id:'legado-record-'+CryptoJS.SHA256(JSON.stringify([row.deviceId,row.bookName,row.author])).toString(),bookId:books.find((b:Book)=>b.name===row.bookName&&b.author===row.author)?.id||'',bookName:row.bookName,chapter:row.lastChapterTitle||'',started:row.lastRead||0,seconds:Math.max(0,row.readTime||0)/1000,legacy:row})),feeds:read('rssSources.json').map((row:any)=>({id:row.sourceUrl,name:row.sourceName,url:row.sourceUrl,legacy:row})),settings,sourceState,managerPreferences,backupContent:{...defaultContent,settings:!!files['config.xml']||!!files['readConfig.json']||!!files['shareReadConfig.json']||!!files['themeConfig.json']||!!files['coverFont.ttf'],annotations:!!files['bookmark.json']||!!files['highlight.json']},legacyArchive:true,legacyVersion:3};
}
export async function readBackupArchive(bytes:Uint8Array,password='',depth=0):Promise<any> {
  if(bytes[0]!==0x50||bytes[1]!==0x4b)return JSON.parse(strFromU8(bytes));
  const original=await decompress(bytes),files:Record<string,Uint8Array>={};
  const names=Object.keys(original).filter(name=>!name.endsWith('/')&&!name.startsWith('__MACOSX/'));
  const prefix=names.length&&names.every(name=>name.startsWith(names[0].split('/')[0]+'/'))?names[0].split('/')[0]+'/':'';
  for(const name of names){const key=name.slice(prefix.length);if(key.split('/').some(part=>part==='..')||key.startsWith('/'))throw new Error('备份包含无效路径');files[key]=original[name];}
  if(files['legado-encrypted.json']){
    if(depth>0)throw new Error('备份加密结构无效');if(!password)throw new Error('此备份已加密，请输入备份密码');
    const envelope=JSON.parse(strFromU8(files['legado-encrypted.json']));
    if(envelope.format!=='legado-tauri-encrypted'||envelope.version!==1)throw new Error('未知的加密备份格式');
    let plain:ArrayBuffer;
    try{const salt=base64ToBytes(envelope.salt),iv=base64ToBytes(envelope.iv);plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv as BufferSource},await encryptionKey(password,salt),base64ToBytes(envelope.data) as BufferSource);}catch{throw new Error('备份密码不正确或文件已损坏');}
    return readBackupArchive(new Uint8Array(plain),password,depth+1);
  }
  return files['legado-tauri.json']?JSON.parse(strFromU8(files['legado-tauri.json'])):convertLegacyArchive(files,password);
}
