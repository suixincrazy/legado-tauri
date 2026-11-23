import { isTauri } from '@tauri-apps/api/core';
export async function pickFiles(extensions: string[], multiple = false): Promise<{ name: string; bytes: Uint8Array }[]> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const picked = await open({ multiple, filters: [{ name: '文件', extensions }] });
    if (!picked) return [];
    return Promise.all((Array.isArray(picked) ? picked : [picked]).map(async path => ({ name: decodeURIComponent(path).split(/[\\/]/).pop() || 'book.txt', bytes: await readFile(path) })));
  }
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = extensions.map(e => '.' + e).join(','); input.multiple = multiple;
    input.onchange = async () => resolve(await Promise.all(Array.from(input.files || []).map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    input.oncancel = () => resolve([]); input.click();
  });
}
export async function saveFile(name: string, text: string) {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return false;
    await writeFile(path, new TextEncoder().encode(text)); return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); return true;
}
