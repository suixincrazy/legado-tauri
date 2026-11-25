import { expect,it } from 'vitest';
import { updatedBook } from './book-update';
import { newBook } from './model';

it('keeps edited content and maps reading marks when the catalog reorders',()=>{
  const book={...newBook('书','online',[{title:'甲',url:'/a',content:'编辑内容',originalContent:'原文',keepSameTitle:true},{title:'乙',url:'/b'}]),sourceUrl:'https://example.org',chapter:0,offset:.4,useReplaceRule:false,reSegment:true,bookmarks:[{chapter:0,offset:.4,title:'甲',created:1}]};
  const fresh={...newBook('书','online',[{title:'新增',url:'/new'},{title:'甲更新',url:'/a'},{title:'乙',url:'/b'}]),sourceUrl:book.sourceUrl};
  const result=updatedBook(book,fresh);expect(result.chapter).toBe(1);expect(result.bookmarks[0].chapter).toBe(1);expect(result.chapters[1]).toMatchObject({title:'甲更新',content:'编辑内容',originalContent:'原文',keepSameTitle:true});expect(result.useReplaceRule).toBe(false);expect(result.offset).toBe(.4);
  const other=updatedBook(book,{...fresh,sourceUrl:'https://other.example'});expect(other.chapters[1].content).toBeUndefined();expect(other.chapters[1].originalContent).toBeUndefined();expect(other.reSegment).toBe(true);
});
