export const readerMenuTitles={bookmark:'添加书签',highlightRule:'高亮规则',editContent:'编辑正文',pageAnim:'翻页动画',getProgress:'拉取云端进度',coverProgress:'覆盖云端进度',reverseContent:'反转正文',simulatedReading:'模拟阅读',replace:'替换管理',sameTitleRemoved:'去除重复标题',reSegment:'重新分段',delRubyTag:'删除ruby标签',delHTag:'删除h标签',imageStyle:'图片样式',reimportSource:'重新导入本书书源',updateToc:'更新目录',effectiveReplaces:'起效的替换',log:'日志',help:'帮助'} as const;
export type ReaderMenuKey=keyof typeof readerMenuTitles;
export type ReaderMenuConfig={primary:ReaderMenuKey[];more:ReaderMenuKey[]};
export const readerMenuKeys=Object.keys(readerMenuTitles) as ReaderMenuKey[];
export function normalizeReaderMenu(value:unknown):ReaderMenuConfig {
  let parsed=value;if(typeof parsed==='string'){try{parsed=JSON.parse(parsed);}catch{parsed=null;}}
  const input=parsed as Partial<ReaderMenuConfig>|null,seen=new Set<ReaderMenuKey>();
  const take=(keys:unknown)=>Array.isArray(keys)?keys.filter((key):key is ReaderMenuKey=>{if(!readerMenuKeys.includes(key)||seen.has(key))return false;seen.add(key);return true;}):[];
  const primary=take(input?.primary),more=take(input?.more);for(const key of readerMenuKeys)if(!seen.has(key))primary.push(key);return {primary,more};
}
export function placeReaderAction(config:ReaderMenuConfig,key:ReaderMenuKey,primary:boolean):ReaderMenuConfig {
  const next={primary:config.primary.filter(item=>item!==key),more:config.more.filter(item=>item!==key)};next[primary?'primary':'more'].push(key);return next;
}
export function reorderReaderAction(config:ReaderMenuConfig,key:ReaderMenuKey,target:ReaderMenuKey):ReaderMenuConfig {
  const group=config.primary.includes(key)?'primary':'more',items=[...config[group]],from=items.indexOf(key),to=items.indexOf(target);
  if(from<0||to<0||from===to)return config;items.splice(from,1);items.splice(to,0,key);return {...config,[group]:items};
}
export type ReaderMenuSelection={order:ReaderMenuKey[];start:number;end:number;firstSelected:boolean;selected:Set<ReaderMenuKey>};
export function selectReaderRange(selection:ReaderMenuSelection,end:number):ReaderMenuSelection {
  if(end<0||end>=selection.order.length||end===selection.end)return selection;
  const selected=new Set(selection.selected),from=Math.min(selection.start,end),to=Math.max(selection.start,end);
  const previousFrom=Math.min(selection.start,selection.end),previousTo=Math.max(selection.start,selection.end);
  selection.order.forEach((key,index)=>{const inside=index>=from&&index<=to,previous=selection.end>=0&&index>=previousFrom&&index<=previousTo;if(!inside&&!previous)return;const checked=inside?!selection.firstSelected:selection.firstSelected;if(checked)selected.add(key);else selected.delete(key);});
  return {...selection,end,selected};
}
export function finishReaderSelection(config:ReaderMenuConfig,selected:Set<ReaderMenuKey>):ReaderMenuConfig {
  const ordered=[...config.primary,...config.more];return {primary:ordered.filter(key=>selected.has(key)),more:ordered.filter(key=>!selected.has(key))};
}
