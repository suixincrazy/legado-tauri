import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Source } from './model';
import { parseSources } from './sources';
import { sections, labels } from './source-editor-fields';
import { safeSourceError } from './source-management';
import { clearSourceCookies } from './source-browser';
import { readClipboardText, writeClipboardText } from './clipboard';
import { fetchText } from './network';
import * as storage from './storage';
import { SourceFieldEditor } from './SourceFieldEditor';
import { IconButton, Modal } from './ui';
import { LegadoIcon } from './LegadoIcon';
import { completeSourceRules } from './source-rule-complete';
import { SourceHelp } from './SourceHelp';
import { SourceDebugger } from './SourceDebugger';
import { shareText } from './sharing';
import { shareQr } from './qr-code';
import { QrScanner } from './QrScanner';

function singleSource(text: string): Source {
  const sources = parseSources(text);
  if (sources.length !== 1) throw new Error('编辑时需要一个书源');
  return sources[0];
}

type FocusedField = { key: string; group: string; input: HTMLTextAreaElement };
export function SourceEditor({ source, save, cancel, toolbar, login, search, notify }: {
  toolbar?: HTMLElement | null; source: Source; save: (source: Source) => Promise<void>; cancel: () => void;
  login: (source: Source) => void; search: (source: Source) => void; notify: (text: string) => void;
}) {
  const [draft, setDraft] = useState<Source>(() => JSON.parse(JSON.stringify(source))), [baseline, setBaseline] = useState(source);
  const [section, setSection] = useState('基本'), [json, setJson] = useState(JSON.stringify(source, null, 2));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [menu, setMenu] = useState(false);
  const [discard, setDiscard] = useState(false), [full, setFull] = useState<(FocusedField & { text: string; start: number; end: number }) | null>(null);
  const [variable, setVariable] = useState<{ source: Source; text: string } | null>(null);
  const [autoComplete, setAutoComplete] = useState(false);
  const [help, setHelp] = useState(false);
  const [debug, setDebug] = useState<Source | null>(null);
  const [scan, setScan] = useState(false);
  const running = useRef(false), focused = useRef<FocusedField | null>(null);
  let dirty = section === 'JSON' ? json !== JSON.stringify(baseline, null, 2) : JSON.stringify(draft) !== JSON.stringify(baseline);
  if (autoComplete && !dirty) {
    try { dirty = JSON.stringify(completeSourceRules(section === 'JSON' ? singleSource(json) : draft)) !== JSON.stringify(baseline); }
    catch { dirty = true; }
  }
  const leave = () => { if (!running.current) { if (dirty) setDiscard(true); else cancel(); } };
  useEffect(() => {
    const page = toolbar?.closest('[role="dialog"]');
    const back = (event: Event) => { event.preventDefault(); if (discard) setDiscard(false); else if (menu) setMenu(false); else leave(); };
    page?.addEventListener('legado-page-back', back);
    return () => page?.removeEventListener('legado-page-back', back);
  }, [toolbar, dirty, discard, menu, cancel]);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setMenu(false);
    try { await action(); } catch (e) { setError(safeSourceError(e)); }
    finally { running.current = false; setBusy(false); }
  };
  const current = () => singleSource(section === 'JSON' ? json : JSON.stringify(draft));
  const output = () => { const value = current(); return autoComplete ? completeSourceRules(value) : value; };
  const saveValue = async () => {
    const value = output();
    if (JSON.stringify(value) !== JSON.stringify(baseline)) value.lastUpdateTime = Date.now();
    await save(value);
    setBaseline(value); setDraft(value); setJson(JSON.stringify(value, null, 2));
    return value;
  };
  const persist = () => run(async () => { await saveValue(); notify('书源已保存'); cancel(); });
  const route = (next: (source: Source) => void) => run(async () => next(await saveValue()));
  const choose = (name: string) => {
    try {
      if (section === 'JSON') setDraft(current()); else setJson(JSON.stringify(draft, null, 2));
      focused.current = null; setSection(name); setError('');
    } catch (e) { setError(safeSourceError(e)); }
  };
  const changeField = (key: string, group: string, text: string) => {
    if (key === '$json') { setJson(text); return; }
    setDraft(old => group ? { ...old, [group]: { ...old[group] as object, [key]: key === 'maxBatchSize' ? (text ? Number(text) : undefined) : text } } : { ...old, [key]: text });
  };
  const editContent = () => {
    const field = focused.current;
    if (!field?.input.isConnected) { notify('请将光标聚焦在文本框'); return; }
    setFull({ ...field, text: field.input.value, start: field.input.selectionStart, end: field.input.selectionEnd });
  };
  const blurField = (target: EventTarget | null) => { if (!(target instanceof HTMLElement) || target.getAttribute('aria-label') !== '编辑内容') focused.current = null; };
  const finishContent = (text: string | undefined, start: number, end: number) => {
    if (!full) return;
    const field = full;
    if (text !== undefined) changeField(field.key, field.group, text);
    setFull(null);
    requestAnimationFrame(() => { field.input.focus(); field.input.setSelectionRange(start, end); });
  };
  const importText = async (text: string) => {
    text = text.trim();
    if (!text) throw new Error('没有可导入的书源');
    if (/^https?:\/\//i.test(text)) text = (await fetchText({ url: text })).body;
    const value = parseSources(text)[0];
    if (!value) throw new Error('没有可粘贴的书源');
    focused.current = null; setDraft(value); setJson(JSON.stringify(value, null, 2));
  };
  const paste = () => run(async () => { const text = await readClipboardText(); if (!text.trim()) throw new Error('剪贴板为空'); await importText(text); });
  const editVariable = () => run(async () => {
    const value = await saveValue(), state = await storage.sourceState(value.bookSourceUrl);
    setVariable({ source: value, text: String(state['source:variable']?.value || '') });
  });
  const [, group, fields] = sections.find(s => s[0] === section) || sections[0];
  const actions = <><span className="source-manager-title">编辑书源</span><button className="icon-button" aria-label="编辑内容" disabled={busy} onPointerDown={event => event.preventDefault()} onClick={editContent}><LegadoIcon name="ic_code" /></button><IconButton label="保存" disabled={busy} onClick={persist}><LegadoIcon name="ic_save" /></IconButton><IconButton label="调试源" disabled={busy} onClick={() => route(setDebug)}><LegadoIcon name="ic_bug_report" /></IconButton><IconButton label="书源编辑菜单" disabled={busy} onClick={() => setMenu(!menu)}><LegadoIcon name="ic_more_vert" /></IconButton></>;
  return <div className="source-editor">
    {toolbar ? createPortal(actions, toolbar) : <div className="source-actions"><button onClick={leave}>返回管理</button>{actions}</div>}
    {menu && <><button className="source-panel-dismiss" aria-label="关闭书源编辑菜单" onClick={() => setMenu(false)} /><div className="source-popup" role="menu" aria-label="书源编辑菜单"><button role="menuitem" onClick={() => route(login)}>登录</button><button role="menuitem" onClick={() => route(search)}>搜索</button><button role="menuitem" onClick={() => run(async () => { const value = section === 'JSON' ? current() : draft; await clearSourceCookies(value); notify('本书源 Cookie 已清除'); })}>清除 Cookie</button><label role="menuitemcheckbox" aria-checked={autoComplete}><input type="checkbox" aria-label="自动补全" checked={autoComplete} onChange={event => setAutoComplete(event.target.checked)} />自动补全</label><button role="menuitem" onClick={() => run(async () => { const raw = section === 'JSON' ? JSON.parse(json) : draft; const value = autoComplete ? completeSourceRules(raw) : raw; await writeClipboardText(JSON.stringify(value, null, 2)); notify('书源已复制'); })}>拷贝源</button><button role="menuitem" onClick={paste}>粘贴源</button><button role="menuitem" onClick={editVariable}>设置源变量</button><button role="menuitem" onClick={() => { setMenu(false); setScan(true); }}>二维码导入</button><button role="menuitem" onClick={() => run(async () => { await shareText(JSON.stringify(output())); })}>字符串分享</button><button role="menuitem" onClick={() => run(async () => { await shareQr(JSON.stringify(output())); })}>二维码分享</button><button role="menuitem" onClick={() => { setMenu(false); setHelp(true); }}>帮助</button></div></>}
    {scan && <QrScanner close={() => setScan(false)} scanned={text => { setScan(false); void run(() => importText(text)); }} />}
    {discard && <Modal title="保存修改" page={false} centered close={() => setDiscard(false)}><p>书源已修改，是否保存？</p><div className="dialog-actions"><button disabled={busy} onClick={cancel}>不保存</button><button disabled={busy} onClick={() => setDiscard(false)}>取消</button><button disabled={busy} onClick={persist}>保存</button></div></Modal>}
    {variable && <Modal title="设置源变量" page={false} centered close={() => { if (!busy) setVariable(null); }}><p>{variable.source.variableComment || '源变量可在js中通过source.getVariable()获取'}</p><label className="field">书源变量<textarea aria-label="书源变量" disabled={busy} value={variable.text} onChange={event => setVariable({ ...variable, text: event.target.value })} /></label><div className="dialog-actions"><button disabled={busy} onClick={() => setVariable(null)}>取消</button><button disabled={busy} onClick={() => run(async () => { await storage.saveSourceState(variable.source.bookSourceUrl, { 'source:variable': { value: variable.text } }); setVariable(null); notify('源变量已保存'); })}>确定</button></div></Modal>}
    <fieldset disabled={busy} className="source-editor-fields"><details className="source-options"><summary>设置<small>{['文字','音频','图片','文件','视频'][draft.bookSourceType || 0]} · {draft.enabled !== false ? '启用' : '禁用'} · {draft.enabledExplore !== false ? '发现' : ''}</small></summary><div className="source-actions"><label>书源类型<select aria-label="书源类型" value={draft.bookSourceType || 0} onChange={e => setDraft({ ...draft, bookSourceType: +e.target.value })}>{['文字','音频','图片','文件','视频'].map((name, index) => <option key={index} value={index}>{name}</option>)}</select></label>{(['enabled','enabledExplore','enabledCookieJar'] as const).map((key, i) => <label key={key}><input type="checkbox" checked={key === 'enabledCookieJar' ? !!draft[key] : draft[key] !== false} onChange={e => setDraft({ ...draft, [key]: e.target.checked })} />{['启用','发现','自动保存 Cookie'][i]}</label>)}</div></details>
      <nav className="source-section-tabs" aria-label="书源编辑栏目">{[...sections.map(s => s[0]), 'JSON'].map(name => <button key={name} aria-pressed={section === name} onClick={() => choose(name)}>{name}</button>)}</nav>
      {section !== 'JSON' && <nav className="source-field-nav" aria-label="规则字段">{fields.map(key => <button key={key} onClick={() => document.getElementById(`source-field-${key}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>{labels[key] || key}</button>)}</nav>}
      {error && <p role="alert" className="warning">{error}</p>}
      {section === 'JSON' ? <label className="field">完整书源 JSON<textarea className="code-editor" aria-label="完整书源 JSON" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={json} onFocus={event => { focused.current = { key: '$json', group: '', input: event.currentTarget }; }} onBlur={event => blurField(event.relatedTarget)} onChange={e => setJson(e.target.value)} /></label> : fields.map(key => {
        const parent = group && !['searchUrl', 'exploreUrl'].includes(key) ? group : '';
        const value = parent ? (draft[parent] as Record<string, unknown> | undefined)?.[key] : draft[key];
        return <label className="field" id={`source-field-${key}`} key={key}>{labels[key] || key}<small>{key}</small><textarea aria-label={labels[key] || key} className={['mainJs', 'jsLib', 'loginUrl', 'loginUi', 'webJs'].includes(key) ? 'code-editor' : 'rule-editor'} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={String(value ?? '')} onFocus={event => { focused.current = { key, group: parent, input: event.currentTarget }; }} onBlur={event => blurField(event.relatedTarget)} onChange={e => changeField(key, parent, e.target.value)} /></label>;
      })}
    </fieldset>
    {full && <SourceFieldEditor label={full.key === '$json' ? '完整书源 JSON' : labels[full.key] || full.key} value={full.text} start={full.start} end={full.end} done={finishContent} />}
    {help && <SourceHelp close={() => setHelp(false)} />}
    {debug && <SourceDebugger source={debug} close={() => setDebug(null)} />}
  </div>;
}
