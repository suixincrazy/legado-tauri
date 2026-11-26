import type {Feed} from './model';
import {fetchText} from './network';
import {parseReplaceRules,type ReplaceRule} from './replacement-engine';
import {canUpdateSubscription,type SourceSubscription} from './source-subscriptions';

export type RssSource={sourceUrl:string;sourceName?:string;lastUpdateTime?:number;customOrder?:number;enabled?:boolean;sourceGroup?:string|null;[key:string]:unknown};
export type RuleSubscriptionImport={type:1;items:RssSource[]}|{type:2;items:ReplaceRule[]};
export async function readSubscriptionText(entry:SourceSubscription) {
  if(!canUpdateSubscription(entry))throw new Error('暂不支持此规则订阅更新');
  const noAgent=entry.url.endsWith('#requestWithoutUA');
  const response=await fetchText({url:noAgent?entry.url.slice(0,-'#requestWithoutUA'.length):entry.url,...noAgent?{headers:{'User-Agent':'null'}}:{}});
  if(response.status!==undefined&&(response.status<200||response.status>=300))throw new Error(`订阅获取失败（HTTP ${response.status}）`);
  return response.body;
}
export function parseRuleSubscriptionImport(text:string,type:number):RuleSubscriptionImport {
  if(type===1){
    const data=JSON.parse(text),rows=Array.isArray(data)?data:[data];
    if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)||typeof row.sourceUrl!=='string'||!row.sourceUrl.trim()||row.sourceName!==undefined&&typeof row.sourceName!=='string'||row.lastUpdateTime!==undefined&&!Number.isFinite(row.lastUpdateTime)||row.enabled!==undefined&&typeof row.enabled!=='boolean'))throw new Error('订阅源需要包含 sourceUrl 的规则 JSON');
    return {type:1,items:[...new Map(rows.map((row:RssSource)=>[row.sourceUrl,row])).values()]};
  }
  if(type===2){
    const data=JSON.parse(text),rows=Array.isArray(data)?data:[data];
    if(rows.some(row=>row?.id!==undefined&&!Number.isSafeInteger(row.id)))throw new Error('替换规则 ID 超出安全整数范围或格式不正确，暂不支持导入');
    const rules=parseReplaceRules(text,false);
    if(rules.some(rule=>!Number.isSafeInteger(rule.id)))throw new Error('替换规则 ID 超出安全整数范围，暂不支持导入');
    return {type:2,items:[...new Map(rules.map(rule=>[String(rule.id),rule])).values()]};
  }
  throw new Error('暂不支持此规则订阅更新');
}
export function rssFeed(source:RssSource,existing?:Feed,preserve=false):Feed {
  const old=existing?.legacy;
  const legacy=preserve&&existing?{...source,sourceName:existing.name,sourceGroup:old?.sourceGroup,enabled:old?.enabled??true,customOrder:old?.customOrder??0}:source;
  return {id:source.sourceUrl,name:legacy.sourceName||source.sourceUrl,url:source.sourceUrl,legacy};
}
export function rssSourceSupport(feed:Feed) {
  const source=feed.legacy;
  if(source?.enabled===false)return '订阅源已停用';
  if(!/^https?:\/\//i.test(feed.url)||source?.singleUrl||['jsLib','header','loginUrl','loginUi','loginCheckJs','coverDecodeJs','sortUrl','ruleArticles','ruleNextPage','ruleTitle','rulePubDate','ruleDescription','ruleImage','ruleLink','ruleContent','nextContentUrl','contentWhitelist','contentBlacklist','shouldOverrideUrlLoading','injectJs','preloadJs','startHtml','startStyle','startJs'].some(key=>source?.[key]))return '规则已保存，暂不支持此订阅源的解析方式';
  return '';
}
