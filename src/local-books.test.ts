import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {strToU8,zipSync} from 'fflate';
import {importLocalBook,restoreLocalBook} from './local-books';
import {scanTxtHeadings,type TxtTocRule} from './txt-rules-engine';

class HeadingWorker {
  onmessage:(event:{data:{headings:ReturnType<typeof scanTxtHeadings>}})=>void=()=>{};
  onerror:(event:{message:string})=>void=()=>{};
  postMessage({text,pattern}:{text:string;pattern:string}) {
    queueMicrotask(()=>{try{this.onmessage({data:{headings:scanTxtHeadings(text,pattern)}});}catch(error){this.onerror({message:String(error)});}});
  }
  terminate(){}
}
beforeAll(()=>vi.stubGlobal('Worker',HeadingWorker));
afterAll(()=>vi.unstubAllGlobals());
const rule:TxtTocRule={id:901,name:'Public fixture headings',rule:'^Section [0-9]+$',replacement:'',example:'',serialNumber:0,enable:true};

it('uses the same TXT catalog for import and missing-file restore, retaining raw text and saved progress',async()=>{
  const bytes=strToU8('Section 1\n'+('正文第一章。\n'.repeat(220))+'Section 2\n第二章正文𠮷');
  const imported=await importLocalBook(bytes,'catalog.txt',[rule]);
  expect(imported.chapters.map(chapter=>chapter.title)).toEqual(['Section 1','Section 2']);
  const missing={...imported,name:'Saved title',author:'Saved author',chapters:[],chapter:1,offset:.65,bookmarks:[{chapter:1,offset:.3,title:'Section 2',created:1}]};
  const restored=await restoreLocalBook(missing,{name:'catalog.txt',bytes},[{...rule,enable:false}]);
  expect(restored.chapters).toEqual(imported.chapters);
  expect(restored).toMatchObject({id:imported.id,name:'Saved title',author:'Saved author',chapter:1,offset:.65,txtTocRuleId:901,bookmarks:missing.bookmarks});
  expect(restored.rawText).toBe(imported.rawText);
});
it('does not lose paragraphs that look like chapter headings when no matching TXT rule is enabled',async()=>{
  const bytes=strToU8('第一章 开始\n第一章中仍然是正文。\n第二章 继续\n第二章中也是正文。');
  const imported=await importLocalBook(bytes,'public.txt',[]);
  const restored=await restoreLocalBook({...imported,chapters:[]},{name:'public.txt',bytes},[]);
  expect(restored.chapters).toEqual([{title:'正文',content:new TextDecoder().decode(bytes),wordCount:new TextDecoder().decode(bytes).length+'字'}]);
});
it('clamps obsolete legacy chapter anchors and preserves the book identity and annotations',async()=>{
  const bytes=strToU8('Section 1\n正文'),imported=await importLocalBook(bytes,'short.txt',[rule]);
  const missing={...imported,chapters:[],legacyPosition:{chapter:12,position:450,indent:2,titleVisible:true},offset:.8,syncPosition:{chapter:12,position:450}};
  const restored=await restoreLocalBook(missing,{name:'short.txt',bytes},[rule]);
  expect(restored).toMatchObject({id:imported.id,chapter:0,offset:0,legacyPosition:{chapter:0,position:0}});
  expect(restored.syncPosition).toBeUndefined();expect(missing.legacyPosition.chapter).toBe(12);
});
it('recognizes EPUB restored through a legacy TXT book entry without overwriting saved metadata',async()=>{
  const epub=zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),'book.opf':strToU8('<package><metadata/><manifest><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="a"/></spine></package>'),'a.xhtml':strToU8('<h1>EPUB chapter</h1><p>Public content</p>')});
  const before=await importLocalBook(strToU8('temporary'),'placeholder.txt',[]);
  const restored=await restoreLocalBook({...before,name:'Saved EPUB title',chapters:[]},{name:'book.epub',bytes:epub},[]);
  expect(restored).toMatchObject({id:before.id,name:'Saved EPUB title',kind:'epub',localFileName:'book.epub'});
  expect(restored.chapters[0].content).toContain('Public content');
});
