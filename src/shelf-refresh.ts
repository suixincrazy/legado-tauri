export function bindShelfRefresh(main:HTMLElement,refresh:()=>void) {
  let origin:{id:number;x:number;y:number}|undefined;
  const cancel=()=>{origin=undefined;};
  const start=(event:TouchEvent)=>{
    cancel();
    if(event.touches.length!==1||main.scrollTop>0||(event.target as Element)?.closest?.('.shelf-reorder,input,select,textarea'))return;
    const touch=event.touches[0];origin={id:touch.identifier,x:touch.clientX,y:touch.clientY};
  };
  const move=(event:TouchEvent)=>{
    if(!origin)return;
    const touch=event.touches[0];
    if(event.touches.length!==1||touch.identifier!==origin.id||main.scrollTop>0){cancel();return;}
    const x=Math.abs(touch.clientX-origin.x),y=touch.clientY-origin.y;
    if(Math.max(x,Math.abs(y))<8)return;
    if(y<=x){cancel();return;}
    if(event.cancelable)event.preventDefault();
  };
  const end=(event:TouchEvent)=>{
    const saved=origin;cancel();
    const touch=event.changedTouches[0];
    if(!saved||event.touches.length||!touch||touch.identifier!==saved.id||main.scrollTop>0)return;
    const dy=touch.clientY-saved.y;
    if(dy>=128&&dy>Math.abs(touch.clientX-saved.x))refresh();
  };
  main.addEventListener('touchstart',start,{passive:true});main.addEventListener('touchmove',move,{passive:false});
  main.addEventListener('touchend',end);main.addEventListener('touchcancel',cancel);
  return ()=>{main.removeEventListener('touchstart',start);main.removeEventListener('touchmove',move);main.removeEventListener('touchend',end);main.removeEventListener('touchcancel',cancel);};
}
