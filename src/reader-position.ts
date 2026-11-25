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
