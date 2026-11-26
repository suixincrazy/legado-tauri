import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';

it('renders every bundled help page on WebViews without Array.at',async()=>{
  const original=Object.getOwnPropertyDescriptor(Array.prototype,'at')!;
  const require=createRequire(import.meta.url);
  Reflect.deleteProperty(Array.prototype,'at');
  // Restore synchronously before Vitest's own module runner needs Array.at.
  require('core-js/actual/array/at');
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try{
    const {SourceHelp}=await import('./SourceHelp');
    for(const topic of ['backup','manager','debug','rules'] as const){
      await act(async()=>root.render(createElement(SourceHelp,{topic,close:vi.fn()})));
      expect(host.querySelector('article')!.textContent!.length).toBeGreaterThan(100);
      expect(host.querySelectorAll('script')).toHaveLength(0);
      expect(host.querySelectorAll('a[target="_blank"]:not([rel="noopener noreferrer"])')).toHaveLength(0);
    }
    expect([1,2].at(-1)).toBe(2);
  }finally{
    await act(async()=>root.unmount());host.remove();Object.defineProperty(Array.prototype,'at',original);
    delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
