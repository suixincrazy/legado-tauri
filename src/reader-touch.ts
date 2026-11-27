type TouchOptions={
  paged:boolean; distance:number; slop:()=>number; canPull:()=>boolean;
  selected:()=>boolean; turn:(direction:number)=>void; toggle:()=>void;
  suppressClick:(suppress:boolean)=>void;
};

// Touch coordinates are CSS pixels; the saved Android threshold is in physical pixels.
export function bindReaderTouch(node:HTMLElement,options:TouchOptions) {
  let touch:{id:number;x:number;y:number;candidate:boolean;claimed:boolean;slop:number;trigger:number}|null=null;
  const surface=node.closest<HTMLElement>('.reader');
  function reset() {
    if(surface?.dataset.bookmarkPull){delete surface.dataset.bookmarkPull;surface.style.removeProperty('--bookmark-pull-offset');}
    touch=null;
  }
  function start(e:TouchEvent) {
    if(e.touches.length!==1){if(touch)options.suppressClick(true);reset();return;}
    reset();options.suppressClick(false);
    const p=e.touches[0],ratio=window.devicePixelRatio||1,slop=options.slop()/ratio;
    touch={id:p.identifier,x:p.clientX,y:p.clientY,slop,trigger:options.distance>0?options.distance/ratio:slop*6,
      candidate:options.canPull()&&!options.selected()&&(options.paged||node.scrollTop<=1),claimed:false};
  }
  function move(e:TouchEvent) {
    if(!touch||!touch.candidate)return;
    const p=e.touches[0];
    if(e.touches.length!==1||p.identifier!==touch.id||options.selected()||!options.canPull()){reset();return;}
    const dx=Math.abs(p.clientX-touch.x),dy=p.clientY-touch.y;
    if(!touch.claimed){
      if(dy>touch.slop&&dy>dx)touch.claimed=true;
      else {if(dx>touch.slop||Math.abs(dy)>touch.slop)touch.candidate=false;return;}
    }
    if(!e.cancelable){options.suppressClick(true);reset();return;}
    e.preventDefault();options.suppressClick(true);
    if(surface){
      surface.dataset.bookmarkPull=dy>touch.slop&&dy>dx&&dy>=touch.trigger?'ready':'pulling';
      surface.style.setProperty('--bookmark-pull-offset',Math.max(0,Math.min(dy*.5,node.clientHeight*.35))+'px');
    }
  }
  function end(e:TouchEvent) {
    const t=touch,p=Array.from(e.changedTouches).find(item=>item.identifier===t?.id);
    if(!t||!p){reset();return;}
    const dx=p.clientX-t.x,dy=p.clientY-t.y;
    const toggle=t.claimed&&dy>t.slop&&dy>Math.abs(dx)&&dy>=t.trigger&&!options.selected()&&options.canPull();
    reset();
    if(t.claimed){if(e.cancelable)e.preventDefault();options.suppressClick(true);if(toggle)options.toggle();}
    else if(options.paged&&!options.selected()&&Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.3){options.suppressClick(true);options.turn(dx<0?1:-1);}
  }
  function cancel(){if(touch?.claimed)options.suppressClick(true);reset();}
  function selectionChanged(){if(touch&&options.selected())cancel();}
  node.addEventListener('touchstart',start,{passive:true});node.addEventListener('touchmove',move,{passive:false});
  node.addEventListener('touchend',end,{passive:false});node.addEventListener('touchcancel',cancel);
  document.addEventListener('selectionchange',selectionChanged);node.addEventListener('contextmenu',cancel);
  return ()=>{reset();node.removeEventListener('touchstart',start);node.removeEventListener('touchmove',move);node.removeEventListener('touchend',end);node.removeEventListener('touchcancel',cancel);document.removeEventListener('selectionchange',selectionChanged);node.removeEventListener('contextmenu',cancel);};
}
