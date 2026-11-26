import { openDB } from 'idb';
import { DEFAULT_SETTINGS, type Book, type Source, type Settings, type ReadingRecord, type Feed } from './model';
import { parseReplaceRules } from './replacement-engine';
import { parseThemes } from './theme-model';
import { parseDictRules } from './dictionary';
import { parseHighlightRules } from './highlight-engine';
import { parseTxtRules } from './txt-rules-engine';
import {strFromU8,unzipSync} from 'fflate';

const db = openDB('legado-reader', 3, { upgrade(database) {
  for (const name of ['books', 'sources', 'settings', 'records', 'feeds', 'sourceState','backups']) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
} });
export async function all<T>(store: string): Promise<T[]> { return (await db).getAll(store); }
export async function put(store: string, key: string, value: unknown) { return (await db).put(store, value, key); }
export async function remove(store: string, key: string) { return (await db).delete(store, key); }
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
    if(b.bookmarks.some((mark:any)=>!mark||!Number.isInteger(mark.chapter)||mark.chapter<0||!Number.isFinite(mark.offset)||mark.offset<0||mark.offset>1||typeof mark.title!=='string'||!Number.isFinite(mark.created)))throw new Error('备份书签损坏');
    if(b.legacyPosition!==undefined&&(!b.legacyPosition||!Number.isInteger(b.legacyPosition.chapter)||b.legacyPosition.chapter<0||!Number.isInteger(b.legacyPosition.position)||b.legacyPosition.position<0||!Number.isInteger(b.legacyPosition.indent)||b.legacyPosition.indent<0||typeof b.legacyPosition.titleVisible!=='boolean'))throw new Error('原版阅读位置损坏');
    if (b.highlights !== undefined && (!Array.isArray(b.highlights) || b.highlights.some((mark: any) => !mark || !Number.isInteger(mark.chapterIndex) || mark.chapterIndex < 0 || !Number.isFinite(mark.chapterPos) || !Number.isFinite(mark.chapterPosEnd) || mark.chapterPos < 0 || mark.chapterPosEnd <= mark.chapterPos || typeof mark.bookText !== 'string' || typeof mark.style !== 'string' || typeof mark.note !== 'string' || !Number.isFinite(mark.time)))) throw new Error('备份高亮损坏');
  }
  for (const s of data.sources) if (!s || typeof s.bookSourceUrl !== 'string' || typeof s.bookSourceName !== 'string') throw new Error('备份书源损坏');
  for (const r of data.records) if (!r || typeof r.id !== 'string' || typeof r.seconds !== 'number' || !Number.isFinite(r.seconds) || r.seconds < 0) throw new Error('备份阅读记录损坏');
  for (const f of data.feeds) if (!f || typeof f.id !== 'string' || typeof f.url !== 'string') throw new Error('备份订阅损坏');
  const prefs = { ...DEFAULT_SETTINGS, ...(typeof data.settings === 'object' && data.settings ? data.settings : {}) } as Settings;
  if (!Number.isFinite(prefs.fontSize) || prefs.fontSize < 5 || prefs.fontSize > 100 || !Number.isFinite(prefs.lineHeight) || prefs.lineHeight < 1 || prefs.lineHeight > 3) throw new Error('备份阅读设置损坏');
  if (data.sourceState !== undefined && (!data.sourceState || typeof data.sourceState !== 'object' || Array.isArray(data.sourceState))) throw new Error('备份书源变量损坏');
  for(const state of Object.values(data.sourceState||{}))if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('备份书源变量损坏');
  const raw=data as any;
  if(raw.annotations!==undefined&&(!Array.isArray(raw.annotations)||raw.annotations.some((entry:any)=>typeof entry?.id!=='string'||!Array.isArray(entry.bookmarks)||!Array.isArray(entry.highlights))))throw new Error('备份书签高亮损坏');
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
  if (preferences.sourceSubscriptions && (!Array.isArray(preferences.sourceSubscriptions) || preferences.sourceSubscriptions.some((s: any) => !s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)))) throw new Error('备份书源订阅损坏');
  const transaction = (await db).transaction(['books', 'sources', 'records', 'feeds', 'settings', 'sourceState'], 'readwrite');
  for (const book of data.books) {
    if(ignore.includes('localBooks')&&book.kind!=='online')continue;
    const old=await transaction.objectStore('books').get(book.id);
    if(raw.backupContent?.annotations===false||ignore.includes('annotations')){book.bookmarks=old?.bookmarks||[];book.highlights=old?.highlights||[];}
    if(raw.backupContent?.covers===false&&old?.cover)book.cover=old.cover;
    transaction.objectStore('books').put(book, book.id);
  }
  if(!ignore.includes('annotations'))for(const annotation of raw.annotations||[]){
    const book=await transaction.objectStore('books').get(annotation.id);
    if(book)transaction.objectStore('books').put({...book,bookmarks:annotation.bookmarks,highlights:annotation.highlights},book.id);
  }
  for (const source of data.sources) transaction.objectStore('sources').put(source, source.bookSourceUrl);
  for (const record of data.records) transaction.objectStore('records').put(record, record.id);
  for (const feed of data.feeds) transaction.objectStore('feeds').put(feed, feed.id);
  if(raw.backupContent?.settings!==false){
    const current=await transaction.objectStore('settings').get('reader')||{};
    const themeKeys=['dark','themeMode','themeDay','themeNight','barElevation'],layoutKeys=Object.keys(DEFAULT_SETTINGS).filter(key=>key.startsWith('shelf')||['layout','showShelfStatus'].includes(key));
    for(const key of Object.keys(data.settings))if((ignore.includes('reader')&&!themeKeys.includes(key)&&!layoutKeys.includes(key)&&key!=='coverConfig')||(ignore.includes('theme')&&themeKeys.includes(key))||(ignore.includes('layout')&&layoutKeys.includes(key))||((ignore.includes('covers')||raw.backupContent?.covers===false)&&['coverConfig','fontData','fontName'].includes(key))||(raw.backupContent?.backgrounds===false&&['welcomeImage','welcomeImageDark','readerBackground'].includes(key))){if(current[key]!==undefined)(data.settings as any)[key]=current[key];else delete(data.settings as any)[key];}
    if(raw.backupContent?.backgrounds===false)for(const key of ['themeDay','themeNight'])if((data.settings as any)[key]&&current[key])(data.settings as any)[key].backgroundImgPath=current[key].backgroundImgPath;
    transaction.objectStore('settings').put(data.settings, 'reader');
  }
  for (const [key,value] of Object.entries(preferences)) {
    if(value===undefined||key==='reader'||['backupRuntime','backupPassword'].includes(key))continue;
    if(ignore.includes('reader')&&['readerMenuConfig','contentEditPlainText'].includes(key)||ignore.includes('theme')&&key==='themeConfigs'||ignore.includes('annotations')&&['highlightRules','highlightLastStyle'].includes(key))continue;
    if(key==='backupConfig'){
      const current=await transaction.objectStore('settings').get(key);
      if(current)transaction.objectStore('settings').put({...value as object,localDirectory:current.localDirectory,deviceName:current.deviceName,...(current.username?{url:current.url,username:current.username,password:current.password,directory:current.directory}:{}),autoEnabled:current.autoEnabled},key);
      else transaction.objectStore('settings').put({...value as object,localDirectory:'',autoEnabled:false},key);
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
