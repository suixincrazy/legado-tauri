import { invoke, isTauri } from '@tauri-apps/api/core';

async function clipboard(action: 'read' | 'write', text?: string): Promise<string> {
  if (!isTauri()) {
    if (action === 'read') return navigator.clipboard.readText();
    await navigator.clipboard.writeText(text || '');
    return '';
  }
  const request = { action, text };
  const response = await (/Android/i.test(navigator.userAgent)
    ? invoke<{ json: string }>('java_bridge', { payload: JSON.stringify({ operation: 'clipboard', ...request }) })
    : invoke<{ json: string }>('source_browser', { request: { mode: 'clipboard', ...request } }));
  const result = JSON.parse(response.json);
  if (result.error) throw new Error(result.error);
  return String(result.value ?? '');
}

export const readClipboardText = () => clipboard('read');
export const writeClipboardText = (text: string) => clipboard('write', text);
