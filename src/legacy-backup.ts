import {strFromU8,strToU8} from 'fflate';
import type {Source} from './model';

export const legacyBackupNames=['myBookShelf.json','myBookSource.json','myBookReplaceRule.json'];
const text=(value:unknown)=>typeof value==='string'?value:undefined;
const number=(value:unknown,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

// Keep the pinned upstream ImportOldData conversion order, including rule prefixes.
export function legacyRule(rule?:string):string|undefined {
  if(!rule?.trim())return;
  let value=rule,reverse=false,all=false;
  if(value.startsWith('-')){reverse=true;value=value.slice(1);}
  if(value.startsWith('+')){all=true;value=value.slice(1);}
  if(!/^@CSS:|^@XPath:|^\/\/|^##|^:|@js:|<js>/i.test(value)){
    if(value.includes('#')&&!value.includes('##'))value=rule.replaceAll('#','##');
    if(value.includes('|')&&!value.includes('||')){const parts=value.split('##');parts[0]=parts[0].replaceAll('|','||');value=parts.join('##');}
    if(value.includes('&')&&!value.includes('&&')&&!value.includes('http')&&!value.startsWith('/'))value=value.replaceAll('&','&&');
  }
  return (reverse?'-':'')+(all?'+':'')+value;
}
export function legacyUrl(old?:string):string|undefined {
  if(!old?.trim())return;
  if(/^<js>/i.test(old))return old.replaceAll('=searchKey','={{key}}').replaceAll('=searchPage','={{page}}');
  let url=old;const options:Record<string,string>={};
  const header=/@Header:\{.+?\}/i.exec(url)?.[0];
  if(header){url=url.split(header).join('');options.headers=header.slice(8);}
  const segments=url.split('|');url=segments[0];
  if(segments.length>1){const charset=segments[1].split('=')[1];if(charset===undefined)throw new Error('旧版书源编码配置无效');options.charset=charset;}
  const scripts=[...url.matchAll(/\{\{.+?\}\}/g)].map(match=>match[0]);
  scripts.forEach((script,index)=>{url=url.split(script).join('$'+index);});
  url=url.replaceAll('{','<').replaceAll('}','>').replaceAll('searchKey','{{key}}').replace(/<searchPage([-+]1)>/g,'{{page$1}}').replace(/searchPage([-+]1)/g,'{{page$1}}').replaceAll('searchPage','{{page}}');
  scripts.forEach((script,index)=>{url=url.split('$'+index).join(script.replaceAll('searchKey','key').replaceAll('searchPage','page'));});
  const post=url.split('@');url=post[0];if(post.length>1){options.method='POST';options.body=post[1];}
  return url+(Object.keys(options).length?','+JSON.stringify(options):'');
}
export function legacyUrls(value?:string):string|undefined {
  if(!value?.trim())return;
  if(value.startsWith('@js:')||value.startsWith('<js>'))return value;
  if(!value.includes('\n')&&!value.includes('&&'))return legacyUrl(value);
  return value.split(/(?:&&|\r?\n)+/).map(legacyUrl).filter((item):item is string=>!!item).map(item=>item.replace(/\n\s*/g,'')).join('\n')||undefined;
}
export function isLegacySource(value:Record<string,unknown>) {
  return !value.ruleSearch&&!value.ruleToc&&!value.ruleContent&&['ruleSearchUrl','ruleSearchList','ruleChapterList','ruleBookContent','ruleFindUrl'].some(key=>key in value);
}
export function convertLegacySource(old:Record<string,any>):Source {
  if(typeof old.bookSourceUrl!=='string'||!old.bookSourceUrl.trim())throw new Error('旧版书源缺少标识');
  const rules=(fields:Record<string,string>)=>Object.fromEntries(Object.entries(fields).flatMap(([key,field])=>{const rule=legacyRule(text(old[field]));return rule===undefined?[]:[[key,rule]];}));
  const search=(prefix:string)=>rules({bookList:`${prefix}List`,name:`${prefix}Name`,author:`${prefix}Author`,intro:`${prefix}Introduce`,kind:`${prefix}Kind`,bookUrl:`${prefix}NoteUrl`,coverUrl:`${prefix}CoverUrl`,lastChapter:`${prefix}LastChapter`});
  const exploreUrl=legacyUrls(text(old.ruleFindUrl));let content=legacyRule(text(old.ruleBookContent))||'';
  if(content.startsWith('$')&&!content.startsWith('$.'))content=content.slice(1);
  return {...old,bookSourceUrl:old.bookSourceUrl,bookSourceName:text(old.bookSourceName)||'',bookUrlPattern:text(old.ruleBookUrlPattern),customOrder:number(old.serialNumber),header:old.httpUserAgent?JSON.stringify({'User-Agent':String(old.httpUserAgent)}):undefined,searchUrl:legacyUrl(text(old.ruleSearchUrl)),exploreUrl,bookSourceType:old.bookSourceType==='AUDIO'?1:0,enabled:old.enable!==false,enabledExplore:!!exploreUrl,ruleSearch:search('ruleSearch'),ruleExplore:search('ruleFind'),ruleBookInfo:rules({init:'ruleBookInfoInit',name:'ruleBookName',author:'ruleBookAuthor',intro:'ruleIntroduce',kind:'ruleBookKind',coverUrl:'ruleCoverUrl',lastChapter:'ruleBookLastChapter',tocUrl:'ruleChapterUrl'}),ruleToc:rules({chapterList:'ruleChapterList',chapterName:'ruleChapterName',chapterUrl:'ruleContentUrl',nextTocUrl:'ruleChapterUrlNext'}),ruleContent:{...rules({replaceRegex:'ruleBookContentReplace',nextContentUrl:'ruleContentUrlNext'}),content}};
}
export function convertLegacyFiles(files:Record<string,Uint8Array>):Record<string,Uint8Array> {
  if(!legacyBackupNames.some(name=>files[name]))throw new Error('未找到旧版备份文件');
  const result:Record<string,Uint8Array>={...files};
  const read=(name:string)=>{let rows:any;try{rows=JSON.parse(strFromU8(files[name]).replace(/^\uFEFF/,''));}catch{throw new Error(`旧版备份 ${name} 不是有效 JSON`);}if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error(`旧版备份 ${name} 格式无效`);return rows;};
  const write=(name:string,rows:any[])=>{result[name]=strToU8(JSON.stringify(rows));};
  if(files['myBookShelf.json'])write('bookshelf.json',read('myBookShelf.json').filter(row=>typeof row.noteUrl==='string'&&row.noteUrl.trim()).map(row=>{
    const info=row.bookInfoBean||{};
    return {bookUrl:row.noteUrl,name:text(info.name)||'',origin:text(row.tag)||'',originName:text(info.origin)||'',author:text(info.author)||'',type:(row.tag==='loc_book'?256:0)|(info.bookSourceType==='AUDIO'?32:8),tocUrl:text(info.chapterUrl)||row.noteUrl,coverUrl:text(info.coverUrl),customCoverUrl:text(row.customCoverPath),lastCheckTime:number(info.finalRefreshData),canUpdate:row.allowUpdate===true,totalChapterNum:number(row.chapterListSize),durChapterIndex:number(row.durChapter),durChapterTitle:text(row.durChapterName),durChapterPos:number(row.durChapterPage),durChapterTime:number(row.finalDate),intro:text(info.introduce),latestChapterTitle:text(row.lastChapterName),lastCheckCount:number(row.newChapters),order:number(row.serialNumber),variable:text(row.variable),readConfig:{useReplaceRule:row.useReplaceRule===true},legacyV2:row};
  }));
  if(files['myBookSource.json'])write('bookSource.json',read('myBookSource.json').map(convertLegacySource));
  if(files['myBookReplaceRule.json'])write('replaceRule.json',read('myBookReplaceRule.json').map((row,index)=>{
    if(row.pattern)return row;
    if(typeof row.regex!=='string'||!row.regex)throw new Error('旧版替换规则缺少匹配内容');
    return {...row,id:number(row.id,Date.now()+index),pattern:row.regex,name:text(row.replaceSummary)||'',replacement:text(row.replacement)||'',isRegex:row.isRegex===true,scope:text(row.useTo),isEnabled:row.enable===true,order:number(row.serialNumber),scopeTitle:false,scopeContent:true};
  }));
  return result;
}
