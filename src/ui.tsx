import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  const [failed,setFailed]=useState('');
  const image=book.cover&&/^(https?:|data:image\/)/.test(book.cover)&&failed!==book.cover;
  const name=Array.from(book.name.replace(/[\p{P}\p{S}]/gu,'').trim()),author=Array.from(book.author.replace(/[\p{P}\p{S}]/gu,'').trim());
  const size=name.length*(100/7)*1.16>133.333*.6?100/9:100/7,height=size*1.16;
  let x=20,y=133.333*.2,line=0;
  const title=name.map((char,index)=>{const point={char,x,y};y+=height;if(y>133.333*.9){if(name.length-index-1===1)y-=height/5;else{x+=size;line++;y=133.333*.2+height*line;}}else if(y>133.333*.8&&name.length-index-1>2){x+=size;line++;y=133.333*.2+height*line;}return point;});
  const authorStart=Math.max(133.333*.95-author.length*11.6,133.333*.3);
  return <div className="cover">{image?<img src={book.cover} alt="" onError={()=>setFailed(book.cover||'')}/>:<svg className="cover-lettering" viewBox="0 0 100 133.333" aria-hidden="true"><g fontFamily="sans-serif" fontWeight="700" fontSize={size} textAnchor="middle" strokeWidth={size/6}>{title.map((point,index)=><text key={index} x={point.x} y={point.y}>{point.char}</text>)}</g><g fontFamily="sans-serif" fontSize="10" textAnchor="middle" strokeWidth="2">{author.map((char,index)=>authorStart+index*11.6<=133.333*.95?<text key={index} x="80" y={authorStart+index*11.6}>{char}</text>:null)}</g></svg>}</div>;
}
