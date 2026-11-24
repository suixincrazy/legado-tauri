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
 }finally{await vm.close();child.kill();Object.defineProperty(navigator,'userAgent',{value:originalAgent,configurable:true})}
},15000)

it('waits for Android browser verification and uses the returned cookie in the retry',async()=>{
 const originalAgent=navigator.userAgent; Object.defineProperty(navigator,'userAgent',{value:'Android',configurable:true});
 vi.mocked(invoke).mockImplementation(async(_command,args:any)=>{
  const request=JSON.parse(args.payload);
  return {json:JSON.stringify({value:request.operation==='browser'?{url:'https://login.test/book',body:'已登录',status:200,cookie:'sid=fixture'}:null})};
 });
 const request=vi.fn(async req=>({url:req.url,body:'登录后的正文',status:200}));
 const vm=new SourceRuntime({bookSourceUrl:'https://login.test',bookSourceName:'Login'},{},request);
 try {
  await vm.initialize();
  expect(await vm.evaluate('java.startBrowserAwait("https://login.test/book", "书源验证").body()')).toBe('登录后的正文');
  expect(request.mock.calls[0][0].headers.Cookie).toBe('sid=fixture');
 }finally{await vm.close();Object.defineProperty(navigator,'userAgent',{value:originalAgent,configurable:true})}
});


