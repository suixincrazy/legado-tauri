import { useState } from 'react';
import { Modal } from './ui';
import * as storage from './storage';

export function SleepTimer({remaining,chapters,apply,close,notify}:{remaining:number;chapters:number;apply:(minutes:number,chapters:number)=>Promise<unknown>;close:()=>void;notify:(text:string)=>void}) {
  const [custom,setCustom]=useState<'minutes'|'chapters'|null>(null),[value,setValue]=useState('');
  const choose=async(minutes:number,chapters:number)=>{await apply(minutes,chapters);close();};
  const input=async(mode:'minutes'|'chapters')=>{setCustom(mode);setValue(String(await storage.preference(mode==='minutes'?'lastSleepTimer':'lastSleepChapter',0)||''));};
  const confirm=async()=>{const number=Number(value),limit=custom==='chapters'?99:180;if(!Number.isInteger(number)||number<1||number>limit){notify(`请输入 1 到 ${limit} 之间的数值`);return;}await storage.put('settings',custom==='chapters'?'lastSleepChapter':'lastSleepTimer',number);await choose(custom==='minutes'?number:0,custom==='chapters'?number:0);};
  return <div className="sleep-timer-dialog"><Modal page={false} centered title="定时停止" close={close}><div className="sleep-timer">
    <div className="sleep-timer-status"><span>{chapters?`${chapters} 章后停止`:remaining?`${Math.ceil(remaining/60)} 分钟后停止`:'未设置'}</span><button aria-label="关闭定时" disabled={!chapters&&!remaining} onClick={()=>void choose(0,0)}>×</button></div>
    <p>按时间</p><div className="sleep-timer-options">{[15,30,45,60].map(minutes=><button key={minutes} aria-pressed={!chapters&&Math.ceil(remaining/60)===minutes} onClick={()=>void choose(minutes,0)}>{minutes} 分钟</button>)}</div><button className="sleep-timer-custom" aria-pressed={custom==='minutes'} onClick={()=>void input('minutes')}>自定义</button>
    <p>按章节</p><div className="sleep-timer-options">{[1,2,3,5].map(count=><button key={count} aria-pressed={chapters===count} onClick={()=>void choose(0,count)}>{count} 章</button>)}</div><button className="sleep-timer-custom" aria-pressed={custom==='chapters'} onClick={()=>void input('chapters')}>自定义</button>
    {custom&&<form className="sleep-timer-input" onSubmit={event=>{event.preventDefault();void confirm();}}><input autoFocus type="number" aria-label={custom==='minutes'?'自定义分钟数':'自定义章节数'} placeholder={custom==='minutes'?'自定义分钟数':'自定义章节数'} min={1} max={custom==='chapters'?99:180} value={value} onChange={event=>setValue(event.target.value)}/><button type="submit">确定</button></form>}
  </div></Modal></div>;
}
