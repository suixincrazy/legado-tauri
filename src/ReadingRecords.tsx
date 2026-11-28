import {useState} from 'react';
import {MoreVertical} from 'lucide-react';
import {IconButton,Modal} from './ui';
import {useCoverImageResult} from './cover-network';
import {readingRecordRows,type ReadingRecordRow} from './reading-records';
import type {Book,ReadingRecord,Settings} from './model';

function CoverCandidate({urls}:{urls:string[]}){
  const [url,...rest]=urls,{value,pending}=useCoverImageResult(url,true);
  const [failed,setFailed]=useState<string>();
  if(value&&failed!==value)return <img src={value} alt="" onError={()=>setFailed(value)}/>;
  if(pending||!rest.length)return null;
  return <CoverCandidate key={rest[0]} urls={rest}/>;
}
function RecordCover({row,prefs}:{row:ReadingRecordRow;prefs:Settings}){
  const fallback=prefs.dark?prefs.readRecordCoverDark:prefs.readRecordCover;
  const urls=[...new Set([row.book?.cover,row.cover,fallback].filter((value):value is string=>!!value))];
  return <span className="record-cover" role="img" aria-label={row.name+'封面'}>{urls.length>0&&<CoverCandidate key={urls[0]} urls={urls}/>}</span>;
}
const duration=(seconds:number)=>seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分钟`;
export function ReadingRecords({records,books,prefs,save,close}:{records:ReadingRecord[];books:Book[];prefs:Settings;save:(prefs:Settings)=>void;close:()=>void}){
  const [menu,setMenu]=useState(false),rows=readingRecordRows(records,books),simple=prefs.readRecordSimpleLayout!==false;
  const total=rows.reduce((n,row)=>n+row.seconds,0),top=[...rows].sort((a,b)=>b.seconds-a.seconds).slice(0,3);
  return <Modal title="阅读记录" close={close} wide actions={<IconButton label="阅读记录菜单" onClick={()=>setMenu(!menu)}><MoreVertical/></IconButton>}>
    {menu&&<div className="record-layout-menu" role="menu"><button role="menuitemcheckbox" aria-checked={simple} onClick={()=>{save({...prefs,readRecordSimpleLayout:!simple});setMenu(false);}}><span>简洁布局</span><span aria-hidden="true">{simple?'✓':''}</span></button></div>}
    <div className={'record-overview'+(simple?' simple':'')}><div><strong>{rows.length}</strong> 本书<p>总阅读时长 {duration(total)}</p></div>{!simple&&<div className="record-cover-stack">{top.map(row=><RecordCover key={row.key} row={row} prefs={prefs}/>)}</div>}</div>
    {rows.map(row=><article className={'reading-record'+(simple?' simple':'')} key={row.key}>
      {!simple&&<RecordCover row={row} prefs={prefs}/>}<div className="reading-record-text"><h3>{row.name}</h3><p>{row.author||'未知作者'}</p>{!simple&&<p>{row.chapter||'暂无章节信息'}</p>}<small>阅读时长 {duration(row.seconds)}{row.started>0?' · '+new Date(row.started).toLocaleDateString('zh-CN'):''}</small></div>
    </article>)}
    {!rows.length&&<p className="empty">还没有阅读记录</p>}
  </Modal>;
}
