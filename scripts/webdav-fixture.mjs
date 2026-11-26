// Public test data only. This in-memory server never persists or prints request bodies.
import {createServer} from 'node:http';
const port=Number(process.env.LEGADO_DAV_PORT||18786),files=new Map(),directories=new Set(['/dav/']),calls={};
const xml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;');
const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','authorization,content-type,depth');res.setHeader('Access-Control-Allow-Methods','GET,HEAD,PUT,PROPFIND,MKCOL,DELETE,OPTIONS');
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  if(req.url==='/fixture-status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({calls,files:[...files].map(([name,value])=>({name,bytes:value.bytes.length}))}));return;}
  if(req.headers.authorization!=='Basic '+Buffer.from('fixture:fixture-password').toString('base64')){res.writeHead(401).end();return;}
  calls[req.method]=(calls[req.method]||0)+1;
  const path=req.url;
  if(req.method==='PROPFIND'){
    if(!directories.has(path)){res.writeHead(404).end();return;}
    const rows=[...files].filter(([name])=>name.startsWith(path)&&!name.slice(path.length).includes('/'));
    res.writeHead(207,{'Content-Type':'application/xml'}).end('<d:multistatus xmlns:d="DAV:">'+rows.map(([name,item])=>`<d:response><d:href>${xml(name)}</d:href><d:propstat><d:prop><d:getcontentlength>${item.bytes.length}</d:getcontentlength><d:getlastmodified>${item.date}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')+'</d:multistatus>');return;
  }
  if(req.method==='MKCOL'){directories.add(path);res.writeHead(201).end();return;}
  if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);files.set(path,{bytes:Buffer.concat(chunks),date:new Date().toUTCString()});res.writeHead(201).end();return;}
  if(req.method==='DELETE'){files.delete(path);res.writeHead(204).end();return;}
  const entry=files.get(path);if(entry){res.setHeader('Content-Length',entry.bytes.length);res.setHeader('Content-Type','application/octet-stream');}res.writeHead(entry?200:404);res.end(req.method==='GET'?entry?.bytes:undefined);
});
server.listen(port,'127.0.0.1',()=>console.log(`WebDAV public fixture listening on 127.0.0.1:${port}`));
