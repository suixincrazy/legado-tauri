import 'fake-indexeddb/auto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {WebDav,parseDavList,davRoot} from './webdav';
import {zipSync,strToU8} from 'fflate';

let server:Server,origin:string;const files=new Map<string,Uint8Array>(),directories=new Set(['/','/dav/']);
const xml=(root:string)=>`<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>${root}</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>${[...files].filter(([name])=>name.startsWith(root)).map(([name,bytes])=>`<response><href>${name}</href><propstat><prop><getcontentlength>${bytes.length}</getcontentlength><getlastmodified>Wed, 25 Nov 2026 12:00:00 GMT</getlastmodified></prop><status>HTTP/1.1 200 OK</status></propstat></response>`).join('')}</multistatus>`;
beforeAll(async()=>{
  server=createServer(async(req,res)=>{
    if(req.headers.authorization!=='Basic '+Buffer.from('fixture:fixture-password').toString('base64')){res.writeHead(401).end();return;}
    const path=req.url!;
    if(req.method==='PROPFIND'){res.writeHead(directories.has(path)?207:404,{'Content-Type':'application/xml'}).end(xml(path));return;}
    if(req.method==='MKCOL'){directories.add(path);res.writeHead(201).end();return;}
    if(req.method==='PUT'){const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);files.set(path,new Uint8Array(Buffer.concat(chunks)));res.writeHead(201).end();return;}
    if(req.method==='DELETE'){files.delete(path);res.writeHead(204).end();return;}
    if(req.method==='GET'||req.method==='HEAD'){const bytes=files.get(path);res.writeHead(bytes?200:404);res.end(req.method==='GET'&&bytes?Buffer.from(bytes):undefined);return;}
    res.writeHead(405).end();
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address()as any).port}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
it('creates nested Unicode directories and transfers a ZIP byte-for-byte through actual WebDAV HTTP methods',async()=>{
  const dav=new WebDav({url:origin+'/dav',username:'fixture',password:'fixture-password',directory:'阅读/备份',keepCount:0});
  const bytes=zipSync({'legado-tauri.json':strToU8(JSON.stringify({text:'正文𠮷',content:[0,255,128]}))});
  await dav.upload('backup2026-11-26-test.zip',bytes);
  const list=await dav.list();expect(list.map(file=>file.name)).toEqual(['backup2026-11-26-test.zip']);
  expect(await dav.download(list[0].name)).toEqual(bytes);
  await dav.remove(list[0].name);expect(await dav.list()).toEqual([]);
});
it('reports authentication failures without echoing credentials or writing a backup',async()=>{
  const dav=new WebDav({url:origin+'/dav/',username:'fixture',password:'wrong-secret',directory:'',keepCount:0});
  await expect(dav.upload('backup.zip',new Uint8Array([1]))).rejects.toThrow('401');expect(files.size).toBe(0);
});
it('prunes only this device after a successful upload and accounts for a stale directory listing',async()=>{
  const deleted:string[]=[];const dav=new WebDav({url:'https://dav.example.test/',username:'a',password:'b',directory:'',keepCount:1},async req=>{
    if(req.method==='PROPFIND')return {status:207,text:'<d:multistatus xmlns:d="DAV:">'+['backup2026-11-24-ipad.zip','backup2026-11-25-phone.zip'].map(name=>`<d:response><d:href>/${name}</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')+'</d:multistatus>'};
    if(req.method==='DELETE')deleted.push(req.url);return {status:201,text:''};
  });
  await dav.upload('backup2026-11-26-ipad.zip',new Uint8Array([1]));expect(deleted).toEqual(['https://dav.example.test/backup2026-11-24-ipad.zip']);
});
it('rejects cross-origin and parent-directory entries, XML errors, and path traversal',()=>{
  const item=(href:string)=>`<d:response><d:href>${href}</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  expect(parseDavList(`<d:multistatus xmlns:d="DAV:">${item('https://other.example.test/dav/backup.zip')}${item('/backup.zip')}${item('/dav/%2e%2e%2fbackup.zip')}${item('/dav/backup%26one.zip')}</d:multistatus>`,'https://dav.example.test/dav/').map(row=>row.name)).toEqual(['backup&one.zip']);
  expect(()=>parseDavList('<html>login</html>','https://dav.example.test/')).toThrow('文件列表');
  expect(()=>davRoot({url:'https://dav.example.test',username:'',password:'',directory:'../other',keepCount:0})).toThrow('子目录');
});
