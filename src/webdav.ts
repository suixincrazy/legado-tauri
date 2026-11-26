import {davRequest,type DavRequest,type DavResponse,type BackupEntry} from './backup-transport';

export type DavConfig={url:string;username:string;password:string;directory:string;keepCount:number};
const PROPS='<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';
const successful=(status:number)=>status>=200&&status<300;
function error(status:number):never {
  if(status===401||status===403)throw new Error(`WebDAV 授权失败（${status}），请检查账号和应用授权密码`);
  if(status===404)throw new Error('WebDAV 路径或备份不存在（404）');
  if(status===507)throw new Error('WebDAV 存储空间不足（507）');
  if(status>=300&&status<400)throw new Error('WebDAV 地址发生重定向，请填写服务器最终的 WebDAV 地址');
  throw new Error(`WebDAV 请求失败（${status}）`);
}
export function davRoot(config:DavConfig) {
  let root:URL;
  try{root=new URL(config.url.trim());}catch{throw new Error('请输入有效的 WebDAV 服务器地址');}
  if(!['http:','https:'].includes(root.protocol)||root.username||root.password||root.search||root.hash)throw new Error('WebDAV 地址须为 HTTP/HTTPS，账号和密码请填写在对应项目中');
  root.pathname=root.pathname.replace(/\/?$/,'/');
  for(const part of config.directory.split('/').filter(Boolean)){
    if(part==='.'||part==='..'||part.includes('\\'))throw new Error('WebDAV 子目录不能包含 .. 或反斜线');
    root.pathname+=encodeURIComponent(part)+'/';
  }
  return root.href;
}
export function parseDavList(xml:string,root:string):BackupEntry[] {
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length||doc.documentElement.localName!=='multistatus')throw new Error('服务器未返回有效的 WebDAV 文件列表');
  const base=new URL(root),result:BackupEntry[]=[];
  for(const item of Array.from(doc.getElementsByTagNameNS('*','response'))){
    const href=item.getElementsByTagNameNS('*','href')[0]?.textContent;if(!href)continue;
    let url:URL;try{url=new URL(href,base);}catch{continue;}
    if(url.origin!==base.origin||url.username||url.password||url.search||url.hash||!url.pathname.startsWith(base.pathname))continue;
    const tail=url.pathname.slice(base.pathname.length);if(!tail||tail.includes('/'))continue;
    let name:string;try{name=decodeURIComponent(tail);}catch{continue;}
    if(!/^backup.*\.(zip|json)$/i.test(name)||/[\\/]/.test(name))continue;
    const propstat=Array.from(item.getElementsByTagNameNS('*','propstat')).find(node=>/\s2\d\d(?:\s|$)/.test(node.getElementsByTagNameNS('*','status')[0]?.textContent||''));
    if(!propstat||propstat.getElementsByTagNameNS('*','collection').length)continue;
    const prop=(key:string)=>propstat.getElementsByTagNameNS('*',key)[0]?.textContent||'';
    result.push({name,url:url.href,size:Number(prop('getcontentlength'))||0,modified:Date.parse(prop('getlastmodified'))||0});
  }
  return result.sort((a,b)=>b.modified-a.modified||b.name.localeCompare(a.name));
}
export class WebDav {
  readonly root:string;
  constructor(readonly config:DavConfig,private transport:(request:DavRequest)=>Promise<DavResponse>=davRequest){this.root=davRoot(config);}
  private async request(method:string,url:string,body?:string|Uint8Array,extra:Record<string,string>={},signal?:AbortSignal) {
    const credentials=new TextEncoder().encode(`${this.config.username}:${this.config.password}`);
    let binary='';for(const byte of credentials)binary+=String.fromCharCode(byte);
    return this.transport({method,url,body,headers:{...(this.config.username||this.config.password?{Authorization:`Basic ${btoa(binary)}`} :{}),...extra},signal});
  }
  private fileUrl(name:string) {
    if(!name||/[\\/]/.test(name)||name==='.'||name==='..')throw new Error('无效的备份文件名');
    return this.root+encodeURIComponent(name);
  }
  async connect() {
    const existing=await this.request('PROPFIND',this.root,PROPS,{Depth:'0','Content-Type':'application/xml; charset=utf-8'});
    if(successful(existing.status)){await this.list();return;}
    if(existing.status!==404)error(existing.status);
    const base=davRoot({...this.config,directory:''});
    let path=base;
    const baseCheck=path===this.root?existing:await this.request('PROPFIND',path,PROPS,{Depth:'0','Content-Type':'application/xml; charset=utf-8'});
    if(baseCheck.status===404){const created=await this.request('MKCOL',path);if(!successful(created.status)&&created.status!==405)error(created.status);}
    else if(!successful(baseCheck.status))error(baseCheck.status);
    const parts=this.root.slice(base.length).split('/').filter(Boolean);
    for(const part of parts){
      path+=part+'/';const response=await this.request('PROPFIND',path,PROPS,{Depth:'0','Content-Type':'application/xml; charset=utf-8'});
      if(response.status===404){const created=await this.request('MKCOL',path);if(!successful(created.status)&&created.status!==405)error(created.status);}
      else if(!successful(response.status))error(response.status);
    }
    await this.list();
  }
  async list(signal?:AbortSignal):Promise<BackupEntry[]> {
    const response=await this.request('PROPFIND',this.root,PROPS,{Depth:'1','Content-Type':'application/xml; charset=utf-8'},signal);
    if(!successful(response.status))error(response.status);
    return parseDavList(response.text,this.root);
  }
  async put(name:string,bytes:Uint8Array,contentType='application/octet-stream') {
    await this.connect();
    const response=await this.request('PUT',this.fileUrl(name),bytes,{'Content-Type':contentType});
    if(!successful(response.status))error(response.status);
    const confirmed=await this.request('HEAD',this.fileUrl(name));
    if(!successful(confirmed.status)&&![405,501].includes(confirmed.status))error(confirmed.status);
  }
  async upload(name:string,bytes:Uint8Array) {
    await this.put(name,bytes,'application/zip');
    const warnings:string[]=[];
    if(this.config.keepCount>0)try{
      const ownSuffix=/^backup\d{4}-\d{2}-\d{2}(-.*)\.zip$/.exec(name)?.[1];
      if(!ownSuffix)return warnings;
      const files=(await this.list()).filter(item=>item.name!==name&&item.name.endsWith(ownSuffix+'.zip'));
      for(const file of files.slice(this.config.keepCount-1))await this.remove(file.name);
    }catch{warnings.push('备份上传成功，但清理历史备份失败');}
    return warnings;
  }
  async download(name:string,signal?:AbortSignal) {
    const response=await this.request('GET',this.fileUrl(name),undefined,{},signal);if(!successful(response.status))error(response.status);
    if(!response.bytes?.length)throw new Error('WebDAV 返回了空备份');return response.bytes;
  }
  async remove(name:string) {
    const response=await this.request('DELETE',this.fileUrl(name));if(!successful(response.status))error(response.status);
  }
}
