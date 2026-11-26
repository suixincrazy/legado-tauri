import {useEffect,useState} from 'react';
import type {Feed} from './model';
import type {ReplaceRule} from './replacement-engine';
import * as storage from './storage';
import {parseRuleSubscriptionImport,readSubscriptionText,rssFeed,rssSourceSupport,type RuleSubscriptionImport} from './rule-subscription-import';
import {subscriptionKey,type SourceSubscription} from './source-subscriptions';
import {safeSourceError} from './source-management';
import {Modal} from './ui';

export function SubscriptionImport({entry,close,imported}:{entry:SourceSubscription;close:()=>void;imported:(entries:SourceSubscription[])=>Promise<void>}) {
  const [incoming,setIncoming]=useState<RuleSubscriptionImport|null>(null),[selected,setSelected]=useState(new Set<string>()),[existing,setExisting]=useState(new Set<string>()),[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[preserve,setPreserve]=useState(true);
  useEffect(()=>{
    let active=true;
    void (async()=>{
      try{
        const data=parseRuleSubscriptionImport(await readSubscriptionText(entry),entry.type!);
        const rows=data.type===1?await storage.all<Feed>('feeds'):await storage.preference<ReplaceRule[]>('replaceRules',[]),old=new Map(rows.map(row=>[String(row.id),row]));
        const selection=data.type===1?data.items.filter(row=>!old.has(row.sourceUrl)||Number((old.get(row.sourceUrl) as Feed).legacy?.lastUpdateTime??0)<(row.lastUpdateTime??0)).map(row=>row.sourceUrl):data.items.filter(row=>!old.has(String(row.id))).map(row=>String(row.id));
        if(active){setIncoming(data);setSelected(new Set(selection));setExisting(new Set(old.keys()));}
      }catch(e){if(active)setError(safeSourceError(e));}finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;};
  },[entry]);
  const rows=incoming?.type===1?incoming.items.map(row=>({key:row.sourceUrl,name:row.sourceName||row.sourceUrl,detail:row.sourceUrl,support:rssSourceSupport(rssFeed(row))})):incoming?.items.map(row=>({key:String(row.id),name:row.name,detail:row.pattern,support:''}))||[];
  return <Modal title={entry.type===1?'导入订阅源':'导入替换规则'} page={false} centered close={()=>{if(!saving)close();}}><div className="subscription-import">
    {loading&&<p role="status">正在获取规则</p>}{error&&<p className="warning" role="alert">{error}</p>}{incoming&&<><p>共 {rows.length} 项，已有 {rows.filter(row=>existing.has(row.key)).length} 项。</p>{incoming.type===1&&<label className="check-line"><input type="checkbox" disabled={saving} checked={preserve} onChange={event=>setPreserve(event.target.checked)}/>保留已有名称、分组、启用状态和排序</label>}<div className="source-actions"><button disabled={saving} onClick={()=>setSelected(new Set(rows.map(row=>row.key)))}>全选</button><button disabled={saving} onClick={()=>setSelected(new Set())}>全不选</button></div>
      {rows.map(row=><label className="source-import-item" key={row.key}><input type="checkbox" aria-label={`选择 ${row.name}`} disabled={saving} checked={selected.has(row.key)} onChange={()=>setSelected(current=>{const next=new Set(current);next.has(row.key)?next.delete(row.key):next.add(row.key);return next;})}/><span><strong>{row.name}</strong><small>{existing.has(row.key)?'已有':'新增'} · {row.detail}</small>{row.support&&<small>{row.support}</small>}</span></label>)}
    </>}<div className="source-actions"><button className="text-button" disabled={saving} onClick={close}>取消导入</button><button className="text-button" disabled={saving||!incoming||!selected.size} onClick={async()=>{if(!incoming)return;setSaving(true);setError('');try{const entries=await storage.importSubscribedRules(incoming,selected,subscriptionKey(entry),preserve);await imported(entries);close();}catch(e){setError(safeSourceError(e));}finally{setSaving(false);}}}>导入选中 {selected.size} 项</button></div>
  </div></Modal>;
}
