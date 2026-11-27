import { htmlText } from './import';
import {settings} from './storage';
import {chapterInfoWordCount} from './chapter-word-count';
import { type TextRequest } from './network';
import { newBook, type Source, type SearchResult, type Book, type Chapter } from './model';
import type { SourceRuntime } from './source-runtime';
import { checkSourceCancelled, type SourceExecution, type RuntimeTrace } from './source-trace';
import {convertLegacySource,isLegacySource} from './legacy-backup';
export { select, extract } from './source-rules';

export function sourceSupport(source: Source): string | undefined {
  if (source.bookSourceType && source.bookSourceType !== 0) return '当前阅读器支持文字书源';
  return undefined;
}
export function parseSources(text: string): Source[] {
  let value = JSON.parse(text);
  if (!Array.isArray(value)) value = [value];
  return value.map((item: Source) => {
    if(item&&isLegacySource(item))item=convertLegacySource(item);
    if (!item || typeof item.bookSourceName !== 'string' || !item.bookSourceName.trim() || typeof item.bookSourceUrl !== 'string') throw new Error('书源缺少名称或地址');
    if (!item.bookSourceUrl.trim()) throw new Error(`书源标识为空：${item.bookSourceName}`);
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
function sourceVariables(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
async function nextPages(vm: SourceRuntime, body: string, rule?: string): Promise<string[]> {
  if (!rule) return [];
  const value = await vm.rule(body, rule, 'raw');
  return (Array.isArray(value) ? value : [value]).flatMap(v => String(v ?? '').split('\n')).map(v => v.trim()).filter(Boolean);
}
async function withRuntime<T>(source: Source, context: ConstructorParameters<typeof SourceRuntime>[1], run: (vm: SourceRuntime) => Promise<T>): Promise<T> {
  checkSourceCancelled(context?.trace?.signal);
  const warning = sourceSupport(source); if (warning) throw new Error(warning);
  const {SourceRuntime}=await import('./source-runtime');
  const vm = new SourceRuntime(source, context);
  try { await vm.initialize(); return await run(vm); } finally { await vm.close(); }
}
export type ExploreKind = { title: string; url?: string; type?:'url'|'text'|'button'|'toggle'|'select'; action?:string; chars?:string[]; default?:string; viewName?:string; style?:{layout_flexGrow?:number;layout_flexShrink?:number;layout_alignSelf?:string;layout_flexBasisPercent?:number;layout_wrapBefore?:boolean;layout_justifySelf?:string} };
export async function exploreKinds(source: Source, execution?: SourceExecution): Promise<ExploreKind[]> {
  return withRuntime(source, { trace: execution && { ...execution, phase: 'explore' } }, async vm => {
    let value: unknown = source.exploreUrl?.trim() || '';
    if (/^@js:|^<js>/i.test(String(value))) {
      value = await vm.evaluate(String(value).replace(/^@js:|^<js>|<\/js>$/gi, ''));
      await vm.evaluate('if (__infoSave) infoMap.saveNow()');
    }
    if (typeof value === 'string' && value.trim().startsWith('[')) value = JSON.parse(value);
    if (Array.isArray(value)) return value.map(item => ({ ...item, title: String(item.title || item.name || '未命名分类'), url: item.url ? String(item.url) : undefined }));
    return String(value || '').split(/&&|\n/).filter(s => s.trim()).map(line => {
      const divider = line.indexOf('::');
      return divider >= 0 ? { title: line.slice(0, divider).trim(), url: line.slice(divider + 2).trim() || undefined } : /^https?:|^\//.test(line) ? { title: '浏览书籍', url: line } : { title: line };
    });
  });
}
export async function searchSource(source: Source, key: string, explore = false, exploreUrl?: string, page = 1, execution?: SourceExecution): Promise<SearchResult[]> {
  const shared: Partial<Book> = { variables: {} };
  return withRuntime(source, { key, page, book: shared, trace: execution && { ...execution, phase: explore ? 'explore' : 'search' } }, async vm => {
    if (source.mainJs?.trim()) {
      const items = await vm.call(explore ? 'explore' : 'search', explore ? [exploreUrl || source.exploreUrl || '', page] : [key, page]);
      if (items == null) return [];
      if (!Array.isArray(items)) throw new Error('search/explore 返回值不是数组');
      return items.filter(item => item && typeof item.name === 'string' && item.name && typeof item.bookUrl === 'string' && item.bookUrl).map(item => ({ name: item.name, author: item.author || '未知作者', url: absolute(item.bookUrl,source.bookSourceUrl), cover: item.coverUrl ? absolute(item.coverUrl,source.bookSourceUrl) : undefined, intro: item.intro, category:item.kind, latestChapterTitle:item.latestChapterTitle, wordCount:item.wordCount, sourceUrl: source.bookSourceUrl, sourceName: source.bookSourceName, variables: { ...shared.variables, ...sourceVariables(item.variable || item.variables) } }));
    }
    const rule = explore ? source.ruleExplore || source.ruleSearch : source.ruleSearch;
    let template = explore ? exploreUrl || source.exploreUrl : source.searchUrl;
    if (!template || !rule?.bookList) throw new Error(explore ? '书源未配置发现规则' : '书源未配置搜索规则');
    if (explore && template.trim().startsWith('[')) template = JSON.parse(template)[0]?.url;
    if (!template) return [];
    const response = await vm.fetch(template); await vm.setPage(response.url, response.body);
    const nodes = await vm.rule(response.body, rule.bookList, true);
    const results: SearchResult[] = [];
    for (const node of nodes) {
      const entry: SearchResult = { name: '', author: '', url: '', sourceUrl: source.bookSourceUrl, sourceName: source.bookSourceName, variables: { ...shared.variables } };
      await vm.setBook(entry);
      entry.name = await vm.rule(node, rule.name); await vm.setBook(entry);
      entry.author = await vm.rule(node, rule.author) || '未知作者';
      entry.intro = await vm.rule(node, rule.intro);
      entry.category = await vm.rule(node, rule.kind); entry.latestChapterTitle = await vm.rule(node, rule.lastChapter); entry.wordCount = await vm.rule(node, rule.wordCount);
      const bookUrl = await vm.rule(node, rule.bookUrl); const coverUrl = await vm.rule(node, rule.coverUrl);
      if (!entry.name || !bookUrl) continue;
      entry.url = absolute(bookUrl, response.url); entry.cover = coverUrl ? absolute(coverUrl, response.url) : undefined;
      results.push(entry);
    }
    return results;
  });
}
export async function loadOnlineBook(result: SearchResult, source: Source, execution?: SourceExecution): Promise<Book> {
  if (source.mainJs?.trim()) {
    const entity = { ...result, bookUrl: result.url, coverUrl: result.cover, origin: source.bookSourceUrl, tocUrl: result.url, variables: { ...result.variables } };
    const info = await withRuntime(source, { book: entity, baseUrl: result.url, trace: execution && { ...execution, phase: 'info' } }, vm => vm.call('getBookInfo', [entity], true));
    if (info != null && (typeof info !== 'object' || Array.isArray(info))) throw new Error('getBookInfo 返回值不是对象');
    const merged = { ...entity, ...info, variables: { ...entity.variables, ...sourceVariables(info?.variable || info?.variables) } };
    const list = await jsChapters(merged, source, merged.tocUrl || result.url, execution);
    const book = newBook(merged.name || result.name, 'online', list, merged.author || result.author);
    return { ...book, url: result.url, tocUrl: merged.tocUrl || result.url, sourceUrl: source.bookSourceUrl, intro: merged.intro, cover: merged.coverUrl, variables: merged.variables };
  }
  const entity = { ...result, variables: { ...result.variables } };
  const trace: RuntimeTrace | undefined = execution && { ...execution, phase: 'info' };
  return withRuntime(source, { book: entity, baseUrl: result.url, trace }, async vm => {
    const info = await vm.fetch(result.url); await vm.setPage(info.url, info.body);
    const rule = source.ruleBookInfo;
    const data = rule?.init ? await vm.rule(info.body, rule.init, 'raw') : info.body;
    const name = await vm.rule(data, rule?.name) || result.name;
    const author = await vm.rule(data, rule?.author) || result.author;
    const cover = await vm.rule(data, rule?.coverUrl) || result.cover;
    const intro = await vm.rule(data, rule?.intro) || result.intro;
    Object.assign(entity, { name, author, cover, intro }); await vm.setBook(entity);
    const toc = rule?.tocUrl ? await vm.rule(data, rule.tocUrl) : '';
    if (trace) trace.phase = 'toc';
    const tocPage = toc ? await vm.fetch(toc, info.url) : info;
    if (!toc && trace) trace.onEvent?.({ phase: 'toc', time: Date.now(), type: 'response', origin: 'page', ...info });
    const chapters = await ruleChapters(vm, source, tocPage);
    return { ...newBook(name, 'online', chapters, author), sourceUrl: source.bookSourceUrl, url: result.url, cover: cover ? absolute(cover, info.url) : undefined, intro, variables: entity.variables };
  });
}
async function jsChapters(entity: Partial<Book>, source: Source, base: string, execution?: SourceExecution): Promise<Chapter[]> {
  const chapters = await withRuntime(source, { book: entity, baseUrl: base, trace: execution && { ...execution, phase: 'toc' } }, vm => vm.call('getChapters', [entity]));
  if (!Array.isArray(chapters) || !chapters.length) throw new Error('JS源目录为空或返回值不是数组');
  const list: Chapter[] = chapters.filter(c => c && typeof c.title === 'string' && c.title && typeof c.url === 'string' && c.url).map((c, index) => ({ title: c.title, url: c.isVolume && c.url === c.title ? c.url : absolute(c.url, base), isVolume: !!c.isVolume, isVip: !!c.isVip, isPay: !!c.isPay, index, ...(typeof c.wordCount==='string'?{wordCount:c.wordCount}:{}), variables: sourceVariables(c.variable || c.variables) }));
  if (!list.length) throw new Error('JS源目录没有有效章节');
  return list;
}
async function ruleChapters(vm: SourceRuntime, source: Source, tocPage: Awaited<ReturnType<SourceRuntime['fetch']>>): Promise<Chapter[]> {
  const tocRule = source.ruleToc;
  if (!tocRule?.chapterList || !tocRule.chapterUrl) throw new Error('书源未配置目录规则');
  const countWords=!!tocRule.updateTime&&(await settings()).tocCountWords;
  const chapters: Chapter[] = []; const visited = new Set<string>(); const pending: string[] = []; let current = tocPage;
  for (let page = 0; page < 100; page++) {
    if (visited.has(current.url)) break; visited.add(current.url); await vm.setPage(current.url, current.body);
    const reversed = tocRule.chapterList.startsWith('-');
    let nodes = await vm.rule(current.body, reversed ? tocRule.chapterList.slice(1) : tocRule.chapterList, true);
    if (reversed) nodes = nodes.reverse();
    for (const node of nodes) {
      const chapter: Chapter = { title: '', variables: {} }; await vm.setChapter(chapter);
      chapter.title = await vm.rule(node, tocRule.chapterName) || `第 ${chapters.length + 1} 章`; await vm.setChapter(chapter);
      const address = await vm.rule(node, tocRule.chapterUrl);
      if(tocRule.isVolume){const volume=await vm.rule(node,tocRule.isVolume);chapter.isVolume=!!volume.trim()&&volume!=='null'&&!/^(false|no|not|0|0[.]0)$/i.test(volume.trim());}
      if(!address&&!chapter.isVolume)continue;
      chapter.url = address?absolute(address, current.url):chapter.title+chapters.length;
      if(countWords&&!chapter.isVolume){const count=chapterInfoWordCount(await vm.rule(node,tocRule.updateTime));if(count!==undefined)chapter.wordCount=count;}
      if (!chapters.some(c => c.url === chapter.url)) chapters.push(chapter);
    }
    await vm.setChapter();
    pending.push(...(await nextPages(vm, current.body, tocRule.nextTocUrl)).map(url => absolute(url, current.url)));
    while (pending.length && visited.has(pending[0])) pending.shift();
    if (!pending.length) break;
    current = await vm.fetch(pending.shift()!, current.url);
  }
  if (!chapters.length) throw new Error('目录为空，请检查书源规则');
  return chapters;
}
export async function loadSourceToc(book: Book, source: Source, execution?: SourceExecution): Promise<Book> {
  const base = book.tocUrl || book.url || source.bookSourceUrl;
  const entity = { ...book, bookUrl: book.url || '', coverUrl: book.cover, origin: source.bookSourceUrl, tocUrl: base, variables: { ...book.variables } };
  const chapters = source.mainJs?.trim() ? await jsChapters(entity, source, base, execution) : await withRuntime(source, { book: entity, baseUrl: base, trace: execution && { ...execution, phase: 'toc' } }, async vm => ruleChapters(vm, source, await vm.fetch(base)));
  return { ...book, tocUrl: base, variables: entity.variables, chapters };
}
export async function loadChapter(chapter: Chapter, source: Source, book?: Book, execution?: SourceExecution): Promise<string> {
  if (source.mainJs?.trim()) {
    if (chapter.isVolume && chapter.url?.startsWith(chapter.title)) return '';
    const entity = { ...book, bookUrl: book?.url || '', coverUrl: book?.cover, origin: source.bookSourceUrl };
    const entry = { ...chapter, bookUrl: book?.url || '', baseUrl: book?.tocUrl || book?.url || source.bookSourceUrl };
    return withRuntime(source, { chapter, book: entity, baseUrl: chapter.url, trace: execution && { ...execution, phase: 'content' } }, async vm => {
      const next = book?.chapters[(chapter.index ?? book.chapter) + 1]?.url || null;
      const value = await vm.call('getContent', [entry, entity, next]);
      const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
      if (!text.trim()) throw new Error('JS源正文为空');
      return /<[a-z][\s\S]*>/i.test(text) ? htmlText(text) : text;
    });
  }
  if (chapter.content !== undefined) return chapter.content;
  if (!chapter.url || !source.ruleContent?.content) throw new Error('缺少正文地址或规则');
  return withRuntime(source, { chapter, book, baseUrl: chapter.url, trace: execution && { ...execution, phase: 'content' } }, async vm => {
    let current = await vm.fetch(chapter.url!);
    const chunks: string[] = []; const visited = new Set<string>(); const pending: string[] = [];
    for (let page = 0; page < 30; page++) {
      if (visited.has(current.url)) break; visited.add(current.url); await vm.setPage(current.url, current.body);
      let content = await vm.rule(current.body, source.ruleContent!.content);
      if (source.ruleContent!.replaceRegex) {
        const replace = source.ruleContent!.replaceRegex;
        if (/@js:|<js>/.test(replace)) content = await vm.rule(content, replace);
        else { const [pattern, replacement = ''] = replace.split('##'); content = content.replace(new RegExp(pattern, 'g'), replacement); }
      }
      chunks.push(/<[a-z][\s\S]*>/i.test(content) ? htmlText(content) : content);
      pending.push(...(await nextPages(vm, current.body, source.ruleContent!.nextContentUrl)).map(url => absolute(url, current.url)));
      while (pending.length && visited.has(pending[0])) pending.shift();
      if (!pending.length) break;
      current = await vm.fetch(pending.shift()!, current.url);
    }
    const text = chunks.join('\n\n').trim(); if (!text) throw new Error('正文为空，请检查正文规则'); return text;
  });
}
