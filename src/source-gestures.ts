import type { Source } from './model';

export function moveSourceRelative(sources: Source[], key: string, target: string, after: boolean, descending = false): Source[] {
  if (key === target || !sources.some(source => source.bookSourceUrl === key) || !sources.some(source => source.bookSourceUrl === target)) return sources;
  const ordered = [...sources].sort((a, b) => Number(a.customOrder || 0) - Number(b.customOrder || 0) || a.bookSourceUrl.localeCompare(b.bookSourceUrl));
  const [moved] = ordered.splice(ordered.findIndex(source => source.bookSourceUrl === key), 1);
  const index = ordered.findIndex(source => source.bookSourceUrl === target);
  ordered.splice(index + (after !== descending ? 1 : 0), 0, moved);
  return ordered.map((source, customOrder) => ({ ...source, customOrder }));
}

export type SourceRangeSelection = { order: string[]; start: number; end: number; firstSelected: boolean; selected: Set<string> };
export function selectSourceRange(selection: SourceRangeSelection, end: number): SourceRangeSelection {
  if (end < 0 || end >= selection.order.length || end === selection.end) return selection;
  const selected = new Set(selection.selected), from = Math.min(selection.start, end), to = Math.max(selection.start, end);
  const previousFrom = Math.min(selection.start, selection.end), previousTo = Math.max(selection.start, selection.end);
  // Legado DragSelectTouchHelper.Mode.ToggleAndReverse restores the starting state outside the range.
  selection.order.forEach((key, index) => {
    const inside = index >= from && index <= to, previous = selection.end >= 0 && index >= previousFrom && index <= previousTo;
    if (!inside && !previous) return;
    if (inside !== selection.firstSelected) selected.add(key); else selected.delete(key);
  });
  return { ...selection, end, selected };
}
