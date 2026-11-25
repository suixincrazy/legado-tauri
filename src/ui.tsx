import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { Book,CoverConfig } from './model';
import { defaultCover } from './theme-model';
export const CoverSettingsContext=createContext<CoverConfig&{night:boolean}>({...defaultCover,night:false});
export function IconButton({ label, onClick, children, active = false, disabled = false, hidden = false }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean; hidden?:boolean }) {
  return <button hidden={hidden} style={hidden?{display:'none'}:undefined} className={`icon-button ${active ? 'active' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function Modal({ title, close, children, wide = false, page = true, centered = false, toolbarId, actions, showClose = true }: { title: string; close: () => void; children: ReactNode; wide?: boolean; page?: boolean; centered?: boolean; toolbarId?: string; actions?:ReactNode; showClose?:boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef=useRef(close);closeRef.current=close;
  const requestClose = () => { if (ref.current?.dispatchEvent(new CustomEvent('legado-page-back', { cancelable: true }))) close(); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href]') || []).filter(node=>!node.hidden);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (!ref.current || dialogs[dialogs.length - 1]?.closest('.modal') !== ref.current) return;
      if (event.key === 'Escape') { event.preventDefault(); if (ref.current.dispatchEvent(new CustomEvent('legado-page-back', { cancelable: true }))) closeRef.current(); }
      if (event.key === 'Tab') {
        const nodes = focusable(); const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className={`scrim ${page ? 'page-scrim' : centered ? 'center-scrim' : 'sheet-scrim'}`} onClick={event => { if (event.target === event.currentTarget) requestClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'wide' : ''} ${page ? 'activity-page' : centered ? 'center-dialog' : 'bottom-sheet'}`}><header><IconButton hidden={!showClose} label="关闭" onClick={requestClose}>{page ? <ArrowLeft /> : <X />}</IconButton><h2 className={toolbarId ? 'custom-toolbar-title' : undefined}>{title}</h2>{toolbarId && <div className="page-toolbar-content" id={toolbarId} />}{actions&&<div className="dialog-actions">{actions}</div>}</header><div className="modal-body">{children}</div></div></div>;
}
export function Cover({ book }: { book: Pick<Book, 'name' | 'author' | 'cover'> }) {
  const [failed,setFailed]=useState('');
  const config=useContext(CoverSettingsContext),showName=config.night?config.showNameDark:config.showName,showAuthor=config.night?config.showAuthorDark:config.showAuthor;
  const image=!config.useDefault&&book.cover&&/^(https?:|data:image\/)/.test(book.cover)&&failed!==book.cover;
  const normalize=(text:string)=>config.keepPunctuation?text.trim():text.replace(/[\p{P}\p{S}]/gu,'').trim();
  const name=Array.from(normalize(book.name)),author=Array.from(normalize(book.author));
  const large=100/7*(config.customSize?config.titleLarge/100:1),small=config.customSize?100/7*config.titleSmall/100:100/9;
  const size=config.adaptive&&name.length*large*1.16>133.333*.6?small:large,height=size*1.16;
  let x=20,y=133.333*.2,line=0;
  const title=name.map((char,index)=>{const point={char,x,y};y+=height;if(y>133.333*.9){if(name.length-index-1===1)y-=height/5;else{x+=size;line++;y=133.333*.2+height*line;}}else if(y>133.333*.8&&name.length-index-1>2){x+=size;line++;y=133.333*.2+height*line;}return point;});
  let authorSize=10*(config.customSize?config.authorLarge/100:1);
  if(config.customSize&&author.length*authorSize*1.16>133.333*.65)authorSize=10*config.authorSmall/100;
  const authorHeight=authorSize*1.16,authorStart=Math.max(133.333*.95-author.length*authorHeight,133.333*.3),background=config.night?config.imageDark:config.image;
  return <div className="cover" style={{backgroundImage:background&&/^(data:image\/|https?:)/.test(background)?`url(${JSON.stringify(background)})`:undefined}}>{image?<img src={book.cover} alt="" onError={()=>setFailed(book.cover||'')}/>:config.horizontal?<div className="cover-horizontal" style={{fontFamily:config.fontData?'LegadoCover':undefined}}>{showName&&<strong style={{fontSize:`${config.customSize?config.titleLarge:100}%`}}>{normalize(book.name)}</strong>}{showAuthor&&<small>{normalize(book.author)}</small>}</div>:<svg className="cover-lettering" viewBox="0 0 100 133.333" aria-hidden="true"><g fontFamily={config.fontData?'LegadoCover':'sans-serif'} fontWeight="700" fontSize={size} textAnchor="middle" strokeWidth={size/6}>{showName&&title.map((point,index)=><text key={index} x={point.x} y={point.y}>{point.char}</text>)}</g><g fontFamily={config.fontData?'LegadoCover':'sans-serif'} fontSize={authorSize} textAnchor="middle" strokeWidth={authorSize/5}>{showAuthor&&author.map((char,index)=>authorStart+index*authorHeight<=133.333*.95?<text key={index} x="80" y={authorStart+index*authorHeight}>{char}</text>:null)}</g></svg>}</div>;
}
