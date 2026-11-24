import { JSONPath } from 'jsonpath-plus';

export function splitRule(value: string, delimiter: string): string[] {
  const out: string[] = []; let start = 0, depth = 0, quote = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if ('[({'.includes(c)) depth++;
    if ('])}'.includes(c)) depth--;
    if (!depth && value.startsWith(delimiter, i)) { out.push(value.slice(start, i)); i += delimiter.length - 1; start = i + 1; }
  }
  out.push(value.slice(start)); return out;
}
export function asDocument(input: unknown): Document | Element {
  if (input instanceof Document || input instanceof Element) return input;
  return new DOMParser().parseFromString(String(input ?? ''), 'text/html');
}
export function jsoupSelect(root: Document | Element, selector: string): Element[] {
  let index: number | undefined, greater: number | undefined, less: number | undefined, contains: string | undefined;
  selector = selector.replace(/:(?:eq|nth)\((-?\d+)\)/g, (_, n) => { index = Number(n); return ''; })
    .replace(/:gt\((-?\d+)\)/g, (_, n) => { greater = Number(n); return ''; })
    .replace(/:lt\((-?\d+)\)/g, (_, n) => { less = Number(n); return ''; })
    .replace(/:contains\(([^)]*)\)/g, (_, text) => { contains = text.replace(/^['"]|['"]$/g, ''); return ''; });
  const has: string[] = [];
  selector = selector.replace(/:has\(([^()]*)\)/g, (_, child) => { has.push(child); return ''; });
  let nodes = Array.from(root.querySelectorAll(selector.trim() || '*'));
  if (contains !== undefined) nodes = nodes.filter(n => n.textContent?.includes(contains!));
  if (has.length) nodes = nodes.filter(n => has.every(s => jsoupSelect(n, s).length));
  if (greater !== undefined) nodes = nodes.filter((_, i) => i > greater!);
  if (less !== undefined) nodes = nodes.filter((_, i) => i < less!);
  if (index !== undefined) nodes = nodes.slice(index < 0 ? nodes.length + index : index, (index < 0 ? nodes.length + index : index) + 1);
  return nodes;
}
function cssStage(input: unknown[], raw: string): unknown[] {
  let rule = raw, indices: string | undefined, exclude = false;
  const suffix = rule.match(/(?:\.(-?\d+(?::-?\d+)?(?:,-?\d+)*)|!(-?\d+(?:,-?\d+)*))$/);
  if (suffix) { indices = suffix[1] ?? suffix[2]; exclude = !!suffix[2]; rule = rule.slice(0, -suffix[0].length); }
  let nodes: unknown[];
  if (rule.startsWith('text.')) nodes = input.flatMap(n => Array.from(asDocument(n).querySelectorAll('*')).filter(e => e.textContent?.trim() === rule.slice(5)));
  else {
    rule = rule.replace(/^class\./, '.').replace(/^id\./, '#').replace(/^tag\./, '');
    nodes = input.flatMap(n => jsoupSelect(asDocument(n), rule || '*'));
  }
  if (indices !== undefined) {
    const selected = new Set<number>();
    for (const part of indices.split(',')) {
      const bounds = part.split(':').map(n => Number(n) < 0 ? nodes.length + Number(n) : Number(n));
      if (bounds.length === 1) selected.add(bounds[0]);
      else for (let i = bounds[0]; i <= bounds[1]; i++) selected.add(i);
    }
    nodes = nodes.filter((_, i) => selected.has(i) !== exclude);
  }
  return nodes;
}
export function select(input: unknown, rule: string): unknown[] {
  if (!rule) return Array.isArray(input) ? input : [input];
  if (/@js:|<js>/i.test(rule)) throw new Error('脚本规则需要书源执行上下文');
  for (const op of ['||', '&&', '%%']) {
    const parts = splitRule(rule, op); if (parts.length < 2) continue;
    const lists = parts.map(r => select(input, r));
    if (op === '||') return lists.find(a => a.length) || [];
    if (op === '&&') return lists.flat();
    return Array.from({ length: Math.max(...lists.map(a => a.length)) }, (_, i) => lists.map(a => a[i]).filter(v => v !== undefined)).flat();
  }
  rule = rule.replace(/^@(?:json|jsonpath):/i, '');
  let json = input;
  if (typeof input === 'string' && /^[\[{]/.test(input.trim())) { try { json = JSON.parse(input); } catch { /* HTML rules can start with a bracket. */ } }
  if (rule.startsWith('$') || (json !== null && typeof json === 'object' && !(json instanceof Node))) {
    const path = rule.startsWith('$') ? rule : '$.' + rule;
    return JSONPath({ path, json: json as object, eval: false }) as unknown[];
  }
  const root = asDocument(input);
  if (rule.startsWith('//') || rule.startsWith('.//') || rule.startsWith('@xpath:')) {
    const doc = root instanceof Document ? root : root.ownerDocument;
    const result = doc.evaluate(rule.replace(/^@xpath:/, ''), root, null, XPathResult.ANY_TYPE, null);
    if (result.resultType === XPathResult.STRING_TYPE) return [result.stringValue];
    if (result.resultType === XPathResult.NUMBER_TYPE) return [result.numberValue];
    if (result.resultType === XPathResult.BOOLEAN_TYPE) return [result.booleanValue];
    const nodes: Node[] = []; let node: Node | null;
    while ((node = result.iterateNext())) nodes.push(node); return nodes;
  }
  return splitRule(rule.replace(/^@css:/, ''), '@').filter(Boolean).reduce(cssStage, Array.isArray(input) ? input : [root]);
}
export function extract(input: unknown, rule: string | undefined): string {
  if (!rule) return '';
  if (/@js:|<js>/i.test(rule)) throw new Error('脚本规则需要书源执行上下文');
  const fallback = splitRule(rule, '||');
  if (fallback.length > 1) { for (const part of fallback) { const value = extract(input, part); if (value) return value; } return ''; }
  const join = splitRule(rule, '&&'); if (join.length > 1) return join.map(r => extract(input, r)).filter(Boolean).join('\n');
  const [raw, pattern, replacement = '', first] = rule.split('##');
  const base = raw.replace(/^@css:/, '');
  let result: string;
  if (base.startsWith('$') || base.startsWith('@json') || (typeof input === 'object' && input !== null && !(input instanceof Node))) result = select(input, base).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')).join('\n');
  else if (/^(?:@xpath:)?(?:\/\/|\.\/\/)/.test(base) && /\/(?:@\w+|text\(\))/.test(base)) result = select(input, base).map(n => n instanceof Node ? n.textContent ?? '' : String(n ?? '')).join('\n');
  else {
    const parts = splitRule(base, '@');
    const last = parts[parts.length - 1];
    const attribute = parts.length > 1 || /^(?:text|textNodes|ownText|html|all|href|src|content|title|value|data-[\w-]+)$/.test(last) ? parts.pop()! : 'text';
    const selector = parts.join('@');
    const nodes = selector ? select(input, selector) : (Array.isArray(input) ? input : [asDocument(input)]);
    result = nodes.map(n => {
      if (!(n instanceof Node)) return String(n ?? '');
      if (attribute === 'html') return n instanceof Element ? n.innerHTML : (n as Document).documentElement?.innerHTML || '';
      if (attribute === 'all') return n instanceof Element ? n.outerHTML : (n as Document).documentElement?.outerHTML || '';
      if (attribute === 'textNodes' || attribute === 'ownText') return Array.from(n.childNodes).filter(c => c.nodeType === Node.TEXT_NODE).map(c => c.textContent?.trim()).filter(Boolean).join(attribute === 'ownText' ? ' ' : '\n');
      if (attribute === 'text') return n.textContent?.trim() || '';
      return n instanceof Element ? n.getAttribute(attribute) || '' : n.textContent || '';
    }).join('\n');
  }
  if (pattern) {
    const regex = new RegExp(pattern.replace(/^\(\?i\)/, ''), pattern.startsWith('(?i)') ? 'gi' : 'g');
    if (first !== undefined) { const match = result.match(new RegExp(regex.source, regex.ignoreCase ? 'i' : '')); result = match ? match[0].replace(regex, replacement) : ''; }
    else result = result.replace(regex, replacement);
  }
  return result.trim();
}
