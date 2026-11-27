import type {Book,Settings} from './model';
import {applyReplacement,bookUsesReplace,replaceText,type ReplaceRule} from './replacement';

export type TocTitleOptions=Pick<Settings,'tocUiUseReplace'|'replaceEnableDefault'|'chineseConversion'>;
export type TocTitles={titles:string[];failedRules:number[]};
export const cleanTocTitle=(title:string)=>title.replace(/[\r\n]/g,'');
export function tocTitleRules(rules:ReplaceRule[],book:Book):ReplaceRule[] {
  const fold=(value:string)=>value.replace(/[A-Z]/g,c=>c.toLowerCase());
  // SQLite LIKE folds ASCII and treats % and _ in book/source scopes as wildcards.
  const like=(scope:string,needle:string)=>{
    const pattern=fold(needle);
    if(!/[%_]/.test(pattern))return fold(scope).includes(pattern);
    const input=Array.from(fold(scope)),chars=Array.from('%'+pattern+'%');
    let i=0,j=0,star=-1,mark=0;
    while(i<input.length){
      if(chars[j]==='%'){star=j++;mark=i;}
      else if(chars[j]==='_'||chars[j]===input[i]){i++;j++;}
      else if(star>=0){j=star+1;i=++mark;}else return false;
    }
    while(chars[j]==='%')j++;return j===chars.length;
  };
  const origin=book.sourceUrl??(book.kind==='online'?'':'loc_book');
  const matches=(scope:string)=>like(scope,book.name)||like(scope,origin);
  return rules.filter(rule=>rule.isEnabled&&rule.scopeTitle&&(!rule.scope||matches(rule.scope))&&(rule.excludeScope==null||!matches(rule.excludeScope))).sort((a,b)=>a.order-b.order);
}
export async function tocDisplayTitles(book:Book,rules:ReplaceRule[],options:TocTitleOptions,signal?:AbortSignal,publish?:(result:TocTitles)=>void):Promise<TocTitles> {
  const convert=options.chineseConversion==='none'?(value:string)=>value:(await import('opencc-js')).Converter({from:options.chineseConversion==='simple'?'tw':'cn',to:options.chineseConversion==='simple'?'cn':'tw'});
  const titles=book.chapters.map(c=>convert(cleanTocTitle(c.title))),failed=new Set<number>();
  const selected=options.tocUiUseReplace&&bookUsesReplace(book,options.replaceEnableDefault)?tocTitleRules(rules,book).filter(r=>r.pattern):[];
  const nonblank=(value:string)=>/[^\p{Z}\u0009-\u000d\u001c-\u001f]/u.test(value);
  const result=()=>({titles:[...titles],failedRules:[...failed]});
  if(!selected.length||signal?.aborted)return result();
  publish?.(result());
  const order=book.chapters.map((_,i)=>i);if(book.chapters[book.chapter]){order.splice(book.chapter,1);order.unshift(book.chapter);}
  let lastPublished=0;
  for(const index of order){
    if(signal?.aborted)break;
    const chapter={...book.chapters[index],index:book.chapters[index].index??index};
    titles[index]=selected.some(rule=>rule.isRegex)
      ?await applyReplacement(titles[index],selected,undefined,rule=>failed.add(rule.id),{book,chapter},nonblank)
      :selected.reduce((text,rule)=>{const next=replaceText(text,rule);return nonblank(next)?next:text;},titles[index]);
    if(!signal?.aborted&&Date.now()-lastPublished>80){publish?.(result());lastPublished=Date.now();}
  }
  return result();
}
