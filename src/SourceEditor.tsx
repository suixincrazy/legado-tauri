import { useState } from 'react';
import type { Source } from './model';
import { parseSources } from './sources';

import { sections, labels } from './source-editor-fields';
import { createPortal } from 'react-dom';
export function SourceEditor({ source, save, cancel, toolbar }: { toolbar?: HTMLElement | null; source: Source; save: (source: Source) => Promise<void>; cancel: () => void }) {
  const [draft, setDraft] = useState<Source>(() => JSON.parse(JSON.stringify(source)));
  const [section, setSection] = useState('基本'), [json, setJson] = useState(JSON.stringify(source, null, 2));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const choose = (name: string) => {
    try { if (section === 'JSON') setDraft(parseSources(json)[0]); else setJson(JSON.stringify(draft, null, 2)); setSection(name); setError(''); }
    catch (e) { setError(String(e)); }
  };
  const persist = async () => {
    setBusy(true);
    try { const value = parseSources(section === 'JSON' ? json : JSON.stringify(draft))[0]; await save({ ...value, lastUpdateTime: Date.now() }); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const [, group, fields] = sections.find(s => s[0] === section) || sections[0];
  return <div className="source-editor">{toolbar ? createPortal(<><span className="source-manager-title">编辑书源</span><button className="text-button" onClick={cancel}>取消</button><button className="text-button" disabled={busy} onClick={persist}>保存</button></>,toolbar) : <div className="source-actions"><button className="text-button" onClick={cancel}>返回管理</button><button className="text-button" disabled={busy} onClick={persist}>保存</button></div>}
    <details className="source-options"><summary>设置<small>{['文字','音频','图片','文件'][draft.bookSourceType || 0]} · {draft.enabled !== false ? '启用' : '禁用'} · {draft.enabledExplore !== false ? '发现' : ''}</small></summary><div className="source-actions"><label>书源类型<select aria-label="书源类型" value={draft.bookSourceType || 0} onChange={e=>setDraft({...draft,bookSourceType:+e.target.value})}><option value={0}>文字</option><option value={1}>音频</option><option value={2}>图片</option><option value={3}>文件</option></select></label>{(['enabled','enabledExplore','enabledCookieJar'] as const).map((key,i)=><label key={key}><input type="checkbox" checked={draft[key] !== false} onChange={e=>setDraft({...draft,[key]:e.target.checked})}/>{['启用','发现','自动保存 Cookie'][i]}</label>)}</div></details><nav className="source-section-tabs" aria-label="书源编辑栏目">{[...sections.map(s => s[0]), 'JSON'].map(name => <button key={name} aria-pressed={section === name} onClick={() => choose(name)}>{name}</button>)}</nav>
    {section !== 'JSON' && <nav className="source-field-nav" aria-label="规则字段">{fields.map(key => <button key={key} onClick={() => document.getElementById(`source-field-${key}`)?.scrollIntoView({block:'start',behavior:'smooth'})}>{labels[key] || key}</button>)}</nav>}
    {error && <p role="alert" className="warning">{error}</p>}
    {section === 'JSON' ? <label className="field">完整书源 JSON<textarea className="code-editor" aria-label="完整书源 JSON" spellCheck={false} value={json} onChange={e => setJson(e.target.value)} /></label> : <>
      {fields.map(key => {
        const nested = group && !['searchUrl', 'exploreUrl'].includes(key);
        const value = nested ? (draft[group] as Record<string, unknown> | undefined)?.[key] : draft[key];
        const change = (text: string) => setDraft(old => nested ? { ...old, [group]: { ...old[group] as object, [key]: key === 'maxBatchSize' ? (text ? Number(text) : undefined) : text } } : { ...old, [key]: text });
        return <label className="field" id={`source-field-${key}`} key={key}>{labels[key] || key}<small>{key}</small><textarea aria-label={labels[key] || key} className={['mainJs', 'jsLib', 'loginUrl', 'loginUi', 'webJs'].includes(key) ? 'code-editor' : 'rule-editor'} spellCheck={false} value={String(value ?? '')} onChange={e => change(e.target.value)} /></label>;
      })}
    </>}
  </div>;
}
