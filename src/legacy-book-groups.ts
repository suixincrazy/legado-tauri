import 'core-js/actual/json/parse';
import 'core-js/actual/json/raw-json';
import {createId,type BookGroup} from './model';

// Group IDs and memberships are signed 64-bit integers in the original format.
export function parseShelfRows(text:string,field:'group'|'groupId'):any[] {
  return JSON.parse(text,(key,value,context?:{source?:string})=>key===field&&typeof value==='number'&&!Number.isSafeInteger(value)&&context?.source&&/^-?\d+$/.test(context.source)?context.source:value);
}
const minLong=-(1n<<63n);
export function groupBit(value:unknown):bigint {
  if((typeof value==='string'&&/^-?\d+$/.test(value))||(typeof value==='number'&&Number.isSafeInteger(value))){
    const n=BigInt(value);if(n===minLong||n>0n&&n<=-minLong-1n&&(n&(n-1n))===0n)return n;
  }
  return 0n;
}
export function compatibleGroupIds(groups:BookGroup[]) {
  const ids=new Map<string,bigint>();let used=0n;
  for(const g of groups){
    const match=/^legado-group-(-?\d+)$/.exec(g.id);if(!match)continue;
    const n=BigInt(match[1]);if(n<minLong||n>=-minLong)continue;
    ids.set(g.id,n);used|=groupBit(match[1]);
  }
  for(const id of groups.map(g=>g.id).filter(id=>!ids.has(id)).sort()){
    for(let i=0n;i<64n;i++){const bit=BigInt.asIntN(64,1n<<i);if(!(used&bit)){ids.set(id,bit);used|=bit;break;}}
  }
  return ids;
}
export function jsonLong(n:bigint) {
  return Number.isSafeInteger(Number(n))?Number(n):(JSON as any).rawJSON(n.toString());
}
export function newBookGroupId(groups:BookGroup[]):string {
  const used=[...compatibleGroupIds(groups).values()].reduce((mask,id)=>mask|groupBit(id.toString()),0n);
  for(let i=0n;i<64n;i++){const bit=BigInt.asIntN(64,1n<<i);if(!(bit&used))return 'legado-group-'+bit;}
  return createId();
}
export function groupMask(value:unknown):bigint {
  return typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&/^-?\d+$/.test(value)?BigInt(value as string|number):0n;
}
