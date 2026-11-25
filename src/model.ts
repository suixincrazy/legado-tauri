export const VERSION = 'legado_app_3.26112502';
export function createId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export type Chapter = { title: string; url?: string; content?: string; variables?: Record<string, unknown>; isVolume?: boolean; isVip?: boolean; isPay?: boolean; index?: number };
export type Bookmark = { chapter: number; offset: number; title: string; created: number };
export type Book = {
  id: string; name: string; author: string; intro?: string; cover?: string;
  kind: 'txt' | 'epub' | 'online'; sourceUrl?: string; url?: string; tocUrl?: string; variables?: Record<string, unknown>;
  chapters: Chapter[]; chapter: number; offset: number; added: number; lastRead: number;
  finished: boolean; note: string; bookmarks: Bookmark[];
  groups?: string[]; canUpdate?: boolean;
};
export type BookGroup = { id: string; name: string; order: number; show: boolean; enableRefresh: boolean };
export type Source = {
  [key: string]: unknown;
  bookSourceUrl: string; bookSourceName: string; bookSourceGroup?: string;
  enabled?: boolean; bookSourceType?: number; searchUrl?: string; exploreUrl?: string;
  header?: string; jsLib?: string; mainJs?: string;
  loginUrl?: string; loginUi?: string; loginCheckJs?: string;
  enabledExplore?: boolean; customOrder?: number; weight?: number; lastUpdateTime?: number; respondTime?: number;
  bookSourceComment?: string; variableComment?: string; bookUrlPattern?: string; enabledCookieJar?: boolean; concurrentRate?: string;
  checkResult?: { status: 'ok' | 'error'; time: number; message: string; stages: string[] };
  ruleSearch?: Record<string, string>; ruleExplore?: Record<string, string>;
  ruleBookInfo?: Record<string, string>; ruleToc?: Record<string, string>; ruleContent?: Record<string, string>;
};
export type SearchResult = { name: string; author: string; url: string; cover?: string; intro?: string; category?: string; latestChapterTitle?: string; wordCount?: string; sourceUrl: string; sourceName: string; variables?: Record<string, unknown> };
export type Settings = {
  fontSize: number; lineHeight: number; paragraphSpace: number; font: 'serif' | 'sans';
  readerTheme: 'paper' | 'white' | 'green' | 'night'; dark: boolean;
  layout: 'grid' | 'list'; twoPage: boolean; pageMode: 'scroll' | 'pages';
  shelfColumns: number; showShelfStatus: boolean;
  readBold: boolean; textIndent: number; autoPageSeconds: number;
  welcomeShowTime: number; customWelcome: boolean; welcomeImage: string; welcomeImageDark: string;
  welcomeShowText: boolean; welcomeShowTextDark: boolean; welcomeShowIcon: boolean; welcomeShowIconDark: boolean;
};
export type ReadingRecord = { id: string; bookId: string; bookName: string; chapter: string; started: number; seconds: number };
export type Feed = { id: string; name: string; url: string };
export const DEFAULT_SETTINGS: Settings = { fontSize: 22, lineHeight: 1.9, paragraphSpace: 0.8, font: 'serif', readerTheme: 'paper', dark: false, layout: 'list', twoPage: true, pageMode: 'scroll', readBold:false, textIndent:2, autoPageSeconds:10, shelfColumns: 3, showShelfStatus: false, welcomeShowTime: 500, customWelcome: false, welcomeImage: '', welcomeImageDark: '', welcomeShowText: true, welcomeShowTextDark: true, welcomeShowIcon: true, welcomeShowIconDark: true };
export function newBook(name: string, kind: Book['kind'], chapters: Chapter[], author = '未知作者'): Book {
  return { id: createId(), name, author, kind, chapters, chapter: 0, offset: 0, added: Date.now(), lastRead: 0, finished: false, note: '', bookmarks: [] };
}
export function smartGroup(book: Book): '未读' | '在读' | '已读' {
  return book.finished ? '已读' : book.lastRead ? '在读' : '未读';
}
export function progress(book: Book): number {
  return book.finished ? 100 : Math.round((book.chapter + book.offset) / Math.max(1, book.chapters.length) * 100);
}
