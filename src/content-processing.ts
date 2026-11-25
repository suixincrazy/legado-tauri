import type { Chapter } from './model';

const imagePattern=/<img[^>]*src="([^"]*(?:"[^>]+\})?)"[^>]*>/g;
const markupPattern=/<usehtml>[\s\S]*?<\/usehtml>|<img[^>]*src="([^"]*(?:"[^>]+\})?)"[^>]*>|\[newpage\]|<!--[\s\S]*?-->|<\/?[a-zA-Z](?:[^<>"']|"[^"]*"|'[^']*')*>|&(?:#\d+|#x[\da-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;
const symbols='“”‘’【】()<>{}[]（）《》〈〉〖〗〔〕『』「」｛｝≤≥≦≧⊆⊇⊂⊃◢◣◤◥←→↖↗↙↘☜☞꧁꧂╭╮╰╯«»〝〞＜＞［］｢｣';
const mirrored=new Map<string,string>();for(let index=0;index<symbols.length;index+=2){mirrored.set(symbols[index],symbols[index+1]);mirrored.set(symbols[index+1],symbols[index]);}
export function reverseContentText(content:string):string {
  const rich=new RegExp(markupPattern.source).test(content),boundary=new RegExp(markupPattern.source+'|\r\n|\r|\n','g');
  const reverse=(start:number,end:number)=>{let from=start,to=end;if(rich&&(start===0||/[\r\n]/.test(content[start-1]))){while(from<to&&/\s/.test(content[from]))from++;while(to>from&&/\s/.test(content[to-1]))to--;}return content.slice(start,from)+Array.from(content.slice(from,to)).reverse().map(char=>mirrored.get(char)||char).join('')+content.slice(to,end);};
  let start=0,result='';if(rich)for(const match of content.matchAll(boundary)){result+=reverse(start,match.index)+match[0];start=match.index+match[0].length;}
  return result+reverse(start,content.length);
}
export function reverseChapter(chapter:Chapter):Chapter {
  if(chapter.reversedOriginal!==undefined)return {...chapter,content:chapter.reversedOriginal,reversedOriginal:undefined};
  const content=chapter.content||'';return {...chapter,content:reverseContentText(content),reversedOriginal:content};
}
export function removeDuplicateTitle(content:string,bookName:string,title:string):{text:string;removed:boolean} {
  if(!title.trim())return {text:content,removed:false};
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const titlePattern=escape(title).replace(/[\s\u3000]+/g,'\\s*');
  const prefix=bookName?`|${escape(bookName)}`:'';
  const regex=new RegExp(`^(?:\\s|\\p{P}${prefix})*${titlePattern}[\\t\\v\\f\\p{Zs}]*(?:(?:\\r\\n|\\r|\\n)\\s*|$)`,'u');
  const match=regex.exec(content);return {text:match?content.slice(match[0].length):content,removed:!!match};
}

export class ContentEditProjection {
  readonly images:{start:number;end:number}[];
  readonly text:string;
  constructor(readonly raw:string){this.images=[...raw.matchAll(new RegExp(imagePattern))].map(match=>({start:match.index,end:match.index+match[0].length}));this.text=raw.replace(new RegExp(imagePattern),'');}
  displayOffset(rawOffset:number){const offset=Math.max(0,Math.min(this.raw.length,rawOffset));return offset-this.images.reduce((total,image)=>total+Math.max(0,Math.min(image.end-image.start,offset-image.start)),0);}
  rawOffset(displayOffset:number,afterImages=true){let offset=Math.max(0,Math.min(this.text.length,displayOffset));for(const image of this.images){if(image.start>offset||(!afterImages&&image.start===offset))break;offset+=image.end-image.start;}return offset;}
  replace(start:number,end:number,replacement:string){if(start<0||end<start||end>this.text.length)throw new Error('正文编辑范围无效');const from=this.rawOffset(start),to=Math.max(from,this.rawOffset(end,false));return this.raw.slice(0,from)+replacement+this.images.filter(image=>image.start>=from&&image.end<=to).map(image=>this.raw.slice(image.start,image.end)).join('')+this.raw.slice(to);}
  update(text:string){let start=0;while(start<Math.min(text.length,this.text.length)&&text[start]===this.text[start])start++;let oldEnd=this.text.length,newEnd=text.length;while(oldEnd>start&&newEnd>start&&this.text[oldEnd-1]===text[newEnd-1]){oldEnd--;newEnd--;}return this.replace(start,oldEnd,text.slice(start,newEnd));}
}
export function contentSearch(text:string,query:string,regex=false,matchCase=false):{start:number;end:number}[] {
  if(!query)return [];const result:{start:number;end:number}[]=[];
  const pattern=new RegExp(regex?query:query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),matchCase?'g':'gi');let match:RegExpExecArray|null;
  while((match=pattern.exec(text))&&result.length<10000){if(match[0].length)result.push({start:match.index,end:match.index+match[0].length});else pattern.lastIndex++;}return result;
}
