import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import { SourceRuntime } from './source-runtime';
import { extract, select } from './source-rules';
import { searchSource, loadOnlineBook, loadChapter, exploreKinds } from './sources';
import { fetchText } from './network';
import type { Source } from './model';
import { encodeBytes, formEncode } from './source-encoding';

vi.mock('./network', () => ({ fetchText: vi.fn() }));
const runtimes: SourceRuntime[] = [];
async function runtime(source: Partial<Source> = {}, context = {}, request?: typeof fetchText) {
  const vm = new SourceRuntime({ bookSourceUrl: `https://books.test/${Math.random()}`, bookSourceName: 'Fixture', ...source }, context, request);
  runtimes.push(vm); return vm.initialize();
}
afterEach(async () => { for (const vm of runtimes.splice(0)) await vm.close(); vi.clearAllMocks(); });
describe('Legado script compatibility', () => {
  it('loads all scripted and text discovery categories and fetches the selected category', async () => {
    const source: Source = { bookSourceUrl: 'https://discover.test', bookSourceName: 'Discover', exploreUrl: '@js:JSON.stringify([{title:"甲",url:"/a"},{title:"乙",url:"/b"},{title:"分类标题"}])', ruleExplore: { bookList: 'a', name: 'text', bookUrl: 'href' } };
    expect(await exploreKinds(source)).toEqual([{ title: '甲', url: '/a' }, { title: '乙', url: '/b' }, { title: '分类标题' }]);
    expect(await exploreKinds({ ...source, exploreUrl: '甲::/a&&乙::/b\n标题' })).toEqual([{ title: '甲', url: '/a' }, { title: '乙', url: '/b' }, { title: '标题' }]);
    vi.mocked(fetchText).mockImplementation(async req => ({ url: req.url, body: '<a href="/book">分类书籍</a>', status: 200 }));
    expect((await searchSource(source, '', true, '/b'))[0].name).toBe('分类书籍');
    expect(vi.mocked(fetchText).mock.calls[0][0].url).toBe('https://discover.test/b');
  });
  it('reads cookie.getKey by cookie name and accepts bare login hostnames', async () => {
    const vm = await runtime();
    expect(await vm.evaluate('cookie.getKey("login-fixture.test", "sessionid")')).toBe('');
    await vm.evaluate('cookie.setCookie("https://login-fixture.test/account", "sessionid=fixture; theme=light")');
    expect(await vm.evaluate('cookie.getKey("login-fixture.test", "sessionid")')).toBe('fixture');
    await vm.evaluate('cookie.replaceCookie("login-fixture.test", "theme=dark; lang=zh")');
    expect(await vm.evaluate('cookie.getKey("https://login-fixture.test", "sessionid")')).toBe('fixture');
    expect(await vm.evaluate('cookie.getKey("login-fixture.test", "theme")')).toBe('dark');
    await vm.evaluate('cookie.removeCookie("login-fixture.test")');
    expect(await vm.evaluate('cookie.getCookie("https://login-fixture.test")')).toBe('');
  });
  it('runs completion values, chained JS, jsLib, Jsoup and JSON result fields', async () => {
    const vm = await runtime({ jsLib: 'function label(s) { return s + "!"; }' });
    expect(await vm.rule('<h1>书</h1>', 'h1@text@js:label(result)')).toBe('书!');
    const nodes = await vm.rule('<ul><li><a href="/1">甲</a></li><li><a href="/2">乙</a></li></ul>', '<js>org.jsoup.Jsoup.parse(result).select("li");</js>', true);
    expect(nodes).toHaveLength(2); expect(await vm.rule(nodes[1], 'a@text')).toBe('乙');
    expect(await vm.rule({ name: 'JSON 书名' }, 'name')).toBe('JSON 书名');
    expect(await vm.rule('<h1>书</h1>', '<js>({name: java.getString("h1@text")})</js>', true)).toEqual([{ name: '书' }]);
  });
  it('awaits synchronous java.ajax calls without rewriting source functions', async () => {
    const request = vi.fn(async request => ({ url: request.url, body: '{"name":"返回书名"}', status: 200 }));
    const vm = await runtime({}, {}, request);
    expect(await vm.rule('', '@js:function read(){ return JSON.parse(java.ajax("/api")).name }; read()')).toBe('返回书名');
    expect(request.mock.calls[0][0].url).toBe('https://books.test/api');
  });
  it('builds script URLs, expression templates, dynamic headers and POST bodies', async () => {
    const vm = await runtime({ header: '@js:JSON.stringify({"X-Token":java.md5Encode("abc")})' }, { key: '甲 &乙', page: 3 });
    const request = await vm.makeRequest(`@js:'/search?q={{key}}&p={{page+1}},' + JSON.stringify({method:'POST', body:'x=1'})`);
    expect(request.url).toBe('https://books.test/search?q=%E7%94%B2%20%26%E4%B9%99&p=4');
    expect(request.method).toBe('POST'); expect(request.body).toBe('x=1'); expect(request.headers?.['X-Token']).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
  it('persists source, book, cache and cookie variables across sessions', async () => {
    const source = { bookSourceUrl: 'https://state.test', bookSourceName: 'State' };
    const first = await runtime(source, { book: { url: '/book/1' } });
    await first.evaluate('java.put("id", "42"); source.setVariable("saved"); cache.put("token", "ok", 60); cookie.setCookie(baseUrl, "sid=abc")'); await first.close();
    const second = await runtime(source, { book: { url: '/book/1' } });
    expect(await second.evaluate('[java.get("id"),source.getVariable(),cache.get("token"),cookie.getCookie(baseUrl,"sid")]')).toEqual(['42','saved','ok','abc']);
    expect((await second.makeRequest('/next')).headers?.Cookie).toBe('sid=abc');
  });
  it('supports JavaImporter, byte arrays and JCA AES used by real sources', async () => {
    const key = '242ccb8230d709e1', iv = '1234567890abcdef', text = '测试正文\n第二段';
    const encrypted = CryptoJS.AES.encrypt(text, CryptoJS.enc.Utf8.parse(key), { iv: CryptoJS.enc.Utf8.parse(iv) }).ciphertext;
    const payload = CryptoJS.enc.Utf8.parse(iv).concat(encrypted).toString(CryptoJS.enc.Base64);
    const vm = await runtime();
    const code = `var imports = new JavaImporter(); imports.importPackage(Packages.java.lang, Packages.javax.crypto.spec, Packages.javax.crypto, Packages.java.util);
      with(imports) { var data = Base64.getDecoder().decode('${payload}'); var cipher=Cipher.getInstance('AES/CBC/PKCS5Padding');
      cipher.init(2, SecretKeySpec(String('${key}').getBytes(),'AES'), IvParameterSpec(Arrays.copyOfRange(data,0,16)));
      String(cipher.doFinal(Arrays.copyOfRange(data,16,data.length))); }`;
    expect(await vm.evaluate(code)).toBe(text);
    expect(await vm.evaluate('java.base64Decode("5Lit5paH")')).toBe('中文');
    expect(await vm.evaluate('java.t2s("閱讀書籍")')).toBe('阅读书籍');
    expect(await vm.evaluate('org.jsoup.Jsoup.parse("<h1>正文</h1>").text()')).toBe('正文');
  });
  it('interrupts infinite loops and keeps scripts outside the host globals', async () => {
    const vm = await runtime({}, { timeoutMs: 40 });
    expect(await vm.evaluate('[typeof window, typeof document, typeof __TAURI_INTERNALS__, typeof fetch]')).toEqual(['undefined','undefined','undefined','undefined']);
    await expect(vm.evaluate('while(true){}')).rejects.toThrow(/interrupt/);
  });
  it('handles Legado selector stages, indices, exclusion, XPath attributes and JSON text', () => {
    const html = '<div id="list"><a href="/1">一</a><a href="/2">二</a><a href="/3">三</a></div>';
    expect(extract(html, 'id.list@a.-1@text')).toBe('三');
    expect(select(html, 'id.list@a!0')).toHaveLength(2);
    expect(extract(html, '//a/@href')).toBe('/1\n/2\n/3');
    expect(extract('{"name":"甲"}', 'name')).toBe('甲');
  });
  it('handles rule variables, inline JSONPath and legacy Chinese request encoding', async () => {
    const vm = await runtime({}, { key: '中文' });
    expect(await vm.rule({ name: '书', id: 7 }, '$.name@put:{id:id}')).toBe('书');
    expect(await vm.rule({ chapter: 3 }, 'https://books.test/@get:{id}/{{$.chapter}}')).toBe('https://books.test/7/3');
    expect(encodeBytes('中文', 'GBK')).toEqual([214,208,206,196]); expect(formEncode('中文', 'gb2312')).toBe('%D6%D0%CE%C4');
    expect((await vm.makeRequest('/search?q={{key}},{"charset":"gbk"}')).url).toBe('https://books.test/search?q=%D6%D0%CE%C4');
  });
  it('accepts source identifiers, single-quoted headers and Java login maps', async () => {
    const vm = await runtime({ bookSourceUrl: 'fixture-id', header: "{'User-Agent':'fixture'}" });
    await vm.evaluate('source.putLoginInfo({name:"reader"})');
    expect(await vm.evaluate('source.getLoginInfoMap().get("name")')).toBe('reader');
    expect((await vm.makeRequest('https://fixture.test/search')).headers?.['User-Agent']).toBe('fixture');
  });
  it('runs loginCheckJs on response objects and retries with source login headers', async () => {
    const request = vi.fn(async req => ({ url:req.url, body:req.headers?.Authorization ? '登录正文' : '登录失效', status:req.headers?.Authorization ? 200 : 401 }));
    const vm = await runtime({loginCheckJs:'if(result.code()===401){source.putLoginHeader({Authorization:"fixture-token"}); result=java.connect(result.url());} result;'}, {}, request);
    expect((await vm.fetch('/book')).body).toBe('登录正文'); expect(request).toHaveBeenCalledTimes(2);
  });
  it('runs script search, book init, directory and content as one reader flow', async () => {
    const pages: Record<string, string> = { '/search': '<li><a href="/book">测试书</a></li>', '/book': '<h1>测试书</h1><a class="toc" href="/toc">目录</a>', '/toc': '<a href="/chapter">第一章</a>', '/chapter': '<p>正文</p>' };
    vi.mocked(fetchText).mockImplementation(async req => ({ url: req.url, body: pages[new URL(req.url).pathname], status: 200 }));
    const source: Source = { bookSourceUrl: 'https://flow.test', bookSourceName: 'Flow', jsLib: 'function text(s){ return s + "脚本"; }', searchUrl: '@js:"/search"', ruleSearch: { bookList: '<js>org.jsoup.Jsoup.parse(result).select("li")</js>', name: 'a@text', bookUrl: 'a@href' }, ruleBookInfo: { init: '<js>JSON.stringify({name:java.getString("h1@text"), toc:java.getString(".toc@href")})</js>', name: '$.name', tocUrl: '$.toc' }, ruleToc: { chapterList: '@js:org.jsoup.Jsoup.parse(result).select("a")', chapterName: 'text', chapterUrl: 'href' }, ruleContent: { content: 'p@text@js:text(result)' } };
    const result = (await searchSource(source, '测试'))[0]; expect(result.name).toBe('测试书');
    const book = await loadOnlineBook(result, source); expect(book.chapters).toHaveLength(1);
    expect(await loadChapter(book.chapters[0], source, book)).toBe('正文脚本');
  });
  it('keeps each search book and chapter variables through directory and content requests', async () => {
    vi.mocked(fetchText).mockImplementation(async req => {
      const path = new URL(req.url).pathname;
      const body = path === '/search' ? JSON.stringify([{name:'甲', id:'a'}, {name:'乙', id:'b'}]) : path.startsWith('/book/') ? '{}' : path.startsWith('/toc/') ? JSON.stringify([{name:'第一章', id:'1'}, {name:'第二章', id:'2'}]) : '正文';
      return { url: req.url, body, status: 200 };
    });
    const source: Source = { bookSourceUrl: 'https://variables.test', bookSourceName:'Variables', searchUrl:'/search',
      ruleSearch: { bookList:'$[*]', name:'$.name@put:{bid:$.id}', bookUrl:'@js:"/book/"+java.get("bid")' },
      ruleBookInfo: { tocUrl:'@js:"/toc/"+java.get("bid")' },
      ruleToc: { chapterList:'$[*]', chapterName:'$.name@put:{cid:$.id}', chapterUrl:'@js:"/content/"+java.get("bid")+"/"+java.get("cid")' },
      ruleContent: { content:'@js:java.get("bid")+":"+java.get("cid")+":"+result' } };
    const results = await searchSource(source, '测试');
    const first = await loadOnlineBook(results[0], source), second = await loadOnlineBook(results[1], source);
    expect(first.chapters.map(c => c.url)).toEqual(['https://variables.test/content/a/1','https://variables.test/content/a/2']);
    expect(second.chapters.map(c => c.url)).toEqual(['https://variables.test/content/b/1','https://variables.test/content/b/2']);
    expect(await loadChapter(first.chapters[0], source, first)).toBe('a:1:正文');
    expect(await loadChapter(second.chapters[1], source, second)).toBe('b:2:正文');
  });
  it('preserves object book initialization and visits every pagination URL once', async () => {
    const pages: Record<string,string> = { '/book':'<h1>对象书</h1>', '/toc':'<a href="/c1">一</a>', '/toc2':'<a href="/c2">二</a>', '/toc3':'<a href="/c3">三</a>', '/c1':'<p>甲</p>', '/p2':'<p>乙</p>', '/p3':'<p>丙</p>' };
    vi.mocked(fetchText).mockImplementation(async req => ({ url:req.url, body:pages[new URL(req.url).pathname], status:200 }));
    const source: Source = {bookSourceUrl:'https://pages.test', bookSourceName:'Pages',
      ruleBookInfo:{init:'@js:({name:java.getString("h1@text"),toc:"https://pages.test/toc"})', name:'$.name', tocUrl:'$.toc'},
      ruleToc:{chapterList:'a',chapterName:'text',chapterUrl:'href',nextTocUrl:'@js:baseUrl.endsWith("/toc") ? ["/toc2","/toc3"] : ["/toc"]'},
      ruleContent:{content:'p@text',nextContentUrl:'@js:baseUrl.endsWith("/c1") ? ["/p2","/p3"] : ["/c1"]'}};
    const book = await loadOnlineBook({name:'Search',author:'Author',url:'https://pages.test/book',sourceUrl:source.bookSourceUrl,sourceName:source.bookSourceName},source);
    expect(book.name).toBe('对象书'); expect(book.chapters).toHaveLength(3);
    expect(await loadChapter(book.chapters[0],source,book)).toBe('甲\n\n乙\n\n丙');
    expect(vi.mocked(fetchText).mock.calls.filter(([r])=>r.url.endsWith('/c1'))).toHaveLength(1);
  });
});
