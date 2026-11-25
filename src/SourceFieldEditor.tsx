import { useEffect, useRef, useState } from 'react';
import { LegadoIcon } from './LegadoIcon';
import { IconButton, Modal } from './ui';

export function SourceFieldEditor({ label, value, start, end, done }: { label: string; value: string; start: number; end: number; done: (text: string | undefined, start: number, end: number) => void }) {
  const [text, setText] = useState(value), [discard, setDiscard] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.setSelectionRange(start, end); }, []);
  const finish = (save: boolean) => done(save ? text : undefined, input.current?.selectionStart || 0, input.current?.selectionEnd || 0);
  const leave = () => text === value ? finish(false) : setDiscard(true);
  return <Modal title={label} close={leave} actions={<IconButton label="保存内容" onClick={() => finish(true)}><LegadoIcon name="ic_save" /></IconButton>}>
    <textarea ref={input} className="source-fullscreen-code" aria-label="编辑内容" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={text} onChange={event => setText(event.target.value)} />
    {discard && <Modal title="保存修改" page={false} centered close={() => setDiscard(false)}><p>内容已修改，是否保存？</p><div className="dialog-actions"><button onClick={() => finish(false)}>不保存</button><button onClick={() => setDiscard(false)}>取消</button><button onClick={() => finish(true)}>保存</button></div></Modal>}
  </Modal>;
}
