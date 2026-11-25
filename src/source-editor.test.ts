import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SourceEditor } from './SourceEditor';
import { SourceManager } from './SourceManager';
import { Modal } from './ui';
import { labels } from './source-editor-fields';
import type { Source } from './model';
import * as storage from './storage';
import { clearSourceCookies } from './source-browser';
import { readClipboardText, writeClipboardText } from './clipboard';

vi.mock('./clipboard', () => ({ readClipboardText: vi.fn(), writeClipboardText: vi.fn() }));
const fixture: Source = { bookSourceUrl: 'https://editor.test', bookSourceName: '编辑验收源', enabled: true, ruleSearch: { name: '.title@text', bookList: '.books' }, extraField: { retained: true } };
const hosts: { host: HTMLElement; root: ReturnType<typeof createRoot> }[] = [];
afterEach(async () => {
  for (const { host, root } of hosts.splice(0)) { await act(async () => root.unmount()); host.remove(); }
  vi.clearAllMocks();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});
async function mount(overrides: Partial<Parameters<typeof SourceEditor>[0]> = {}) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); hosts.push({ host, root });
  const callbacks = { save: vi.fn(async (_source: Source) => {}), login: vi.fn(), search: vi.fn(), cancel: vi.fn(), notify: vi.fn() };
  await act(async () => root.render(createElement(SourceEditor, { source: fixture, ...callbacks, ...overrides })));
  return { host, ...callbacks };
}
function button(host: HTMLElement, label: string) {
  const value = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  if (!value) throw new Error(`Missing button: ${label}`);
  return value;
}
async function click(host: HTMLElement, label: string) { await act(async () => button(host, label).click()); }
async function input(host: HTMLElement, label: string, text: string) {
  const value = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
  if (!value) throw new Error(`Missing field: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(value, text);
    value.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return value;
}
async function menu(host: HTMLElement, label: string) { await click(host, '书源编辑菜单'); await click(host, label); }
async function settled(host: HTMLElement) {
  for (let attempt = 0; attempt < 50 && button(host, '保存').disabled; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(button(host, '保存').disabled).toBe(false);
}

it('saves before login and search, retains unknown fields and resets the dirty baseline', async () => {
  const { host, save, login, search, cancel } = await mount();
  await input(host, labels.bookSourceName, '已修改'); await menu(host, '登录');
  expect(save).toHaveBeenCalledTimes(1); expect(login).toHaveBeenCalledWith(save.mock.calls[0][0]);
  expect(save.mock.calls[0][0]).toMatchObject({ bookSourceName: '已修改', extraField: { retained: true } });
  expect(cancel).not.toHaveBeenCalled();
  await menu(host, '搜索'); expect(search).toHaveBeenCalledWith(save.mock.calls[1][0]);
  expect(save.mock.calls[1][0].lastUpdateTime).toBe(save.mock.calls[0][0].lastUpdateTime);
  await click(host, '返回管理'); expect(cancel).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[aria-label="保存修改"]')).toBeNull();
});

it('keeps the editor and draft when validation or persistence fails', async () => {
  const reject = vi.fn(async () => { throw new Error('保存失败'); });
  const { host, login, cancel } = await mount({ save: reject });
  await input(host, labels.bookSourceName, '待保存'); await menu(host, '登录');
  expect(login).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('保存失败');
  await click(host, 'JSON'); await input(host, '完整书源 JSON', '[]'); await click(host, '保存');
  expect(reject).toHaveBeenCalledTimes(1); expect(cancel).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('一个书源');
});

it('edits only the focused rule and preserves selection in the fullscreen editor', async () => {
  const { host, save, notify } = await mount();
  await click(host, '编辑内容'); expect(notify).toHaveBeenCalledWith('请将光标聚焦在文本框');
  await click(host, '搜索');
  const field = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${labels.name}"]`)!;
  await act(async () => { field.focus(); field.setSelectionRange(2, 6); });
  await click(host, '编辑内容');
  const full = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑内容"]')!;
  expect(document.activeElement).toBe(full); expect([full.selectionStart, full.selectionEnd]).toEqual([2, 6]);
  await input(host, '编辑内容', '.updated@text'); full.setSelectionRange(3, 7); await click(host, '保存内容');
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(document.activeElement).toBe(field); expect([field.selectionStart, field.selectionEnd]).toEqual([3, 7]);
  expect(field.value).toBe('.updated@text'); await click(host, '保存');
  expect(save.mock.calls[0][0].ruleSearch).toEqual({ bookList: '.books', name: '.updated@text' });
});

it('discards fullscreen changes only after confirmation and clears focus when selecting other controls', async () => {
  const { host, notify } = await mount();
  const field = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${labels.bookSourceName}"]`)!;
  await act(async () => field.focus()); await click(host, '编辑内容');
  await input(host, '编辑内容', '未保存的内容'); await click(host, '关闭');
  expect(host.querySelector('[aria-label="保存修改"]')).not.toBeNull();
  await click(host, '不保存'); await new Promise(resolve => requestAnimationFrame(resolve));
  expect(field.value).toBe(fixture.bookSourceName);
  await act(async () => host.querySelector<HTMLSelectElement>('select')!.focus());
  await click(host, '编辑内容'); expect(notify).toHaveBeenCalledWith('请将光标聚焦在文本框');
  expect(host.querySelector('.source-fullscreen-code')).toBeNull();
});

it('pastes a draft without saving and rejects an empty list without discarding it', async () => {
  const { host, save, cancel } = await mount();
  vi.mocked(readClipboardText).mockResolvedValueOnce(JSON.stringify([{ ...fixture, bookSourceName: '粘贴源' }]));
  await menu(host, '粘贴源'); expect(save).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLTextAreaElement>(`[aria-label="${labels.bookSourceName}"]`)?.value).toBe('粘贴源');
  vi.mocked(readClipboardText).mockResolvedValueOnce('[]'); await menu(host, '粘贴源');
  expect(host.querySelector<HTMLTextAreaElement>(`[aria-label="${labels.bookSourceName}"]`)?.value).toBe('粘贴源');
  await click(host, '返回管理'); expect(cancel).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="保存修改"]')).not.toBeNull();
});

it('saves renamed sources repeatedly without losing book references, login state or variables', async () => {
  const source = { ...fixture, bookSourceUrl: 'https://rename-editor.test' }, book = { id: 'editor-book', sourceUrl: source.bookSourceUrl };
  await storage.saveSources([source]); await storage.put('books', book.id, book);
  await storage.saveSourceState(source.bookSourceUrl, { 'source:loginInfo': { value: '{"fixture":true}' } });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); hosts.push({ host, root });
  const login = vi.fn();
  await act(async () => root.render(createElement(Modal, { title: '书源管理', toolbarId: 'source-toolbar', close: vi.fn(), children: createElement(SourceManager, { sources: [source], books: [], initialEditor: source, refresh: async () => {}, notify: vi.fn(), login, search: vi.fn() }) })));
  await input(host, labels.bookSourceUrl, 'https://renamed-editor.test'); await menu(host, '登录');
  await settled(host);
  expect(login.mock.calls[0][0].bookSourceUrl).toBe('https://renamed-editor.test');
  await input(host, labels.bookSourceUrl, 'https://renamed-again-editor.test'); await menu(host, '设置源变量');
  await settled(host);
  await input(host, '书源变量', 'variable-fixture'); await click(host, '确定'); await settled(host);
  expect((await storage.all<Source>('sources')).filter(item => /rename.*editor/.test(item.bookSourceUrl)).map(item => item.bookSourceUrl)).toEqual(['https://renamed-again-editor.test']);
  expect((await storage.all<any>('books')).find(item => item.id === book.id).sourceUrl).toBe('https://renamed-again-editor.test');
  expect(await storage.sourceState('https://renamed-again-editor.test')).toMatchObject({ 'source:loginInfo': { value: '{"fixture":true}' }, 'source:variable': { value: 'variable-fixture' } });
});

it('clears only the chosen source cookies and keeps its login fields and other sources', async () => {
  const other = 'https://other-editor.test';
  await storage.saveSourceState(fixture.bookSourceUrl, { 'cookie:editor.test': { value: 'fixture-cookie' }, 'source:loginHeader': { value: 'fixture-header' } });
  await storage.saveSourceState(other, { 'cookie:other-editor.test': { value: 'other-cookie' } });
  await clearSourceCookies(fixture);
  expect(await storage.sourceState(fixture.bookSourceUrl)).toMatchObject({ 'cookie:editor.test': { value: '' }, 'source:loginHeader': { value: 'fixture-header' } });
  expect((await storage.sourceState(other))['cookie:other-editor.test'].value).toBe('other-cookie');
});

it('keeps automatic rule completion opt-in and applies it to copy, save and exit detection', async () => {
  const source = { ...fixture, ruleSearch: { bookList: 'li', name: '.name', bookUrl: 'a', coverUrl: 'img' } };
  const plain = await mount({ source }); await menu(plain.host, '拷贝源');
  expect(JSON.parse(vi.mocked(writeClipboardText).mock.calls[0][0]).ruleSearch).toEqual(source.ruleSearch);
  await click(plain.host, '返回管理'); expect(plain.cancel).toHaveBeenCalledTimes(1);
  const enabled = await mount({ source }); await click(enabled.host, '书源编辑菜单');
  await act(async () => enabled.host.querySelector<HTMLInputElement>('input[aria-label="自动补全"]')!.click());
  expect(enabled.host.querySelector('[role="menuitemcheckbox"]')?.getAttribute('aria-checked')).toBe('true');
  await click(enabled.host, '拷贝源');
  const expected = { bookList: 'li', name: '.name@text', bookUrl: 'a@href', coverUrl: 'img@src' };
  expect(JSON.parse(vi.mocked(writeClipboardText).mock.calls.at(-1)![0]).ruleSearch).toEqual(expected);
  await click(enabled.host, '返回管理'); expect(enabled.cancel).not.toHaveBeenCalled();
  expect(enabled.host.querySelector('[aria-label="保存修改"]')).not.toBeNull();
  await click(enabled.host, '取消'); await menu(enabled.host, '登录');
  expect(enabled.save.mock.calls[0][0].ruleSearch).toEqual(expected);
  await click(enabled.host, '返回管理'); expect(enabled.cancel).toHaveBeenCalledTimes(1);
});

it('opens the bundled upstream help and returns to the unchanged unsaved draft', async () => {
  const { host, save } = await mount(); await input(host, labels.bookSourceName, '未保存草稿');
  await menu(host, '帮助');
  expect(host.querySelector('.source-rule-help h1')?.textContent).toBe('源规则帮助');
  expect(host.querySelector('.source-rule-help')?.textContent).toContain('并发率');
  expect(host.querySelector('.source-rule-help script')).toBeNull();
  await click(host, '关闭');
  expect(host.querySelector<HTMLTextAreaElement>(`[aria-label="${labels.bookSourceName}"]`)?.value).toBe('未保存草稿');
  expect(save).not.toHaveBeenCalled();
});

it('saves before opening the debugger and keeps the editor available on return', async () => {
  const { host, save, cancel } = await mount();
  await input(host, labels.bookSourceName, '调试草稿'); await click(host, '调试源');
  for (let attempt = 0; attempt < 50 && !host.querySelector('.source-debugger'); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0].bookSourceName).toBe('调试草稿');
  expect(host.querySelector('.source-debugger')).not.toBeNull();
  await click(host, '关闭'); expect(host.querySelector('.source-debugger')).toBeNull();
  expect(host.querySelector<HTMLTextAreaElement>(`[aria-label="${labels.bookSourceName}"]`)?.value).toBe('调试草稿');
  expect(cancel).not.toHaveBeenCalled();
});
