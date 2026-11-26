import {useEffect,useRef,useState} from 'react';
import type {Book,Settings} from './model';
import type {ReplaceRule} from './replacement';
import * as storage from './storage';
import {readerSearchLimit,searchCachedContent,type ReaderSearchOrigin,type ReaderSearchProgress,type ReaderSearchResult,type ReaderSearchScope} from './reader-search';

const empty:ReaderSearchProgress={results:[],searched:0,cached:0,limited:false,failedRules:0};
export function markSearchText(text:string,start:number,range:{start:number;end:number}) {
  const from=Math.max(0,range.start-start),to=Math.min(text.length,range.end-start);if(from>=to)return text;
  return <>{text.slice(0,from)}<mark className="reader-search-hit">{text.slice(from,to)}</mark>{text.slice(to)}</>;
}
export function ReaderSearch({book,prefs,origin,query,setQuery,jump}:{book:Book;prefs:Settings;origin:ReaderSearchOrigin;query:string;setQuery:(value:string)=>void;jump:(result:ReaderSearchResult)=>Promise<void>}) {
  const [scope,setScope]=useState<ReaderSearchScope>('all'),[ready,setReady]=useState(false),[state,setState]=useState(empty),[busy,setBusy]=useState(false),[stopped,setStopped]=useState(false),[error,setError]=useState(''),[opening,setOpening]=useState(false),[retry,setRetry]=useState(0);
  const controller=useRef<AbortController|null>(null),snapshot=useRef({book,prefs});snapshot.current={book,prefs};
  useEffect(()=>{let alive=true;storage.preference('contentSearchScope','all').then(value=>{if(alive){setScope(['all','down','up'].includes(value)?value as ReaderSearchScope:'all');setReady(true);}}).catch(error=>{if(alive){setError(String(error));setReady(true);}});return()=>{alive=false;};},[]);
  useEffect(()=>{
    if(!ready)return;
    const abort=new AbortController();controller.current=abort;
    setState(empty);setError('');setStopped(false);setBusy(!!query.trim());
    const timer=setTimeout(()=>{
      if(abort.signal.aborted||!query.trim())return;
      void storage.preference<ReplaceRule[]>('replaceRules',[]).then(rules=>searchCachedContent(snapshot.current.book,query,{scope,origin,prefs:snapshot.current.prefs,rules,signal:abort.signal,progress:value=>{if(!abort.signal.aborted)setState(value);}}))
        .catch(error=>{if(!abort.signal.aborted)setError(String(error));}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    },160);
    return()=>{clearTimeout(timer);abort.abort();};
  },[ready,query,scope,origin,book.id,book.chapters,book.name,book.sourceUrl,book.useReplaceRule,book.reSegment,prefs.chineseConversion,prefs.titleAlign,retry]);
  const stop=()=>{controller.current?.abort();setBusy(false);setStopped(true);};
  const selectScope=(next:ReaderSearchScope)=>{setScope(next);void storage.put('settings','contentSearchScope',next).catch(error=>setError(String(error)));};
  const open=async(result:ReaderSearchResult)=>{if(opening)return;setOpening(true);try{await jump(result);}catch(error){setError(String(error));}finally{setOpening(false);}};
  return <div className="reader-search">
    <form className="input-row" onSubmit={event=>{event.preventDefault();setRetry(value=>value+1);}}><input type="search" aria-label="正文搜索关键词" placeholder="搜索已缓存正文" value={query} onChange={event=>setQuery(event.target.value)}/><button className="text-button" type="submit">搜索</button></form>
    <div className="reader-search-options" role="group" aria-label="搜索范围">{([['all','全局'],['down','向下'],['up','向上']] as const).map(([value,label])=><button key={value} className="text-button" aria-pressed={scope===value} disabled={!ready} onClick={()=>selectScope(value)}>{label}</button>)}{busy&&<button className="text-button" onClick={stop}>停止</button>}</div>
    <p className="subtle">按当前阅读的替换、简繁和分段设置搜索已缓存正文，区分大小写。</p>
    <p role="status" className="reader-search-status">{busy?'正在搜索':stopped?'已停止':'搜索结果'} · {state.results.length} 处 · 已搜索 {state.searched}/{state.cached} 章{state.limited?` · 最多显示 ${readerSearchLimit} 处，请缩小范围或修改关键词`:''}</p>
    {state.failedRules>0&&<p role="alert">有替换规则执行失败，已跳过失败规则。</p>}{error&&<p role="alert">{error}</p>}
    {state.results.map(result=><button key={result.chapter+':'+result.start} className="article-row reader-search-result" disabled={opening} onClick={()=>void open(result)}><h3>{result.title}</h3><p>{result.excerpt.slice(0,result.excerptStart)}<mark>{result.anchor.match}</mark>{result.excerpt.slice(result.excerptStart+result.anchor.match.length)}</p></button>)}
    {!!query.trim()&&!busy&&!state.results.length&&!error&&<div className="legado-empty">{stopped?'搜索已停止':'没有匹配的正文'}</div>}
  </div>;
}
