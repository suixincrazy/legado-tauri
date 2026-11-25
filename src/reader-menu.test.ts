import { expect,it } from 'vitest';
import { finishReaderSelection,normalizeReaderMenu,placeReaderAction,readerMenuKeys,reorderReaderAction,selectReaderRange } from './reader-menu';

it('keeps user ordering, removes duplicates and appends newly introduced official actions',()=>{
  const config=normalizeReaderMenu({primary:['editContent','unknown','editContent'],more:['bookmark','editContent']});expect(config.primary[0]).toBe('editContent');expect(config.more).toEqual(['bookmark']);expect([...config.primary,...config.more]).toHaveLength(readerMenuKeys.length);expect(normalizeReaderMenu('{bad')).toEqual(normalizeReaderMenu(null));
});
it('slides through mixed selections, reverses the traversed range and regroups only at the end',()=>{
  const config={primary:['bookmark','editContent'] as const,more:['highlightRule','pageAnim'] as const},order=[...config.primary,...config.more];
  let selection=selectReaderRange({order,start:1,end:-1,firstSelected:true,selected:new Set(config.primary)},1);
  selection=selectReaderRange(selection,3);expect([...selection.selected]).toEqual(['bookmark']);
  selection=selectReaderRange(selection,2);expect([...selection.selected]).toEqual(['bookmark','pageAnim']);
  expect(finishReaderSelection({primary:[...config.primary],more:[...config.more]},selection.selected)).toEqual({primary:['bookmark','pageAnim'],more:['editContent','highlightRule']});
  expect(selectReaderRange(selection,2)).toBe(selection);
});
it('moves actions to the end of their group and prevents dragging across groups',()=>{
  const initial=normalizeReaderMenu(null),moved=placeReaderAction(initial,'bookmark',false);expect(moved.more).toEqual(['bookmark']);expect(reorderReaderAction(moved,'editContent','bookmark')).toBe(moved);const reordered=reorderReaderAction(moved,'editContent','highlightRule');expect(reordered.primary.slice(0,2)).toEqual(['editContent','highlightRule']);expect(placeReaderAction(reordered,'bookmark',true).primary.at(-1)).toBe('bookmark');
});
