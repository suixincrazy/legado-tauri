import { invoke, isTauri } from '@tauri-apps/api/core';
export type TextRequest = { url: string; method?: string; headers?: Record<string, string>; body?: string };
export async function fetchText(request: TextRequest): Promise<{ url: string; body: string }> {
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('地址必须以 http 或 https 开头');
  if (isTauri()) return invoke('fetch_text', { request });
  const response = await fetch(request.url, { method: request.method || 'GET', headers: request.headers, body: request.body, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { url: response.url, body: await response.text() };
}
