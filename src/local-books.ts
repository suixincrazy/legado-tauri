import {decodeText,importBook} from './import';
import {newBook,type Book} from './model';
import {applyTxtRule,importTxtWithRules,type TxtTocRule} from './txt-rules';

export async function importLocalBook(bytes:Uint8Array,name:string,rules:TxtTocRule[],ruleId?:number):Promise<Book> {
  if(bytes.length>50*1024*1024)throw new Error('单本文件请小于 50 MB');
  if(/\.epub$/i.test(name)||bytes[0]===0x50&&bytes[1]===0x4b)return {...importBook(bytes,name),localFileName:name};
  const text=decodeText(bytes).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  if(!text.trim())throw new Error('文件没有可阅读的文字');
  const rule=rules.find(item=>item.id===ruleId),title=name.replace(/\.txt$/i,'');
  const book=rule?{...newBook(title,'txt',await applyTxtRule(text,rule,{name:title})),rawText:text,txtTocRuleId:rule.id}:await importTxtWithRules(text,name,rules);
  return {...book,localFileName:name};
}
export async function restoreLocalBook(book:Book,file:{name:string;bytes:Uint8Array},rules:TxtTocRule[]):Promise<Book> {
  const imported=await importLocalBook(file.bytes,file.name,rules,book.txtTocRuleId);
  const originalChapter=book.legacyPosition?.chapter??book.chapter,chapter=Math.min(originalChapter,Math.max(0,imported.chapters.length-1));
  return {...book,kind:imported.kind,chapters:imported.chapters,rawText:imported.rawText,txtTocRuleId:imported.txtTocRuleId,localFileName:file.name,cover:book.cover||imported.cover,chapter,offset:chapter===originalChapter?book.offset:0,
    legacyPosition:book.legacyPosition?{...book.legacyPosition,chapter,position:chapter===originalChapter?book.legacyPosition.position:0}:undefined,
    syncPosition:book.syncPosition?.chapter===chapter?book.syncPosition:undefined};
}
