import 'fake-indexeddb/auto';
import { expect,it } from 'vitest';
import { exploreKinds } from './sources';
import { exploreUi } from './source-explore';
import { type Source } from './model';

it('preserves discovery controls, saves values, evaluates view names and triggers category refresh',async()=>{
  const source:Source={bookSourceUrl:'https://explore-controls.test',bookSourceName:'Controls',exploreUrl:JSON.stringify([{title:'排序',type:'select',chars:['热门','最新'],default:'最新',viewName:'"排序方式"',style:{layout_flexBasisPercent:.5}},{title:'刷新',type:'button',action:'infoMap.put("标记", infoMap.get("排序")); source.refreshExplore();'},{title:'分类',url:'/books'}])};
  const items=await exploreKinds(source);
  expect(items[0]).toMatchObject({type:'select',style:{layout_flexBasisPercent:.5}});
  expect(await exploreUi(source,items)).toMatchObject({values:{'排序':'最新'},labels:['排序方式','刷新','分类']});
  await exploreUi(source,items,{title:'排序',value:'热门'});
  expect(await exploreUi(source,items,{title:'刷新',action:items[1].action})).toMatchObject({values:{'排序':'热门','标记':'热门'},refresh:true});
  expect((await exploreUi(source,items)).values['标记']).toBe('热门');
});
