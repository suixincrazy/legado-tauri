import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { debugSource, parseDebugInput } from './source-debug';
import type { SourceEvent } from './source-trace';
import type { Source } from './model';
import { fetchText } from './network';

vi.mock('./network', () => ({ fetchText: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const source: Source = {
  bookSourceUrl: 'https://debug.test', bookSourceName: 'Debug fixture', searchUrl: '/search?q={{key}}', exploreUrl: '分类::/explore',
  ruleSearch: { bookList: 'a', name: 'text', bookUrl: 'href' },
  ruleBookInfo: { name: 'h1@text', tocUrl: '.toc@href' },
  ruleToc: { chapterList: 'a.chapter', chapterName: 'text', chapterUrl: 'href', nextTocUrl: 'a.next@href' },
  ruleContent: { content: 'p@text@js:java.log("fixture log"); result', nextContentUrl: 'a.next@href' },
};
const pages: Record<string, string> = {
  '/search': '<a href="/book">Fixture</a>', '/explore': '<a href="/book">Fixture</a>',
  '/book': '<h1>Fixture</h1><a class="toc" href="/toc">目录</a>',
  '/toc': '<a class="chapter" href="/1">第一章</a><a class="next" href="/toc2">下页</a>',
  '/toc2': '<a class="chapter" href="/2">第二章</a>',
  '/1': '<p>正文一</p><a class="next" href="/1b">下页</a>', '/1b': '<p>正文二</p>',
};
function requests() {
  vi.mocked(fetchText).mockImplementation(async request => ({ url: request.url, status: 200, body: pages[new URL(request.url).pathname] || '' }));
}
it('uses upstream input precedence, including URL query values containing ::', () => {
  expect(parseDebugInput('关键词')).toEqual({ phase: 'search', value: '关键词' });
  expect(parseDebugInput('榜单::/explore')).toEqual({ phase: 'explore', value: '/explore' });
  expect(parseDebugInput('https://debug.test/book?key=a::b')).toEqual({ phase: 'info', value: 'https://debug.test/book?key=a::b' });
  expect(parseDebugInput('++https://debug.test/toc')).toEqual({ phase: 'toc', value: 'https://debug.test/toc' });
  expect(parseDebugInput('--https://debug.test/1')).toEqual({ phase: 'content', value: 'https://debug.test/1' });
});
it('runs all five inputs through real rules and exposes exact responses, rule results and script logs', async () => {
  for (const [input, expected] of [
    ['关键词', ['/search', '/book', '/toc', '/toc2', '/1', '/1b']],
    ['分类::/explore', ['/explore', '/book', '/toc', '/toc2', '/1', '/1b']],
    ['https://debug.test/book', ['/book', '/toc', '/toc2', '/1', '/1b']],
    ['++https://debug.test/toc', ['/toc', '/toc2', '/1', '/1b']],
    ['--https://debug.test/1', ['/1', '/1b']],
  ] as const) {
    vi.mocked(fetchText).mockClear(); requests(); const events: SourceEvent[] = [];
    const result = await debugSource(source, input, { onEvent: event => events.push(event) });
    expect(result.content).toBe('正文一\n\n正文二');
    expect(vi.mocked(fetchText).mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual(expected);
    expect(events.flatMap(event => event.type === 'response' && event.origin === 'page' ? [event.body] : [])).toEqual(expected.map(path => pages[path]));
    expect(events.some(event => event.phase === 'content' && event.type === 'log' && event.text === 'fixture log')).toBe(true);
    expect(events.some(event => event.type === 'rule' && event.value === '正文一')).toBe(true);
  }
});
it('keeps the failing response available and stops before downstream pages', async () => {
  requests(); const events: SourceEvent[] = [];
  await expect(debugSource({ ...source, ruleSearch: { ...source.ruleSearch, bookList: '.missing' } }, '空结果', { onEvent: event => events.push(event) })).rejects.toThrow('未获取到书籍');
  expect(fetchText).toHaveBeenCalledTimes(1);
  expect(events.find(event => event.type === 'response')).toMatchObject({ phase: 'search', body: pages['/search'] });
});
it('cancels an in-flight request without executing rules or later stages when it returns', async () => {
  let release!: (response: Awaited<ReturnType<typeof fetchText>>) => void;
  vi.mocked(fetchText).mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const controller = new AbortController(), events: SourceEvent[] = [];
  const task = debugSource(source, '取消', { signal: controller.signal, onEvent: event => events.push(event) });
  const assertion = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  controller.abort(); release({ url: source.bookSourceUrl + '/search', body: pages['/search'] }); await assertion;
  expect(fetchText).toHaveBeenCalledTimes(1); expect(events.some(event => event.type === 'rule')).toBe(false);
});
it('traces mainJs responses and skips volume markers before fetching content', async () => {
  requests(); const events: SourceEvent[] = [];
  const result = await debugSource({ bookSourceUrl: source.bookSourceUrl, bookSourceName: 'JS fixture', mainJs: `
    function search(key) { java.log(key); java.ajax('https://debug.test/search'); return [{name:'Fixture',bookUrl:'https://debug.test/book'}]; }
    function getChapters(book) { return [{title:'卷',url:'卷',isVolume:true},{title:'章',url:'/1'}]; }
    function getContent(chapter) { return java.ajax(chapter.url); }
  ` }, '脚本调试', { onEvent: event => events.push(event) });
  expect(result.content).toContain('正文一');
  expect(events.some(event => event.type === 'response' && event.phase === 'content' && event.body === pages['/1'])).toBe(true);
  expect(events.some(event => event.type === 'call' && event.name === 'getChapters')).toBe(true);
  expect(events.some(event => event.type === 'log' && event.text === '脚本调试')).toBe(true);
});
