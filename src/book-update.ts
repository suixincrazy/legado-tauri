import type { Book } from './model';

export function updatedBook(book:Book,fresh:Book):Book {
  const sameSource=book.sourceUrl===fresh.sourceUrl;
  const chapters=fresh.chapters.map(chapter=>{
    const old=sameSource?book.chapters.find(item=>item.url===chapter.url):undefined;
    return {...chapter,wordCount:old?.wordCount??chapter.wordCount,content:old?.content,originalContent:old?.originalContent,reversedOriginal:old?.reversedOriginal,keepSameTitle:old?.keepSameTitle};
  });
  const locate=(index:number)=>{const previous=book.chapters[index];let found=sameSource&&previous?.url?chapters.findIndex(item=>item.url===previous.url):-1;if(found<0&&previous)found=chapters.findIndex(item=>item.title===previous.title);return found>=0?found:Math.max(0,Math.min(index,chapters.length-1));};
  const chapter=locate(!book.chapters.length&&book.legacyPosition?book.legacyPosition.chapter:book.chapter);
  return {...book,...fresh,id:book.id,added:book.added,lastRead:book.lastRead,note:book.note,groups:book.groups,canUpdate:book.canUpdate,pinned:book.pinned,order:book.order,useReplaceRule:book.useReplaceRule,reSegment:book.reSegment,tocExpanded:book.tocExpanded,finished:chapters.length>book.chapters.length?false:book.finished,chapter,offset:book.offset,chapters,legacyPosition:book.legacyPosition&&{...book.legacyPosition,chapter},syncPosition:book.syncPosition&&{...book.syncPosition,chapter:locate(book.syncPosition.chapter)},latestChapterTime:chapters.length>book.chapters.length?Date.now():book.latestChapterTime,bookmarks:book.bookmarks.map(mark=>({...mark,chapter:locate(mark.chapter)})),highlights:book.highlights?.map(mark=>({...mark,bookUrl:fresh.url||book.id,chapterIndex:locate(mark.chapterIndex),chapterUrl:chapters[locate(mark.chapterIndex)]?.url||''}))};
}
