import type { Source } from './model';
import type { ExploreKind } from './sources';

export async function exploreUi(source:Source,items:ExploreKind[],change?:{title:string;value?:string;action?:string}) {
  const {SourceRuntime}=await import('./source-runtime');
  const vm=new SourceRuntime(source);
  try {
    await vm.initialize();
    if(change?.value!==undefined) await vm.evaluate(`infoMap.put(${JSON.stringify(change.title)},${JSON.stringify(change.value)})`);
    if(change?.action) await vm.evaluate(change.action.replace(/^@js:|^<js>|<\/js>$/gi,''));
    const values=await vm.evaluate('JSON.parse(JSON.stringify(__infoValues))') as Record<string,string>;
    const labels:string[]=[];
    for(const item of items) {
      if(['toggle','select'].includes(item.type||'')&&!values[item.title]) {
        values[item.title]=item.default??item.chars?.[0]??'';
        await vm.evaluate(`infoMap.put(${JSON.stringify(item.title)},${JSON.stringify(values[item.title])})`);
      }
      try { labels.push(item.viewName?String(await vm.evaluate(item.viewName)):item.title); }
      catch { labels.push('err'); }
    }
    await vm.evaluate('infoMap.saveNow()');
    return {values,labels,refresh:vm.loginEvents.some(event=>event.type==='refresh'),logs:vm.logs};
  } finally { await vm.close(); }
}
