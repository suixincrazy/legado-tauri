import type { Book } from './model';

export type ReplaceRule = {
  id: number; name: string; group?: string; pattern: string; replacement: string; scope?: string;
  scopeTitle: boolean; scopeContent: boolean; scopeSource?: boolean; excludeScope?: string;
  isEnabled: boolean; isRegex: boolean; order: number; timeoutMillisecond: number; previewText?: string;
};
export const newReplaceRule = (): ReplaceRule => ({ id: Date.now(), name: '', pattern: '', replacement: '', scopeTitle: false, scopeContent: true, isEnabled: true, isRegex: true, order: 0, timeoutMillisecond: 3000 });
export function replacementPattern(pattern:string):RegExp {
  let flags='g';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,extra:string)=>{flags=[...new Set(flags+extra)].join('');return '';});
  return new RegExp(pattern,flags);
}
export function parseReplaceRules(text: string, validateSyntax=true): ReplaceRule[] {
  const data = JSON.parse(text);
  return (Array.isArray(data) ? data : [data]).map((rule, index) => {
    if (!rule || typeof rule.name !== 'string' || typeof rule.pattern !== 'string' || typeof rule.replacement !== 'string') throw new Error('替换规则缺少名称、匹配或替换内容');
    if (!rule.pattern) throw new Error('替换内容不能为空');
    if (validateSyntax&&rule.isRegex !== false) replacementPattern(rule.pattern);
    return { ...newReplaceRule(), ...rule, id: Number.isFinite(rule.id) ? rule.id : Date.now() + index };
  });
}
export function scopedRules(rules: ReplaceRule[], book: Pick<Book, 'name' | 'sourceUrl'>, target: 'title' | 'content'): ReplaceRule[] {
  const matches = (scope: string) => scope.includes(book.name) || !!(book.sourceUrl && scope.includes(book.sourceUrl));
  return rules.filter(rule => rule.isEnabled && (target === 'title' ? rule.scopeTitle : rule.scopeContent) && (!rule.scope || matches(rule.scope)) && (!rule.excludeScope || !matches(rule.excludeScope))).sort((a, b) => a.order - b.order);
}
export function replaceText(text: string, rule: ReplaceRule): string {
  if (!rule.pattern) throw new Error('替换内容不能为空');
  return rule.isRegex ? text.replace(replacementPattern(rule.pattern), rule.replacement) : text.split(rule.pattern).join(rule.replacement);
}

export function bookUsesReplace(book:Book,defaultEnabled:boolean):boolean {
  if(book.useReplaceRule!==undefined)return book.useReplaceRule;
  const legacy=(book as Book&{legacy?:{type?:number;originName?:string}}).legacy;
  const epub=book.kind==='epub'||(!!(legacy?.type&&legacy.type&256)&&/\.epub$/i.test(legacy?.originName||''));
  return !epub&&!((legacy?.type||0)&64)&&defaultEnabled;
}
