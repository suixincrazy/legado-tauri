import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Rss, Search, MoreVertical, Plus, List, Download, Moon, Bookmark, ChevronLeft, ChevronRight, X, Check, Trash2, Clock3, SlidersHorizontal, BookMarked, Volume2, VolumeX, ExternalLink, WifiOff, CheckCircle2 } from 'lucide-react';
import { DEFAULT_SETTINGS, VERSION, createId, progress, smartGroup, type Book, type BookGroup, type Settings, type Source, type SearchResult, type ReadingRecord, type Feed } from './model';
import * as storage from './storage';
import { importBook, decodeText, htmlText } from './import';
import { pickFiles, saveFile } from './files';
import { searchSource, loadOnlineBook, loadChapter } from './sources';
import { fetchText } from './network';
import { pagination } from './pagination';
import { SourceSettings } from './SourceSettings';
import { SourceManager } from './SourceManager';
import { SourceDiscover } from './SourceDiscover';
import { LegadoIcon } from './LegadoIcon';
import { Welcome, WelcomeSettings } from './Welcome';
import { GroupManager, LibraryManager } from './LibraryManager';
import { ReplaceManager } from './ReplaceManager';
import { applyReplacement, scopedRules, type ReplaceRule } from './replacement';
import { invoke, isTauri } from '@tauri-apps/api/core';

type Tab = '书架' | '发现' | '订阅' | '我的';
type Panel = 'sources' | 'search' | 'settings' | 'stats' | 'about' | 'theme' | 'welcome' | 'layout' | 'backup' | 'bookmarks' | 'replace' | 'groups' | 'library' | null;
const icons = { 书架: 'books', 发现: 'explore', 订阅: 'rss_feed', 我的: 'person' };
function IconButton({ label, onClick, children, active = false, disabled = false }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean }) {
  return <button className={`icon-button ${active ? 'active' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Modal({ title, close, children, wide = false, page = true, toolbarId }: { title: string; close: () => void; children: ReactNode; wide?: boolean; page?: boolean; toolbarId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href]') || []);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const nodes = focusable(); const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [close]);
  return <div className={`scrim ${page ? 'page-scrim' : 'sheet-scrim'}`} onClick={event => { if (event.target === event.currentTarget) close(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'wide' : ''} ${page ? 'activity-page' : 'bottom-sheet'}`}><header><IconButton label="关闭" onClick={close}>{page ? <ArrowLeft /> : <X />}</IconButton><h2 className={toolbarId ? 'custom-toolbar-title' : undefined}>{title}</h2>{toolbarId && <div className="page-toolbar-content" id={toolbarId} />}</header><div className="modal-body">{children}</div></div></div>;
}
function Cover({ book }: { book: Pick<Book, 'name' | 'author' | 'cover'> }) {
  return <div className="cover">{book.cover && /^(https?:|data:image\/)/.test(book.cover) ? <img src={book.cover} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}<div className="cover-type"><span>{book.name}</span><small>{book.author}</small></div></div>;
}
function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{text}</p>{children}</div>;
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([]); const [sources, setSources] = useState<Source[]>([]);
  const [prefs, setPrefs] = useState<Settings>(DEFAULT_SETTINGS); const [records, setRecords] = useState<ReadingRecord[]>([]);
  const [bookGroups, setBookGroups] = useState<BookGroup[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]); const [tab, setTab] = useState<Tab>('书架');
  const [panel, setPanel] = useState<Panel>(null); const [reader, setReader] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null); const [group, setGroup] = useState('全部');
  const [menu, setMenu] = useState(false); const [toast, setToast] = useState(''); const [busy, setBusy] = useState('');
  const [ready, setReady] = useState(false); const [filter, setFilter] = useState('');
  const [query, setQuery] = useState(''); const [results, setResults] = useState<SearchResult[]>([]); const [searchErrors, setSearchErrors] = useState<string[]>([]);
  const [searchTarget, setSearchTarget] = useState<Source | null>(null);
  const [sourceSettings, setSourceSettings] = useState<Source | null>(null);
  const [discoverSource, setDiscoverSource] = useState<Source | null>(null);
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
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.dark ? 'dark' : 'light';
    if (isTauri() && /Android/i.test(navigator.userAgent)) invoke('java_bridge', { payload: JSON.stringify({ operation: 'systemUi', dark: prefs.dark }) }).catch(error => notify(String(error)));
  }, [prefs.dark, notify]);
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
    for (const file of files) { try { await saveBook(importBook(file.bytes, file.name)); imported++; } catch (e) { errors.push(`${file.name}: ${String(e)}`); } }
    if (files.length) notify(`已导入 ${imported} 本${errors.length ? `；${errors.join('；')}` : ''}`); setMenu(false);
  });
  const openBook = async (book: Book) => { await saveBook({ ...book, lastRead: Date.now() }); setReader(book.id); setDetail(null); };
  const search = async (exploreSource?: Source, exploreUrl?: string) => {
    if (!exploreSource && !query.trim()) return;
    const enabled = exploreSource ? [exploreSource] : searchTarget ? [searchTarget] : sources.filter(s => s.enabled !== false);
    if (!enabled.length) { notify('请先导入并启用书源'); setPanel('sources'); return; }
    setPanel('search'); setBusy('正在搜索'); setResults([]); setSearchErrors([]);
    const found: SearchResult[] = []; const errors: string[] = []; let next = 0;
    const worker = async () => { while (next < enabled.length) { const source = enabled[next++]; try { const items = await searchSource(source, query.trim(), !!exploreSource, exploreUrl); found.push(...items); setResults([...found]); } catch (error) { errors.push(`${source.bookSourceName}：${error instanceof Error ? error.message : error}`); setSearchErrors([...errors]); } } };
    await Promise.all(Array.from({ length: Math.min(4, enabled.length) }, worker)); setBusy('');
    if (!found.length && !errors.length) notify('没有搜索到书籍');
  };
  const addResult = (result: SearchResult) => task('正在读取目录', async () => {
    const existing = books.find(b => b.url === result.url && b.sourceUrl === result.sourceUrl);
    if (existing) { await openBook(existing); setPanel(null); return; }
    const source = sources.find(s => s.bookSourceUrl === result.sourceUrl); if (!source) throw new Error('找不到书源');
    const book = await loadOnlineBook(result, source); await saveBook(book); setPanel(null); await openBook(book);
  });
  const updateBooks = () => task('正在更新目录', async () => {
    let updated = 0; const errors: string[] = [];
    for (const book of books.filter(b => b.kind === 'online' && b.canUpdate !== false && !(b.groups || []).some(id => bookGroups.some(g => g.id === id && !g.enableRefresh)))) {
      const source = sources.find(s => s.bookSourceUrl === book.sourceUrl); if (!source || !book.url) continue;
      try {
        const fresh = await loadOnlineBook({ name: book.name, author: book.author, url: book.url, variables: book.variables, sourceUrl: source.bookSourceUrl, sourceName: source.bookSourceName }, source);
        const chapterUrl = book.chapters[book.chapter]?.url;
        const chapters = fresh.chapters.map(c => ({ ...c, content: book.chapters.find(old => old.url === c.url)?.content }));
        const index = chapters.findIndex(c => c.url === chapterUrl);
        await saveBook({ ...book, variables: fresh.variables, chapters, chapter: index >= 0 ? index : Math.min(book.chapter, chapters.length - 1), finished: chapters.length > book.chapters.length ? false : book.finished }); updated++;
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
  const selectedBook = books.find(b => b.id === detail);
  const readingBook = books.find(b => b.id === reader);
  const visible = books.filter(b => (group === '全部' || smartGroup(b) === group || (b.groups || []).includes(group)) && `${b.name}${b.author}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => b.lastRead - a.lastRead || b.added - a.added);
  const closePanel = useCallback(() => setPanel(null), []);
  return <div className="app" style={{ '--shelf-columns': prefs.shelfColumns } as CSSProperties}>
    <Welcome ready={ready} prefs={prefs} error={ready ? '' : toast} />
    <header className="toolbar">{tab === '书架' ? <div className="shelf-tabs" role="tablist" aria-label="书架分组">{[...(books.length ? ['全部', '未读', '在读', '已读'] : ['全部']), ...bookGroups.filter(g => g.show).map(g => g.id)].map(name => <button key={name} role="tab" aria-selected={group === name} className={group === name ? 'selected' : ''} onClick={() => setGroup(name)}>{bookGroups.find(g => g.id === name)?.name || name}</button>)}</div> : <h1>{tab}</h1>}<div className="toolbar-actions">{tab === '书架' && <IconButton label="搜索书籍" onClick={() => { setSearchTarget(null); setPanel('search'); }}><LegadoIcon name="ic_search" /></IconButton>}<IconButton label="更多选项" onClick={() => setMenu(!menu)}><LegadoIcon name="ic_more_vert" /></IconButton></div>
      {menu && <><button className="menu-dismiss" aria-label="关闭菜单" onClick={() => setMenu(false)} /><div className="overflow-menu">{tab === '书架' ? <><button onClick={() => { setMenu(false); updateBooks(); }}>更新目录</button><button onClick={localImport}>添加本地</button><button onClick={() => { setPanel('library'); setMenu(false); }}>书架管理</button><button onClick={() => { setPanel('groups'); setMenu(false); }}>分组管理</button><button onClick={() => { setPanel('layout'); setMenu(false); }}>书架布局</button><button onClick={() => { setPanel('backup'); setMenu(false); }}>导出书架 / 导入书架</button></> : tab === '订阅' ? <button onClick={() => { setRssAdd(true); setMenu(false); }}>添加订阅</button> : <><button onClick={() => { setPanel('sources'); setMenu(false); }}>书源管理</button><button onClick={() => { setPanel('theme'); setMenu(false); }}>主题设置</button></>}</div></>}
    </header>
    <main className="main-content">
      {tab === '书架' && <>
        {books.length > 0 && prefs.showShelfStatus && <div className="shelf-tools"><span>{visible.length} 本书</span><input aria-label="筛选书架" placeholder="筛选书架" value={filter} onChange={e => setFilter(e.target.value)} /></div>}
        {visible.length ? <div className={`bookshelf ${prefs.layout}`}>{visible.map(book => <article className="book" key={book.id}><button className="book-open" onClick={() => openBook(book)} onContextMenu={event => { event.preventDefault(); setDetail(book.id); }}><Cover book={book} /><div className="book-meta"><h2>{book.name}</h2>{prefs.layout === 'list' && <><p>{book.author}</p><p className="current-chapter">{book.chapters[book.chapter]?.title}</p><p className="book-progress">{smartGroup(book)}{book.lastRead ? ` · ${progress(book)}%` : ''}</p></>}</div></button><IconButton label={`${book.name} 详情`} onClick={() => setDetail(book.id)}><LegadoIcon name="ic_more_vert" size={18} /></IconButton></article>)}</div> : <div className="legado-empty">书架还空着，先去搜索书籍或从发现里添加吧!</div>}
      </>}
      {tab === '发现' && <div className="discovery-page">{sources.filter(s => s.enabled !== false && s.enabledExplore !== false && s.exploreUrl).map(source => <button className="setting-row" key={source.bookSourceUrl} onClick={() => setDiscoverSource(source)}><span>{source.bookSourceName}</span><ChevronRight /></button>)}{!sources.some(s => s.enabled !== false && s.enabledExplore !== false && s.exploreUrl) && <div className="legado-empty">没有启用发现的书源</div>}</div>}
      {tab === '订阅' && <div className="rss-page">{rssAdd && <form className="input-row" onSubmit={e => { e.preventDefault(); loadFeed(feedUrl, true); }}><input required type="url" aria-label="订阅地址" placeholder="输入 RSS / Atom 地址" value={feedUrl} onChange={e => setFeedUrl(e.target.value)} /><button className="primary" disabled={!!busy}>添加</button><button type="button" onClick={() => setRssAdd(false)}>取消</button></form>}{feeds.map(feed => <div className="source-row" key={feed.id}><button onClick={() => loadFeed(feed.url)}><Rss /><span><strong>{feed.name}</strong><small>{feed.url}</small></span></button><IconButton label={`删除订阅 ${feed.name}`} onClick={() => task('正在删除', async () => { await storage.remove('feeds', feed.id); await refresh(); })}><Trash2 /></IconButton></div>)}{!feeds.length && <div className="legado-empty">没有订阅源</div>}{feedArticles.map((article, index) => <button className="article-row" key={index} onClick={() => setActiveArticle(article)}><h3>{article.title}</h3><p>{article.content.slice(0, 140)}</p></button>)}</div>}
      {tab === '我的' && <div className="my-page preference-list">
        <button className="setting-row" onClick={() => setPanel('sources')}><LegadoIcon name="ic_cfg_source" /><span>书源管理<small>新建、编辑、导入、导出书源</small></span></button>
        <button className="setting-row" onClick={() => setPanel('replace')}><LegadoIcon name="ic_cfg_replace" /><span>净化替换<small>替换正文和标题内容</small></span></button>
        <button className="setting-row" onClick={() => savePrefs({ ...prefs, dark: !prefs.dark })}><LegadoIcon name="ic_cfg_theme" /><span>主题模式<small>{prefs.dark ? '夜间' : '白天'}</small></span><span className="switch" data-on={prefs.dark} /></button>
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
    {panel === 'theme' && <Modal title="主题设置" close={closePanel}><div className="preference-list"><button className="setting-row" onClick={() => setPanel('welcome')}><span>启动界面样式<small>启动界面图片和是否显示文字等</small></span></button><button className="setting-row" onClick={() => savePrefs({ ...prefs, dark: !prefs.dark })}><span>主题模式<small>{prefs.dark ? '夜间' : '白天'}</small></span><span className="switch" data-on={prefs.dark} /></button><button className="setting-row" onClick={() => setPanel('layout')}><span>书架布局</span></button></div></Modal>}
    {panel === 'welcome' && <Modal title="启动界面样式" close={() => setPanel('theme')}><WelcomeSettings prefs={prefs} save={savePrefs} notify={notify} /></Modal>}
    {panel === 'layout' && <Modal page={false} title="书架布局" close={closePanel}><label className="option-row">列表布局<input aria-label="列表布局" type="radio" checked={prefs.layout === 'list'} onChange={() => savePrefs({ ...prefs, layout: 'list' })} /></label><label className="option-row">网格布局<input aria-label="网格布局" type="radio" checked={prefs.layout === 'grid'} onChange={() => savePrefs({ ...prefs, layout: 'grid' })} /></label><label className="option-row">网格列数<select aria-label="网格列数" value={prefs.shelfColumns} onChange={e => savePrefs({ ...prefs, shelfColumns: +e.target.value })}>{[2,3,4,5,6,7,8].map(n => <option key={n}>{n}</option>)}</select></label><label className="option-row">显示书架统计<input type="checkbox" checked={prefs.showShelfStatus} onChange={e => savePrefs({ ...prefs, showShelfStatus: e.target.checked })} /></label></Modal>}
    {panel === 'backup' && <Modal title="备份与恢复" close={closePanel}><div className="preference-list"><button className="setting-row" onClick={() => task('正在导出备份', async () => { if (await saveFile(`legado-backup-${new Date().toISOString().slice(0, 10)}.json`, await storage.backup())) notify('备份已导出'); })}><span>备份<small>书籍、进度、书源与阅读设置</small></span></button><button className="setting-row" onClick={() => task('正在恢复备份', async () => { const files = await pickFiles(['json']); if (files[0]) { await storage.restore(decodeText(files[0].bytes)); await refresh(); notify('已恢复备份'); } })}><span>恢复备份<small>按标识合并，保留其他书籍</small></span></button></div></Modal>}
    {panel === 'bookmarks' && <Modal title="书签" close={closePanel}>{books.flatMap(book => book.bookmarks.map((mark, i) => <div className="bookmark-row" key={`${book.id}-${mark.created}`}><button onClick={async () => { await saveBook({ ...book, chapter: mark.chapter, offset: mark.offset }); setReader(book.id); setPanel(null); }}><span>{book.name}<small>{mark.title}</small></span></button><IconButton label="删除书签" onClick={() => saveBook({ ...book, bookmarks: book.bookmarks.filter((_, j) => j !== i) })}><Trash2 size={18} /></IconButton></div>))}{!books.some(b => b.bookmarks.length) && <div className="legado-empty">没有书签</div>}</Modal>}
    {panel === 'sources' && <Modal title="书源管理" close={closePanel} wide toolbarId="source-toolbar"><SourceManager sources={sources} books={books} refresh={refresh} notify={notify} login={setSourceSettings} search={source => { setSearchTarget(source); setResults([]); setSearchErrors([]); setPanel('search'); }} /></Modal>}
    {discoverSource && <Modal title={`发现 · ${discoverSource.bookSourceName}`} close={() => setDiscoverSource(null)} wide><SourceDiscover source={discoverSource} login={() => setSourceSettings(discoverSource)} browse={url => { const source = discoverSource; setDiscoverSource(null); search(source, url); }} /></Modal>}
    {sourceSettings && <Modal title={`书源设置 · ${sourceSettings.bookSourceName}`} close={() => setSourceSettings(null)}><SourceSettings source={sourceSettings} done={() => setSourceSettings(null)} notify={notify} /></Modal>}
    {panel === 'search' && <Modal title="搜索书籍" close={closePanel} wide><form className="input-row" onSubmit={e => { e.preventDefault(); search(); }}><input aria-label="书名或作者" placeholder="输入书名或作者" value={query} onChange={e => setQuery(e.target.value)} /><button className="primary" disabled={!!busy}><Search size={18} />搜索</button></form><p className="subtle">{searchTarget ? `在 ${searchTarget.bookSourceName} 中搜索` : `在 ${sources.filter(s => s.enabled !== false).length} 个已启用书源中搜索`}</p>{results.map((result, index) => <button className="search-result" key={result.url + index} disabled={!!busy} onClick={() => addResult(result)}><Cover book={result} /><div><h3>{result.name}</h3><p>{result.author}</p><small>{result.sourceName}</small><p className="result-intro">{result.intro}</p></div><Plus size={20} /></button>)}{searchErrors.length > 0 && <details className="search-errors"><summary>{searchErrors.length} 个书源未完成搜索</summary>{searchErrors.map((error, i) => <p key={i}>{error}</p>)}</details>}{!sources.length && <button className="text-button" onClick={() => setPanel('sources')}>先添加书源</button>}</Modal>}
    {panel === 'settings' && <Modal title="阅读设置" close={closePanel}><ReaderSettings prefs={prefs} save={savePrefs} /></Modal>}
    {panel === 'stats' && <Modal title="阅读记录" close={closePanel} wide><div className="record-summary"><strong>{Math.floor(records.reduce((n, r) => n + r.seconds, 0) / 60)}</strong> 分钟 · {new Set(records.map(r => r.bookId)).size} 本书</div>{records.length ? [...records].sort((a, b) => b.started - a.started).map(record => <div className="record" key={record.id}><Clock3 size={17} /><div><small>{new Date(record.started).toLocaleString('zh-CN')}</small><h3>{record.bookName}</h3><p>{record.chapter} · {record.seconds < 60 ? `${record.seconds} 秒` : `${Math.floor(record.seconds / 60)} 分钟`}</p></div></div>) : <Empty icon={<Clock3 />} title="还没有阅读记录" text="打开一本书，开始记录阅读时光。" />}</Modal>}
    {panel === 'about' && <Modal title="关于阅读" close={closePanel}><div className="about"><img className="about-icon" src="/legado/app-icon.svg" alt="阅读" /><h2>阅读</h2><p>{VERSION}</p><p>基于 Tauri 的独立阅读应用，界面与资源移植自 Legado。</p><p>书库保存在本机，建议定期导出备份。</p><a href="https://github.com/suixincrazy/legado-tauri" target="_blank" rel="noreferrer">项目源码</a><p className="subtle">GPL-3.0-or-later · 致谢 LegadoTeam/legado 与 HapeLee/legado-with-MD3</p></div></Modal>}
    {selectedBook && <BookDetails book={selectedBook} close={() => setDetail(null)} save={saveBook} open={() => openBook(selectedBook)} remove={() => task('删除书籍', async () => { await storage.remove('books', selectedBook.id); setDetail(null); await refresh(); })} cache={() => task('正在缓存章节', async () => { const source = sources.find(s => s.bookSourceUrl === selectedBook.sourceUrl); if (!source) throw new Error('书源不存在'); const book = { ...selectedBook, chapters: selectedBook.chapters.map(c => ({ ...c })) }; let count = 0; for (const chapter of book.chapters) { if (chapter.content === undefined) { chapter.content = await loadChapter(chapter, source, book); count++; await saveBook({ ...book, chapters: [...book.chapters] }); setBusy(`已缓存 ${count} 章`); } } notify('全部章节已缓存'); })} />}
    {activeArticle && <Modal title={activeArticle.title} close={() => setActiveArticle(null)} wide><article className="rss-content">{activeArticle.content.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}</article>{/^https?:/.test(activeArticle.url) && <a href={activeArticle.url} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={15} /></a>}</Modal>}
    {readingBook && <Reader book={readingBook} source={sources.find(s => s.bookSourceUrl === readingBook.sourceUrl)} prefs={prefs} savePrefs={savePrefs} save={saveBook} close={() => { setReader(null); refresh(); }} notify={notify} />}
    {busy && <div className="busy" role="status"><span className="spinner" />{busy}</div>}{toast && <div className="toast" role="alert" onClick={() => setToast('')}>{toast}</div>}
  </div>;
}

function BookDetails({ book, close, save, open, remove, cache }: { book: Book; close: () => void; save: (book: Book) => Promise<void>; open: () => void; remove: () => void; cache: () => void }) {
  const [note, setNote] = useState(book.note), [confirm, setConfirm] = useState(false), [toc, setToc] = useState(false), [edit, setEdit] = useState(false);
  const [name,setName] = useState(book.name), [author,setAuthor] = useState(book.author), [cover,setCover] = useState(book.cover || '');
  return <Modal title="书籍详情" close={close}><div className="book-detail-page"><div className="detail-hero" style={{ '--detail-cover': `url("${(book.cover || '/legado/image_cover_default.jpg').replace(/"/g, '%22')}")` } as CSSProperties}><Cover book={book} /></div><h2 className="detail-name">{book.name}</h2><div className="detail-metadata"><p><LegadoIcon name="ic_author" size={18} />{book.author}</p><p><LegadoIcon name="ic_web_outline" size={18} />{book.kind === 'online' ? '网络书籍' : book.kind.toUpperCase()}</p><p><LegadoIcon name="ic_book_last" size={18} />{book.chapters[book.chapter]?.title} · {progress(book)}%</p></div><div className="detail-description">{book.intro || '暂无简介'}</div><button className="setting-row" onClick={() => setToc(!toc)}><span>目录<small>{book.chapters.length} 章 · 已缓存 {book.chapters.filter(c => c.content !== undefined).length} 章</small></span><ChevronRight /></button>{toc && <div className="toc-list">{book.chapters.map((chapter,index) => <button key={index} onClick={async () => { await save({ ...book, chapter:index, offset:0 }); setToc(false); }}>{chapter.title}{chapter.content !== undefined && <Check size={15}/>}</button>)}</div>}<button className="setting-row" onClick={() => setEdit(!edit)}><span>编辑书籍信息</span><LegadoIcon name="ic_edit" /></button>{edit && <div className="detail-edit"><label className="field">书名<input aria-label="书名" value={name} onChange={e => setName(e.target.value)} /></label><label className="field">作者<input aria-label="作者" value={author} onChange={e=>setAuthor(e.target.value)} /></label><label className="field">封面地址<input aria-label="封面地址" value={cover} onChange={e=>setCover(e.target.value)} /></label><button className="text-button" disabled={!name.trim()} onClick={async()=>{await save({...book,name:name.trim(),author:author.trim(),cover});setEdit(false);}}>保存</button></div>}<label className="field detail-note">书籍备注<textarea aria-label="书籍备注" value={note} onChange={e => setNote(e.target.value)} onBlur={() => { if (note !== book.note) save({ ...book, note }); }} /></label><div className="source-actions detail-tools"><button className="text-button" onClick={() => save({ ...book, finished: !book.finished, note })}>{book.finished ? '标为未读完' : '标为已读'}</button>{book.kind === 'online' && <button className="text-button" onClick={cache}>缓存全书</button>}</div><div className="detail-bottom"><button onClick={() => setConfirm(true)}>移出书架</button><button className="primary" onClick={open}>阅读</button></div>{confirm && <div className="source-confirm"><p>删除《{book.name}》及其进度、书签？</p><button className="text-button danger" onClick={remove}>删除</button><button className="text-button" onClick={() => setConfirm(false)}>取消</button></div>}</div></Modal>;
}
function ReaderSettings({ prefs, save }: { prefs: Settings; save: (prefs: Settings) => void }) {
  return <div className="reader-settings"><div className="reader-style-toolbar"><button aria-pressed={prefs.readBold} onClick={()=>save({...prefs,readBold:!prefs.readBold})}>加粗</button><button onClick={()=>save({...prefs,font:prefs.font==='serif'?'sans':'serif'})}>字体</button><button onClick={()=>save({...prefs,textIndent:prefs.textIndent===2?0:2})}>缩进 {prefs.textIndent}</button></div><label>字号 <output>{prefs.fontSize}</output><input aria-label="字号" type="range" min="14" max="36" step="1" value={prefs.fontSize} onChange={e => save({ ...prefs, fontSize: +e.target.value })} /></label><label>行距 <output>{prefs.lineHeight.toFixed(1)}</output><input aria-label="行距" type="range" min="1.3" max="2.6" step="0.1" value={prefs.lineHeight} onChange={e => save({ ...prefs, lineHeight: +e.target.value })} /></label><label>段距 <output>{prefs.paragraphSpace.toFixed(1)}</output><input aria-label="段距" type="range" min="0" max="2" step="0.1" value={prefs.paragraphSpace} onChange={e => save({ ...prefs, paragraphSpace: +e.target.value })} /></label><div className="option-row"><span>字体</span><select aria-label="字体" value={prefs.font} onChange={e => save({ ...prefs, font: e.target.value as Settings['font'] })}><option value="serif">宋体 / 系统衬线</option><option value="sans">系统黑体</option></select></div><div className="option-row"><span>翻页方式</span><select aria-label="翻页方式" value={prefs.pageMode} onChange={e => save({ ...prefs, pageMode: e.target.value as Settings['pageMode'] })}><option value="scroll">上下滚动</option><option value="pages">左右翻页</option></select></div><label className="option-row"><span>横屏双页（平板）</span><input type="checkbox" checked={prefs.twoPage} onChange={e => save({ ...prefs, twoPage: e.target.checked })} /></label><label className="option-row">自动阅读间隔（秒）<input aria-label="自动阅读间隔" type="number" min="2" max="120" value={prefs.autoPageSeconds} onChange={e=>save({...prefs,autoPageSeconds:Math.max(2,Math.min(120,+e.target.value||10))})}/></label><div className="theme-options">{(['paper', 'white', 'green', 'night'] as const).map((theme, i) => <button aria-label={['纸张', '纯白', '护眼', '夜读'][i]} aria-pressed={prefs.readerTheme === theme} className={`theme-swatch ${theme}`} key={theme} onClick={() => save({ ...prefs, readerTheme: theme })}>{prefs.readerTheme === theme ? <Check size={20} /> : '字'}</button>)}</div></div>;
}

function Reader({ book, source, prefs, savePrefs, save, close, notify }: { book: Book; source?: Source; prefs: Settings; savePrefs: (prefs: Settings) => void; save: (book: Book) => Promise<void>; close: () => void; notify: (text: string) => void }) {
  const [controls, setControls] = useState(true); const [drawer, setDrawer] = useState<'toc' | 'bookmarks' | 'settings' | 'search' | null>(null);
  const [autoPage, setAutoPage] = useState(false), [contentQuery, setContentQuery] = useState(''), [tocQuery, setTocQuery] = useState(''), [reverseToc,setReverseToc] = useState(false);
  const [collapsed,setCollapsed] = useState(new Set<number>());
  const [displayTitle, setDisplayTitle] = useState('');
  const [content, setContent] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false); const [pageInfo, setPageInfo] = useState({ current: 1, total: 1 });
  const viewport = useRef<HTMLDivElement>(null); const bookRef = useRef(book); bookRef.current = book;
  const offset = useRef(book.offset); const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const restorePending = useRef(true); const record = useRef<ReadingRecord | null>(null); const lastTick = useRef(0);
  const [retry, setRetry] = useState(0); const chapter = book.chapters[book.chapter];
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const persist = useCallback(() => save({ ...bookRef.current, offset: offset.current, lastRead: Date.now() }), [save]);
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
      const rules = await storage.preference<ReplaceRule[]>('replaceRules', []);
      const [body, title] = await Promise.all([applyReplacement(text, scopedRules(rules, selected, 'content')), applyReplacement(selectedChapter?.title || '', scopedRules(rules, selected, 'title'))]);
      if (alive) { setContent(body); setDisplayTitle(title); }
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [book.id, book.chapter, retry, source, save]);
  useEffect(() => {
    if (!content) return;
    const node = viewport.current; if (!node) return;
    const restore = () => {
      if (prefs.pageMode === 'pages') { const { total, stride } = pagination(node, node.querySelector('.chapter-body')!); node.scrollLeft = Math.round(offset.current * (total - 1)) * stride; setPageInfo(pagination(node, node.querySelector('.chapter-body')!)); }
      else node.scrollTop = offset.current * Math.max(0, node.scrollHeight - node.clientHeight);
      restorePending.current = false;
    };
    restorePending.current = true; const frame = requestAnimationFrame(restore); const observer = new ResizeObserver(() => { restorePending.current = true; requestAnimationFrame(restore); }); observer.observe(node);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [content, prefs.fontSize, prefs.lineHeight, prefs.paragraphSpace, prefs.font, prefs.pageMode, prefs.twoPage]);
  useEffect(() => {
    record.current = { id: createId(), bookId: book.id, bookName: book.name, chapter: chapter?.title || '', started: Date.now(), seconds: 0 }; lastTick.current = Date.now();
    const flush = () => { const current = record.current; if (current && current.seconds > 0) storage.put('records', current.id, { ...current }).catch(e => notify(String(e))); };
    const tick = setInterval(() => { const now = Date.now(); const elapsed = Math.min(5, Math.floor((now - lastTick.current) / 1000)); lastTick.current = now; if (!document.hidden && record.current) record.current.seconds += elapsed; flush(); persist().catch(e => notify(String(e))); }, 5000);
    const visibility = () => { lastTick.current = Date.now(); flush(); persist().catch(e => notify(String(e))); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', visibility);
    return () => { clearInterval(tick); flush(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', visibility); };
  }, [book.id, book.chapter, book.name, chapter?.title, persist, notify]);
  useEffect(() => () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); }, []);
  const navigate = useCallback(async (index: number, position = 0) => {
    const current = bookRef.current;
    if (index < 0 || index >= current.chapters.length) { notify(index < 0 ? '已经是第一章' : '已经是最后一章'); return; }
    if ('speechSynthesis' in window) speechSynthesis.cancel(); setSpeaking(false); offset.current = position;
    await save({ ...current, chapter: index, offset: position, lastRead: Date.now() }); if (index === current.chapter) setRetry(value => value + 1); setDrawer(null);
  }, [save, notify]);
  const turn = useCallback((direction: number) => {
    const node = viewport.current; if (!node) return;
    if (!node.querySelector('.chapter-body')) return;
    if (prefsRef.current.pageMode === 'pages') {
      const { stride, current, total } = pagination(node, node.querySelector('.chapter-body')!);
      const next = (current - 1 + direction) * stride;
      if (current + direction > total) { navigate(bookRef.current.chapter + 1); return; }
      if (next < -2) { navigate(bookRef.current.chapter - 1, 1); return; }
      node.scrollTo({ left: next, behavior: 'smooth' });
    } else {
      if (direction > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 3) { navigate(bookRef.current.chapter + 1); return; }
      if (direction < 0 && node.scrollTop <= 1) { navigate(bookRef.current.chapter - 1, 1); return; }
      node.scrollBy({ top: direction * node.clientHeight * 0.85, behavior: 'smooth' });
    }
  }, [navigate]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (drawer || (event.target instanceof Element && event.target.matches('input,textarea,select'))) return; if (['ArrowRight', 'PageDown', 'ArrowDown', ' '].includes(event.key)) { event.preventDefault(); turn(1); } if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(event.key)) { event.preventDefault(); turn(-1); } if (event.key === 'Escape') { persist(); close(); } };
    document.addEventListener('keydown', key); let last = 0;
    const gamepad = setInterval(() => { if (document.hidden || drawer || !navigator.getGamepads) return; const pad = Array.from(navigator.getGamepads()).find(Boolean); if (!pad || Date.now() - last < 350) return; if (pad.buttons[13]?.pressed || pad.buttons[15]?.pressed || pad.axes[1] > 0.6) { turn(1); last = Date.now(); } else if (pad.buttons[12]?.pressed || pad.buttons[14]?.pressed || pad.axes[1] < -0.6) { turn(-1); last = Date.now(); } }, 80);
    return () => { document.removeEventListener('keydown', key); clearInterval(gamepad); };
  }, [turn, drawer, persist, close]);
  useEffect(() => {
    if (!autoPage || drawer || loading) return;
    const timer=setInterval(()=>{if (!document.hidden) turn(1);},Math.max(2,prefs.autoPageSeconds)*1000);
    return ()=>clearInterval(timer);
  },[autoPage,drawer,loading,prefs.autoPageSeconds,turn]);
  const onScroll = () => { if (restorePending.current) return; const node = viewport.current; if (!node) return; if (prefs.pageMode === 'pages') { const info = pagination(node, node.querySelector('.chapter-body')!); offset.current = (info.current - 1) / Math.max(1, info.total - 1); setPageInfo(info); } else offset.current = node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight); offset.current = Math.max(0, Math.min(1, offset.current)); };
  const speak = () => {
    if (!('speechSynthesis' in window)) { notify('当前系统 WebView 不提供朗读能力'); return; }
    if (speaking) { speechSynthesis.cancel(); setSpeaking(false); return; }
    const paragraphs = content.split('\n').filter(Boolean); let index = Math.floor(offset.current * Math.max(0, paragraphs.length - 1));
    const next = () => { if (index >= paragraphs.length) { setSpeaking(false); return; } const utterance = new SpeechSynthesisUtterance(paragraphs[index++]); utterance.lang = 'zh-CN'; utterance.onend = next; utterance.onerror = () => { setSpeaking(false); notify('系统朗读不可用'); }; speechSynthesis.speak(utterance); };
    setSpeaking(true); next();
  };
  const addBookmark = async () => { await save({ ...bookRef.current, bookmarks: [...bookRef.current.bookmarks, { chapter: book.chapter, offset: offset.current, title: chapter.title, created: Date.now() }] }); notify('书签已添加'); };
  const exit = async () => { await persist(); close(); };
  const style = { '--read-font-size': `${prefs.fontSize}px`, '--read-line-height': prefs.lineHeight, '--paragraph-gap': `${prefs.paragraphSpace}em`, '--read-weight': prefs.readBold ? 700 : 400, '--read-indent':`${prefs.textIndent}em` } as CSSProperties;
  let volume = -1;
  const tocEntries = book.chapters.map((chapter,index)=>{if(chapter.isVolume)volume=index;return {chapter,index,volume};}).filter(entry => entry.chapter.title.includes(tocQuery) && (entry.chapter.isVolume || !collapsed.has(entry.volume)));
  if (reverseToc) tocEntries.reverse();
  const matches = contentQuery.trim() ? book.chapters.flatMap((c,index) => { const text = index === book.chapter ? content : c.content || ''; const position=text.indexOf(contentQuery); return position < 0 ? [] : [{ index,title:c.title,excerpt:text.slice(Math.max(0,position-30),position+contentQuery.length+90) }]; }) : [];
  return <section className={`reader ${prefs.readerTheme} ${prefs.font} ${prefs.pageMode} ${prefs.twoPage ? 'two-page' : ''}`} style={style} aria-label={`正在阅读 ${book.name}`}>
    <header className={`reader-toolbar ${controls ? '' : 'hidden-controls'}`}><IconButton label="返回书架" onClick={exit}><ArrowLeft /></IconButton><span>{book.name}</span><IconButton label="添加书签" onClick={addBookmark}><Bookmark /></IconButton><IconButton label="阅读设置" onClick={() => setDrawer('settings')}><MoreVertical /></IconButton></header>
    <div className="reader-running-title"><span>{book.name}</span><span>{chapter?.title}</span></div>
    <div ref={viewport} className="reader-viewport" onScroll={onScroll} onTouchStart={event => { const point = event.touches[0]; touchStart.current = { x: point.clientX, y: point.clientY }; swiped.current = false; }} onTouchEnd={event => { const start = touchStart.current; if (!start || prefs.pageMode !== 'pages') return; const point = event.changedTouches[0]; const dx = point.clientX - start.x; const dy = point.clientY - start.y; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { swiped.current = true; turn(dx < 0 ? 1 : -1); } touchStart.current = null; }} onClick={event => { if (swiped.current) { swiped.current = false; return; } if (window.getSelection()?.toString()) return; const rect = event.currentTarget.getBoundingClientRect(); const fraction = (event.clientX - rect.left) / rect.width; if (prefs.pageMode === 'pages' && (fraction < 0.23 || fraction > 0.77)) turn(fraction < 0.23 ? -1 : 1); else setControls(value => !value); }}>
      {loading ? <div className="reader-message" role="status">正在加载章节…</div> : error ? <div className="reader-message"><WifiOff /><p role="alert">{error}</p><button className="outlined" onClick={e => { e.stopPropagation(); setRetry(retry + 1); }}>重试</button></div> : <article className="chapter-body"><h1>{displayTitle || chapter?.title}</h1>{content.split('\n').filter(line => line.trim()).map((line, i) => <p key={i}>{line.trim()}</p>)}<div className="chapter-end">{book.chapter === book.chapters.length - 1 ? '全书完' : '本章完'}</div></article>}
    </div>
    <div className="reader-footer"><span>{book.chapter + 1} / {book.chapters.length} 章</span><button aria-label="显示阅读菜单" onClick={() => setControls(!controls)}>{prefs.pageMode === 'pages' ? `${pageInfo.current} / ${pageInfo.total} 页` : '轻点正文显示菜单'}</button><span>{Math.round((book.chapter + offset.current) / book.chapters.length * 100)}%</span></div>
    <div className={`reader-controls ${controls ? '' : 'hidden-controls'}`}><div className="reader-floating"><button aria-label="正文搜索" onClick={()=>setDrawer('search')}><LegadoIcon name="ic_search"/></button><button aria-label="自动阅读" aria-pressed={autoPage} onClick={()=>setAutoPage(!autoPage)}><LegadoIcon name="ic_auto_page"/></button><button aria-label="夜间模式" onClick={()=>savePrefs({...prefs,readerTheme:prefs.readerTheme==='night'?'paper':'night'})}><LegadoIcon name="ic_brightness"/></button></div><div className="reader-menu-background"><div className="chapter-navigation"><button disabled={book.chapter === 0} onClick={() => navigate(book.chapter - 1)}>上一章</button><input aria-label="章节进度" type="range" min="0" max={book.chapters.length - 1} value={book.chapter} onChange={e => navigate(+e.target.value)} /><button disabled={book.chapter === book.chapters.length - 1} onClick={() => navigate(book.chapter + 1)}>下一章</button></div><div className="reader-actions"><button onClick={() => setDrawer('toc')}><LegadoIcon name="ic_toc" size={20}/>目录</button><button onClick={speak}><LegadoIcon name="ic_read_aloud" size={20}/>{speaking ? '停止' : '朗读'}</button><button onClick={()=>setDrawer('settings')}><LegadoIcon name="ic_interface_setting" size={20}/>界面</button><button onClick={()=>setDrawer('settings')}><LegadoIcon name="ic_settings" size={20}/>设置</button></div></div></div>
    {drawer && <Modal page={drawer !== 'settings'} title={drawer === 'toc' || drawer === 'bookmarks' ? book.name : drawer === 'search' ? '正文搜索' : '阅读设置'} close={() => setDrawer(null)} wide={drawer === 'toc'}>{drawer === 'settings' ? <ReaderSettings prefs={prefs} save={savePrefs} /> : drawer === 'search' ? <><div className="input-row"><input aria-label="正文搜索关键词" placeholder="搜索已缓存正文" value={contentQuery} onChange={e=>setContentQuery(e.target.value)}/></div><p className="subtle">已缓存 {book.chapters.filter(c=>c.content!==undefined).length}/{book.chapters.length} 章</p>{matches.map(match=><button className="article-row" key={match.index} onClick={()=>navigate(match.index)}><h3>{match.title}</h3><p>{match.excerpt}</p></button>)}</> : <><nav className="toc-tabs"><button className={drawer==='toc'?'selected':''} onClick={()=>setDrawer('toc')}>目录</button><button className={drawer==='bookmarks'?'selected':''} onClick={()=>setDrawer('bookmarks')}>书签</button></nav>{drawer === 'toc' ? <><div className="input-row"><input aria-label="搜索目录" placeholder="搜索目录" value={tocQuery} onChange={e=>setTocQuery(e.target.value)}/><button className="text-button" onClick={()=>setReverseToc(!reverseToc)}>倒序</button><button className="text-button" onClick={()=>setCollapsed(collapsed.size?new Set():new Set(book.chapters.flatMap((c,i)=>c.isVolume?[i]:[])))}>展开 / 折叠</button></div><div className="toc-list">{tocEntries.map(({chapter:c,index:i})=><button key={i} className={`${i===book.chapter?'current':''} ${c.isVolume?'toc-volume':''}`} onClick={()=>c.isVolume?setCollapsed(old=>{const next=new Set(old);next.has(i)?next.delete(i):next.add(i);return next;}):navigate(i)}><span>{c.title}</span>{c.isVolume? <ChevronRight/> : c.content !== undefined && <Check size={15}/>}</button>)}</div></> : book.bookmarks.length ? book.bookmarks.map((mark,i)=><div className="bookmark-row" key={mark.created}><button onClick={()=>navigate(mark.chapter,mark.offset)}><Bookmark size={17}/><span>{mark.title}<small>{new Date(mark.created).toLocaleString('zh-CN')}</small></span></button><IconButton label="删除书签" onClick={()=>save({...bookRef.current,bookmarks:bookRef.current.bookmarks.filter((_,j)=>j!==i)})}><Trash2 size={18}/></IconButton></div>) : <div className="legado-empty">没有书签</div>}</>}</Modal>}
  </section>;
}
