import { useEffect, useState } from 'react';
import type { Source } from './model';
import { exploreKinds, type ExploreKind } from './sources';
import { safeSourceError } from './source-management';

export function SourceDiscover({ source, browse, login }: { source: Source; browse: (url: string) => void; login: () => void }) {
  const [items, setItems] = useState<ExploreKind[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true; setBusy(true); setError('');
    exploreKinds(source).then(value => { if (current) setItems(value); }).catch(e => { if (current) setError(safeSourceError(e)); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [source, revision]);
  return <div><div className="source-actions"><button className="outlined" onClick={login}>登录 / 设置</button><button className="outlined" disabled={busy} onClick={() => setRevision(n => n + 1)}>刷新分类</button></div>
    {busy && <p role="status">正在读取发现分类…</p>}{error && <p role="alert" className="warning">{error}</p>}
    <div className="explore-kinds">{items.map((item, index) => item.url ? <button className="outlined" key={index} onClick={() => browse(item.url!)}>{item.title}</button> : <p className="subtle" key={index}>{item.title}</p>)}</div>
    {!busy && !error && !items.length && <p className="subtle">书源没有返回发现分类。</p>}
  </div>;
}
