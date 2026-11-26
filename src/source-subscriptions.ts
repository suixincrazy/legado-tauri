import 'core-js/actual/json/parse';
import 'core-js/actual/json/raw-json';

export type SourceSubscription={url:string;id?:number|string;name?:string;type?:number;customOrder?:number;update?:number;updated?:number;count?:number;autoUpdate?:boolean;updateInterval?:number;silentUpdate?:boolean;js?:string|null;[key:string]:unknown};
export const isBookSubscription=(entry:SourceSubscription)=>entry.type===undefined||entry.type===0;
export const subscriptionKey=(entry:SourceSubscription)=>entry.id!==undefined?`id:${entry.id}`:JSON.stringify([entry.type??0,entry.url]);
export const canUpdateSubscription=(entry:SourceSubscription)=>[0,1,2].includes(entry.type??0)&&/^https?:\/\//i.test(entry.url)&&!entry.js?.trim();
export function subscriptionTypeName(entry:SourceSubscription) {return ['书源','订阅源','替换规则','自动识别'][entry.type??0]||`规则类型 ${entry.type}`;}
export function sortedSubscriptions(entries:SourceSubscription[]) {
  return [...entries].sort((a,b)=>(a.customOrder??0)-(b.customOrder??0)||String(a.id??'').localeCompare(String(b.id??''),undefined,{numeric:true}));
}
export function newSubscription(entries:SourceSubscription[],now=Date.now()):SourceSubscription {
  let id=now;while(entries.some(row=>String(row.id)===String(id)))id++;
  return {id,name:'',url:'',type:0,customOrder:Math.max(0,...entries.map(row=>row.customOrder??0))+1,autoUpdate:false,updateInterval:0,silentUpdate:false};
}
export function editSubscription(entries:SourceSubscription[],draft:SourceSubscription,key='') {
  const old=key?entries.find(row=>subscriptionKey(row)===key):undefined,url=draft.url.trim();
  if(!url)throw new Error('订阅地址不能为空');
  if(key&&!old)throw new Error('此订阅已不存在');
  if((!old||url!==old.url.trim())&&entries.some(row=>subscriptionKey(row)!==key&&row.url.trim()===url))throw new Error('此订阅地址已存在');
  if(draft.updateInterval!==undefined&&(!Number.isInteger(draft.updateInterval)||draft.updateInterval<0||draft.updateInterval>2147483647))throw new Error('更新间隔必须是有效的非负整数');
  const saved={...old,...draft,url};validateSubscriptions([saved]);
  return old?entries.map(row=>subscriptionKey(row)===key?saved:row):[...entries,saved];
}
export function renumberSubscriptions(entries:SourceSubscription[]) {
  const order=new Map(sortedSubscriptions(entries).map((row,index)=>[subscriptionKey(row),index+1]));
  return entries.map(row=>({...row,customOrder:order.get(subscriptionKey(row))!}));
}
export function moveSubscriptionRelative(entries:SourceSubscription[],key:string,target:string,after:boolean) {
  if(key===target||![key,target].every(id=>entries.some(row=>subscriptionKey(row)===id)))return entries;
  const ordered=sortedSubscriptions(entries),orders=ordered.map(row=>row.customOrder??0);
  const [moved]=ordered.splice(ordered.findIndex(row=>subscriptionKey(row)===key),1);
  ordered.splice(ordered.findIndex(row=>subscriptionKey(row)===target)+(after?1:0),0,moved);
  const duplicate=new Set(orders).size!==orders.length;
  const order=new Map(ordered.map((row,index)=>[subscriptionKey(row),duplicate?index+1:orders[index]]));
  return entries.map(row=>row.customOrder===order.get(subscriptionKey(row))?row:{...row,customOrder:order.get(subscriptionKey(row))!});
}
export function validateSubscriptions(value:unknown):asserts value is SourceSubscription[] {
  if(!Array.isArray(value)||value.some(row=>!row||typeof row!=='object'||Array.isArray(row)||typeof row.url!=='string'||row.type!==undefined&&!Number.isInteger(row.type)||row.id!==undefined&&typeof row.id!=='string'&&!Number.isInteger(row.id)||row.customOrder!==undefined&&!Number.isFinite(row.customOrder)||row.js!=null&&typeof row.js!=='string'))throw new Error('备份规则订阅损坏');
}
export function parseSubscriptions(text:string):SourceSubscription[] {
  const ids=new WeakMap<object,string>();
  const rows=JSON.parse(text,function(this:object,key:string,value:any,context?:{source?:string}) {
    if(key==='id'&&typeof value==='number'&&!Number.isSafeInteger(value)&&context?.source&&/^-?\d+$/.test(context.source))ids.set(this,context.source);
    return value;
  });
  validateSubscriptions(rows);
  return rows.map(row=>ids.has(row)?{...row,id:ids.get(row)!}:row);
}
export function serializeSubscriptions(entries:SourceSubscription[]) {
  return JSON.stringify(entries.map(row=>typeof row.id==='string'&&/^-?(0|[1-9]\d*)$/.test(row.id)?{...row,id:(JSON as any).rawJSON(row.id)}:row));
}
export function mergeSubscriptions(current:SourceSubscription[],incoming:SourceSubscription[]) {
  const entries=new Map(current.map(row=>[subscriptionKey(row),row]));
  for(const row of incoming)entries.set(subscriptionKey(row),row);
  return [...entries.values()];
}
export function migrateSourceSubscriptions(preferences:Record<string,any>) {
  const current:unknown=preferences.sourceSubscriptions;
  if(current!==undefined)validateSubscriptions(current);
  if(preferences.sourceSubscriptionsVersion===1)return;
  const archived=preferences.legacyBackupFiles?.['sourceSub.json'];
  const legacy=archived?parseSubscriptions(new TextDecoder().decode(Uint8Array.from(atob(archived),char=>char.charCodeAt(0)))):preferences.legacyMigration?.tables?.ruleSubs;
  if(legacy!==undefined) {
    validateSubscriptions(legacy);
    if(current===undefined)preferences.sourceSubscriptions=legacy;
    else {
      const mapped=current.map(row=>({...legacy.find(original=>row.id!==undefined?subscriptionKey(original)===subscriptionKey(row):original.url===row.url&&(original.type??0)===(row.type??0)),...row}));
      const retained=legacy.filter(row=>!isBookSubscription(row)||mapped.some(entry=>subscriptionKey(entry)===subscriptionKey(row)));
      preferences.sourceSubscriptions=mergeSubscriptions(retained,mapped);
    }
  }
  if(preferences.sourceSubscriptions!==undefined)preferences.sourceSubscriptionsVersion=1;
}
export function updateBookSubscription(entries:SourceSubscription[],url:string,count:number,now=Date.now(),key='') {
  const old=key?entries.find(row=>subscriptionKey(row)===key):entries.find(row=>isBookSubscription(row)&&row.url===url);
  if(old&&(!isBookSubscription(old)||!canUpdateSubscription(old)))throw new Error('暂不支持此规则订阅更新');
  let id=now;while(entries.some(row=>String(row.id)===String(id)))id++;
  const entry:SourceSubscription={id,name:url,type:0,customOrder:Math.max(0,...entries.map(row=>Number(row.customOrder)||0))+1,autoUpdate:false,...old,url,updated:now,update:now,count};
  return old?entries.map(row=>subscriptionKey(row)===subscriptionKey(old)?entry:row):[...entries,entry];
}
export function recordSubscriptionImport(entries:SourceSubscription[],key:string,count:number,now=Date.now()) {
  if(!entries.some(row=>subscriptionKey(row)===key))throw new Error('此订阅已不存在');
  return entries.map(row=>subscriptionKey(row)===key?{...row,update:now,updated:now,count}:row);
}
