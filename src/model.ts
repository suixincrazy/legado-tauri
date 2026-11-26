export const VERSION = 'legado_app_3.26112604';
export function createId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export type Chapter = { title: string; url?: string; content?: string; variables?: Record<string, unknown>; isVolume?: boolean; isVip?: boolean; isPay?: boolean; index?: number; originalContent?:string; reversedOriginal?:string; keepSameTitle?:boolean };
export type Bookmark = { chapter: number; offset: number; title: string; created: number };
export type BookHighlight = {time:number;bookUrl:string;chapterUrl:string;bookName:string;bookAuthor:string;chapterIndex:number;chapterPos:number;chapterPosEnd:number;layoutTitleLength:number;chapterName:string;bookText:string;style:string;note:string};
export type Book = {
  id: string; name: string; author: string; intro?: string; cover?: string;
  kind: 'txt' | 'epub' | 'online'; sourceUrl?: string; url?: string; tocUrl?: string; variables?: Record<string, unknown>;
  chapters: Chapter[]; chapter: number; offset: number; added: number; lastRead: number;
  finished: boolean; note: string; bookmarks: Bookmark[];
  groups?: string[]; canUpdate?: boolean; pinned?:boolean;
  rawText?: string; txtTocRuleId?: number; order?:number; latestChapterTime?:number;
  highlights?:BookHighlight[];
  useReplaceRule?:boolean;reSegment?:boolean;
  legacyPosition?:{chapter:number;position:number;titleVisible:boolean;indent:number};
  syncPosition?:{chapter:number;position:number};
  localFileName?:string;
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
export type ThemeConfig = {themeName:string;isNightTheme:boolean;primaryColor:string;accentColor:string;backgroundColor:string;bottomBackground:string;transparentNavBar?:boolean;backgroundImgPath?:string;backgroundImgBlur?:number};
export type CoverConfig = {useDefault:boolean;horizontal:boolean;adaptive:boolean;keepPunctuation:boolean;showName:boolean;showAuthor:boolean;showNameDark:boolean;showAuthorDark:boolean;image:string;imageDark:string;fontData:string;fontName:string;customSize:boolean;titleLarge:number;titleSmall:number;authorLarge:number;authorSmall:number};
export type ReaderColors = {readerBackground?:string;readerBackgroundColor?:string;readerTextColor?:string};
export type Settings = {
  fontSize: number; lineHeight: number; paragraphSpace: number; font: 'serif' | 'sans';
  readerTheme: 'paper' | 'white' | 'green' | 'night'; dark: boolean;
  layout: 'grid' | 'list' | 'compact'; twoPage: boolean; pageMode: 'scroll' | 'pages';
  shelfColumns: number; showShelfStatus: boolean;
  shelfSort:'recent'|'updated'|'name'|'manual'|'combined'|'author'; shelfProgress:0|2|4; shelfUnread:boolean; shelfUpdateTime:boolean;
  shelfName:'show'|'hide'|'overlay'; shelfMargin:number; shelfSmartGroups:boolean; shelfGroupStyle:'tabs'|'folder';
  readBold: boolean; textIndent: number; autoPageSeconds: number;
  readThin?:boolean;readerBackgroundColor?:string;readerColors?:Partial<Record<'day'|'night'|'eink',ReaderColors>>;
  letterSpacing:number; readerPaddingTop:number; readerPaddingBottom:number; readerPaddingLeft:number; readerPaddingRight:number;
  chineseConversion:'none'|'simple'|'traditional'; fontData:string; fontName:string;
  titleAlign:'left'|'center'|'right'|'hidden'; titleSize:number; showHeader:boolean; showFooter:boolean;
  pageAnimation:'cover'|'slide'|'simulation'|'none'; readerBackground:string; readerTextColor:string;
  keepScreenOn:boolean; screenOrientation:'auto'|'portrait'|'landscape'; brightness:number;
  showBrightnessView?:boolean; brightnessOnRight?:boolean; readerBrightness?:number;
  progressBarBehavior?:'page'|'chapter';
  welcomeShowTime: number; customWelcome: boolean; welcomeImage: string; welcomeImageDark: string;
  welcomeShowText: boolean; welcomeShowTextDark: boolean; welcomeShowIcon: boolean; welcomeShowIconDark: boolean;
  themeMode?:'system'|'day'|'night'|'eink';themeDay?:ThemeConfig;themeNight?:ThemeConfig;barElevation?:boolean;coverConfig?:CoverConfig;
};
export type ReadingRecord = { id: string; bookId: string; bookName: string; chapter: string; started: number; seconds: number };
export type Feed = { id: string; name: string; url: string };
export const DEFAULT_SETTINGS: Settings = { fontSize: 20, lineHeight: 1.6, paragraphSpace: 0.2, font: 'sans', readerTheme: 'paper', dark: false, layout: 'list', twoPage: true, pageMode: 'pages', readBold:false, textIndent:2, autoPageSeconds:10, shelfColumns: 3, showShelfStatus: false, shelfSort:'recent',shelfProgress:0,shelfUnread:true,shelfUpdateTime:false,shelfName:'show',shelfMargin:0,shelfSmartGroups:false,shelfGroupStyle:'tabs', welcomeShowTime: 500, customWelcome: false, welcomeImage: '', welcomeImageDark: '', welcomeShowText: true, welcomeShowTextDark: true, welcomeShowIcon: true, welcomeShowIconDark: true, letterSpacing:.1,readerPaddingTop:6,readerPaddingBottom:6,readerPaddingLeft:16,readerPaddingRight:16,chineseConversion:'none',fontData:'',fontName:'',titleAlign:'left',titleSize:25,showHeader:true,showFooter:true,pageAnimation:'cover',readerBackground:'',readerTextColor:'',keepScreenOn:false,screenOrientation:'auto',brightness:-1 };
export function newBook(name: string, kind: Book['kind'], chapters: Chapter[], author = '未知作者'): Book {
  return { id: createId(), name, author, kind, chapters, chapter: 0, offset: 0, added: Date.now(), lastRead: 0, finished: false, note: '', bookmarks: [] };
}
export function smartGroup(book: Book): '未读' | '在读' | '已读' {
  return book.finished ? '已读' : book.lastRead ? '在读' : '未读';
}
export function progress(book: Book): number {
  return book.finished ? 100 : Math.round((book.chapter + book.offset) / Math.max(1, book.chapters.length) * 100);
}
