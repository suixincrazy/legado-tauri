import { describe, expect, it } from 'vitest';
import { chaptersFromHeadings, defaultTxtRules, parseTxtRules, scanTxtHeadings, txtPattern } from './txt-rules-engine';
describe('upstream TXT catalog rules',()=>{
  it('loads every upstream regex including Java leading flags',()=>{
    expect(defaultTxtRules.length).toBe(26);
    for(const rule of defaultTxtRules)expect(()=>txtPattern(rule.rule)).not.toThrow();
    expect(scanTxtHeadings('Chapter 1\ntext\nchapter 2','(?im)^chapter \\d+$').map(item=>item.title)).toEqual(['Chapter 1','chapter 2']);
  });
  it('preserves preface, blank lines, empty headings and final chapter content',()=>{
    const text='前言内容\n第一章\n第一段\n\n第二段\n第二章\n第三章\n最后一段';
    const chapters=chaptersFromHeadings(text,scanTxtHeadings(text,'^第.{1,3}章$'));
    expect(chapters.map(({title,content})=>({title,content}))).toEqual([{title:'前言',content:'前言内容'},{title:'第一章',content:'第一段\n\n第二段'},{title:'第二章',content:''},{title:'第三章',content:'最后一段'}]);
  });
  it('rejects invalid imported patterns and handles zero-length matches',()=>{
    expect(()=>parseTxtRules('[{"name":"bad","rule":"["}]')).toThrow();
    expect(scanTxtHeadings('正文','^')).toEqual([]);
    expect(chaptersFromHeadings('单章正文',[])).toEqual([{title:'正文',content:'单章正文',wordCount:'4字'}]);
  });
});
