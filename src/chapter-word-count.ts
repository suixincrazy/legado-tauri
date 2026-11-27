import type {Chapter} from './model';

export function formatChapterWordCount(count:number):string {
  if(count<=0)return '';
  if(count<=10000)return count+'字';
  const value=Math.fround(count)/10000;
  // DecimalFormat("#.#") rounds the binary double, with exact ties going to even.
  const lower=Math.floor(value*10),rounded=value%.5===.25?((lower+lower%2)/10).toFixed(1):value.toFixed(1);
  return rounded.replace(/\.0$/,'')+'万字';
}

export function withChapterContent(chapter:Chapter,content:string,countWords:boolean):Chapter {
  return {...chapter,content,...(countWords&&!chapter.isVolume?{wordCount:formatChapterWordCount(content.length)}:{})};
}

export function chapterInfoWordCount(info:string):string|undefined {
  return /(?:^|字数[：:、]?|[ \t\n\x0B\f\r]+)([0-9万千百.]{1,6}字)/.exec(info)?.[1];
}
