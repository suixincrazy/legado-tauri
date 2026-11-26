import 'fake-indexeddb/auto';
import {beforeEach,expect,it,vi} from 'vitest';
import {davRequest} from './backup-transport';
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
it('detects truncated native downloads and always removes the partial transfer',async()=>{
  bridge.call.mockImplementation(async(_name,{request})=>request.operation==='request'?{status:200,body:'',size:3}:request.operation==='read'?{status:200,body:request.offset?'':'ff00',size:3}:{status:200,body:'',size:0});
  await expect(davRequest({url:'https://dav.example.test/backup.zip',method:'GET',headers:{}})).rejects.toThrow('不完整');
  expect(bridge.call.mock.calls.at(-1)?.[1].request.operation).toBe('discard');
});
