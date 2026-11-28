import 'fake-indexeddb/auto';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {openDB} from 'idb';
import {beforeEach,expect,it,vi} from 'vitest';
import {MainNavigationSettings,useMainNavigation,type MainTab} from './MainNavigation';
import {DEFAULT_SETTINGS,newBook,type Settings} from './model';
import * as storage from './storage';
import {createBackupArchive,readBackupArchive,defaultContent} from './backup-archive';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(async()=>{const db=await openDB('legado-reader',3);for(const s of ['books','sources','records','feeds','settings','sourceState'])await db.clear(s);db.close();});
async function fixture(){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),save=vi.fn();let nav:ReturnType<typeof useMainNavigation>;
  function Host({prefs,ready}:{prefs:Settings;ready:boolean}){
    nav=useMainNavigation(prefs,ready);
    return <><nav>{nav.tabs.map(tab=><button key={tab} aria-current={tab===nav.tab?'page':undefined} onClick={()=>nav.setTab(tab)}>{tab}</button>)}</nav><MainNavigationSettings prefs={prefs} save={save}/></>;
  }
  const render=(prefs:Partial<Settings>={},ready=true)=>act(async()=>root.render(<Host prefs={{...DEFAULT_SETTINGS,...prefs}} ready={ready}/>));
  const active=()=>host.querySelector('nav [aria-current]')!.textContent;
  const move=(name:MainTab)=>act(async()=>nav.setTab(name));
  const done=async()=>{await act(async()=>root.unmount());host.remove();};
  return {host,save,render,active,move,done};
}
it.each([
  [true,true,['书架','发现','订阅','我的']],
  [true,false,['书架','发现','我的']],
  [false,true,['书架','订阅','我的']],
  [false,false,['书架','我的']],
] as const)('keeps Books and Me reachable with discover %s and subscriptions %s',async(showDiscovery,showRss,expected)=>{
  const f=await fixture();
  try{await f.render({showDiscovery,showRss});expect([...f.host.querySelectorAll('nav button')].map(b=>b.textContent)).toEqual(expected);await f.move('我的');expect(f.active()).toBe('我的');await f.move('书架');expect(f.active()).toBe('书架');}finally{await f.done();}
});
it('waits for loaded prefs and applies the start page only once',async()=>{
  const f=await fixture();
  try{await f.render({},false);expect(f.active()).toBe('书架');await f.render({startPage:'subscriptions'});expect(f.active()).toBe('订阅');await f.move('我的');await f.render({startPage:'discover'});expect(f.active()).toBe('我的');}finally{await f.done();}
});
it.each(['discover','subscriptions'] as const)('falls back from hidden start page %s without erasing the saved selection',async startPage=>{
  const prefs={showDiscovery:false,showRss:false,startPage},f=await fixture();
  try{await f.render(prefs);expect(f.active()).toBe('书架');expect(f.host.querySelector('select')!.value).toBe(startPage);await f.render({...prefs,showDiscovery:true,showRss:true});expect(f.active()).toBe('书架');expect(f.save).not.toHaveBeenCalled();}finally{await f.done();}
});
it.each([['发现','showDiscovery'],['订阅','showRss']] as const)('leaves a hidden current %s page and does not return when enabled again',async(tab,key)=>{
  const f=await fixture();
  try{await f.render();await f.move(tab);await f.render({[key]:false});expect(f.active()).toBe('书架');await f.render();expect(f.active()).toBe('书架');}finally{await f.done();}
});
it('only updates the chosen preference and exposes on defaults for missing values',async()=>{
  const f=await fixture(),prefs={...DEFAULT_SETTINGS,showDiscovery:undefined,showRss:undefined};
  try{
    await f.render(prefs);const switches=[...f.host.querySelectorAll<HTMLInputElement>('[role=switch]')];expect(switches.every(b=>b.checked)).toBe(true);
    await act(async()=>switches[0].click());expect(f.save).toHaveBeenLastCalledWith({...prefs,showDiscovery:false});
    const select=f.host.querySelector('select')!;await act(async()=>{select.value='profile';select.dispatchEvent(new Event('change',{bubbles:true}));});expect(f.save).toHaveBeenLastCalledWith({...prefs,startPage:'profile'});
  }finally{await f.done();}
});
it('keeps own navigation prefs and all library data through full and settings-excluded backups',async()=>{
  const book={...newBook('Public','txt',[{title:'Chapter',content:'Retained body'}]),id:'public',bookmarks:[{chapter:0,offset:.2,title:'Mark',created:1}]};
  const source={bookSourceUrl:'https://navigation.test',bookSourceName:'Public source'},feed={id:'public-feed',name:'Public feed',url:'https://navigation.test/rss'};
  await storage.put('books',book.id,book);await storage.put('sources',source.bookSourceUrl,source);await storage.put('feeds',feed.id,feed);
  const prefs={...DEFAULT_SETTINGS,showDiscovery:false,showRss:false,startPage:'discover' as const};await storage.put('settings','reader',prefs);
  const archive=await createBackupArchive(),full=await readBackupArchive(archive),excluded=await readBackupArchive(await createBackupArchive({...defaultContent,settings:false}));
  await storage.put('settings','reader',DEFAULT_SETTINGS);await storage.restore(JSON.stringify(full));expect(await storage.settings()).toEqual(prefs);
  const current={...prefs,showDiscovery:true,startPage:'profile' as const};await storage.put('settings','reader',current);await storage.restore(JSON.stringify(excluded));expect(await storage.settings()).toEqual(current);
  expect(await storage.all('books')).toEqual([book]);expect(await storage.all('sources')).toEqual([source]);expect(await storage.all('feeds')).toEqual([feed]);
  const f=await fixture();try{await f.render(await storage.settings());expect(f.active()).toBe('我的');}finally{await f.done();}
});
it('rejects damaged navigation prefs before writing library or settings',async()=>{
  const before=JSON.parse(await storage.backup());
  for(const invalid of [{showDiscovery:'false'},{showRss:0},{startPage:'missing'}]){
    await expect(storage.restore(JSON.stringify({...before,settings:{...before.settings,...invalid},feeds:[{id:'new',url:'https://navigation.test/new'}]}))).rejects.toThrow('主界面设置');
    const after=JSON.parse(await storage.backup());delete after.created;const expected={...before};delete expected.created;expect(after).toEqual(expected);
  }
});
