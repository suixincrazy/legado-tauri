import { openDB } from 'idb';
import { DEFAULT_SETTINGS, type Book, type Source, type Settings, type ReadingRecord, type Feed } from './model';

const db = openDB('legado-reader', 2, { upgrade(database) {
  for (const name of ['books', 'sources', 'settings', 'records', 'feeds', 'sourceState']) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
} });
export async function all<T>(store: string): Promise<T[]> { return (await db).getAll(store); }
export async function put(store: string, key: string, value: unknown) { return (await db).put(store, value, key); }
export async function remove(store: string, key: string) { return (await db).delete(store, key); }
export async function sourceState(key: string): Promise<Record<string, { value: unknown; expires?: number }>> { return await (await db).get('sourceState', key) || {}; }
export async function saveSourceState(key: string, changes: Record<string, { value: unknown; expires?: number }>) {
  if (!Object.keys(changes).length) return;
  const tx = (await db).transaction('sourceState', 'readwrite');
  const old = await tx.store.get(key) || {}; await tx.store.put({ ...old, ...changes }, key); await tx.done;
}
export async function settings(): Promise<Settings> { return { ...DEFAULT_SETTINGS, ...await (await db).get('settings', 'reader') }; }
export async function backup(): Promise<string> {
  const database = await db; const keys = await database.getAllKeys('sourceState');
  const sourceState = Object.fromEntries(await Promise.all(keys.map(async key => [key, await database.get('sourceState', key)])));
  return JSON.stringify({ format: 'legado-tauri', version: 1, created: new Date().toISOString(), books: await all('books'), sources: await all('sources'), records: await all('records'), feeds: await all('feeds'), settings: await settings(), sourceState });
}
export function validateBackup(value: unknown): { books: Book[]; sources: Source[]; records: ReadingRecord[]; feeds: Feed[]; settings: Settings; sourceState: Record<string, unknown> } {
  const data = value as Record<string, unknown>;
  if (!data || data.format !== 'legado-tauri' || data.version !== 1) throw new Error('不是此应用的有效备份');
  if (!Array.isArray(data.books) || !Array.isArray(data.sources) || !Array.isArray(data.records) || !Array.isArray(data.feeds)) throw new Error('备份缺少数据');
  for (const b of data.books) {
    if (!b || typeof b.id !== 'string' || typeof b.name !== 'string' || !Array.isArray(b.chapters) || !Array.isArray(b.bookmarks) || !Number.isInteger(b.chapter) || b.chapter < 0 || b.chapter >= Math.max(1, b.chapters.length) || !Number.isFinite(b.offset) || b.offset < 0 || b.offset > 1) throw new Error('备份书籍数据损坏');
    if (b.chapters.some((c: unknown) => !c || typeof (c as { title: unknown }).title !== 'string')) throw new Error('备份章节损坏');
  }
  for (const s of data.sources) if (!s || typeof s.bookSourceUrl !== 'string' || typeof s.bookSourceName !== 'string') throw new Error('备份书源损坏');
  for (const r of data.records) if (!r || typeof r.id !== 'string' || typeof r.seconds !== 'number' || !Number.isFinite(r.seconds) || r.seconds < 0) throw new Error('备份阅读记录损坏');
  for (const f of data.feeds) if (!f || typeof f.id !== 'string' || typeof f.url !== 'string') throw new Error('备份订阅损坏');
  const prefs = { ...DEFAULT_SETTINGS, ...(typeof data.settings === 'object' && data.settings ? data.settings : {}) } as Settings;
  if (!Number.isFinite(prefs.fontSize) || prefs.fontSize < 12 || prefs.fontSize > 48 || !Number.isFinite(prefs.lineHeight) || prefs.lineHeight < 1 || prefs.lineHeight > 3) throw new Error('备份阅读设置损坏');
  if (data.sourceState !== undefined && (!data.sourceState || typeof data.sourceState !== 'object' || Array.isArray(data.sourceState))) throw new Error('备份书源变量损坏');
  return { books: data.books, sources: data.sources, records: data.records, feeds: data.feeds, settings: prefs, sourceState: (data.sourceState || {}) as Record<string, unknown> };
}
export async function restore(text: string) {
  const data = validateBackup(JSON.parse(text));
  const transaction = (await db).transaction(['books', 'sources', 'records', 'feeds', 'settings', 'sourceState'], 'readwrite');
  for (const book of data.books) transaction.objectStore('books').put(book, book.id);
  for (const source of data.sources) transaction.objectStore('sources').put(source, source.bookSourceUrl);
  for (const record of data.records) transaction.objectStore('records').put(record, record.id);
  for (const feed of data.feeds) transaction.objectStore('feeds').put(feed, feed.id);
  transaction.objectStore('settings').put(data.settings, 'reader');
  for (const [key, value] of Object.entries(data.sourceState)) transaction.objectStore('sourceState').put(value, key);
  await transaction.done;
}
