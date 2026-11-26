import 'fake-indexeddb/auto';
import {beforeEach,expect,it,vi} from 'vitest';
import {davRequest,pickLegacyBackupFiles} from './backup-transport';
const bridge=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:bridge.call}));
beforeEach(()=>{bridge.call.mockReset();});
it('stages binary uploads in bounded messages and removes the temporary file on HTTP failure',async()=>{
  bridge.call.mockImplementation(async(_name,{request})=>({status:request.operation==='request'?507:200,body:'',size:0}));
  const bytes=new Uint8Array(700000);bytes[0]=255;bytes[699999]=128;
  const result=await davRequest({url:'https://dav.example.test/backup.zip',method:'PUT',headers:{},body:bytes});
  expect(result.status).toBe(507);
  const requests=bridge.call.mock.calls.map(([,payload])=>payload.request),writes=requests.filter(request=>request.operation==='write');
  expect(writes.map(request=>request.offset)).toEqual([0,262144,524288]);expect(writes.every(request=>request.hex.length<=524288)).toBe(true);
  expect(writes[0].hex.slice(0,2)).toBe('ff');expect(writes.at(-1).hex.slice(-2)).toBe('80');
  expect(requests.find(request=>request.operation==='request').body).toBeUndefined();expect(requests.at(-1).operation).toBe('discard');
});
it('reads only recognized files from a selected legacy folder and leaves cancellation unchanged',async()=>{
  const raw=new TextEncoder().encode('[{"bookSourceName":"Fixture","bookSourceUrl":"https://fixture.test"}]');
  bridge.call.mockImplementation(async(name,args)=>{
    if(name==='source_browser'||name==='java_bridge')return{json:JSON.stringify({value:'bookmark:public-fixture'})};
    const r=args.request;
    if(r.operation==='legacyList')return{status:200,size:0,body:JSON.stringify({files:[{name:'myBookSource.json',size:raw.length},{name:'unrelated.json',size:100}]})};
    if(r.operation==='localLoad')return{status:200,body:'',size:raw.length};
    if(r.operation==='read')return{status:200,body:Array.from(raw,n=>n.toString(16).padStart(2,'0')).join(''),size:raw.length};
    return{status:200,body:'',size:0};
  });
  const files=await pickLegacyBackupFiles();expect(Object.keys(files!)).toEqual(['myBookSource.json']);expect(Array.from(files!['myBookSource.json'])).toEqual(Array.from(raw));
  expect(bridge.call.mock.calls.filter(([,payload])=>payload.request?.operation==='localLoad').map(([,payload])=>payload.request.name)).toEqual(['myBookSource.json']);
  bridge.call.mockReset();bridge.call.mockResolvedValue({json:'{"value":null}'});
  expect(await pickLegacyBackupFiles()).toBeNull();expect(bridge.call).toHaveBeenCalledTimes(1);
});
it('detects truncated native downloads and always removes the partial transfer',async()=>{
  bridge.call.mockImplementation(async(_name,{request})=>request.operation==='request'?{status:200,body:'',size:3}:request.operation==='read'?{status:200,body:request.offset?'':'ff00',size:3}:{status:200,body:'',size:0});
  await expect(davRequest({url:'https://dav.example.test/backup.zip',method:'GET',headers:{}})).rejects.toThrow('不完整');
  expect(bridge.call.mock.calls.at(-1)?.[1].request.operation).toBe('discard');
});
it('cancels a pending native download with its transfer id and cleans up before rejecting',async()=>{
  const controller=new AbortController();let rejectRequest!:(error:unknown)=>void;
  bridge.call.mockImplementation(async(_name,{request})=>{
    if(request.operation==='request')return new Promise((_resolve,reject)=>{rejectRequest=reject;});
    if(request.operation==='requestCancel')rejectRequest('WebDAV request cancelled');
    return {status:200,body:'',size:0};
  });
  const promise=davRequest({url:'https://dav.example.test/backup.zip',method:'GET',headers:{},signal:controller.signal});
  const rejected=expect(promise).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(rejectRequest).toBeTypeOf('function'));controller.abort();await rejected;
  const requests=bridge.call.mock.calls.map(([,value])=>value.request);
  expect(requests.map(request=>request.operation)).toEqual(['requestPrepare','request','requestCancel','discard']);
  expect(new Set(requests.map(request=>request.id)).size).toBe(1);expect(requests[1].signal).toBeUndefined();
});
it('aborts before a native request starts and never reads a result arriving after cancellation',async()=>{
  const early=new AbortController();early.abort();await expect(davRequest({url:'https://dav.example.test/',method:'PROPFIND',headers:{},signal:early.signal})).rejects.toMatchObject({name:'AbortError'});expect(bridge.call).not.toHaveBeenCalled();
  const controller=new AbortController();bridge.call.mockImplementation(async(_name,{request})=>{if(request.operation==='request')controller.abort();return{status:200,body:'',size:100};});
  await expect(davRequest({url:'https://dav.example.test/backup.zip',method:'GET',headers:{},signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  const operations=bridge.call.mock.calls.map(([,value])=>value.request.operation);expect(operations).not.toContain('read');expect(operations.at(-1)).toBe('discard');
});
