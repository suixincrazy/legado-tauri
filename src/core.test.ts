import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseTxt, parseEpub, decodeText, htmlText } from './import';
import { extract, select, parseSources, makeRequest, sourceSupport } from './sources';
import { DEFAULT_SETTINGS, newBook, smartGroup } from './model';
import { validateBackup } from './storage';

describe('local book import', () => {
  it('preserves preface, Chinese headings, blank lines and the last chapter', () => {
    const book = parseTxt('\uFEFF说明\r\n\r\n第一章 初见\r\n段落一\r\n\r\n段落二\r\n第2章 重逢\r\n终章正文', '测试.txt');
    expect(book.name).toBe('测试');
    expect(book.chapters.map(c => c.title)).toEqual(['正文', '第一章 初见', '第2章 重逢']);
    expect(book.chapters[1].content).toBe('段落一\n\n段落二');
    expect(book.chapters[2].content).toBe('终章正文');
  });
  it('decodes UTF-16 and GB18030 and rejects empty books', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e]))).toBe('中');
    expect(decodeText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toBe('中文');
    expect(() => parseTxt('  \n\n', 'empty.txt')).toThrow('没有');
  });
  it('reads EPUB by spine order, resolves relative paths and strips executable markup', () => {
    const bytes = zipSync({
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'),
      'OPS/book.opf': strToU8('<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>测试 EPUB</dc:title><dc:creator>作者</dc:creator></metadata><manifest><item id="b" href="text/b.xhtml"/><item id="a" href="text/a.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'),
      'OPS/text/a.xhtml': strToU8('<html><body><h1>第一节</h1><p>甲<br/>乙</p><script>bad()</script></body></html>'),
      'OPS/text/b.xhtml': strToU8('<html><body><h1>第二节</h1><p>丙</p></body></html>'),
    });
    const book = parseEpub(bytes, 'fallback.epub');
    expect(book.name).toBe('测试 EPUB'); expect(book.author).toBe('作者');
    expect(book.chapters.map(c => c.title)).toEqual(['第一节', '第二节']);
    expect(book.chapters[0].content).toContain('甲\n乙'); expect(book.chapters[0].content).not.toContain('bad');
  });
  it('does not retain scripts or hidden CSS in content', () => {
    expect(htmlText('<style>body{}</style><p>你好</p><iframe src="x">bad</iframe><p>世界</p>')).toBe('你好\n世界');
  });
});
describe('Legado source rules', () => {
  const source = { bookSourceUrl: 'https://example.org/books/', bookSourceName: 'Test' };
  const html = '<ul><li class="book"><a href="/one">书一</a><span>作者：甲</span></li><li class="book"><a href="/two">书二</a></li></ul>';
  it('supports CSS list, attribute, fallback and replacement rules', () => {
    const nodes = select(html, '.book'); expect(nodes).toHaveLength(2);
    expect(extract(nodes[0], 'a@text')).toBe('书一'); expect(extract(nodes[0], 'a@href')).toBe('/one');
    expect(extract(nodes[0], '.missing@text||span@text##作者：##')).toBe('甲');
  });
  it('supports XPath and JSONPath without code evaluation', () => {
    expect(extract(html, '//li/a@text')).toBe('书一\n书二');
    expect(select('{"books":[{"name":"甲"},{"name":"乙"}]}', '$.books[*]')).toHaveLength(2);
    expect(extract({ name: '甲' }, '$.name')).toBe('甲');
    expect(() => extract(html, '@js:java.ajax("x")')).toThrow('执行上下文');
  });
  it('substitutes and encodes search parameters and preserves request options', () => {
    const request = makeRequest('search?q={{key}}&p={{page}},{"method":"POST","body":"hello"}', source, '甲 &乙', 2);
    expect(request.url).toBe('https://example.org/books/search?q=%E7%94%B2%20%26%E4%B9%99&p=2');
    expect(request.method).toBe('POST'); expect(request.body).toBe('hello');
  });
  it('imports single or array rules without rejecting script sources', () => {
    expect(parseSources(JSON.stringify(source))).toHaveLength(1);
    expect(parseSources(JSON.stringify([{ ...source, ruleSearch: '{"name":"a@text"}' }]))[0].ruleSearch?.name).toBe('a@text');
    expect(sourceSupport({ ...source, mainJs: 'var helper = 1' })).toBeUndefined();
    expect(() => parseSources('[{}]')).toThrow('缺少');
  });
});
describe('library integrity', () => {
  it('derives smart groups from reading state', () => {
    const book = newBook('书', 'txt', [{ title: '第一章', content: '正文' }]);
    expect(smartGroup(book)).toBe('未读'); expect(smartGroup({ ...book, lastRead: 1 })).toBe('在读'); expect(smartGroup({ ...book, finished: true })).toBe('已读');
  });
  it('validates entire backup before changing stored books', () => {
    const data = { format: 'legado-tauri', version: 1, books: [newBook('书', 'txt', [{ title: '章', content: '文' }])], sources: [], records: [], feeds: [], settings: DEFAULT_SETTINGS };
    expect(validateBackup(data).books[0].name).toBe('书');
    expect(() => validateBackup({ ...data, books: [{ ...data.books[0], chapter: 99 }] })).toThrow('损坏');
    expect(() => validateBackup({ ...data, settings: { fontSize: 'large' } })).toThrow('损坏');
    expect(() => validateBackup({ format: 'unknown' })).toThrow('有效备份');
  });
});
