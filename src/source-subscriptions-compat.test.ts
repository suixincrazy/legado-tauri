import {createRequire} from 'node:module';
import {expect,it} from 'vitest';

it('preserves 64-bit subscription IDs on WebViews without JSON source context or rawJSON',async()=>{
  const descriptors=Object.getOwnPropertyDescriptors(JSON),parse=JSON.parse,require=createRequire(import.meta.url);
  JSON.parse=(text,reviver)=>parse(text,reviver?function(key,value){return reviver.call(this,key,value);}:undefined);
  Reflect.deleteProperty(JSON,'rawJSON');Reflect.deleteProperty(JSON,'isRawJSON');
  try{
    require('core-js/actual/json/parse');require('core-js/actual/json/raw-json');
    const {parseSubscriptions,serializeSubscriptions}=await import('./source-subscriptions');
    const text='[{"id":9223372036854775806,"url":"https://subscriptions.example.test/first"},{"id":9223372036854775807,"url":"https://subscriptions.example.test/second"}]';
    const rows=parseSubscriptions(text);expect(rows.map(row=>row.id)).toEqual(['9223372036854775806','9223372036854775807']);
    expect(serializeSubscriptions(rows)).toBe(text);
  }finally{for(const name of Object.getOwnPropertyNames(JSON))if(!(name in descriptors))Reflect.deleteProperty(JSON,name);Object.defineProperties(JSON,descriptors);}
});
