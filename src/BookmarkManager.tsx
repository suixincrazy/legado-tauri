import {useEffect,useRef,useState} from 'react';
import type {Book,Bookmark} from './model';
import {Modal} from './ui';
import {saveFile} from './files';
import {bookmarkFile,bookmarkRows} from './bookmarks';

export function BookmarkEditor({mark,chapterName,text,commit,remove,close,notify}:{mark:Bookmark;chapterName:string;text:string;commit:(bookText:string,content:string)=>Promise<void>;remove?:()=>Promise<void>;close:()=>void;notify:(message:string)=>void}) {
  const [quote,setQuote]=useState(text),[note,setNote]=useState(mark.content??''),[busy,setBusy]=useState(false);
  const finish=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);try{await action();close();}catch(error){notify(String(error));setBusy(false);}};
  return <Modal title="书签" page={false} centered close={()=>{if(!busy)close();}}>
    <div className="bookmark-editor"><p>{chapterName}</p>
      <label className="field">原文<textarea value={quote} onChange={event=>setQuote(event.target.value)}/></label>
      <label className="field">摘要<textarea value={note} onChange={event=>setNote(event.target.value)}/></label>
      <div className="source-actions">{remove&&<button disabled={busy} onClick={()=>void finish(remove)}>删除</button>}
        <button disabled={busy} onClick={close}>取消</button><button disabled={busy} onClick={()=>void finish(()=>commit(quote,note))}>确定</button>
      </div>
    </div>
  </Modal>;
}

export function BookmarkList({books,single,save,jump,notify}:{books:Book[];single?:Book;save:(book:Book)=>Promise<void>;jump:(book:Book,mark:Bookmark)=>Promise<void>;notify:(message:string)=>void}) {
  const [query,setQuery]=useState(''),[editor,setEditor]=useState<{bookId:string;created:number;index:number}|null>(null);
  const held=useRef(false),press=useRef<{timer:number;x:number;y:number}|null>(null);
  const stop=()=>{if(press.current)clearTimeout(press.current.timer);press.current=null;};
  useEffect(()=>stop,[]);
  const rows=bookmarkRows(single?[single]:books),needle=query.trim().toLowerCase();
  const visible=rows.filter(({record})=>[record.chapterName,record.content,...(single?[]:[record.bookName,record.bookAuthor])].some(value=>value.toLowerCase().includes(needle)));
  const edit=editor&&rows.find(row=>row.book.id===editor.bookId&&row.index===editor.index&&row.mark.created===editor.created);
  const exportFile=async(format:'json'|'md')=>{try{const file=bookmarkFile(books,format,single);if(await saveFile(file.name,file.text))notify('书签已导出');}catch(error){notify(String(error));}};
  return <div className="bookmark-manager">
    <div className="bookmark-tools"><input type="search" aria-label="搜索书签" placeholder={single?'搜索章名或摘要':'搜索书名、作者、章名或摘要'} value={query} onChange={e=>setQuery(e.target.value)}/>
      <button className="text-button" onClick={()=>void exportFile('json')}>导出 JSON</button><button className="text-button" onClick={()=>void exportFile('md')}>导出 MD</button></div>
    {visible.map(({book,mark,index,record},i)=>{
      const open=()=>setEditor({bookId:book.id,created:mark.created,index});
      return <div key={book.id+':'+index+':'+mark.created}>
        {!single&&(i===0||visible[i-1].book.id!==book.id)&&<h3 className="bookmark-group">{book.name} <small>{book.author}</small></h3>}
        <div className="bookmark-row"><button className="bookmark-target"
          onPointerDown={e=>{stop();held.current=false;if(e.button!==0)return;press.current={x:e.clientX,y:e.clientY,timer:window.setTimeout(()=>{held.current=true;open();},500)};}}
          onPointerMove={e=>{if(press.current&&Math.hypot(e.clientX-press.current.x,e.clientY-press.current.y)>10)stop();}}
          onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}
          onContextMenu={e=>{e.preventDefault();stop();held.current=true;open();}}
          onClick={e=>{if(e.detail&&held.current){held.current=false;return;}void jump(book,mark).catch(error=>notify(String(error)));}}>
          <span>{record.chapterName}<small>{record.bookText}</small>{record.content&&<small>{record.content}</small>}</span>
        </button><button className="text-button" aria-label={'编辑书签：'+record.chapterName} onClick={open}>编辑</button></div>
      </div>;
    })}
    {!visible.length&&<div className="legado-empty">{needle?'没有匹配的书签':'没有书签'}</div>}
    {edit&&<BookmarkEditor mark={edit.mark} chapterName={edit.record.chapterName} text={edit.record.bookText} notify={notify} close={()=>setEditor(null)}
      commit={(bookText,content)=>save({...edit.book,bookmarks:edit.book.bookmarks.map((m,i)=>i===edit.index?{...m,chapterName:edit.record.chapterName,bookText,content}:m)})}
      remove={()=>save({...edit.book,bookmarks:edit.book.bookmarks.filter((_,i)=>i!==edit.index)})}/>}
  </div>;
}
