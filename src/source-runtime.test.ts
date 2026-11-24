import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import { SourceRuntime } from './source-runtime';
import { extract, select } from './source-rules';
import { searchSource, loadOnlineBook, loadChapter } from './sources';
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
  it('runs script search, book init, directory and content as one reader flow', async () => {
    const pages: Record<string, string> = { '/search': '<li><a href="/book">测试书</a></li>', '/book': '<h1>测试书</h1><a class="toc" href="/toc">目录</a>', '/toc': '<a href="/chapter">第一章</a>', '/chapter': '<p>正文</p>' };
    vi.mocked(fetchText).mockImplementation(async req => ({ url: req.url, body: pages[new URL(req.url).pathname], status: 200 }));
    const source: Source = { bookSourceUrl: 'https://flow.test', bookSourceName: 'Flow', jsLib: 'function text(s){ return s + "脚本"; }', searchUrl: '@js:"/search"', ruleSearch: { bookList: '<js>org.jsoup.Jsoup.parse(result).select("li")</js>', name: 'a@text', bookUrl: 'a@href' }, ruleBookInfo: { init: '<js>JSON.stringify({name:java.getString("h1@text"), toc:java.getString(".toc@href")})</js>', name: '$.name', tocUrl: '$.toc' }, ruleToc: { chapterList: '@js:org.jsoup.Jsoup.parse(result).select("a")', chapterName: 'text', chapterUrl: 'href' }, ruleContent: { content: 'p@text@js:text(result)' } };
    const result = (await searchSource(source, '测试'))[0]; expect(result.name).toBe('测试书');
    const book = await loadOnlineBook(result, source); expect(book.chapters).toHaveLength(1);
    expect(await loadChapter(book.chapters[0], source, book)).toBe('正文脚本');
  });
});
