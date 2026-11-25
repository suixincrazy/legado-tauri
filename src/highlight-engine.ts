import { createId, type Book, type BookHighlight } from './model';

export type HighlightStyle = {
  fill?:number;fillShape?:'RECTANGLE'|'ROUNDED'|'MARKER'|'HALF'|'BASELINE'|'PILL';textColor?:number;bold?:boolean;italic?:boolean;
  underline?:{kind:'SOLID'|'WAVY'|'DASHED'|'DOTTED'|'DOUBLE';color:number;width:number;distance:number}|null;
  strike?:{color:number}|null;box?:{color:number}|null;emphasis?:{color:number}|null;shadow?:{radius:number;dx:number;dy:number;color:number}|null;
  fontPath?:string;fontSize?:number|null;letterSpacing?:number|null;horizontalPadding?:number|null;reserveTextSpace?:boolean;pillPaddingScale?:number|null;
};
export type HighlightRule = {id:number;uuid:string;name:string;pattern:string;isRegex:boolean;scope:string;isEnabled:boolean;style:string;order:number;timeoutMillisecond:number;group:string;applyToTitle:boolean;applyToBody:boolean};
export type HighlightRange = {start:number;end:number;style:HighlightStyle;ruleUuid?:string;time?:number};
export const highlightPresets:HighlightStyle[]=[{fill:0x80FFF176},{fill:0x804FC3F7,fillShape:'ROUNDED'},{fill:0x8069F0AE,fillShape:'HALF'},{underline:{kind:'WAVY',color:0xFFE53935,width:1,distance:0}},{underline:{kind:'SOLID',color:0xFF1E88E5,width:1,distance:0},bold:true},{strike:{color:0xFF9E9E9E}},{emphasis:{color:0xFFE53935}}];
const clamp=(value:number,min:number,max:number)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):min;
export function highlightStyle(value:string|HighlightStyle):HighlightStyle {
  let style:HighlightStyle;try{style=typeof value==='string'?JSON.parse(value||'{}'):value;}catch{return {};}
  if(!style||typeof style!=='object')return {};
  const next={...style};
  if(next.underline)next.underline={kind:next.underline.kind||'SOLID',color:next.underline.color||0,width:clamp(next.underline.width??1,0,10),distance:clamp(next.underline.distance??0,0,30)};
  if(next.shadow)next.shadow={color:next.shadow.color||0,radius:clamp(next.shadow.radius,0,10),dx:clamp(next.shadow.dx,-10,10),dy:clamp(next.shadow.dy,-10,10)};
  if(next.fontSize!=null)next.fontSize=clamp(next.fontSize,5,100);
  if(next.letterSpacing!=null)next.letterSpacing=clamp(next.letterSpacing,-.5,1);
  if(next.horizontalPadding!=null)next.horizontalPadding=clamp(next.horizontalPadding,0,64);
  if(next.pillPaddingScale!=null)next.pillPaddingScale=clamp(next.pillPaddingScale,.25,2);
  return next;
}
export const newHighlightRule=(pattern='',scope='',style=highlightPresets[0]):HighlightRule=>({id:Date.now(),uuid:createId().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5'),name:'',pattern,isRegex:false,scope,isEnabled:true,style:JSON.stringify(style),order:0,timeoutMillisecond:3000,group:'',applyToTitle:false,applyToBody:true});
export function parseHighlightRules(text:string):HighlightRule[] {
  const data=JSON.parse(text),items=data?.type==='highlightRule'?data.rules:Array.isArray(data)?data:[data];
  if(!Array.isArray(items))throw new Error('高亮规则格式错误');
  const seen=new Set<string>();
  return items.map((value,index)=>{if(!value||typeof value.pattern!=='string'||!value.pattern)throw new Error(`第 ${index+1} 条高亮规则缺少匹配内容`);if(value.isRegex)new RegExp(value.pattern,'g');const fallback=newHighlightRule(),uuid=typeof value.uuid==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.uuid)?value.uuid.toLowerCase():fallback.uuid;if(seen.has(uuid))throw new Error('高亮规则UUID重复');seen.add(uuid);return {...fallback,...value,id:Number.isFinite(value.id)?value.id:fallback.id+index,uuid,name:String(value.name||''),scope:String(value.scope||''),group:String(value.group||'').trim(),isEnabled:value.isEnabled!==false,isRegex:!!value.isRegex,applyToTitle:!!value.applyToTitle,applyToBody:value.applyToBody!==false,order:Number.isFinite(value.order)?value.order:index,timeoutMillisecond:clamp(value.timeoutMillisecond||3000,100,30000),style:JSON.stringify(highlightStyle(value.style||{}))};});
}
export function mergeHighlightRules(current:HighlightRule[],incoming:HighlightRule[]) {
  const map=new Map(current.map(rule=>[rule.uuid,rule]));
  for(const rule of incoming){const old=map.get(rule.uuid);map.set(rule.uuid,old?{...rule,id:old.id,order:old.order}:rule);}
  return [...map.values()].sort((a,b)=>a.order-b.order||a.id-b.id);
}
export const scopedHighlightRules=(rules:HighlightRule[],book:Pick<Book,'name'|'sourceUrl'>)=>rules.filter(rule=>rule.isEnabled&&(!rule.scope||!!book.name&&rule.scope.includes(book.name)||!!book.sourceUrl&&rule.scope.includes(book.sourceUrl))).sort((a,b)=>a.order-b.order||a.id-b.id);
export function matchHighlightRule(text:string,rule:HighlightRule,titleLength=0):HighlightRange[] {
  const segments=rule.applyToTitle&&rule.applyToBody?[[0,text.length]]:rule.applyToTitle?[[0,titleLength]]:rule.applyToBody?[[titleLength,text.length]]:[];
  const result:HighlightRange[]=[],style=highlightStyle(rule.style);
  for(const [base,end] of segments){const input=text.slice(base,end);if(!rule.pattern)continue;if(rule.isRegex){const regex=new RegExp(rule.pattern,'g');let match;while((match=regex.exec(input))&&result.length<10000){if(match[0].length)result.push({start:base+match.index,end:base+match.index+match[0].length,style,ruleUuid:rule.uuid});else regex.lastIndex++;}}else{let from=0,hit;while((hit=input.indexOf(rule.pattern,from))>=0&&result.length<10000){result.push({start:base+hit,end:base+hit+rule.pattern.length,style,ruleUuid:rule.uuid});from=hit+rule.pattern.length;}}}
  return result;
}
export function mergeHighlightStyle(base:HighlightStyle,other:HighlightStyle):HighlightStyle {
  const next={...base,bold:!!(base.bold||other.bold),italic:!!(base.italic||other.italic)};
  if(other.fill){next.fill=other.fill;next.fillShape=other.fillShape;next.pillPaddingScale=other.pillPaddingScale;}
  if(other.textColor)next.textColor=other.textColor;
  for(const key of ['underline','strike','box','emphasis','shadow','fontPath'] as const)if(other[key])(next as Record<string,unknown>)[key]=other[key];
  for(const key of ['fontSize','letterSpacing','horizontalPadding'] as const)if(other[key]!=null)next[key]=other[key];
  if(other.horizontalPadding!=null)next.reserveTextSpace=other.reserveTextSpace;
  return next;
}
export function anchoredHighlight(text:string,mark:BookHighlight,titleLength:number):HighlightRange|null {
  const oldTitle=mark.layoutTitleLength>=0?mark.layoutTitleLength:titleLength;
  let start=mark.chapterPos-oldTitle+titleLength,end=mark.chapterPosEnd-oldTitle+titleLength;
  if(mark.bookText&&end-start===mark.bookText.length&&text.slice(start,end)!==mark.bookText){const hit=text.indexOf(mark.bookText,titleLength);if(hit<0)return null;if(text.indexOf(mark.bookText,hit+1)<0){start=hit;end=hit+mark.bookText.length;}}
  return start<0||end<=start||end>text.length?null:{start,end,style:highlightStyle(mark.style),time:mark.time};
}
export function highlightSegments(text:string,start:number,ranges:HighlightRange[]) {
  const end=start+text.length,active=ranges.filter(range=>range.start<end&&range.end>start),points=[...new Set([start,end,...active.flatMap(range=>[Math.max(start,range.start),Math.min(end,range.end)])])].sort((a,b)=>a-b);
  return points.slice(0,-1).map((point,index)=>{const matches=active.filter(range=>range.start<points[index+1]&&range.end>point);return {text:text.slice(point-start,points[index+1]-start),start:point,style:matches.reduce((style,range)=>mergeHighlightStyle(style,range.style),{} as HighlightStyle),matches};});
}
export function readingParagraphs(content:string,titleLength=0){let start=titleLength;return content.split('\n').map(line=>line.trim()).filter(Boolean).map(text=>{const value={text,start};start+=text.length+1;return value;});}
