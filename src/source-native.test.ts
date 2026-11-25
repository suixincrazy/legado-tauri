import 'fake-indexeddb/auto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import {it,expect,vi} from 'vitest';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:vi.fn()}));
import {invoke} from '@tauri-apps/api/core';
import {SourceRuntime} from './source-runtime';
it.skipIf(!process.env.LEGADO_JAVA_CP)('crosses QuickJS and actual Rhino JVM bridge',async()=>{
 const originalAgent=navigator.userAgent; Object.defineProperty(navigator,'userAgent',{value:'Android',configurable:true});
 const java=process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java') : 'java';
 const child=spawn(java,['-cp',process.env.LEGADO_JAVA_CP!,'JavaBridgeContractTest','serve']);
 const pending:Array<(line:string)=>void>=[];readline.createInterface({input:child.stdout}).on('line',line=>pending.shift()?.(line));
 vi.mocked(invoke).mockImplementation(async(_command,args:any)=>({json:await new Promise<string>(resolve=>{pending.push(resolve);child.stdin.write(args.payload+'\n')})}));
 const vm=new SourceRuntime({bookSourceName:'Native',bookSourceUrl:'https://native.test'});
 try {
 await vm.initialize();
 expect(await vm.evaluate('Packages.cn.hutool.crypto.digest.DigestUtil.md5Hex("abc")')).toBe('900150983cd24fb0d6963f7d28e17f72');
 expect(await vm.rule('<li><a href="/a">native book</a></li>','@js:org.jsoup.Jsoup.parse(result).select("li").get(0).text()')).toBe('native book');
 const rows=await vm.rule('<li><a href="/a">native book</a></li>','@js:org.jsoup.Jsoup.parse(result).select("li")',true);
 expect(rows).toHaveLength(1);expect(await vm.rule(rows[0],'a@href')).toBe('/a');
 expect(await vm.evaluate('importClass(Packages.org.jsoup.Jsoup); Jsoup.parse("<b>imported</b>").text()')).toBe('imported');
 const anchors=await vm.rule('<a href="/chapter">Chapter</a>','@js:org.jsoup.Jsoup.parse(result).select("a")',true); expect(await vm.rule(anchors[0],'href')).toBe('/chapter');
 expect(await vm.evaluate('var i=new JavaImporter(Packages.java.util,Packages.java.lang);with(i){String(Base64.getDecoder().decode("YWJj"));}')).toBe('abc');
 expect(await vm.evaluate('var jp=new JavaImporter(Packages.com.jayway.jsonpath);with(jp){var rd=JsonPath.using(Configuration.builder().options(Option.SUPPRESS_EXCEPTIONS).build()).parse(\'{"data":{"meaning":"native definition"}}\');String(rd.read("$.data.meaning"));}')).toBe('native definition');
 expect(await vm.evaluate('var dom=new JavaImporter(Packages.org.jsoup.nodes.Element,Packages.org.jsoup.Jsoup);with(dom){new Element("a").attr("href","/dict").text("native link").outerHtml();}')).toBe('<a href="/dict">native link</a>');
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


