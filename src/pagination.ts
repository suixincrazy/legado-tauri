export function pagination(viewport: HTMLElement, article: HTMLElement) {
  const gap = parseFloat(getComputedStyle(article).columnGap) || 0;
  const stride = viewport.clientWidth + gap;
  const total = Math.max(1, Math.ceil((viewport.scrollWidth + gap - 1) / stride));
  return { stride, total, current: Math.min(total, Math.round(viewport.scrollLeft / stride) + 1) };
}
