import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Source } from './model';
import { debugSource } from './source-debug';
import { exploreKinds, type ExploreKind } from './sources';
import type { SourceEvent } from './source-trace';
import { safeSourceError } from './source-management';
import { SourceHelp } from './SourceHelp';
import { IconButton, Modal } from './ui';
import { LegadoIcon } from './LegadoIcon';

const phaseNames = { search: '搜索', explore: '发现', info: '详情', toc: '目录', content: '正文' };
const rawNames = { search: '搜索源码', info: '书籍源码', toc: '目录源码', content: '正文源码' };
type RawKey = keyof typeof rawNames;
type ResponseEvent = Extract<SourceEvent, { type: 'response' }>;
type LogRow = { time: number; text: string };

export function SourceDebugger({ source, close }: { source: Source; close: () => void }) {
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [input, setInput] = useState(''), [showHints, setShowHints] = useState(true), [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false), [help, setHelp] = useState(false), [raw, setRaw] = useState<RawKey | null>(null);
  const [responses, setResponses] = useState<Partial<Record<RawKey, ResponseEvent>>>({}), [rows, setRows] = useState<LogRow[]>([]);
  const [kinds, setKinds] = useState<ExploreKind[]>([]), [kind, setKind] = useState(0), [exploreError, setExploreError] = useState('');
  const controller = useRef<AbortController | null>(null), sequence = useRef(0), discovery = useRef(0);
  const pending = useRef<Promise<unknown> | null>(null);
  const pendingDiscovery = useRef<Promise<unknown> | null>(null), discoveryController = useRef<AbortController | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const add = (text: string, time = Date.now()) => setRows(previous => [...previous.slice(-299), { time, text }]);
  const refreshExplore = async () => {
    discoveryController.current?.abort(); const current = ++discovery.current, next = new AbortController(); discoveryController.current = next; setExploreError('');
    if (pendingDiscovery.current) await pendingDiscovery.current.catch(() => {});
    if (pending.current) await pending.current.catch(() => {});
    if (next.signal.aborted) return;
    const task = exploreKinds(source, { signal: next.signal }); pendingDiscovery.current = task;
    try { const values = await task; if (current === discovery.current && !next.signal.aborted) { setKinds(values.filter(item => item.url)); setKind(0); } }
    catch (error) { if (current === discovery.current && !next.signal.aborted) setExploreError(safeSourceError(error)); }
    finally { if (pendingDiscovery.current === task) pendingDiscovery.current = null; }
  };
  useEffect(() => {
    setToolbar(document.getElementById('source-debug-toolbar')); void refreshExplore();
    return () => { sequence.current++; discovery.current++; controller.current?.abort(); discoveryController.current?.abort(); };
  }, []);
  const stop = () => { sequence.current++; controller.current?.abort(); controller.current = null; setBusy(false); add('︽已停止调试'); };
  const leave = () => { sequence.current++; controller.current?.abort(); close(); };
  useEffect(() => {
    const page = toolbar?.closest('[role="dialog"]');
    const back = (event: Event) => { if (menu) { event.preventDefault(); setMenu(false); } };
    page?.addEventListener('legado-page-back', back);
    return () => page?.removeEventListener('legado-page-back', back);
  }, [toolbar, menu]);
  const run = async (value = input) => {
    if (!value.trim()) { field.current?.focus(); return; }
    controller.current?.abort(); const current = ++sequence.current, next = new AbortController(); controller.current = next;
    setInput(value); setMenu(false); setShowHints(false); field.current?.blur(); setRows([]); setResponses({}); setBusy(true);
    let phase = '';
    add('︾开始解析');
    try {
      discoveryController.current?.abort();
      if (pendingDiscovery.current) await pendingDiscovery.current.catch(() => {});
      if (pending.current) await pending.current.catch(() => {});
      if (current !== sequence.current || next.signal.aborted) return;
      const task = debugSource(source, value, { signal: next.signal, onEvent: event => {
        if (current !== sequence.current || next.signal.aborted) return;
        if (phase !== event.phase) { phase = event.phase; add(`︾开始解析${phaseNames[event.phase]}页`, event.time); }
        if (event.type === 'response') {
          const key = event.phase === 'explore' ? 'search' : event.phase;
          setResponses(previous => event.origin === 'request' && previous[key]?.origin === 'page' ? previous : { ...previous, [key]: event });
          if (event.origin !== 'page') add(`≡获取成功:${event.url}${event.status === undefined ? '' : ` (${event.status})`}`, event.time);
        } else if (event.type === 'log') add(event.text, event.time);
        else add(`┌${event.type === 'rule' ? event.rule : event.name}\n└${event.value}`, event.time);
      } });
      pending.current = task;
      const result = await task;
      if (pending.current === task) pending.current = null;
      if (current === sequence.current) add(`︽正文页解析完成\n${result.book.chapters[result.book.chapter].title}\n${result.content.slice(0, 12000)}`);
    } catch (error) { if (current === sequence.current) add(`︽${safeSourceError(error)}`); }
    finally { if (current === sequence.current) { controller.current = null; setBusy(false); } }
  };
  const prefix = (value: string) => { const next = input.startsWith(value) ? input : value + input; setInput(next); if (input.length > 2) void run(next); else field.current?.focus(); };
  const actions = <><form className="source-debug-search" onSubmit={event => { event.preventDefault(); void run(); }}><input ref={field} aria-label="调试输入" placeholder="搜索关键字或调试地址" value={input} onFocus={() => setShowHints(true)} onChange={event => setInput(event.target.value)} spellCheck={false} autoCorrect="off" autoCapitalize="off" /><button type="submit" className="icon-button" aria-label="开始调试"><LegadoIcon name="ic_search" /></button></form>{busy && <IconButton label="停止调试" onClick={stop}><LegadoIcon name="ic_stop_black_24dp" /></IconButton>}<IconButton label="调试菜单" onClick={() => setMenu(!menu)}><LegadoIcon name="ic_more_vert" /></IconButton></>;
  return <Modal title="调试源" toolbarId="source-debug-toolbar" close={leave}>
    {toolbar && createPortal(actions, toolbar)}
    <div className="source-debugger">
      {menu && <><button className="source-panel-dismiss" aria-label="关闭调试菜单" onClick={() => setMenu(false)} /><div className="source-popup" role="menu" aria-label="调试菜单">{(Object.keys(rawNames) as RawKey[]).map(key => <button key={key} role="menuitem" onClick={() => { setRaw(key); setMenu(false); }}>{rawNames[key]}</button>)}<button role="menuitem" disabled={busy} onClick={() => { setMenu(false); setShowHints(true); void refreshExplore(); }}>刷新发现</button><button role="menuitem" onClick={() => { setMenu(false); setHelp(true); }}>帮助</button></div></>}
      {showHints ? <div className="source-debug-hints">
        <p>调试搜索&gt;&gt;输入关键字，如：</p><div><button onClick={() => void run(source.ruleSearch?.checkKeyWord || '我的')}>{source.ruleSearch?.checkKeyWord || '我的'}</button><button onClick={() => void run('系统')}>系统</button></div>
        <p>调试发现&gt;&gt;输入发现URL，如：</p>{exploreError && <p role="alert" className="warning">{exploreError}</p>}{kinds.length > 1 && <select aria-label="选择发现" value={kind} onChange={event => setKind(Number(event.target.value))}>{kinds.map((item, index) => <option key={index} value={index}>{item.title}</option>)}</select>}<button disabled={!kinds[kind]} onClick={() => { const item = kinds[kind]; if (item) void run(`${item.title}::${item.url}`); }}>{kinds[kind] ? `${kinds[kind].title}::${kinds[kind].url}` : '未配置发现'}</button>
        <p>调试详情页&gt;&gt;输入详情页URL，如：</p><button onClick={() => { if (input.trim()) void run(); else field.current?.focus(); }}>https://m.qidian.com/book/1015609210</button>
        <p>调试目录页&gt;&gt;输入目录页URL，如：</p><button onClick={() => prefix('++')}>++https://www.zhaishuyuan.com/read/30394</button>
        <p>调试正文页&gt;&gt;输入正文页URL，如：</p><button onClick={() => prefix('--')}>--https://www.zhaishuyuan.com/chapter/30394/20940996</button>
        {!!rows.length && <button onClick={() => { field.current?.blur(); setShowHints(false); }}>返回调试日志</button>}
      </div> : <><p className="source-debug-state" role="status">{busy ? '正在解析…' : '调试结束'}</p><ol className="source-debug-log">{rows.map((row, index) => <li key={index}><time>{new Date(row.time).toLocaleTimeString('zh-CN', { hour12: false })}</time><pre>{row.text}</pre></li>)}</ol></>}
    </div>
    {raw && <Modal title={rawNames[raw]} close={() => setRaw(null)}><div className="source-debug-raw">{responses[raw] ? <><p>{responses[raw]!.url}</p><pre>{responses[raw]!.body}</pre></> : <p>暂无源码</p>}</div></Modal>}
    {help && <SourceHelp topic="debug" close={() => setHelp(false)} />}
  </Modal>;
}
