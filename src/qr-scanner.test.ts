import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { QrScanner } from './QrScanner';
import { cancelNativeQr, scanNativeQr, decodeQrImage } from './qr-code';
import { pickFiles } from './files';

vi.mock('./qr-code', () => ({ nativeQrAvailable: () => true, scanNativeQr: vi.fn(), cancelNativeQr: vi.fn(async () => null), decodeQrImage: vi.fn() }));
vi.mock('./files', () => ({ pickFiles: vi.fn() }));
let root: ReturnType<typeof createRoot> | undefined, host: HTMLElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); vi.resetAllMocks(); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; });
async function mount() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const callbacks = { scanned: vi.fn(), close: vi.fn() };
  await act(async () => root!.render(createElement(QrScanner, callbacks)));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); return callbacks;
}
it('cancels an active native scan on unmount and ignores late results', async () => {
  let resolve!: (value: string) => void;
  vi.mocked(scanNativeQr).mockImplementation(() => new Promise(done => { resolve = done; }));
  const callbacks = await mount(); expect(scanNativeQr).toHaveBeenCalledTimes(1);
  await act(async () => root!.unmount()); root = undefined; expect(cancelNativeQr).toHaveBeenCalledTimes(1);
  await act(async () => resolve('late result')); expect(callbacks.scanned).not.toHaveBeenCalled(); expect(callbacks.close).not.toHaveBeenCalled();
});
it('returns without changing a draft on native cancellation and keeps album decoding available on failure', async () => {
  vi.mocked(scanNativeQr).mockResolvedValueOnce(null); const cancelled = await mount(); expect(cancelled.close).toHaveBeenCalledTimes(1); expect(cancelled.scanned).not.toHaveBeenCalled();
  await act(async () => root!.unmount()); host.remove(); root = undefined;
  vi.mocked(scanNativeQr).mockRejectedValueOnce(new Error('Camera denied')); const callbacks = await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Camera denied');
  vi.mocked(pickFiles).mockResolvedValue([{ name: 'fixture.png', bytes: new Uint8Array([1, 2]) }]); vi.mocked(decodeQrImage).mockResolvedValue('fixture result');
  await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent === '图库')!.click());
  expect(callbacks.scanned).toHaveBeenCalledExactlyOnceWith('fixture result');
});
