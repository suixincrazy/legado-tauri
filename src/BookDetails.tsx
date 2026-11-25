import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { BookSearch } from './BookSearch';
import { TxtTocManager } from './TxtTocManager';
import { Modal, Cover } from './ui';
import { LegadoIcon } from './LegadoIcon';
import { progress, type Book, type BookGroup, type Source, type SearchResult } from './model';
import { loadOnlineBook } from './sources';
import { saveFile } from './files';

export function BookDetails({book,sources,groups,inShelf,close,save,open,add,remove,cache,login,notify}:{
  book:Book;sources:Source[];groups:BookGroup[];inShelf:boolean;close:()=>void;save:(book:Book)=>Promise<void>;open:()=>void;add:()=>void;remove:()=>void;cache:()=>void;login:(source:Source)=>void;notify:(text:string)=>void;
}) {
  const [toolbar,setToolbar]=useState<HTMLElement|null>(null),[panel,setPanel]=useState(''),[menu,setMenu]=useState(false),[expanded,setExpanded]=useState(false),[busy,setBusy]=useState('');
  const [draft,setDraft]=useState(book),[variables,setVariables]=useState(''),[tocQuery,setTocQuery]=useState('');
  const source=sources.find(item=>item.bookSourceUrl===book.sourceUrl);
  useEffect(()=>{setToolbar(document.getElementById('detail-toolbar'));},[]);
  useEffect(()=>{
    const page=toolbar?.closest('[role="dialog"]');
    const back=(event:Event)=>{if(menu){setMenu(false);event.preventDefault();}else if(panel && !['change','toc','txtRules'].includes(panel)){setPanel('');event.preventDefault();}};
    page?.addEventListener('legado-page-back',back);return()=>page?.removeEventListener('legado-page-back',back);
  },[toolbar,menu,panel]);
  const run=async(label:string,action:()=>Promise<void>)=>{setBusy(label);try{await action();}catch(error){notify(String(error));}finally{setBusy('');}};
  const replaceSource=(result:SearchResult)=>run('正在读取目录',async()=>{
    const nextSource=sources.find(item=>item.bookSourceUrl===result.sourceUrl);if(!nextSource)throw new Error('找不到书源');
    const fresh=await loadOnlineBook(result,nextSource);
    const chapterIndex=(index:number)=>{const title=book.chapters[index]?.title;const found=fresh.chapters.findIndex(chapter=>chapter.title===title);return found<0?Math.min(index,fresh.chapters.length-1):found;};
    const chapters=fresh.chapters.map(chapter=>({...chapter,content:book.sourceUrl===result.sourceUrl?book.chapters.find(old=>old.url===chapter.url)?.content:undefined}));
    await save({...fresh,id:book.id,added:book.added,lastRead:book.lastRead,note:book.note,groups:book.groups,canUpdate:book.canUpdate,pinned:book.pinned,finished:book.finished,chapter:chapterIndex(book.chapter),offset:book.offset,chapters,bookmarks:book.bookmarks.map(mark=>({...mark,chapter:chapterIndex(mark.chapter)})),highlights:book.highlights?.map(mark=>({...mark,bookUrl:fresh.url||book.id,chapterIndex:chapterIndex(mark.chapterIndex),chapterUrl:chapters[chapterIndex(mark.chapterIndex)]?.url||''}))});setPanel('');
  });
  const copy=(text:string|undefined)=>run('正在复制',async()=>{if(!text)throw new Error('没有可复制的地址');await navigator.clipboard.writeText(text);notify('已复制');setMenu(false);});
  const edit=()=>{setDraft({...book});setMenu(false);setPanel('edit');};
  const download=()=>run('正在导出',async()=>{const text=book.chapters.map(chapter=>`${chapter.title}\n${chapter.content||''}`).join('\n\n');await saveFile(`${book.name.replace(/[\\/:*?"<>|]/g,'_')}.txt`,text);setMenu(false);});
  return <Modal title="书籍详情" close={close} toolbarId="detail-toolbar"><div className="book-detail-page">
    {toolbar&&createPortal(<><span className="source-manager-title">书籍详情</span><button className="icon-button" aria-label="编辑书籍信息" onClick={edit}><LegadoIcon name="ic_edit"/></button><button className="icon-button" aria-label="书籍详情菜单" onClick={()=>setMenu(!menu)}><LegadoIcon name="ic_more_vert"/></button></>,toolbar)}
    <div className="detail-hero" style={{'--detail-cover':`url("${(book.cover||'/legado/image_cover_default.jpg').replace(/"/g,'%22')}")`} as CSSProperties}><Cover book={book}/></div>
    <h2 className="detail-name">{book.name}</h2><div className="detail-metadata">
      <p><LegadoIcon name="ic_author" size={18}/><span>{book.author}</span></p>
      <p><LegadoIcon name="ic_web_outline" size={18}/><span>{source?.bookSourceName||book.kind.toUpperCase()}</span>{book.kind==='online'&&<button className="accent-label" onClick={()=>setPanel('change')}>换源</button>}</p>
      <p><LegadoIcon name="ic_book_last" size={18}/><span>{book.chapters[book.chapter]?.title} · {progress(book)}%</span></p>
      <p><LegadoIcon name="ic_groups" size={18}/><span>{groups.filter(group=>book.groups?.includes(group.id)).map(group=>group.name).join('、')||'未分组'}</span><button className="accent-label" onClick={()=>{setDraft({...book});setPanel('groups');}}>修改分组</button></p>
      <p><LegadoIcon name="ic_toc" size={18}/><span>{book.chapters.length} 章 · {book.chapters[book.chapters.length-1]?.title}</span><button className="accent-label" onClick={()=>setPanel('toc')}>查看目录</button></p>
    </div><div className={`detail-description ${expanded?'expanded':'collapsed'}`}>{book.intro||'暂无简介'}</div>{book.intro&&<button className="detail-expand" onClick={()=>setExpanded(!expanded)}>{expanded?'收起简介':'展开简介'}</button>}
    {book.note&&<div className="detail-description">{book.note}</div>}
    <div className="detail-bottom"><button onClick={()=>inShelf?setPanel('delete'):add()}>{inShelf?'移出书架':'加入书架'}</button><button className="detail-read" onClick={open}>阅读</button></div>
    {menu&&<><button className="source-panel-dismiss" aria-label="关闭书籍详情菜单" onClick={()=>setMenu(false)}/><div className="source-popup">{book.kind==='online'&&<><button disabled={!!busy} onClick={()=>{setMenu(false);void replaceSource({name:book.name,author:book.author,url:book.url!,sourceUrl:book.sourceUrl!,sourceName:source?.bookSourceName||'',variables:book.variables});}}>刷新</button>{source&&<button onClick={()=>{setMenu(false);login(source);}}>登录</button>}<button onClick={()=>{setMenu(false);cache();}}>缓存全书</button></>}<button onClick={()=>run('正在保存',async()=>{await save({...book,pinned:!book.pinned});setMenu(false);})}>{book.pinned?'取消置顶':'置顶'}</button><button onClick={()=>{setVariables(JSON.stringify(book.variables||{},null,2));setMenu(false);setPanel('variables');}}>设置书籍变量</button>{book.url&&<button onClick={()=>copy(book.url)}>复制书籍地址</button>}{book.tocUrl&&<button onClick={()=>copy(book.tocUrl)}>复制目录地址</button>}{book.kind==='online'&&<label><input type="checkbox" checked={book.canUpdate!==false} onChange={e=>run('正在保存',()=>save({...book,canUpdate:e.target.checked}))}/>允许更新</label>}{book.kind==='txt'&&<button onClick={()=>{setMenu(false);setPanel('txtRules');}}>TXT目录规则</button>}<button onClick={download}>导出已缓存正文</button>{book.kind==='online'&&<button onClick={()=>{setMenu(false);setPanel('clear');}}>清理缓存</button>}<button onClick={edit}>编辑书籍信息</button></div></>}
    {['edit','groups','variables','delete','clear'].includes(panel)&&<div className="dialog-overlay"><div className="material-dialog" role="dialog" aria-modal="true" aria-label={panel==='edit'?'编辑书籍信息':panel==='groups'?'修改分组':panel==='variables'?'设置书籍变量':panel==='delete'?'移出书架':'清理缓存'}><h3>{panel==='edit'?'编辑书籍信息':panel==='groups'?'修改分组':panel==='variables'?'设置书籍变量':panel==='delete'?'移出书架':'清理缓存'}</h3>
      {panel==='edit'?<>{([['name','书名'],['author','作者'],['cover','封面地址'],['intro','简介'],['note','书籍备注']] as const).map(([key,label])=><label className="field" key={key}>{label}<textarea aria-label={label} value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}</>:panel==='groups'?<>{groups.map(group=><label className="setting-row" key={group.id}><span>{group.name}</span><input type="checkbox" checked={draft.groups?.includes(group.id)||false} onChange={e=>setDraft({...draft,groups:e.target.checked?[...(draft.groups||[]),group.id]:(draft.groups||[]).filter(id=>id!==group.id)})}/></label>)}{!groups.length&&<p>请先在书架的分组管理中添加分组。</p>}</>:panel==='variables'?<textarea aria-label="书籍变量JSON" value={variables} onChange={e=>setVariables(e.target.value)}/>:<p>{panel==='delete'?`移出《${book.name}》并删除其本地进度和书签？`:'清理网络正文缓存？阅读进度和书签会保留。'}</p>}
      <footer><button onClick={()=>setPanel('')}>取消</button><button disabled={!!busy} onClick={()=>run('正在保存',async()=>{if(panel==='delete'){remove();return;}if(panel==='clear')await save({...book,chapters:book.chapters.map(chapter=>({...chapter,content:undefined}))});else if(panel==='variables'){const value=JSON.parse(variables);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('变量必须是 JSON 对象');await save({...book,variables:value});}else {if(!draft.name.trim())throw new Error('书名不能为空');await save(draft);}setPanel('');})}>确定</button></footer>
    </div></div>}
    {panel==='toc'&&<Modal title={book.name} close={()=>setPanel('')}><div className="input-row"><input aria-label="搜索目录" placeholder="搜索目录" value={tocQuery} onChange={e=>setTocQuery(e.target.value)}/></div><div className="toc-list">{book.chapters.map((chapter,index)=>({chapter,index})).filter(({chapter})=>chapter.title.includes(tocQuery)).map(({chapter,index})=><button key={index} className={index===book.chapter?'current':''} onClick={()=>run('正在打开',async()=>{await save({...book,chapter:index,offset:0});setPanel('');})}><span>{chapter.title}</span>{chapter.content!==undefined&&'✓'}</button>)}</div></Modal>}
    {panel==='change'&&<Modal title="换源" close={()=>setPanel('')} toolbarId="change-source-toolbar"><BookSearch sources={sources} books={[]} initialQuery={book.name} toolbarId="change-source-toolbar" manage={()=>setPanel('')} choose={replaceSource} open={()=>{}} notify={notify}/></Modal>}
    {panel==='txtRules'&&<Modal title="TXT目录规则" close={()=>setPanel('')} toolbarId="txt-rule-toolbar"><TxtTocManager notify={notify} book={book} saveBook={save} done={()=>setPanel('')}/></Modal>}
    {busy&&<div className="busy" role="status"><span className="spinner"/>{busy}</div>}
  </div></Modal>;
}
