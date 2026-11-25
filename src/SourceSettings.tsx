import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Source } from './model';
import * as storage from './storage';
import type { SourceRuntime } from './source-runtime';
import { initializeLogin, isLoginScript, loginDefaults, performLogin, readLoginFields, type LoginField } from './source-login';
import { safeSourceError } from './source-management';
import { clearSourceCookies } from './source-browser';
import { cookieStorageKey } from './source-cookie';

export function SourceSettings({ source, done, notify }: { source: Source; done: () => void; notify: (text: string) => void }) {
  const [fields, setFields] = useState<LoginField[]>([]), [values, setValues] = useState<Record<string, string>>({});
  const [variable, setVariable] = useState(''), [cookie, setCookie] = useState(''), [headers, setHeaders] = useState('{}');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [logs, setLogs] = useState<string[]>([]);
  const [revision, setRevision] = useState(0), [clear, setClear] = useState(false), [loginJson, setLoginJson] = useState('{}');
  const alive = useRef(true), running = useRef(false), pressTime = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { let current = true; (async () => {
    setBusy(true); setError('');
    const state = await storage.sourceState(source.bookSourceUrl);
    const info = JSON.parse(String(state['source:loginInfo']?.value || '{}'));
    if (!current) return;
    setValues(info); setLoginJson(JSON.stringify(info, null, 2)); setVariable(String(state['source:variable']?.value || '')); setHeaders(String(state['source:loginHeader']?.value || '{}'));
    try { setCookie(String(state[`cookie:${cookieStorageKey(source.bookSourceUrl)}`]?.value || '')); } catch { setCookie(''); }
    const {SourceRuntime}=await import('./source-runtime');
    if(!current)return;
    const vm = new SourceRuntime(source, { loginData: info });
    try {
      await initializeLogin(vm, source); const next = await readLoginFields(vm, source);
      if (current) { setFields(next); setValues(loginDefaults(next, info)); if (vm.logs.length) setLogs(vm.logs.map(safeSourceError)); }
    } finally { await vm.close(); }
  })().catch(e => { if (current) setError(safeSourceError(e)); }).finally(() => { if (current) setBusy(false); }); return () => { current = false; }; }, [source, revision]);
  const persist = async (data: Record<string, string>) => {
    const parsed = JSON.parse(headers || '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求头需要 JSON 对象');
    const state: Record<string, { value: unknown }> = { 'source:loginInfo': { value: JSON.stringify(data) }, 'source:variable': { value: variable }, 'source:loginHeader': { value: JSON.stringify(parsed) } };
    if (/^https?:/.test(source.bookSourceUrl)) state[`cookie:${cookieStorageKey(source.bookSourceUrl)}`] = { value: cookie };
    await storage.saveSourceState(source.bookSourceUrl, state);
  };
  const action = async (code?: string, submit = false, data = values, isLongClick = false) => {
    if (busy || running.current) return; running.current = true; setBusy(true); setError(''); let vm: SourceRuntime | undefined;
    try {
      const next = fields.length ? data : JSON.parse(loginJson || '{}');
      if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('登录信息需要 JSON 对象');
      const {SourceRuntime}=await import('./source-runtime');
      await persist(next); vm = new SourceRuntime(source, { loginData: next, isLongClick });
      await performLogin(vm, source, code, submit); await vm.close();
      if (!alive.current) return;
      const state = await storage.sourceState(source.bookSourceUrl);
      setHeaders(String(state['source:loginHeader']?.value || '{}')); setVariable(String(state['source:variable']?.value || ''));
      try { setCookie(String(state[`cookie:${cookieStorageKey(source.bookSourceUrl)}`]?.value || '')); } catch { setCookie(''); }
      let updated = { ...next, ...JSON.parse(String(state['source:loginInfo']?.value || '{}')) }, rebuild = false;
      for (const event of vm.loginEvents) {
        if (event.type === 'data') updated = event.data === null ? loginDefaults(fields, {}) : { ...updated, ...event.data as object };
        if (event.type === 'refresh') rebuild = true;
      }
      if (vm.loginEvents.some(e => e.type === 'data')) await storage.saveSourceState(source.bookSourceUrl, { 'source:loginInfo': { value: JSON.stringify(updated) } });
      setValues(updated); setLoginJson(JSON.stringify(updated, null, 2));
      if (vm.logs.length) { const messages = vm.logs.map(safeSourceError); setLogs(old => [...old, ...messages]); notify(messages[messages.length - 1]); } else notify(submit ? '登录设置已保存' : '操作完成');
      if (rebuild) setRevision(n => n + 1); else if (submit) done();
    } catch (e) { if (alive.current) { const message = safeSourceError(e); setError(message); setLogs(old => [...old, message]); } }
    finally { try { await vm?.close(); } catch (e) { if (alive.current) setError(safeSourceError(e)); } running.current = false; if (alive.current) setBusy(false); }
  };
  const clearCookies = async () => {
    setBusy(true); setError('');
    try {
      await clearSourceCookies(source); setCookie(''); notify('本书源 Cookie 已清除');
    } catch (e) { setError(safeSourceError(e)); } finally { setBusy(false); }
  };
  const update = (field: LoginField, value: string, execute = false) => { const next = { ...values, [field.name]: value }; setValues(next); if (execute && field.action) action(field.action, false, next); };
  const fieldStyle = (field: LoginField): CSSProperties => {
    const basis = Number(field.style?.layout_flexBasisPercent);
    return { flexBasis: basis > 0 && basis <= 1 ? `calc(${basis * 100}% - 8px)` : undefined, flexGrow: Number(field.style?.layout_flexGrow || 0), textAlign: field.style?.layout_justifySelf === 'center' ? 'center' : undefined };
  };
  return <div className="source-settings">
    {source.bookSourceComment && <details><summary>书源说明</summary><p className="source-comment">{source.bookSourceComment}</p></details>}
    {source.loginUrl && !isLoginScript(source) && <button className="primary" disabled={busy} onClick={() => action(`java.startBrowserAwait(${JSON.stringify(source.loginUrl)}, "书源网页登录", false)`)}>打开登录网页</button>}
    {busy && <p role="status">正在处理登录脚本…</p>}
    <div className="login-fields">{fields.map((field, index) => {
      const label = field.viewName || field.name, value = values[field.name] ?? '', options = field.chars || field.options || [];
      if (field.type === 'label') return <p key={index} style={fieldStyle(field)} className="login-field login-label">{label}</p>;
      if (field.type === 'button') return <button key={index} style={fieldStyle(field)} className="outlined login-field" disabled={busy || !field.action} onPointerDown={() => { pressTime.current = Date.now(); }} onContextMenu={e => e.preventDefault()} onClick={e => action(field.action, false, values, e.detail > 0 && Date.now() - pressTime.current >= 666)}>{label}</button>;
      if (field.type === 'select') return <label key={index} style={fieldStyle(field)} className="login-field">{label}<select aria-label={label} value={value} disabled={busy} onChange={e => update(field, e.target.value, true)}>{options.map((option, i) => <option key={i}>{option}</option>)}</select></label>;
      if (field.type === 'toggle') return <button key={index} style={fieldStyle(field)} className="outlined login-field" disabled={busy} aria-label={label} onClick={() => update(field, options[(options.indexOf(value) + 1) % Math.max(1, options.length)] || (value === 'true' ? 'false' : 'true'), true)}>{value} {label}</button>;
      return <label key={index} style={fieldStyle(field)} className="login-field">{label}<input aria-label={label} placeholder={field.hint} disabled={busy} type={field.type === 'password' ? 'password' : 'text'} value={value} onChange={e => update(field, e.target.value)} onBlur={e => { if (field.action && !(e.relatedTarget instanceof HTMLButtonElement)) action(field.action); }} /></label>;
    })}</div>
    <div className="source-actions"><button className="primary" disabled={busy} onClick={() => action(undefined, true)}>保存并确认</button><button className="outlined" disabled={busy} onClick={() => { persist(values).then(() => setRevision(n => n + 1)).catch(e => setError(safeSourceError(e))); }}>刷新登录界面</button></div>
    <details className="source-paste"><summary>变量、Cookie 与登录数据</summary><label className="field">书源变量{source.variableComment && <small>{source.variableComment}</small>}<input aria-label="书源变量" value={variable} onChange={e => setVariable(e.target.value)} /></label><label className="field">Cookie<textarea aria-label="书源 Cookie" value={cookie} onChange={e => setCookie(e.target.value)} /></label><label className="field">登录请求头<textarea aria-label="登录请求头" value={headers} onChange={e => setHeaders(e.target.value)} /></label>{!fields.length && <label className="field">登录信息 JSON<textarea aria-label="登录信息 JSON" value={loginJson} onChange={e => setLoginJson(e.target.value)} /></label>}
      <div className="source-actions"><button disabled={busy} onClick={() => { setHeaders('{}'); storage.saveSourceState(source.bookSourceUrl, { 'source:loginHeader': { value: '{}' } }).catch(e => setError(safeSourceError(e))); }}>清除登录请求头</button><button disabled={busy} onClick={clearCookies}>清除 Cookie</button><button className="danger" disabled={busy} onClick={() => setClear(true)}>清除登录信息</button></div>
    </details>
    {clear && <div role="alert"><p>清除本书源保存的登录信息和请求头？</p><button className="danger-button" onClick={async () => { try { await storage.saveSourceState(source.bookSourceUrl, { 'source:loginInfo': { value: '{}' }, 'source:loginHeader': { value: '{}' } }); setClear(false); setRevision(n => n + 1); } catch (e) { setError(safeSourceError(e)); } }}>确认清除</button><button onClick={() => setClear(false)}>取消</button></div>}
    {error && <p role="alert" className="warning">{error}</p>}{logs.length > 0 && <details><summary>登录日志（{logs.length}）</summary><pre className="source-check-log">{logs.join('\n')}</pre><button onClick={() => setLogs([])}>清空日志</button></details>}
  </div>;
}
