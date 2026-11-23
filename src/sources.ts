import { JSONPath } from 'jsonpath-plus';
import { htmlText } from './import';
import { fetchText, type TextRequest } from './network';
import { newBook, type Source, type SearchResult, type Book, type Chapter } from './model';

function assertRule(rule: string) {
  if (/@js:|<js>|\bjava\.|\bPackages\.|@put:|@get:|\{\{/.test(rule)) throw new Error('此规则需要 Legado 的 JavaScript / Java 扩展，当前版本未支持');
}
export function sourceSupport(source: Source): string | undefined {
  if (source.bookSourceType && source.bookSourceType !== 0) return '当前书源引擎支持文字书源';
  if (source.mainJs || source.jsLib) return '需要 JavaScript 扩展';
  try { assertRule(JSON.stringify([source.ruleSearch, source.ruleToc, source.ruleContent, source.ruleBookInfo])); }
  catch { return '需要 JavaScript / 变量扩展'; }
  return undefined;
}
export function parseSources(text: string): Source[] {
  let value = JSON.parse(text);
  if (!Array.isArray(value)) value = [value];
  return value.map((item: Source) => {
    if (!item || typeof item.bookSourceName !== 'string' || !item.bookSourceName.trim() || typeof item.bookSourceUrl !== 'string') throw new Error('书源缺少名称或地址');
    if (!/^https?:\/\//.test(item.bookSourceUrl)) throw new Error(`书源地址无效：${item.bookSourceName}`);
    for (const key of ['ruleSearch', 'ruleExplore', 'ruleBookInfo', 'ruleToc', 'ruleContent'] as const) {
      if (typeof item[key] === 'string') item[key] = JSON.parse(item[key] as unknown as string);
    }
    return { ...item, enabled: item.enabled !== false };
  });
}
function asDocument(input: unknown): Document | Element {
  if (input instanceof Document || input instanceof Element) return input;
  return new DOMParser().parseFromString(String(input), 'text/html');
}
function cssSelector(rule: string): string {
  return rule.replace(/^@css:/, '').replace(/^class\.(.*)$/, '.$1').replace(/^id\.(.*)$/, '#$1').replace(/^tag\./, '');
}
export function select(input: unknown, rule: string): unknown[] {
  if (!rule) return [input];
  assertRule(rule);
  if (rule.includes('||')) { for (const r of rule.split('||')) { const values = select(input, r); if (values.length) return values; } return []; }
  if (rule.startsWith('$.') || rule.startsWith('$[')) {
    const json = typeof input === 'string' ? JSON.parse(input) : input;
    return JSONPath({ path: rule, json: json as object, eval: false }) as unknown[];
  }
  const root = asDocument(input);
  if (rule.startsWith('//') || rule.startsWith('.//') || rule.startsWith('@xpath:')) {
    const doc = root instanceof Document ? root : root.ownerDocument;
    const result = doc.evaluate(rule.replace(/^@xpath:/, ''), root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return Array.from({ length: result.snapshotLength }, (_, i) => result.snapshotItem(i));
  }
  return Array.from(root.querySelectorAll(cssSelector(rule)));
}
export function extract(input: unknown, rule: string | undefined): string {
  if (!rule) return '';
  assertRule(rule);
  if (rule.includes('||')) { for (const r of rule.split('||')) { const value = extract(input, r); if (value) return value; } return ''; }
  const [base, pattern, replacement = ''] = rule.split('##');
  let result: string;
  if (base.startsWith('$')) result = select(input, base).map(String).join('\n');
  else {
    const parts = base.replace(/^@css:/, '').split('@');
    const attribute = parts.length > 1 ? parts.pop()! : 'text';
    const selector = parts.join('@');
    const nodes = selector && !['text', 'textNodes', 'html', 'all'].includes(selector) ? select(input, selector) : [asDocument(input)];
    result = nodes.map(n => {
      if (!(n instanceof Node)) return String(n ?? '');
      if (attribute === 'html' || attribute === 'all' || selector === 'html') return n instanceof Element ? n.innerHTML : n.textContent || '';
      if (attribute === 'text' || attribute === 'textNodes') return n.textContent?.trim() || '';
      return n instanceof Element ? n.getAttribute(attribute) || '' : n.textContent || '';
    }).join('\n');
  }
  if (pattern) result = result.replace(new RegExp(pattern, 'g'), replacement);
  return result.trim();
}
export function makeRequest(template: string, source: Source, key = '', page = 1, base = source.bookSourceUrl): TextRequest {
  const substituted = template.replace(/\{\{key\}\}/g, encodeURIComponent(key)).replace(/\{\{page\}\}/g, String(page));
  assertRule(substituted);
  const optionStart = substituted.indexOf(',{');
  const address = optionStart < 0 ? substituted : substituted.slice(0, optionStart);
  const options = optionStart < 0 ? {} : JSON.parse(substituted.slice(optionStart + 1));
  const headers = source.header ? JSON.parse(source.header) : {};
  return { url: new URL(address, base).href, method: options.method || 'GET', headers: { ...headers, ...options.headers }, body: options.body };
}
export async function searchSource(source: Source, key: string, explore = false): Promise<SearchResult[]> {
  const unsupported = sourceSupport(source); if (unsupported) throw new Error(unsupported);
  const rule = explore ? source.ruleExplore || source.ruleSearch : source.ruleSearch;
  const template = explore ? source.exploreUrl : source.searchUrl;
  if (!template || !rule?.bookList) throw new Error(explore ? '书源未配置发现规则' : '书源未配置搜索规则');
  const response = await fetchText(makeRequest(template, source, key));
  return select(response.body, rule.bookList).map(node => {
    const bookUrl = extract(node, rule.bookUrl); const coverUrl = extract(node, rule.coverUrl);
    return { name: extract(node, rule.name), author: extract(node, rule.author) || '未知作者', url: bookUrl ? new URL(bookUrl, response.url).href : '', cover: coverUrl ? new URL(coverUrl, response.url).href : undefined, intro: extract(node, rule.intro), sourceUrl: source.bookSourceUrl, sourceName: source.bookSourceName };
  }).filter(b => b.name && /^https?:/.test(b.url));
}
export async function loadOnlineBook(result: SearchResult, source: Source): Promise<Book> {
  const info = await fetchText(makeRequest(result.url, source));
  const rule = source.ruleBookInfo;
  const toc = rule?.tocUrl ? extract(info.body, rule.tocUrl) : '';
  const tocPage = toc ? await fetchText(makeRequest(toc, source, '', 1, info.url)) : info;
  const tocRule = source.ruleToc;
  if (!tocRule?.chapterList || !tocRule.chapterUrl) throw new Error('书源未配置目录规则');
  const chapters: Chapter[] = [];
  const visited = new Set<string>();
  let current = tocPage;
  for (let page = 0; page < 100; page++) {
    if (visited.has(current.url)) break; visited.add(current.url);
    const reversed = tocRule.chapterList.startsWith('-');
    let nodes = select(current.body, reversed ? tocRule.chapterList.slice(1) : tocRule.chapterList);
    if (reversed) nodes = nodes.reverse();
    for (const node of nodes) {
      const address = extract(node, tocRule.chapterUrl);
      if (!address) continue;
      const url = new URL(address, current.url).href;
      if (!chapters.some(c => c.url === url)) chapters.push({ title: extract(node, tocRule.chapterName) || `第 ${chapters.length + 1} 章`, url });
    }
    const next = extract(current.body, tocRule.nextTocUrl);
    if (!next || visited.has(new URL(next, current.url).href)) break;
    current = await fetchText(makeRequest(next, source, '', page + 2, current.url));
  }
  if (!chapters.length) throw new Error('目录为空，请检查书源规则');
  return { ...newBook(extract(info.body, rule?.name) || result.name, 'online', chapters, extract(info.body, rule?.author) || result.author), sourceUrl: source.bookSourceUrl, url: result.url, cover: result.cover, intro: result.intro };
}
export async function loadChapter(chapter: Chapter, source: Source): Promise<string> {
  if (chapter.content !== undefined) return chapter.content;
  if (!chapter.url || !source.ruleContent?.content) throw new Error('缺少正文地址或规则');
  let current = await fetchText(makeRequest(chapter.url, source));
  const chunks: string[] = []; const visited = new Set<string>();
  for (let page = 0; page < 30; page++) {
    if (visited.has(current.url)) break; visited.add(current.url);
    let content = extract(current.body, source.ruleContent.content);
    if (source.ruleContent.replaceRegex) {
      const [pattern, replacement = ''] = source.ruleContent.replaceRegex.split('##');
      content = content.replace(new RegExp(pattern, 'g'), replacement);
    }
    chunks.push(/<[a-z][\s\S]*>/i.test(content) ? htmlText(content) : content);
    const next = extract(current.body, source.ruleContent.nextContentUrl);
    if (!next || visited.has(new URL(next, current.url).href)) break;
    current = await fetchText(makeRequest(next, source, '', page + 2, current.url));
  }
  const text = chunks.join('\n\n').trim();
  if (!text) throw new Error('正文为空，请检查正文规则');
  return text;
}
