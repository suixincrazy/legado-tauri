import { useState } from 'react';
import type { Source } from './model';
import { parseSources } from './sources';

const sections: [string, string, string[]][] = [
  ['基本', '', ['bookSourceName', 'bookSourceUrl', 'bookSourceGroup', 'bookSourceComment', 'bookUrlPattern', 'header', 'concurrentRate', 'variableComment', 'jsLib']],
  ['登录', '', ['loginUrl', 'loginUi', 'loginCheckJs']],
  ['搜索', 'ruleSearch', ['searchUrl', 'bookList', 'name', 'author', 'kind', 'wordCount', 'lastChapter', 'intro', 'coverUrl', 'bookUrl', 'checkKeyWord']],
  ['发现', 'ruleExplore', ['exploreUrl', 'bookList', 'name', 'author', 'kind', 'wordCount', 'lastChapter', 'intro', 'coverUrl', 'bookUrl']],
  ['详情', 'ruleBookInfo', ['init', 'name', 'author', 'intro', 'kind', 'wordCount', 'lastChapter', 'coverUrl', 'tocUrl', 'canReName']],
  ['目录', 'ruleToc', ['chapterList', 'chapterName', 'chapterUrl', 'isVolume', 'isVip', 'isPay', 'updateTime', 'nextTocUrl']],
  ['正文', 'ruleContent', ['content', 'nextContentUrl', 'replaceRegex', 'webJs', 'sourceRegex', 'imageStyle', 'payAction']],
];
const labels: Record<string, string> = { bookSourceName: '书源名称', bookSourceUrl: '书源地址 / 唯一标识', bookSourceGroup: '分组（逗号分隔）', bookSourceComment: '书源说明', bookUrlPattern: '详情地址匹配', header: '请求头', concurrentRate: '并发率', variableComment: '变量说明', jsLib: '公共 JavaScript 库', loginUrl: '登录地址 / 登录脚本', loginUi: '登录界面', loginCheckJs: '登录检查脚本', searchUrl: '搜索地址', exploreUrl: '发现地址', bookList: '书籍列表', name: '书名', author: '作者', kind: '分类', wordCount: '字数', lastChapter: '最新章节', intro: '简介', coverUrl: '封面', bookUrl: '详情地址', checkKeyWord: '校验关键词', init: '详情初始化', tocUrl: '目录地址', canReName: '允许重命名', chapterList: '章节列表', chapterName: '章节名称', chapterUrl: '章节地址', isVolume: '卷名规则', isVip: 'VIP 规则', isPay: '付费规则', updateTime: '更新时间', nextTocUrl: '下一页目录', content: '正文规则', nextContentUrl: '下一页正文', replaceRegex: '正文替换', webJs: '网页脚本', sourceRegex: '资源匹配', imageStyle: '图片样式', payAction: '购买章节动作' };
export function SourceEditor({ source, save, cancel }: { source: Source; save: (source: Source) => Promise<void>; cancel: () => void }) {
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
  return <div className="source-editor"><div className="source-actions"><button className="outlined" onClick={cancel}>返回管理</button><button className="primary" disabled={busy} onClick={persist}>保存书源</button></div>
    <nav className="source-section-tabs" aria-label="书源编辑栏目">{[...sections.map(s => s[0]), 'JSON'].map(name => <button key={name} aria-pressed={section === name} onClick={() => choose(name)}>{name}</button>)}</nav>
    {error && <p role="alert" className="warning">{error}</p>}
    {section === 'JSON' ? <label className="field">完整书源 JSON<textarea className="code-editor" aria-label="完整书源 JSON" spellCheck={false} value={json} onChange={e => setJson(e.target.value)} /></label> : <>
      {section === '基本' && <div className="source-actions"><label>书源类型 <select aria-label="书源类型" value={draft.bookSourceType || 0} onChange={e => setDraft({ ...draft, bookSourceType: +e.target.value })}><option value={0}>文字</option><option value={1}>音频</option><option value={2}>图片</option><option value={3}>文件</option></select></label><label><input type="checkbox" checked={draft.enabled !== false} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />启用书源</label><label><input type="checkbox" checked={draft.enabledExplore !== false} onChange={e => setDraft({ ...draft, enabledExplore: e.target.checked })} />启用发现</label><label><input type="checkbox" checked={draft.enabledCookieJar !== false} onChange={e => setDraft({ ...draft, enabledCookieJar: e.target.checked })} />Cookie 管理</label></div>}
      {fields.map(key => {
        const nested = group && !['searchUrl', 'exploreUrl'].includes(key);
        const value = nested ? (draft[group] as Record<string, unknown> | undefined)?.[key] : draft[key];
        const change = (text: string) => setDraft(old => nested ? { ...old, [group]: { ...old[group] as object, [key]: text } } : { ...old, [key]: text });
        return <label className="field" key={key}>{labels[key] || key}<small>{key}</small><textarea aria-label={labels[key] || key} className={['jsLib', 'loginUrl', 'loginUi', 'webJs'].includes(key) ? 'code-editor' : 'rule-editor'} spellCheck={false} value={String(value ?? '')} onChange={e => change(e.target.value)} /></label>;
      })}
    </>}
  </div>;
}
