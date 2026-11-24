import { htmlText } from './import';
import { fetchText, type TextRequest } from './network';
import { newBook, type Source, type SearchResult, type Book, type Chapter } from './model';
import { SourceRuntime } from './source-runtime';
export { select, extract } from './source-rules';

export function sourceSupport(source: Source): string | undefined {
  if (source.bookSourceType && source.bookSourceType !== 0) return '当前阅读器支持文字书源';
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
export function makeRequest(template: string, source: Source, key = '', page = 1, base = source.bookSourceUrl): TextRequest {
  const substituted = template.replace(/\{\{key\}\}/g, encodeURIComponent(key)).replace(/\{\{page\}\}/g, String(page));
  const optionStart = substituted.indexOf(',{');
  const address = optionStart < 0 ? substituted : substituted.slice(0, optionStart);
  const options = optionStart < 0 ? {} : JSON.parse(substituted.slice(optionStart + 1));
  const headers = source.header ? JSON.parse(source.header) : {};
  return { url: new URL(address, base).href, method: options.method || 'GET', headers: { ...headers, ...options.headers }, body: options.body };
}
function absolute(value: string, base: string) { return value ? new URL(value, base).href : ''; }
async function withRuntime<T>(source: Source, context: ConstructorParameters<typeof SourceRuntime>[1], run: (vm: SourceRuntime) => Promise<T>): Promise<T> {
  const warning = sourceSupport(source); if (warning) throw new Error(warning);
  const vm = new SourceRuntime(source, context);
  try { await vm.initialize(); return await run(vm); } finally { await vm.close(); }
}
export async function searchSource(source: Source, key: string, explore = false): Promise<SearchResult[]> {
  return withRuntime(source, { key }, async vm => {
    const rule = explore ? source.ruleExplore || source.ruleSearch : source.ruleSearch;
    let template = explore ? source.exploreUrl : source.searchUrl;
    if (!template || !rule?.bookList) throw new Error(explore ? '书源未配置发现规则' : '书源未配置搜索规则');
    if (explore && template.trim().startsWith('[')) template = JSON.parse(template)[0]?.url;
    if (!template) return [];
    const response = await fetchText(await vm.makeRequest(template)); await vm.setPage(response.url, response.body);
    const nodes = await vm.rule(response.body, rule.bookList, true);
    const results: SearchResult[] = [];
    for (const node of nodes) {
      const name = await vm.rule(node, rule.name);
      const bookUrl = await vm.rule(node, rule.bookUrl); const coverUrl = await vm.rule(node, rule.coverUrl);
      if (!name || !bookUrl) continue;
      results.push({ name, author: await vm.rule(node, rule.author) || '未知作者', url: absolute(bookUrl, response.url), cover: coverUrl ? absolute(coverUrl, response.url) : undefined, intro: await vm.rule(node, rule.intro), sourceUrl: source.bookSourceUrl, sourceName: source.bookSourceName });
    }
    return results;
  });
}
export async function loadOnlineBook(result: SearchResult, source: Source): Promise<Book> {
  return withRuntime(source, { book: { ...result, cover: result.cover }, baseUrl: result.url }, async vm => {
    const info = await fetchText(await vm.makeRequest(result.url)); await vm.setPage(info.url, info.body);
    const rule = source.ruleBookInfo;
    const data = rule?.init ? await vm.rule(info.body, rule.init) : info.body;
    const name = await vm.rule(data, rule?.name) || result.name;
    const author = await vm.rule(data, rule?.author) || result.author;
    const cover = await vm.rule(data, rule?.coverUrl) || result.cover;
    const intro = await vm.rule(data, rule?.intro) || result.intro;
    const toc = rule?.tocUrl ? await vm.rule(data, rule.tocUrl) : '';
    const tocPage = toc ? await fetchText(await vm.makeRequest(toc, info.url)) : info;
    const tocRule = source.ruleToc;
    if (!tocRule?.chapterList || !tocRule.chapterUrl) throw new Error('书源未配置目录规则');
    const chapters: Chapter[] = []; const visited = new Set<string>(); let current = tocPage;
    for (let page = 0; page < 100; page++) {
      if (visited.has(current.url)) break; visited.add(current.url); await vm.setPage(current.url, current.body);
      const reversed = tocRule.chapterList.startsWith('-');
      let nodes = await vm.rule(current.body, reversed ? tocRule.chapterList.slice(1) : tocRule.chapterList, true);
      if (reversed) nodes = nodes.reverse();
      for (const node of nodes) {
        const address = await vm.rule(node, tocRule.chapterUrl); if (!address) continue;
        const url = absolute(address, current.url);
        if (!chapters.some(c => c.url === url)) chapters.push({ title: await vm.rule(node, tocRule.chapterName) || `第 ${chapters.length + 1} 章`, url });
      }
      const next = await vm.rule(current.body, tocRule.nextTocUrl);
      if (!next || visited.has(absolute(next, current.url))) break;
      current = await fetchText(await vm.makeRequest(next, current.url));
    }
    if (!chapters.length) throw new Error('目录为空，请检查书源规则');
    return { ...newBook(name, 'online', chapters, author), sourceUrl: source.bookSourceUrl, url: result.url, cover: cover ? absolute(cover, info.url) : undefined, intro };
  });
}
export async function loadChapter(chapter: Chapter, source: Source, book?: Book): Promise<string> {
  if (chapter.content !== undefined) return chapter.content;
  if (!chapter.url || !source.ruleContent?.content) throw new Error('缺少正文地址或规则');
  return withRuntime(source, { chapter, book, baseUrl: chapter.url }, async vm => {
    let current = await fetchText(await vm.makeRequest(chapter.url!));
    const chunks: string[] = []; const visited = new Set<string>();
    for (let page = 0; page < 30; page++) {
      if (visited.has(current.url)) break; visited.add(current.url); await vm.setPage(current.url, current.body);
      let content = await vm.rule(current.body, source.ruleContent!.content);
      if (source.ruleContent!.replaceRegex) {
        const replace = source.ruleContent!.replaceRegex;
        if (/@js:|<js>/.test(replace)) content = await vm.rule(content, replace);
        else { const [pattern, replacement = ''] = replace.split('##'); content = content.replace(new RegExp(pattern, 'g'), replacement); }
      }
      chunks.push(/<[a-z][\s\S]*>/i.test(content) ? htmlText(content) : content);
      const next = await vm.rule(current.body, source.ruleContent!.nextContentUrl);
      if (!next || visited.has(absolute(next, current.url))) break;
      current = await fetchText(await vm.makeRequest(next, current.url));
    }
    const text = chunks.join('\n\n').trim(); if (!text) throw new Error('正文为空，请检查正文规则'); return text;
  });
}
