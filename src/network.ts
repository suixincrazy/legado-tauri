import { invoke, isTauri } from '@tauri-apps/api/core';
export type TextRequest = { url: string; method?: string; headers?: Record<string, string>; body?: string; charset?: string; sourceKey?: string; cookieJar?: boolean; responseHex?: boolean };
const responseBody = (bytes: Uint8Array, request: TextRequest, charset = 'utf-8') => request.responseHex ? Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') : new TextDecoder(request.charset || charset).decode(bytes);
export async function fetchText(request: TextRequest): Promise<{ url: string; body: string; status?: number; headers?: Record<string, string> }> {
  const url = new URL(request.url);
  if (url.protocol === 'data:') {
    const match = /^data:([^,]*),([\s\S]*)$/i.exec(request.url);
    if (!match) throw new Error('无效的 data URI');
    const bytes = /;base64$/i.test(match[1]) ? Uint8Array.from(atob(decodeURIComponent(match[2])), char => char.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(match[2]));
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Response exceeds 20 MiB');
    return { url: request.url, body: responseBody(bytes, request, /charset=([^;]+)/i.exec(match[1])?.[1]), status: 200, headers: {} };
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('地址必须以 http 或 https 开头');
  if (isTauri()) return invoke('fetch_text', { request });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(request.url, { method: request.method || 'GET', headers: request.headers, body: request.body, signal: controller.signal });
    const charset = /charset=["']?([^;"']+)/i.exec(response.headers.get('content-type') || '')?.[1];
    return { url: response.url, body: responseBody(new Uint8Array(await response.arrayBuffer()), request, charset), status: response.status, headers: Object.fromEntries(response.headers) };
  } finally { clearTimeout(timer); }
}
