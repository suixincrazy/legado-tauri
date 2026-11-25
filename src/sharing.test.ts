import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { shareFile, shareText, sourceExport } from './sharing';

const native = vi.hoisted(() => ({ enabled: true }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.enabled, invoke: vi.fn() }));
const agent = navigator.userAgent;
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); native.enabled = true; Object.defineProperty(navigator, 'userAgent', { value: agent, configurable: true }); });
const source = { bookSourceName: '源/一:*?', bookSourceUrl: 'https://share-fixture.test', mainJs: '', unknown: { retained: true } };
it('exports single JS sources as unchanged scripts and other selections as complete JSON arrays', () => {
  const script = '\nfunction search() { return []; }\n';
  expect(sourceExport([{ ...source, mainJs: script }])).toEqual({ name: '源_一___.js', mime: 'text/javascript', text: script });
  const one = sourceExport([source]); expect(one.name).toBe('bookSource_源_一___.json'); expect(JSON.parse(one.text)).toEqual([source]);
  const both = sourceExport([source, { ...source, mainJs: script }], new Date(2026, 10, 26, 7, 5));
  expect(both.name).toBe('bookSource_202611260705.json'); expect(JSON.parse(both.text)[1].mainJs).toBe(script);
  expect(() => sourceExport([])).toThrow('请选择');
});
it('passes Unicode and file metadata through Android and iOS native share sheets', async () => {
  vi.mocked(invoke).mockResolvedValue({ json: '{"value":true}' });
  Object.defineProperty(navigator, 'userAgent', { value: 'Android', configurable: true });
  expect(await shareText('中文𠮷\n内容')).toBe(true);
  expect(JSON.parse((vi.mocked(invoke).mock.calls[0][1] as any).payload)).toEqual({ operation: 'share', title: '分享', text: '中文𠮷\n内容' });
  Object.defineProperty(navigator, 'userAgent', { value: 'iPad', configurable: true });
  const file = sourceExport([source]); expect(await shareFile(file)).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith('source_browser', { request: { mode: 'share', title: '分享选中源', ...file } });
  vi.mocked(invoke).mockResolvedValueOnce({ json: '{"value":false}' }); expect(await shareText('cancel')).toBe(false);
});
it('propagates native errors and treats a cancelled browser sheet as cancellation', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ json: '{"error":"Share failed"}' }); await expect(shareText('x')).rejects.toThrow('Share failed');
  native.enabled = false;
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')), canShare: () => true });
  expect(await shareFile(sourceExport([source]))).toBe(false);
  vi.stubGlobal('navigator', {}); await expect(shareText('x')).rejects.toThrow('系统分享');
});
