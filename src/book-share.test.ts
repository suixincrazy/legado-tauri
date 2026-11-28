import 'fake-indexeddb/auto';
import {afterEach,expect,it,vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {newBook,type Book,type BookGroup,type Source} from './model';
import {bookShareMetadata,callbackIsTrue,shareBookDetails} from './book-share';
import * as storage from './storage';
import {parseShelfRows} from './legacy-book-groups';

const native=vi.hoisted(()=>({enabled:false}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>native.enabled,invoke:vi.fn()}));
const source:Source={bookSourceUrl:'https://share.test',bookSourceName:'Public source',eventListener:true};
const fixture=():Book=>({...newBook('Public <&> 𠮷','online',[{title:'One',content:'CACHED_BODY',originalContent:'ORIGINAL_BODY'},{title:'Two',content:'SECOND_BODY'}],'Author'),url:'https://share.test/book#part',sourceUrl:source.bookSourceUrl,tocUrl:'https://share.test/toc',intro:'Intro <&>',chapter:1,offset:.4,lastRead:17,added:18,groups:['legado-group-1','legado-group-4611686018427387904'],syncPosition:{chapter:1,position:23},variables:{token:'public'},bookmarks:[{chapter:1,offset:.4,title:'PRIVATE_MARK',created:1}],rawText:'RAW_FILE',legacy:{unknown:{cached:'PRIVATE_UNKNOWN'},readConfig:{tocExpanded:false,unknown:'PRIVATE_CONFIG'},coverUrl:'https://cover.test/source',customCoverUrl:'https://cover.test/custom'}});
const groups:BookGroup[]=['1','4611686018427387904','-9223372036854775808'].map(id=>({id:'legado-group-'+id,name:id,order:0,show:true,enableRefresh:true}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks();native.enabled=false;});
function browser(share=vi.fn().mockResolvedValue(undefined)){const copy=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{share,clipboard:{writeText:copy},userAgent:'browser'});return {share,copy};}
function code(body:string):Source{return {...source,ruleContent:{callBackJs:body}};}

it('shares only original metadata with pretty Unicode text and exact 64-bit groups, without mutating books',async()=>{
  const book=fixture(),before=JSON.stringify(book),{share,copy}=browser();
  const result=await shareBookDetails(book,groups,source);
  expect(result.status).toBe('opened');expect(result.text.startsWith(book.url+'#{\n')).toBe(true);
  const data=parseShelfRows('['+result.text.slice(book.url!.length+1)+']','group')[0];
  expect(data).toMatchObject({bookUrl:book.url,tocUrl:book.tocUrl,origin:source.bookSourceUrl,originName:source.bookSourceName,name:book.name,intro:book.intro,group:'4611686018427387905',totalChapterNum:2,durChapterIndex:1,durChapterPos:23,durChapterTime:17,latestChapterTitle:'Two',readConfig:{tocExpanded:false},variable:'{"token":"public"}'});
  expect(result.text).toContain('Public <&> 𠮷');expect(result.text).not.toMatch(/CACHED_BODY|ORIGINAL_BODY|SECOND_BODY|PRIVATE_|RAW_FILE|bookmarks|highlights|variables|rawText/);
  expect(share).toHaveBeenCalledExactlyOnceWith({title:book.name,text:result.text});expect(copy).not.toHaveBeenCalled();expect(JSON.stringify(book)).toBe(before);
  book.groups!.push(groups[2].id);expect(parseShelfRows('['+JSON.stringify(bookShareMetadata(book,groups))+']','group')[0].group).toBe('-4611686018427387903');
});
it('preserves unloaded original positions, explicit source/custom fields and known read configuration',()=>{
  const book={...fixture(),chapters:[],chapter:0,cover:'https://cover.test/custom',intro:'Custom',legacyPosition:{chapter:37,position:91,indent:2,titleVisible:true},legacy:{...fixture().legacy,totalChapterNum:73,durChapterTitle:'Original position',intro:'Source',customIntro:'Custom',kind:'Fiction',wordCount:'5万字',readConfig:JSON.stringify({tocExpanded:false,reSegment:true,delTag:8,paragraphAnchor:{chapterUrl:'a',itemId:'b',chapterPosition:8,body:'omit'},unknown:'omit'})}};
  const shared=bookShareMetadata(book,groups);expect(shared).toMatchObject({durChapterIndex:37,durChapterPos:91,totalChapterNum:73,durChapterTitle:'Original position',coverUrl:'https://cover.test/source',customCoverUrl:book.cover,intro:'Source',customIntro:'Custom',kind:'Fiction',wordCount:'5万字',readConfig:{tocExpanded:false,reSegment:true,delTag:8,paragraphAnchor:{chapterUrl:'a',itemId:'b',chapterPosition:8}}});
  expect(bookShareMetadata({...book,intro:'Edited',cover:'Edited cover',reSegment:false},groups)).toMatchObject({intro:'Source',customIntro:'Edited',coverUrl:'https://cover.test/source',customCoverUrl:'Edited cover',readConfig:{reSegment:false}});
  expect(bookShareMetadata({...fixture(),syncPosition:{chapter:0,position:91}},groups).durChapterPos).toBe(0);
});
it('shares local metadata with the real legacy path or empty address, without embedding TXT or EPUB data',async()=>{
  browser();
  for(const kind of ['txt','epub'] as const){const book={...fixture(),kind,url:undefined,sourceUrl:undefined,localFileName:'Public.'+kind,legacy:undefined};const result=await shareBookDetails(book,groups);const data=JSON.parse(result.text.slice(1));expect(result.text.startsWith('#{')).toBe(true);expect(data).toMatchObject({bookUrl:'',origin:'loc_book',originName:'Public.'+kind,type:264});expect(result.text).not.toContain(book.id);}
  expect(bookShareMetadata({...fixture(),kind:'txt',url:'/storage/public.txt',legacy:{origin:'loc_book',type:776}},groups)).toMatchObject({bookUrl:'/storage/public.txt',origin:'loc_book',type:776});
});
it('matches the upstream Kotlin string truthiness, including exact null and the original regex',()=>{
  for(const value of ['', ' ','null','false',' FALSE ','\tno\n','Not','0','0.0','0x0','\u2007no\u2007'])expect(callbackIsTrue(value),value).toBe(false);
  for(const value of [' null ','NULL','undefined','[]','{}','true','1','0.00','\uFEFF'])expect(callbackIsTrue(value),value).toBe(true);
});
it('runs real callbacks with complete text, original book fields, null chapter and source variable semantics',async()=>{
  const {share}=browser(),book=fixture(),before=JSON.stringify(book);
  const callback=code('if(event!=="clickShareBook"||chapter!==null||book.bookUrl!=="https://share.test/book#part"||book.getVariable("token")!=="public"||result.indexOf(book.bookUrl+"#{\\n")!==0)throw Error("bindings");book.name="mutated";book.putVariable("token","changed");java.put("shareEvent",event);java.get("shareEvent")==="clickShareBook"?"true":"false";');
  const result=await shareBookDetails(book,groups,callback);expect(result.status).toBe('handled');expect(share).not.toHaveBeenCalled();expect(JSON.stringify(book)).toBe(before);
  expect((await storage.sourceState(source.bookSourceUrl))['source:shareEvent'].value).toBe('clickShareBook');
});
it('allows default sharing for false callback strings and uses the text captured before callback changes',async()=>{
  const {share}=browser(),book=fixture();
  for(const value of ['false','no','not','0','0.0','null',' ']){
    const result=await shareBookDetails(book,groups,code('result="modified";book.name="modified";'+JSON.stringify(value)));
    expect(result.status,value).toBe('opened');expect(result.text).not.toContain('modified');
  }
  expect(share).toHaveBeenCalledTimes(7);
});
it('handles library callbacks, numeric SQLite flags, undefined results, and explicit callback copying',async()=>{
  const {share,copy}=browser(),book=fixture();
  const result=await shareBookDetails(book,groups,{...code('java.copyText(prefix+book.name);undefined'),jsLib:'var prefix="Copy: ";',eventListener:1});
  expect(result.status).toBe('handled');expect(copy).toHaveBeenCalledExactlyOnceWith('Copy: '+book.name);expect(share).not.toHaveBeenCalled();
});
it('bypasses callbacks only when source, listener or script is absent and blocks default sharing on script failure',async()=>{
  const {share}=browser(),book=fixture(),broken=code('throw Error("Public failure")');
  for(const s of [undefined,{...broken,eventListener:false},{...broken,eventListener:'false'},{...source,ruleContent:{callBackJs:''}}])expect((await shareBookDetails(book,groups,s)).status).toBe('opened');
  await expect(shareBookDetails(book,groups,broken)).rejects.toThrow('Public failure');expect(share).toHaveBeenCalledTimes(4);
});
it('preserves cancellation, previews unsupported or rejected web sharing, and propagates native errors',async()=>{
  const {share,copy}=browser(vi.fn().mockRejectedValue(new DOMException('Cancelled','AbortError'))),book=fixture();
  expect((await shareBookDetails(book,groups)).status).toBe('cancelled');
  share.mockRejectedValueOnce(new Error('Permission denied'));expect((await shareBookDetails(book,groups)).status).toBe('preview');
  vi.stubGlobal('navigator',{clipboard:{writeText:copy}});expect((await shareBookDetails(book,groups)).status).toBe('preview');expect(copy).not.toHaveBeenCalled();
  native.enabled=true;vi.mocked(invoke).mockResolvedValueOnce({json:'{"error":"Native failure"}'});
  await expect(shareBookDetails(book,groups)).rejects.toThrow('Native failure');
});
