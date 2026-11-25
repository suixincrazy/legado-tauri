import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Source } from './model';
import { exploreKinds, type ExploreKind } from './sources';
import { exploreUi } from './source-explore';
import { safeSourceError } from './source-management';

export function SourceDiscover({source,browse,login,inline=false}:{source:Source;browse:(url:string)=>void;login:()=>void;inline?:boolean}) {
  const [items,setItems]=useState<ExploreKind[]>([]),[labels,setLabels]=useState<string[]>([]),[values,setValues]=useState<Record<string,string>>({});
  const [error,setError]=useState(''),[busy,setBusy]=useState(true),[revision,setRevision]=useState(0);
  const currentValues=useRef(values);currentValues.current=values;
  const timers=useRef(new Map<string,ReturnType<typeof setTimeout>>()),alive=useRef(true),queue=useRef(Promise.resolve());
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;timers.current.forEach(clearTimeout);};},[]);
  useEffect(()=>{
    let current=true;setBusy(true);setError('');
    (async()=>{const next=await exploreKinds(source);const ui=await exploreUi(source,next);if(current){setItems(next);setLabels(ui.labels);setValues(ui.values);}})().catch(error=>{if(current)setError(safeSourceError(error));}).finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  },[source,revision]);
  const act=(item:ExploreKind,value?:string)=>{
    if(value!==undefined)setValues(old=>({...old,[item.title]:value}));
    const execute=()=>{queue.current=queue.current.then(async()=>{if(!alive.current)return;const snapshot={...currentValues.current};setError('');try{const ui=await exploreUi(source,items,{title:item.title,value,action:item.action});if(alive.current){setLabels(ui.labels);setValues(old=>{const next={...old};for(const [key,value] of Object.entries(ui.values))if(old[key]===snapshot[key])next[key]=value;return next;});if(ui.refresh)setRevision(old=>old+1);}}catch(error){if(alive.current)setError(safeSourceError(error));}});};
    if(item.type==='text'){clearTimeout(timers.current.get(item.title));timers.current.set(item.title,setTimeout(execute,600));}else execute();
  };
  const style=(item:ExploreKind):CSSProperties=>{const value=item.style;return {flexGrow:value?.layout_flexGrow??0,flexShrink:value?.layout_flexShrink??1,flexBasis:(value?.layout_flexBasisPercent??-1)>=0?`calc(${value!.layout_flexBasisPercent!*100}% - 6px)`:undefined,alignSelf:value?.layout_alignSelf?.replace('_','-'),textAlign:value?.layout_justifySelf==='flex_start'?'left':value?.layout_justifySelf==='flex_end'?'right':'center'};};
  return <div className="explore-categories">{!inline&&<div className="source-actions"><button className="outlined" onClick={login}>登录 / 设置</button><button className="outlined" disabled={busy} onClick={()=>setRevision(n=>n+1)}>刷新分类</button></div>}
    {busy&&<p role="status">正在读取发现分类…</p>}{error&&<div role="alert" className="warning">{error}<button className="text-button" onClick={()=>setRevision(n=>n+1)}>重试</button><button className="text-button" onClick={login}>登录</button></div>}
    <div className="explore-kinds">{items.map((item,index)=>{const label=labels[index]||item.title,value=values[item.title]??'',options=(item.chars||[]).filter(option=>option!=null);return <div className="explore-control" key={index} style={{display:'contents'}}>{item.style?.layout_wrapBefore&&<span className="explore-wrap"/>}{item.type==='text'?<input style={style(item)} aria-label={label} placeholder={label} value={value} onChange={e=>act(item,e.target.value)}/>:item.type==='select'?<label style={style(item)}>{label}<select aria-label={label} value={value} onChange={e=>act(item,e.target.value)}>{options.map(option=><option key={option}>{option}</option>)}</select></label>:item.type==='toggle'?<button style={style(item)} onClick={()=>act(item,options[(options.indexOf(value)+1)%Math.max(1,options.length)]||'')}>{item.style?.layout_justifySelf==='right'?label+value:value+label}</button>:item.type==='button'?<button style={style(item)} onClick={()=>act(item)}>{label}</button>:item.url?<button style={style(item)} onClick={()=>item.title.startsWith('ERROR:')?setError(safeSourceError(item.url)):browse(item.url!)}>{label}</button>:<span style={style(item)}>{label}</span>}</div>;})}</div>
    {!busy&&!error&&!items.length&&<p className="subtle">书源没有返回发现分类。</p>}
  </div>;
}
