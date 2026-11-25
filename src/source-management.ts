import type { Source } from './model';
import { loadChapter, loadOnlineBook, searchSource, sourceSupport } from './sources';

export type SourceFilter = { query: string; group: string; status: string; sort: string; descending: boolean };
export const defaultSourceFilter: SourceFilter = { query: '', group: '', status: '', sort: 'customOrder', descending: false };
export function sourceGroups(source: Source): string[] { return [...new Set((source.bookSourceGroup || '').split(/[,，;；\n]/).map(s => s.trim()).filter(Boolean))]; }
export function changeGroups(source: Source, names: string[], remove = false): Source {
  const groups = sourceGroups(source);
  return { ...source, bookSourceGroup: (remove ? groups.filter(g => !names.includes(g)) : [...new Set([...groups, ...names])]).join(',') };
}
export function filterSources(sources: Source[], filter: SourceFilter): Source[] {
  const query = filter.query.trim().toLowerCase();
  return sources.filter(source => {
    if (query && !`${source.bookSourceName} ${source.bookSourceUrl} ${source.bookSourceGroup || ''} ${source.bookSourceComment || ''}`.toLowerCase().includes(query)) return false;
    if (filter.group === '$none' ? sourceGroups(source).length : filter.group && !sourceGroups(source).includes(filter.group)) return false;
    switch (filter.status) {
      case 'enabled': return source.enabled !== false;
      case 'disabled': return source.enabled === false;
      case 'login': return !!(source.loginUi || source.loginUrl);
      case 'explore': return source.enabledExplore !== false && !!source.exploreUrl;
      case 'noExplore': return source.enabledExplore === false || !source.exploreUrl;
      case 'failed': return source.checkResult?.status === 'error';
      case 'ok': return source.checkResult?.status === 'ok';
      default: return true;
    }
  }).sort((a, b) => {
    let order = 0;
    if (filter.sort === 'bookSourceName' || filter.sort === 'bookSourceUrl') order = String(a[filter.sort]).localeCompare(String(b[filter.sort]), 'zh-CN', { numeric: true });
    else if (filter.sort === 'enabled') order = Number(b.enabled !== false) - Number(a.enabled !== false);
    else order = Number(a[filter.sort] || 0) - Number(b[filter.sort] || 0);
    return (filter.descending ? -order : order) || a.bookSourceUrl.localeCompare(b.bookSourceUrl);
  });
}
export function mergeSourceImport(existing: Source[], incoming: Source[], overwrite: boolean, preserveState = true): Source[] {
  const current = new Map(existing.map(s => [s.bookSourceUrl, s]));
  const changes = new Map<string, Source>();
  for (const source of incoming) {
    const old = current.get(source.bookSourceUrl);
    if (old && !overwrite) continue;
    changes.set(source.bookSourceUrl, old && preserveState ? { ...source, enabled: old.enabled, enabledExplore: old.enabledExplore, customOrder: old.customOrder, bookSourceGroup: old.bookSourceGroup } : source);
  }
  return [...changes.values()];
}
export function moveSources(sources: Source[], keys: Set<string>, end: boolean): Source[] {
  const sorted = filterSources(sources, defaultSourceFilter);
  const selected = sorted.filter(s => keys.has(s.bookSourceUrl)), others = sorted.filter(s => !keys.has(s.bookSourceUrl));
  return (end ? [...others, ...selected] : [...selected, ...others]).map((s, customOrder) => ({ ...s, customOrder }));
}
export function safeSourceError(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(/https?:\/\/[^\s"'<>]+/g, '[网址已隐藏]').replace(/(cookie|authorization|token|password|sessionid)\s*[:=]\s*[^\s,;]+/gi, '$1=[已隐藏]').slice(0, 1200);
}
export async function checkSource(source: Source, keyword: string, full: boolean, stopped: () => boolean, stage: (text: string) => void): Promise<Source> {
  const start = Date.now(), stages: string[] = [];
  const step = (text: string) => { if (stopped()) throw new Error('已取消校验'); stages.push(text); stage(text); };
  try {
    const warning = sourceSupport(source); if (warning) throw new Error(warning);
    step('搜索'); const books = await searchSource(source, keyword);
    if (!books.length) throw new Error('没有搜索结果，请更换校验关键词');
    if (full) {
      step('详情与目录'); const book = await loadOnlineBook(books[0], source);
      step('正文'); const content = await loadChapter(book.chapters[0], source, book);
      if (!content.trim()) throw new Error('正文为空');
    }
    step('完成');
    return { ...source, respondTime: Date.now() - start, checkResult: { status: 'ok', time: Date.now(), message: `通过 · ${books.length} 个搜索结果`, stages } };
  } catch (error) {
    return { ...source, respondTime: Date.now() - start, checkResult: { status: 'error', time: Date.now(), message: safeSourceError(error), stages } };
  }
}
