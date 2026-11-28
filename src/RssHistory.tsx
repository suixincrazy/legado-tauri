import {useEffect,useRef,useState} from 'react';
import {Modal} from './ui';
import {all,clearRssHistory} from './storage';
import type {HistorySource,RssHistoryRow} from './rss-history';
import {articleKey,type FeedArticle} from './rss-favorites';
import './rss-favorites.css';

export function RssHistory({scope,select,revision,enabled,toggle,open,close,notify}:{scope:HistorySource;select:(scope:HistorySource)=>void;revision:number;enabled:boolean;toggle:(enabled:boolean)=>void;open:(article:FeedArticle)=>void;close:()=>void;notify:(text:string)=>void}){
  const [rows,setRows]=useState<RssHistoryRow[]|null>(null),[error,setError]=useState('');
  const [removal,setRemoval]=useState<{source:string;name:string;count:number}|null>(null);
  const writing=useRef(false),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;all<RssHistoryRow>('rssHistory').then(result=>{if(active){setRows(result);setError('');}},reason=>{if(active)setError(String(reason));});return()=>{active=false;};},[revision]);
  const sources=new Map([scope,...rows||[]].filter(row=>row.sourceUrl).map(row=>[row.sourceUrl,row.sourceName]));
  const visible=rows?.filter(row=>!scope.sourceUrl||row.sourceUrl===scope.sourceUrl).sort((a,b)=>b.readAt-a.readAt||JSON.stringify(articleKey(a)).localeCompare(JSON.stringify(articleKey(b))));
  async function clear(){
    if(!removal||writing.current)return;writing.current=true;setBusy(true);
    try{await clearRssHistory(removal.source);setRows(await all<RssHistoryRow>('rssHistory'));setRemoval(null);notify('已清空订阅历史');}catch(reason){notify(String(reason));}finally{writing.current=false;setBusy(false);}
  }
  return <>
    <Modal title="订阅阅读历史" close={close} wide bodyClassName="rss-history">
      <div className="favorite-controls"><label><input type="checkbox" role="switch" checked={enabled} onChange={e=>toggle(e.target.checked)}/> 记录阅读历史</label></div>
      <div className="favorite-controls"><label>来源 <select aria-label="历史来源" value={scope.sourceUrl} onChange={e=>select({sourceUrl:e.target.value,sourceName:sources.get(e.target.value)||''})}><option value="">全部来源</option>{[...sources].map(([url,name])=><option key={url} value={url}>{name}</option>)}</select></label><button disabled={!visible?.length||busy} onClick={()=>setRemoval({source:scope.sourceUrl,name:scope.sourceUrl?scope.sourceName:'全部来源',count:visible!.length})}>清空历史</button></div>
      {error&&<p role="alert">{error}</p>}
      {rows===null?<p>{!error&&'正在读取历史'}</p>:!visible?.length?<div className="legado-empty">暂无阅读历史</div>:visible.map(row=><div className="source-row" key={JSON.stringify(articleKey(row))}><button onClick={()=>open(row)}><span><strong>{row.title}</strong><small>{row.sourceName} · <time dateTime={new Date(row.readAt).toISOString()}>{new Date(row.readAt).toLocaleString()}</time></small></span></button></div>)}
    </Modal>
    {removal&&<Modal title="确认清空历史" page={false} centered close={()=>setRemoval(null)}><p>清空{removal.name}的 {removal.count} 条阅读历史？</p><div className="favorite-controls"><button disabled={busy} onClick={()=>setRemoval(null)}>保留</button><button className="danger-button" disabled={busy} onClick={()=>void clear()}>确认清空</button></div></Modal>}
  </>;
}
