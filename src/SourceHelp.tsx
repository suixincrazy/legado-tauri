import { useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Modal } from './ui';
import { openSourceBrowser } from './source-browser';
import { safeSourceError } from './source-management';
import rules from './source-rule-help.md?raw';

export function SourceHelp({ close }: { close: () => void }) {
  const [error, setError] = useState('');
  const html = useMemo(() => {
    const content = document.createElement('div');
    content.innerHTML = DOMPurify.sanitize(marked.parse(rules, { async: false }), { USE_PROFILES: { html: true } });
    for (const link of content.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    return content.innerHTML;
  }, []);
  return <Modal title="源规则帮助" close={close}>
    {error && <p className="warning" role="alert">{error}</p>}
    <article className="source-rule-help" dangerouslySetInnerHTML={{ __html: html }} onClick={event => {
      const link = (event.target as HTMLElement).closest('a');
      if (!link || !isTauri() || !/^https?:\/\//i.test(link.href)) return;
      event.preventDefault(); setError('');
      void openSourceBrowser({ url: link.href, title: link.textContent || '源规则帮助' }).catch(reason => {
        if (!String(reason).includes('已取消')) setError(safeSourceError(reason));
      });
    }} />
  </Modal>;
}
