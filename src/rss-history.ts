import {articleKey,validArticle,type FeedArticle} from './rss-favorites';

export type RssHistoryRow=FeedArticle&{readAt:number};
export type HistorySource=Pick<FeedArticle,'sourceUrl'|'sourceName'>;
export function validateRssHistory(value:unknown):asserts value is RssHistoryRow[]{
  if(!Array.isArray(value))throw new Error('备份订阅历史损坏');
  const seen=new Set<string>();
  for(const row of value){
    if(!validArticle(row)||!Number.isSafeInteger(row.readAt)||row.readAt<0||row.readAt>8640000000000000)throw new Error('备份订阅历史损坏');
    const key=JSON.stringify(articleKey(row));if(seen.has(key))throw new Error('备份订阅历史重复');seen.add(key);
  }
}
