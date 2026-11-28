import {createContext,useContext,useEffect,useState} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {openDB} from 'idb';

export type CoverConnection={wifi:boolean;online:boolean};
export const CoverNetworkContext=createContext({onlyWifi:false,connection:null as CoverConnection|null});
const native=()=>isTauri()&&(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||/Macintosh/i.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
const browserNetwork=()=>(navigator as Navigator&{connection?:EventTarget&{type?:string}}).connection;
async function bridge(operation:string,args:Record<string,unknown>={}):Promise<any>{
  const result=await (/Android/i.test(navigator.userAgent)
    ?invoke<{json:string}>('java_bridge',{payload:JSON.stringify({operation,...args})})
    :invoke<{json:string}>('source_browser',{request:{mode:operation,...args}}));
  const data=JSON.parse(result.json);if(data.error)throw new Error(data.error);return data.value;
}
export async function coverConnection():Promise<CoverConnection|null>{
  if(!native()){
    const type=browserNetwork()?.type;
    if(!type||type==='unknown')return null;
    return {wifi:type==='wifi'&&navigator.onLine!==false,online:type!=='none'&&navigator.onLine!==false};
  }
  const value=await bridge('coverNetwork');
  return {wifi:value?.wifi===true,online:value?.online===true};
}
export function useCoverConnection(enabled:boolean){
  const [connection,setConnection]=useState<CoverConnection|null>(null);
  useEffect(()=>{
    if(!enabled){setConnection(null);return;}
    let active=true,sequence=0;
    const refresh=async(invalidate=false)=>{
      const id=++sequence;
      if(invalidate)setConnection(null);
      const next=document.hidden?null:await coverConnection().catch(()=>null);
      if(active&&id===sequence)setConnection(old=>old?.wifi===next?.wifi&&old?.online===next?.online?old:next);
    };
    const change=()=>void refresh(true);
    change();const connection=browserNetwork();connection?.addEventListener('change',change);
    for(const name of ['online','offline','focus','legado-network-change'])window.addEventListener(name,change);
    document.addEventListener('visibilitychange',change);
    return()=>{active=false;sequence++;connection?.removeEventListener('change',change);for(const name of ['online','offline','focus','legado-network-change'])window.removeEventListener(name,change);document.removeEventListener('visibilitychange',change);};
  },[enabled]);
  return connection;
}

const maxBytes=4*1024*1024;
type CachedCover={data:string;bytes:number;used:number};
let database:ReturnType<typeof openDB>|undefined;
const db=()=>database??=openDB('legado-cover-cache',1,{upgrade(d){d.createObjectStore('images').createIndex('ageSize',['used','bytes']);}});
async function cached(url:string):Promise<string|undefined>{
  try{return (await (await db()).get('images',url) as CachedCover|undefined)?.data;}catch{return undefined;}
}
async function remember(url:string,value:CachedCover){
  try{
    const transaction=(await db()).transaction('images','readwrite');
    const old:{key:IDBValidKey;bytes:number}[]=[];
    let cursor=await transaction.store.index('ageSize').openKeyCursor();
    while(cursor){if(cursor.primaryKey!==url)old.push({key:cursor.primaryKey,bytes:Number((cursor.key as number[])[1])});cursor=await cursor.continue();}
    let bytes=old.reduce((sum,row)=>sum+row.bytes,0)+value.bytes;
    while(old.length>=64||bytes>32*1024*1024){const first=old.shift();if(!first)break;bytes-=first.bytes;await transaction.store.delete(first.key);}
    await transaction.store.put(value,url);await transaction.done;
  }catch{/* A full image cache must not prevent displaying a downloaded cover. */}
}
const pending=new Map<string,Promise<string|undefined>>();
export async function loadCoverImage(url:string,onlyWifi:boolean,connection:CoverConnection|null):Promise<string|undefined>{
  if(!/^https?:/i.test(url))return /^(data:image\/|blob:|\/legado\/)/i.test(url)?url:undefined;
  const hit=await cached(url);if(hit)return hit;
  if(onlyWifi&&!connection?.wifi)return undefined;
  if(!native()){
    if(onlyWifi&&!(await coverConnection())?.wifi)return undefined;
    return url;
  }
  // Do not let a restricted request reuse an unrestricted in-flight download.
  const key=JSON.stringify([url,onlyWifi]);if(pending.has(key))return pending.get(key)!;
  const job=(async()=>{
    const result=await bridge('coverImage',{url,onlyWifi});
    if(!result||typeof result.base64!=='string'||!/^image\/[a-z0-9.+-]+$/i.test(result.mime))return undefined;
    const bytes=Math.floor(result.base64.length*3/4)-(result.base64.endsWith('==')?2:result.base64.endsWith('=')?1:0);if(bytes>maxBytes)throw new Error('封面超过 4 MiB');
    const data='data:'+result.mime+';base64,'+result.base64;
    await remember(url,{data,bytes,used:Date.now()});return data;
  })();
  pending.set(key,job);
  try{return await job;}finally{pending.delete(key);}
}
export function useCoverImage(url:string|undefined,restricted=false):string|undefined{
  const {onlyWifi,connection}=useContext(CoverNetworkContext),gate=onlyWifi&&restricted;
  const [loaded,setLoaded]=useState<{key:string;value?:string}>();
  const key=JSON.stringify([url,gate,gate?connection:null]);
  useEffect(()=>{
    let active=true;
    if(gate&&url&&/^https?:/i.test(url))loadCoverImage(url,true,connection).then(value=>{if(active)setLoaded({key,value});}).catch(()=>{if(active)setLoaded({key});});
    return()=>{active=false;};
  },[key,restricted]);
  if(!url)return undefined;
  if(/^(data:image\/|blob:|\/legado\/)/i.test(url))return url;
  if(!gate&&/^https?:/i.test(url))return url;
  return loaded?.key===key?loaded.value:undefined;
}
