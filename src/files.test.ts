import { beforeEach, expect, it, vi } from 'vitest';
import { saveFile } from './files';

const native = vi.hoisted(() => ({ save: vi.fn(), writeFile: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: native.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: native.writeFile }));
beforeEach(() => { vi.clearAllMocks(); native.save.mockResolvedValue('content://fixture/backup.json'); });

it('exports large Unicode backups through bounded native messages and replaces the previous contents', async () => {
  const text = '正文𠮷\n'.repeat(100000), parts: Uint8Array[] = [];
  native.writeFile.mockImplementation(async (_path, bytes, options) => {
    if (bytes.byteLength > 256 * 1024) throw new RangeError('Invalid array length');
    if (!options?.append) parts.length = 0;
    parts.push(bytes.slice());
  });
  expect(await saveFile('backup.json', text)).toBe(true);
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  expect(new TextDecoder().decode(result)).toBe(text);
  expect(await saveFile('backup.json', '')).toBe(true);
  expect(parts.reduce((size, part) => size + part.length, 0)).toBe(0);
});

it('stops writing after a native failure and does not write after picker cancellation', async () => {
  native.writeFile.mockRejectedValueOnce(new Error('Storage full'));
  await expect(saveFile('backup.json', 'x'.repeat(600000))).rejects.toThrow('Storage full');
  expect(native.writeFile).toHaveBeenCalledTimes(1);
  native.save.mockResolvedValueOnce(null);
  expect(await saveFile('backup.json', 'cancelled')).toBe(false);
  expect(native.writeFile).toHaveBeenCalledTimes(1);
});
