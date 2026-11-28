import {htmlText} from './import';

export type FeedArticle={sourceUrl:string;sourceName:string;url:string;title:string;content:string};
export type RssFavorite=FeedArticle&{group:string;savedAt:number};
export const defaultFavoriteGroup='默认分组';
export function articleSnapshot({sourceUrl,sourceName,url,title,content}:FeedArticle):FeedArticle{return {sourceUrl,sourceName,url,title,content};}
export function articleKey(article:Pick<FeedArticle,'sourceUrl'|'url'>):[string,string] {return [article.sourceUrl,article.url];}
export function sameArticle(a:FeedArticle,b:FeedArticle){return a.sourceUrl===b.sourceUrl&&a.url===b.url;}
function httpUrl(value:string,base?:string){
  if(!value.trim())return '';
  try{const url=new URL(value,base);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch{return '';}
}
function linkBase(el:Element,responseUrl:string){
  const bases:string[]=[];
  for(let node:Element|null=el;node;node=node.parentElement){
    const base=node.getAttribute('xml:base');if(base)bases.unshift(base);
  }
  return bases.reduce((base,path)=>httpUrl(path,base)||base,responseUrl);
}
export function parseFeedArticles(xml:string,sourceUrl:string,responseUrl:string,knownName?:string){
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw new Error('订阅不是有效的 RSS 或 Atom');
  const sourceName=knownName||doc.querySelector('channel > title,feed > title')?.textContent?.trim()||new URL(sourceUrl).hostname||'订阅';
  const articles:FeedArticle[]=Array.from(doc.querySelectorAll('item,entry')).map(el=>{
    const links=Array.from(el.children).filter(child=>child.localName==='link');
    const link=links.find(child=>!child.getAttribute('rel')||child.getAttribute('rel')==='alternate');
    const guid=el.querySelector('guid'),permalink=guid?.getAttribute('isPermaLink')?.toLowerCase()!=='false'?guid?.textContent:'';
    const url=(link&&httpUrl(link.getAttribute('href')||link.textContent||'',linkBase(link,responseUrl)))||httpUrl(permalink||'')||httpUrl(el.querySelector('id')?.textContent||'');
    return {sourceUrl,sourceName,url,title:el.querySelector('title')?.textContent?.trim()||'无标题',content:htmlText(el.getElementsByTagNameNS('*','encoded')[0]?.textContent||el.querySelector('content,description,summary')?.textContent||'')};
  });
  return {sourceName,articles};
}
export function validArticle(row:any){return !!row&&['sourceUrl','sourceName','title'].every(k=>typeof row[k]==='string'&&row[k].trim())&&typeof row.url==='string'&&!!httpUrl(row.url)&&typeof row.content==='string';}
export function validateFavorites(value:unknown):asserts value is RssFavorite[] {
  if(!Array.isArray(value))throw new Error('备份文章收藏损坏');
  const seen=new Set<string>();
  for(const row of value){
    if(!validArticle(row)||typeof row.group!=='string'||!row.group.trim()||!Number.isSafeInteger(row.savedAt)||row.savedAt<0)throw new Error('备份文章收藏损坏');
    const key=JSON.stringify(articleKey(row));if(seen.has(key))throw new Error('备份文章收藏重复');seen.add(key);
  }
}
