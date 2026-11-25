import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { defaultDictRules, mergeDictRules, parseDictRules, queryDictionary } from './dictionary';
import { fetchText } from './network';

describe('upstream dictionary rules', () => {
  it('validates imports and merges by the upstream name key', () => {
    expect(defaultDictRules).toHaveLength(5);
    const old = parseDictRules('{"name":"测试","urlRule":"https://dict.test","enabled":false}');
    const incoming = parseDictRules('{"name":"测试","urlRule":"https://dict.test/new"}');
    expect(mergeDictRules(old,incoming,false)[0].enabled).toBe(false);
    expect(mergeDictRules(old,incoming)[0].urlRule).toContain('/new');
    expect(() => parseDictRules('{"name":"坏规则"}')).toThrow();
  });
  it('passes UTF-8 data URI bytes as hex to the display script', async () => {
    const rule = { ...defaultDictRules[0], showRule: '@js:java.hexDecodeToString(result)' };
    expect(await queryDictionary(rule,'阅读 & hello')).toBe('阅读 & hello');
  });
  it('queries the unmodified Baidu rule through its JavaImporter JSONPath calls', async () => {
    const request = vi.fn(async (req: Parameters<typeof fetchText>[0]) => req.url.startsWith('data:') ? fetchText(req) : ({ url: req.url, body: JSON.stringify({data:{idiomVersion:'1',pinyin:'yi xin',story:[],definitionInfo:{definition:'专心',detailMeans:[]},baobian:'',chuChu:[],baikeInfo:[]}}) }));
    const html = await queryDictionary(defaultDictRules.find(rule=>rule.name==='百度汉语')!,'一心',request);
    expect(html).toContain('专心'); expect(html).toContain('yi xin'); expect(html).not.toContain('undefined');
    expect(request.mock.calls[1][0].url).toContain('wd=%E4%B8%80%E5%BF%83');
  });
  it('runs the unmodified Youdao POST and display rule', async () => {
    const request = vi.fn(async (req: Parameters<typeof fetchText>[0]) => ({url:req.url,body:'<div id="inputText">hello</div><div id="translateResult">你好</div>'}));
    expect(await queryDictionary(defaultDictRules.find(rule=>rule.name==='有道')!,'hello world',request)).toContain('翻译：<br>你好');
    expect(request.mock.calls[0][0]).toMatchObject({method:'POST',body:'inputtext=hello%20world&type=AUTO'});
  });
  it('runs the unmodified Bilibili Jsoup element mutation rule', async () => {
    const request = vi.fn(async (req: Parameters<typeof fetchText>[0]) => ({url:req.url,body:'<section class="search-page"><div class="video-list"><article class="bili-video-card"><img src="/cover.jpg"><a href="https://www.bilibili.com/video/BV1"><h3>测试视频</h3></a></article></div></section>'}));
    const html=await queryDictionary(defaultDictRules.find(rule=>rule.name==='哔哩')!,'测试',request);
    expect(html).toContain('测试视频');expect(html).toContain('bilibili://video/BV1');expect(html).not.toContain('<img');
  });
});
