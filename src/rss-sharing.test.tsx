import 'fake-indexeddb/auto';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {openDB} from 'idb';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {RssArticleViews} from './RssFavorites';
import type {FeedArticle} from './rss-favorites';
import {DEFAULT_SETTINGS,newBook} from './model';
import * as storage from './storage';
import {readBackupArchive,createBackupArchive} from './backup-archive';

const native=vi.hoisted(()=>({enabled:false}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>native.enabled,invoke:vi.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const article:FeedArticle={sourceUrl:'https://feed.test/rss',sourceName:'Public feed',url:'https://article.test/story?q=%E4%B8%AD%E6%96%87#section-2',title:'History title',content:'History body'};
beforeEach(async()=>{native.enabled=false;const db=await openDB('legado-reader');for(const name of db.objectStoreNames)await db.clear(name);db.close();vi.stubGlobal('navigator',{});});
afterEach(()=>{vi.restoreAllMocks();vi.resetAllMocks();vi.unstubAllGlobals();});
async function view(row=article,fromHistory=false){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),open=vi.fn(),notify=vi.fn();
  const render=(next:FeedArticle|null)=>act(async()=>root.render(<RssArticleViews list={false} article={next} open={open} closeList={()=>{}} notify={notify} fromHistory={fromHistory}/>));
  await render(row);
  const wait=async(check:()=>void)=>vi.waitFor(async()=>{await act(async()=>{await storage.all('rssFavorites');});check();});
  await wait(()=>expect(host.textContent).not.toContain('正在读取'));
  const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent===label||el.getAttribute('aria-label')===label)!;
  const click=(label:string)=>act(async()=>button(label).click());
  const done=async()=>{await act(async()=>root.unmount());host.remove();};
  return {host,open,notify,render,wait,button,click,done};
}
async function snapshot(){const data=JSON.parse(await storage.backup());delete data.created;return data;}
it.each(['Android','iPad'])('shares only the article URL through the %s native bridge without body or source metadata',async(userAgent)=>{
  native.enabled=true;vi.stubGlobal('navigator',{userAgent});vi.mocked(invoke).mockResolvedValue({json:'{"value":true}'});
  const f=await view();try{
    await f.click('分享文章链接');
    const args=vi.mocked(invoke).mock.calls[0];
    expect(args[0]).toBe(userAgent==='Android'?'java_bridge':'source_browser');
    expect(userAgent==='Android'?JSON.parse((args[1] as any).payload):(args[1] as any).request).toEqual(userAgent==='Android'?{operation:'share',title:'分享文章链接',text:article.url}:{mode:'share',title:'分享文章链接',text:article.url});
    expect(f.host.querySelector('.rss-share')).toBeNull();expect(f.open).not.toHaveBeenCalled();expect(f.notify).not.toHaveBeenCalled();
  }finally{await f.done();}
});
it('browser fallback previews the exact link, only copies on request and closes before the reader',async()=>{
  const writeText=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{clipboard:{writeText}});const f=await view();
  try{
    await f.click('分享文章链接');expect(writeText).not.toHaveBeenCalled();
    expect(f.host.querySelector<HTMLTextAreaElement>('[aria-label="文章链接"]')!.value).toBe(article.url);
    await f.click('复制链接');expect(writeText).toHaveBeenCalledExactlyOnceWith(article.url);expect(f.notify).toHaveBeenLastCalledWith('文章链接已复制');
    await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(f.host.querySelector('.rss-share')).toBeNull();expect(f.host.querySelector('.rss-content')?.textContent).toBe('History body');expect(f.open).not.toHaveBeenCalled();
  }finally{await f.done();}
});
it('keeps the link selectable and allows retry when clipboard access fails',async()=>{
  const writeText=vi.fn().mockRejectedValueOnce(new Error('Denied')).mockResolvedValue(undefined);vi.stubGlobal('navigator',{clipboard:{writeText}});const f=await view();
  try{
    await f.click('分享文章链接');await f.click('复制链接');expect(f.host.querySelector('[role=alert]')?.textContent).toContain('手动复制');
    expect(f.host.querySelector<HTMLTextAreaElement>('textarea')!.readOnly).toBe(true);expect(f.button('复制链接').disabled).toBe(false);
    await f.click('复制链接');expect(writeText).toHaveBeenCalledTimes(2);expect(f.host.querySelector('[role=alert]')).toBeNull();
  }finally{await f.done();}
});
it.each(['','javascript:alert(1)','file:///local.txt'])('keeps reading but disables sharing for an unusable URL %s',async(url)=>{
  const share=vi.fn();vi.stubGlobal('navigator',{share});const f=await view({...article,url});
  try{expect(f.button('分享文章链接').disabled).toBe(true);await f.click('分享文章链接');expect(share).not.toHaveBeenCalled();expect(f.host.textContent).toContain('没有可收藏或分享的文章地址');expect(f.host.textContent).toContain('History body');}finally{await f.done();}
});
it('does not open a fallback or report success after cancelling a browser share sheet',async()=>{
  const share=vi.fn().mockRejectedValue(new DOMException('Cancelled','AbortError'));vi.stubGlobal('navigator',{share});const f=await view();
  try{await f.click('分享文章链接');expect(share).toHaveBeenCalledExactlyOnceWith({text:article.url,title:'分享文章链接'});expect(f.host.querySelector('.rss-share')).toBeNull();expect(f.notify).not.toHaveBeenCalled();expect(f.button('分享文章链接').disabled).toBe(false);}finally{await f.done();}
});
it.each([false,true])('provides a copy fallback when sharing fails, native=%s',async(enabled)=>{
  native.enabled=enabled;vi.stubGlobal('navigator',{userAgent:'Android',share:vi.fn().mockRejectedValue(new Error('Denied'))});vi.mocked(invoke).mockResolvedValue({json:'{"error":"Unavailable"}'});const f=await view();
  try{await f.click('分享文章链接');expect(f.host.querySelector('.rss-share')).not.toBeNull();expect(f.host.querySelector('[role=alert]')?.textContent).toBe('系统分享未能打开。');expect(f.open).not.toHaveBeenCalled();}finally{await f.done();}
});
it('deduplicates pending share requests and ignores late failures after changing the article',async()=>{
  let reject!:(reason:Error)=>void;const share=vi.fn().mockImplementation(()=>new Promise((_,bad)=>{reject=bad;}));vi.stubGlobal('navigator',{share});const f=await view();
  try{
    await act(async()=>{f.button('分享文章链接').click();f.button('分享文章链接').click();});expect(share).toHaveBeenCalledTimes(1);
    await f.render({...article,url:'https://article.test/new',title:'New article'});await act(async()=>reject(new Error('Late failure')));
    expect(f.host.querySelector('.rss-share')).toBeNull();expect(f.host.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('New article');
  }finally{await f.done();}
});
it('shares distinct history and favorite snapshots without modifying their titles, times, library or own backups',async()=>{
  const book={...newBook('Kept book','txt',[{title:'Chapter',content:'Saved book body'}]),id:'kept'};
  await storage.put('books',book.id,book);await storage.put('settings','reader',{...DEFAULT_SETTINGS,rssHistoryEnabled:false});
  await storage.saveRssFavorite({...article,title:'Favorite title',content:'Favorite body'});
  const db=await openDB('legado-reader');await db.put('rssHistory',{...article,readAt:25},[article.sourceUrl,article.url]);db.close();
  const original=await snapshot(),share=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{share});
  for(const [row,fromHistory,title] of [[article,true,'History title'],[original.rssFavorites[0],false,'Favorite title']] as const){
    const f=await view(row,fromHistory);try{await f.wait(()=>expect(f.button('编辑收藏').disabled).toBe(false));expect(f.host.querySelector('[role=dialog]')!.getAttribute('aria-label')).toBe(title);await f.click('分享文章链接');expect(await snapshot()).toEqual(original);}finally{await f.done();}
  }
  expect(share.mock.calls.map(call=>call[0].text)).toEqual([article.url,article.url]);
  const archive=await readBackupArchive(await createBackupArchive());expect(archive.rssHistory).toEqual(original.rssHistory);expect(archive.rssFavorites).toEqual(original.rssFavorites);expect(archive.books).toEqual(original.books);
});
