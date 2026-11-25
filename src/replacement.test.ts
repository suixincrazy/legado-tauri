import { describe, expect, it } from 'vitest';
import { newReplaceRule, parseReplaceRules, replaceText, scopedRules } from './replacement-engine';

describe('replacement rules imported from Legado', () => {
  it('preserves upstream identifiers and sample text and rejects invalid regular expressions', () => {
    const rule = { ...newReplaceRule(), id: 42, name: '章节', pattern: '第(\\d+)章', replacement: '第$1节', previewText: '第2章' };
    const [parsed] = parseReplaceRules(JSON.stringify([rule]));
    expect(parsed.id).toBe(42); expect(parsed.previewText).toBe('第2章');
    expect(replaceText('第2章\n第3章', parsed)).toBe('第2节\n第3节');
    expect(() => parseReplaceRules(JSON.stringify({ ...rule, pattern: '[' }))).toThrow();
  });
  it('respects book/source scope, exclusion, enabled state and title/content target', () => {
    const rule = { ...newReplaceRule(), name: '净化', pattern: '广告', replacement: '', scope: '测试,https://example.org' };
    const book = { name: '测试', sourceUrl: 'https://example.org' };
    expect(scopedRules([rule],book,'content')).toHaveLength(1);
    expect(scopedRules([rule],book,'title')).toHaveLength(0);
    expect(scopedRules([{...rule,excludeScope:'测试'}],book,'content')).toHaveLength(0);
    expect(scopedRules([{...rule,isEnabled:false}],book,'content')).toHaveLength(0);
    expect(scopedRules([rule],{name:'其他'},'content')).toHaveLength(0);
  });
  it('keeps literal replacement literal and applies ordered rules without mutating source text', () => {
    const literal = { ...newReplaceRule(), pattern: '[广告]', replacement: '$1', isRegex: false };
    expect(replaceText('甲[广告]乙[广告]',literal)).toBe('甲$1乙$1');
    const rules = [{ ...literal, order:2 }, { ...literal,id:2,order:1 }];
    expect(scopedRules(rules,{name:'书'},'content').map(r=>r.order)).toEqual([1,2]);
    expect(rules.map(r=>r.order)).toEqual([2,1]);
  });
});
