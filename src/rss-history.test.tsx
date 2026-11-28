import 'fake-indexeddb/auto';
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {openDB} from 'idb';
import {beforeEach,expect,it,vi} from 'vitest';
import {RssHistory} from './RssHistory';
import {RssArticleViews} from './RssFavorites';
import type {HistorySource,RssHistoryRow} from './rss-history';
import type {FeedArticle} from './rss-favorites';
import * as storage from './storage';
import {createBackupArchive,readBackupArchive,defaultContent} from './backup-archive';
import {inspectBackup} from './backup';
import {DEFAULT_SETTINGS,newBook} from './model';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const article:FeedArticle={sourceUrl:'https://feeds.test/a',sourceName:'Public A',url:'https://articles.test/one',title:'Article A',content:'Saved body A\nOffline paragraph'};
const other={...article,sourceUrl:'https://feeds.test/b',sourceName:'Public B',title:'Article B',content:'Saved body B'};
const history=()=>storage.all<RssHistoryRow>('rssHistory');
beforeEach(async()=>{const db=await openDB('legado-reader');for(const name of db.objectStoreNames)await db.clear(name);db.close();});
it('records by default and keeps same-URL articles from two sources separately',async()=>{
  expect((await storage.settings()).rssHistoryEnabled).toBe(true);
  await storage.recordRssRead(article);await storage.recordRssRead(other);
  expect((await history()).map(({sourceUrl,title})=>({sourceUrl,title}))).toEqual([{sourceUrl:article.sourceUrl,title:article.title},{sourceUrl:other.sourceUrl,title:other.title}]);
});
it('refreshes the snapshot and recent time on active reread without duplicating rows',async()=>{
  const now=vi.spyOn(Date,'now').mockReturnValue(100);
  try{
    await storage.recordRssRead(article);now.mockReturnValue(200);await storage.recordRssRead(other);
    now.mockReturnValue(300);await storage.recordRssRead({...article,title:'New title',content:'New body'});
    const rows=(await history()).sort((a,b)=>b.readAt-a.readAt);
    expect(rows).toHaveLength(2);expect(rows[0]).toEqual({...article,title:'New title',content:'New body',readAt:300});expect(rows[1].readAt).toBe(200);
  }finally{now.mockRestore();}
});
it('preserves the order of multiple reads in the same clock tick',async()=>{
  const now=vi.spyOn(Date,'now').mockReturnValue(100);
  try{await storage.recordRssRead(article);await storage.recordRssRead(other);await storage.recordRssRead(article);
    const rows=(await history()).sort((a,b)=>b.readAt-a.readAt);expect(rows.map(row=>row.title)).toEqual(['Article A','Article B']);expect(rows[0].readAt).toBeGreaterThan(rows[1].readAt);
  }finally{now.mockRestore();}
});
it('does not record linkless articles or disabled opens, preserves existing history and never backfills',async()=>{
  await storage.recordRssRead(article);const before=await history();
  await storage.recordRssRead({...article,url:''});expect(await history()).toEqual(before);
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,rssHistoryEnabled:false});
  await storage.recordRssRead(other);await storage.recordRssRead({...article,content:'Not saved'});
  expect(await history()).toEqual(before);
  await storage.put('settings','reader',DEFAULT_SETTINGS);expect(await history()).toEqual(before);
  await storage.recordRssRead(other);expect(await history()).toHaveLength(2);
});
it('keeps history, favorites, feeds and books independent when either saved collection is cleared',async()=>{
  const book={...newBook('Public book','txt',[{title:'Chapter',content:'Book body'}]),id:'kept'};
  await storage.put('books',book.id,book);await storage.put('feeds','feed',{id:'feed',name:'Feed',url:article.sourceUrl});
  await storage.saveRssFavorite(article);await storage.recordRssRead(article);await storage.recordRssRead(other);
  await storage.remove('feeds','feed');await storage.removeRssFavorites('all');expect(await history()).toHaveLength(2);
  await storage.saveRssFavorite(article);const saved=await storage.all('rssFavorites');
  await storage.clearRssHistory(article.sourceUrl);expect((await history()).map(row=>row.sourceName)).toEqual(['Public B']);
  await storage.clearRssHistory();expect(await history()).toEqual([]);expect(await storage.all('rssFavorites')).toEqual(saved);expect(await storage.all('books')).toEqual([book]);
});
it('backs up and restores history and its snapshot independently of feeds, favorites and settings',async()=>{
  await storage.recordRssRead(article);await storage.recordRssRead(other);const rows=await history();
  const bytes=await createBackupArchive({...defaultContent,history:false,rssFavorites:false,sources:false,settings:false});
  expect((await inspectBackup(bytes,'')).summary).toContain('2 条订阅历史');
  const payload=await readBackupArchive(bytes);expect(payload.rssHistory).toEqual(rows);
  expect(payload.feeds).toEqual([]);expect(payload.records).toEqual([]);expect(payload.rssFavorites).toBeUndefined();
  await storage.clearRssHistory();await storage.restore(JSON.stringify(payload));await storage.restore(JSON.stringify(payload));expect(await history()).toEqual(rows);
  const reopened=await openDB('legado-reader');expect(await reopened.getAll('rssHistory')).toEqual(rows);reopened.close();
});
it('honors excluded and ignored history while restoring other requested collections',async()=>{
  await storage.recordRssRead(article);const full=JSON.parse(await storage.backup());
  const excluded=await readBackupArchive(await createBackupArchive({...defaultContent,rssHistory:false}));expect(excluded.rssHistory).toBeUndefined();
  await storage.recordRssRead({...article,content:'Local body'});const local=await history();
  await storage.restore(JSON.stringify(excluded));expect(await history()).toEqual(local);
  await storage.restore(JSON.stringify(full),['rssHistory']);expect(await history()).toEqual(local);
  await storage.restore(JSON.stringify(full));expect(await history()).toEqual(full.rssHistory);
});
it('saving a history article as a favorite does not expose read times in history-excluded backups',async()=>{
  await storage.recordRssRead(article);
  await storage.saveRssFavorite((await history())[0]);
  const data=await readBackupArchive(await createBackupArchive({...defaultContent,rssHistory:false}));
  expect(data.rssHistory).toBeUndefined();
  expect(data.rssFavorites).toEqual([{...article,group:'默认分组',savedAt:expect.any(Number)}]);
});
it('restoring an earlier own backup preserves existing history and the recording preference',async()=>{
  await storage.recordRssRead(article);await storage.put('settings','reader',{...DEFAULT_SETTINGS,rssHistoryEnabled:false});
  const data=JSON.parse(await storage.backup()),rows=await history();delete data.rssHistory;delete data.settings.rssHistoryEnabled;
  await storage.restore(JSON.stringify(data));expect(await history()).toEqual(rows);expect((await storage.settings()).rssHistoryEnabled).toBe(false);
});
it('restores the switch only when settings restoration is requested and does not create reads',async()=>{
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,rssHistoryEnabled:false});const data=JSON.parse(await storage.backup());
  await storage.put('settings','reader',DEFAULT_SETTINGS);
  await storage.restore(JSON.stringify(data),['reader']);expect((await storage.settings()).rssHistoryEnabled).toBe(true);
  await storage.restore(JSON.stringify(data));expect((await storage.settings()).rssHistoryEnabled).toBe(false);expect(await history()).toEqual([]);
});
it('rejects corrupt or duplicate history and invalid settings before any write',async()=>{
  await storage.recordRssRead(article);const original=JSON.parse(await storage.backup()),row=original.rssHistory[0];
  for(const changes of [null,[{...row,readAt:-1}],[{...row,readAt:9000000000000000}],[{...row,url:'javascript:bad()'}],[{...row,content:null}],[{...row,sourceName:''}],[row,row]].map(rssHistory=>({rssHistory})).concat([{settings:{...original.settings,rssHistoryEnabled:'false'}}] as any)){
    await expect(storage.restore(JSON.stringify({...original,...changes,feeds:[{id:'new',url:'https://new.test'}]}))).rejects.toThrow('订阅历史');
    const after=JSON.parse(await storage.backup());delete after.created;const expected={...original};delete expected.created;expect(after).toEqual(expected);
  }
});
async function view(initial:HistorySource={sourceUrl:'',sourceName:''}){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),notify=vi.fn();
  function Host(){
    const [scope,select]=useState(initial),[enabled,setEnabled]=useState(true),[revision,setRevision]=useState(0),[current,setCurrent]=useState<FeedArticle|null>(null);
    const open=(row:FeedArticle|null)=>{setCurrent(row);if(row)void storage.recordRssRead(row).then(()=>setRevision(n=>n+1));};
    return <><RssHistory scope={scope} select={select} revision={revision} enabled={enabled} toggle={value=>{setEnabled(value);void storage.put('settings','reader',{...DEFAULT_SETTINGS,rssHistoryEnabled:value});}} open={open} close={()=>{}} notify={notify}/>{current&&<RssArticleViews fromHistory list={false} article={current} open={open} closeList={()=>{}} notify={notify}/>}</>;
  }
  await act(async()=>root.render(<Host/>));
  const wait=async(check:()=>void)=>vi.waitFor(async()=>{await act(async()=>{await history();});check();});
  await wait(()=>expect(host.textContent).not.toContain('正在读取历史'));
  const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent===label||el.getAttribute('aria-label')===label)!;
  const click=(label:string)=>act(async()=>button(label).click());
  const choose=(value:string)=>act(async()=>{const el=host.querySelector('select')!;el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});
  const done=async()=>{await act(async()=>root.unmount());host.remove();};
  return {host,notify,wait,button,click,choose,done};
}
it('opens saved history after remount without network and moves an active reread to the top',async()=>{
  const now=vi.spyOn(Date,'now').mockReturnValue(100);await storage.recordRssRead(article);now.mockReturnValue(200);await storage.recordRssRead(other);
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Offline')),before=await history(),f=await view();
  try{
    expect(await history()).toEqual(before);expect(f.host.querySelector('.source-row strong')?.textContent).toBe('Article B');
    now.mockReturnValue(300);await act(async()=>f.host.querySelector<HTMLButtonElement>('.source-row:last-child button')!.click());
    await f.wait(()=>expect(f.host.querySelector('.rss-content')?.textContent).toContain('Offline paragraph'));
    expect(fetch).not.toHaveBeenCalled();expect(await history()).toHaveLength(2);
    const close=f.host.querySelector<HTMLButtonElement>('.rss-article')!.closest('[role=dialog]')!.querySelector<HTMLButtonElement>('[aria-label=关闭]')!;
    await act(async()=>close.click());await f.wait(()=>expect(f.host.querySelector('.source-row strong')?.textContent).toBe('Article A'));
  }finally{await f.done();now.mockRestore();fetch.mockRestore();}
});
it('reopens the history title and body even if the favorite has a different title and snapshot',async()=>{
  await storage.saveRssFavorite({...article,content:'Favorite-only body'});await storage.saveRssFavorite(article,{title:'My favorite name',group:'Saved'});
  await storage.recordRssRead(article);const f=await view();
  try{
    await act(async()=>f.host.querySelector<HTMLButtonElement>('.source-row button')!.click());
    await f.wait(()=>expect(f.button('编辑收藏')?.disabled).toBe(false));
    const dialog=f.host.querySelector('.rss-article')!.closest('[role=dialog]')!;
    expect(dialog.getAttribute('aria-label')).toBe(article.title);expect(dialog.textContent).toContain('Offline paragraph');expect(dialog.textContent).not.toContain('Favorite-only body');
    expect((await storage.all<any>('rssFavorites'))[0]).toMatchObject({title:'My favorite name',content:'Favorite-only body'});
  }finally{await f.done();}
});
it('filters by source and confirms only the displayed scope with a count, including cancelled global clear',async()=>{
  await storage.recordRssRead(article);await storage.recordRssRead(other);const f=await view(article);
  try{
    expect(f.host.querySelectorAll('.source-row')).toHaveLength(1);await f.click('清空历史');expect(f.host.textContent).toContain('Public A的 1 条阅读历史');
    await f.click('保留');expect(await history()).toHaveLength(2);
    await f.click('清空历史');await f.click('确认清空');await f.wait(()=>expect(f.host.textContent).toContain('暂无阅读历史'));expect(await history()).toHaveLength(1);
    await f.choose('');await f.click('清空历史');expect(f.host.textContent).toContain('全部来源的 1 条阅读历史');
    await f.click('保留');expect(await history()).toHaveLength(1);
    await f.click('清空历史');await f.click('确认清空');await f.wait(()=>expect(f.button('清空历史').disabled).toBe(true));expect(await history()).toEqual([]);
  }finally{await f.done();}
});
it('persists the switch without deleting history or recording a render',async()=>{
  await storage.recordRssRead(article);const before=await history(),f=await view();
  try{
    await act(async()=>f.host.querySelector<HTMLInputElement>('[role=switch]')!.click());
    expect((await storage.settings()).rssHistoryEnabled).toBe(false);expect(await history()).toEqual(before);
    await act(async()=>f.host.querySelector<HTMLButtonElement>('.source-row button')!.click());
    await f.wait(()=>expect(f.host.querySelector('.rss-content')).not.toBeNull());expect(await history()).toEqual(before);
  }finally{await f.done();}
});
