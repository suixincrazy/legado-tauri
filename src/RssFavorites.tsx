import {useEffect,useRef,useState} from 'react';
import {Star,Trash2,History} from 'lucide-react';
import {RssArticleReader} from './RssArticleReader';
import {Modal,IconButton} from './ui';
import {all,removeRssFavorites,saveRssFavorite,type FavoriteRemoval} from './storage';
import {defaultFavoriteGroup,articleKey,sameArticle,type FeedArticle,type RssFavorite} from './rss-favorites';
import './rss-favorites.css';

export function RssArticleViews({list,article,open,closeList,notify,history,fromHistory=false}:{list:boolean;article:FeedArticle|null;open:(article:FeedArticle|null)=>void;closeList:()=>void;notify:(text:string)=>void;history?:()=>void;fromHistory?:boolean}){
  const [rows,setRows]=useState<RssFavorite[]|null>(null),[loadError,setLoadError]=useState('');
  const [group,setGroup]=useState(''),[edit,setEdit]=useState<{title:string;group:string}|null>(null);
  const [removal,setRemoval]=useState<{target:FavoriteRemoval;label:string}|null>(null);
  const writing=useRef(false),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;all<RssFavorite>('rssFavorites').then(result=>{if(active)setRows(result);},error=>{if(active)setLoadError(String(error));});return()=>{active=false;};},[]);
  const saved=article&&rows?.find(row=>sameArticle(row,article));
  const groups=[...new Set(rows?.map(row=>row.group))].sort((a,b)=>a.localeCompare(b));
  const selected=groups.includes(group)?group:groups[0];
  const visible=rows?.filter(row=>row.group===selected).sort((a,b)=>b.savedAt-a.savedAt);
  async function change(work:()=>Promise<void>,done:()=>void){
    if(writing.current)return;writing.current=true;setBusy(true);
    try{await work();setRows(await all<RssFavorite>('rssFavorites'));done();}catch(error){notify(String(error));}
    finally{writing.current=false;setBusy(false);}
  }
  function configure(){
    if(!article||!article.url||!rows)return;
    if(saved){setEdit({title:saved.title,group:saved.group});return;}
    void change(()=>saveRssFavorite(article),()=>setEdit({title:article.title,group:defaultFavoriteGroup}));
  }
  function confirmRemoval(){
    if(!removal)return;
    void change(()=>removeRssFavorites(removal.target),()=>{setRemoval(null);setEdit(null);if(list&&article)open(null);notify('已取消收藏');});
  }
  return <>
    {list&&<Modal title="文章收藏" close={closeList} wide bodyClassName="rss-favorites">
      {rows===null?<p>{loadError||'正在读取收藏'}</p>:!rows.length?<div className="legado-empty">暂无收藏文章</div>:<>
        <div className="favorite-controls"><label>分组 <select aria-label="收藏分组" value={selected} onChange={e=>setGroup(e.target.value)}>{groups.map(name=><option key={name}>{name}</option>)}</select></label><button onClick={()=>setRemoval({target:{group:selected},label:'分组「'+selected+'」中的全部收藏'})}>删除本组</button><button onClick={()=>setRemoval({target:'all',label:'全部文章收藏'})}>删除全部</button></div>
        {visible?.map(row=><div key={JSON.stringify(articleKey(row))} className="source-row"><button onClick={()=>open(row)}><span><strong>{row.title}</strong><small>{row.sourceName}</small></span></button><IconButton label={'移除收藏 '+row.title} onClick={()=>setRemoval({target:{article:row},label:'「'+row.title+'」'})}><Trash2/></IconButton></div>)}
      </>}
    </Modal>}
    {article&&<RssArticleReader key={JSON.stringify(articleKey(article))} article={article} title={fromHistory?article.title:saved?.title||article.title} close={()=>open(null)} notify={notify} loadError={loadError} actions={<>
      {history&&<IconButton label="本来源历史" onClick={history}><History/></IconButton>}
      <IconButton label={saved?'编辑收藏':'收藏文章'} disabled={!rows||!article.url||busy} onClick={configure}><Star fill={saved?'currentColor':'none'}/></IconButton>
    </>}/>}
    {article&&edit&&<Modal title="编辑文章收藏" close={()=>setEdit(null)} page={false} centered><form className="favorite-form" onSubmit={e=>{e.preventDefault();void change(()=>saveRssFavorite(article,edit),()=>{setGroup(edit.group.trim()||saved?.group||defaultFavoriteGroup);setEdit(null);});}}>
      <label>标题<input value={edit.title} onChange={e=>setEdit({...edit,title:e.target.value})}/></label>
      <label>分组<input list="rss-favorite-groups" value={edit.group} onChange={e=>setEdit({...edit,group:e.target.value})}/></label>
      <datalist id="rss-favorite-groups">{groups.map(name=><option key={name} value={name}/>)}</datalist>
      <div className="favorite-controls"><button type="button" className="danger" disabled={busy} onClick={()=>setRemoval({target:{article},label:'「'+(saved?.title||article.title)+'」'})}>取消收藏</button><button type="button" onClick={()=>setEdit(null)}>关闭</button><button className="primary" disabled={busy}>保存</button></div>
    </form></Modal>}
    {removal&&<Modal title="确认删除" page={false} centered close={()=>setRemoval(null)}><p>确定移除{removal.label}？</p><div className="favorite-controls"><button disabled={busy} onClick={()=>setRemoval(null)}>保留</button><button className="danger-button" disabled={busy} onClick={confirmRemoval}>确认删除</button></div></Modal>}
  </>;
}
