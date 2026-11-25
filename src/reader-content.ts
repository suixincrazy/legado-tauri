import type { Book, Chapter, Settings } from './model';
import { removeDuplicateTitle } from './content-processing';
import { applyReplacement, scopedRules, type ReplaceRule } from './replacement';

export async function processReaderContent(text:string,book:Book,chapter:Chapter,rules:ReplaceRule[],conversion:Settings['chineseConversion']) {
  const enabled=book.useReplaceRule===false?[]:rules,applied:ReplaceRule[]=[];
  const title=await applyReplacement(chapter.title,scopedRules(enabled,book,'title'),rule=>applied.push(rule));
  let duplicate=chapter.keepSameTitle?{text,removed:false}:removeDuplicateTitle(text,book.name,chapter.title);
  if(!chapter.keepSameTitle&&!duplicate.removed)duplicate=removeDuplicateTitle(text,book.name,title);
  const convert=conversion==='none'?(value:string)=>value:(await import('opencc-js')).Converter({from:conversion==='simple'?'tw':'cn',to:conversion==='simple'?'cn':'tw'});
  const body=await applyReplacement(convert(duplicate.text),scopedRules(enabled,book,'content'),rule=>applied.push(rule));
  return {content:body,title:convert(title),sameTitleRemoved:duplicate.removed,effectiveRules:[...new Map(applied.map(rule=>[rule.id,rule])).values()]};
}
