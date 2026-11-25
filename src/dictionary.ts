import { SourceRuntime } from './source-runtime';
import { fetchText } from './network';
import defaults from './default-dict-rules.json';

export type DictRule = { name: string; urlRule: string; showRule: string; enabled: boolean; sortNumber: number };
export function parseDictRules(text: string): DictRule[] {
  const value = JSON.parse(text), items = Array.isArray(value) ? value : [value];
  return items.map((item, index) => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || typeof item.urlRule !== 'string' || !item.urlRule.trim() || (item.showRule !== undefined && typeof item.showRule !== 'string')) throw new Error(`第 ${index + 1} 条词典规则格式错误`);
    return { name: item.name.trim(), urlRule: item.urlRule, showRule: item.showRule || '', enabled: item.enabled !== false, sortNumber: Number.isFinite(item.sortNumber) ? item.sortNumber : index };
  });
}
export const defaultDictRules = parseDictRules(JSON.stringify(defaults));
export const sortDictRules = (rules: DictRule[]) => [...rules].sort((a,b) => a.sortNumber - b.sortNumber || a.name.localeCompare(b.name, 'zh-CN'));
export function mergeDictRules(rules: DictRule[], incoming: DictRule[], overwrite = true): DictRule[] {
  const result = new Map(rules.map(rule => [rule.name, rule]));
  for (const rule of incoming) if (overwrite || !result.has(rule.name)) result.set(rule.name, rule);
  return sortDictRules([...result.values()]);
}
const dictSource = (rule: DictRule) => ({ bookSourceUrl: `https://dictionary.invalid/${encodeURIComponent(rule.name)}`, bookSourceName: rule.name });
export async function queryDictionary(rule: DictRule, word: string, request = fetchText): Promise<string> {
  const runtime = new SourceRuntime(dictSource(rule), { key: word }, request);
  try {
    await runtime.initialize();
    const response = await runtime.fetch(rule.urlRule);
    return rule.showRule.trim() ? String(await runtime.rule(response.body, rule.showRule)) : response.body;
  } finally { await runtime.close(); }
}
export async function dictionaryAction(rule: DictRule, name: string, script: string) {
  const runtime = new SourceRuntime(dictSource(rule));
  try { await runtime.initialize(); await runtime.rule(name, `@js:${script}`); }
  finally { await runtime.close(); }
}
