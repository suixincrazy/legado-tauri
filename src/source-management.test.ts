import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { Source } from './model';
import { newBook } from './model';
import { changeGroups, checkSource, defaultSourceFilter, filterSources, mergeSourceImport, moveSources } from './source-management';
import * as storage from './storage';
import { SourceRuntime } from './source-runtime';
import { initializeLogin, loginDefaults, performLogin, readLoginFields } from './source-login';
import { fetchText } from './network';
vi.mock('./network', () => ({ fetchText: vi.fn() }));

describe('source management transactions', () => {
  const a: Source = { bookSourceName: 'Alpha', bookSourceUrl: 'https://a.test', bookSourceGroup: '甲，乙', enabled: false, customOrder: 2, extraRule: { preserved: true } };
  const b: Source = { bookSourceName: 'Beta', bookSourceUrl: 'https://b.test', loginUrl: 'https://b.test/login', customOrder: 1, enabledExplore: false };
  it('filters independent enable/explore states and exact groups without mutating sources', () => {
    expect(filterSources([a, b], { ...defaultSourceFilter, group: '乙', status: 'disabled' })).toEqual([a]);
    expect(filterSources([a, b], { ...defaultSourceFilter, status: 'login' })).toEqual([b]);
    expect(filterSources([a, b], { ...defaultSourceFilter, group: '$none' })).toEqual([b]);
    expect(changeGroups(a, ['甲'], true).bookSourceGroup).toBe('乙');
    expect(changeGroups(a, ['乙', '丙']).bookSourceGroup).toBe('甲,乙,丙');
    expect(a.bookSourceGroup).toBe('甲，乙');
  });
  it('previews conflict choices and preserves existing selection state and unknown source fields', async () => {
    const next = { ...a, enabled: true, bookSourceGroup: '新', customOrder: 99, searchUrl: '/new' };
    expect(mergeSourceImport([a], [next], false)).toEqual([]);
    const changes = mergeSourceImport([a], [next], true);
    expect(changes[0]).toMatchObject({ enabled: false, bookSourceGroup: '甲，乙', customOrder: 2, searchUrl: '/new', extraRule: { preserved: true } });
    await storage.saveSources(changes);
    await storage.saveSources([{ ...changes[0], bookSourceUrl: 'https://renamed.test' }], [a.bookSourceUrl]);
    const stored = await storage.all<Source>('sources');
    expect(stored.some(s => s.bookSourceUrl === a.bookSourceUrl)).toBe(false);
    expect(stored.find(s => s.bookSourceUrl === 'https://renamed.test')?.extraRule).toEqual({ preserved: true });
  });
  it('moves selected sources without dropping unselected items', () => {
    expect(moveSources([a, b], new Set([a.bookSourceUrl]), false).map(s => s.bookSourceName)).toEqual(['Alpha', 'Beta']);
    expect(moveSources([a, b], new Set([b.bookSourceUrl]), true).map(s => s.customOrder)).toEqual([0, 1]);
  });
  it('groups public and private suffix hosts and sorts newest entries within a host', () => {
    const sources=['https://m.example.co.uk','custom-js','https://reader.github.io','https://www.example.co.uk','https://other.github.io'].map((url,index)=>({...a,bookSourceUrl:url,lastUpdateTime:index}));
    expect(filterSources(sources,{...defaultSourceFilter,domainGroups:true}).map(source=>source.bookSourceUrl)).toEqual(['https://www.example.co.uk','https://m.example.co.uk','https://other.github.io','https://reader.github.io','custom-js']);
    expect(filterSources(sources,{...defaultSourceFilter,sort:'lastUpdateTime'})[0].bookSourceUrl).toBe('https://other.github.io');
  });
  it('renames a source atomically with library references and login state, and preserves subscriptions in backups', async () => {
    const source = { ...a, bookSourceUrl: 'https://rename-original.test' };
    const book = { ...newBook('Rename fixture', 'online', [{ title: 'Chapter' }]), sourceUrl: source.bookSourceUrl };
    await storage.saveSources([source]); await storage.put('books', book.id, book);
    await storage.saveSourceState(source.bookSourceUrl, { 'source:loginInfo': { value: '{"account":"reader"}' } });
    await storage.saveEditedSource({ ...source, bookSourceUrl: 'https://rename-new.test' }, source.bookSourceUrl);
    expect((await storage.all<typeof book>('books')).find(b => b.id === book.id)?.sourceUrl).toBe('https://rename-new.test');
    expect((await storage.sourceState('https://rename-new.test'))['source:loginInfo'].value).toContain('reader');
    expect(await storage.sourceState(source.bookSourceUrl)).toEqual({});
    const subscriptions = [{ url: 'https://subscription.test/list', count: 1, updated: 1 }];
    await storage.put('settings', 'sourceSubscriptions', subscriptions);
    const saved = await storage.backup(); await storage.put('settings', 'sourceSubscriptions', []); await storage.restore(saved);
    expect(await storage.preference('sourceSubscriptions', [])).toEqual(subscriptions);
  });
});

describe('source login contract', () => {
  const source: Source = { bookSourceName: 'Login fixture', bookSourceUrl: 'https://login-form.test', loginUrl: 'function title(){return "选择"}; function login(){ source.putLoginInfo(result); source.putLoginHeader({"X-Login":result.account}); }', loginUi: '@js:JSON.stringify([{name:"account",type:"text",default:"guest"},{name:"mode",type:"select",viewName:"title()",chars:["甲","乙"]},{name:"submit",type:"button",action:"java.upLoginData({account:result.account+String.fromCharCode(33)});java.reLoginView();"}])' };
  it('executes loginUrl before dynamic loginUi and exposes form values to actions', async () => {
    const vm = new SourceRuntime(source, { loginData: { account: 'reader' } });
    try {
      await initializeLogin(vm, source); const fields = await readLoginFields(vm, source);
      expect(fields[1].viewName).toBe('选择'); expect(loginDefaults(fields, { account: 'reader' })).toEqual({ account: 'reader', mode: '甲' });
      await vm.evaluate(fields[2].action!);
      expect(vm.loginEvents).toEqual([{ type: 'data', data: { account: 'reader!' } }, { type: 'refresh', data: false }]);
    } finally { await vm.close(); }
  });
  it('runs the login submit hook and persists resulting login headers', async () => {
    const vm = new SourceRuntime(source, { loginData: { account: 'reader' } });
    try { await performLogin(vm, source, undefined, true); } finally { await vm.close(); }
    const state = await storage.sourceState(source.bookSourceUrl);
    expect(JSON.parse(String(state['source:loginHeader'].value))).toEqual({ 'X-Login': 'reader' });
    expect(JSON.parse(String(state['source:loginInfo'].value))).toEqual({ account: 'reader' });
  });
  it('checks search, detail, toc and content and distinguishes HTTP failures from a passing source', async () => {
    const fixture: Source = { bookSourceName: 'Check', bookSourceUrl: 'https://check.test', searchUrl: '/search', ruleSearch: { bookList: '.book', name: 'text', bookUrl: 'href' }, ruleBookInfo: { tocUrl: 'a@href' }, ruleToc: { chapterList: 'a', chapterName: 'text', chapterUrl: 'href' }, ruleContent: { content: 'p@text' } };
    vi.mocked(fetchText).mockImplementation(async req => ({ url: req.url, status: 200, body: req.url.endsWith('/search') ? '<a class="book" href="/book">A</a>' : req.url.endsWith('/book') ? '<a href="/toc">T</a>' : req.url.endsWith('/toc') ? '<a href="/chapter">C</a>' : '<p>正文</p>' }));
    expect((await checkSource(fixture, 'test', true, () => false, () => {})).checkResult?.stages).toEqual(['搜索', '详情与目录', '正文', '完成']);
    vi.mocked(fetchText).mockRejectedValue(new Error('fetch failed https://private.test/secret?token=hidden'));
    const failed = await checkSource(fixture, 'test', true, () => false, () => {});
    expect(failed.checkResult?.status).toBe('error'); expect(failed.checkResult?.message).not.toContain('private.test');
  });
});
