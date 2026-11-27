import {smartGroup,type Book,type BookGroup,type Settings} from './model';

export const shelfSortOptions=[['recent','最近阅读'],['updated','更新时间'],['name','书名'],['manual','手动排序'],['combined','综合排序'],['author','作者']] as const;
export function groupBookSort(group?:BookGroup):number {
  const value=group?.bookSort??group?.legacy?.bookSort;
  return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<6?value:-1;
}
export function effectiveShelfSort(group:BookGroup|undefined,fallback:Settings['shelfSort']):Settings['shelfSort'] {
  return shelfSortOptions[groupBookSort(group)]?.[0]??fallback;
}
export function isUserBookGroup(group:BookGroup):boolean {
  return !/^legado-group--\d+$/.test(group.id)||group.id==='legado-group--9223372036854775808';
}
export function bookInGroup(book:Book,selected:string,groups:BookGroup[]):boolean {
  if(selected==='全部')return true;
  if(['未读','在读','已读'].includes(selected))return smartGroup(book)===selected;
  const legacy=(book as Book&{legacy?:Record<string,any>}).legacy;
  const type=Number(legacy?.type??(book.kind==='online'?8:264)),local=!!(type&256);
  const count=book.chapters.length||Number(legacy?.totalChapterNum)||0,chapter=book.legacyPosition?.chapter??book.chapter;
  const grouped=(book.groups||[]).some(id=>groups.some(group=>group.id===id&&isUserBookGroup(group)));
  switch(selected){
    case 'legado-group--1':return true;
    case 'legado-group--2':return local;
    case 'legado-group--3':return !!(type&32);
    case 'legado-group--4':return !local&&!(type&(32|4))&&!grouped;
    case 'legado-group--5':return local&&!grouped;
    case 'legado-group--6':return !!(type&4);
    case 'legado-group--7':return !!(type&64);
    case 'legado-group--8':return !!(type&8);
    case 'legado-group--11':return !!(type&16);
    case 'legado-group--20':return count>0&&chapter>0&&chapter<count-1;
    case 'legado-group--21':return chapter===0&&book.offset===0&&(book.legacyPosition?.position??0)===0;
    case 'legado-group--22':return count>0&&chapter>=count-1;
    case 'legado-group--23':return count>0&&chapter>=count-1&&book.canUpdate!==false;
    case 'legado-group--24':return count>0&&chapter>=count-1&&book.canUpdate===false;
    default:return (book.groups||[]).includes(selected);
  }
}

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
