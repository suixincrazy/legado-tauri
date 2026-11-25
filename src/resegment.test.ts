import { expect,it } from 'vitest';
import { resegmentContent } from './resegment';

it('joins broken paragraphs while keeping sentence boundaries and dropping the leading chapter title',()=>{
  expect(resegmentContent('第一章\n\n他走到\n窗前。\n雨还在下。','第一章',()=>1)).toBe('他走到窗前。\n雨还在下。');
  expect(resegmentContent('　他 走到\n窗前。','章',()=>1)).toBe('他走到窗前。');
  expect(resegmentContent('','章',()=>1)).toBe('');
});
it('normalizes dialogue quotes and keeps quoted enumeration together',()=>{
  expect(resegmentContent('他说："你好！"\n她说："再见。"','章',()=>1)).toBe('他说：“你好！”\n她说：“再见。”');
  expect(resegmentContent('他拿走“锅”、“碗”和“盆”。','章',()=>1)).toBe('他拿走“锅”、“碗”和“盆”。');
});
it('uses the upstream sentence threshold when splitting long prose',()=>{
  const text='第一句。第二句。第三句。第四句。第五句。';
  expect(resegmentContent(text,'章',()=>1)).toBe(text);
  expect(resegmentContent(text,'章',()=>0)).toBe('第一句。\n第二句。\n第三句。\n第四句。\n第五句。');
});
