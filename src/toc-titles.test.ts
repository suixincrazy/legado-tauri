import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {newBook,DEFAULT_SETTINGS,type Book} from './model';
import {applyReplacement,bookUsesReplace,newReplaceRule,replaceText,type ReplaceRule} from './replacement';
import {tocDisplayTitles,tocTitleRules} from './toc-titles';

const options={...DEFAULT_SETTINGS,tocUiUseReplace:true};
const rule=(extra:Partial<ReplaceRule>={}):ReplaceRule=>({...newReplaceRule(),id:1,name:'Public',pattern:'Raw',replacement:'Clean',isRegex:false,scopeTitle:true,scopeContent:false,...extra});
let seen:any[];
beforeEach(()=>{
  seen=[];
  class RuleWorker {onmessage?:(event:{data:unknown})=>void;postMessage(data:any){seen.push(data);queueMicrotask(()=>{try{this.onmessage?.({data:{text:replaceText(data.text,data.rule)}});}catch{this.onmessage?.({data:{error:'Invalid pattern'}});}});}terminate(){}}
  vi.stubGlobal('Worker',RuleWorker);
});
afterEach(()=>vi.unstubAllGlobals());
it('converts before ordered title rules, retains nonblank fallback and preserves every original field',async()=>{
  const book={...newBook('Public','txt',[{title:'卷\r\n閱讀',isVolume:true,index:7},{title:'Raw 閱讀',url:'/one',content:'Public raw body.',wordCount:'12字',index:42}]),chapter:1,offset:.25,bookmarks:[{chapter:1,offset:.25,title:'Keep',created:1}]},before=structuredClone(book);
  const rules=[rule({id:2,order:2,pattern:'读书',replacement:'\u0085',isRegex:true}),rule({id:1,order:1,pattern:'阅读',replacement:'读书'}),rule({id:3,order:3,pattern:'.+',replacement:'　 ',isRegex:true}),rule({id:4,order:4,pattern:'Raw',replacement:'Final'})];
  const result=await tocDisplayTitles(book,rules,{...options,chineseConversion:'simple'});
  expect(result).toEqual({titles:['卷\u0085','Final \u0085'],failedRules:[]});
  expect(seen.find(d=>d.text.startsWith('Raw'))?.context.chapter.index).toBe(42);
  expect(book).toEqual(before);
  expect((await tocDisplayTitles(book,rules,{...options,tocUiUseReplace:false,chineseConversion:'simple'})).titles).toEqual(['卷阅读','Raw 阅读']);
});
it('uses the global and per-book gates, EPUB defaults, imported image types, and explicit overrides',async()=>{
  const book=newBook('Public','txt',[{title:'Raw'}]);
  expect(bookUsesReplace(book,true)).toBe(true);expect(bookUsesReplace(book,false)).toBe(false);
  expect((await tocDisplayTitles(book,[rule()],{...options,replaceEnableDefault:false})).titles).toEqual(['Raw']);
  for(const item of [{...book,kind:'epub' as const},{...book,useReplaceRule:false},{...book,legacy:{type:64}} as Book,{...book,legacy:{type:256,originName:'public.EPUB'}} as Book]){
    expect(bookUsesReplace(item,true)).toBe(false);
    expect((await tocDisplayTitles(item,[rule()],options)).titles).toEqual(['Raw']);
    expect((await tocDisplayTitles({...item,useReplaceRule:true},[rule()],options)).titles).toEqual(['Clean']);
  }
});
it('matches fixed upstream SQLite title scope semantics including ASCII case, exclusions and wildcards',()=>{
  const book={...newBook('Public_Book','online',[{title:'Raw'}]),sourceUrl:'https://source.test'};
  const rules=[rule({id:1,scope:'PUBLICxBOOK'}),rule({id:2,scope:'elsewhere'}),rule({id:3,scope:'HTTPS://SOURCE.TEST',order:-1}),rule({id:4,excludeScope:'PUBLICxBOOK'}),rule({id:5,isEnabled:false}),rule({id:6,scopeTitle:false}),rule({id:7,scope:'',excludeScope:''})];
  const code="import json,sqlite3,sys\nx=json.loads(sys.stdin.read());db=sqlite3.connect(':memory:');db.execute('create table rules (id,isEnabled,scopeTitle,scope,excludeScope,sortOrder)');db.executemany('insert into rules values (?,?,?,?,?,?)',x['rows']);print(json.dumps([r[0] for r in db.execute(\"select id from rules where isEnabled=1 and scopeTitle=1 and (scope like '%'||?||'%' or scope like '%'||?||'%' or scope is null or scope='') and (excludeScope is null or (excludeScope not like '%'||?||'%' and excludeScope not like '%'||?||'%')) order by sortOrder\",x['args'])]))";
  for(const current of [book,{...book,name:'Public%Book'},{...book,sourceUrl:''}]){
    const result=spawnSync(process.platform==='win32'?'python':'python3',['-X','utf8','-B','-c',code],{encoding:'utf8',input:JSON.stringify({rows:rules.map(r=>[r.id,r.isEnabled,r.scopeTitle,r.scope??null,r.excludeScope??null,r.order]),args:[current.name,current.sourceUrl,current.name,current.sourceUrl]})});
    expect(result.status,result.stderr).toBe(0);expect(tocTitleRules(rules,current).map(r=>r.id)).toEqual(JSON.parse(result.stdout));
  }
});
it('skips malformed and empty patterns, keeps each blank result out of the pipeline and reports failures',async()=>{
  const book=newBook('Public','online',[{title:'Raw'}]),rules=[rule({id:1,pattern:'[',isRegex:true}),rule({id:2,pattern:''}),rule({id:3,pattern:'.+',replacement:'\u001c',isRegex:true}),rule({id:4})];
  expect(await tocDisplayTitles(book,rules,options)).toEqual({titles:['Clean'],failedRules:[1]});
  expect(await applyReplacement('Raw',[rule({replacement:''})])).toBe('');
});
it('publishes the current chapter first, supplies stable original indexes and stops between chapters',async()=>{
  const book={...newBook('Public','txt',[{title:'Raw 0',index:70},{title:'Raw 1',index:80},{title:'Raw 2',index:90}]),chapter:2},abort=new AbortController(),published:string[][]=[];
  const out=await tocDisplayTitles(book,[rule({isRegex:true})],options,abort.signal,value=>{published.push(value.titles);if(value.titles[2]==='Clean 2')abort.abort();});
  expect(out.titles).toEqual(['Raw 0','Raw 1','Clean 2']);expect(seen).toHaveLength(1);expect(seen[0].context.chapter.index).toBe(90);expect(published.at(-1)?.[2]).toBe('Clean 2');
});
