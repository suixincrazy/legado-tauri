import { invoke, isTauri } from '@tauri-apps/api/core';
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
