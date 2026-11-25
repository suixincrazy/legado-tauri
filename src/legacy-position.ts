import type { Book } from './model';

// Android counts the rendered title, paragraph indentation and UTF-16 code units.
export function legacyTextPosition(book:Book,title:string,paragraphs:{text:string;start:number}[]):number|null {
  const anchor=book.legacyPosition;if(!anchor||anchor.chapter!==book.chapter)return null;
  let oldStart=anchor.titleVisible?title.length+1:0;
  if(anchor.position<oldStart)return Math.min(anchor.position,title.length);
  for(const paragraph of paragraphs){
    const end=oldStart+anchor.indent+paragraph.text.length;
    if(anchor.position<=end)return paragraph.start+Math.max(0,Math.min(paragraph.text.length-1,anchor.position-oldStart-anchor.indent));
    oldStart=end+1;
  }
  const last=paragraphs[paragraphs.length-1];return last?last.start+last.text.length-1:0;
}
