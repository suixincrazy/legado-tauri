import { useRef, useState } from 'react';
import { Modal } from './ui';

export function ReaderProgress({chapter,chapters,page,pages,behavior,loading,turnChapter,seekPage}:{chapter:number;chapters:number;page:number;pages:number;behavior:'page'|'chapter';loading:boolean;turnChapter:(chapter:number)=>void;seekPage:(page:number)=>void}) {
  const [draft,setDraft]=useState<number|null>(null),[pending,setPending]=useState<number|null>(null);
  const dragging=useRef(false),draftRef=useRef<number|null>(null),confirmed=useRef(false);
  const max=Math.max(0,(behavior==='chapter'?chapters:pages)-1),value=behavior==='chapter'?chapter:page;
  const select=(target:number)=>{if(behavior==='page')seekPage(target);else if(target!==chapter){if(confirmed.current)turnChapter(target);else setPending(target);}};
  return <><div className="chapter-navigation"><button disabled={loading||chapter===0} onClick={()=>turnChapter(chapter-1)}>上一章</button><input type="range" aria-label={behavior==='chapter'?'章节进度':'本章页数'} min={0} max={max} disabled={loading||!max} value={draft??value} onPointerDown={()=>{dragging.current=true;draftRef.current=value;setDraft(value);}} onChange={event=>{const target=+event.target.value;if(dragging.current){draftRef.current=target;setDraft(target);}else select(target);}} onPointerUp={()=>{dragging.current=false;const target=draftRef.current;draftRef.current=null;setDraft(null);if(target!==null)select(target);}} onPointerCancel={()=>{dragging.current=false;draftRef.current=null;setDraft(null);}}/><button disabled={loading||chapter>=chapters-1} onClick={()=>turnChapter(chapter+1)}>下一章</button></div>{pending!==null&&<Modal page={false} centered showClose={false} title="章节跳转确认" close={()=>setPending(null)}><p>确定要跳转章节吗？</p><div className="dialog-actions"><button onClick={()=>setPending(null)}>否</button><button onClick={()=>{confirmed.current=true;turnChapter(pending);setPending(null);}}>是</button></div></Modal>}</>;
}
