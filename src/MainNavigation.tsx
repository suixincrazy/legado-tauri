import {useEffect,useRef,useState} from 'react';
import type {Settings} from './model';

const pages={books:'书架',discover:'发现',subscriptions:'订阅',profile:'我的'} as const;
export type MainTab=typeof pages[keyof typeof pages];
type NavigationPrefs=Pick<Settings,'showDiscovery'|'showRss'|'startPage'>;
export function mainTabs(prefs:NavigationPrefs):MainTab[] {
  return ['书架',...(prefs.showDiscovery!==false?['发现' as const]:[]),...(prefs.showRss!==false?['订阅' as const]:[]),'我的'];
}
export function useMainNavigation(prefs:NavigationPrefs,ready:boolean){
  const [page,setPage]=useState<MainTab>('书架'),started=useRef(false),tabs=mainTabs(prefs);
  const tab=tabs.includes(page)?page:'书架';
  useEffect(()=>{
    if(!ready)return;
    if(!started.current){
      started.current=true;const initial=pages[prefs.startPage||'books'];
      setPage(tabs.includes(initial)?initial:'书架');
    }else if(page!==tab)setPage(tab);
  },[ready,prefs.startPage,prefs.showDiscovery,prefs.showRss,page,tab]);
  return {tab,tabs,setTab:setPage};
}
export function MainNavigationSettings({prefs,save}:{prefs:Settings;save:(next:Settings)=>void}){
  return <div className="preference-list">
    <label className="setting-row"><span>显示发现</span><input type="checkbox" role="switch" checked={prefs.showDiscovery!==false} onChange={e=>save({...prefs,showDiscovery:e.target.checked})}/></label>
    <label className="setting-row"><span>显示订阅</span><input type="checkbox" role="switch" checked={prefs.showRss!==false} onChange={e=>save({...prefs,showRss:e.target.checked})}/></label>
    <label className="setting-row"><span>启动页面<small>所选入口隐藏时打开书架</small></span><select aria-label="启动页面" value={prefs.startPage||'books'} onChange={e=>save({...prefs,startPage:e.target.value as Settings['startPage']})}>{Object.entries(pages).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
  </div>;
}
