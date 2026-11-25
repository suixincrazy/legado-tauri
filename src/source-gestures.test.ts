import { expect, it } from 'vitest';
import type { Source } from './model';
import { moveSourceRelative, selectSourceInterval, selectSourceRange } from './source-gestures';

const sources: Source[] = ['A', 'hidden-1', 'B', 'hidden-2', 'C'].map((key, customOrder) => ({ bookSourceName: key, bookSourceUrl: key, customOrder, extra: { retained: key } }));

it('moves a filtered source relative to its target without discarding hidden sources or their fields', () => {
  const result = moveSourceRelative(sources, 'A', 'C', true);
  expect(result.map(source => source.bookSourceUrl)).toEqual(['hidden-1', 'B', 'hidden-2', 'C', 'A']);
  expect(result.map(source => source.customOrder)).toEqual([0, 1, 2, 3, 4]);
  expect(result.find(source => source.bookSourceUrl === 'A')?.extra).toEqual({ retained: 'A' });
  expect(sources[0].customOrder).toBe(0);
  expect(moveSourceRelative(sources, 'C', 'A', false).map(source => source.bookSourceUrl)).toEqual(['C', 'A', 'hidden-1', 'B', 'hidden-2']);
});

it('converts visual before/after to stored order when descending and ignores removed targets', () => {
  const result = moveSourceRelative(sources, 'C', 'A', true, true);
  expect(result.map(source => source.bookSourceUrl).reverse()).toEqual(['hidden-2', 'B', 'hidden-1', 'A', 'C']);
  expect(moveSourceRelative(sources, 'A', 'missing', true)).toBe(sources);
  expect(moveSourceRelative(sources, 'A', 'A', true)).toBe(sources);
});

it('matches ToggleAndReverse selection while reversing or crossing the start and preserves hidden selections', () => {
  let gesture = selectSourceRange({ order: ['A', 'B', 'C', 'D', 'E'], start: 2, end: -1, firstSelected: true, selected: new Set(['hidden', 'C', 'D']) }, 2);
  gesture = selectSourceRange(gesture, 4);
  expect([...gesture.selected]).toEqual(['hidden']);
  gesture = selectSourceRange(gesture, 3);
  expect([...gesture.selected]).toEqual(['hidden', 'E']);
  gesture = selectSourceRange(gesture, 0);
  expect([...gesture.selected].sort()).toEqual(['D', 'E', 'hidden']);
  expect(selectSourceRange(gesture, -1)).toBe(gesture);
  expect(selectSourceRange(gesture, 0)).toBe(gesture);
});

it('fills only between visible selected endpoints without dropping hidden selections', () => {
  const original = new Set(['hidden', 'B', 'D']);
  expect([...selectSourceInterval(['A', 'B', 'C', 'D', 'E'], original)].sort()).toEqual(['B', 'C', 'D', 'hidden']);
  expect([...original]).toEqual(['hidden', 'B', 'D']);
  expect([...selectSourceInterval(['A', 'C', 'E'], original)]).toEqual([...original]);
  expect([...selectSourceInterval(['B'], original)]).toEqual([...original]);
});
