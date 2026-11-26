import * as storage from './storage';

export type BackupLogEntry={time:number;operation:string;status:'ok'|'error';message:string};
let pending=Promise.resolve();
export function backupError(error:unknown,secrets:string[]=[]):string {
  let value=error instanceof SyntaxError?'备份文件格式无效':error instanceof Error?error.message:String(error);
  for(const secret of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))value=value.split(secret).join('[已隐藏]');
  return value.replace(/https?:\/\/[^\s"'<>]+/gi,'[网址已隐藏]').replace(/(?:Basic|Bearer)\s+[\w.+/=-]+/gi,'[授权已隐藏]').replace(/(cookie|authorization|token|password|passwd|secret|密码)\s*[:=]\s*[^\s,;]+/gi,'$1=[已隐藏]').slice(0,1500);
}
export function recordBackupEvent(operation:string,status:'ok'|'error',message='',secrets:string[]=[]) {
  const entry:BackupLogEntry={time:Date.now(),operation,status,message:backupError(message,secrets)};
  pending=pending.then(async()=>{const rows=await storage.preference<BackupLogEntry[]>('backupLog',[]);await storage.put('settings','backupLog',[entry,...rows].slice(0,200));}).catch(()=>{});
  return pending;
}
export async function backupLog(){await pending;return storage.preference<BackupLogEntry[]>('backupLog',[]);}
export function clearBackupLog(){pending=pending.then(()=>storage.remove('settings','backupLog')).catch(()=>{});return pending;}
export function backupLogText(rows:BackupLogEntry[]) {return rows.map(row=>`${new Date(row.time).toLocaleString()} ${row.status==='ok'?'成功':'失败'} ${row.operation}${row.message?'\n'+row.message:''}`).join('\n\n');}
