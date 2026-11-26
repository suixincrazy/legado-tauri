import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { decodeQrPixels, qrPixels, scanNativeQr } from './qr-code';
import { shareBytes } from './sharing';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
const agent = navigator.userAgent;
afterEach(() => { vi.resetAllMocks(); Object.defineProperty(navigator, 'userAgent', { value: agent, configurable: true }); });
it('round trips Unicode source JSON, URLs and debug prefixes through real QR encoders and decoders', async () => {
  for (const text of [JSON.stringify({ bookSourceUrl: 'https://qr.example.test', bookSourceName: '中文𠮷', unknown: { retained: true } }), 'https://qr.example.test/sources.json', '++https://qr.example.test/toc', '--https://qr.example.test/chapter']) {
    const image = await qrPixels(text); expect(image.width).toBe(640); expect(await decodeQrPixels(image)).toBe(text);
    const inverted = { ...image, data: image.data.map((value, i) => i % 4 === 3 ? value : 255 - value) };
    expect(await decodeQrPixels(inverted)).toBe(text);
  }
  expect(invoke).not.toHaveBeenCalled();
});
it('reports over-capacity data and a blank image without uploading or truncating it', async () => {
  await expect(qrPixels('文'.repeat(3000))).rejects.toThrow('文字太多');
  const data = new Uint8ClampedArray(100 * 100 * 4); data.fill(255);
  expect(await decodeQrPixels({ data, width: 100, height: 100 })).toBeNull(); expect(invoke).not.toHaveBeenCalled();
});
it('passes exact binary image bytes to both native share bridges and distinguishes cancellation', async () => {
  const bytes = Uint8Array.from({ length: 20000 }, (_, i) => i % 256);
  for (const agent of ['Android', 'iPad']) {
    Object.defineProperty(navigator, 'userAgent', { value: agent, configurable: true }); vi.mocked(invoke).mockResolvedValueOnce({ json: '{"value":false}' });
    expect(await shareBytes('qr.png', 'image/png', bytes, '分享书源')).toBe(false);
    const args = vi.mocked(invoke).mock.calls.at(-1)![1] as any;
    const request = agent === 'Android' ? JSON.parse(args.payload) : args.request;
    expect(request.mime).toBe('image/png'); expect(Uint8Array.from(atob(request.base64), char => char.charCodeAt(0))).toEqual(bytes); expect(request.text).toBeUndefined();
  }
});
it('keeps QR scan cancellation distinct from content and native errors', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ json: '{"value":null}' }); expect(await scanNativeQr()).toBeNull();
  vi.mocked(invoke).mockResolvedValueOnce({ json: '{"value":"++https://qr.example.test/toc"}' }); expect(await scanNativeQr()).toBe('++https://qr.example.test/toc');
  vi.mocked(invoke).mockResolvedValueOnce({ json: '{"error":"Camera denied"}' }); await expect(scanNativeQr()).rejects.toThrow('Camera denied');
});
