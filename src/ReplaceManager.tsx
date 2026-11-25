import { useEffect, useState } from 'react';
import { LegadoIcon } from './LegadoIcon';
import { pickFiles, saveFile } from './files';
import { decodeText } from './import';
import * as storage from './storage';
import { applyReplacement, newReplaceRule, parseReplaceRules, type ReplaceRule } from './replacement';

export function ReplaceManager({ notify }: { notify: (message: string) => void }) {
  const [rules, setRules] = useState<ReplaceRule[]>([]), [draft, setDraft] = useState<ReplaceRule | null>(null);
  const [filter, setFilter] = useState(''), [selected, setSelected] = useState(new Set<number>()), [output, setOutput] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { storage.preference<ReplaceRule[]>('replaceRules', []).then(setRules); }, []);
  const persist = async (next: ReplaceRule[]) => { await storage.put('settings', 'replaceRules', next); setRules(next); };
  const run = async (action: () => Promise<void>) => { try { await action(); } catch (e) { notify(String(e)); } };
  if (draft) return <div className="rule-editor-page"><div className="source-actions"><button className="text-button" onClick={() => { setDraft(null); setOutput(''); }}>取消</button><button className="text-button" onClick={() => run(async () => { const value = parseReplaceRules(JSON.stringify(draft))[0]; await persist([...rules.filter(r => r.id !== value.id), value].sort((a,b) => a.order-b.order)); setDraft(null); setOutput(''); })}>保存</button></div>
    {([['name','名称'],['group','分组'],['pattern','替换内容'],['replacement','替换为'],['scope','作用范围'],['excludeScope','排除范围']] as const).map(([key,label]) => <label className="field" key={key}>{label}<textarea aria-label={label} value={draft[key] || ''} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
    <div className="source-actions">{([['isRegex','正则'],['scopeTitle','标题'],['scopeContent','正文'],['isEnabled','启用']] as const).map(([key,label]) => <label key={key}><input type="checkbox" checked={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.checked })} />{label}</label>)}</div>
    <label className="field">测试文本<textarea aria-label="测试文本" value={draft.previewText || ''} onChange={e => setDraft({ ...draft, previewText: e.target.value })} /></label><button className="text-button" onClick={() => run(async () => setOutput(await applyReplacement(draft.previewText || '', [draft])))}>测试替换</button><pre className="replace-preview" aria-label="替换结果">{output}</pre>
  </div>;
  const visible = rules.filter(r => `${r.name} ${r.group || ''}`.includes(filter));
  return <div className="rule-manager"><div className="source-actions"><input aria-label="搜索替换规则" placeholder="搜索替换规则" value={filter} onChange={e => setFilter(e.target.value)} /><button className="icon-button" aria-label="新建替换规则" onClick={() => setDraft(newReplaceRule())}><LegadoIcon name="ic_add" /></button><button className="text-button" onClick={() => run(async () => { const files = await pickFiles(['json']); if (files[0]) { const incoming = parseReplaceRules(decodeText(files[0].bytes)); const map = new Map(rules.map(r => [r.id,r])); incoming.forEach(r => map.set(r.id,r)); await persist([...map.values()]); } })}>导入</button><button className="text-button" onClick={() => run(async () => { await saveFile('replaceRule.json', JSON.stringify(selected.size ? rules.filter(r => selected.has(r.id)) : rules, null, 2)); })}>导出</button></div>
    {visible.map(rule => <div className="rule-row" key={rule.id}><input type="checkbox" aria-label={`选择 ${rule.name}`} checked={selected.has(rule.id)} onChange={() => setSelected(old => { const next = new Set(old); next.has(rule.id) ? next.delete(rule.id) : next.add(rule.id); return next; })} /><button onClick={() => setDraft({ ...rule })}><span>{rule.name}</span><small>{rule.group}</small></button><input type="checkbox" role="switch" aria-label={`启用 ${rule.name}`} checked={rule.isEnabled} onChange={e => run(() => persist(rules.map(r => r.id === rule.id ? { ...r, isEnabled: e.target.checked } : r)))} /><button className="icon-button" aria-label={`编辑 ${rule.name}`} onClick={() => setDraft({ ...rule })}><LegadoIcon name="ic_edit" /></button></div>)}
    {selected.size > 0 && <div className="source-actions"><button className="text-button" onClick={() => run(() => persist(rules.map(r => selected.has(r.id) ? { ...r, isEnabled: true } : r)))}>启用</button><button className="text-button" onClick={() => run(() => persist(rules.map(r => selected.has(r.id) ? { ...r, isEnabled: false } : r)))}>禁用</button><button className="text-button" onClick={() => setConfirm(true)}>删除选中</button><button className="text-button" onClick={() => setSelected(new Set())}>取消选择</button></div>}
    {confirm && <div className="source-confirm"><p>删除选中的 {selected.size} 条规则？</p><button className="text-button" onClick={() => run(async () => { await persist(rules.filter(r => !selected.has(r.id))); setSelected(new Set()); setConfirm(false); })}>删除</button><button className="text-button" onClick={() => setConfirm(false)}>取消</button></div>}
    {!visible.length && <div className="legado-empty">没有替换规则</div>}
  </div>;
}
