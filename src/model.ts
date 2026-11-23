export const VERSION = 'legado_app_3.26112301';

export type Chapter = { title: string; url?: string; content?: string };
export type Bookmark = { chapter: number; offset: number; title: string; created: number };
export type Book = {
  id: string; name: string; author: string; intro?: string; cover?: string;
  kind: 'txt' | 'epub' | 'online'; sourceUrl?: string; url?: string;
  chapters: Chapter[]; chapter: number; offset: number; added: number; lastRead: number;
  finished: boolean; note: string; bookmarks: Bookmark[];
};
export type Source = {
  bookSourceUrl: string; bookSourceName: string; bookSourceGroup?: string;
  enabled?: boolean; bookSourceType?: number; searchUrl?: string; exploreUrl?: string;
  header?: string; jsLib?: string; mainJs?: string;
  ruleSearch?: Record<string, string>; ruleExplore?: Record<string, string>;
  ruleBookInfo?: Record<string, string>; ruleToc?: Record<string, string>; ruleContent?: Record<string, string>;
};
export type SearchResult = { name: string; author: string; url: string; cover?: string; intro?: string; sourceUrl: string; sourceName: string };
export type Settings = {
  fontSize: number; lineHeight: number; paragraphSpace: number; font: 'serif' | 'sans';
  readerTheme: 'paper' | 'white' | 'green' | 'night'; dark: boolean;
  layout: 'grid' | 'list'; twoPage: boolean; pageMode: 'scroll' | 'pages';
};
export type ReadingRecord = { id: string; bookId: string; bookName: string; chapter: string; started: number; seconds: number };
export type Feed = { id: string; name: string; url: string };
export const DEFAULT_SETTINGS: Settings = { fontSize: 22, lineHeight: 1.9, paragraphSpace: 0.8, font: 'serif', readerTheme: 'paper', dark: false, layout: 'grid', twoPage: true, pageMode: 'scroll' };
export function newBook(name: string, kind: Book['kind'], chapters: Chapter[], author = '未知作者'): Book {
  return { id: crypto.randomUUID(), name, author, kind, chapters, chapter: 0, offset: 0, added: Date.now(), lastRead: 0, finished: false, note: '', bookmarks: [] };
}
export function smartGroup(book: Book): '未读' | '在读' | '已读' {
  return book.finished ? '已读' : book.lastRead ? '在读' : '未读';
}
export function progress(book: Book): number {
  return book.finished ? 100 : Math.round((book.chapter + book.offset) / Math.max(1, book.chapters.length) * 100);
}
