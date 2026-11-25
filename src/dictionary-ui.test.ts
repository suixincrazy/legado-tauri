import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { dictionaryMarkup } from './DictManager';
import * as storage from './storage';

it('renders upstream Markdown and isolated button scripts without executing page handlers', () => {
  const rendered=dictionaryMarkup('<md># 字典\n\n**释义**<script>window.evil=true</script><img src="x" onerror="evil()"></md>');
  expect(rendered.html).toContain('<h1>字典</h1>');expect(rendered.html).toContain('<strong>释义</strong>');expect(rendered.html).not.toMatch(/script|onerror/);
  const button=dictionaryMarkup('<button>点击@onclick:java.log(result)</button><a href="javascript:evil()">bad</a>');
  expect(button.actions).toEqual([{name:'点击',script:'java.log(result)'}]);expect(button.html).toContain('data-dict-action="0"');expect(button.html).not.toContain('javascript:');
});
it('restores an empty dictionary list and validates imported rules before modifying settings',async()=>{
  await storage.put('settings','dictRules',[]);
  const text=await storage.backup();await storage.restore(text);expect(await storage.preference('dictRules',null)).toEqual([]);
  const invalid=JSON.parse(text);invalid.managerPreferences.dictRules=[{name:'broken'}];
  await expect(storage.restore(JSON.stringify(invalid))).rejects.toThrow('词典规则');expect(await storage.preference('dictRules',null)).toEqual([]);
});
