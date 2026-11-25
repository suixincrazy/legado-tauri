import { pagination } from './pagination';

export function visibleTextPosition(viewport:HTMLElement):number {
  const bounds=viewport.getBoundingClientRect();
  for(const block of viewport.querySelectorAll<HTMLElement>('[data-text-start]')){
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let node:Node|null,total=0;
    while((node=walker.nextNode())){
      const range=document.createRange();range.selectNodeContents(node);
      if([...range.getClientRects()].some(rect=>rect.right>bounds.left&&rect.left<bounds.right&&rect.bottom>bounds.top&&rect.top<bounds.bottom)){
        for(let index=0;index<(node.textContent?.length||0);index++){
          range.setStart(node,index);range.setEnd(node,index+1);const rect=range.getBoundingClientRect();
          if(rect.right>bounds.left&&rect.left<bounds.right&&rect.bottom>bounds.top&&rect.top<bounds.bottom)return Number(block.dataset.textStart)+total+index;
        }
      }
      total+=node.textContent?.length||0;
    }
  }
  return 0;
}

export function revealTextPosition(viewport:HTMLElement,position:number,pages:boolean):boolean {
  const blocks=[...viewport.querySelectorAll<HTMLElement>('[data-text-start]')];
  const block=blocks.reverse().find(element=>Number(element.dataset.textStart)<=position);if(!block)return false;
  let offset=Math.max(0,position-Number(block.dataset.textStart));
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let node:Node|null;
  while((node=walker.nextNode())){
    const length=node.textContent?.length||0;
    if(offset>=length){offset-=length;continue;}
    const range=document.createRange();range.setStart(node,offset);range.setEnd(node,Math.min(length,offset+1));
    const rect=range.getBoundingClientRect(),bounds=viewport.getBoundingClientRect();
    if(!rect.width&&!rect.height)return false;
    if(pages){const article=viewport.querySelector<HTMLElement>('.chapter-body');if(!article)return false;const {stride}=pagination(viewport,article);viewport.scrollLeft=Math.floor((rect.left-bounds.left+viewport.scrollLeft)/stride)*stride;}
    else viewport.scrollTop+=rect.top-bounds.top;
    return true;
  }
  return false;
}
