import type { Source } from './model';

// Port of Legado RuleComplete. Avoid lookbehind for iOS 15 WKWebView.
const complexRule = /^:|^##|\{\{|@js:|<js>|@Json:|\$\./;
const extractor = /(?:^|[@/]|[|%&]{2})(?:attr|text|ownText|textNodes|href|content|html|alt|all|value|src)(?:\(\))?(?![\s\S])/;

export function completeRule(rule: string, preRule?: string, type: 1 | 2 | 3 = 1): string {
  if (!rule || complexRule.test(rule) || (preRule && complexRule.test(preRule))) return rule;
  const tail = /##|,\{/.exec(rule), head = tail ? rule.slice(0, tail.index) : rule;
  const suffix = tail ? rule.slice(tail.index) : '', xpath = /^\/\/|^@Xpath:/.test(head);
  const ending = xpath ? ['', '//text()', '//@href', '//@src'][type] : ['', '@text', '@href', '@src'][type];
  let completed = head.replace(/&&|%%|\|\||(?=\r\n?$|[\n\u0085\u2028\u2029]?$)/g, (separator, offset: number) => {
    if (!separator && head[offset] === '\n' && head[offset - 1] === '\r') return '';
    return extractor.test(head.slice(0, offset)) ? separator : ending + separator;
  });
  if (type === 1) completed = completed.replace(/(^|tag\.|[+/@>~| &])img(\[@?.+\]|\.[-\w]+)?[@/]+text(?:\(\))?(?=&&|%%|\|\||$)/g, (_match, prefix: string, attributes: string | undefined) => `${prefix}img${attributes || ''}${xpath ? '/@alt' : '@alt'}`);
  return completed + suffix;
}

export function completeSourceRules(source: Source): Source {
  const result = { ...source }, text = ['name', 'author', 'kind', 'intro', 'wordCount', 'lastChapter'];
  const groups: [string, string, string[], string[], string[]][] = [
    ['ruleSearch', 'bookList', text, ['bookUrl'], ['coverUrl']],
    ['ruleExplore', 'bookList', text, ['bookUrl'], ['coverUrl']],
    ['ruleBookInfo', 'init', [...text, 'downloadUrls'], ['tocUrl'], ['coverUrl']],
    ['ruleToc', 'chapterList', ['chapterName'], ['chapterUrl', 'nextTocUrl'], []],
    ['ruleContent', '', ['content', 'subContent', 'title'], ['nextContentUrl'], []],
  ];
  for (const [group, pre, texts, links, images] of groups) {
    const value = source[group];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rules = { ...value } as Record<string, unknown>, preRule = typeof rules[pre] === 'string' ? rules[pre] as string : undefined;
    for (const [index, fields] of [texts, links, images].entries()) for (const field of fields) {
      if (typeof rules[field] === 'string') rules[field] = completeRule(rules[field] as string, preRule, (index + 1) as 1 | 2 | 3);
    }
    result[group] = rules;
  }
  return result;
}
