import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Book, SearchResult, Source } from './model';
import { LegadoIcon } from './LegadoIcon';
import { searchSource } from './sources';
import { sourceGroups, safeSourceError } from './source-management';
import { defaultSearchOptions, groupSearchResults, mergeSearchResults, searchSources, type SearchOptions } from './search-model';
import * as storage from './storage';

export function BookSearch({ sources, books, target, exploreUrl, manage, choose, open, notify }: {
  sources: Source[]; books: Book[]; target?: Source | null; exploreUrl?: string;
  manage: () => void; choose: (result: SearchResult) => void; open: (book: Book) => void; notify: (text: string) => void;
}) {
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState(''), [searched, setSearched] = useState('');
  const [history, setHistory] = useState<string[]>([]), [options, setOptions] = useState<SearchOptions>(defaultSearchOptions);
  const [results, setResults] = useState<SearchResult[]>([]), [errors, setErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false), [finished, setFinished] = useState(0), [total, setTotal] = useState(0);
  const [page, setPage] = useState(0), [hasMore, setHasMore] = useState(false), [inputHelp, setInputHelp] = useState(true);
  const [popup, setPopup] = useState(''), [origins, setOrigins] = useState<SearchResult[]>([]);
  const [scopeDraft, setScopeDraft] = useState(options), [filterDraft, setFilterDraft] = useState('');
  const generation = useRef(0), rows = useRef<SearchResult[]>([]), exhausted = useRef(new Set<string>());
  const requestSources = useRef<Source[]>([]);
  const sourcePages = useRef(new Map<string,number>());
  useEffect(() => {
    setToolbar(document.getElementById('search-toolbar'));
    storage.preference<string[]>('searchHistory', []).then(setHistory);
    storage.preference<SearchOptions>('searchOptions', defaultSearchOptions).then(value=>setOptions({...defaultSearchOptions,...value}));
    return () => { generation.current++; };
  }, []);
  const configure = (next: SearchOptions) => { setOptions(next); storage.put('settings', 'searchOptions', next).catch(error=>notify(String(error))); };
  const stop = () => { generation.current++; setRunning(false); setHasMore(requestSources.current.some(s=>!exhausted.current.has(s.bookSourceUrl))); };
  useEffect(() => {
    const dialog = toolbar?.closest('[role="dialog"]');
    const back = (event: Event) => {
      if (origins.length) setOrigins([]);
      else if (popup) setPopup('');
      else if (inputHelp && page) setInputHelp(false);
      else return;
      event.preventDefault();
    };
    dialog?.addEventListener('legado-page-back',back);
    return ()=>dialog?.removeEventListener('legado-page-back',back);
  },[toolbar,origins,popup,inputHelp,page]);
  const run = async (word = query, more = false) => {
    const key = word.trim();
    if (!key && exploreUrl === undefined) return;
    const enabled = more ? requestSources.current.filter(s=>!exhausted.current.has(s.bookSourceUrl)) : searchSources(sources, options, target);
    if (!enabled.length) { notify('搜索范围内没有可用书源'); return; }
    const token = ++generation.current, nextPage = more ? page + 1 : 1;
    if (!more) {
      requestSources.current = enabled; exhausted.current.clear(); sourcePages.current.clear(); rows.current = []; setResults([]); setErrors([]); setSearched(key);
      if (key) { const next = [key,...history.filter(item=>item!==key)].slice(0,50); setHistory(next); storage.put('settings','searchHistory',next).catch(error=>notify(String(error))); }
    }
    setQuery(key); setPage(nextPage); setInputHelp(false); setPopup(''); setRunning(true); setFinished(0); setTotal(enabled.length); setHasMore(false);
    let index = 0;
    const worker = async () => {
      while (index < enabled.length && token === generation.current) {
        const source = enabled[index++];
        try {
          const sourcePage = sourcePages.current.get(source.bookSourceUrl) || 1;
          const items = await searchSource(source,key,exploreUrl !== undefined,exploreUrl,sourcePage);
          if (token !== generation.current) return;
          sourcePages.current.set(source.bookSourceUrl,sourcePage+1);
          const merged = mergeSearchResults(rows.current, items);
          if (!items.length || merged.length === rows.current.length) exhausted.current.add(source.bookSourceUrl);
          rows.current = merged; setResults(merged);
        } catch (error) {
          if (token !== generation.current) return;
          setErrors(old=>[...old,`${source.bookSourceName}：${safeSourceError(error)}`]);
        }
        if (token === generation.current) setFinished(value=>value+1);
      }
    };
    await Promise.all(Array.from({length:Math.min(4,enabled.length)},worker));
    if (token !== generation.current) return;
    setRunning(false); setHasMore(enabled.some(source=>!exhausted.current.has(source.bookSourceUrl)));
  };
  const initialExplore = useRef(false);
  useEffect(()=>{if(exploreUrl !== undefined && !initialExplore.current){initialExplore.current=true;void run('',false);}},[exploreUrl]);
  const grouped = groupSearchResults(results,searched,options);
  const groups = [...new Set(sources.flatMap(sourceGroups))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const local = query.trim() ? books.filter(book=>`${book.name}\n${book.author}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
  const toggleScope = (value: string) => setScopeDraft(old=>({...old,selected:old.selected.includes(value)?old.selected.filter(item=>item!==value):[...old.selected,value]}));
  return <div className="book-search-page">
    {toolbar && createPortal(<><form className="source-toolbar-search search-toolbar-form" onSubmit={event=>{event.preventDefault();void run();}}><input aria-label="书名或作者" placeholder={target ? target.bookSourceName : '搜索'} value={query} onFocus={()=>setInputHelp(true)} onChange={event=>{setQuery(event.target.value);setInputHelp(true);}} enterKeyHint="search"/><button type="submit" aria-label="开始搜索"><LegadoIcon name="ic_search" size={20}/></button></form><button className="icon-button" aria-label="搜索菜单" onClick={()=>setPopup(popup==='menu'?'':'menu')}><LegadoIcon name="ic_more_vert"/></button></>,toolbar)}
    {running && <div className="search-progress" role="progressbar" aria-label="搜索进度" aria-valuenow={finished} aria-valuemax={total}><span style={{width:`${finished/Math.max(1,total)*100}%`}}/></div>}
    {popup === 'menu' && <><button className="source-panel-dismiss" aria-label="关闭搜索菜单" onClick={()=>setPopup('')}/><div className="source-popup"><label><input type="checkbox" checked={options.precise} onChange={e=>configure({...options,precise:e.target.checked})}/>精准搜索</label><label><input type="checkbox" checked={options.markRead} onChange={e=>configure({...options,markRead:e.target.checked})}/>标记已读书籍</label><button onClick={()=>{setFilterDraft(options.exclusions);setPopup('filter');}}>搜索结果屏蔽</button><button onClick={manage}>书源管理</button><button onClick={()=>{setScopeDraft(options);setPopup('scope');}}>分组或书源</button><button onClick={()=>setPopup('log')}>日志</button></div></>}
    {inputHelp && exploreUrl === undefined ? <div className="search-help">{local.length>0 && <><h3>书架</h3>{local.map(book=><button className="history-item" key={book.id} onClick={()=>open(book)}><LegadoIcon name="ic_bottom_books_e" size={18}/><span>{book.name}<small>{book.author}</small></span></button>)}</>}<header><h3>搜索历史</h3><button onClick={()=>{setHistory([]);storage.put('settings','searchHistory',[]).catch(error=>notify(String(error)));}}>清空</button></header>{history.map(word=><div className="history-row" key={word}><button className="history-item" onClick={()=>void run(word)}><LegadoIcon name="ic_history" size={18}/><span>{word}</span></button><button className="icon-button" aria-label={`删除搜索历史 ${word}`} onClick={()=>{const next=history.filter(item=>item!==word);setHistory(next);storage.put('settings','searchHistory',next).catch(error=>notify(String(error)));}}>×</button></div>)}</div> : <>
      {grouped.map(items=>{const result=items[0];const shelf=books.find(book=>book.name===result.name && book.author===result.author);return <button className="original-search-result" key={JSON.stringify([result.name,result.author])} onClick={()=>items.length>1?setOrigins(items):choose(result)}><div className="search-cover" style={{backgroundImage:`url('/legado/image_cover_default.jpg')`}}>{result.cover && <img src={result.cover} alt="" onError={e=>e.currentTarget.style.display='none'}/>}</div><div className="search-result-info"><h3>{shelf && <i className={shelf.lastRead && options.markRead?'read-dot':'shelf-dot'}/>}<span>{result.name}</span><small className="origin-badge">{items.length}</small></h3><p>{result.author}</p><div className="search-labels">{[result.sourceName,...(result.category||'').split(/[,，]/)].filter(Boolean).map((label,index)=><span key={index}>{label}</span>)}</div>{result.latestChapterTitle && <p>{result.latestChapterTitle}</p>}<p className="search-intro">{result.intro}</p></div></button>;})}
      {!running && page>0 && !grouped.length && <div className="legado-empty">没有搜索到书籍</div>}
      {hasMore && !running && <button className="search-load-more" onClick={()=>void run(searched,true)}>加载下一页</button>}
      {errors.length>0 && <button className="search-error-link" onClick={()=>setPopup('log')}>{errors.length} 个书源搜索失败，查看日志</button>}
    </>}
    {running && <div className="search-stop"><small>{finished}/{total}</small><button aria-label="停止搜索" onClick={stop}><span/></button></div>}
    {['scope','filter','log'].includes(popup) && <div className="dialog-overlay"><div className="material-dialog search-dialog" role="dialog" aria-modal="true" aria-label={popup==='scope'?'搜索范围':popup==='filter'?'搜索结果屏蔽':'日志'}><h3>{popup==='scope'?'搜索范围':popup==='filter'?'搜索结果屏蔽':'日志'}</h3>{popup==='scope'?<><nav className="toc-tabs">{(['groups','sources'] as const).map(value=><button key={value} className={scopeDraft.scope===value?'selected':''} onClick={()=>setScopeDraft({...scopeDraft,scope:value,selected:[]})}>{value==='groups'?'分组':'书源'}</button>)}</nav><div className="search-scope-list">{(scopeDraft.scope==='sources'?sources.filter(source=>source.enabled!==false).map(s=>[s.bookSourceUrl,s.bookSourceName]):groups.map(group=>[group,group])).map(([id,name])=><label key={id}><input type="checkbox" checked={scopeDraft.selected.includes(id)} onChange={()=>toggleScope(id)}/>{name}</label>)}</div></>:popup==='filter'?<><p>每行一个关键词，匹配书名、作者或分类，忽略大小写</p><textarea aria-label="屏蔽关键词" value={filterDraft} onChange={e=>setFilterDraft(e.target.value)}/></>:<pre className="source-check-log">{errors.join('\n')||'没有搜索错误'}</pre>}<footer>{popup==='scope' && <button onClick={()=>{configure({...options,scope:'all',selected:[]});setPopup('');}}>全部书源</button>}<button onClick={()=>setPopup('')}>{popup==='log'?'关闭':'取消'}</button>{popup!=='log' && <button onClick={()=>{configure(popup==='scope'?scopeDraft:{...options,exclusions:filterDraft});setPopup('');}}>确定</button>}</footer></div></div>}
    {origins.length>0 && <div className="dialog-overlay"><div className="material-dialog" role="dialog" aria-modal="true" aria-label="选择书源"><h3>{origins[0].name}</h3>{origins.map(item=><button className="setting-row" key={JSON.stringify([item.sourceUrl,item.url])} onClick={()=>{setOrigins([]);choose(item);}}><span>{item.sourceName}<small>{item.latestChapterTitle}</small></span></button>)}<footer><button onClick={()=>setOrigins([])}>取消</button></footer></div></div>}
  </div>;
}
