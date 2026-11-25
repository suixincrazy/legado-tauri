import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SourceDebugger } from './SourceDebugger';
import { debugSource } from './source-debug';
import { exploreKinds } from './sources';
import { newBook } from './model';

vi.mock('./source-debug', () => ({ debugSource: vi.fn() }));
vi.mock('./sources', () => ({ exploreKinds: vi.fn() }));
let root: ReturnType<typeof createRoot> | undefined, host: HTMLElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; vi.resetAllMocks(); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; });
async function mount() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(exploreKinds).mockResolvedValue([{ title: '分类', url: '/explore' }]);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(createElement(SourceDebugger, { source: { bookSourceName: 'Fixture', bookSourceUrl: 'https://debug.test' }, close: vi.fn() })));
  return host;
}
function button(label: string) { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function input(text: string) {
  const field = host.querySelector('input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
it('submits once, displays raw response as text, and returns to logs after viewing it', async () => {
  await mount();
  vi.mocked(debugSource).mockImplementation(async (_source, _input, execution) => {
    execution?.onEvent?.({ type: 'response', phase: 'content', time: 1, url: 'https://debug.test/1', body: '<script>throw Error("must not execute")</script><p>正文</p>' });
    return { book: newBook('Fixture', 'online', [{ title: '章' }]), content: '正文' };
  });
  await input('--https://debug.test/1'); await click('开始调试');
  expect(debugSource).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.source-debug-log')?.textContent).toContain('正文页解析完成');
  await click('调试菜单'); await click('正文源码');
  expect(host.querySelector('.source-debug-raw pre')?.textContent).toContain('<script>');
  expect(host.querySelector('.source-debug-raw script')).toBeNull();
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="关闭"]')].at(-1)!.click());
  expect(host.querySelector('.source-debug-raw')).toBeNull();
  expect(host.querySelector('.source-debug-log')?.textContent).toContain('正文页解析完成');
});
it('suppresses stale completion and late responses after stop, then closes in-flight work on unmount', async () => {
  await mount(); let resolve!: (value: Awaited<ReturnType<typeof debugSource>>) => void;
  vi.mocked(debugSource).mockImplementation(() => new Promise(done => { resolve = done; }));
  await input('关键词'); await click('开始调试');
  const execution = vi.mocked(debugSource).mock.calls[0][2]!;
  await click('停止调试'); expect(execution.signal?.aborted).toBe(true);
  await act(async () => {
    execution.onEvent?.({ type: 'response', phase: 'search', time: 1, url: 'https://debug.test/stale', body: 'stale' });
    resolve({ book: newBook('Fixture', 'online', [{ title: '章' }]), content: 'stale completion' });
  });
  expect(host.textContent).not.toContain('stale'); expect(host.textContent).toContain('已停止调试');
  await click('开始调试'); const next = vi.mocked(debugSource).mock.calls.at(-1)![2]!;
  await act(async () => root!.unmount()); root = undefined; expect(next.signal?.aborted).toBe(true);
});

it('waits for a cancelled run to release its runtime before starting another', async () => {
  await mount(); let resolve!: (value: Awaited<ReturnType<typeof debugSource>>) => void;
  vi.mocked(debugSource).mockImplementation(() => new Promise(done => { resolve = done; }));
  await input('第一个'); await click('开始调试'); const execution = vi.mocked(debugSource).mock.calls[0][2]!;
  await input('第二个'); await click('开始调试');
  expect(execution.signal?.aborted).toBe(true); expect(debugSource).toHaveBeenCalledTimes(1);
  vi.mocked(debugSource).mockResolvedValue({ book: newBook('Fixture', 'online', [{ title: '章' }]), content: '最新结果' });
  await act(async () => resolve({ book: newBook('Fixture', 'online', [{ title: '章' }]), content: '旧结果' }));
  expect(debugSource).toHaveBeenCalledTimes(2); expect(host.textContent).not.toContain('旧结果'); expect(host.textContent).toContain('最新结果');
});
