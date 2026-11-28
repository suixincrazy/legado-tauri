import 'fake-indexeddb/auto';
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {openDB} from 'idb';
import {beforeEach,expect,it,vi} from 'vitest';
import {RssArticleViews} from './RssFavorites';
import {parseFeedArticles,validateFavorites,type FeedArticle,type RssFavorite} from './rss-favorites';
import * as storage from './storage';
import {createBackupArchive,readBackupArchive,defaultContent} from './backup-archive';
import {inspectBackup} from './backup';
import {newBook} from './model';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const article:FeedArticle={sourceUrl:'https://feeds.test/a',sourceName:'Public A',url:'https://articles.test/one',title:'Public Article',content:'Saved first paragraph\nOffline second paragraph'};
beforeEach(async()=>{const db=await openDB('legado-reader');for(const name of ['books','sources','records','feeds','settings','sourceState','rssFavorites'])await db.clear(name);db.close();});
const favorites=()=>storage.all<RssFavorite>('rssFavorites');
it('retains feed provenance, resolves relative RSS URLs and saves the visible body',()=>{
  const result=parseFeedArticles('<rss><channel><title>Public</title><item><title>Article</title><link>../articles/one</link><description><![CDATA[<p>First</p><script>bad()</script><p>Second</p>]]></description></item></channel></rss>','https://feeds.test/original','https://redirect.test/feeds/current');
  expect(result.articles).toEqual([{sourceUrl:'https://feeds.test/original',sourceName:'Public',url:'https://redirect.test/articles/one',title:'Article',content:'First\nSecond'}]);
});
it('selects the Atom alternate link and inherits xml:base after a redirect',()=>{
  const result=parseFeedArticles('<feed xmlns="http://www.w3.org/2005/Atom" xml:base="/posts/"><title>Atom</title><entry xml:base="2026/"><title>Entry</title><link rel="self" href="entry.xml"/><link rel="alternate" href="article.html"/><summary>Body</summary></entry></feed>','https://feed.test/atom','https://cdn.test/atom.xml','Saved feed name');
  expect(result.articles[0]).toMatchObject({sourceUrl:'https://feed.test/atom',sourceName:'Saved feed name',url:'https://cdn.test/posts/2026/article.html'});
});
it('rejects malformed XML and avoids merging unrelated linkless entries',()=>{
  expect(()=>parseFeedArticles('<rss>','https://feed.test/','https://feed.test/')).toThrow('有效');
  const items=parseFeedArticles('<rss><channel><item><title>A</title><guid isPermaLink="false">opaque</guid></item><item><title>B</title><link>javascript:bad()</link></item><item><guid>https://public.test/guid</guid></item></channel></rss>','https://feed.test/','https://feed.test/').articles;
  expect(items.map(a=>a.url)).toEqual(['','','https://public.test/guid']);
  expect(()=>validateFavorites([{...items[0],group:'Default',savedAt:1}])).toThrow('收藏损坏');
});
it('keeps same-URL articles from different origins and does not overwrite a saved snapshot on repeated save',async()=>{
  await Promise.all([storage.saveRssFavorite(article),storage.saveRssFavorite({...article,content:'Later body'})]);
  const first=(await favorites())[0];
  await storage.saveRssFavorite({...article,sourceUrl:'https://feeds.test/b',sourceName:'Public B'});
  expect(await favorites()).toHaveLength(2);expect((await favorites()).find(row=>row.sourceUrl===article.sourceUrl)).toEqual(first);
});
it('edits title and group without changing the saved body, identity or time',async()=>{
  await storage.saveRssFavorite(article);const before=(await favorites())[0];
  await storage.saveRssFavorite({...article,content:'New network body'},{title:' Edited ',group:' Science '});
  expect(await favorites()).toEqual([{...before,title:'Edited',group:'Science'}]);
  await storage.saveRssFavorite(article,{title:' ',group:' '});expect(await favorites()).toEqual([{...before,title:'Edited',group:'Science'}]);
});
it('does not recreate a removed favorite from an obsolete editor',async()=>{
  await expect(storage.saveRssFavorite(article,{title:'Edit',group:'Group'})).rejects.toThrow('已移除');expect(await favorites()).toEqual([]);
});
it('removes exactly one origin, one group or all favorites and leaves unrelated stores unchanged',async()=>{
  await storage.put('feeds','a',{id:'a',name:'Feed',url:article.sourceUrl});
  await storage.saveRssFavorite(article);await storage.saveRssFavorite({...article,sourceUrl:'https://feeds.test/b'});await storage.saveRssFavorite({...article,url:'https://articles.test/two'});
  await storage.saveRssFavorite(article,{title:'One',group:'Keep'});
  await storage.removeRssFavorites({article:{...article,sourceUrl:'https://feeds.test/b'}});expect(await favorites()).toHaveLength(2);
  await storage.removeRssFavorites({group:'默认分组'});expect((await favorites()).map(row=>row.group)).toEqual(['Keep']);
  await storage.removeRssFavorites('all');expect(await favorites()).toEqual([]);expect(await storage.all('feeds')).toHaveLength(1);
});
it('restores favorites independently of feed sources and settings, including snapshots after source deletion',async()=>{
  const book={...newBook('Public Book','txt',[{title:'First',content:'Protected body'}]),id:'public-book'};
  await storage.put('books',book.id,book);await storage.put('feeds','public-feed',{id:'public-feed',url:article.sourceUrl,name:'Public A'});await storage.saveRssFavorite(article);
  const expected=await favorites(),zip=await createBackupArchive({...defaultContent,sources:false,settings:false});
  expect((await inspectBackup(zip,'')).summary).toContain('1 篇文章收藏');
  const data=await readBackupArchive(zip);expect(data.feeds).toEqual([]);expect(data.rssFavorites).toEqual(expected);
  await storage.removeRssFavorites('all');await storage.remove('feeds','public-feed');await storage.restore(JSON.stringify(data));await storage.restore(JSON.stringify(data));
  expect(await favorites()).toEqual(expected);expect(await storage.all('books')).toEqual([book]);expect(await storage.all('feeds')).toEqual([]);
});
it('honors excluded favorites and ignored restore while preserving existing favorites',async()=>{
  await storage.saveRssFavorite(article);const before=await favorites(),snapshot=JSON.parse(await storage.backup());
  const data=await readBackupArchive(await createBackupArchive({...defaultContent,rssFavorites:false}));expect(data.rssFavorites).toBeUndefined();
  await storage.saveRssFavorite(article,{title:'Local title',group:'Local'});
  const local=await favorites();await storage.restore(JSON.stringify(data));expect(await favorites()).toEqual(local);
  await storage.restore(JSON.stringify(snapshot),['rssFavorites']);expect(await favorites()).toEqual(local);
  await storage.restore(JSON.stringify(snapshot));expect(await favorites()).toEqual(before);
});
it('accepts older own-app backups without the new collection and keeps saved articles',async()=>{
  await storage.saveRssFavorite(article);const before=await favorites(),data=JSON.parse(await storage.backup());delete data.rssFavorites;
  await storage.restore(JSON.stringify(data));expect(await favorites()).toEqual(before);
});
it('rejects invalid and duplicate favorite payloads before any library transaction',async()=>{
  await storage.saveRssFavorite(article);const original=JSON.parse(await storage.backup()),row=original.rssFavorites[0];
  for(const invalid of [null,[{...row,url:''}],[{...row,content:null}],[{...row,savedAt:-1}],[{...row,group:7}],[row,row]]){
    await expect(storage.restore(JSON.stringify({...original,rssFavorites:invalid,feeds:[{id:'new',url:'https://new.test'}]}))).rejects.toThrow('收藏');
    const after=JSON.parse(await storage.backup());delete after.created;const expected={...original};delete expected.created;expect(after).toEqual(expected);
  }
});
async function view(initial:FeedArticle|null=null,list=true){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),notify=vi.fn();
  function Host(){const [current,setCurrent]=useState(initial),[shown,setShown]=useState(list);return <RssArticleViews list={shown} article={current} open={setCurrent} closeList={()=>setShown(false)} notify={notify}/>;}
  await act(async()=>root.render(<Host/>));
  const wait=async(check:()=>void)=>vi.waitFor(async()=>{await act(async()=>{await favorites();});check();});
  if(list)await wait(()=>expect(host.textContent).not.toContain('正在读取收藏'));
  else if(initial?.url)await wait(()=>expect(host.querySelector<HTMLButtonElement>('[aria-label="收藏文章"],[aria-label="编辑收藏"]')?.disabled).toBe(false));
  const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.getAttribute('aria-label')===text||el.textContent===text)!;
  const click=(text:string)=>act(async()=>{button(text).click();});
  const done=async()=>{await act(async()=>root.unmount());host.remove();};
  return {host,notify,button,click,done,wait};
}
it('opens saved body offline after remount and confirms individual deletion without affecting another origin',async()=>{
  await storage.saveRssFavorite(article);await storage.saveRssFavorite({...article,sourceUrl:'https://feeds.test/b',sourceName:'Public B',title:'Other origin'});
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Offline')),f=await view();
  try{
    await f.click('Public ArticlePublic A');expect(f.host.querySelector('.rss-content')?.textContent).toContain('Offline second paragraph');expect(fetch).not.toHaveBeenCalled();
    await f.click('编辑收藏');await f.click('取消收藏');await f.click('保留');expect(await favorites()).toHaveLength(2);
    await f.click('取消收藏');await f.click('确认删除');await f.wait(()=>expect(f.host.querySelector('.rss-article')).toBeNull());expect((await favorites()).map(row=>row.sourceName)).toEqual(['Public B']);
  }finally{await f.done();fetch.mockRestore();}
});
it('requires confirmation for group and global deletion and updates the selected group after removal',async()=>{
  await storage.saveRssFavorite(article);await storage.saveRssFavorite({...article,url:'https://articles.test/two',title:'Second'});await storage.saveRssFavorite(article,{title:article.title,group:'A'});
  const f=await view();try{
    const select=f.host.querySelector('select')!;await act(async()=>{select.value='A';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await f.click('删除本组');await f.click('保留');expect(await favorites()).toHaveLength(2);
    await f.click('删除本组');await f.click('确认删除');await f.wait(()=>expect(f.host.querySelector('select')!.value).toBe('默认分组'));expect(await favorites()).toHaveLength(1);
    await f.click('删除全部');await f.click('确认删除');await f.wait(()=>expect(f.host.textContent).toContain('暂无收藏文章'));
  }finally{await f.done();}
});
it('immediately saves a new article and retains it when closing the title editor',async()=>{
  const f=await view(article,false);try{
    await f.click('收藏文章');await f.wait(()=>expect(f.host.querySelector('.favorite-form')).not.toBeNull());
    const close=f.host.querySelector<HTMLButtonElement>('.favorite-form button[type=button]:not(.danger)')!;await act(async()=>close.click());
    expect(await favorites()).toHaveLength(1);expect(f.button('编辑收藏')).toBeTruthy();
  }finally{await f.done();}
});
it('shows a readable linkless article with a disabled favorite button',async()=>{
  const f=await view({...article,url:''},false);try{expect(f.button('收藏文章').disabled).toBe(true);expect(f.host.textContent).toContain('Offline second paragraph');}finally{await f.done();}
});
