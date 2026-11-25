import {expect,it} from 'vitest';
import {newBook} from './model';
import {legacyTextPosition} from './legacy-position';
import {readingParagraphs} from './highlight-engine';

it('maps original UTF-16 positions after title and paragraph indentation, including hidden titles',()=>{
  const book={...newBook('fixture','txt',[{title:'章',content:'甲😀乙\n丙丁'}]),legacyPosition:{chapter:0,position:11,titleVisible:true,indent:2}};
  const paragraphs=readingParagraphs(book.chapters[0].content!,2);
  expect(legacyTextPosition(book,'章',paragraphs)).toBe(7);
  book.legacyPosition.position=6;expect(legacyTextPosition(book,'章',paragraphs)).toBe(4);
  book.legacyPosition.titleVisible=false;book.legacyPosition.position=9;expect(legacyTextPosition(book,'章',paragraphs)).toBe(7);
  book.legacyPosition.position=9999;expect(legacyTextPosition(book,'章',paragraphs)).toBe(8);
  book.legacyPosition.chapter=1;expect(legacyTextPosition(book,'章',paragraphs)).toBeNull();
});
