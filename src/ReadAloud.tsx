import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { LegadoIcon } from './LegadoIcon';
import { Modal } from './ui';
import { SleepTimer } from './SleepTimer';
import * as storage from './storage';
import { defaultSpeechSettings, idleSpeechState, speechCommand, type SpeechChunk, type SpeechEngine, type SpeechSettings, type SpeechState } from './read-aloud';

export function useReadAloud(notify:(text:string)=>void) {
  const [state,setState]=useState({...idleSpeechState}),[settings,setSettings]=useState({...defaultSpeechSettings});
  const settingsRef=useRef(settings),reported=useRef(''),timerOverride=useRef<Record<string,unknown>|undefined>(undefined);settingsRef.current=settings;
  useEffect(()=>{storage.preference('speechSettings',defaultSpeechSettings).then(value=>setSettings({...defaultSpeechSettings,...value})).catch(error=>notify(String(error)));},[notify]);
  useEffect(()=>{
    let alive=true,busy=false;
    const poll=async()=>{if(busy)return;busy=true;try{const next=await speechCommand('status');if(alive){setState({...idleSpeechState,...next});if(next.state==='error'&&next.error!==reported.current){reported.current=next.error;notify(next.error);}}}catch(error){if(alive&&reported.current!==String(error)){reported.current=String(error);notify(String(error));}}finally{busy=false;}};
    void poll();const timer=setInterval(poll,700);return()=>{alive=false;clearInterval(timer);};
  },[notify]);
  const command=useCallback(async(action:string,args:Record<string,unknown>={})=>{try{if(action==='timer')timerOverride.current=args;const next=await speechCommand(action,args);setState({...idleSpeechState,...next});return next;}catch(error){notify(String(error));return null;}},[notify]);
  const update=async(patch:Partial<SpeechSettings>)=>{const next={...settingsRef.current,...patch};setSettings(next);settingsRef.current=next;await storage.put('settings','speechSettings',next);if(state.state==='playing'||state.state==='paused')await command('settings',{settings:next});};
  const start=async(bookId:string,bookName:string,chunks:SpeechChunk[])=>{if(!chunks.length){notify('没有可朗读的正文');return;}reported.current='';return command('start',{bookId,bookName,chunks,settings:settingsRef.current,timer:timerOverride.current});};
  return {state,settings,update,command,start};
}
export function ReadAloudPanel({controller,bookId,start,close,toc,menu,background,navigate,notify}:{controller:ReturnType<typeof useReadAloud>;bookId:string;start:()=>Promise<unknown>;close:()=>void;toc:()=>void;menu:()=>void;background:()=>void;navigate:(direction:number)=>void;notify:(text:string)=>void}) {
  const {state,settings,update,command}=controller;
  const [engines,setEngines]=useState<SpeechEngine[]>([]),[engineOpen,setEngineOpen]=useState(false),[config,setConfig]=useState(false),[timerOpen,setTimerOpen]=useState(false),[minutes,setMinutes]=useState(settings.timer);
  useEffect(()=>{speechCommand<SpeechEngine[]>('engines').then(setEngines).catch(error=>notify(String(error)));},[notify]);
  useEffect(()=>{if(engineOpen||config||timerOpen)return;const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();close();};const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}};window.addEventListener('legado-back',back,true);document.addEventListener('keydown',key);return()=>{window.removeEventListener('legado-back',back,true);document.removeEventListener('keydown',key);};},[close,engineOpen,config,timerOpen]);
  const active=state.bookId===bookId&&(state.state==='playing'||state.state==='paused'||state.state==='loading');
  const playing=active&&(state.state==='playing'||state.state==='loading');
  const play=()=>playing?command('pause'):active?command('resume'):start();
  const move=(direction:number,byChapter=false)=>active?command('skip',{direction,chapter:byChapter}):byChapter?navigate(direction):start();
  const engineName=engines.find(engine=>engine.id===settings.engine)?.name||'系统默认';
  const timerText=state.chapterStop?`${state.chapterStop} 章后停止`:state.remaining?`${Math.ceil(state.remaining/60)} 分钟`:'设置定时';
  const icon=(name:string,label:string,action:()=>unknown,disabled=false)=><button type="button" aria-label={label} title={label} onClick={action} disabled={disabled}><LegadoIcon name={name} size={30}/></button>;
  return <><button className="aloud-dismiss" aria-label="关闭朗读菜单" onClick={close}/><section className="read-aloud-panel" role="dialog" aria-label="朗读" aria-modal="false">
    <button className="aloud-engine" onClick={()=>setEngineOpen(true)} aria-label={`朗读引擎: ${engineName}`}><LegadoIcon name="ic_volume_up" size={20}/><span>{engineName}</span><LegadoIcon name="ic_arrow_drop_down" size={20}/></button>
    <div className="aloud-transport"><button className="aloud-chapter" onClick={()=>move(-1,true)}>上一章</button><span/>{icon('ic_skip_previous','上一段',()=>move(-1))}{icon(playing?'ic_pause_24dp':'ic_play_24dp',playing?'暂停':'播放',play)}{icon('ic_stop_black_24dp','停止',async()=>{await command('stop');close();})}{icon('ic_skip_next','下一段',()=>move(1))}<span/><button className="aloud-chapter" onClick={()=>move(1,true)}>下一章</button></div>
    <div className="aloud-timer">{icon('ic_time_add_24dp','保存定时时间',async()=>{await update({timer:minutes});notify('保存设定时间成功！');})}<input type="range" aria-label="朗读定时分钟" min={0} max={180} value={minutes} onChange={event=>{const value=+event.target.value;setMinutes(value);void command('timer',{minutes:value});}}/><button onClick={()=>setTimerOpen(true)}>{timerText}</button></div>
    <div className="aloud-rate-label"><span>朗读语速 {settings.followSystem?'':settings.rate.toFixed(1)}</span><label>跟随系统<input type="checkbox" role="switch" checked={settings.followSystem} onChange={event=>void update({followSystem:event.target.checked})}/></label></div>
    <div className="aloud-rate">{icon('ic_reduce','减慢语速',()=>update({rate:Math.max(.5,+(settings.rate-.1).toFixed(1))}),settings.followSystem)}<input aria-label="朗读语速" type="range" min={.5} max={5} step={.1} value={settings.rate} disabled={settings.followSystem} onChange={event=>void update({rate:+event.target.value})}/>{icon('ic_add','加快语速',()=>update({rate:Math.min(5,+(settings.rate+.1).toFixed(1))}),settings.followSystem)}</div>
    <nav className="reader-actions"><button onClick={toc}><LegadoIcon name="ic_toc" size={20}/>目录</button><button onClick={menu}><LegadoIcon name="ic_menu" size={20}/>菜单</button><button onClick={background}><LegadoIcon name="ic_visibility_off" size={20}/>后台</button><button onClick={()=>setConfig(true)}><LegadoIcon name="ic_settings" size={20}/>设置</button></nav>
  </section>
  {engineOpen&&<Modal page={false} centered title="朗读引擎" close={()=>setEngineOpen(false)}><div className="aloud-engines">{[{id:'',name:'系统默认'},...engines].map(engine=><label key={engine.id}><span>{engine.name}{engine.language&&<small>{engine.language}</small>}</span><input type="radio" name="speech-engine" checked={settings.engine===engine.id} onChange={()=>{void update({engine:engine.id});setEngineOpen(false);}}/></label>)}</div></Modal>}
  {timerOpen&&<SleepTimer remaining={state.remaining} chapters={state.chapterStop} close={()=>setTimerOpen(false)} notify={notify} apply={(minutes,chapters)=>{setMinutes(minutes);return command('timer',{minutes,chapters});}}/>}
  {config&&<Modal page={false} centered title="朗读配置" close={()=>setConfig(false)}><div className="preference-list">{(!isTauri()||/Android/i.test(navigator.userAgent))&&<><label className="setting-row"><span>忽略音频焦点</span><input type="checkbox" role="switch" checked={settings.ignoreAudioFocus} onChange={event=>void update({ignoreAudioFocus:event.target.checked})}/></label>{isTauri()&&<label className="setting-row"><span>朗读服务唤醒锁</span><input type="checkbox" role="switch" checked={settings.readAloudWakeLock} onChange={event=>void update({readAloudWakeLock:event.target.checked})}/></label>}</>}<label className="setting-row"><span>媒体按钮•上一首|下一首<small>上一段|下一段/上一章|下一章</small></span><input type="checkbox" role="switch" checked={settings.mediaButtonPerNext} onChange={event=>void update({mediaButtonPerNext:event.target.checked})}/></label><label className="setting-row"><span>首次朗读起始设置</span><select aria-label="首次朗读起始设置" value={settings.readAloudStart} onChange={event=>void update({readAloudStart:event.target.value as SpeechSettings['readAloudStart']})}><option value="page">页首开始朗读</option><option value="sentence">句首开始朗读</option></select></label><button className="setting-row" onClick={()=>{setConfig(false);setEngineOpen(true);}}><span>朗读引擎<small>{engineName}</small></span></button>{isTauri()&&/Android/i.test(navigator.userAgent)&&<button className="setting-row" onClick={()=>void command('systemSettings')}><span>系统 TTS 设置</span></button>}</div></Modal>}
  </>;
}
