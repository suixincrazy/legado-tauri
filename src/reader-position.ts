import { pagination } from './pagination';

export function visibleTextPosition(viewport:HTMLElement,fromEnd=false):number {
  const bounds=viewport.getBoundingClientRect();
  const blocks=[...viewport.querySelectorAll<HTMLElement>('[data-text-start]')];
  for(const block of fromEnd?blocks.reverse():blocks){
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT),parts:{node:Node;start:number}[]=[];let current:Node|null,total=0;
    while((current=walker.nextNode())){parts.push({node:current,start:total});total+=current.textContent?.length||0;}
    for(const {node,start} of fromEnd?parts.reverse():parts){
      const range=document.createRange();range.selectNodeContents(node);
      if([...range.getClientRects()].some(rect=>rect.right>bounds.left&&rect.left<bounds.right&&rect.bottom>bounds.top&&rect.top<bounds.bottom)){
        const length=node.textContent?.length||0;
        for(let i=0;i<length;i++){const index=fromEnd?length-1-i:i;
          range.setStart(node,index);range.setEnd(node,index+1);const rect=range.getBoundingClientRect();
          if(rect.right>bounds.left&&rect.left<bounds.right&&rect.bottom>bounds.top&&rect.top<bounds.bottom)return Number(block.dataset.textStart)+start+index;
        }
      }
    }
  }
  return 0;
}

export function revealTextPosition(viewport:HTMLElement,position:number,pages:boolean):boolean {
  const blocks=[...viewport.querySelectorAll<HTMLElement>('[data-text-start]')].filter(element=>!element.hidden);
  const first=blocks[0],block=blocks.reverse().find(element=>Number(element.dataset.textStart)<=position)||first;if(!block)return false;
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
