import {expect,it} from 'vitest';
import {editSubscription,moveSubscriptionRelative,newSubscription,renumberSubscriptions,serializeSubscriptions,sortedSubscriptions,subscriptionKey,updateBookSubscription} from './source-subscriptions';

const entries=[{id:'9223372036854775806',url:'https://fixture.example.test/shared',name:'First',type:0,customOrder:4,js:'result',extra:{keep:true}},{id:'9223372036854775807',url:'https://fixture.example.test/shared',name:'Second',type:19,customOrder:8},{id:123,url:'https://fixture.example.test/last',type:2,customOrder:15}];
it('edits an existing shared URL by exact ID while retaining unknown types, scripts and fields',()=>{
  const key=subscriptionKey(entries[0]),next=editSubscription(entries,{...entries[0],name:'Changed',autoUpdate:true,updateInterval:24,silentUpdate:true},key);
  expect(next[0]).toMatchObject({...entries[0],name:'Changed',updateInterval:24});expect(next.slice(1)).toEqual(entries.slice(1));
  expect(serializeSubscriptions(next)).toContain('"id":9223372036854775806');expect(serializeSubscriptions(next)).toContain('"id":9223372036854775807');expect(entries[0].name).toBe('First');
});
it('appends at max order, avoids ID collisions and rejects blank or conflicting new addresses',()=>{
  const draft={...newSubscription(entries,123),url:' https://fixture.example.test/new '};
  expect(draft).toMatchObject({id:124,customOrder:16,autoUpdate:false,updateInterval:0});
  expect(editSubscription(entries,draft).at(-1)?.url).toBe(draft.url.trim());
  expect(()=>editSubscription(entries,{...draft,url:'  '})).toThrow('不能为空');
  expect(()=>editSubscription(entries,{...draft,url:entries[0].url})).toThrow('已存在');
  expect(()=>editSubscription(entries,{...entries[2],url:entries[0].url},subscriptionKey(entries[2]))).toThrow('已存在');
  expect(()=>editSubscription(entries,{...draft,updateInterval:-1})).toThrow('间隔');
});
it('moves across rows using their existing order values without modifying identity or metadata',()=>{
  const next=moveSubscriptionRelative(entries,subscriptionKey(entries[0]),subscriptionKey(entries[2]),true);
  expect(sortedSubscriptions(next).map(row=>row.id)).toEqual([entries[1].id,123,entries[0].id]);
  expect(next.map(row=>row.customOrder)).toEqual([15,4,8]);expect(next[0]).toEqual({...entries[0],customOrder:15});
  expect(moveSubscriptionRelative(entries,'missing',subscriptionKey(entries[0]),true)).toBe(entries);
});
it('renumbers colliding sort values after a move and supports resetting in display order',()=>{
  const rows=entries.map(row=>({...row,customOrder:0}));
  const next=moveSubscriptionRelative(rows,subscriptionKey(rows[0]),subscriptionKey(rows[2]),false);
  expect(sortedSubscriptions(next).map(row=>row.id)).toEqual([rows[0].id,rows[2].id,rows[1].id]);
  expect([...new Set(next.map(row=>row.customOrder))].sort()).toEqual([1,2,3]);
  const reset=renumberSubscriptions(entries);expect(reset.map(row=>row.customOrder)).toEqual([1,2,3]);
});
it('rejects non-book subscriptions in the book-source update path',()=>{
  expect(()=>updateBookSubscription(entries,entries[2].url,1,555,subscriptionKey(entries[2]))).toThrow('暂不支持');
});
