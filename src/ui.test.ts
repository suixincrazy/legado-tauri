import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { Modal } from './ui';

it('keeps input focus across dialog updates and invokes the current close callback',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let closed='';
  const render=(version:string)=>act(async()=>root.render(createElement(Modal,{title:'编辑',close:()=>{closed=version;},children:createElement('input',{'aria-label':'编辑内容'})})));
  try{await render('first');const input=host.querySelector('input')!;input.focus();await render('second');expect(document.activeElement).toBe(input);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(closed).toBe('second');}
  finally{await act(async()=>root.unmount());host.remove();delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
});
