import {smartGroup,type Book,type BookGroup,type Settings} from './model';
import {originalReadConfig} from './toc-config';

export const shelfSortOptions=[['recent','最近阅读'],['updated','更新时间'],['name','书名'],['manual','手动排序'],['combined','综合排序'],['author','作者']] as const;
export function groupBookSort(group?:BookGroup):number {
  const value=group?.bookSort??group?.legacy?.bookSort;
  return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<6?value:-1;
}
export function effectiveShelfSort(group:BookGroup|undefined,fallback:Settings['shelfSort']):Settings['shelfSort'] {
  return shelfSortOptions[groupBookSort(group)]?.[0]??fallback;
}
export function groupOnlyUpdateRead(group?:Pick<BookGroup,'onlyUpdateRead'|'legacy'>):boolean {
  const value=group?.onlyUpdateRead??group?.legacy?.onlyUpdateRead;
  return value===true||value===1;
}
// Upstream uses the day component of java.time.Period, not total elapsed days.
function periodDays(start:unknown,today:Date):number {
  const iso=typeof start==='string'?/^(\d{4})-(\d{2})-(\d{2})$/.exec(start):null;
  const date=start&&typeof start==='object'?start as {year?:number;month?:number;day?:number}:undefined;
  const [y,m,d]=(iso?iso.slice(1):[date?.year,date?.month,date?.day]).map(Number);
  const stamp=(year:number,month:number,day:number)=>Date.UTC(year,month-1,day);
  const begin=new Date(stamp(y,m,d));
  if(begin.getUTCFullYear()!==y||begin.getUTCMonth()+1!==m||begin.getUTCDate()!==d)return 0;
  const ey=today.getFullYear(),em=today.getMonth()+1,ed=today.getDate();
  const months=(ey-y)*12+em-m,days=ed-d;
  if(months>0&&days<0){
    const last=new Date(stamp(ey,em,0)).getUTCDate();
    return (stamp(ey,em,ed)-stamp(ey,em-1,Math.min(d,last)))/86400000;
  }
  return months<0&&days>0?days-new Date(stamp(ey,em+1,0)).getUTCDate():days;
}
export function booksForShelfUpdate(books:Book[],group:BookGroup|undefined,today=new Date()):Book[] {
  const caughtUpOnly=groupOnlyUpdateRead(group);
  return books.filter(book=>{
    if(book.kind!=='online'||book.canUpdate===false)return false;
    if(!caughtUpOnly)return true;
    const legacy=book.legacy;
    let total=book.chapters.length||Number(legacy?.totalChapterNum)||0;
    const config=originalReadConfig(legacy?.readConfig);
    if(config.readSimulating===true){
      const elapsed=periodDays(config.startDate,today)+1;
      total=Math.min(total,Math.max(0,Number(config.startChapter??0)+elapsed*Number(config.dailyChapters??3)));
    }
    return total-(book.legacyPosition?.chapter??book.chapter)-1<=0;
  });
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
