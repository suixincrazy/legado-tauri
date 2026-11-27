import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Check,ChevronDown,ChevronRight} from 'lucide-react';
import type {Book,Chapter,Settings} from './model';
import {bookTocExpanded} from './toc-config';
import {LegadoIcon} from './LegadoIcon';
import {cleanTocTitle,tocDisplayTitles,type TocTitles} from './toc-titles';
import {type ReplaceRule} from './replacement';
import * as storage from './storage';

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

export function ReaderToc({book,reverse,setReverse,saveExpanded,countWords,saveCountWords,useReplace,saveUseReplace,replaceDefault,conversion,jump,notify}:{book:Book;reverse:boolean;setReverse:(value:boolean)=>void;saveExpanded:(value:boolean)=>Promise<void>;countWords:boolean;saveCountWords:(value:boolean)=>Promise<void>;useReplace:boolean;saveUseReplace:(value:boolean)=>Promise<void>;replaceDefault:boolean;conversion:Settings['chineseConversion'];jump:(index:number)=>void;notify:(message:string)=>void}){
  const [query,setQuery]=useState(''),[overrides,setOverrides]=useState(new Set<number>()),[saving,setSaving]=useState(false),[savingCount,setSavingCount]=useState(false),[savingReplace,setSavingReplace]=useState(false);
  const groups=useMemo(()=>groupChapters(book.chapters),[book.chapters]);
  const currentVolume=useMemo(()=>groups.find(g=>g.heading===book.chapter||g.children.includes(book.chapter))?.heading,[groups,book.chapter]);
  const expanded=bookTocExpanded(book),keyword=query.trim()?query.toLowerCase():'';
  const list=useRef<HTMLDivElement>(null),lastView=useRef(''),pending=useRef<{index:number;offset:number}|null>(null);
  const titleRequest=useMemo(()=>({book,useReplace,replaceDefault,conversion}),[book,useReplace,replaceDefault,conversion]);
  const [display,setDisplay]=useState<{request:typeof titleRequest;result:TocTitles;error?:string}>();
  const currentDisplay=display?.request===titleRequest?display:undefined;
  const displayTitle=(index:number)=>currentDisplay?.result.titles[index]??cleanTocTitle(book.chapters[index].title);
  useEffect(()=>{
    const abort=new AbortController();
    const publish=(result:TocTitles,error?:string)=>{
      if(abort.signal.aborted)return;
      const node=list.current,first=node&&[...node.querySelectorAll<HTMLButtonElement>('[data-toc-index]')].find(row=>row.getBoundingClientRect().bottom>node.getBoundingClientRect().top);
      if(first&&node&&!pending.current)pending.current={index:Number(first.dataset.tocIndex),offset:first.getBoundingClientRect().top-node.getBoundingClientRect().top};
      setDisplay({request:titleRequest,result,error});
    };
    void (async()=>{
      if(!useReplace&&conversion==='none')return;
      const rules=useReplace?await storage.preference<ReplaceRule[]>('replaceRules',[]):[];
      const result=await tocDisplayTitles(book,rules,{tocUiUseReplace:useReplace,replaceEnableDefault:replaceDefault,chineseConversion:conversion},abort.signal,publish);
      publish(result);
    })().catch(error=>publish({titles:book.chapters.map(c=>cleanTocTitle(c.title)),failedRules:[]},String(error)));
    return()=>abort.abort();
  },[titleRequest]);
  const view=JSON.stringify([book.id,book.chapter,keyword,reverse,expanded,groups.map(g=>[g.heading,g.children.length])]);
  const rowAt=(index:number)=>list.current?.querySelector<HTMLButtonElement>('[data-toc-index="'+index+'"]');
  const positionRow=(index:number,offset=0)=>{
    const node=list.current,row=rowAt(index);
    if(!node||!row)return false;
    node.scrollTop+=row.getBoundingClientRect().top-node.getBoundingClientRect().top-offset;
    return true;
  };
  const positionCurrent=()=>positionRow(book.chapter)||(currentVolume!==undefined&&currentVolume!==null&&positionRow(currentVolume));
  useLayoutEffect(()=>{
    const changed=lastView.current!==view;lastView.current=view;
    const anchor=pending.current;pending.current=null;
    if(anchor)positionRow(anchor.index,anchor.offset);
    else if(changed&&list.current){if(keyword||!positionCurrent())list.current.scrollTop=0;}
  });
  const locateCurrent=()=>{
    if(!keyword&&currentVolume!==null&&currentVolume!==undefined&&overrides.has(currentVolume)){
      pending.current={index:book.chapter,offset:0};setOverrides(old=>{const next=new Set(old);next.delete(currentVolume);return next;});
    }else if(!positionCurrent()&&keyword)notify('当前章节不在搜索结果中');
  };
  const match=(index:number)=>book.chapters[index].title.toLowerCase().includes(keyword);
  const changeDefault=async(value:boolean)=>{
    setSaving(true);
    try{await saveExpanded(value);setOverrides(new Set());}catch(error){notify(String(error));}finally{setSaving(false);}
  };
  const changeCountWords=async(value:boolean)=>{
    setSavingCount(true);
    try{await saveCountWords(value);}catch(error){notify(String(error));}finally{setSavingCount(false);}
  };
  const changeUseReplace=async(value:boolean)=>{
    setSavingReplace(true);
    try{await saveUseReplace(value);}catch(error){notify(String(error));}finally{setSavingReplace(false);}
  };
  const toggle=(index:number)=>{
    const node=list.current;
    if(node){
      const top=node.getBoundingClientRect().top,first=[...node.querySelectorAll<HTMLButtonElement>('[data-toc-index]')].find(row=>row.getBoundingClientRect().bottom>top);
      if(first){
        const firstIndex=Number(first.dataset.tocIndex),group=groups.find(g=>g.heading===index);
        const hidesFirst=((expanded||index===currentVolume)!==overrides.has(index))&&group?.children.includes(firstIndex);
        pending.current=hidesFirst?{index,offset:0}:{index:firstIndex,offset:first.getBoundingClientRect().top-top};
      }
    }
    setOverrides(old=>{const next=new Set(old);if(!next.delete(index))next.add(index);return next;});
  };
  const rows=(reverse?[...groups].reverse():groups).flatMap(({heading,children})=>{
    const hits=keyword?children.filter(match):children;
    if(keyword&&!hits.length&&(heading===null||!match(heading)))return [];
    const open=heading===null||!!keyword||((expanded||heading===currentVolume)!==overrides.has(heading));
    const rendered=heading===null?[]:[<button key={heading} data-toc-index={heading} className="toc-volume" aria-expanded={children.length?open:undefined} aria-disabled={!!keyword||!children.length} onClick={()=>{if(!keyword&&children.length)toggle(heading);}}>
      <span>{displayTitle(heading)}</span>{keyword&&<small>{hits.length?hits.length+' 章匹配':'卷名匹配'}</small>}{!!children.length&&(open?<ChevronDown size={16}/>:<ChevronRight size={16}/>)}
    </button>];
    if(open)for(const index of reverse?[...hits].reverse():hits){
      const chapter=book.chapters[index],wordCount=countWords?chapter.wordCount:undefined;
      rendered.push(<button key={index} data-toc-index={index} className={(index===book.chapter?'current':'')+(wordCount?' toc-has-count':'')} aria-current={index===book.chapter?'location':undefined} onClick={()=>jump(index)}><span>{displayTitle(index)}</span>{wordCount&&<small className="toc-word-count">{wordCount}</small>}{chapter.content!==undefined&&<Check size={15}/>}</button>);
    }
    return rendered;
  });
  return <div className="reader-toc"><div className="input-row toc-tools"><input type="search" aria-label="搜索目录" placeholder="搜索目录" value={query} onChange={e=>setQuery(e.target.value)}/><button className="text-button" aria-pressed={reverse} onClick={()=>{setReverse(!reverse);setOverrides(new Set());}}>倒序</button><label><input type="checkbox" checked={expanded} disabled={saving} onChange={e=>void changeDefault(e.target.checked)}/>目录展开</label><label><input type="checkbox" checked={countWords} disabled={savingCount||savingReplace} onChange={e=>void changeCountWords(e.target.checked)}/>加载字数</label><label><input type="checkbox" checked={useReplace} disabled={savingReplace||savingCount} onChange={e=>void changeUseReplace(e.target.checked)}/>使用替换</label></div>
    {(currentDisplay?.error||!!currentDisplay?.result.failedRules.length)&&<p role="alert">{currentDisplay.error||'有标题替换规则执行失败，已跳过失败规则。'}</p>}
    <div className="toc-list" ref={list} role="region" aria-label="章节列表">{rows.length?rows:<div className="legado-empty">{keyword?'没有匹配章节':'没有章节'}</div>}</div>
    <nav className="toc-navigation" aria-label="目录定位"><button className="toc-current" aria-label="定位当前章节" title="定位当前章节" disabled={!book.chapters[book.chapter]} onClick={locateCurrent}>{book.chapters[book.chapter]?.title||'没有章节'}{book.chapters.length>0&&' ('+(book.chapter+1)+'/'+book.chapters.length+')'}</button><button aria-label="滚动到顶部" title="滚动到顶部" disabled={!rows.length} onClick={()=>{if(list.current)list.current.scrollTop=0;}}><LegadoIcon name="ic_arrow_drop_up"/></button><button aria-label="滚动到底部" title="滚动到底部" disabled={!rows.length} onClick={()=>{if(list.current)list.current.scrollTop=list.current.scrollHeight;}}><LegadoIcon name="ic_arrow_drop_down"/></button></nav>
  </div>;
}
