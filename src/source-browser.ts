import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Source } from './model';
import * as storage from './storage';
export type BrowserRequest = { url: string; title?: string; mode?: 'login' | 'render' | 'code' | 'clearCookies'; urls?: string[]; headers?: Record<string, string>; html?: string; js?: string; preloadJs?: string };
export type BrowserResponse = { url: string; body: string; status: number; cookie?: string; cookies?: Record<string, string> };
export async function openSourceBrowser(request: BrowserRequest): Promise<BrowserResponse | string> {
  if (!isTauri()) throw new Error('网页登录请使用 Android 或 iOS 安装版');
  const response = await invoke<{ json: string }>('source_browser', { request });
  const result = JSON.parse(response.json);
  if (result.error) throw new Error(result.error);
  return result.value;
}
export async function clearBrowserCookies(urls: string[], sourceKey: string) {
  if (isTauri()) {
    await openSourceBrowser({ url: urls[0] || '', mode: 'clearCookies', urls });
    await invoke('clear_source_cookies', { sourceKey });
  }
}
export async function clearSourceCookies(source: Source) {
  const state = await storage.sourceState(source.bookSourceUrl);
  const urls = Object.keys(state).filter(key => key.startsWith('cookie:')).map(key => key.slice(7));
  if (/^https?:\/\//i.test(source.bookSourceUrl)) urls.push(source.bookSourceUrl);
  if (/^https?:\/\//i.test(source.loginUrl || '')) urls.push(source.loginUrl!);
  const visited = state['source:browserUrls']?.value;
  if (Array.isArray(visited)) urls.push(...visited.filter((url): url is string => typeof url === 'string'));
  await clearBrowserCookies([...new Set(urls)], source.bookSourceUrl);
  await storage.clearSourceState(source.bookSourceUrl, 'cookie:');
}
