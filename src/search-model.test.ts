import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { defaultSearchOptions, groupSearchResults, mergeSearchResults, searchSources } from './search-model';
import type { SearchResult, Source } from './model';
const result: SearchResult = { name:'书名',author:'作者',url:'https://example.org/1',sourceUrl:'one',sourceName:'源一',category:'奇幻' };
describe('search scope and results',()=>{
  it('restricts search to enabled sources in selected groups or explicit sources',()=>{
    const sources: Source[]=[{bookSourceUrl:'one',bookSourceName:'一',bookSourceGroup:'甲,乙'},{bookSourceUrl:'two',bookSourceName:'二',bookSourceGroup:'甲',enabled:false},{bookSourceUrl:'three',bookSourceName:'三',bookSourceGroup:'丙'}];
    expect(searchSources(sources,{...defaultSearchOptions,scope:'groups',selected:['乙']})).toEqual([sources[0]]);
    expect(searchSources(sources,{...defaultSearchOptions,scope:'sources',selected:['two','three']})).toEqual([sources[2]]);
    expect(searchSources(sources,defaultSearchOptions,sources[1])).toEqual([sources[1]]);
  });
  it('deduplicates repeated pages without discarding alternatives from other sources',()=>{
    const other={...result,sourceUrl:'two',sourceName:'源二'};
    const merged=mergeSearchResults([result],[{...result,intro:'updated'},other]);
    expect(merged).toHaveLength(2);expect(merged[0].intro).toBe('updated');
    expect(groupSearchResults(merged,'书',defaultSearchOptions)).toEqual([merged]);
  });
  it('applies exact name/author matching and case-insensitive exclusions to categories',()=>{
    expect(groupSearchResults([result],'书',{...defaultSearchOptions,precise:true})).toEqual([]);
    expect(groupSearchResults([result],'作者',{...defaultSearchOptions,precise:true})).toHaveLength(1);
    expect(groupSearchResults([{...result,category:'FANTASY'}],'',{...defaultSearchOptions,exclusions:'fantasy\n排除词'})).toEqual([]);
  });
});
