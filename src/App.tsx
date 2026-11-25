import { Modal, IconButton, CoverSettingsContext } from './ui';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, Rss, MoreVertical, Bookmark, ChevronRight, Check, Trash2, Clock3, ExternalLink, WifiOff } from 'lucide-react';
import { DEFAULT_SETTINGS, VERSION, createId, progress, smartGroup, type Book, type BookGroup, type Settings, type Source, type SearchResult, type ReadingRecord, type Feed } from './model';
import * as storage from './storage';
import { importBook, decodeText, htmlText } from './import';
import { pickFiles, saveFile } from './files';
import { loadOnlineBook, loadChapter } from './sources';
import { BookSearch } from './BookSearch';
import { BookDetails } from './BookDetails';
import { updatedBook } from './book-update';
import { ReaderSettings, ReaderStyleSettings } from './ReaderSettings';
import { readerScreen } from './reader-screen';
import { ReaderBrightness } from './ReaderBrightness';
import { processReaderContent } from './reader-content';
import { TxtTocManager } from './TxtTocManager';
import { DictionaryDialog, DictionaryManager } from './DictManager';
import { ReaderSelection } from './ReaderSelection';
import { ContentEditor } from './ContentEditor';
import { reverseChapter } from './content-processing';
import { ReadAloudPanel, useReadAloud } from './ReadAloud';
import { cachedSpeechQueue, sentenceStart, speechChunks } from './read-aloud';
import { revealTextPosition, visibleTextPosition } from './reader-position';
import { HighlightEditor, HighlightFonts, HighlightRuleManager, highlightCss } from './Highlights';
import { anchoredHighlight, applyHighlightRules, highlightPresets, highlightSegments, highlightStyle, newHighlightRule, readingParagraphs, scopedHighlightRules, type HighlightRule, type HighlightRange, type HighlightStyle } from './highlight';
import type { BookHighlight } from './model';
import { defaultTxtRules, importTxtWithRules, type TxtTocRule } from './txt-rules';
import { fetchText } from './network';
import { pagination } from './pagination';
import { SourceSettings } from './SourceSettings';
import { SourceManager } from './SourceManager';
import { ExplorePage } from './ExplorePage';
import { Bookshelf, BookshelfSettings } from './Bookshelf';
import { sortBooks } from './bookshelf-model';
import { ThemeSettings } from './ThemeSettings';
import { cssColor,contrastText,defaultCover,themeColors } from './theme-model';
import { sourceGroups } from './source-management';
import { LegadoIcon } from './LegadoIcon';
import { Welcome, WelcomeSettings } from './Welcome';
import { GroupManager, LibraryManager } from './LibraryManager';
import { ReplaceManager } from './ReplaceManager';
import type { ReplaceRule } from './replacement';
import { invoke, isTauri } from '@tauri-apps/api/core';

type Tab = '书架' | '发现' | '订阅' | '我的';
type Panel = 'sources' | 'search' | 'settings' | 'stats' | 'about' | 'theme' | 'welcome' | 'layout' | 'backup' | 'bookmarks' | 'replace' | 'groups' | 'library' | 'txtRules' | 'dictRules' | null;
const icons = { 书架: 'books', 发现: 'explore', 订阅: 'rss_feed', 我的: 'person' };
function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{text}</p>{children}</div>;
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([]); const [sources, setSources] = useState<Source[]>([]);
  const [prefs, setPrefs] = useState<Settings>(DEFAULT_SETTINGS); const [records, setRecords] = useState<ReadingRecord[]>([]);
  const [bookGroups, setBookGroups] = useState<BookGroup[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]); const [tab, setTab] = useState<Tab>('书架');
  const [panel, setPanel] = useState<Panel>(null); const [reader, setReader] = useState<string | null>(null);
  const [previewBook, setPreviewBook] = useState<Book|null>(null);
  const [detail, setDetail] = useState<string | null>(null); const [group, setGroup] = useState('全部');
  const [menu, setMenu] = useState(false); const [toast, setToast] = useState(''); const [busy, setBusy] = useState('');
  const [ready, setReady] = useState(false); const [filter, setFilter] = useState('');
  const [exploreUrl, setExploreUrl] = useState<string | undefined>();
  const [searchTarget, setSearchTarget] = useState<Source | null>(null);
  const [sourceSettings, setSourceSettings] = useState<Source | null>(null);
  const [exploreQuery,setExploreQuery]=useState(''),[exploreGroup,setExploreGroup]=useState(''),[exploreGroupsOpen,setExploreGroupsOpen]=useState(false);
  const [editSource,setEditSource]=useState<Source|null>(null);
  const [rssAdd, setRssAdd] = useState(false);
  const [feedUrl, setFeedUrl] = useState(''); const [feedArticles, setFeedArticles] = useState<{ title: string; content: string; url: string }[]>([]);
  const [activeArticle, setActiveArticle] = useState<{ title: string; content: string; url: string } | null>(null);
  const notify = useCallback((text: string) => setToast(text), []);
  const refresh = useCallback(async () => {
    const [b, s, p, r, f] = await Promise.all([storage.all<Book>('books'), storage.all<Source>('sources'), storage.settings(), storage.all<ReadingRecord>('records'), storage.all<Feed>('feeds')]);
    setBooks(b); setSources(s); setPrefs(p); setRecords(r); setFeeds(f); setBookGroups(await storage.preference<BookGroup[]>('bookGroups', []));
  }, []);
  useEffect(() => { refresh().then(() => setReady(true)).catch(error => notify(String(error))); }, [refresh, notify]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(()=>{
    if(!ready||prefs.themeMode!=='system')return;
    const media=matchMedia('(prefers-color-scheme: dark)');
    const update=()=>{setPrefs(old=>{if(old.dark===media.matches)return old;const next={...old,dark:media.matches};storage.put('settings','reader',next).catch(error=>notify(String(error)));return next;});};
    update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
  },[ready,prefs.themeMode,notify]);
  useEffect(() => {
    const root=document.documentElement,theme=themeColors(prefs);
    root.dataset.theme = prefs.dark ? 'dark' : 'light';root.dataset.eink=String(prefs.themeMode==='eink');
    for(const [key,value] of Object.entries({'--primary':cssColor(theme.primaryColor),'--accent':cssColor(theme.accentColor),'--bg':cssColor(theme.backgroundColor),'--surface':cssColor(theme.backgroundColor),'--bottom':cssColor(theme.bottomBackground),'--toolbar-text':contrastText(theme.primaryColor),'--bar-shadow':prefs.barElevation===false?'none':'0 2px 4px #0003','--theme-image':theme.backgroundImgPath&&/^(data:image\/|https?:)/.test(theme.backgroundImgPath)?`url(${JSON.stringify(theme.backgroundImgPath)})`:'none','--theme-blur':`${theme.backgroundImgBlur||0}px`,'--nav-background':theme.transparentNavBar?'transparent':cssColor(theme.bottomBackground)}))root.style.setProperty(key,value);
    if (isTauri() && /Android/i.test(navigator.userAgent)) invoke('java_bridge', { payload: JSON.stringify({ operation: 'systemUi', dark: prefs.dark,primaryColor:theme.primaryColor,bottomBackground:theme.bottomBackground,lightStatusBar:contrastText(theme.primaryColor)==='#212121' }) }).catch(error => notify(String(error)));
  }, [prefs.dark,prefs.themeMode,prefs.themeDay,prefs.themeNight,prefs.barElevation,notify]);
  useEffect(()=>{const data=prefs.coverConfig?.fontData;if(!data)return;let alive=true;const face=new FontFace('LegadoCover',`url(${JSON.stringify(data)})`);face.load().then(font=>{if(alive)(document.fonts as FontFaceSet&{add:(font:FontFace)=>void}).add(font);}).catch(error=>notify(String(error)));return()=>{alive=false;document.fonts.delete(face);};},[prefs.coverConfig?.fontData,notify]);

  useEffect(() => {
    const back = (event: Event) => {
      const buttons = document.querySelectorAll<HTMLButtonElement>('.scrim [aria-label="关闭"]');
      const button = buttons[buttons.length - 1] || document.querySelector<HTMLButtonElement>('.reader [aria-label="返回书架"]');
      if (button) button.click();
      else if (menu) setMenu(false);
      else if (tab !== '书架') setTab('书架');
      else return;
      event.preventDefault();
    };
    window.addEventListener('legado-back', back);
    return () => window.removeEventListener('legado-back', back);
  }, [menu, tab]);
  const task = async (label: string, action: () => Promise<void>) => { setBusy(label); try { await action(); } catch (error) { notify(error instanceof Error ? error.message : String(error)); } finally { setBusy(''); } };
  const saveBook = useCallback(async (book: Book) => { await storage.put('books', book.id, book); setBooks(old => { const index = old.findIndex(b => b.id === book.id); return index < 0 ? [...old, book] : old.map(b => b.id === book.id ? book : b); }); }, []);
  const savePrefs = (next: Settings) => { setPrefs(next); storage.put('settings', 'reader', next).catch(error => notify(String(error))); };
  const localImport = () => task('正在导入书籍', async () => {
    const files = await pickFiles(['txt', 'epub'], true); let imported = 0; const errors: string[] = [];
    const rules=await storage.preference<TxtTocRule[]>('txtTocRules',defaultTxtRules);
    for (const file of files) { try { if(file.bytes.length>50*1024*1024)throw new Error("单本文件请小于 50 MB"); await saveBook(/\.txt$/i.test(file.name)?await importTxtWithRules(decodeText(file.bytes),file.name,rules):importBook(file.bytes, file.name)); imported++; } catch (e) { errors.push(`${file.name}: ${String(e)}`); } }
    if (files.length) notify(`已导入 ${imported} 本${errors.length ? `；${errors.join('；')}` : ''}`); setMenu(false);
  });
  const openBook = async (book: Book) => { await saveBook({ ...book, lastRead: Date.now() }); setReader(book.id); setDetail(null); setPreviewBook(null);setPanel(null); };
  const addResult = (result: SearchResult) => task('正在读取目录', async () => {
    const existing = books.find(b => b.url === result.url && b.sourceUrl === result.sourceUrl);
    if (existing) { setPreviewBook(null);setDetail(existing.id); return; }
    const source = sources.find(s => s.bookSourceUrl === result.sourceUrl); if (!source) throw new Error('找不到书源');
    const book = await loadOnlineBook(result, source);setPreviewBook(book);setDetail(null);
  });
  const updateBooks = () => task('正在更新目录', async () => {
    let updated = 0; const errors: string[] = [];
    for (const book of books.filter(b => b.kind === 'online' && b.canUpdate !== false && !(b.groups || []).some(id => bookGroups.some(g => g.id === id && !g.enableRefresh)))) {
      const source = sources.find(s => s.bookSourceUrl === book.sourceUrl); if (!source || !book.url) continue;
      try {
        const fresh = await loadOnlineBook({ name: book.name, author: book.author, url: book.url, variables: book.variables, sourceUrl: source.bookSourceUrl, sourceName: source.bookSourceName }, source);
        await saveBook(updatedBook(book,fresh)); updated++;
      } catch (error) { errors.push(`${book.name}：${String(error)}`); }
    }
    notify(`已更新 ${updated} 本${errors.length ? `；${errors.join('；')}` : ''}`);
  });
  const loadFeed = (url: string, add = false) => task('正在获取订阅', async () => {
    const response = await fetchText({ url }); const doc = new DOMParser().parseFromString(response.body, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('订阅不是有效的 RSS 或 Atom');
    const items = Array.from(doc.querySelectorAll('item,entry')).map(el => ({ title: el.querySelector('title')?.textContent || '无标题', content: htmlText(el.getElementsByTagNameNS('*', 'encoded')[0]?.textContent || el.querySelector('content,description,summary')?.textContent || ''), url: el.querySelector('link')?.getAttribute('href') || el.querySelector('link')?.textContent || '' }));
    setFeedArticles(items);
    if (add) { const feed = { id: url, url, name: doc.querySelector('channel > title,feed > title')?.textContent || new URL(url).hostname }; await storage.put('feeds', feed.id, feed); await refresh(); setFeedUrl(''); }
    if (!items.length) notify('订阅没有文章');
  });
  const selectedBook = books.find(b => b.id === detail) || previewBook;
  const readingBook = books.find(b => b.id === reader);
  const visible = sortBooks(books.filter(b => (group === '全部' || smartGroup(b) === group || (b.groups || []).includes(group)) && `${b.name}${b.author}`.toLowerCase().includes(filter.toLowerCase())),prefs.shelfSort);
  const shelfGroups=['全部',...(prefs.shelfSmartGroups?['未读','在读','已读']:[]),...bookGroups.filter(g=>g.show).sort((a,b)=>a.order-b.order).map(g=>g.id)];
  const reorderBooks=(from:string,to:string)=>task('保存排序',async()=>{const list=[...visible],index=list.findIndex(book=>book.id===from),target=list.findIndex(book=>book.id===to);if(index<0||target<0)return;const [moved]=list.splice(index,1);list.splice(target,0,moved);for(let i=0;i<list.length;i++)await saveBook({...list[i],order:i});});

  const closePanel = useCallback(() => {setPanel(null);setEditSource(null);}, []);
  return <CoverSettingsContext.Provider value={{...defaultCover,...prefs.coverConfig,night:prefs.dark}}><div className="app" style={{ '--shelf-columns': prefs.shelfColumns } as CSSProperties}>
    <Welcome ready={ready} prefs={prefs} error={ready ? '' : toast} />
    <header className="toolbar">{tab === '书架' && prefs.shelfGroupStyle==='tabs' ? <div className="shelf-tabs" role="tablist" aria-label="书架分组">{shelfGroups.map(name => <button key={name} role="tab" aria-selected={group === name} className={group === name ? 'selected' : ''} onClick={() => setGroup(name)}>{bookGroups.find(g => g.id === name)?.name || name}</button>)}</div> : tab==='发现'?<label className="source-toolbar-search explore-toolbar-search"><input aria-label="搜索发现" placeholder="搜索" value={exploreQuery} onChange={e=>setExploreQuery(e.target.value)}/></label>:<h1>{tab==='书架'&&group!=='全部'?<button onClick={()=>setGroup('全部')}>{bookGroups.find(item=>item.id===group)?.name||group}</button>:tab}</h1>}<div className="toolbar-actions">{tab === '书架' && <IconButton label="搜索书籍" onClick={() => { setSearchTarget(null); setExploreUrl(undefined); setPanel('search'); }}><LegadoIcon name="ic_search" /></IconButton>}<IconButton label={tab==='发现'?'发现分组':'更多选项'} onClick={() => tab==='发现'?setExploreGroupsOpen(!exploreGroupsOpen):setMenu(!menu)}><LegadoIcon name={tab==='发现'?'ic_groups':'ic_more_vert'} /></IconButton>{tab==='发现'&&<IconButton label="书源管理" onClick={()=>{setEditSource(null);setPanel('sources');}}><LegadoIcon name="ic_settings"/></IconButton>}</div>{tab==='发现'&&exploreGroupsOpen&&<><button className="source-panel-dismiss" aria-label="关闭发现分组" onClick={()=>setExploreGroupsOpen(false)}/><div className="source-popup">{['',...new Set(sources.flatMap(sourceGroups))].map(name=><button key={name} onClick={()=>{setExploreGroup(name);setExploreGroupsOpen(false);}}>{name||'全部'}</button>)}</div></>}
      {menu && <><button className="menu-dismiss" aria-label="关闭菜单" onClick={() => setMenu(false)} /><div className="overflow-menu">{tab === '书架' ? <><button onClick={() => { setMenu(false); updateBooks(); }}>更新目录</button><button onClick={localImport}>添加本地</button><button onClick={() => { setPanel('library'); setMenu(false); }}>书架管理</button><button onClick={() => { setPanel('groups'); setMenu(false); }}>分组管理</button><button onClick={() => { setPanel('layout'); setMenu(false); }}>书架布局</button><button onClick={() => { setPanel('backup'); setMenu(false); }}>导出书架 / 导入书架</button></> : tab === '订阅' ? <button onClick={() => { setRssAdd(true); setMenu(false); }}>添加订阅</button> : <><button onClick={() => { setPanel('sources'); setMenu(false); }}>书源管理</button><button onClick={() => { setPanel('theme'); setMenu(false); }}>主题设置</button></>}</div></>}
    </header>
    <main className="main-content">
      {tab === '书架' && <>
        {books.length > 0 && prefs.showShelfStatus && <div className="shelf-tools"><span>{visible.length} 本书</span><input aria-label="筛选书架" placeholder="筛选书架" value={filter} onChange={e => setFilter(e.target.value)} /></div>}
        {prefs.shelfGroupStyle==='folder'&&group==='全部'&&<div className="shelf-folders">{shelfGroups.filter(name=>name!=='全部').map(name=><button key={name} onClick={()=>setGroup(name)}><LegadoIcon name="ic_folder_outline" size={40}/><span>{bookGroups.find(item=>item.id===name)?.name||name}</span></button>)}</div>}
        {visible.length ? <Bookshelf books={visible} prefs={prefs} open={openBook} detail={book=>setDetail(book.id)} reorder={reorderBooks}/> : <div className="legado-empty">书架还空着，先去搜索书籍或从发现里添加吧!</div>}
      </>}
      {tab === '发现' && <ExplorePage sources={sources} query={exploreQuery} group={exploreGroup} browse={(source,url)=>{setSearchTarget(source);setExploreUrl(url);setPanel('search');}} login={setSourceSettings} search={source=>{setSearchTarget(source);setExploreUrl(undefined);setPanel('search');}} edit={source=>{setEditSource(source);setPanel('sources');}} save={async source=>{await storage.saveSources([source]);await refresh();}} notify={notify}/>}
      {tab === '订阅' && <div className="rss-page">{rssAdd && <form className="input-row" onSubmit={e => { e.preventDefault(); loadFeed(feedUrl, true); }}><input required type="url" aria-label="订阅地址" placeholder="输入 RSS / Atom 地址" value={feedUrl} onChange={e => setFeedUrl(e.target.value)} /><button className="primary" disabled={!!busy}>添加</button><button type="button" onClick={() => setRssAdd(false)}>取消</button></form>}{feeds.map(feed => <div className="source-row" key={feed.id}><button onClick={() => loadFeed(feed.url)}><Rss /><span><strong>{feed.name}</strong><small>{feed.url}</small></span></button><IconButton label={`删除订阅 ${feed.name}`} onClick={() => task('正在删除', async () => { await storage.remove('feeds', feed.id); await refresh(); })}><Trash2 /></IconButton></div>)}{!feeds.length && <div className="legado-empty">没有订阅源</div>}{feedArticles.map((article, index) => <button className="article-row" key={index} onClick={() => setActiveArticle(article)}><h3>{article.title}</h3><p>{article.content.slice(0, 140)}</p></button>)}</div>}
      {tab === '我的' && <div className="my-page preference-list">
        <button className="setting-row" onClick={() => setPanel('sources')}><LegadoIcon name="ic_cfg_source" /><span>书源管理<small>新建、编辑、导入、导出书源</small></span></button>
        <button className="setting-row" onClick={() => setPanel('txtRules')}><LegadoIcon name="ic_cfg_source" /><span>TXT目录规则<small>配置TXT目录规则</small></span></button>
        <button className="setting-row" onClick={() => setPanel('replace')}><LegadoIcon name="ic_cfg_replace" /><span>净化替换<small>替换正文和标题内容</small></span></button>
        <button className="setting-row" onClick={() => setPanel('dictRules')}><LegadoIcon name="ic_translate"/><span>词典规则<small>配置词典规则</small></span></button>
        <label className="setting-row"><LegadoIcon name="ic_cfg_theme"/><span>主题模式</span><select aria-label="主题模式" value={prefs.themeMode||(prefs.dark?'night':'day')} onChange={e=>{const mode=e.target.value as Settings['themeMode'];savePrefs({...prefs,themeMode:mode,dark:mode==='night'||(mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)});}}><option value="system">跟随系统</option><option value="day">白天</option><option value="night">夜间</option><option value="eink">墨水屏</option></select></label>
        <h3 className="preference-category">设置</h3>
        <button className="setting-row" onClick={() => setPanel('backup')}><LegadoIcon name="ic_cfg_backup" /><span>备份与恢复<small>备份和恢复本地书库</small></span></button>
        <button className="setting-row" onClick={() => setPanel('theme')}><LegadoIcon name="ic_cfg_theme" /><span>主题设置<small>主题颜色、启动界面样式</small></span></button>
        <button className="setting-row" onClick={() => setPanel('settings')}><LegadoIcon name="ic_cfg_other" /><span>阅读设置<small>字体、排版与翻页</small></span></button>
        <h3 className="preference-category">其他</h3>
        <button className="setting-row" onClick={() => setPanel('bookmarks')}><LegadoIcon name="ic_bookmark" /><span>书签<small>所有书签</small></span></button>
        <button className="setting-row" onClick={() => setPanel('stats')}><LegadoIcon name="ic_history" /><span>阅读记录<small>记录阅读时长</small></span></button>
        <button className="setting-row" onClick={localImport}><LegadoIcon name="ic_folder_outline" /><span>文件管理<small>选择本地书籍</small></span></button>
        <button className="setting-row" onClick={() => setPanel('about')}><LegadoIcon name="ic_cfg_about" /><span>关于</span></button>
      </div>}
    </main>
    <nav className="bottom-nav" aria-label="主导航">{(['书架', '发现', '订阅', '我的'] as Tab[]).map(name => <button aria-label={name} aria-current={tab === name ? 'page' : undefined} title={name} key={name} className={tab === name ? 'selected' : ''} onClick={() => { setTab(name); setMenu(false); }}><LegadoIcon name={`ic_bottom_${icons[name]}_${tab === name ? 's' : 'e'}`} /></button>)}</nav>
    {panel === 'groups' && <Modal title="分组管理" close={closePanel}><GroupManager groups={bookGroups} save={async (next, removed) => { await storage.put('settings','bookGroups',next); setBookGroups(next); if (removed) { for (const book of books.filter(b => b.groups?.includes(removed))) await saveBook({ ...book, groups:book.groups!.filter(id => id !== removed) }); if (group === removed) setGroup('全部'); } }} /></Modal>}
    {panel === 'library' && <Modal title="书架管理" close={closePanel}><LibraryManager books={books} groups={bookGroups} save={saveBook} remove={async ids => { for (const id of ids) await storage.remove('books',id); await refresh(); }} /></Modal>}
    {panel === 'replace' && <Modal title="净化替换" close={closePanel}><ReplaceManager notify={notify} /></Modal>}
    {panel === 'txtRules' && <Modal title="TXT目录规则" close={closePanel} toolbarId="txt-rule-toolbar"><TxtTocManager notify={notify}/></Modal>}
    {panel === 'dictRules' && <DictionaryManager close={closePanel} notify={notify}/>}
    {panel === 'theme' && <Modal title="主题设置" close={closePanel}><ThemeSettings prefs={prefs} save={savePrefs} welcome={()=>setPanel('welcome')} notify={notify}/></Modal>}
    {panel === 'welcome' && <Modal title="启动界面样式" close={() => setPanel('theme')}><WelcomeSettings prefs={prefs} save={savePrefs} notify={notify} /></Modal>}
    {panel === 'layout' && <BookshelfSettings prefs={prefs} save={savePrefs} close={closePanel}/>}
    {panel === 'backup' && <Modal title="备份与恢复" close={closePanel}><div className="preference-list"><button className="setting-row" onClick={() => task('正在导出备份', async () => { if (await saveFile(`legado-backup-${new Date().toISOString().slice(0, 10)}.json`, await storage.backup())) notify('备份已导出'); })}><span>备份<small>书籍、进度、书源与阅读设置</small></span></button><button className="setting-row" onClick={() => task('正在恢复备份', async () => { const files = await pickFiles(['json']); if (files[0]) { await storage.restore(decodeText(files[0].bytes)); await refresh(); notify('已恢复备份'); } })}><span>恢复备份<small>按标识合并，保留其他书籍</small></span></button></div></Modal>}
    {panel === 'bookmarks' && <Modal title="书签" close={closePanel}>{books.flatMap(book => book.bookmarks.map((mark, i) => <div className="bookmark-row" key={`${book.id}-${mark.created}`}><button onClick={async () => { await saveBook({ ...book, chapter: mark.chapter, offset: mark.offset }); setReader(book.id); setPanel(null); }}><span>{book.name}<small>{mark.title}</small></span></button><IconButton label="删除书签" onClick={() => saveBook({ ...book, bookmarks: book.bookmarks.filter((_, j) => j !== i) })}><Trash2 size={18} /></IconButton></div>))}{!books.some(b => b.bookmarks.length) && <div className="legado-empty">没有书签</div>}</Modal>}
    {panel === 'sources' && <Modal title="书源管理" close={closePanel} wide toolbarId="source-toolbar"><SourceManager initialEditor={editSource} sources={sources} books={books} refresh={refresh} notify={notify} login={setSourceSettings} search={source => { setSearchTarget(source); setExploreUrl(undefined); setPanel('search'); }} /></Modal>}
    {panel === 'search' && <Modal title="搜索" close={closePanel} wide toolbarId="search-toolbar"><BookSearch sources={sources} books={books} target={searchTarget} exploreUrl={exploreUrl} manage={()=>setPanel('sources')} choose={addResult} open={book=>{setPanel(null);openBook(book);}} notify={notify}/></Modal>}
    {panel === 'settings' && <Modal title="阅读设置" close={closePanel}><ReaderSettings prefs={prefs} save={savePrefs} /></Modal>}
    {panel === 'stats' && <Modal title="阅读记录" close={closePanel} wide><div className="record-summary"><strong>{Math.floor(records.reduce((n, r) => n + r.seconds, 0) / 60)}</strong> 分钟 · {new Set(records.map(r => r.bookId)).size} 本书</div>{records.length ? [...records].sort((a, b) => b.started - a.started).map(record => <div className="record" key={record.id}><Clock3 size={17} /><div><small>{new Date(record.started).toLocaleString('zh-CN')}</small><h3>{record.bookName}</h3><p>{record.chapter} · {record.seconds < 60 ? `${record.seconds} 秒` : `${Math.floor(record.seconds / 60)} 分钟`}</p></div></div>) : <Empty icon={<Clock3 />} title="还没有阅读记录" text="打开一本书，开始记录阅读时光。" />}</Modal>}
    {panel === 'about' && <Modal title="关于阅读" close={closePanel}><div className="about"><img className="about-icon" src="/legado/app-icon.svg" alt="阅读" /><h2>阅读</h2><p>{VERSION}</p><p>基于 Tauri 的独立阅读应用，界面与资源移植自 Legado。</p><p>书库保存在本机，建议定期导出备份。</p><a href="https://github.com/suixincrazy/legado-tauri" target="_blank" rel="noreferrer">项目源码</a><p className="subtle">GPL-3.0-or-later · 致谢 LegadoTeam/legado 与 HapeLee/legado-with-MD3</p></div></Modal>}
    {selectedBook && <BookDetails key={selectedBook.id} book={selectedBook} sources={sources} groups={bookGroups} inShelf={books.some(book=>book.id===selectedBook.id)} notify={notify} login={setSourceSettings} close={() => {setDetail(null);setPreviewBook(null);}} save={async book=>{if(books.some(item=>item.id===book.id))await saveBook(book);else setPreviewBook(book);}} add={()=>task("正在加入书架",async()=>{await saveBook(selectedBook);setDetail(selectedBook.id);setPreviewBook(null);})} open={() => openBook(selectedBook)} remove={() => task('删除书籍', async () => { await storage.remove('books', selectedBook.id); setDetail(null);setPreviewBook(null); await refresh(); })} cache={() => task('正在缓存章节', async () => { const source = sources.find(s => s.bookSourceUrl === selectedBook.sourceUrl); if (!source) throw new Error('书源不存在'); const book = { ...selectedBook, chapters: selectedBook.chapters.map(c => ({ ...c })) }; await saveBook(book);setDetail(book.id);setPreviewBook(null);let count = 0; for (const chapter of book.chapters) { if (chapter.content === undefined) { chapter.content = await loadChapter(chapter, source, book); count++; await saveBook({ ...book, chapters: [...book.chapters] }); setBusy(`已缓存 ${count} 章`); } } notify('全部章节已缓存'); })} />}
    {sourceSettings && <Modal title={`书源设置 · ${sourceSettings.bookSourceName}`} close={() => setSourceSettings(null)}><SourceSettings source={sourceSettings} done={() => setSourceSettings(null)} notify={notify} /></Modal>}
    {activeArticle && <Modal title={activeArticle.title} close={() => setActiveArticle(null)} wide><article className="rss-content">{activeArticle.content.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}</article>{/^https?:/.test(activeArticle.url) && <a href={activeArticle.url} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={15} /></a>}</Modal>}
    {readingBook && <Reader book={readingBook} sources={sources} source={sources.find(s => s.bookSourceUrl === readingBook.sourceUrl)} prefs={prefs} savePrefs={savePrefs} save={saveBook} close={() => { setReader(null); refresh(); }} notify={notify} />}
    {busy && <div className="busy" role="status"><span className="spinner" />{busy}</div>}{toast && <div className="toast" role="alert" onClick={() => setToast('')}>{toast}</div>}
  </div></CoverSettingsContext.Provider>;
}

function Reader({ book, source, sources, prefs, savePrefs, save, close, notify }: { book: Book; source?: Source; sources:Source[]; prefs: Settings; savePrefs: (prefs: Settings) => void; save: (book: Book) => Promise<void>; close: () => void; notify: (text: string) => void }) {
  const [controls, setControls] = useState(true); const [drawer, setDrawer] = useState<'toc' | 'bookmarks' | 'settings' | 'style' | 'search' | 'highlights' | null>(null);
  const [replaceOpen,setReplaceOpen]=useState(false),[readerDialog,setReaderDialog]=useState<'change'|'cache'|'txtRules'|null>(null),[cacheFrom,setCacheFrom]=useState(''),[cacheTo,setCacheTo]=useState('');
  const cacheCancelled=useRef(false);
  const [autoPage, setAutoPage] = useState(false), [contentQuery, setContentQuery] = useState(''), [tocQuery, setTocQuery] = useState(''), [reverseToc,setReverseToc] = useState(false);
  const [collapsed,setCollapsed] = useState(new Set<number>());
  const [content, setContent] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [displayTitle, setDisplayTitle] = useState('');
  const [dictWord,setDictWord]=useState('');
  const [contentEditor,setContentEditor]=useState(false),[effectiveRules,setEffectiveRules]=useState<ReplaceRule[]>([]),[sameTitleRemoved,setSameTitleRemoved]=useState(false),[readerExtra,setReaderExtra]=useState<'pageAnim'|'effective'|null>(null),[readerBusy,setReaderBusy]=useState('');
  const [highlightRules,setHighlightRules]=useState<HighlightRule[]>([]),[ruleRanges,setRuleRanges]=useState<HighlightRange[]>([]),[highlightManager,setHighlightManager]=useState(false),[initialHighlightRule,setInitialHighlightRule]=useState<HighlightRule|undefined>(),[activeHighlight,setActiveHighlight]=useState<number|null>(null),[readMenu,setReadMenu]=useState(false);
  const renderedTitle=displayTitle||book.chapters[book.chapter]?.title||'',titleLength=renderedTitle.length+1,paragraphs=readingParagraphs(content,titleLength),renderedText=renderedTitle+'\n'+paragraphs.map(item=>item.text).join('\n');
  useEffect(()=>{storage.preference<HighlightRule[]>('highlightRules',[]).then(setHighlightRules).catch(error=>notify(String(error)));},[highlightManager,notify]);
  useEffect(()=>{let alive=true;applyHighlightRules(renderedText,scopedHighlightRules(highlightRules,book),titleLength).then(ranges=>{if(alive)setRuleRanges(ranges);}).catch(error=>{if(alive){setRuleRanges([]);notify(String(error));}});return()=>{alive=false;};},[renderedText,highlightRules,book.name,book.sourceUrl,titleLength,notify]);
  useEffect(()=>{if(!readMenu)return;const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();setReadMenu(false);};window.addEventListener('legado-back',back,true);return()=>window.removeEventListener('legado-back',back,true);},[readMenu]);
  const aloud=useReadAloud(notify);const [aloudOpen,setAloudOpen]=useState(false);
  const [pageInfo, setPageInfo] = useState({ current: 1, total: 1 });
  const viewport = useRef<HTMLDivElement>(null); const bookRef = useRef(book); bookRef.current = book;
  const offset = useRef(book.offset); const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const restorePending = useRef(true); const record = useRef<ReadingRecord | null>(null); const lastTick = useRef(0);
  const pendingPosition=useRef<{chapter:number;position:number}|null>(null);
  const [retry, setRetry] = useState(0); const chapter = book.chapters[book.chapter];
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const persist = useCallback(() => save({ ...bookRef.current, offset: offset.current, lastRead: Date.now() }), [save]);
  useEffect(()=>{
    const apply=()=>readerScreen(document.hidden?undefined:prefsRef.current).catch(error=>notify(String(error)));
    void apply();document.addEventListener('visibilitychange',apply);
    return()=>{document.removeEventListener('visibilitychange',apply);void readerScreen().catch(error=>notify(String(error)));};
  },[prefs.keepScreenOn,prefs.brightness,prefs.screenOrientation,prefs.showBrightnessView,notify]);
  useEffect(()=>{
    if(!prefs.fontData)return;
    let alive=true;const face=new FontFace('LegadoReadFont',`url(${JSON.stringify(prefs.fontData)})`);
    face.load().then(font=>{if(alive){document.fonts.add(font);setRetry(value=>value+1);}}).catch(error=>notify(`字体加载失败：${error}`));
    return()=>{alive=false;document.fonts.delete(face);};
  },[prefs.fontData,notify]);
  useEffect(() => {
    let alive = true; const selected = bookRef.current; const selectedChapter = selected.chapters[selected.chapter];
    setError(''); setContent(''); setLoading(true); restorePending.current = true; offset.current = selected.offset;
    const load = async () => {
      if (!selectedChapter) throw new Error('此书没有章节');
      if (selectedChapter.content !== undefined) return selectedChapter.content;
      if (!source) throw new Error('该章节尚未缓存，请恢复对应书源');
      const text = await loadChapter(selectedChapter, source, selected);
      if (alive) { const current = bookRef.current; await save({ ...current, chapters: current.chapters.map((c, i) => i === selected.chapter ? { ...c, content: text } : c) }); }
      return text;
    };
    load().then(async text => {
      const result=await processReaderContent(text,selected,selectedChapter,await storage.preference<ReplaceRule[]>('replaceRules', []),prefs.chineseConversion);
      if (alive) { setContent(result.content);setDisplayTitle(result.title);setSameTitleRemoved(result.sameTitleRemoved);setEffectiveRules(result.effectiveRules); }
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [book.id, book.chapter, retry, source, save, prefs.chineseConversion,book.useReplaceRule]);
  useEffect(() => {
    if (!content) return;
    const node = viewport.current; if (!node) return;
    const restore = () => {
      if(pendingPosition.current?.chapter===book.chapter&&revealTextPosition(node,pendingPosition.current.position,prefs.pageMode==='pages')){
        pendingPosition.current=null;
        if(prefs.pageMode==='pages'){const info=pagination(node,node.querySelector('.chapter-body')!);setPageInfo(info);offset.current=(info.current-1)/Math.max(1,info.total-1);}
        else offset.current=node.scrollTop/Math.max(1,node.scrollHeight-node.clientHeight);
      }
      else if (prefs.pageMode === 'pages') { const { total, stride } = pagination(node, node.querySelector('.chapter-body')!); node.scrollLeft = Math.round(offset.current * (total - 1)) * stride; setPageInfo(pagination(node, node.querySelector('.chapter-body')!)); }
      else node.scrollTop = offset.current * Math.max(0, node.scrollHeight - node.clientHeight);
      restorePending.current = false;
    };
    restorePending.current = true; const frame = requestAnimationFrame(restore); const observer = new ResizeObserver(() => { restorePending.current = true; requestAnimationFrame(restore); }); observer.observe(node);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [content, displayTitle, prefs.fontSize, prefs.lineHeight, prefs.paragraphSpace, prefs.font, prefs.pageMode, prefs.twoPage,prefs.letterSpacing,prefs.titleSize,prefs.titleAlign,prefs.readerPaddingTop,prefs.readerPaddingBottom,prefs.readerPaddingLeft,prefs.readerPaddingRight,prefs.fontData]);
  useEffect(() => {
    record.current = { id: createId(), bookId: book.id, bookName: book.name, chapter: chapter?.title || '', started: Date.now(), seconds: 0 }; lastTick.current = Date.now();
    const flush = () => { const current = record.current; if (current && current.seconds > 0) storage.put('records', current.id, { ...current }).catch(e => notify(String(e))); };
    const tick = setInterval(() => { const now = Date.now(); const elapsed = Math.min(5, Math.floor((now - lastTick.current) / 1000)); lastTick.current = now; if (!document.hidden && record.current) record.current.seconds += elapsed; flush(); persist().catch(e => notify(String(e))); }, 5000);
    const visibility = () => { lastTick.current = Date.now(); flush(); persist().catch(e => notify(String(e))); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', visibility);
    return () => { clearInterval(tick); flush(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', visibility); };
  }, [book.id, book.chapter, book.name, chapter?.title, persist, notify]);
  const navigate = useCallback(async (index: number, position = 0) => {
    const current = bookRef.current;
    if (index < 0 || index >= current.chapters.length) { notify(index < 0 ? '已经是第一章' : '已经是最后一章'); return; }
    offset.current = position;
    await save({ ...current, chapter: index, offset: position, lastRead: Date.now() }); if (index === current.chapter) setRetry(value => value + 1); setDrawer(null);
  }, [save, notify]);
  const jumpHighlight=async(mark:BookHighlight)=>{
    const index=mark.chapterUrl?book.chapters.findIndex(chapter=>chapter.url===mark.chapterUrl):mark.chapterIndex;
    const target=index>=0?index:mark.chapterIndex;
    pendingPosition.current={chapter:target,position:target===book.chapter?anchoredHighlight(renderedText,mark,titleLength)?.start??mark.chapterPos:mark.chapterPos};
    await navigate(target);
  };
  const turn = useCallback((direction: number) => {
    const node = viewport.current; if (!node) return;
    if (!node.querySelector('.chapter-body')) return;
    if (prefsRef.current.pageMode === 'pages') {
      const { stride, current, total } = pagination(node, node.querySelector('.chapter-body')!);
      const next = (current - 1 + direction) * stride;
      if (current + direction > total) { navigate(bookRef.current.chapter + 1); return; }
      if (next < -2) { navigate(bookRef.current.chapter - 1, 1); return; }
      const animation=prefsRef.current.pageAnimation;
      if(animation==='cover'||animation==='simulation'){const snapshot=node.cloneNode(true) as HTMLElement; snapshot.removeAttribute('id');snapshot.setAttribute('aria-hidden','true');snapshot.className+=' page-turn-snapshot';snapshot.style.cssText=`position:absolute;inset:0;pointer-events:none;margin:0;z-index:1;background:${getComputedStyle(node.closest('.reader')!).backgroundColor}`;snapshot.scrollLeft=node.scrollLeft;node.style.position='relative';node.parentElement?.appendChild(snapshot);snapshot.style.top=`${node.offsetTop}px`;snapshot.style.height=`${node.clientHeight}px`;snapshot.style.left=`${node.offsetLeft}px`;snapshot.style.width=`${node.clientWidth}px`;snapshot.scrollLeft=node.scrollLeft;node.scrollTo({left:next,behavior:'auto'});const effect=snapshot.animate(animation==='cover'?[{transform:'translateX(0)'},{transform:`translateX(${-direction*100}%)`}]:[{transform:'perspective(1600px) rotateY(0)',transformOrigin:direction>0?'left':'right',filter:'brightness(1)'},{transform:`perspective(1600px) rotateY(${direction>0?-90:90}deg)`,transformOrigin:direction>0?'left':'right',filter:'brightness(.65)'}],{duration:300,easing:'ease-out'});effect.onfinish=()=>snapshot.remove();}else node.scrollTo({left:next,behavior:animation==='slide'?'smooth':'auto'});
    } else {
      if (direction > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 3) { navigate(bookRef.current.chapter + 1); return; }
      if (direction < 0 && node.scrollTop <= 1) { navigate(bookRef.current.chapter - 1, 1); return; }
      node.scrollBy({ top: direction * node.clientHeight * 0.85, behavior: 'smooth' });
    }
  }, [navigate]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (drawer || document.querySelector('.reader [role=dialog]') || (event.target instanceof Element && event.target.matches('input,textarea,select'))) return; if (['ArrowRight', 'PageDown', 'ArrowDown', ' '].includes(event.key)) { event.preventDefault(); turn(1); } if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(event.key)) { event.preventDefault(); turn(-1); } if (event.key === 'Escape') { persist(); close(); } };
    document.addEventListener('keydown', key); let last = 0;
    const gamepad = setInterval(() => { if (document.hidden || drawer || document.querySelector('.reader [role=dialog]') || !navigator.getGamepads) return; const pad = Array.from(navigator.getGamepads()).find(Boolean); if (!pad || Date.now() - last < 350) return; if (pad.buttons[13]?.pressed || pad.buttons[15]?.pressed || pad.axes[1] > 0.6) { turn(1); last = Date.now(); } else if (pad.buttons[12]?.pressed || pad.buttons[14]?.pressed || pad.axes[1] < -0.6) { turn(-1); last = Date.now(); } }, 80);
    return () => { document.removeEventListener('keydown', key); clearInterval(gamepad); };
  }, [turn, drawer, persist, close]);
  useEffect(() => {
    if (!autoPage || drawer || replaceOpen || readerDialog || loading || dictWord || highlightManager || activeHighlight!==null || contentEditor || readerExtra || aloudOpen) return;
    const timer=setInterval(()=>{if (!document.hidden) turn(1);},Math.max(2,prefs.autoPageSeconds)*1000);
    return ()=>clearInterval(timer);
  },[autoPage,drawer,replaceOpen,readerDialog,loading,prefs.autoPageSeconds,turn,dictWord,highlightManager,activeHighlight,contentEditor,readerExtra,aloudOpen]);
  const onScroll = () => { if (restorePending.current) return; const node = viewport.current; if (!node) return; if (prefs.pageMode === 'pages') { const info = pagination(node, node.querySelector('.chapter-body')!); offset.current = (info.current - 1) / Math.max(1, info.total - 1); setPageInfo(info); } else offset.current = node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight); offset.current = Math.max(0, Math.min(1, offset.current)); };
  const startSpeech = async(start?:number,end?:number) => {
    setAloudOpen(true);setControls(false);
    if(start===undefined){start=viewport.current?visibleTextPosition(viewport.current):0;if(aloud.settings.readAloudStart==='sentence')start=sentenceStart(renderedText,start);}
    return aloud.start(book.id,book.name,end===undefined?cachedSpeechQueue(book,renderedText,start):speechChunks(renderedText,book.chapter,chapter.title,start,end));
  };
  const addBookmark = async () => { await save({ ...bookRef.current, bookmarks: [...bookRef.current.bookmarks, { chapter: book.chapter, offset: offset.current, title: chapter.title, created: Date.now() }] }); notify('书签已添加'); };
  const saveChapter=async(next:typeof chapter)=>{const current=bookRef.current;await save({...current,chapters:current.chapters.map((item,index)=>index===book.chapter?next:item)});setRetry(value=>value+1);};
  const readerAction=async(label:string,action:()=>Promise<void>)=>{setReadMenu(false);setReaderBusy(label);try{await action();}catch(error){notify(String(error));}finally{setReaderBusy('');}};
  const resetContent=async()=>{if(book.kind==='online'){if(!source)throw new Error('对应书源不存在');return loadChapter({...chapter,content:undefined},source,book);}return chapter.originalContent??chapter.content??'';};
  const refreshContent=()=>readerAction('正在刷新正文',async()=>{const text=await resetContent();await saveChapter({...chapter,content:text,originalContent:undefined,reversedOriginal:undefined});});
  const resetEditor=async()=>{const text=await resetContent(),next={...chapter,content:text,originalContent:undefined,reversedOriginal:undefined};await saveChapter(next);return (await processReaderContent(text,bookRef.current,next,await storage.preference<ReplaceRule[]>('replaceRules',[]),prefs.chineseConversion)).content;};
  const toggleSameTitle=()=>readerAction('正在更新正文',async()=>{if(!sameTitleRemoved&&!chapter.keepSameTitle){notify('未找到可移除的重复标题');return;}await saveChapter({...chapter,keepSameTitle:!chapter.keepSameTitle});});
  const updateCatalog=()=>readerAction('正在更新目录',async()=>{if(!source||!book.url)throw new Error('对应书源不存在');const fresh=await loadOnlineBook({name:book.name,author:book.author,url:book.url,variables:book.variables,sourceUrl:source.bookSourceUrl,sourceName:source.bookSourceName},source);await save(updatedBook(bookRef.current,fresh));setRetry(value=>value+1);});
  const changeSource=(result:SearchResult)=>readerAction('正在换源',async()=>{const nextSource=sources.find(item=>item.bookSourceUrl===result.sourceUrl);if(!nextSource)throw new Error('对应书源不存在');const fresh=await loadOnlineBook(result,nextSource);await save(updatedBook(bookRef.current,fresh));setReaderDialog(null);setRetry(value=>value+1);});
  const cacheChapters=()=>readerAction('正在缓存',async()=>{if(!source)throw new Error('对应书源不存在');const from=Number(cacheFrom||1),to=Number(cacheTo||book.chapters.length);if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>book.chapters.length)throw new Error('请输入有效的起止章节');setReaderDialog(null);cacheCancelled.current=false;let count=0;for(let index=from-1;index<to&&!cacheCancelled.current;index++){const current=bookRef.current,item=current.chapters[index];if(item.isVolume||item.content!==undefined)continue;const text=await loadChapter(item,source,current);const latest=bookRef.current;if(latest.sourceUrl!==source.bookSourceUrl||latest.chapters[index]?.url!==item.url)break;await save({...latest,chapters:latest.chapters.map((chapter,i)=>i===index?{...chapter,content:text}:chapter)});setReaderBusy(`已缓存 ${++count} 章`);}notify(cacheCancelled.current?'已停止缓存':'缓存完成');});
  useEffect(()=>()=>{cacheCancelled.current=true;},[]);
  const exit = async () => { await persist(); close(); };
  const style = { '--read-font-size': `${prefs.fontSize}px`, '--read-line-height': prefs.lineHeight, '--paragraph-gap': `${prefs.paragraphSpace}em`, '--read-weight': prefs.readBold ? 700 : 400, '--read-indent':`${prefs.textIndent}em`, '--read-letter-spacing':`${prefs.letterSpacing}em`, '--read-pad-top':`${prefs.readerPaddingTop}px`, '--read-pad-bottom':`${prefs.readerPaddingBottom}px`, '--read-pad-left':`${prefs.readerPaddingLeft}px`, '--read-pad-right':`${prefs.readerPaddingRight}px`, '--read-title-align':prefs.titleAlign, '--read-title-size':`${prefs.titleSize}px`, '--read-font':prefs.fontData?'LegadoReadFont':prefs.font==='serif'?'serif':'sans-serif', backgroundImage:prefs.readerBackground?`url(${JSON.stringify(prefs.readerBackground)})`:undefined,color:prefs.readerTextColor||undefined } as CSSProperties;
  let volume = -1;
  const tocEntries = book.chapters.map((chapter,index)=>{if(chapter.isVolume)volume=index;return {chapter,index,volume};}).filter(entry => entry.chapter.title.includes(tocQuery) && (entry.chapter.isVolume || !collapsed.has(entry.volume)));
  if (reverseToc) tocEntries.reverse();
  const matches = contentQuery.trim() ? book.chapters.flatMap((c,index) => { const text = index === book.chapter ? content : c.content || ''; const position=text.indexOf(contentQuery); return position < 0 ? [] : [{ index,title:c.title,excerpt:text.slice(Math.max(0,position-30),position+contentQuery.length+90) }]; }) : [];
  const currentHighlights=(book.highlights||[]).filter(mark=>mark.chapterUrl&&chapter?.url?mark.chapterUrl===chapter.url:mark.chapterIndex===book.chapter);
  const ranges=[...ruleRanges,...currentHighlights.map(mark=>anchoredHighlight(renderedText,mark,titleLength)).filter((range):range is HighlightRange=>!!range)];
  const highlighted=(text:string,start:number)=>highlightSegments(text,start,ranges).map(segment=><span key={segment.start} style={highlightCss(segment.style)} data-highlight={segment.matches.length?true:undefined} onClick={event=>{if(!segment.matches.length||getSelection()?.toString())return;event.stopPropagation();const manual=[...segment.matches].reverse().find(range=>range.time!==undefined);if(manual)setActiveHighlight(manual.time!);else{const rule=highlightRules.find(rule=>rule.uuid===segment.matches[0].ruleUuid);if(rule){setInitialHighlightRule(rule);setHighlightManager(true);}}}}>{segment.text}</span>);
  const saveHighlight=async(mark:BookHighlight)=>{const current=bookRef.current;await save({...current,highlights:[...(current.highlights||[]).filter(item=>item.time!==mark.time),mark]});await storage.put('settings','highlightLastStyle',highlightStyle(mark.style));};
  const addHighlight=async(start:number,end:number)=>{try{const style=await storage.preference<HighlightStyle>('highlightLastStyle',highlightPresets[0]),mark:BookHighlight={time:Date.now(),bookUrl:book.url||book.id,chapterUrl:chapter?.url||'',bookName:book.name,bookAuthor:book.author,chapterIndex:book.chapter,chapterPos:start,chapterPosEnd:end,layoutTitleLength:titleLength,chapterName:chapter?.title||'',bookText:renderedText.slice(start,end),style:JSON.stringify(style),note:''};await saveHighlight(mark);setActiveHighlight(mark.time);}catch(error){notify(String(error));}};
  const editingHighlight=(book.highlights||[]).find(mark=>mark.time===activeHighlight);
  return <section className={`reader ${prefs.readerTheme} ${prefs.font} ${prefs.pageMode} ${prefs.twoPage ? 'two-page' : ''}`} style={style} aria-label={`正在阅读 ${book.name}`}>
    <header className={`reader-toolbar ${controls ? '' : 'hidden-controls'}`}><IconButton label="返回书架" onClick={exit}><ArrowLeft /></IconButton><span>{book.name}</span>{book.kind==='online'?<><IconButton label="换源" onClick={()=>setReaderDialog('change')}><LegadoIcon name="ic_exchange"/></IconButton><IconButton label="刷新正文" onClick={()=>void refreshContent()} disabled={!!readerBusy}><LegadoIcon name="ic_refresh_black_24dp"/></IconButton><IconButton label="离线缓存" onClick={()=>{setCacheFrom(String(book.chapter+1));setCacheTo(String(book.chapters.length));setReaderDialog('cache');}}><LegadoIcon name="ic_download_line"/></IconButton></>:book.kind==='txt'&&<IconButton label="TXT目录规则" onClick={()=>setReaderDialog('txtRules')}><LegadoIcon name="ic_exchange"/></IconButton>}<IconButton label="阅读菜单" onClick={() => setReadMenu(!readMenu)}><LegadoIcon name="ic_more_vert"/></IconButton></header>
    <div hidden={!prefs.showHeader} className="reader-running-title"><span>{book.name}</span><span>{chapter?.title}</span></div>
    <div ref={viewport} className="reader-viewport" onScroll={onScroll} onTouchStart={event => { const point = event.touches[0]; touchStart.current = { x: point.clientX, y: point.clientY }; swiped.current = false; }} onTouchEnd={event => { const start = touchStart.current; if (!start || prefs.pageMode !== 'pages' || window.getSelection()?.toString()) { touchStart.current=null;return; } const point = event.changedTouches[0]; const dx = point.clientX - start.x; const dy = point.clientY - start.y; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { swiped.current = true; turn(dx < 0 ? 1 : -1); } touchStart.current = null; }} onClick={event => { if (swiped.current) { swiped.current = false; return; } if (window.getSelection()?.toString()) return; const rect = event.currentTarget.getBoundingClientRect(); const fraction = (event.clientX - rect.left) / rect.width; if (prefs.pageMode === 'pages' && (fraction < 0.23 || fraction > 0.77)) turn(fraction < 0.23 ? -1 : 1); else setControls(value => !value); }}>
      {loading ? <div className="reader-message" role="status">正在加载章节…</div> : error ? <div className="reader-message"><WifiOff /><p role="alert">{error}</p><button className="outlined" onClick={e => { e.stopPropagation(); setRetry(retry + 1); }}>重试</button></div> : <article className="chapter-body"><h1 data-text-start={0} hidden={prefs.titleAlign==='hidden'}>{highlighted(renderedTitle,0)}</h1>{paragraphs.map(item => <p data-text-start={item.start} key={item.start}>{highlighted(item.text,item.start)}</p>)}<div className="chapter-end">{book.chapter === book.chapters.length - 1 ? '全书完' : '本章完'}</div></article>}
    </div>
    <ReaderSelection viewport={viewport} book={book} read={(start,end)=>void startSpeech(start,end)} enabled={!drawer&&!dictWord&&!highlightManager&&!aloudOpen&&!contentEditor&&!readerExtra&&activeHighlight===null} offset={()=>offset.current} save={save} notify={notify} dictionary={setDictWord} highlight={addHighlight} search={text=>{setContentQuery(text);setDrawer('search');}} replaced={()=>setRetry(value=>value+1)}/>
    <HighlightFonts styles={ranges.map(range=>range.style)}/>
    {readMenu&&<><button className="source-panel-dismiss" aria-label="关闭阅读菜单" onClick={()=>setReadMenu(false)}/><div className="source-popup reader-overflow"><button onClick={()=>{void addBookmark();setReadMenu(false);}}>添加书签</button><button onClick={()=>{setInitialHighlightRule(undefined);setHighlightManager(true);setReadMenu(false);}}>高亮规则</button><button disabled={loading||!!error} onClick={()=>{setContentEditor(true);setReadMenu(false);}}>编辑正文</button><button onClick={()=>{setReaderExtra('pageAnim');setReadMenu(false);}}>翻页动画</button>{book.kind==='online'&&<button role="menuitemcheckbox" aria-checked={chapter.reversedOriginal!==undefined} onClick={()=>void readerAction('正在反转正文',()=>saveChapter(reverseChapter(chapter)))}>反转正文<input type="checkbox" checked={chapter.reversedOriginal!==undefined} readOnly tabIndex={-1}/></button>}<button role="menuitemcheckbox" aria-checked={book.useReplaceRule!==false} onClick={()=>void readerAction('正在更新正文',async()=>{await save({...bookRef.current,useReplaceRule:book.useReplaceRule===false});})}>替换净化<input type="checkbox" checked={book.useReplaceRule!==false} readOnly tabIndex={-1}/></button><button role="menuitemcheckbox" aria-checked={sameTitleRemoved} onClick={toggleSameTitle}>去除重复标题<input type="checkbox" checked={sameTitleRemoved} readOnly tabIndex={-1}/></button><button onClick={()=>{setReaderExtra('effective');setReadMenu(false);}}>生效的替换规则</button><button onClick={()=>{setDrawer('highlights');setReadMenu(false);}}>高亮与备注</button>{book.kind==='online'&&<button disabled={!!readerBusy} onClick={()=>void updateCatalog()}>更新目录</button>}<button onClick={()=>{setDrawer('settings');setReadMenu(false);}}>阅读设置</button></div></>}
    {contentEditor&&<ContentEditor book={book} content={content} displayTitle={displayTitle} notify={notify} save={saveChapter} reset={resetEditor} close={()=>setContentEditor(false)}/>}
    {readerExtra&&<Modal page={false} centered title={readerExtra==='pageAnim'?'翻页动画':'生效的替换规则'} close={()=>setReaderExtra(null)}>{readerExtra==='pageAnim'?<div className="preference-list">{([['cover','覆盖'],['slide','滑动'],['simulation','仿真'],['scroll','滚动'],['none','无']] as const).map(([value,label])=><label className="setting-row" key={value}><span>{label}</span><input type="radio" name="page-animation" checked={value==='scroll'?prefs.pageMode==='scroll':prefs.pageMode==='pages'&&prefs.pageAnimation===value} onChange={()=>{savePrefs({...prefs,pageMode:value==='scroll'?'scroll':'pages',pageAnimation:value==='scroll'?prefs.pageAnimation:value});setReaderExtra(null);}}/></label>)}</div>:<>{effectiveRules.map(rule=><div className="effective-rule" key={rule.id}><strong>{rule.name}</strong><p>{rule.pattern}</p><small>{rule.replacement||'替换为空'}</small></div>)}{!effectiveRules.length&&<div className="legado-empty">没有生效的替换规则</div>}</>}</Modal>}
    {readerDialog==='change'&&<Modal title="换源" toolbarId="reader-change-toolbar" close={()=>setReaderDialog(null)}><BookSearch sources={sources} books={[]} initialQuery={book.name} toolbarId="reader-change-toolbar" manage={()=>setReaderDialog(null)} choose={result=>void changeSource(result)} open={()=>{}} notify={notify}/></Modal>}
    {readerDialog==='txtRules'&&<Modal title="TXT目录规则" toolbarId="txt-rule-toolbar" close={()=>setReaderDialog(null)}><TxtTocManager notify={notify} book={book} saveBook={save} done={()=>{setReaderDialog(null);setRetry(value=>value+1);}}/></Modal>}
    {readerDialog==='cache'&&<Modal page={false} centered title="离线缓存" close={()=>setReaderDialog(null)}><div className="chapter-cache-range"><span>章节</span><input aria-label="缓存开始章节" type="number" min={1} max={book.chapters.length} value={cacheFrom} onChange={event=>setCacheFrom(event.target.value)}/><span>至</span><input aria-label="缓存结束章节" type="number" min={1} max={book.chapters.length} value={cacheTo} onChange={event=>setCacheTo(event.target.value)}/></div><div className="dialog-actions"><button onClick={()=>setReaderDialog(null)}>取消</button><button disabled={!!readerBusy} onClick={()=>void cacheChapters()}>确定</button></div></Modal>}
    {readerBusy&&<div className="busy" role="status"><span className="spinner"/>{readerBusy}{readerBusy.includes('缓存')&&<button className="cache-cancel" onClick={()=>{cacheCancelled.current=true;}}>停止</button>}</div>}
    {highlightManager&&<HighlightRuleManager initial={initialHighlightRule} close={()=>{setHighlightManager(false);setInitialHighlightRule(undefined);}} notify={notify}/>}
    {editingHighlight&&<HighlightEditor mark={editingHighlight} save={saveHighlight} remove={async()=>{await save({...bookRef.current,highlights:(bookRef.current.highlights||[]).filter(mark=>mark.time!==editingHighlight.time)});}} close={()=>setActiveHighlight(null)} createRule={mark=>{setActiveHighlight(null);setInitialHighlightRule(newHighlightRule(mark.bookText,book.name,highlightStyle(mark.style)));setHighlightManager(true);}} notify={notify}/>}
    {dictWord&&<DictionaryDialog word={dictWord} close={()=>setDictWord('')} notify={notify}/>}
    <div hidden={!prefs.showFooter} className="reader-footer"><span>{book.chapter + 1} / {book.chapters.length} 章</span><button aria-label="显示阅读菜单" onClick={() => setControls(!controls)}>{prefs.pageMode === 'pages' ? `${pageInfo.current} / ${pageInfo.total} 页` : '轻点正文显示菜单'}</button><span>{Math.round((book.chapter + offset.current) / book.chapters.length * 100)}%</span></div>
    {controls&&prefs.showBrightnessView!==false&&<ReaderBrightness prefs={prefs} save={savePrefs}/>}
    {replaceOpen&&<Modal title="替换净化" close={()=>{setReplaceOpen(false);setRetry(value=>value+1);}}><ReplaceManager notify={notify}/></Modal>}
    <div className={`reader-controls ${controls ? '' : 'hidden-controls'}`}><div className="reader-floating"><button aria-label="正文搜索" onClick={()=>setDrawer('search')}><LegadoIcon name="ic_search"/></button><button aria-label="自动阅读" aria-pressed={autoPage} onClick={()=>setAutoPage(!autoPage)}><LegadoIcon name={autoPage?"ic_auto_page_stop":"ic_auto_page"}/></button><button aria-label="替换净化" onClick={()=>setReplaceOpen(true)}><LegadoIcon name="ic_find_replace"/></button><button aria-label="夜间模式" onClick={()=>savePrefs({...prefs,readerTheme:prefs.readerTheme==='night'?'paper':'night'})}><LegadoIcon name="ic_brightness"/></button></div><div className="reader-menu-background"><div className="chapter-navigation"><button disabled={book.chapter === 0} onClick={() => navigate(book.chapter - 1)}>上一章</button><input aria-label="章节进度" type="range" min="0" max={book.chapters.length - 1} value={book.chapter} onChange={e => navigate(+e.target.value)} /><button disabled={book.chapter === book.chapters.length - 1} onClick={() => navigate(book.chapter + 1)}>下一章</button></div><div className="reader-actions"><button onClick={() => setDrawer('toc')}><LegadoIcon name="ic_toc" size={20}/>目录</button><button onClick={()=>{setAloudOpen(true);setControls(false);}}><LegadoIcon name="ic_read_aloud" size={20}/>朗读</button><button onClick={()=>setDrawer('style')}><LegadoIcon name="ic_interface_setting" size={20}/>界面</button><button onClick={()=>setDrawer('settings')}><LegadoIcon name="ic_settings" size={20}/>设置</button></div></div></div>
    {aloudOpen&&<ReadAloudPanel controller={aloud} bookId={book.id} start={()=>startSpeech()} close={()=>setAloudOpen(false)} toc={()=>{setAloudOpen(false);setDrawer('toc');}} menu={()=>{setAloudOpen(false);setControls(true);}} background={exit} navigate={direction=>void navigate(book.chapter+direction)} notify={notify}/>}
    {drawer && <Modal page={drawer !== 'settings' && drawer !== 'style'} title={drawer === 'toc' || drawer === 'bookmarks' || drawer === 'highlights' ? book.name : drawer === 'search' ? '正文搜索' : drawer==='style'?'界面':'阅读设置'} close={() => setDrawer(null)} wide={drawer === 'toc'}>{drawer === 'style' ? <ReaderStyleSettings prefs={prefs} save={savePrefs} notify={notify}/> : drawer === 'settings' ? <ReaderSettings prefs={prefs} save={savePrefs} /> : drawer === 'search' ? <><div className="input-row"><input aria-label="正文搜索关键词" placeholder="搜索已缓存正文" value={contentQuery} onChange={e=>setContentQuery(e.target.value)}/></div><p className="subtle">已缓存 {book.chapters.filter(c=>c.content!==undefined).length}/{book.chapters.length} 章</p>{matches.map(match=><button className="article-row" key={match.index} onClick={()=>navigate(match.index)}><h3>{match.title}</h3><p>{match.excerpt}</p></button>)}</> : <><nav className="toc-tabs"><button className={drawer==='toc'?'selected':''} onClick={()=>setDrawer('toc')}>目录</button><button className={drawer==='bookmarks'?'selected':''} onClick={()=>setDrawer('bookmarks')}>书签</button><button className={drawer==='highlights'?'selected':''} onClick={()=>setDrawer('highlights')}>高亮</button></nav>{drawer === 'toc' ? <><div className="input-row"><input aria-label="搜索目录" placeholder="搜索目录" value={tocQuery} onChange={e=>setTocQuery(e.target.value)}/><button className="text-button" onClick={()=>setReverseToc(!reverseToc)}>倒序</button><button className="text-button" onClick={()=>setCollapsed(collapsed.size?new Set():new Set(book.chapters.flatMap((c,i)=>c.isVolume?[i]:[])))}>展开 / 折叠</button></div><div className="toc-list">{tocEntries.map(({chapter:c,index:i})=><button key={i} className={`${i===book.chapter?'current':''} ${c.isVolume?'toc-volume':''}`} onClick={()=>c.isVolume?setCollapsed(old=>{const next=new Set(old);next.has(i)?next.delete(i):next.add(i);return next;}):navigate(i)}><span>{c.title}</span>{c.isVolume? <ChevronRight/> : c.content !== undefined && <Check size={15}/>}</button>)}</div></> : drawer === 'highlights' ? <>{(book.highlights||[]).map(mark=><div className="bookmark-row highlight-record" key={mark.time}><button onClick={()=>{setDrawer(null);setActiveHighlight(mark.time);}}><span>{mark.bookText}<small>{mark.chapterName}{mark.note?' · '+mark.note:''}</small></span></button><button className="text-button" onClick={()=>void jumpHighlight(mark)}>跳转</button></div>)}{!book.highlights?.length&&<div className="legado-empty">没有高亮</div>}</> : book.bookmarks.length ? book.bookmarks.map((mark,i)=><div className="bookmark-row" key={mark.created}><button onClick={()=>navigate(mark.chapter,mark.offset)}><Bookmark size={17}/><span>{mark.title}<small>{new Date(mark.created).toLocaleString('zh-CN')}</small></span></button><IconButton label="删除书签" onClick={()=>save({...bookRef.current,bookmarks:bookRef.current.bookmarks.filter((_,j)=>j!==i)})}><Trash2 size={18}/></IconButton></div>) : <div className="legado-empty">没有书签</div>}</>}</Modal>}
  </section>;
}
