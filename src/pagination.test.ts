import { it, expect, vi } from 'vitest';
import { pagination } from './pagination';
it('counts spreads using column gutters and keeps resumed pages aligned', () => {
  const viewport = document.createElement('div'); const article = document.createElement('article');
  Object.defineProperties(viewport, { clientWidth: { value: 1110 }, scrollWidth: { value: 6980 }, scrollLeft: { value: 1174 } });
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ columnGap: '64px' } as CSSStyleDeclaration);
  expect(pagination(viewport, article)).toEqual({ stride: 1174, total: 6, current: 2 });
  vi.restoreAllMocks();
});
