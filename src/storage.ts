import { openDB } from 'idb';
import { DEFAULT_SETTINGS, type Book, type Source, type Settings, type ReadingRecord, type Feed } from './model';
import { parseReplaceRules } from './replacement-engine';
import { parseThemes,dayTheme,nightTheme,defaultCover } from './theme-model';
import { parseDictRules } from './dictionary';
import { parseHighlightRules } from './highlight-engine';
import { parseTxtRules } from './txt-rules-engine';
import {strFromU8,unzipSync} from 'fflate';
import {migrateSourceSubscriptions,mergeSubscriptions,recordSubscriptionImport,type SourceSubscription} from './source-subscriptions';
import {rssFeed,type RuleSubscriptionImport} from './rule-subscription-import';
import {validBookmark,detachedMark,detachBookmark,reconcileBookmarks,recordIdentity,type DetachedBookmark,type LegadoBookmark} from './bookmarks';

const db = openDB('legado-reader', 3, { upgrade(database) {
  for (const name of ['books', 'sources', 'settings', 'records', 'feeds', 'sourceState','backups']) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
} });
export async function all<T>(store: string): Promise<T[]> { return (await db).getAll(store); }
export async function put(store: string, key: string, value: unknown) { return (await db).put(store, value, key); }
export async function remove(store: string, key: string) { return (await db).delete(store, key); }
export async function saveBook(book:Book) {
  const tx=(await db).transaction(['books','settings'],'readwrite'),settings=tx.objectStore('settings');
  const pending:DetachedBookmark[]=await settings.get('detachedBookmarks')||[],result=reconcileBookmarks([book],pending);
  tx.objectStore('books').put(result.books[0],book.id);
  if(pending.length!==result.detached.length)settings.put(result.detached,'detachedBookmarks');await tx.done;
  return {book:result.books[0],detached:result.detached};
}
export async function removeBooks(ids:string[]) {
  const tx=(await db).transaction(['books','settings'],'readwrite'),books=tx.objectStore('books'),settings=tx.objectStore('settings');
  const pending:DetachedBookmark[]=await settings.get('detachedBookmarks')||[],prefs={...DEFAULT_SETTINGS,...await settings.get('reader')};
  for(const id of ids){
    const book:Book|undefined=await books.get(id);if(!book)continue;
    pending.push(...book.bookmarks.map(mark=>detachBookmark(book,mark,{indent:prefs.textIndent,titleVisible:prefs.titleAlign!=='hidden'})));
    books.delete(id);
  }
  if(pending.length){
    const remaining:Book[]=await books.getAll(),result=reconcileBookmarks(remaining,pending);
    result.books.forEach((book,index)=>{if(book!==remaining[index])books.put(book,book.id);});
    settings.put(result.detached,'detachedBookmarks');
  }
  await tx.done;
}
export async function editLibraryBookmark(record:LegadoBookmark,change?:{bookText:string;content:string}) {
  if(change&&[change.bookText,change.content].some(value=>typeof value!=='string'))throw new Error('书签内容无效');
  const tx=(await db).transaction(['books','settings'],'readwrite'),books=tx.objectStore('books'),settings=tx.objectStore('settings');
  const pending:DetachedBookmark[]=await settings.get('detachedBookmarks')||[],key=recordIdentity(record);let found=false;
  const detached=pending.flatMap(value=>{
    if(recordIdentity(value.record)!==key)return [value];found=true;return change?[{...value,record:{...value.record,...change}}]:[];
  });
  if(found)settings.put(detached,'detachedBookmarks');
  for(const book of await books.getAll() as Book[]){
    if(book.name!==record.bookName||book.author!==record.bookAuthor||!book.bookmarks.some(mark=>mark.created===record.time))continue;
    found=true;books.put({...book,bookmarks:book.bookmarks.flatMap(mark=>mark.created!==record.time?[mark]:change?[{...mark,chapterName:record.chapterName,...change}]:[])},book.id);
  }
  await tx.done;if(!found)throw new Error('书签已变更，请重新打开');
}
export async function saveSources(sources: Source[], removeKeys: string[] = []) {
  const transaction = (await db).transaction('sources', 'readwrite');
  for (const key of removeKeys) transaction.store.delete(key);
  for (const source of sources) transaction.store.put(source, source.bookSourceUrl);
  await transaction.done;
}
export async function saveEditedSource(source: Source, oldKey: string) {
  const tx = (await db).transaction(['sources', 'books', 'sourceState', 'settings'], 'readwrite');
  if (oldKey && oldKey !== source.bookSourceUrl) {
    if (await tx.objectStore('sources').get(source.bookSourceUrl)) { tx.abort(); throw new Error('此书源标识已存在'); }
    tx.objectStore('sources').delete(oldKey);
    for (const book of await tx.objectStore('books').getAll() as Book[]) if (book.sourceUrl === oldKey) tx.objectStore('books').put({ ...book, sourceUrl: source.bookSourceUrl }, book.id);
    const state = await tx.objectStore('sourceState').get(oldKey);
    if (state) { tx.objectStore('sourceState').put(state, source.bookSourceUrl); tx.objectStore('sourceState').delete(oldKey); }
    const shared = await tx.objectStore('settings').get('legacySourceState');
    if (shared?.sources?.includes(oldKey)) tx.objectStore('settings').put({ ...shared, sources: [...new Set(shared.sources.map((key: string) => key === oldKey ? source.bookSourceUrl : key))] }, 'legacySourceState');
  }
  tx.objectStore('sources').put(source, source.bookSourceUrl);
  await tx.done;
}
export async function clearSourceState(key: string, prefix?: string) {
  const inherited=await sourceState(key);
  const transaction = (await db).transaction(['sourceState','settings'], 'readwrite'),store=transaction.objectStore('sourceState');
  if (!prefix) {
    store.delete(key);const shared=await transaction.objectStore('settings').get('legacySourceState');
    if(shared?.sources?.includes(key))transaction.objectStore('settings').put({...shared,sources:shared.sources.filter((source:string)=>source!==key)},'legacySourceState');
  }
  else {
    const state = await store.get(key) || {};
    for (const name of Object.keys(inherited)) if (name.startsWith(prefix)) state[name]={value:''};
    store.put(state, key);
  }
  await transaction.done;
}
export async function preference<T>(key: string, fallback: T): Promise<T> { return await (await db).get('settings', key) ?? fallback; }
export async function sourceSubscriptions():Promise<SourceSubscription[]> {
  const tx=(await db).transaction('settings'),preferences:Record<string,unknown>={};
  for(const key of ['sourceSubscriptions','sourceSubscriptionsVersion','legacyBackupFiles','legacyMigration'])preferences[key]=await tx.store.get(key);
  await tx.done;migrateSourceSubscriptions(preferences);return preferences.sourceSubscriptions as SourceSubscription[]||[];
}
export async function saveSourceSubscriptions(entries:SourceSubscription[]) {
  const tx=(await db).transaction('settings','readwrite');tx.store.put(entries,'sourceSubscriptions');tx.store.put(1,'sourceSubscriptionsVersion');await tx.done;
}
export async function importSubscribedRules(incoming:RuleSubscriptionImport,selected:Set<string>,key:string,preserve:boolean) {
  const count=incoming.type===1?incoming.items.filter(row=>selected.has(row.sourceUrl)).length:incoming.items.filter(row=>selected.has(String(row.id))).length;
  if(!count)throw new Error('请选择要导入的规则');
  const entries=recordSubscriptionImport(await sourceSubscriptions(),key,count);
  const tx=(await db).transaction(['settings','feeds'],'readwrite'),settings=tx.objectStore('settings');
  if(incoming.type===1){
    const feeds=tx.objectStore('feeds');
    for(const source of incoming.items)if(selected.has(source.sourceUrl))feeds.put(rssFeed(source,await feeds.get(source.sourceUrl),preserve),source.sourceUrl);
  }else{
    const rules=new Map(((await settings.get('replaceRules'))||[]).map((row:any)=>[String(row.id),row]));
    for(const rule of incoming.items)if(selected.has(String(rule.id)))rules.set(String(rule.id),rule);
    settings.put([...rules.values()],'replaceRules');
  }
  settings.put(entries,'sourceSubscriptions');settings.put(1,'sourceSubscriptionsVersion');await tx.done;
  return entries;
}
export async function sourceState(key: string): Promise<Record<string, { value: unknown; expires?: number }>> {
  const database=await db,shared=await database.get('settings','legacySourceState');
  return {...(shared?.sources?.includes(key)?shared.state:{}),...await database.get('sourceState',key)};
}
export async function saveSourceState(key: string, changes: Record<string, { value: unknown; expires?: number }>) {
  if (!Object.keys(changes).length) return;
  const tx = (await db).transaction('sourceState', 'readwrite');
  const old = await tx.store.get(key) || {}; await tx.store.put({ ...old, ...changes }, key); await tx.done;
}
export async function settings(): Promise<Settings> { return { ...DEFAULT_SETTINGS, ...await (await db).get('settings', 'reader') }; }
export async function backup(): Promise<string> {
  const transaction = (await db).transaction(['books', 'sources', 'records', 'feeds', 'settings', 'sourceState']);
  const entries = async (name:string) => Object.fromEntries(await Promise.all((await transaction.objectStore(name).getAllKeys()).map(async key => [key, await transaction.objectStore(name).get(key)])));
  const [books,sources,records,feeds,preferences,sourceState] = await Promise.all([transaction.objectStore('books').getAll(),transaction.objectStore('sources').getAll(),transaction.objectStore('records').getAll(),transaction.objectStore('feeds').getAll(),entries('settings'),entries('sourceState')]);
  await transaction.done;
  const {reader,...managerPreferences}=preferences;
  migrateSourceSubscriptions(managerPreferences);
  return JSON.stringify({ format: 'legado-tauri', version: 1, created: new Date().toISOString(), books, sources, records, feeds, settings: {...DEFAULT_SETTINGS,...reader}, sourceState, managerPreferences });
}
export function validateBackup(value: unknown): { books: Book[]; sources: Source[]; records: ReadingRecord[]; feeds: Feed[]; settings: Settings; sourceState: Record<string, unknown> } {
  const data = value as Record<string, unknown>;
  if (!data || data.format !== 'legado-tauri' || data.version !== 1) throw new Error('不是此应用的有效备份');
  if (!Array.isArray(data.books) || !Array.isArray(data.sources) || !Array.isArray(data.records) || !Array.isArray(data.feeds)) throw new Error('备份缺少数据');
  for (const b of data.books) {
    if (!b || typeof b.id !== 'string' || typeof b.name !== 'string' || !Array.isArray(b.chapters) || !Array.isArray(b.bookmarks) || !Number.isInteger(b.chapter) || b.chapter < 0 || b.chapter >= Math.max(1, b.chapters.length) || !Number.isFinite(b.offset) || b.offset < 0 || b.offset > 1) throw new Error('备份书籍数据损坏');
    if (b.chapters.some((c: any) => !c || typeof c.title !== 'string' || ['content','originalContent','reversedOriginal'].some(key=>c[key]!==undefined&&typeof c[key]!=='string') || (c.keepSameTitle!==undefined&&typeof c.keepSameTitle!=='boolean'))) throw new Error('备份章节损坏');
    if (['useReplaceRule','reSegment'].some(key=>b[key]!==undefined&&typeof b[key]!=='boolean')) throw new Error('备份正文设置损坏');
    if(b.bookmarks.some((mark:unknown)=>!validBookmark(mark)))throw new Error('备份书签损坏');
    if(b.tocExpanded!==undefined&&typeof b.tocExpanded!=='boolean')throw new Error('备份目录展开设置损坏');
    if(b.legacyPosition!==undefined&&(!b.legacyPosition||!Number.isInteger(b.legacyPosition.chapter)||b.legacyPosition.chapter<0||!Number.isInteger(b.legacyPosition.position)||b.legacyPosition.position<0||!Number.isInteger(b.legacyPosition.indent)||b.legacyPosition.indent<0||typeof b.legacyPosition.titleVisible!=='boolean'))throw new Error('原版阅读位置损坏');
    if (b.highlights !== undefined && (!Array.isArray(b.highlights) || b.highlights.some((mark: any) => !mark || !Number.isInteger(mark.chapterIndex) || mark.chapterIndex < 0 || !Number.isFinite(mark.chapterPos) || !Number.isFinite(mark.chapterPosEnd) || mark.chapterPos < 0 || mark.chapterPosEnd <= mark.chapterPos || typeof mark.bookText !== 'string' || typeof mark.style !== 'string' || typeof mark.note !== 'string' || !Number.isFinite(mark.time)))) throw new Error('备份高亮损坏');
  }
  for (const s of data.sources) if (!s || typeof s.bookSourceUrl !== 'string' || typeof s.bookSourceName !== 'string') throw new Error('备份书源损坏');
  for (const r of data.records) if (!r || typeof r.id !== 'string' || typeof r.seconds !== 'number' || !Number.isFinite(r.seconds) || r.seconds < 0) throw new Error('备份阅读记录损坏');
  for (const f of data.feeds) if (!f || typeof f.id !== 'string' || typeof f.url !== 'string') throw new Error('备份订阅损坏');
  const prefs = { ...DEFAULT_SETTINGS, ...(typeof data.settings === 'object' && data.settings ? data.settings : {}) } as Settings;
  if(typeof prefs.pullToToggleBookmark!=='boolean'||!Number.isInteger(prefs.pullBookmarkDistance)||prefs.pullBookmarkDistance<0||prefs.pullBookmarkDistance>9999)throw new Error('备份下拉书签设置损坏');
  if (!Number.isFinite(prefs.fontSize) || prefs.fontSize < 5 || prefs.fontSize > 100 || !Number.isFinite(prefs.lineHeight) || prefs.lineHeight < 1 || prefs.lineHeight > 3) throw new Error('备份阅读设置损坏');
  if (data.sourceState !== undefined && (!data.sourceState || typeof data.sourceState !== 'object' || Array.isArray(data.sourceState))) throw new Error('备份书源变量损坏');
  for(const state of Object.values(data.sourceState||{}))if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('备份书源变量损坏');
  const raw=data as any;
  const detached=raw.managerPreferences?.detachedBookmarks;
  if(detached!==undefined){if(!Array.isArray(detached))throw new Error('备份书签损坏');for(const item of detached){if(!item||typeof item!=='object')throw new Error('备份书签损坏');detachedMark(item);}}
  if(raw.managerPreferences&&typeof raw.managerPreferences==='object'&&!Array.isArray(raw.managerPreferences))migrateSourceSubscriptions(raw.managerPreferences);
  if(raw.annotations!==undefined&&(!Array.isArray(raw.annotations)||raw.annotations.some((entry:any)=>typeof entry?.id!=='string'||[entry.name,entry.author].some(value=>value!==undefined&&typeof value!=='string')||!Array.isArray(entry.bookmarks)||entry.bookmarks.some((mark:unknown)=>!validBookmark(mark))||!Array.isArray(entry.highlights))))throw new Error('备份书签高亮损坏');
  return { books: data.books, sources: data.sources, records: data.records, feeds: data.feeds, settings: prefs, sourceState: (data.sourceState || {}) as Record<string, unknown> };
}
export async function restore(text: string, ignore: string[] = []) {
  const raw = JSON.parse(text), data = validateBackup(raw);
  const preferences = raw.managerPreferences || {};
  if (typeof preferences !== 'object' || Array.isArray(preferences)) throw new Error('备份应用设置损坏');
  if (preferences.replaceRules) preferences.replaceRules = parseReplaceRules(JSON.stringify(preferences.replaceRules),!preferences.legacyMigration);
  if (preferences.themeConfigs) preferences.themeConfigs=parseThemes(JSON.stringify(preferences.themeConfigs));
  if (preferences.highlightRules) preferences.highlightRules = parseHighlightRules(JSON.stringify(preferences.highlightRules));
  if (preferences.dictRules) preferences.dictRules = parseDictRules(JSON.stringify(preferences.dictRules));
  if (preferences.txtTocRules) preferences.txtTocRules = parseTxtRules(JSON.stringify(preferences.txtTocRules));
  if (preferences.bookGroups && (!Array.isArray(preferences.bookGroups) || preferences.bookGroups.some((g: any) => !g || typeof g.id !== 'string' || typeof g.name !== 'string'))) throw new Error('备份书籍分组损坏');
  const currentSubscriptions=preferences.sourceSubscriptions!==undefined?await sourceSubscriptions():[];
  const transaction = (await db).transaction(['books', 'sources', 'records', 'feeds', 'settings', 'sourceState'], 'readwrite');
  for (const book of data.books) {
    if(ignore.includes('localBooks')&&book.kind!=='online')continue;
    const old=await transaction.objectStore('books').get(book.id);
    if(raw.backupContent?.annotations===false||ignore.includes('annotations')){book.bookmarks=old?.bookmarks||[];book.highlights=old?.highlights||[];}
    if(ignore.includes('covers')||raw.backupContent?.covers===false)book.cover=old?.cover||'';
    transaction.objectStore('books').put(book, book.id);
  }
  const unmatchedAnnotations:DetachedBookmark[]=[];
  if(raw.backupContent?.annotations!==false&&!ignore.includes('annotations'))for(const annotation of raw.annotations||[]){
    const book=await transaction.objectStore('books').get(annotation.id);
    if(book)transaction.objectStore('books').put({...book,bookmarks:annotation.bookmarks,highlights:annotation.highlights},book.id);
    else if(typeof annotation.name==='string'&&typeof annotation.author==='string')unmatchedAnnotations.push(...annotation.bookmarks.map((mark:Book['bookmarks'][number])=>detachBookmark(annotation,mark,{indent:data.settings.textIndent,titleVisible:data.settings.titleAlign!=='hidden'})));
  }
  if(raw.backupContent?.annotations!==false&&!ignore.includes('annotations')){
    const settings=transaction.objectStore('settings'),bookStore=transaction.objectStore('books'),pending:DetachedBookmark[]=await settings.get('detachedBookmarks')||[];
    const incoming:DetachedBookmark[]=[...(preferences.detachedBookmarks||[]),...unmatchedAnnotations];
    if(pending.length||incoming.length){
      const books=(await bookStore.getAll() as Book[]).filter(book=>!(ignore.includes('localBooks')&&book.kind!=='online'));
      const result=reconcileBookmarks(books,[...pending,...incoming],new Set(incoming.map(item=>recordIdentity(item.record))));
      result.books.forEach((book,index)=>{if(book!==books[index])bookStore.put(book,book.id);});
      settings.put(result.detached,'detachedBookmarks');
    }
  }
  for (const source of data.sources) transaction.objectStore('sources').put(source, source.bookSourceUrl);
  for (const record of data.records) transaction.objectStore('records').put(record, record.id);
  for (const feed of data.feeds) transaction.objectStore('feeds').put(feed, feed.id);
  if(raw.backupContent?.settings!==false){
    const current=await transaction.objectStore('settings').get('reader')||{};
    if(raw.legacyArchive){
      data.settings={...DEFAULT_SETTINGS,...current,...raw.settings};
      if(raw.settings?.readerColors)raw.settings.readerColors=Object.fromEntries(Object.entries(raw.settings.readerColors).map(([mode,color])=>[mode,{...current.readerColors?.[mode],...color as object}]));
      for(const [key,base]of Object.entries({themeDay:dayTheme,themeNight:nightTheme,coverConfig:defaultCover,readerColors:{}}))if(raw.settings?.[key])(data.settings as any)[key]={...base,...current[key],...raw.settings[key]};
    }
    const themeKeys=['dark','themeMode','themeDay','themeNight','barElevation'],layoutKeys=Object.keys(DEFAULT_SETTINGS).filter(key=>key.startsWith('shelf')||['layout','showShelfStatus'].includes(key));
    for(const key of Object.keys(data.settings))if((ignore.includes('reader')&&!themeKeys.includes(key)&&!layoutKeys.includes(key)&&key!=='coverConfig')||(ignore.includes('theme')&&themeKeys.includes(key))||(ignore.includes('layout')&&layoutKeys.includes(key))||((ignore.includes('covers')||raw.backupContent?.covers===false)&&['coverConfig','fontData','fontName'].includes(key))||(raw.backupContent?.backgrounds===false&&['welcomeImage','welcomeImageDark','readerBackground'].includes(key))){if(current[key]!==undefined)(data.settings as any)[key]=current[key];else delete(data.settings as any)[key];}
    if(raw.backupContent?.backgrounds===false)for(const key of ['themeDay','themeNight'])if((data.settings as any)[key]&&current[key])(data.settings as any)[key].backgroundImgPath=current[key].backgroundImgPath;
    if(raw.backupContent?.backgrounds===false&&data.settings.readerColors)for(const [mode,color]of Object.entries(data.settings.readerColors))color.readerBackground=current.readerColors?.[mode]?.readerBackground||'';
    transaction.objectStore('settings').put(data.settings, 'reader');
  }
  for (const [key,value] of Object.entries(preferences)) {
    if(value===undefined||key==='reader'||['backupRuntime','backupPassword','backupLog','detachedBookmarks'].includes(key))continue;
    if(ignore.includes('reader')&&['readerMenuConfig','contentEditPlainText','contentSearchScope','contentSearchReplace'].includes(key)||raw.backupContent?.settings===false&&['contentSearchScope','contentSearchReplace'].includes(key)||ignore.includes('theme')&&key==='themeConfigs'||ignore.includes('annotations')&&['highlightRules','highlightLastStyle'].includes(key))continue;
    if(key==='themeConfigs'&&raw.backupContent?.backgrounds===false){
      const current=await transaction.objectStore('settings').get(key)||[];
      for(const theme of value as any[])theme.backgroundImgPath=current.find((item:any)=>item.themeName===theme.themeName&&item.isNightTheme===theme.isNightTheme)?.backgroundImgPath||'';
    }
    if(key==='backupConfig'){
      const current=await transaction.objectStore('settings').get(key);
      if(current)transaction.objectStore('settings').put({...value as object,localDirectory:current.localDirectory,deviceName:current.deviceName,...(current.username?{url:current.url,username:current.username,password:current.password,directory:current.directory}:{}),autoEnabled:current.autoEnabled},key);
      else transaction.objectStore('settings').put({...value as object,localDirectory:'',autoEnabled:false},key);
    }else if(key==='sourceSubscriptions'){
      transaction.objectStore('settings').put(mergeSubscriptions(currentSubscriptions,value as SourceSubscription[]),key);
    }else if(key==='legacySourceState'){
      const incoming=value as any,current=await transaction.objectStore('settings').get(key)||{sources:[],state:{}};
      const filtered=Object.fromEntries(Object.entries(incoming.state||{}).filter(([name])=>!(name.startsWith('cookie:')?ignore.includes('cookies'):ignore.includes('sourceState'))));
      transaction.objectStore('settings').put({...incoming,sources:[...new Set([...(current.sources||[]),...(incoming.sources||[])])],state:{...current.state,...filtered}},key);
    }else transaction.objectStore('settings').put(value,key);
  }
  for (const [key, value] of Object.entries(data.sourceState)) {
    const old=await transaction.objectStore('sourceState').get(key)||{};
    const filtered=Object.fromEntries(Object.entries(value as object).filter(([name])=>!(name.startsWith('cookie:')?ignore.includes('cookies'):ignore.includes('sourceState'))));
    transaction.objectStore('sourceState').put({...old,...filtered}, key);
  }
  await transaction.done;
}
export async function restoreFile(bytes:Uint8Array) {
  if(bytes[0]===0x50&&bytes[1]===0x4b){
    const files=unzipSync(bytes),backups=Object.entries(files).filter(([name])=>/(^|\/)legado-tauri\.json$/.test(name));
    if(backups.length!==1)throw new Error('压缩备份中缺少唯一的 legado-tauri.json');
    return restore(strFromU8(backups[0][1]));
  }
  return restore(strFromU8(bytes));
}
