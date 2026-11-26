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
  return saveBytes(name,new TextEncoder().encode(text));
}
export async function saveBytes(name:string,bytes:Uint8Array) {
  const extension = name.split('.').pop()?.toLowerCase() || 'txt';
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: name, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (!path) return false;
    // Android serializes byte buffers as JSON arrays; large backups exceed that limit.
    const chunkSize = 256 * 1024;
    for (let offset = 0; offset < Math.max(1, bytes.length); offset += chunkSize) {
      await writeFile(path, bytes.subarray(offset, offset + chunkSize), { append: offset > 0 });
    }
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: extension === 'zip'?'application/zip':extension === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); return true;
}
