import {useMemo,useState} from 'react';
import {Check,ChevronDown,ChevronRight} from 'lucide-react';
import type {Book,Chapter} from './model';
import {bookTocExpanded} from './toc-config';

type Volume={heading:number|null;children:number[]};
export function groupChapters(chapters:Chapter[]):Volume[]{
  const groups:Volume[]=[];
  for(let i=0;i<chapters.length;i++){
    if(chapters[i].isVolume)groups.push({heading:i,children:[]});
    else{
      if(!groups.length)groups.push({heading:null,children:[]});
      groups[groups.length-1].children.push(i);
    }
  }
  return groups;
}

export function ReaderToc({book,reverse,setReverse,saveExpanded,jump,notify}:{book:Book;reverse:boolean;setReverse:(value:boolean)=>void;saveExpanded:(value:boolean)=>Promise<void>;jump:(index:number)=>void;notify:(message:string)=>void}){
  const [query,setQuery]=useState(''),[overrides,setOverrides]=useState(new Set<number>()),[saving,setSaving]=useState(false);
  const groups=useMemo(()=>groupChapters(book.chapters),[book.chapters]);
  const currentVolume=useMemo(()=>groups.find(g=>g.heading===book.chapter||g.children.includes(book.chapter))?.heading,[groups,book.chapter]);
  const expanded=bookTocExpanded(book),keyword=query.trim()?query.toLowerCase():'';
  const match=(index:number)=>book.chapters[index].title.toLowerCase().includes(keyword);
  const changeDefault=async(value:boolean)=>{
    setSaving(true);
    try{await saveExpanded(value);setOverrides(new Set());}catch(error){notify(String(error));}finally{setSaving(false);}
  };
  const toggle=(index:number)=>setOverrides(old=>{const next=new Set(old);if(!next.delete(index))next.add(index);return next;});
  const rows=(reverse?[...groups].reverse():groups).flatMap(({heading,children})=>{
    const hits=keyword?children.filter(match):children;
    if(keyword&&!hits.length&&(heading===null||!match(heading)))return [];
    const open=heading===null||!!keyword||((expanded||heading===currentVolume)!==overrides.has(heading));
    const rendered=heading===null?[]:[<button key={heading} className="toc-volume" aria-expanded={children.length?open:undefined} aria-disabled={!!keyword||!children.length} onClick={()=>{if(!keyword&&children.length)toggle(heading);}}>
      <span>{book.chapters[heading].title}</span>{keyword&&<small>{hits.length?hits.length+' 章匹配':'卷名匹配'}</small>}{!!children.length&&(open?<ChevronDown size={16}/>:<ChevronRight size={16}/>)}
    </button>];
    if(open)for(const index of reverse?[...hits].reverse():hits){
      const chapter=book.chapters[index];
      rendered.push(<button key={index} className={index===book.chapter?'current':''} aria-current={index===book.chapter?'location':undefined} onClick={()=>jump(index)}><span>{chapter.title}</span>{chapter.content!==undefined&&<Check size={15}/>}</button>);
    }
    return rendered;
  });
  return <><div className="input-row toc-tools"><input type="search" aria-label="搜索目录" placeholder="搜索目录" value={query} onChange={e=>setQuery(e.target.value)}/><button className="text-button" aria-pressed={reverse} onClick={()=>{setReverse(!reverse);setOverrides(new Set());}}>倒序</button><label><input type="checkbox" checked={expanded} disabled={saving} onChange={e=>void changeDefault(e.target.checked)}/>目录展开</label></div>
    <div className="toc-list">{rows.length?rows:<div className="legado-empty">{keyword?'没有匹配章节':'没有章节'}</div>}</div></>;
}
