import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Library, Compass, Rss, UserRound, Search, MoreVertical, Plus, List, Grid2X2, RefreshCw, Download, Upload, Settings as SettingsIcon, Moon, Sun, Bookmark, ChevronLeft, ChevronRight, X, Check, Trash2, FileText, Clock3, SlidersHorizontal, BookMarked, Volume2, VolumeX, StickyNote, ExternalLink, WifiOff, CheckCircle2 } from 'lucide-react';
import { DEFAULT_SETTINGS, VERSION, newBook, progress, smartGroup, type Book, type Settings, type Source, type SearchResult, type ReadingRecord, type Feed } from './model';
import * as storage from './storage';
import { importBook, decodeText, htmlText } from './import';
import { pickFiles, saveFile } from './files';
import { parseSources, sourceSupport, searchSource, loadOnlineBook, loadChapter } from './sources';
import { fetchText } from './network';

type Tab = '书架' | '发现' | '订阅' | '我的';
type Panel = 'sources' | 'search' | 'settings' | 'stats' | 'about' | null;
const icons = { 书架: Library, 发现: Compass, 订阅: Rss, 我的: UserRound };
const palettes = ['#7b8d93', '#967660', '#61796e', '#7e768f', '#727e9b', '#a08262'];
function IconButton({ label, onClick, children, active = false, disabled = false }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean }) {
  return <button className={`icon-button ${active ? 'active' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Modal({ title, close, children, wide = false }: { title: string; close: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href]') || []);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const nodes = focusable(); const first = nodes[0]; const last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [close]);
  return <div className="scrim" onClick={event => { if (event.target === event.currentTarget) close(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'wide' : ''}`}><header><h2>{title}</h2><IconButton label="关闭" onClick={close}><X /></IconButton></header><div className="modal-body">{children}</div></div></div>;
}
function Cover({ book }: { book: Pick<Book, 'name' | 'author' | 'cover'> }) {
  const color = palettes[Array.from(book.name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % palettes.length];
  return <div className="cover" style={{ backgroundColor: color }}>{book.cover && /^(https?:|data:image\/)/.test(book.cover) ? <img src={book.cover} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}<div className="cover-type"><span>{book.name}</span><small>{book.author}</small></div></div>;
}
function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{text}</p>{children}</div>;
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([]); const [sources, setSources] = useState<Source[]>([]);
  const [prefs, setPrefs] = useState<Settings>(DEFAULT_SETTINGS); const [records, setRecords] = useState<ReadingRecord[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]); const [tab, setTab] = useState<Tab>('书架');
  const [panel, setPanel] = useState<Panel>(null); const [reader, setReader] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null); const [group, setGroup] = useState('全部');
  const [menu, setMenu] = useState(false); const [toast, setToast] = useState(''); const [busy, setBusy] = useState('');
  const [ready, setReady] = useState(false); const [filter, setFilter] = useState('');
  const [query, setQuery] = useState(''); const [results, setResults] = useState<SearchResult[]>([]); const [searchErrors, setSearchErrors] = useState<string[]>([]);
  const [sourceText, setSourceText] = useState(''); const [sourceUrl, setSourceUrl] = useState('');
  const [feedUrl, setFeedUrl] = useState(''); const [feedArticles, setFeedArticles] = useState<{ title: string; content: string; url: string }[]>([]);
  const [activeArticle, setActiveArticle] = useState<{ title: string; content: string; url: string } | null>(null);
  const notify = useCallback((text: string) => setToast(text), []);
  const refresh = useCallback(async () => {
    const [b, s, p, r, f] = await Promise.all([storage.all<Book>('books'), storage.all<Source>('sources'), storage.settings(), storage.all<ReadingRecord>('records'), storage.all<Feed>('feeds')]);
    setBooks(b); setSources(s); setPrefs(p); setRecords(r); setFeeds(f);
  }, []);
  useEffect(() => { refresh().then(() => setReady(true)).catch(error => notify(String(error))); }, [refresh, notify]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { document.documentElement.dataset.theme = prefs.dark ? 'dark' : 'light'; }, [prefs.dark]);
  const task = async (label: string, action: () => Promise<void>) => { setBusy(label); try { await action(); } catch (error) { notify(error instanceof Error ? error.message : String(error)); } finally { setBusy(''); } };
  const saveBook = useCallback(async (book: Book) => { await storage.put('books', book.id, book); setBooks(old => { const index = old.findIndex(b => b.id === book.id); return index < 0 ? [...old, book] : old.map(b => b.id === book.id ? book : b); }); }, []);
  const savePrefs = (next: Settings) => { setPrefs(next); storage.put('settings', 'reader', next).catch(error => notify(String(error))); };
  const localImport = () => task('正在导入书籍', async () => {
    const files = await pickFiles(['txt', 'epub'], true); let imported = 0; const errors: string[] = [];
    for (const file of files) { try { await saveBook(importBook(file.bytes, file.name)); imported++; } catch (e) { errors.push(`${file.name}: ${String(e)}`); } }
    if (files.length) notify(`已导入 ${imported} 本${errors.length ? `；${errors.join('；')}` : ''}`); setMenu(false);
  });
  const openBook = async (book: Book) => { await saveBook({ ...book, lastRead: Date.now() }); setReader(book.id); setDetail(null); };
  const importSources = async (text: string) => {
    const imported = parseSources(text); for (const source of imported) await storage.put('sources', source.bookSourceUrl, source);
    await refresh(); setSourceText(''); notify(`已导入 ${imported.length} 个书源`);
  };
  const search = async (exploreSource?: Source) => {
    if (!exploreSource && !query.trim()) return;
    const enabled = exploreSource ? [exploreSource] : sources.filter(s => s.enabled !== false);
    if (!enabled.length) { notify('请先导入并启用书源'); setPanel('sources'); return; }
    setPanel('search'); setBusy('正在搜索'); setResults([]); setSearchErrors([]);
    const found: SearchResult[] = []; const errors: string[] = []; let next = 0;
    const worker = async () => { while (next < enabled.length) { const source = enabled[next++]; try { const items = await searchSource(source, query.trim(), !!exploreSource); found.push(...items); setResults([...found]); } catch (error) { errors.push(`${source.bookSourceName}：${error instanceof Error ? error.message : error}`); setSearchErrors([...errors]); } } };
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
    for (const book of books.filter(b => b.kind === 'online')) {
      const source = sources.find(s => s.bookSourceUrl === book.sourceUrl); if (!source || !book.url) continue;
      try {
        const fresh = await loadOnlineBook({ name: book.name, author: book.author, url: book.url, sourceUrl: source.bookSourceUrl, sourceName: source.bookSourceName }, source);
        const chapterUrl = book.chapters[book.chapter]?.url;
        const chapters = fresh.chapters.map(c => ({ ...c, content: book.chapters.find(old => old.url === c.url)?.content }));
        const index = chapters.findIndex(c => c.url === chapterUrl);
        await saveBook({ ...book, chapters, chapter: index >= 0 ? index : Math.min(book.chapter, chapters.length - 1), finished: chapters.length > book.chapters.length ? false : book.finished }); updated++;
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
  const visible = books.filter(b => (group === '全部' || smartGroup(b) === group) && `${b.name}${b.author}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => b.lastRead - a.lastRead || b.added - a.added);
  const closePanel = useCallback(() => setPanel(null), []);
  if (!ready) return <div className="loading-screen">正在打开书库…{toast && <p role="alert">{toast}</p>}</div>;
  return <div className="app">
    <header className="toolbar"><h1>{tab}</h1><div className="toolbar-actions"><IconButton label="搜索书籍" onClick={() => setPanel('search')}><Search /></IconButton><IconButton label="本地导入" onClick={localImport}><Plus /></IconButton><IconButton label="更多选项" onClick={() => setMenu(!menu)}><MoreVertical /></IconButton></div>
      {menu && <><button className="menu-dismiss" aria-label="关闭菜单" onClick={() => setMenu(false)} /><div className="overflow-menu"><button onClick={() => { setPanel('sources'); setMenu(false); }}><Library />书源管理</button><button onClick={() => { savePrefs({ ...prefs, layout: prefs.layout === 'grid' ? 'list' : 'grid' }); setMenu(false); }}>{prefs.layout === 'grid' ? <List /> : <Grid2X2 />}切换书架布局</button><button onClick={() => { setMenu(false); updateBooks(); }}><RefreshCw />更新目录</button><button onClick={() => { setPanel('settings'); setMenu(false); }}><SettingsIcon />阅读设置</button></div></>}
    </header>
    <main className="main-content">
      {tab === '书架' && <><div className="shelf-tabs" role="tablist" aria-label="书架分组">{['全部', '未读', '在读', '已读'].map(name => <button key={name} role="tab" aria-selected={group === name} className={group === name ? 'selected' : ''} onClick={() => setGroup(name)}>{name}<small>{name === '全部' ? books.length : books.filter(b => smartGroup(b) === name).length}</small></button>)}</div>
        {books.length > 0 && <div className="shelf-tools"><span>{visible.length} 本书</span><input aria-label="筛选书架" placeholder="筛选书架" value={filter} onChange={e => setFilter(e.target.value)} /><IconButton label="更新目录" onClick={updateBooks}><RefreshCw size={18} /></IconButton></div>}
        {visible.length ? <div className={`bookshelf ${prefs.layout}`}>{visible.map(book => <article className="book" key={book.id}><button className="book-open" onClick={() => openBook(book)}><Cover book={book} /><div className="book-meta"><h2>{book.name}</h2><p>{book.author}</p><p className="book-progress">{smartGroup(book)}{book.lastRead ? ` · ${progress(book)}%` : ''}</p>{prefs.layout === 'list' && <p className="current-chapter">{book.chapters[book.chapter]?.title}</p>}</div></button><IconButton label={`${book.name} 详情`} onClick={() => setDetail(book.id)}><MoreVertical size={18} /></IconButton></article>)}</div> : <Empty icon={<BookOpen />} title={books.length ? '这个分组还没有书' : '把喜欢的书，放进书架'} text="导入 TXT、EPUB，或添加书源后搜索书籍。"><button className="primary" onClick={localImport}><Plus size={18} />导入本地书籍</button><button className="text-button" onClick={() => setPanel('sources')}>添加书源</button></Empty>}
      </>}
      {tab === '发现' && <div className="page-pad"><h2 className="section-title">书源发现</h2><p className="subtle">从已添加的书源中浏览书籍</p>{sources.filter(s => s.enabled !== false && s.exploreUrl).map(source => <button className="setting-row" key={source.bookSourceUrl} onClick={() => search(source)}><Compass /><span><strong>{source.bookSourceName}</strong><small>{source.bookSourceGroup || source.bookSourceUrl}</small></span><ChevronRight /></button>)}{!sources.some(s => s.enabled !== false && s.exploreUrl) && <Empty icon={<Compass />} title="发现更多好书" text="添加包含发现规则的书源，即可在这里浏览。"><button className="primary" onClick={() => setPanel('sources')}>管理书源</button></Empty>}</div>}
      {tab === '订阅' && <div className="page-pad"><h2 className="section-title">RSS 订阅</h2><form className="input-row" onSubmit={e => { e.preventDefault(); loadFeed(feedUrl, true); }}><input required type="url" aria-label="订阅地址" placeholder="输入 RSS / Atom 地址" value={feedUrl} onChange={e => setFeedUrl(e.target.value)} /><button className="primary" disabled={!!busy}>添加</button></form>{feeds.map(feed => <div className="source-row" key={feed.id}><button onClick={() => loadFeed(feed.url)}><Rss /><span><strong>{feed.name}</strong><small>{feed.url}</small></span></button><IconButton label={`删除订阅 ${feed.name}`} onClick={() => task('正在删除', async () => { await storage.remove('feeds', feed.id); await refresh(); })}><Trash2 /></IconButton></div>)}{!feeds.length && <Empty icon={<Rss />} title="让好文章来找你" text="添加订阅地址，阅读网站提供的 RSS 或 Atom 内容。" />}{feedArticles.map((article, index) => <button className="article-row" key={index} onClick={() => setActiveArticle(article)}><h3>{article.title}</h3><p>{article.content.slice(0, 140)}</p></button>)}</div>}
      {tab === '我的' && <div className="my-page"><div className="profile"><BookOpen size={38} /><div><h2>阅读</h2><p>开卷有益 · 阅读自由</p></div></div><div className="stats-strip"><div><strong>{books.length}</strong><span>藏书</span></div><div><strong>{Math.floor(records.reduce((n, r) => n + r.seconds, 0) / 60)}</strong><span>阅读分钟</span></div><div><strong>{books.filter(b => b.finished).length}</strong><span>已读</span></div></div>
        <button className="setting-row" onClick={() => setPanel('sources')}><Library /><span>书源管理<small>{sources.length} 个书源</small></span><ChevronRight /></button>
        <button className="setting-row" onClick={() => setPanel('stats')}><Clock3 /><span>阅读记录<small>时间轴与章节记录</small></span><ChevronRight /></button>
        <button className="setting-row" onClick={() => setPanel('settings')}><SlidersHorizontal /><span>阅读设置<small>字体、排版与翻页</small></span><ChevronRight /></button>
        <button className="setting-row" onClick={() => savePrefs({ ...prefs, dark: !prefs.dark })}>{prefs.dark ? <Sun /> : <Moon />}<span>{prefs.dark ? '日间模式' : '夜间模式'}</span><span className="switch" data-on={prefs.dark} /></button>
        <button className="setting-row" onClick={() => task('正在导出备份', async () => { if (await saveFile(`legado-backup-${new Date().toISOString().slice(0, 10)}.json`, await storage.backup())) notify('备份已导出'); })}><Upload /><span>备份<small>书籍、进度、书源与阅读设置</small></span><ChevronRight /></button>
        <button className="setting-row" onClick={() => task('正在恢复备份', async () => { const files = await pickFiles(['json']); if (files[0]) { await storage.restore(decodeText(files[0].bytes)); await refresh(); notify('已恢复备份'); } })}><Download /><span>恢复备份<small>按标识合并，保留其他书籍</small></span><ChevronRight /></button>
        <button className="setting-row" onClick={() => setPanel('about')}><BookOpen /><span>关于阅读<small>{VERSION}</small></span><ChevronRight /></button>
      </div>}
    </main>
    <nav className="bottom-nav" aria-label="主导航">{(['书架', '发现', '订阅', '我的'] as Tab[]).map(name => { const Icon = icons[name]; return <button aria-label={name} aria-current={tab === name ? 'page' : undefined} title={name} key={name} className={tab === name ? 'selected' : ''} onClick={() => setTab(name)}><Icon strokeWidth={tab === name ? 2.4 : 1.8} /><span>{name}</span></button>; })}</nav>
    {panel === 'sources' && <Modal title="书源管理" close={closePanel} wide><div className="source-actions"><button className="outlined" onClick={() => task('导入书源', async () => { const files = await pickFiles(['json']); if (files[0]) await importSources(decodeText(files[0].bytes)); })}><FileText size={18} />本地导入</button><button className="outlined" onClick={() => task('导出书源', async () => { if (await saveFile('legado-sources.json', JSON.stringify(sources, null, 2))) notify('书源已导出'); })}><Upload size={18} />导出书源</button></div><form className="input-row" onSubmit={e => { e.preventDefault(); task('正在获取书源', async () => importSources((await fetchText({ url: sourceUrl })).body)); }}><input aria-label="书源链接" type="url" placeholder="粘贴书源 JSON 链接" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} required /><button className="primary" disabled={!!busy}>导入</button></form><details className="source-paste"><summary>粘贴书源 JSON</summary><textarea aria-label="书源 JSON" value={sourceText} onChange={e => setSourceText(e.target.value)} placeholder="支持 Legado 书源对象或数组" /><button className="primary" disabled={!sourceText || !!busy} onClick={() => task('导入书源', async () => importSources(sourceText))}>导入 JSON</button></details>
      <p className="subtle">支持文字书源的 CSS、XPath、JSONPath 规则。需要 JavaScript 扩展的书源会标明兼容状态。</p>{sources.map(source => <div className="source-row" key={source.bookSourceUrl}><label><input type="checkbox" checked={source.enabled !== false} onChange={e => task('保存书源', async () => { await storage.put('sources', source.bookSourceUrl, { ...source, enabled: e.target.checked }); await refresh(); })} /><span><strong>{source.bookSourceName}</strong><small>{source.bookSourceGroup || source.bookSourceUrl}</small><small className={sourceSupport(source) ? 'warning' : 'supported'}>{sourceSupport(source) || '标准文字规则'}</small></span></label><IconButton label={`删除书源 ${source.bookSourceName}`} onClick={() => task('删除书源', async () => { await storage.remove('sources', source.bookSourceUrl); await refresh(); })}><Trash2 size={19} /></IconButton></div>)}</Modal>}
    {panel === 'search' && <Modal title="搜索书籍" close={closePanel} wide><form className="input-row" onSubmit={e => { e.preventDefault(); search(); }}><input aria-label="书名或作者" placeholder="输入书名或作者" value={query} onChange={e => setQuery(e.target.value)} /><button className="primary" disabled={!!busy}><Search size={18} />搜索</button></form><p className="subtle">在 {sources.filter(s => s.enabled !== false).length} 个已启用书源中搜索</p>{results.map((result, index) => <button className="search-result" key={result.url + index} disabled={!!busy} onClick={() => addResult(result)}><Cover book={result} /><div><h3>{result.name}</h3><p>{result.author}</p><small>{result.sourceName}</small><p className="result-intro">{result.intro}</p></div><Plus size={20} /></button>)}{searchErrors.length > 0 && <details className="search-errors"><summary>{searchErrors.length} 个书源未完成搜索</summary>{searchErrors.map((error, i) => <p key={i}>{error}</p>)}</details>}{!sources.length && <button className="text-button" onClick={() => setPanel('sources')}>先添加书源</button>}</Modal>}
    {panel === 'settings' && <Modal title="阅读设置" close={closePanel}><ReaderSettings prefs={prefs} save={savePrefs} /></Modal>}
    {panel === 'stats' && <Modal title="阅读记录" close={closePanel} wide><div className="record-summary"><strong>{Math.floor(records.reduce((n, r) => n + r.seconds, 0) / 60)}</strong> 分钟 · {new Set(records.map(r => r.bookId)).size} 本书</div>{records.length ? [...records].sort((a, b) => b.started - a.started).map(record => <div className="record" key={record.id}><Clock3 size={17} /><div><small>{new Date(record.started).toLocaleString('zh-CN')}</small><h3>{record.bookName}</h3><p>{record.chapter} · {record.seconds < 60 ? `${record.seconds} 秒` : `${Math.floor(record.seconds / 60)} 分钟`}</p></div></div>) : <Empty icon={<Clock3 />} title="还没有阅读记录" text="打开一本书，开始记录阅读时光。" />}</Modal>}
    {panel === 'about' && <Modal title="关于阅读" close={closePanel}><div className="about"><BookOpen size={52} /><h2>阅读</h2><p>{VERSION}</p><p>沿用 Legado 的经典界面，加入阅读时间轴、智能分组、书籍备注与平板排版。</p><p>书库保存在本机，建议定期导出备份。</p><a href="https://github.com/suixincrazy/legado-tauri" target="_blank" rel="noreferrer">项目源码</a><p className="subtle">GPL-3.0-or-later · 致谢 LegadoTeam/legado 与 HapeLee/legado-with-MD3</p></div></Modal>}
    {selectedBook && <BookDetails book={selectedBook} close={() => setDetail(null)} save={saveBook} open={() => openBook(selectedBook)} remove={() => task('删除书籍', async () => { await storage.remove('books', selectedBook.id); setDetail(null); await refresh(); })} cache={() => task('正在缓存章节', async () => { const source = sources.find(s => s.bookSourceUrl === selectedBook.sourceUrl); if (!source) throw new Error('书源不存在'); const book = { ...selectedBook, chapters: selectedBook.chapters.map(c => ({ ...c })) }; let count = 0; for (const chapter of book.chapters) { if (chapter.content === undefined) { chapter.content = await loadChapter(chapter, source); count++; await saveBook({ ...book, chapters: [...book.chapters] }); setBusy(`已缓存 ${count} 章`); } } notify('全部章节已缓存'); })} />}
    {activeArticle && <Modal title={activeArticle.title} close={() => setActiveArticle(null)} wide><article className="rss-content">{activeArticle.content.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}</article>{/^https?:/.test(activeArticle.url) && <a href={activeArticle.url} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={15} /></a>}</Modal>}
    {readingBook && <Reader book={readingBook} source={sources.find(s => s.bookSourceUrl === readingBook.sourceUrl)} prefs={prefs} savePrefs={savePrefs} save={saveBook} close={() => { setReader(null); refresh(); }} notify={notify} />}
    {busy && <div className="busy" role="status"><span className="spinner" />{busy}</div>}{toast && <div className="toast" role="alert" onClick={() => setToast('')}>{toast}</div>}
  </div>;
}

function BookDetails({ book, close, save, open, remove, cache }: { book: Book; close: () => void; save: (book: Book) => Promise<void>; open: () => void; remove: () => void; cache: () => void }) {
  const [note, setNote] = useState(book.note); const [confirm, setConfirm] = useState(false);
  return <Modal title="书籍详情" close={close}><div className="detail-book"><Cover book={book} /><div><h2>{book.name}</h2><p>{book.author}</p><p>{book.chapters.length} 章 · {progress(book)}%</p><small>{book.kind.toUpperCase()} · 已缓存 {book.chapters.filter(c => c.content !== undefined).length} 章</small></div></div>{book.intro && <p>{book.intro}</p>}<label className="field">书籍备注<textarea aria-label="书籍备注" value={note} onChange={e => setNote(e.target.value)} onBlur={() => { if (note !== book.note) save({ ...book, note }); }} placeholder="记下这本书的想法…" /></label><div className="source-actions"><button className="primary" onClick={open}><BookOpen size={18} />继续阅读</button><button className="outlined" onClick={() => save({ ...book, finished: !book.finished, note })}><Check size={18} />{book.finished ? '标为未读完' : '标为已读'}</button>{book.kind === 'online' && <button className="outlined" onClick={cache}><Download size={18} />缓存全书</button>}</div><div className="danger-zone">{confirm ? <><p>删除《{book.name}》及其进度、书签？</p><button className="danger-button" onClick={remove}>确认删除</button><button className="text-button" onClick={() => setConfirm(false)}>取消</button></> : <button className="text-button danger" onClick={() => setConfirm(true)}><Trash2 size={17} />移出书架</button>}</div></Modal>;
}
function ReaderSettings({ prefs, save }: { prefs: Settings; save: (prefs: Settings) => void }) {
  return <div className="reader-settings"><label>字号 <output>{prefs.fontSize}</output><input aria-label="字号" type="range" min="14" max="36" step="1" value={prefs.fontSize} onChange={e => save({ ...prefs, fontSize: +e.target.value })} /></label><label>行距 <output>{prefs.lineHeight.toFixed(1)}</output><input aria-label="行距" type="range" min="1.3" max="2.6" step="0.1" value={prefs.lineHeight} onChange={e => save({ ...prefs, lineHeight: +e.target.value })} /></label><label>段距 <output>{prefs.paragraphSpace.toFixed(1)}</output><input aria-label="段距" type="range" min="0" max="2" step="0.1" value={prefs.paragraphSpace} onChange={e => save({ ...prefs, paragraphSpace: +e.target.value })} /></label><div className="option-row"><span>字体</span><select aria-label="字体" value={prefs.font} onChange={e => save({ ...prefs, font: e.target.value as Settings['font'] })}><option value="serif">宋体 / 系统衬线</option><option value="sans">系统黑体</option></select></div><div className="option-row"><span>翻页方式</span><select aria-label="翻页方式" value={prefs.pageMode} onChange={e => save({ ...prefs, pageMode: e.target.value as Settings['pageMode'] })}><option value="scroll">上下滚动</option><option value="pages">左右翻页</option></select></div><label className="option-row"><span>横屏双页（平板）</span><input type="checkbox" checked={prefs.twoPage} onChange={e => save({ ...prefs, twoPage: e.target.checked })} /></label><div className="theme-options">{(['paper', 'white', 'green', 'night'] as const).map((theme, i) => <button aria-label={['纸张', '纯白', '护眼', '夜读'][i]} aria-pressed={prefs.readerTheme === theme} className={`theme-swatch ${theme}`} key={theme} onClick={() => save({ ...prefs, readerTheme: theme })}>{prefs.readerTheme === theme ? <Check size={20} /> : '字'}</button>)}</div></div>;
}

function Reader({ book, source, prefs, savePrefs, save, close, notify }: { book: Book; source?: Source; prefs: Settings; savePrefs: (prefs: Settings) => void; save: (book: Book) => Promise<void>; close: () => void; notify: (text: string) => void }) {
  const [controls, setControls] = useState(true); const [drawer, setDrawer] = useState<'toc' | 'bookmarks' | 'settings' | null>(null);
  const [content, setContent] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false); const [pageInfo, setPageInfo] = useState({ current: 1, total: 1 });
  const viewport = useRef<HTMLDivElement>(null); const bookRef = useRef(book); bookRef.current = book;
  const offset = useRef(book.offset); const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const restorePending = useRef(true); const record = useRef<ReadingRecord | null>(null); const lastTick = useRef(0);
  const [retry, setRetry] = useState(0); const chapter = book.chapters[book.chapter];
  const persist = useCallback(() => save({ ...bookRef.current, offset: offset.current, lastRead: Date.now() }), [save]);
  useEffect(() => {
    let alive = true; const selected = bookRef.current; const selectedChapter = selected.chapters[selected.chapter];
    setError(''); setContent(''); setLoading(true); restorePending.current = true; offset.current = selected.offset;
    const load = async () => {
      if (!selectedChapter) throw new Error('此书没有章节');
      if (selectedChapter.content !== undefined) return selectedChapter.content;
      if (!source) throw new Error('该章节尚未缓存，请恢复对应书源');
      const text = await loadChapter(selectedChapter, source);
      if (alive) { const current = bookRef.current; await save({ ...current, chapters: current.chapters.map((c, i) => i === selected.chapter ? { ...c, content: text } : c) }); }
      return text;
    };
    load().then(text => { if (alive) setContent(text); }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [book.id, book.chapter, retry, source, save]);
  useEffect(() => {
    if (!content) return;
    const node = viewport.current; if (!node) return;
    const restore = () => {
      if (prefs.pageMode === 'pages') { const total = Math.max(1, Math.ceil(node.scrollWidth / node.clientWidth)); node.scrollLeft = Math.round(offset.current * (total - 1)) * node.clientWidth; setPageInfo({ current: Math.round(node.scrollLeft / node.clientWidth) + 1, total }); }
      else node.scrollTop = offset.current * Math.max(0, node.scrollHeight - node.clientHeight);
      restorePending.current = false;
    };
    restorePending.current = true; const frame = requestAnimationFrame(restore); const observer = new ResizeObserver(() => { restorePending.current = true; requestAnimationFrame(restore); }); observer.observe(node);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [content, prefs.fontSize, prefs.lineHeight, prefs.paragraphSpace, prefs.font, prefs.pageMode, prefs.twoPage]);
  useEffect(() => {
    record.current = { id: crypto.randomUUID(), bookId: book.id, bookName: book.name, chapter: chapter?.title || '', started: Date.now(), seconds: 0 }; lastTick.current = Date.now();
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
    await save({ ...current, chapter: index, offset: position, lastRead: Date.now() }); setDrawer(null);
  }, [save, notify]);
  const turn = useCallback((direction: number) => {
    const node = viewport.current; if (!node) return;
    if (prefsRef.current.pageMode === 'pages') {
      const next = node.scrollLeft + direction * node.clientWidth;
      if (next >= node.scrollWidth - 2) { navigate(bookRef.current.chapter + 1); return; }
      if (next < -2) { navigate(bookRef.current.chapter - 1, 1); return; }
      node.scrollTo({ left: next, behavior: 'smooth' });
    } else {
      if (direction > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 3) { navigate(bookRef.current.chapter + 1); return; }
      if (direction < 0 && node.scrollTop <= 1) { navigate(bookRef.current.chapter - 1, 1); return; }
      node.scrollBy({ top: direction * node.clientHeight * 0.85, behavior: 'smooth' });
    }
  }, [navigate]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (drawer || (event.target as HTMLElement).matches('input,textarea,select')) return; if (['ArrowRight', 'PageDown', 'ArrowDown', ' '].includes(event.key)) { event.preventDefault(); turn(1); } if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(event.key)) { event.preventDefault(); turn(-1); } if (event.key === 'Escape') { persist(); close(); } };
    document.addEventListener('keydown', key); let last = 0;
    const gamepad = setInterval(() => { if (document.hidden || drawer || !navigator.getGamepads) return; const pad = Array.from(navigator.getGamepads()).find(Boolean); if (!pad || Date.now() - last < 350) return; if (pad.buttons[13]?.pressed || pad.buttons[15]?.pressed || pad.axes[1] > 0.6) { turn(1); last = Date.now(); } else if (pad.buttons[12]?.pressed || pad.buttons[14]?.pressed || pad.axes[1] < -0.6) { turn(-1); last = Date.now(); } }, 80);
    return () => { document.removeEventListener('keydown', key); clearInterval(gamepad); };
  }, [turn, drawer, persist, close]);
  const onScroll = () => { if (restorePending.current) return; const node = viewport.current; if (!node) return; offset.current = prefs.pageMode === 'pages' ? node.scrollLeft / Math.max(1, node.scrollWidth - node.clientWidth) : node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight); offset.current = Math.max(0, Math.min(1, offset.current)); if (prefs.pageMode === 'pages') setPageInfo({ current: Math.round(node.scrollLeft / node.clientWidth) + 1, total: Math.max(1, Math.ceil(node.scrollWidth / node.clientWidth)) }); };
  const speak = () => {
    if (!('speechSynthesis' in window)) { notify('当前系统 WebView 不提供朗读能力'); return; }
    if (speaking) { speechSynthesis.cancel(); setSpeaking(false); return; }
    const paragraphs = content.split('\n').filter(Boolean); let index = Math.floor(offset.current * Math.max(0, paragraphs.length - 1));
    const next = () => { if (index >= paragraphs.length) { setSpeaking(false); return; } const utterance = new SpeechSynthesisUtterance(paragraphs[index++]); utterance.lang = 'zh-CN'; utterance.onend = next; utterance.onerror = () => { setSpeaking(false); notify('系统朗读不可用'); }; speechSynthesis.speak(utterance); };
    setSpeaking(true); next();
  };
  const addBookmark = async () => { await save({ ...bookRef.current, bookmarks: [...bookRef.current.bookmarks, { chapter: book.chapter, offset: offset.current, title: chapter.title, created: Date.now() }] }); notify('书签已添加'); };
  const exit = async () => { await persist(); close(); };
  const style = { '--read-font-size': `${prefs.fontSize}px`, '--read-line-height': prefs.lineHeight, '--paragraph-gap': `${prefs.paragraphSpace}em` } as CSSProperties;
  return <section className={`reader ${prefs.readerTheme} ${prefs.font} ${prefs.pageMode} ${prefs.twoPage ? 'two-page' : ''}`} style={style} aria-label={`正在阅读 ${book.name}`}>
    <header className={`reader-toolbar ${controls ? '' : 'hidden-controls'}`}><IconButton label="返回书架" onClick={exit}><ArrowLeft /></IconButton><span>{book.name}</span><IconButton label="添加书签" onClick={addBookmark}><Bookmark /></IconButton><IconButton label="阅读设置" onClick={() => setDrawer('settings')}><MoreVertical /></IconButton></header>
    <div className="reader-running-title"><span>{book.name}</span><span>{chapter?.title}</span></div>
    <div ref={viewport} className="reader-viewport" onScroll={onScroll} onClick={event => { if (window.getSelection()?.toString()) return; const rect = event.currentTarget.getBoundingClientRect(); const fraction = (event.clientX - rect.left) / rect.width; if (prefs.pageMode === 'pages' && (fraction < 0.23 || fraction > 0.77)) turn(fraction < 0.23 ? -1 : 1); else setControls(value => !value); }}>
      {loading ? <div className="reader-message" role="status">正在加载章节…</div> : error ? <div className="reader-message"><WifiOff /><p role="alert">{error}</p><button className="outlined" onClick={e => { e.stopPropagation(); setRetry(retry + 1); }}>重试</button></div> : <article className="chapter-body"><h1>{chapter?.title}</h1>{content.split('\n').filter(line => line.trim()).map((line, i) => <p key={i}>{line.trim()}</p>)}<div className="chapter-end">{book.chapter === book.chapters.length - 1 ? '全书完' : '本章完'}</div></article>}
    </div>
    <div className="reader-footer"><span>{book.chapter + 1} / {book.chapters.length} 章</span><button aria-label="显示阅读菜单" onClick={() => setControls(!controls)}>{prefs.pageMode === 'pages' ? `${pageInfo.current} / ${pageInfo.total} 页` : '轻点正文显示菜单'}</button><span>{Math.round((book.chapter + offset.current) / book.chapters.length * 100)}%</span></div>
    <div className={`reader-controls ${controls ? '' : 'hidden-controls'}`}><div className="chapter-navigation"><button disabled={book.chapter === 0} onClick={() => navigate(book.chapter - 1)}><ChevronLeft size={20} />上一章</button><input aria-label="章节进度" type="range" min="0" max={book.chapters.length - 1} value={book.chapter} onChange={e => navigate(+e.target.value)} /><button disabled={book.chapter === book.chapters.length - 1} onClick={() => navigate(book.chapter + 1)}>下一章<ChevronRight size={20} /></button></div><div className="reader-actions"><button onClick={() => setDrawer('toc')}><List />目录</button><button onClick={() => setDrawer('bookmarks')}><BookMarked />书签</button><button onClick={() => savePrefs({ ...prefs, readerTheme: prefs.readerTheme === 'night' ? 'paper' : 'night' })}><Moon />夜间</button><button onClick={speak}>{speaking ? <VolumeX /> : <Volume2 />}朗读</button><button onClick={() => setDrawer('settings')}><SlidersHorizontal />设置</button></div>{book.chapter === book.chapters.length - 1 && <button className="finish-book" onClick={async () => { await save({ ...bookRef.current, offset: offset.current, finished: true }); notify('已标记为读完'); }}><CheckCircle2 size={16} />标记全书已读</button>}</div>
    {drawer && <Modal title={drawer === 'toc' ? '目录' : drawer === 'bookmarks' ? '书签' : '阅读设置'} close={() => setDrawer(null)} wide={drawer === 'toc'}>{drawer === 'settings' ? <ReaderSettings prefs={prefs} save={savePrefs} /> : drawer === 'toc' ? <div className="toc-list">{book.chapters.map((c, i) => <button key={i} className={i === book.chapter ? 'current' : ''} onClick={() => navigate(i)}><span>{c.title}</span>{c.content !== undefined && <Check size={15} />}</button>)}</div> : book.bookmarks.length ? book.bookmarks.map((mark, i) => <div className="bookmark-row" key={mark.created}><button onClick={() => navigate(mark.chapter, mark.offset)}><Bookmark size={17} /><span>{mark.title}<small>{new Date(mark.created).toLocaleString('zh-CN')}</small></span></button><IconButton label="删除书签" onClick={() => save({ ...bookRef.current, bookmarks: bookRef.current.bookmarks.filter((_, j) => j !== i) })}><Trash2 size={18} /></IconButton></div>) : <p className="subtle">点击阅读页右上角书签图标，保存当前位置。</p>}</Modal>}
  </section>;
}
