import { useState } from 'react';
import { type Book, type BookGroup } from './model';
import {newBookGroupId} from './legacy-book-groups';
import { LegadoIcon } from './LegadoIcon';
import {groupBookSort,groupOnlyUpdateRead,isUserBookGroup,shelfSortOptions} from './bookshelf-model';

export function GroupManager({ groups, save }: { groups: BookGroup[]; save: (groups: BookGroup[], removed?: string) => Promise<void> }) {
  const [name, setName] = useState(''), [editing, setEditing] = useState(''), [error, setError] = useState('');
  const [sort,setSort]=useState(-1),[onlyRead,setOnlyRead]=useState(false);
  const reset=()=>{setName('');setEditing('');setSort(-1);setOnlyRead(false);setError('');};
  const run = async (next: BookGroup[], removed?: string) => { try { await save(next, removed); setError(''); } catch (e) { setError(String(e)); } };
  return <div><form className="group-editor" onSubmit={async e => {
    e.preventDefault();const value=name.trim();if(!value)return;
    if(groups.some(g=>g.id!==editing&&g.name===value)){setError('分组名称已存在');return;}
    const next=editing?groups.map(g=>g.id===editing?{...g,name:value,bookSort:sort,onlyUpdateRead:onlyRead}:g):[...groups,{id:newBookGroupId(groups),name:value,order:groups.length,show:true,enableRefresh:true,bookSort:sort,onlyUpdateRead:onlyRead}];
    try{await save(next);reset();}catch(e){setError(String(e));}
  }}><input aria-label="分组名称" placeholder="分组名称" value={name} onChange={e=>setName(e.target.value)} required/>
    <label>书籍排序<select value={sort} onChange={e=>setSort(Number(e.target.value))}><option value={-1}>默认（跟随书架）</option>{shelfSortOptions.map(([key,label],i)=><option key={key} value={i}>{label}</option>)}</select></label>
    <label><input type="checkbox" checked={onlyRead} onChange={e=>setOnlyRead(e.target.checked)}/>只更新已读</label>
    <div>{editing&&<button type="button" className="text-button" onClick={reset}>取消</button>}<button className="text-button">{editing?'保存':'新建'}</button></div></form>{error&&<p role="alert">{error}</p>}
    {groups.map((group,index) => <div className="book-group-row" key={group.id}><button onClick={() => { setEditing(group.id); setName(group.name);setSort(groupBookSort(group));setOnlyRead(groupOnlyUpdateRead(group));setError(''); }}>{group.name}</button><label><input type="checkbox" checked={group.show} onChange={e => run(groups.map(g => g.id === group.id ? { ...g, show:e.target.checked } : g))} />显示</label><label><input type="checkbox" checked={group.enableRefresh} onChange={e => run(groups.map(g => g.id === group.id ? { ...g, enableRefresh:e.target.checked } : g))} />下拉刷新</label><button disabled={index === 0} className="text-button" onClick={() => { const next=[...groups]; [next[index-1],next[index]]=[next[index],next[index-1]]; run(next.map((g,order)=>({...g,order}))); }}>上移</button>{isUserBookGroup(group)&&<button className="text-button" onClick={()=>{if(editing===group.id)reset();void run(groups.filter(g=>g.id!==group.id),group.id);}}>删除</button>}</div>)}
  </div>;
}

export function LibraryManager({ books, groups, save, remove }: { books: Book[]; groups: BookGroup[]; save: (book: Book) => Promise<void>; remove: (ids: string[]) => Promise<void> }) {
  const [selected,setSelected] = useState(new Set<string>()), [query,setQuery] = useState(''), [group,setGroup] = useState(''), [confirm,setConfirm] = useState(false), [error,setError] = useState('');
  const visible=books.filter(b=>`${b.name} ${b.author}`.includes(query));
  const run=async (action:()=>Promise<void>)=>{try {await action();setError('');}catch(e){setError(String(e));}};
  const batch=(change:(book:Book)=>Book)=>run(async()=>{for(const book of books.filter(b=>selected.has(b.id)))await save(change(book));});
  return <div><div className="input-row"><input aria-label="搜索书架" placeholder="搜索书架" value={query} onChange={e=>setQuery(e.target.value)} /><button className="text-button" onClick={()=>setSelected(new Set(visible.map(b=>b.id)))}>全选</button><button className="text-button" onClick={()=>setSelected(new Set(visible.filter(b=>!selected.has(b.id)).map(b=>b.id)))}>反选</button></div>
    {visible.map(book=><label className="library-manage-row" key={book.id}><input type="checkbox" checked={selected.has(book.id)} onChange={()=>setSelected(old=>{const next=new Set(old);next.has(book.id)?next.delete(book.id):next.add(book.id);return next;})}/><span>{book.name}<small>{book.author} · {book.chapters.length} 章</small></span></label>)}
    {selected.size>0&&<div className="library-batch"><p>已选 {selected.size} 本</p><div className="source-actions"><button onClick={()=>batch(b=>({...b,canUpdate:true}))}>允许更新</button><button onClick={()=>batch(b=>({...b,canUpdate:false}))}>禁止更新</button><button onClick={()=>batch(b=>b.kind==='online'?({...b,chapters:b.chapters.map(c=>({...c,content:undefined,originalContent:undefined,reversedOriginal:undefined}))}):b)}>清理缓存</button><button onClick={()=>batch(b=>({...b,finished:true}))}>标为已读</button><button onClick={()=>setConfirm(true)}>删除</button></div><div className="input-row"><select aria-label="书籍分组" value={group} onChange={e=>setGroup(e.target.value)}><option value="">选择分组</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select><button disabled={!group} onClick={()=>batch(b=>({...b,groups:[...new Set([...(b.groups||[]),group])]}))}>添加到分组</button><button disabled={!group} onClick={()=>batch(b=>({...b,groups:(b.groups||[]).filter(g=>g!==group)}))}>移除分组</button></div></div>}
    {confirm&&<div className="source-confirm"><p>删除选中的 {selected.size} 本书及其进度？书签会保留在“我的 → 书签”。</p><button className="text-button" onClick={()=>run(async()=>{await remove([...selected]);setSelected(new Set());setConfirm(false);})}><LegadoIcon name="ic_exit"/>删除</button><button className="text-button" onClick={()=>setConfirm(false)}>取消</button></div>}{error&&<p role="alert">{error}</p>}
  </div>;
}
