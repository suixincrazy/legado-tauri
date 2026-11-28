import {useEffect,useRef,useState,type ReactNode} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {ExternalLink,Share2} from 'lucide-react';
import {Modal,IconButton} from './ui';
import {shareText} from './sharing';
import {writeClipboardText} from './clipboard';
import {httpUrl,type FeedArticle} from './rss-favorites';

export function RssArticleReader({article,title,actions,close,notify,loadError}:{article:FeedArticle;title:string;actions:ReactNode;close:()=>void;notify:(text:string)=>void;loadError:string}){
  const link=httpUrl(article.url);
  const [preview,setPreview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function share(){
    if(!link||pending.current)return;
    setError('');
    if(!isTauri()&&typeof navigator.share!=='function'){setPreview(true);return;}
    pending.current=true;setBusy(true);
    try{await shareText(link,'分享文章链接');}
    catch{if(mounted.current){setError('系统分享未能打开。');setPreview(true);}}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  async function copy(){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try{await writeClipboardText(link);if(mounted.current)notify('文章链接已复制');}
    catch{if(mounted.current)setError('复制失败，请选中下方链接手动复制。');}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  return <>
    <Modal title={title} close={close} wide bodyClassName="rss-article" actions={<>
      <IconButton label="分享文章链接" disabled={!link||busy} onClick={()=>void share()}><Share2/></IconButton>{actions}
    </>}>
      <small className="subtle">{article.sourceName}</small>
      <article className="rss-content">{article.content.split('\n').filter(Boolean).map((line,i)=><p key={i}>{line}</p>)}</article>
      {link?<a href={link} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={15}/></a>:<p className="subtle">没有可收藏或分享的文章地址</p>}
      {loadError&&<p role="alert">{loadError}</p>}
    </Modal>
    {preview&&<Modal title="分享文章链接" page={false} centered close={()=>setPreview(false)} bodyClassName="rss-share">
      <p>{title}</p><p>可复制下方文章链接。</p>
      <label className="field">文章链接<textarea aria-label="文章链接" readOnly rows={4} value={link}/></label>
      {error&&<p role="alert">{error}</p>}
      <div className="favorite-controls"><button onClick={()=>setPreview(false)}>取消</button><button className="primary" disabled={busy} onClick={()=>void copy()}>复制链接</button></div>
    </Modal>}
  </>;
}
