import {useEffect,useRef,useState} from 'react';
import {Modal} from './ui';
import {QrScanner} from './QrScanner';
import {qrPixels} from './qr-code';
import {sendLanBackup,stopLanBackup,parseLanDescriptor,receiveLanBackup,type LanDescriptor} from './lan-backup';
import type {BackupConfig} from './backup';

export function LanBackup({config,close,received,notify}:{config:BackupConfig;close:()=>void;received:(bytes:Uint8Array)=>Promise<void>;notify:(text:string)=>void}) {
  const [scan,setScan]=useState(false),[descriptor,setDescriptor]=useState<LanDescriptor|null>(null),[incoming,setIncoming]=useState<LanDescriptor|null>(null),[busy,setBusy]=useState('');
  const session=useRef(''),alive=useRef(true),canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{alive.current=true;const hide=()=>{if(document.hidden&&session.current)close();};document.addEventListener('visibilitychange',hide);return()=>{alive.current=false;document.removeEventListener('visibilitychange',hide);if(session.current)void stopLanBackup(session.current).catch(()=>{});};},[]);
  useEffect(()=>{
    if(!descriptor)return;
    qrPixels(JSON.stringify(descriptor)).then(pixels=>{const node=canvas.current;if(!node)return;node.width=pixels.width;node.height=pixels.height;const ctx=node.getContext('2d')!,image=ctx.createImageData(pixels.width,pixels.height);image.data.set(pixels.data);ctx.putImageData(image,0,0);}).catch(error=>notify(String(error)));
    const timer=setTimeout(close,Math.max(0,descriptor.expiresAt-Date.now()));return()=>clearTimeout(timer);
  },[descriptor]);
  const run=async(label:string,action:()=>Promise<void>)=>{setBusy(label);try{await action();}catch(error){notify(error instanceof Error?error.message:String(error));}finally{if(alive.current)setBusy('');}};
  return <Modal title="局域网传输" close={close} page={false} centered>
    <p>两台设备连接同一局域网，并保持阅读打开。</p>
    {descriptor?<><canvas ref={canvas} aria-label="加密备份传输二维码" style={{width:'100%',maxWidth:320,display:'block',margin:'auto'}}/><p>接收设备扫描此二维码。5 分钟后失效，关闭即停止。</p></>:<><button className="setting-row" disabled={!!busy} onClick={()=>run('正在准备加密备份',async()=>{const result=await sendLanBackup(config.content,config.deviceName);if(!alive.current){await stopLanBackup(result.id);return;}session.current=result.id;setDescriptor(result.descriptor);})}><span>发送备份</span></button><button className="setting-row" disabled={!!busy} onClick={()=>setScan(true)}><span>扫码接收</span></button></>}
    {busy&&<p role="status">{busy}</p>}
    {scan&&<QrScanner close={()=>setScan(false)} scanned={text=>{setScan(false);try{setIncoming(parseLanDescriptor(text));}catch(error){notify(String(error));}}}/>}
    {incoming&&<Modal title="接收备份" close={()=>setIncoming(null)} page={false} centered><p>来自 {incoming.deviceName}，{(incoming.size/1024/1024).toFixed(2)} MB</p><div className="source-actions"><button onClick={()=>setIncoming(null)}>取消</button><button disabled={!!busy} onClick={()=>run('正在接收备份',async()=>{const bytes=await receiveLanBackup(incoming);if(!alive.current)return;await received(bytes);close();})}>接收</button></div></Modal>}
  </Modal>;
}
