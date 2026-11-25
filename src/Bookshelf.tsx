import { useEffect, useRef, type CSSProperties } from 'react';
import { Cover } from './ui';
import { LegadoIcon } from './LegadoIcon';
import { progress, type Book, type Settings } from './model';
import { unreadChapters } from './bookshelf-model';

function ShelfBook({book,prefs,open,detail,reorder}:{book:Book;prefs:Settings;open:()=>void;detail:()=>void;reorder:(from:string,to:string)=>void}) {
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),held=useRef(false),origin=useRef([0,0]);
  const stop=()=>clearTimeout(timer.current);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const unread=unreadChapters(book);
  return <article className="book" draggable={prefs.shelfSort==='manual'} onDragStart={event=>{event.dataTransfer.setData('text/legado-book',book.id);stop();}} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const from=event.dataTransfer.getData('text/legado-book');if(from)reorder(from,book.id);}}>
    <button className="book-open" aria-label={`阅读 ${book.name}`} onClick={()=>{if(!held.current)open();held.current=false;}} onPointerDown={event=>{if(event.button!==0)return;held.current=false;origin.current=[event.clientX,event.clientY];timer.current=setTimeout(()=>{held.current=true;detail();},500);}} onPointerUp={stop} onPointerCancel={stop} onPointerMove={event=>{if(Math.hypot(event.clientX-origin.current[0],event.clientY-origin.current[1])>10)stop();}} onContextMenu={event=>{event.preventDefault();stop();held.current=true;detail();}}>
      <div className="shelf-cover"><Cover book={book}/>{prefs.layout==='grid'&&prefs.shelfUnread&&unread>0&&<span className="shelf-unread">{unread}</span>}</div>
      <div className="book-meta"><h2>{book.name}{prefs.layout!=='grid'&&prefs.shelfUnread&&unread>0&&<small className="shelf-unread">{unread}</small>}</h2>{prefs.layout!=='grid'&&<><p className="shelf-author"><LegadoIcon name="ic_author" size={18}/><span>{book.author}</span>{prefs.layout==='compact'&&<><span>·</span><span>{book.chapters[book.chapter]?.title}</span></>}{prefs.shelfUpdateTime&&book.latestChapterTime&&<time>{new Date(book.latestChapterTime).toLocaleDateString()}</time>}</p>{prefs.layout!=='compact'&&<p><LegadoIcon name="ic_history" size={18}/><span>{book.chapters[book.chapter]?.title}</span></p>}<p><LegadoIcon name="ic_book_last" size={18}/><span>{book.chapters[book.chapters.length-1]?.title}</span>{prefs.shelfProgress>0&&<small>{progress(book)}%</small>}</p></>}{prefs.shelfProgress>0&&<div className="shelf-progress" style={{height:prefs.shelfProgress}}><span style={{width:`${progress(book)}%`}}/></div>}</div>
    </button>
  </article>;
}
export function Bookshelf({books,prefs,open,detail,reorder}:{books:Book[];prefs:Settings;open:(book:Book)=>void;detail:(book:Book)=>void;reorder:(from:string,to:string)=>void}) {
  return <div className={`bookshelf ${prefs.layout==='compact'?'list compact':prefs.layout} shelf-name-${prefs.shelfName}`} style={{'--shelf-margin':`${prefs.shelfMargin}px`} as CSSProperties}>{books.map(book=><ShelfBook key={book.id} book={book} prefs={prefs} open={()=>open(book)} detail={()=>detail(book)} reorder={reorder}/>)}</div>;
}
export function BookshelfSettings({prefs,save,close}:{prefs:Settings;save:(settings:Settings)=>void;close:()=>void}) {
  useEffect(()=>{const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();close();};const key=(event:KeyboardEvent)=>{if(event.key==='Escape')back(event);};window.addEventListener('legado-back',back,true);window.addEventListener('keydown',key);return()=>{window.removeEventListener('legado-back',back,true);window.removeEventListener('keydown',key);};},[close]);
  return <div className="dialog-overlay"><div className="material-dialog bookshelf-config" role="dialog" aria-modal="true" aria-label="书架布局"><h3>书架布局</h3>
    <label className="option-row">分组样式<select aria-label="分组样式" value={prefs.shelfGroupStyle} onChange={e=>save({...prefs,shelfGroupStyle:e.target.value as Settings['shelfGroupStyle']})}><option value="tabs">顶部标签</option><option value="folder">文件夹</option></select></label>
    <label className="option-row">阅读进度<select aria-label="阅读进度" value={prefs.shelfProgress} onChange={e=>save({...prefs,shelfProgress:+e.target.value as 0|2|4})}><option value={0}>隐藏</option><option value={2}>标准（2dp）</option><option value={4}>增强（4dp）</option></select></label>
    {([['shelfUnread','显示未读角标'],['shelfUpdateTime','显示更新时间'],['showShelfStatus','书架统计']] as const).map(([key,label])=><label className="option-row" key={key}>{label}<input type="checkbox" checked={prefs[key]} onChange={e=>save({...prefs,[key]:e.target.checked})}/></label>)}
    <div className="shelf-config-columns"><fieldset><legend>布局</legend>{['列表','紧凑列表','两列','三列','四列','五列','六列'].map((label,index)=><label key={label}><input type="radio" name="shelf-layout" checked={index===0?prefs.layout==='list':index===1?prefs.layout==='compact':prefs.layout==='grid'&&prefs.shelfColumns===index} onChange={()=>save({...prefs,layout:index===0?'list':index===1?'compact':'grid',shelfColumns:index>=2?index:prefs.shelfColumns})}/>{label}</label>)}</fieldset><fieldset><legend>排序</legend>{([['recent','最近阅读'],['updated','更新时间'],['name','书名'],['manual','手动排序'],['combined','综合排序'],['author','作者']] as const).map(([value,label])=><label key={value}><input type="radio" name="shelf-sort" checked={prefs.shelfSort===value} onChange={()=>save({...prefs,shelfSort:value})}/>{label}</label>)}</fieldset></div>
    <fieldset className="shelf-name-options"><legend>书名</legend>{([['show','显示'],['hide','隐藏'],['overlay','覆盖']] as const).map(([value,label])=><label key={value}><input type="radio" name="shelf-name" checked={prefs.shelfName===value} onChange={()=>save({...prefs,shelfName:value})}/>{label}</label>)}</fieldset>
    <label className="option-row">边距 {prefs.shelfMargin}<input aria-label="书架边距" type="range" min={0} max={60} value={prefs.shelfMargin} onChange={e=>save({...prefs,shelfMargin:+e.target.value})}/></label><label className="option-row">阅读状态分组<input type="checkbox" checked={prefs.shelfSmartGroups} onChange={e=>save({...prefs,shelfSmartGroups:e.target.checked})}/></label><footer><button onClick={close}>确定</button></footer>
  </div></div>;
}
