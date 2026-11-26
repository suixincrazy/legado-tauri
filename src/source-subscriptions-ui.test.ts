import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SourceManager} from './SourceManager';
import * as storage from './storage';

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
async function mount(entries:unknown[]) {
  await storage.put('settings','sourceSubscriptions',entries);
  await act(async()=>root.render(createElement(SourceManager,{sources:[],books:[],refresh,notify,login:()=>{},search:()=>{}})));await flush();
  await click(button('书源管理菜单'));await click(button('书源订阅'));
}
beforeEach(async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();mocks.fetch.mockReset();
  await storage.remove('settings','legacyBackupFiles');await storage.remove('settings','legacyMigration');
  toolbar=document.createElement('div');toolbar.id='source-toolbar';document.body.append(toolbar);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();toolbar.remove();delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;});

it('shows upstream names and dates while guarding non-book and scripted subscriptions from book-source requests',async()=>{
  const scripted={...book,id:30,name:'Scripted book subscription',url:url+'/script',js:'result'};
  await mount([other,scripted,book]);
  expect(row(book.name)).toBeTruthy();expect(row(other.name)).toBeTruthy();expect(host.textContent).not.toMatch(/Invalid Date|undefined/);
  expect(row(other.name).textContent).toContain('暂不支持更新');expect(row(scripted.name).textContent).toContain('暂不支持更新');
  expect([...row(other.name).querySelectorAll('button')].some(node=>node.textContent==='检查更新')).toBe(false);
  expect([...host.querySelectorAll('.subscription-row')].map(node=>node.querySelector('strong')?.textContent)).toEqual([book.name,scripted.name,other.name]);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('updates one selected subscription without losing its upstream fields, order or same-URL sibling',async()=>{
  const second={...book,id:11,name:'Second book subscription',customOrder:9};
  await mount([book,other,second]);
  mocks.fetch.mockResolvedValue({url,status:200,body:JSON.stringify([{bookSourceName:'Public source',bookSourceUrl:'https://source.example.test'}])});
  await click([...row(second.name).querySelectorAll('button')].find(node=>node.textContent==='检查更新')!);
  await click(button('导入选中 1 项'));
  const saved=await storage.preference<any[]>('sourceSubscriptions',[]);
  expect(saved).toHaveLength(3);expect(saved[0]).toEqual(book);expect(saved[1]).toEqual(other);
  expect(saved[2]).toMatchObject({...second,update:expect.any(Number),count:1});expect(saved[2].update).toBeGreaterThan(second.update);expect(saved[2].updated).toBe(saved[2].update);
  await click(button('书源管理菜单'));await click(button('书源订阅'));
  await click([...row(book.name).querySelectorAll('button')].find(node=>node.textContent==='移除订阅')!);
  expect((await storage.preference<any[]>('sourceSubscriptions',[])).map(item=>item.id)).toEqual([20,11]);
});
