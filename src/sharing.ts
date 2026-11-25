import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Source } from './model';

export type SharedFile = { name: string; mime: string; text: string };
export function sourceExport(sources: Source[], now = new Date()): SharedFile {
  if (!sources.length) throw new Error('请选择书源');
  const single = sources.length === 1 ? sources[0] : undefined;
  const name = single?.bookSourceName.replace(/[\\/:*?"<>|]/g, '_');
  if (single?.mainJs?.trim()) return { name: `${name}.js`, mime: 'text/javascript', text: single.mainJs };
  const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()].map((v, i) => i ? String(v).padStart(2, '0') : String(v)).join('');
  return { name: `bookSource_${name ?? stamp}.json`, mime: 'text/plain', text: JSON.stringify(sources, null, 2) };
}
async function nativeShare(request: { title: string; text: string; name?: string; mime?: string }): Promise<boolean> {
  const response = await (/Android/i.test(navigator.userAgent)
    ? invoke<{ json: string }>('java_bridge', { payload: JSON.stringify({ operation: 'share', ...request }) })
    : invoke<{ json: string }>('source_browser', { request: { mode: 'share', ...request } }));
  const result = JSON.parse(response.json);
  if (result.error) throw new Error(result.error);
  return result.value !== false;
}
export async function shareText(text: string, title = '分享'): Promise<boolean> {
  if (isTauri()) return nativeShare({ title, text });
  if (!navigator.share) throw new Error('当前环境无法打开系统分享');
  try { await navigator.share({ title, text }); return true; }
  catch (error) { if ((error as Error).name === 'AbortError') return false; throw error; }
}
export async function shareFile(file: SharedFile, title = '分享选中源'): Promise<boolean> {
  if (isTauri()) return nativeShare({ title, ...file });
  const files = [new File([file.text], file.name, { type: file.mime })];
  if (!navigator.share || !navigator.canShare?.({ files })) throw new Error('当前环境无法分享文件');
  try { await navigator.share({ title, files }); return true; }
  catch (error) { if ((error as Error).name === 'AbortError') return false; throw error; }
}
