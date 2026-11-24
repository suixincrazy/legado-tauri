import { useEffect, useState } from 'react';
import type { Source } from './model';
import * as storage from './storage';
import { SourceRuntime } from './source-runtime';

type LoginField = { name: string; type?: string; action?: string };
export function SourceSettings({ source, done, notify }: { source: Source; done: () => void; notify: (text: string) => void }) {
  const [fields, setFields] = useState<LoginField[]>([]), [values, setValues] = useState<Record<string, string>>({});
  const [variable, setVariable] = useState(''), [cookie, setCookie] = useState(''), [headers, setHeaders] = useState('{}');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let alive = true; (async () => {
    const state = await storage.sourceState(source.bookSourceUrl); if (!alive) return;
    setValues(JSON.parse(String(state['source:loginInfo']?.value || '{}'))); setVariable(String(state['source:variable']?.value || '')); setHeaders(String(state['source:loginHeader']?.value || '{}'));
    try { setCookie(String(state[`cookie:${new URL(source.bookSourceUrl).origin}`]?.value || '')); } catch { /* Some source keys are labels. */ }
    if (source.loginUi && !source.loginUi.startsWith('@js:')) { const parsed = JSON.parse(source.loginUi); if (Array.isArray(parsed)) setFields(parsed); }
  })().catch(e => setError(String(e))); return () => { alive = false; }; }, [source]);
  const persist = async () => {
    const parsed = JSON.parse(headers || '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求头需要 JSON 对象');
    const state: Record<string, { value: unknown }> = { 'source:loginInfo': { value: JSON.stringify(values) }, 'source:variable': { value: variable }, 'source:loginHeader': { value: JSON.stringify(parsed) } };
    if (/^https?:/.test(source.bookSourceUrl)) state[`cookie:${new URL(source.bookSourceUrl).origin}`] = { value: cookie };
    await storage.saveSourceState(source.bookSourceUrl, state);
  };
  const action = async (code?: string) => {
    setBusy(true); setError(''); let vm: SourceRuntime | undefined;
    try {
      await persist();
      if (code) {
        vm = await new SourceRuntime(source).initialize();
        if (source.loginUrl && !/^https?:/.test(source.loginUrl)) await vm.evaluate(source.loginUrl.replace(/^@js:|^<js>|<\/js>$/g, ''));
        await vm.evaluate(code); if (vm.logs.length) notify(vm.logs[vm.logs.length - 1]);
      } else { notify('书源设置已保存'); done(); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { await vm?.close(); setBusy(false); }
  };
  return <div className="source-paste">
    {fields.filter(f => f.type !== 'button').map(f => <label key={f.name}>{f.name}<input aria-label={f.name} type={f.type === 'password' ? 'password' : 'text'} value={values[f.name] || ''} onChange={e => setValues({ ...values, [f.name]: e.target.value })} /></label>)}
    <label>书源变量<input aria-label="书源变量" value={variable} onChange={e => setVariable(e.target.value)} /></label>
    <label>Cookie<textarea aria-label="书源 Cookie" value={cookie} onChange={e => setCookie(e.target.value)} /></label>
    <label>登录请求头<textarea aria-label="登录请求头" value={headers} onChange={e => setHeaders(e.target.value)} /></label>
    {!fields.some(f => f.type !== 'button') && <label>登录信息 JSON<textarea aria-label="登录信息 JSON" defaultValue={JSON.stringify(values)} onBlur={e => { try { setValues(JSON.parse(e.target.value)); setError(''); } catch { setError('登录信息 JSON 格式无效'); } }} /></label>}
    <button className="primary" disabled={busy} onClick={() => action()}>保存</button>
    {fields.filter(f => f.type === 'button' && f.action).map(f => <button className="outlined" key={f.name} disabled={busy} onClick={() => action(f.action)}>{f.name}</button>)}
    {error && <p className="warning">{error}</p>}
  </div>;
}
