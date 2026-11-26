import {expect,it,vi} from 'vitest';
import {parseRuleSubscriptionImport,readSubscriptionText,rssSourceSupport} from './rule-subscription-import';
const fetch=vi.hoisted(()=>vi.fn());
vi.mock('./network',()=>({fetchText:fetch}));

it('requests the upstream user-agent suffix and rejects unsupported subscriptions before fetching',async()=>{
  fetch.mockResolvedValue({status:200,body:'[]'});
  expect(await readSubscriptionText({type:1,url:'https://fixture.example.test/rss#requestWithoutUA'})).toBe('[]');
  expect(fetch).toHaveBeenLastCalledWith({url:'https://fixture.example.test/rss',headers:{'User-Agent':'null'}});
  const calls=fetch.mock.calls.length;
  for(const entry of [{type:3,url:'https://fixture.example.test'},{type:2,url:'@js:result'},{type:0,url:'https://fixture.example.test',js:'result'}])await expect(readSubscriptionText(entry)).rejects.toThrow('暂不支持');
  expect(fetch).toHaveBeenCalledTimes(calls);
});
it('rejects unsafe replacement IDs and wrong rule formats without silently rounding or replacing identifiers',()=>{
  for(const id of ['9223372036854775807','"9223372036854775807"','1.5'])expect(()=>parseRuleSubscriptionImport(`[{"id":${id},"name":"Rule","pattern":"a","replacement":"b"}]`,2)).toThrow('ID');
  expect(()=>parseRuleSubscriptionImport('["https://fixture.example.test/rss"]',1)).toThrow('sourceUrl');
  expect(()=>parseRuleSubscriptionImport('[{"sourceUrl":"https://fixture.example.test/rss","enabled":"false"}]',1)).toThrow('sourceUrl');
  expect(()=>parseRuleSubscriptionImport('[]',19)).toThrow('暂不支持');
});
it('keeps plain RSS readable and marks disabled, dynamic and custom-rule feeds as unavailable for execution',()=>{
  const plain={id:'plain',url:'https://fixture.example.test/rss',name:'Plain'};
  expect(rssSourceSupport(plain)).toBe('');
  expect(rssSourceSupport({...plain,legacy:{sourceUrl:plain.url,enabled:false}})).toContain('停用');
  expect(rssSourceSupport({...plain,legacy:{sourceUrl:plain.url,ruleArticles:'@js:result'}})).toContain('暂不支持');
  expect(rssSourceSupport({...plain,url:'@js:result'})).toContain('暂不支持');
});
