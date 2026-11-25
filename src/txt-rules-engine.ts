import defaults from './default-txt-rules.json';
import type { Chapter } from './model';
export type TxtTocRule = { id:number; name:string; rule:string; replacement:string; example:string; serialNumber:number; enable:boolean };
export type Heading = { start:number; end:number; title:string };
export const defaultTxtRules: TxtTocRule[] = defaults.map(rule=>({replacement:'',...rule}));
export function txtPattern(pattern:string) {
  let flags='gm';
  pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,extra:string)=>{flags=[...new Set(flags+extra)].join('');return '';});
  return new RegExp(pattern,flags);
}
export function parseTxtRules(text:string):TxtTocRule[] {
  const data=JSON.parse(text);
  return (Array.isArray(data)?data:[data]).map((rule,index)=>{
    if(!rule || typeof rule.name!=='string' || typeof rule.rule!=='string')throw new Error('目录规则缺少名称或正则表达式');
    txtPattern(rule.rule);
    return {replacement:'',example:'',serialNumber:index,enable:true,...rule,id:Number.isFinite(rule.id)?rule.id:Date.now()+index};
  });
}
export function scanTxtHeadings(text:string,pattern:string):Heading[] {
  if(!pattern)return [];
  const regex=txtPattern(pattern),headings:Heading[]=[];
  let match:RegExpExecArray|null;
  while((match=regex.exec(text))) {
    if(!match[0].length) {regex.lastIndex++;continue;}
    headings.push({start:match.index,end:match.index+match[0].length,title:match[0].trim()});
    if(headings.length>50000)throw new Error('目录超过 50000 项，请检查规则');
  }
  return headings;
}
export function chaptersFromHeadings(text:string,headings:Heading[]):Chapter[] {
  const chapters:Chapter[]=[];
  if(!headings.length)return [{title:'正文',content:text.trim()}];
  const preface=text.slice(0,headings[0].start).trim();
  if(preface)chapters.push({title:'前言',content:preface});
  headings.forEach((heading,index)=>chapters.push({title:heading.title,content:text.slice(heading.end,headings[index+1]?.start??text.length).trim()}));
  return chapters;
}
