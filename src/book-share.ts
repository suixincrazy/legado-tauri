import {isTauri} from '@tauri-apps/api/core';
import type {Book,BookGroup,Source} from './model';
import {compatibleGroupIds,groupBit,groupMask,jsonLong} from './legacy-book-groups';
import {originalReadConfig} from './toc-config';
import {shareText} from './sharing';
import {writeClipboardText} from './clipboard';

// Persisted Book fields at the pinned upstream commit. Runtime/cache data is not shared.
const bookFields='bookUrl tocUrl origin originName name author kind customTag coverUrl customCoverUrl intro customIntro charset type group latestChapterTitle latestChapterTime lastCheckTime lastCheckCount totalChapterNum durChapterTitle durChapterIndex durVolumeIndex chapterInVolumeIndex durChapterPos durChapterTime wordCount canUpdate order originOrder variable readConfig syncTime persistedCoverUrl'.split(' ');
const configFields='reverseToc reverseTocDisplay tocExpanded pageAnim reSegment imageStyle useReplaceRule delTag ttsEngine splitLongChapter readSimulating startDate startChapter dailyChapters openCredits closeCredits playMode playSpeed useGlobalAudioSkip manualReplaceRuleIds paragraphAnchor'.split(' ');
const pick=(value:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.filter(key=>value[key]!=null).map(key=>[key,value[key]]));

export function bookShareMetadata(book:Book,groups:BookGroup[],source?:Source):Record<string,unknown> {
  const legacy=book.legacy||{},local=book.kind!=='online',ids=compatibleGroupIds(groups);
  const group=book.groups===undefined?groupMask(legacy.group):book.groups.reduce((mask,id)=>mask|groupBit(ids.get(id)?.toString()??id.replace(/^legado-group-/,'')),0n);
  const chapter=book.legacyPosition?.chapter??book.chapter;
  const config=pick(originalReadConfig(legacy.readConfig),configFields);
  if(config.paragraphAnchor&&typeof config.paragraphAnchor==='object')config.paragraphAnchor=pick(config.paragraphAnchor as Record<string,unknown>,['chapterUrl','itemId','chapterPosition']);
  for(const key of ['useReplaceRule','reSegment','tocExpanded'] as const)if(book[key]!==undefined)config[key]=book[key];
  const metadata:Record<string,unknown>={
    lastCheckTime:0,lastCheckCount:0,durVolumeIndex:0,chapterInVolumeIndex:0,originOrder:0,syncTime:0,
    ...pick(legacy,bookFields),
    // An imported browser file has no original filesystem URL; never substitute its internal ID.
    bookUrl:book.url||legacy.bookUrl||'',tocUrl:book.tocUrl??legacy.tocUrl??book.url??'',
    origin:local?(legacy.origin||'loc_book'):(book.sourceUrl||legacy.origin||''),
    originName:local?(book.localFileName||legacy.originName||''):(source?.bookSourceName||legacy.originName||''),
    name:book.name,author:book.author,type:(Number(legacy.type??8)&~256)|(local?256:0),group:jsonLong(group),
    kind:book.category??legacy.kind,wordCount:book.wordCount??legacy.wordCount,
    customTag:book.note||(legacy.customTag!=null?'':undefined),latestChapterTime:book.latestChapterTime??legacy.latestChapterTime??book.added,
    latestChapterTitle:book.chapters[book.chapters.length-1]?.title??legacy.latestChapterTitle,
    durChapterTitle:book.chapters[chapter]?.title??legacy.durChapterTitle,
    durChapterIndex:chapter,durChapterPos:book.legacyPosition?.position??(book.syncPosition?.chapter===chapter?book.syncPosition.position:0),
    durChapterTime:book.lastRead,totalChapterNum:book.chapters.length||legacy.totalChapterNum||0,
    canUpdate:book.canUpdate!==false,order:book.order??Number(legacy.order??0),
    variable:book.variables===undefined?legacy.variable:JSON.stringify(book.variables),
    readConfig:Object.keys(config).length?config:undefined,
  };
  // Preserve source/custom distinctions when untouched; project the current edited display values.
  for(const [display,original,custom] of [['cover','coverUrl','customCoverUrl'],['intro','intro','customIntro']] as const){
    if(book[display]!==undefined&&book[display]!==((legacy[custom]||legacy[original])??'')){
      if(legacy[original]!=null||legacy[custom]!=null){metadata[custom]=book[display];if(!book[display])delete metadata[original];}
      else metadata[original]=book[display];
      if(display==='cover')delete metadata.persistedCoverUrl;
    }
  }
  return pick(metadata,bookFields);
}

function formatShareText(metadata:Record<string,unknown>):string {
  return `${metadata.bookUrl}#${JSON.stringify(metadata,(_key,value)=>value===null?undefined:value,2).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')}`;
}

// StringExtensions.isTrue: "null" is checked before trimming; the upstream 0.0 regex uses a wildcard.
export function callbackIsTrue(value:string):boolean {
  const trimmed=value.replace(/^[\p{Z}\u0009-\u000d\u001c-\u001f]+|[\p{Z}\u0009-\u000d\u001c-\u001f]+$/gu,'');
  return !!trimmed&&value!=='null'&&!/^(?:false|no|not|0|0.0)$/i.test(trimmed);
}

async function interceptShare(book:Book,metadata:Record<string,unknown>,source:Source,text:string):Promise<boolean> {
  const {SourceRuntime}=await import('./source-runtime');
  let variables=book.variables;
  if(variables===undefined&&typeof metadata.variable==='string'){try{variables=JSON.parse(metadata.variable);}catch{/* Invalid legacy variables remain metadata only. */}}
  const vm=new SourceRuntime(source,{baseUrl:String(metadata.bookUrl||source.bookSourceUrl),book:{variables:{...variables}}});
  try{
    await vm.initialize();
    await vm.evaluate(`book=wrapEntity(${JSON.stringify(metadata)},'book');chapter=null;var event='clickShareBook';result=${JSON.stringify(text)};java.get=(k)=>source.get(k);java.put=(k,v)=>source.put(k,v);java.copyText=text=>{callHost('loginUi','copy',String(text));};`);
    return callbackIsTrue(await vm.evaluate(`String((0,eval)(${JSON.stringify(source.ruleContent!.callBackJs)}))`));
  }finally{
    try{for(const event of vm.loginEvents)if(event.type==='copy')await writeClipboardText(String(event.data));}
    finally{await vm.close();}
  }
}

export async function shareBookDetails(book:Book,groups:BookGroup[],source?:Source):Promise<{status:'opened'|'cancelled'|'handled'|'preview';text:string}> {
  const metadata=bookShareMetadata(book,groups,source),text=formatShareText(metadata);
  if(source&&(source.eventListener===true||source.eventListener===1)&&source.ruleContent?.callBackJs&&await interceptShare(book,metadata,source,text))return {status:'handled',text};
  try{return {status:await shareText(text,book.name)?'opened':'cancelled',text};}
  catch(error){if(isTauri())throw error;return {status:'preview',text};}
}
