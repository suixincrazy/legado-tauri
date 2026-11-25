import type { ReplaceRule } from './replacement-engine';
export * from './replacement-engine';

export async function applyReplacement(text: string, rules: ReplaceRule[], applied?:(rule:ReplaceRule)=>void): Promise<string> {
  if (!rules.length) return text;
  const worker = new Worker(new URL('./replacement.worker.ts', import.meta.url), { type: 'module' });
  try {
    for (const rule of rules) {
      const before=text;
      text = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`替换规则“${rule.name}”执行超时`)), Math.max(100, Math.min(30000, rule.timeoutMillisecond || 3000)));
        worker.onmessage = event => { clearTimeout(timer); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.text); };
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        worker.postMessage({ text, rule });
      });
      if(before!==text)applied?.(rule);
    }
    return text;
  } finally { worker.terminate(); }
}
