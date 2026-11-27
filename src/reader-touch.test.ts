import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {bindReaderTouch} from './reader-touch';

let surface:HTMLElement,node:HTMLElement,cleanup:()=>void,selected:boolean,allowed:boolean;
const toggle=vi.fn(),turn=vi.fn(),suppress=vi.fn();
function bind(paged=true,distance=0) {
  cleanup=bindReaderTouch(node,{paged,distance,slop:()=>16,canPull:()=>allowed,selected:()=>selected,turn,toggle,suppressClick:suppress});
}
function event(type:string,x:number,y:number,count=1,cancelable=true) {
  const e=new Event(type,{bubbles:true,cancelable}),point={identifier:1,clientX:x,clientY:y};
  Object.defineProperties(e,{touches:{value:type==='touchend'?[]:Array.from({length:count},(_,i)=>({...point,identifier:i+1}))},changedTouches:{value:[point]}});
  node.dispatchEvent(e);return e;
}
beforeEach(()=>{
  vi.clearAllMocks();selected=false;allowed=true;vi.stubGlobal('devicePixelRatio',2);
  surface=document.createElement('section');surface.className='reader';node=document.createElement('div');surface.append(node);document.body.append(surface);
  Object.defineProperty(node,'clientHeight',{value:600});bind();
});
afterEach(()=>{cleanup();surface.remove();vi.unstubAllGlobals();});
it('uses physical-pixel threshold and only toggles on a claimed release',()=>{
  event('touchstart',10,10);event('touchend',10,90);expect(toggle).not.toHaveBeenCalled();
  event('touchstart',10,10);expect(event('touchmove',11,40).defaultPrevented).toBe(true);expect(surface.dataset.bookmarkPull).toBe('pulling');
  event('touchmove',11,58);expect(surface.dataset.bookmarkPull).toBe('ready');expect(toggle).not.toHaveBeenCalled();
  event('touchend',11,58);expect(toggle).toHaveBeenCalledOnce();expect(surface.dataset.bookmarkPull).toBeUndefined();expect(suppress).toHaveBeenLastCalledWith(true);
});
it('rechecks final distance and direction when a ready drag retreats',()=>{
  for(const end of [[10,40],[110,110]]){
    event('touchstart',10,10);event('touchmove',10,100);event('touchend',end[0],end[1]);
  }
  expect(toggle).not.toHaveBeenCalled();expect(turn).not.toHaveBeenCalled();
  event('touchstart',10,10);event('touchmove',10,30);event('touchend',10,60);expect(toggle).toHaveBeenCalledOnce();
});
it('releases ownership after horizontal motion and preserves ordinary page turns',()=>{
  event('touchstart',150,10);event('touchmove',50,30);event('touchmove',150,150);event('touchend',150,150);expect(toggle).not.toHaveBeenCalled();
  event('touchstart',150,10);event('touchmove',50,11);event('touchend',50,11);expect(turn).toHaveBeenCalledWith(1);
});
it('allows scrolling only from chapter top and rejects disabled, selection and multitouch starts',()=>{
  cleanup();bind(false);
  node.scrollTop=70;event('touchstart',10,10);event('touchmove',10,100);event('touchend',10,100);expect(toggle).not.toHaveBeenCalled();
  node.scrollTop=0;
  allowed=false;event('touchstart',10,10);event('touchmove',10,100);event('touchend',10,100);
  allowed=true;selected=true;event('touchstart',10,10);event('touchmove',10,100);event('touchend',10,100);
  selected=false;event('touchstart',10,10,2);event('touchend',10,100);expect(toggle).not.toHaveBeenCalled();
  event('touchstart',10,10);event('touchmove',10,100);event('touchend',10,100);expect(toggle).toHaveBeenCalledOnce();
});
it('cancels on browser takeover, touchcancel, added finger, selection or disabled state',()=>{
  for(const reason of ['browser','cancel','finger','selection','disabled']){
    selected=false;allowed=true;event('touchstart',10,10);event('touchmove',10,100);
    if(reason==='cancel')event('touchcancel',10,100);
    if(reason==='browser')event('touchmove',10,110,1,false);
    if(reason==='finger')event('touchmove',10,110,2);
    if(reason==='selection')selected=true;
    if(reason==='disabled')allowed=false;
    event('touchend',10,110);
  }
  expect(toggle).not.toHaveBeenCalled();expect(surface.style.getPropertyValue('--bookmark-pull-offset')).toBe('');
});
it('caps page displacement and honors a custom threshold without leaving handlers behind',()=>{
  cleanup();bind(true,800);event('touchstart',10,10);event('touchmove',10,410);
  expect(surface.dataset.bookmarkPull).toBe('ready');expect(surface.style.getPropertyValue('--bookmark-pull-offset')).toBe('200px');
  event('touchmove',10,2010);expect(surface.style.getPropertyValue('--bookmark-pull-offset')).toBe('210px');
  cleanup();event('touchend',10,2010);expect(toggle).not.toHaveBeenCalled();expect(surface.dataset.bookmarkPull).toBeUndefined();
});
it('does not reclaim an active long-press selection after its handles collapse',()=>{
  event('touchstart',10,10);selected=true;document.dispatchEvent(new Event('selectionchange'));selected=false;
  event('touchmove',10,100);event('touchend',10,100);expect(toggle).not.toHaveBeenCalled();
  event('touchstart',10,10);node.dispatchEvent(new Event('contextmenu'));event('touchmove',10,100);event('touchend',10,100);
  expect(toggle).not.toHaveBeenCalled();expect(turn).not.toHaveBeenCalled();
});
