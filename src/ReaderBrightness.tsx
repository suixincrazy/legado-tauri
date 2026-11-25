import { useLayoutEffect, useRef, useState } from 'react';
import type { Settings } from './model';
import { LegadoIcon } from './LegadoIcon';

export function ReaderBrightness({prefs,save}:{prefs:Settings;save:(prefs:Settings)=>void}) {
  const track=useRef<HTMLDivElement>(null),[length,setLength]=useState(0);
  useLayoutEffect(()=>{const node=track.current;if(!node)return;const observer=new ResizeObserver(()=>setLength(node.clientHeight));observer.observe(node);return()=>observer.disconnect();},[]);
  const auto=prefs.brightness<0,last=prefs.readerBrightness??100/255;
  return <div className={`reader-brightness ${prefs.brightnessOnRight?'right':''}`}>
    <button aria-label="自动亮度" aria-pressed={auto} onClick={()=>save({...prefs,brightness:auto?last:-1,readerBrightness:auto?last:prefs.brightness})}><LegadoIcon name="ic_brightness_auto"/></button>
    <div ref={track} className="reader-brightness-track"><input type="range" aria-label="阅读亮度" min={0} max={255} disabled={auto} value={Math.round((auto?last:prefs.brightness)*255)} style={{width:length}} onChange={event=>{const value=Math.max(1,+event.target.value)/255;save({...prefs,brightness:value,readerBrightness:value});}}/></div>
    <button aria-label="调整亮度条位置" onClick={()=>save({...prefs,brightnessOnRight:!prefs.brightnessOnRight})}><LegadoIcon name="ic_swap_horiz"/></button>
  </div>;
}
