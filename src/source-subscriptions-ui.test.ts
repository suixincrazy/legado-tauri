import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SourceManager} from './SourceManager';
import * as storage from './storage';
import {strFromU8,unzipSync} from 'fflate';
import {createBackupArchive} from './backup-archive';

const mocks=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('./network',async original=>({...await original<any>(),fetchText:mocks.fetch}));
const url='https://subscriptions.example.test/shared';
const book={id:10,name:'Book subscription',url,type:0,customOrder:4,update:1700000000000,autoUpdate:true,future:{kept:true}};
const other={id:20,name:'RSS subscription',url,type:1,customOrder:5,update:1700000000001};
let host:HTMLDivElement,root:Root,toolbar:HTMLDivElement;
const refresh=vi.fn(async()=>{}),notify=vi.fn();
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,15));});
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.getAttribute('aria-label')===label||node.textContent?.trim()===label)!;
const click=async(node:HTMLElement)=>{expect(node).toBeTruthy();await act(async()=>node.click());await flush();};
const row=(name:string)=>[...host.querySelectorAll<HTMLElement>('.subscription-row')].find(node=>node.textContent?.includes(name))!;
const field=(label:string)=>host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
async function fill(label:string,value:string) {
  await act(async()=>{const node=field(label);Object.getOwnPropertyDescriptor(node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));});
}
async function mount(entries:unknown[]) {
  await storage.put('settings','sourceSubscriptions',entries);
  await act(async()=>root.render(createElement(SourceManager,{sources:[],books:[],refresh,notify,login:()=>{},search:()=>{}})));await flush();
  await click(button('书源管理菜单'));await click(button('书源订阅'));
}
beforeEach(async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();mocks.fetch.mockReset();
  await storage.remove('settings','legacyBackupFiles');await storage.remove('settings','legacyMigration');await storage.remove('settings','sourceSubscriptionsVersion');
  toolbar=document.createElement('div');toolbar.id='source-toolbar';document.body.append(toolbar);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();toolbar.remove();delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;});

it('opens an independent list with upstream names and dates while guarding unknown and scripted subscriptions',async()=>{
  const scripted={...book,id:30,name:'Scripted book subscription',url:url+'/script',js:'result'};
  const future={...other,id:40,name:'Future subscription',type:19};
  await mount([other,scripted,book,future]);
  expect(row(book.name)).toBeTruthy();expect(row(other.name)).toBeTruthy();expect(host.textContent).not.toMatch(/Invalid Date|undefined/);
  expect(row(future.name).textContent).toContain('暂不支持更新');expect(row(scripted.name).textContent).toContain('暂不支持更新');
  expect(host.querySelector('[aria-label="书源链接"]')).toBeNull();expect(button('新增规则订阅')).toBeTruthy();
  expect([...host.querySelectorAll('.subscription-row')].map(node=>node.querySelector('strong')?.textContent)).toEqual([book.name,scripted.name,other.name,future.name]);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('updates one selected subscription without losing its upstream fields, order or same-URL sibling',async()=>{
  const second={...book,id:11,name:'Second book subscription',customOrder:9};
  await mount([book,other,second]);
  mocks.fetch.mockResolvedValue({url,status:200,body:JSON.stringify([{bookSourceName:'Public source',bookSourceUrl:'https://source.example.test'}])});
  await click(button(`检查更新 ${second.name}`));
  await click(button('导入选中 1 项'));
  const saved=await storage.preference<any[]>('sourceSubscriptions',[]);
  expect(saved).toHaveLength(3);expect(saved[0]).toEqual(book);expect(saved[1]).toEqual(other);
  expect(saved[2]).toMatchObject({...second,update:expect.any(Number),count:1});expect(saved[2].update).toBeGreaterThan(second.update);expect(saved[2].updated).toBe(saved[2].update);
  await click(button(`订阅操作 ${book.name}`));await click(button('删除'));
  expect((await storage.preference<any[]>('sourceSubscriptions',[])).map(item=>item.id)).toEqual([20,11]);
});

it('rejects blank and duplicate addresses, cancels without writes and appends a complete new subscription',async()=>{
  await mount([book,other]);await click(button('新增规则订阅'));await click(button('保存'));
  expect(host.textContent).toContain('订阅地址不能为空');expect(await storage.sourceSubscriptions()).toEqual([book,other]);
  await fill('订阅地址',url);await click(button('保存'));expect(host.textContent).toContain('此订阅地址已存在');
  await fill('订阅名称','New subscription');await fill('订阅地址','https://subscriptions.example.test/new');
  await click(field('自动更新'));expect(field('更新间隔（小时）').value).toBe('24');await click(field('静默更新'));
  await click(button('取消'));expect(await storage.sourceSubscriptions()).toEqual([book,other]);
  await click(button('新增规则订阅'));await fill('订阅名称','New subscription');await fill('订阅地址','https://subscriptions.example.test/new');await fill('订阅类型','2');
  await click(field('自动更新'));await fill('更新间隔（小时）','12');await click(field('静默更新'));await click(button('保存'));
  const saved=await storage.sourceSubscriptions();expect(saved).toHaveLength(3);expect(saved[2]).toMatchObject({id:expect.any(Number),name:'New subscription',type:2,customOrder:6,autoUpdate:true,updateInterval:12,silentUpdate:true});
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('edits shared-URL and unknown-type entries without changing their identities or hidden metadata',async()=>{
  const unknown={...other,id:'9223372036854775807',type:19,js:'result',future:{kept:true},autoUpdate:true,updateInterval:6,silentUpdate:true};
  await mount([book,unknown]);await click(button(`编辑 ${unknown.name}`));expect(field('订阅类型').value).toBe('19');
  await fill('订阅名称','Renamed future');await click(button('保存'));
  expect(await storage.sourceSubscriptions()).toEqual([book,{...unknown,name:'Renamed future'}]);
  await click(button('编辑 Renamed future'));await click(field('自动更新'));
  expect(field('更新间隔（小时）').value).toBe('0');expect(field('静默更新').disabled).toBe(true);expect(field('静默更新').checked).toBe(false);await click(button('保存'));
  const files=unzipSync(await createBackupArchive());expect(strFromU8(files['sourceSub.json'])).toContain('"id":9223372036854775807');
  expect(JSON.parse(strFromU8(files['sourceSub.json']))[1]).toMatchObject({type:19,js:'result',future:{kept:true},autoUpdate:false,updateInterval:0,silentUpdate:false});
});
it('persists keyboard ordering and explicit renumbering without changing subscription metadata',async()=>{
  const third={...book,id:30,name:'Third',customOrder:10};await mount([book,other,third]);
  await act(async()=>button(`检查更新 ${book.name}`).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true})));await flush();
  expect([...host.querySelectorAll('.subscription-row strong')].map(node=>node.textContent)).toEqual([other.name,book.name,third.name]);
  expect(await storage.sourceSubscriptions()).toEqual([{...book,customOrder:5},{...other,customOrder:4},third]);
  await click(button('规则订阅菜单'));await click(button('重新编号'));expect((await storage.sourceSubscriptions()).map(row=>row.customOrder)).toEqual([2,1,3]);
});
it('imports only selected RSS rule sources after confirmation and preserves sibling subscriptions and raw fields',async()=>{
  const feed={sourceUrl:'https://rss.example.test/one',sourceName:'RSS one',ruleArticles:'@js:result',future:{keep:true}},second={sourceUrl:'https://rss.example.test/two',sourceName:'RSS two'};
  await mount([book,other]);mocks.fetch.mockResolvedValue({url,status:200,body:JSON.stringify([feed,second])});
  const before=await storage.all('feeds');await click(button(`检查更新 ${other.name}`));expect(await storage.all('feeds')).toEqual(before);
  expect(host.textContent).toContain('暂不支持此订阅源的解析方式');await click(button('取消导入'));expect(await storage.all('feeds')).toEqual(before);expect(await storage.sourceSubscriptions()).toEqual([book,other]);
  await click(button(`检查更新 ${other.name}`));await click(field('选择 RSS two'));await click(button('导入选中 1 项'));
  const feeds=await storage.all<any>('feeds');expect(feeds.find(row=>row.id===feed.sourceUrl)).toEqual({id:feed.sourceUrl,url:feed.sourceUrl,name:feed.sourceName,legacy:feed});expect(feeds.some(row=>row.id===url||row.id===second.sourceUrl)).toBe(false);
  const subscriptions=await storage.sourceSubscriptions();expect(subscriptions[0]).toEqual(book);expect(subscriptions[1]).toMatchObject({...other,count:1,updated:expect.any(Number),update:expect.any(Number)});
  const files=unzipSync(await createBackupArchive());expect(JSON.parse(strFromU8(files['rssSources.json']))).toContainEqual(feed);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
it('compares RSS source timestamps and keeps existing name, group, enabled state and order',async()=>{
  const sourceUrl='https://rss.example.test/existing',old={sourceUrl,sourceName:'Local RSS',lastUpdateTime:100,sourceGroup:'Local',enabled:false,customOrder:8};
  await storage.put('feeds',sourceUrl,{id:sourceUrl,url:sourceUrl,name:old.sourceName,legacy:old});await mount([other]);
  mocks.fetch.mockResolvedValue({url,status:200,body:JSON.stringify([{sourceUrl,sourceName:'Remote RSS',lastUpdateTime:99,sourceGroup:'Remote',enabled:true,customOrder:0}])});
  await click(button(`检查更新 ${other.name}`));expect(field('选择 Remote RSS').checked).toBe(false);await click(button('取消导入'));
  mocks.fetch.mockResolvedValue({url,status:200,body:JSON.stringify([{sourceUrl,sourceName:'Remote RSS',lastUpdateTime:101,sourceGroup:'Remote',enabled:true,customOrder:0}])});
  await click(button(`检查更新 ${other.name}`));expect(field('选择 Remote RSS').checked).toBe(true);await click(button('导入选中 1 项'));
  expect((await storage.all<any>('feeds')).find(row=>row.id===sourceUrl)).toEqual({id:sourceUrl,url:sourceUrl,name:'Local RSS',legacy:{...old,lastUpdateTime:101}});
});
it('previews replacement rules by ID, leaves existing entries unchecked and imports only selected rules',async()=>{
  const subscription={...other,id:30,type:2,name:'Replacement subscription'},old={id:701,name:'Existing replacement',pattern:'old',replacement:'kept',isRegex:false,extra:'retained'},fresh={id:702,name:'New replacement',pattern:'a',replacement:'b',isRegex:false,previewText:'a sample',future:{keep:true}};
  await storage.put('settings','replaceRules',[old]);await mount([book,subscription]);mocks.fetch.mockResolvedValue({url,status:200,body:JSON.stringify([{...old,replacement:'remote'},fresh])});
  await click(button(`检查更新 ${subscription.name}`));expect(field(`选择 ${old.name}`).checked).toBe(false);expect(field(`选择 ${fresh.name}`).checked).toBe(true);
  expect(await storage.preference('replaceRules',[])).toEqual([old]);await click(button('导入选中 1 项'));
  const rules=await storage.preference<any[]>('replaceRules',[]);expect(rules[0]).toEqual(old);expect(rules[1]).toMatchObject(fresh);expect(await storage.sourceSubscriptions()).toEqual([book,expect.objectContaining({...subscription,count:1,update:expect.any(Number),updated:expect.any(Number)})]);
});
it('does not write rules or subscription dates on HTTP failure, wrong content or late results after cancel',async()=>{
  await mount([other]);const before=await storage.all('feeds');
  mocks.fetch.mockResolvedValue({url,status:503,body:'[]'});await click(button(`检查更新 ${other.name}`));expect(host.textContent).toContain('HTTP 503');await click(button('取消导入'));
  mocks.fetch.mockResolvedValue({url,status:200,body:JSON.stringify([{bookSourceUrl:'https://source.example.test',bookSourceName:'Wrong type'}])});await click(button(`检查更新 ${other.name}`));expect(host.textContent).toContain('sourceUrl');await click(button('取消导入'));
  let resolve!:(value:unknown)=>void;mocks.fetch.mockReturnValue(new Promise(done=>{resolve=done;}));await click(button(`检查更新 ${other.name}`));await click(button('取消导入'));
  await act(async()=>resolve({url,status:200,body:'[{"sourceUrl":"https://rss.example.test/late"}]'}));await flush();
  expect(host.querySelector('[aria-label="导入订阅源"]')).toBeNull();expect(await storage.all('feeds')).toEqual(before);expect(await storage.sourceSubscriptions()).toEqual([other]);
});
it('returns from the subscription page and ignores a late book-source response',async()=>{
  const page=document.createElement('div');page.setAttribute('role','dialog');document.body.append(page);page.append(toolbar,host);
  try{
    await mount([book]);let resolve!:(value:unknown)=>void;mocks.fetch.mockReturnValue(new Promise(done=>{resolve=done;}));await click(button(`检查更新 ${book.name}`));
    await act(async()=>page.dispatchEvent(new CustomEvent('legado-page-back',{cancelable:true})));await flush();
    expect(host.querySelector('.rule-subscriptions')).toBeNull();
    await act(async()=>resolve({url,status:200,body:JSON.stringify([{bookSourceName:'Late source',bookSourceUrl:'https://late.example.test'}])}));await flush();
    expect(host.querySelector('.source-import-preview')).toBeNull();expect(await storage.sourceSubscriptions()).toEqual([book]);
  }finally{document.body.append(toolbar,host);page.remove();}
});
