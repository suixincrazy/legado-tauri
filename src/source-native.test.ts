import 'fake-indexeddb/auto';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {it,expect,vi} from 'vitest';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:vi.fn()}));
import {invoke} from '@tauri-apps/api/core';
import {SourceRuntime} from './source-runtime';
import {defaultDictRules,queryDictionary} from './dictionary';
import {fetchText} from './network';
import {applyReplacement,newReplaceRule} from './replacement';
import {newBook} from './model';
it.skipIf(!process.env.LEGADO_JAVA_CP)('crosses QuickJS and actual Rhino JVM bridge',async()=>{
 const originalAgent=navigator.userAgent; Object.defineProperty(navigator,'userAgent',{value:'Android',configurable:true});
 const java=process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java') : 'java';
 const child=spawn(java,['-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-Dstderr.encoding=UTF-8','-cp',process.env.LEGADO_JAVA_CP!,'JavaBridgeContractTest','serve']);
 const pending:Array<(line:string)=>void>=[];readline.createInterface({input:child.stdout}).on('line',line=>pending.shift()?.(line));
 vi.mocked(invoke).mockImplementation(async(_command,args:any)=>({json:await new Promise<string>(resolve=>{pending.push(resolve);child.stdin.write(args.payload+'\n')})}));
 const vm=new SourceRuntime({bookSourceName:'Native',bookSourceUrl:'https://native.test'});
 try {
 await vm.initialize();
 expect(await applyReplacement('ABC abc',[{...newReplaceRule(),pattern:'(?i)abc',replacement:'净化'}])).toBe('净化 净化');
 const jsRule={...newReplaceRule(),pattern:'(?i)([a-z])(\\d+)',replacement:'@js:java.put("count",String(Number(java.get("count")||0)+1)); result.toLowerCase()+":"+java.get("count")'};
 expect(await applyReplacement('A1 B22',[jsRule])).toBe('a1:1 b22:2');
 expect(await applyReplacement('A1 B22',[{...jsRule,replacement:'@js:result.startsWith("A") ? "$2\\\\path" : "[$1]"'}])).toBe('1\\path [B]');
 const chapter={title:'章',index:4},book=newBook('上下文','txt',[chapter]);
 expect(await applyReplacement('A1',[{...jsRule,replacement:'@js:book.name+chapter.title+chapter.index+result'}],undefined,undefined,{book,chapter})).toBe('上下文章4A1');
 await expect(applyReplacement('A1',[{...jsRule,timeoutMillisecond:100,replacement:'@js:while(true){}'}])).rejects.toThrow();
 expect(await applyReplacement('A1',[{...jsRule,isRegex:false,pattern:'A1',replacement:'@js:literal'}])).toBe('@js:literal');
 if(process.env.LEGADO_PRIVATE_REPLACEMENT){
  const input=JSON.parse(readFileSync(process.env.LEGADO_PRIVATE_REPLACEMENT,'utf8'));
  const expected=JSON.parse(readFileSync(process.env.LEGADO_PRIVATE_REPLACEMENT_REFERENCE!,'utf8'));
  const failed:number[]=[];
  const output=await applyReplacement(input.text,input.rules,undefined,rule=>failed.push(input.rules.indexOf(rule)));
  expect(output===expected.text).toBe(true);
  expect(JSON.stringify(failed)===JSON.stringify(expected.errors.map((error:{index:number})=>error.index))).toBe(true);
 }
 expect(await vm.evaluate('Packages.cn.hutool.crypto.digest.DigestUtil.md5Hex("abc")')).toBe('900150983cd24fb0d6963f7d28e17f72');
 expect(await vm.rule('<li><a href="/a">native book</a></li>','@js:org.jsoup.Jsoup.parse(result).select("li").get(0).text()')).toBe('native book');
 const rows=await vm.rule('<li><a href="/a">native book</a></li>','@js:org.jsoup.Jsoup.parse(result).select("li")',true);
 expect(rows).toHaveLength(1);expect(await vm.rule(rows[0],'a@href')).toBe('/a');
 expect(await vm.evaluate('importClass(Packages.org.jsoup.Jsoup); Jsoup.parse("<b>imported</b>").text()')).toBe('imported');
 const anchors=await vm.rule('<a href="/chapter">Chapter</a>','@js:org.jsoup.Jsoup.parse(result).select("a")',true); expect(await vm.rule(anchors[0],'href')).toBe('/chapter');
 expect(await vm.evaluate('var i=new JavaImporter(Packages.java.util,Packages.java.lang);with(i){String(Base64.getDecoder().decode("YWJj"));}')).toBe('abc');
 expect(await vm.evaluate('var jp=new JavaImporter(Packages.com.jayway.jsonpath);with(jp){var rd=JsonPath.using(Configuration.builder().options(Option.SUPPRESS_EXCEPTIONS).build()).parse(\'{"data":{"meaning":"native definition"}}\');String(rd.read("$.data.meaning"));}')).toBe('native definition');
 expect(vi.mocked(invoke).mock.calls.some(([,args])=>JSON.parse((args as {payload:string}).payload).name==='com.jayway.jsonpath.JsonPath')).toBe(true);
 expect(await vm.evaluate('Packages.com.jayway.jsonpath.JsonPath.parse(\'{"data":{"meaning":"map result"}}\').read("$.data").meaning')).toBe('map result');
 expect(await vm.evaluate('var map=Packages.com.jayway.jsonpath.JsonPath.parse(\'{"data":{"meaning":"map result"}}\').read("$.data");map.get("meaning")')).toBe('map result');
 expect(await vm.evaluate('var dom=new JavaImporter(Packages.org.jsoup.nodes.Element,Packages.org.jsoup.Jsoup);with(dom){new Element("a").attr("href","/dict").text("native link").outerHtml();}')).toBe('<a href="/dict">native link</a>');
 const dictionary=await queryDictionary(defaultDictRules.find(rule=>rule.name==='百度汉语')!,'一心',async request=>request.url.startsWith('data:')?fetchText(request):({url:request.url,body:JSON.stringify({data:{idiomVersion:'1',pinyin:'yi xin',story:[],definitionInfo:{definition:'原生词典释义',detailMeans:[{word:'甲',definition:'乙'}]},baobian:'',chuChu:[],baikeInfo:[]}})}));
 expect(dictionary).toContain('原生词典释义');expect(dictionary).toContain('甲：乙');expect(dictionary).not.toContain('undefined');expect(dictionary).not.toContain('成语故事');
 }finally{await vm.close();child.kill();Object.defineProperty(navigator,'userAgent',{value:originalAgent,configurable:true})}
},15000)

it('waits for Android browser verification and uses the returned cookie in the retry',async()=>{
 const originalAgent=navigator.userAgent; Object.defineProperty(navigator,'userAgent',{value:'Android',configurable:true});
 vi.mocked(invoke).mockImplementation(async(command)=>{
  return {json:JSON.stringify({value:command==='source_browser'?{url:'https://login.test/book',body:'已登录',status:200,cookie:'sid=fixture'}:null})};
 });
 const request=vi.fn(async req=>({url:req.url,body:'登录后的正文',status:200}));
 const vm=new SourceRuntime({bookSourceUrl:'https://login.test',bookSourceName:'Login'},{},request);
 try {
  await vm.initialize();
  expect(await vm.evaluate('java.startBrowserAwait("https://login.test/book", "书源验证").body()')).toBe('登录后的正文');
  expect(request.mock.calls[0][0].headers.Cookie).toBe('sid=fixture');
 }finally{await vm.close();Object.defineProperty(navigator,'userAgent',{value:originalAgent,configurable:true})}
});

it('routes iOS browser preloads separately from extraction and stores redirect cookies',async()=>{
 vi.mocked(invoke).mockImplementation(async()=>({json:JSON.stringify({value:{url:'https://redirect.test/ok',body:'page',status:200,cookies:{'https://login.test/start':'first=1','https://redirect.test/ok':'second=2'}}})}));
 const vm=new SourceRuntime({bookSourceUrl:'https://ios-browser.test',bookSourceName:'iOS browser'});
 try {
  await vm.initialize(); await vm.evaluate('java.showBrowser("https://login.test/start", null, "window.ready=true")');
  const call=[...vi.mocked(invoke).mock.calls].reverse().find(c=>c[0]==='source_browser');
  expect(call?.[1]).toMatchObject({request:{preloadJs:'window.ready=true'}});
  expect((call?.[1] as any).request.js).toBeUndefined();
  expect(await vm.evaluate('cookie.getCookie("https://redirect.test/next")')).toBe('second=2');
 }finally{await vm.close()}
});


