import { invoke, isTauri } from '@tauri-apps/api/core';
export type TextRequest = { url: string; method?: string; headers?: Record<string, string>; body?: string; charset?: string; sourceKey?: string; cookieJar?: boolean };
export async function fetchText(request: TextRequest): Promise<{ url: string; body: string; status?: number; headers?: Record<string, string> }> {
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('地址必须以 http 或 https 开头');
  if (isTauri()) return invoke('fetch_text', { request });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(request.url, { method: request.method || 'GET', headers: request.headers, body: request.body, signal: controller.signal });
    return { url: response.url, body: new TextDecoder(request.charset || 'utf-8').decode(await response.arrayBuffer()), status: response.status, headers: Object.fromEntries(response.headers) };
  } finally { clearTimeout(timer); }
}
