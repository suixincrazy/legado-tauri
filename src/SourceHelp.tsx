import 'core-js/actual/array/at';
import { useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Modal } from './ui';
import { openSourceBrowser } from './source-browser';
import { safeSourceError } from './source-management';
import rules from './source-rule-help.md?raw';
import debugHelp from './source-debug-help.md?raw';
import managerHelp from './source-manager-help.md?raw';
import backupHelp from './backup-help.md?raw';

export function SourceHelp({ close, topic = 'rules' }: { close: () => void; topic?: 'rules' | 'debug' | 'manager' | 'backup' }) {
  const [error, setError] = useState('');
  const html = useMemo(() => {
    const content = document.createElement('div');
    content.innerHTML = DOMPurify.sanitize(marked.parse(topic === 'backup' ? backupHelp : topic === 'debug' ? debugHelp : topic === 'manager' ? managerHelp : rules, { async: false }), { USE_PROFILES: { html: true } });
    for (const link of content.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    return content.innerHTML;
  }, [topic]);
  return <Modal title={topic === 'backup' ? '备份与恢复帮助' : topic === 'debug' ? '书源调试' : topic === 'manager' ? '书源管理界面帮助' : '源规则帮助'} close={close}>
    {topic==='backup'&&<p>本应用按设置的天数，在启动或返回前台时检查自动备份；同一天同设备的备份会覆盖。以下为原版 WebDAV 配置教程。</p>}
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
