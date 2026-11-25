export type SourcePhase = 'search' | 'explore' | 'info' | 'toc' | 'content';
export type SourceEvent = { phase: SourcePhase; time: number } & (
  { type: 'response'; url: string; body: string; status?: number; origin?: 'page' | 'request' } |
  { type: 'rule'; rule: string; value: string } |
  { type: 'call'; name: string; value: string } |
  { type: 'log'; text: string }
);
export type SourceExecution = { signal?: AbortSignal; onEvent?: (event: SourceEvent) => void };
export type RuntimeTrace = SourceExecution & { phase: SourcePhase };
export function checkSourceCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('已停止调试', 'AbortError');
}
export function traceValue(value: unknown): string {
  if (typeof Node !== 'undefined' && value instanceof Node) return value instanceof Element ? value.outerHTML : value.textContent || '';
  if (Array.isArray(value)) return value.map(traceValue).join('\n').slice(0, 12000);
  if (typeof value === 'string') return value.slice(0, 12000);
  return (JSON.stringify(value, null, 2) || '').slice(0, 12000);
}
