import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { selectSourceRange, type SourceRangeSelection } from './source-gestures';

type Gesture = { mode: 'pending' | 'drag' | 'select'; key: string; pointer: number; x: number; y: number; startX: number; startY: number; start: number; order: string[]; timer: ReturnType<typeof setTimeout> | null; frame: number; selection?: SourceRangeSelection };
type Options = { order: string[]; selected: Set<string>; canDrag: boolean; disabled: boolean; select: (value: Set<string>) => void; move: (key: string, target: string, after: boolean) => void };

export function useSourceGestures(options: Options) {
  const list = useRef<HTMLDivElement>(null), latest = useRef(options), gesture = useRef<Gesture | null>(null), suppressClick = useRef(false);
  const [preview, setPreview] = useState<string[] | null>(null), [dragging, setDragging] = useState<string | null>(null);
  latest.current = options;
  const finish = (cancelled = false) => {
    const current = gesture.current;
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    cancelAnimationFrame(current.frame);
    gesture.current = null;
    if (list.current?.hasPointerCapture(current.pointer)) list.current.releasePointerCapture(current.pointer);
    setPreview(null); setDragging(null);
    if (current.mode !== 'drag' || cancelled) return;
    const end = current.order.indexOf(current.key);
    if (end === current.start) return;
    const after = end > current.start, target = current.order[end + (after ? -1 : 1)];
    if (target) latest.current.move(current.key, target, after);
  };
  const update = () => {
    const current = gesture.current, root = list.current;
    if (!current || !root || current.mode === 'pending') return;
    const rect = root.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, Math.max(rect.top + 1, Math.min(rect.bottom - 1, current.y)))?.closest<HTMLElement>('[data-source-key]');
    if (!target || !root.contains(target)) return;
    const key = target.dataset.sourceKey!, to = current.order.indexOf(key);
    if (to < 0) return;
    if (current.selection) {
      const next = selectSourceRange(current.selection, to);
      if (next !== current.selection) { current.selection = next; latest.current.select(next.selected); }
    } else {
      const from = current.order.indexOf(current.key);
      if (from === to) return;
      const next = [...current.order]; next.splice(from, 1); next.splice(to, 0, current.key);
      current.order = next; setPreview(next);
    }
  };
  const scroll = () => {
    const current = gesture.current, root = list.current;
    if (!current || !root || current.mode === 'pending') return;
    const rect = root.getBoundingClientRect(), before = root.scrollTop;
    if (current.y < rect.top + 40) root.scrollTop -= 8;
    else if (current.y > rect.bottom - 40) root.scrollTop += 8;
    if (root.scrollTop !== before) update();
    current.frame = requestAnimationFrame(scroll);
  };
  const activate = (current: Gesture, select: boolean) => {
    if (gesture.current !== current || latest.current.disabled) return;
    current.mode = select ? 'select' : 'drag'; suppressClick.current = true;
    list.current?.setPointerCapture(current.pointer);
    if (select) {
      current.selection = selectSourceRange({ order: current.order, start: current.start, end: -1, firstSelected: latest.current.selected.has(current.key), selected: new Set(latest.current.selected) }, current.start);
      latest.current.select(current.selection.selected);
    } else { setDragging(current.key); setPreview(current.order); }
    scroll();
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false || gesture.current || latest.current.disabled) return;
    suppressClick.current = false;
    const target = event.target as HTMLElement, row = target.closest<HTMLElement>('[data-source-key]'), key = row?.dataset.sourceKey;
    const select = !!target.closest('.source-slide-zone'), title = !!target.closest('.source-title');
    if (!key || (!select && (!title || !latest.current.canDrag))) return;
    const order = [...latest.current.order], current: Gesture = { mode: 'pending', key, pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, start: order.indexOf(key), order, timer: null, frame: 0 };
    gesture.current = current;
    if (select) { event.preventDefault(); activate(current, true); }
    else current.timer = setTimeout(() => activate(current, false), 500);
  };
  const signature = options.order.join('\0');
  useEffect(() => { finish(true); }, [options.disabled, options.canDrag, signature]);
  useEffect(() => {
    const root = list.current;
    const touch = (event: TouchEvent) => { if (gesture.current && gesture.current.mode !== 'pending') event.preventDefault(); };
    root?.addEventListener('touchmove', touch, { passive: false });
    return () => {
      root?.removeEventListener('touchmove', touch);
      const current = gesture.current;
      if (current?.timer) clearTimeout(current.timer);
      if (current) cancelAnimationFrame(current.frame);
      gesture.current = null;
    };
  }, [options.disabled]);
  return { list, preview, dragging, handlers: {
    onPointerDown: start,
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      if (current.mode === 'pending') { if (Math.hypot(current.x - current.startX, current.y - current.startY) > 10) finish(true); }
      else { event.preventDefault(); update(); }
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => { if (gesture.current?.pointer === event.pointerId) finish(); },
    onPointerCancel: () => finish(true),
    onLostPointerCapture: () => finish(true),
    onPointerLeave: () => { if (gesture.current?.mode === 'pending') finish(true); },
    onContextMenu: (event: React.MouseEvent) => { if (latest.current.canDrag || gesture.current) event.preventDefault(); },
    onClickCapture: (event: React.MouseEvent) => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); finish(true); return; }
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || !latest.current.canDrag || latest.current.disabled) return;
      const key = (event.target as HTMLElement).closest<HTMLElement>('[data-source-key]')?.dataset.sourceKey;
      if (!key) return;
      event.preventDefault();
      const after = event.key === 'ArrowDown', target = latest.current.order[latest.current.order.indexOf(key) + (after ? 1 : -1)];
      if (target) latest.current.move(key, target, after);
    },
  } };
}
