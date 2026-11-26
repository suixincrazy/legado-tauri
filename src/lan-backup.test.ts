import 'fake-indexeddb/auto';
import {webcrypto,createDecipheriv} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {encryptLanArchive,decryptLanArchive,parseLanDescriptor,type LanDescriptor} from './lan-backup';
vi.stubGlobal('crypto',webcrypto);
it('matches the original AES-GCM token authentication and rejects modified archives and expired descriptors',async()=>{
  const key=new Uint8Array(32).fill(3),iv=new Uint8Array(12).fill(7),token='a'.repeat(32),plain=new TextEncoder().encode('ZIP fixture 中文𠮷');
  const bytes=await encryptLanArchive(plain,token,key,iv);
  const descriptor:LanDescriptor={protocol:'legado-lan-backup',version:1,hosts:['192.168.1.2'],port:12345,key:Buffer.from(key).toString('hex'),iv:Buffer.from(iv).toString('hex'),token,size:bytes.length,sha256:Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex'),deviceName:'Fixture',expiresAt:Date.now()+300000};
  expect(parseLanDescriptor(JSON.stringify(descriptor))).toEqual(descriptor);
  const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('legado-lan-backup:1:'+token));cipher.setAuthTag(bytes.slice(-16));expect(Array.from(Buffer.concat([cipher.update(bytes.slice(0,-16)),cipher.final()]))).toEqual(Array.from(plain));
  expect(Array.from(await decryptLanArchive(bytes,descriptor))).toEqual(Array.from(plain));
  bytes[0]^=1;await expect(decryptLanArchive(bytes,descriptor)).rejects.toThrow('校验');
  expect(()=>parseLanDescriptor(JSON.stringify({...descriptor,hosts:['public.example.test']}))).toThrow('局域网地址');
  expect(()=>parseLanDescriptor(JSON.stringify({...descriptor,expiresAt:Date.now()-1}))).toThrow('过期');
});
