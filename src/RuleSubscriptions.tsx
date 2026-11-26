import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {LegadoIcon} from './LegadoIcon';
import {Modal} from './ui';
import {useSourceGestures} from './useSourceGestures';
import {canUpdateSubscription,editSubscription,moveSubscriptionRelative,newSubscription,renumberSubscriptions,sortedSubscriptions,subscriptionKey,subscriptionTypeName,type SourceSubscription} from './source-subscriptions';
import {safeSourceError} from './source-management';
import {SubscriptionImport} from './SubscriptionImport';

export function RuleSubscriptions({entries,toolbar,busy,error,save,update,imported,close}:{entries:SourceSubscription[];toolbar:HTMLElement|null;busy:string;error:string;save:(entries:SourceSubscription[])=>Promise<void>;update:(entry:SourceSubscription)=>void;imported:(entries:SourceSubscription[])=>Promise<void>;close:()=>void}) {
  const [menu,setMenu]=useState(''),[editor,setEditor]=useState<{draft:SourceSubscription;key:string}|null>(null),[editorError,setEditorError]=useState(''),[saving,setSaving]=useState(false);
  const [importEntry,setImportEntry]=useState<SourceSubscription|null>(null);
  const ordered=sortedSubscriptions(entries),disabled=!!busy||saving;
  const persist=async(next:SourceSubscription[])=>{setSaving(true);setEditorError('');try{await save(next);return true;}catch(e){setEditorError(safeSourceError(e));return false;}finally{setSaving(false);}};
  const gestures=useSourceGestures({order:ordered.map(subscriptionKey),selected:new Set(),canDrag:true,disabled:disabled||!!editor||!!menu||!!importEntry,select:()=>{},move:(key,target,after)=>{void persist(moveSubscriptionRelative(entries,key,target,after));}});
  const displayed=gestures.preview?gestures.preview.map(key=>ordered.find(row=>subscriptionKey(row)===key)!):ordered;
  useEffect(()=>{
    const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();if(importEntry)return;if(editor){if(!saving)setEditor(null);}else if(menu)setMenu('');else close();};
    const page=toolbar?.closest('[role="dialog"]');page?.addEventListener('legado-page-back',back);
    return()=>page?.removeEventListener('legado-page-back',back);
  },[toolbar,editor,menu,saving,importEntry,close]);
  const edit=(draft:SourceSubscription,key='')=>{setEditorError('');setMenu('');setEditor({draft:{...draft},key});};
  const patch=(value:Partial<SourceSubscription>)=>setEditor(current=>current?{...current,draft:{...current.draft,...value}}:null);
  return <div className="rule-subscriptions">
    {toolbar&&createPortal(<><span className="source-manager-title">规则订阅</span><button className="icon-button" aria-label="新增规则订阅" disabled={disabled} onClick={()=>edit(newSubscription(entries))}><LegadoIcon name="ic_add"/></button><button className="icon-button" aria-label="规则订阅菜单" disabled={disabled} onClick={()=>setMenu(menu==='list'?'':'list')}><LegadoIcon name="ic_more_vert"/></button></>,toolbar)}
    {menu&&<><button className="source-panel-dismiss" aria-label="关闭订阅菜单" onClick={()=>setMenu('')}/><div className="source-popup">{menu==='list'?<button disabled={disabled||!entries.length} onClick={()=>{setMenu('');void persist(renumberSubscriptions(entries));}}>重新编号</button>:<button disabled={disabled} onClick={()=>{const key=menu;setMenu('');void persist(entries.filter(row=>subscriptionKey(row)!==key));}}>删除</button>}</div></>}
    {(error||editorError&&!editor)&&<p className="warning" role="alert">{error||editorError}</p>}{busy&&<p role="status">{busy}</p>}
    <div className="subscription-list" ref={gestures.list} {...gestures.handlers}>{displayed.map(entry=>{
      const key=subscriptionKey(entry),name=entry.name||entry.url,canUpdate=canUpdateSubscription(entry);
      return <article className="subscription-row" key={key} data-source-key={key} data-dragging={gestures.dragging===key}>
        <button className="source-title" aria-label={canUpdate?`检查更新 ${name}`:name} disabled={disabled} onClick={()=>{if(canUpdate){if((entry.type??0)===0)update(entry);else setImportEntry(entry);}}}><strong>{name}</strong><span className="subscription-description"><span className="subscription-type">{subscriptionTypeName(entry)}</span><span className="subscription-url">{entry.url}</span></span>{Number.isFinite(entry.updated??entry.update)&&<small>{new Date((entry.updated??entry.update)!).toLocaleString()}{entry.count!==undefined?` · ${entry.count} 项`:''}</small>}{!canUpdate&&<small>暂不支持更新，订阅已保留</small>}</button>
        <button className="icon-button" aria-label={`编辑 ${name}`} disabled={disabled} onClick={()=>edit(entry,key)}><LegadoIcon name="ic_edit"/></button><button className="icon-button" aria-label={`订阅操作 ${name}`} disabled={disabled} onClick={()=>setMenu(menu===key?'':key)}><LegadoIcon name="ic_more_vert"/></button>
      </article>;
    })}{!entries.length&&<div className="legado-empty">没有规则订阅</div>}</div>
    {importEntry&&<SubscriptionImport entry={importEntry} close={()=>setImportEntry(null)} imported={imported}/>}
    {editor&&<Modal title={editor.key?'编辑规则订阅':'新增规则订阅'} page={false} centered close={()=>{if(!saving)setEditor(null);}}><form className="subscription-editor" onSubmit={async event=>{
      event.preventDefault();if(saving)return;
      try{const next=editSubscription(entries,editor.draft,editor.key);if(await persist(next))setEditor(null);}catch(e){setEditorError(safeSourceError(e));}
    }}><label className="field">类型<select aria-label="订阅类型" disabled={saving} value={editor.draft.type??0} onChange={event=>patch({type:Number(event.target.value)})}>{[0,1,2,3,...editor.draft.type!==undefined&&![0,1,2,3].includes(editor.draft.type)?[editor.draft.type]:[]].map(type=><option key={type} value={type}>{subscriptionTypeName({url:'',type})}</option>)}</select></label>
      <label className="field">名称<input aria-label="订阅名称" disabled={saving} value={editor.draft.name??''} onChange={event=>patch({name:event.target.value})}/></label><label className="field">URL<input aria-label="订阅地址" disabled={saving} value={editor.draft.url} onChange={event=>patch({url:event.target.value})}/></label>
      <div className="subscription-update-options"><label className="check-line"><input type="checkbox" aria-label="自动更新" disabled={saving} checked={!!editor.draft.autoUpdate} onChange={event=>patch(event.target.checked?{autoUpdate:true,updateInterval:editor.draft.updateInterval||24}:{autoUpdate:false,updateInterval:0,silentUpdate:false})}/>自动更新</label><label className="check-line"><input type="checkbox" aria-label="静默更新" disabled={saving||!editor.draft.autoUpdate} checked={!!editor.draft.silentUpdate} onChange={event=>patch({silentUpdate:event.target.checked})}/>静默更新</label><label className="check-line">间隔<input aria-label="更新间隔（小时）" type="number" min="0" max="2147483647" step="1" disabled={saving||!editor.draft.autoUpdate} value={editor.draft.updateInterval??0} onChange={event=>{const updateInterval=Number(event.target.value);patch({updateInterval,...updateInterval===0?{autoUpdate:false,silentUpdate:false}:{}});}}/>小时</label></div>
      <p className="subtle">自动更新设置仅保存，定时更新尚未启用。</p>{editorError&&<p className="warning" role="alert">{editorError}</p>}<div className="source-actions"><button type="button" className="text-button" disabled={saving} onClick={()=>setEditor(null)}>取消</button><button className="text-button" disabled={saving}>保存</button></div>
    </form></Modal>}
  </div>;
}
