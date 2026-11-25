import type { Book, Settings } from './model';

export function sortBooks(books:Book[],sort:Settings['shelfSort']):Book[] {
  return [...books].sort((a,b)=>{
    const pinned=Number(!!b.pinned)-Number(!!a.pinned);if(pinned)return pinned;
    switch(sort) {
      case 'updated':return (b.latestChapterTime||0)-(a.latestChapterTime||0);
      case 'name':return a.name.localeCompare(b.name,'zh-CN',{numeric:true});
      case 'author':return a.author.localeCompare(b.author,'zh-CN',{numeric:true});
      case 'manual':return (a.order??a.added)-(b.order??b.added);
      case 'combined':return Math.max(b.latestChapterTime||0,b.lastRead)-Math.max(a.latestChapterTime||0,a.lastRead);
      default:return b.lastRead-a.lastRead||b.added-a.added;
    }
  });
}
export function unreadChapters(book:Book):number {return book.finished?0:Math.max(0,book.chapters.length-book.chapter-1);}
