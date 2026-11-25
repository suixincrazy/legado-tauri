import type { SearchResult, Source } from './model';
import { sourceGroups } from './source-management';

export type SearchOptions = { precise: boolean; markRead: boolean; exclusions: string; scope: 'all' | 'groups' | 'sources'; selected: string[] };
export const defaultSearchOptions: SearchOptions = { precise: false, markRead: true, exclusions: '', scope: 'all', selected: [] };
export function searchSources(sources: Source[], options: SearchOptions, target?: Source | null) {
  if (target) return [target];
  return sources.filter(source => source.enabled !== false && (options.scope === 'all' || (options.scope === 'sources' ? options.selected.includes(source.bookSourceUrl) : sourceGroups(source).some(group => options.selected.includes(group)))));
}
export function mergeSearchResults(current: SearchResult[], incoming: SearchResult[]) {
  const map = new Map(current.map(item => [JSON.stringify([item.sourceUrl, item.url]), item]));
  for (const item of incoming) map.set(JSON.stringify([item.sourceUrl, item.url]), item);
  return [...map.values()];
}
export function groupSearchResults(results: SearchResult[], query: string, options: SearchOptions) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  const filters = options.exclusions.split('\n').map(normalize).filter(Boolean);
  const groups = new Map<string, SearchResult[]>();
  for (const item of results) {
    if (options.precise && ![normalize(item.name), normalize(item.author)].includes(normalize(query))) continue;
    if (filters.some(word => normalize(`${item.name}\n${item.author}\n${item.category || ''}`).includes(word))) continue;
    const key = JSON.stringify([normalize(item.name), normalize(item.author)]);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.values()];
}
