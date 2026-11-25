import type { Book, Chapter } from './model';
import type { ReplaceRule } from './replacement-engine';
import { SourceRuntime } from './source-runtime';

export type ReplacementContext = { book?: Book; chapter?: Chapter };
export async function scriptReplacements(matches: string[], rule: ReplaceRule, context: ReplacementContext = {}, deadline = Date.now() + Math.max(100, Math.min(30000, rule.timeoutMillisecond || 3000))): Promise<string[]> {
  if (!matches.length) return [];
  const book = context.book, chapter = context.chapter;
  const legacy = (book as (Book & { legacy?: Record<string, unknown> }) | undefined)?.legacy;
  const bookData = book ? { ...legacy, name: book.name, author: book.author, bookUrl: book.url || legacy?.bookUrl || '', origin: book.sourceUrl || legacy?.origin || '', tocUrl: book.tocUrl || legacy?.tocUrl || '', coverUrl: book.cover || '', intro: book.intro || '' } : null;
  const chapterData = chapter ? { ...chapter, content: undefined, originalContent: undefined, reversedOriginal: undefined, index: chapter.index ?? book?.chapter ?? 0, bookUrl: bookData?.bookUrl || '' } : null;
  const vm = new SourceRuntime({ bookSourceUrl: 'legado-replacement', bookSourceName: rule.name });
  try {
    await vm.initialize();
    await vm.evaluate(`book=${JSON.stringify(bookData)};chapter=${JSON.stringify(chapterData)};var __replaceVariables=Object.create(null);java.get=k=>__replaceVariables[k]||'';java.put=(k,v)=>(__replaceVariables[k]=String(v));`);
    const output: string[] = [];
    for (const match of matches) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('替换脚本执行超时');
      vm.context.timeoutMs = remaining;
      output.push(await vm.evaluate(`(function(result){return String(eval(${JSON.stringify(rule.replacement.slice(4))}));})(${JSON.stringify(match)})`));
    }
    return output;
  } finally { await vm.close(); }
}

export function expandScriptReplacement(value: string, match: RegExpMatchArray): string {
  return value.replace(/\$(?:\{([^}]+)\}|(\d+)|(.|$))/g, (_token, name: string | undefined, digits: string | undefined) => {
    if (name !== undefined) {
      if (!match.groups || !(name in match.groups)) throw new Error('替换分组不存在');
      return match.groups[name] || '';
    }
    if (digits !== undefined) {
      let count = 1, index = Number(digits[0]);
      if (index >= match.length) throw new Error('替换分组不存在');
      while (count < digits.length && Number(digits.slice(0, count + 1)) < match.length) index = Number(digits.slice(0, ++count));
      return (match[index] || '') + digits.slice(count);
    }
    throw new Error('替换分组引用无效');
  });
}
