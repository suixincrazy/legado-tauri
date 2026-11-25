import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { Book } from './model';
export function IconButton({ label, onClick, children, active = false, disabled = false }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean }) {
  return <button className={`icon-button ${active ? 'active' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function Modal({ title, close, children, wide = false, page = true, toolbarId }: { title: string; close: () => void; children: ReactNode; wide?: boolean; page?: boolean; toolbarId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const requestClose = () => { if (ref.current?.dispatchEvent(new CustomEvent('legado-page-back', { cancelable: true }))) close(); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href]') || []);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (!ref.current || dialogs[dialogs.length - 1]?.closest('.modal') !== ref.current) return;
      if (event.key === 'Escape') { event.preventDefault(); if (ref.current.dispatchEvent(new CustomEvent('legado-page-back', { cancelable: true }))) close(); }
      if (event.key === 'Tab') {
        const nodes = focusable(); const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [close]);
  return <div className={`scrim ${page ? 'page-scrim' : 'sheet-scrim'}`} onClick={event => { if (event.target === event.currentTarget) requestClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'wide' : ''} ${page ? 'activity-page' : 'bottom-sheet'}`}><header><IconButton label="关闭" onClick={requestClose}>{page ? <ArrowLeft /> : <X />}</IconButton><h2 className={toolbarId ? 'custom-toolbar-title' : undefined}>{title}</h2>{toolbarId && <div className="page-toolbar-content" id={toolbarId} />}</header><div className="modal-body">{children}</div></div></div>;
}
export function Cover({ book }: { book: Pick<Book, 'name' | 'author' | 'cover'> }) {
  return <div className="cover">{book.cover && /^(https?:|data:image\/)/.test(book.cover) ? <img src={book.cover} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}<div className="cover-type"><span>{book.name}</span><small>{book.author}</small></div></div>;
}
