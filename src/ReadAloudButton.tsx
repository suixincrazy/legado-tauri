import { useEffect, useRef } from 'react';
import { LegadoIcon } from './LegadoIcon';

export function ReadAloudButton({active,start,open}:{active:boolean;start:()=>void;open:()=>void}) {
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),long=useRef(false),origin=useRef<{x:number;y:number}|null>(null);
  const cancel=()=>{clearTimeout(timer.current);timer.current=undefined;};
  useEffect(()=>cancel,[]);
  return <button onPointerDown={event=>{if(event.button!==0)return;long.current=false;origin.current={x:event.clientX,y:event.clientY};timer.current=setTimeout(()=>{long.current=true;open();},500);}} onPointerMove={event=>{if(origin.current&&Math.hypot(event.clientX-origin.current.x,event.clientY-origin.current.y)>10)cancel();}} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel} onContextMenu={event=>{event.preventDefault();cancel();if(!long.current){long.current=true;open();}}} onClick={()=>{cancel();if(long.current){long.current=false;return;}if(active)open();else start();}}><LegadoIcon name="ic_read_aloud" size={20}/>朗读</button>;
}
