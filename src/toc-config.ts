import type {Book} from './model';

export function originalReadConfig(value:unknown):Record<string,unknown>{
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{return {};}}
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

export function bookTocExpanded(book:Pick<Book,'tocExpanded'>&{legacy?:{readConfig?:unknown}}):boolean{
  return book.tocExpanded??(originalReadConfig(book.legacy?.readConfig).tocExpanded!==false);
}
