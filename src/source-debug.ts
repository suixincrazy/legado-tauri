import { newBook, type Book, type Source } from './model';
import { loadChapter, loadOnlineBook, loadSourceToc, searchSource } from './sources';
import { checkSourceCancelled, type SourceExecution, type SourcePhase } from './source-trace';

export function parseDebugInput(input: string): { phase: SourcePhase; value: string } {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return { phase: 'info', value };
  if (value.includes('::')) return { phase: 'explore', value: value.slice(value.indexOf('::') + 2) };
  if (value.startsWith('++')) return { phase: 'toc', value: value.slice(2) };
  if (value.startsWith('--')) return { phase: 'content', value: value.slice(2) };
  return { phase: 'search', value };
}
export async function debugSource(source: Source, input: string, execution: SourceExecution = {}): Promise<{ book: Book; content: string }> {
  const { phase, value } = parseDebugInput(input);
  if (!value) throw new Error('请输入调试内容');
  checkSourceCancelled(execution.signal);
  let book: Book = { ...newBook('调试', 'online', []), sourceUrl: source.bookSourceUrl };
  if (phase === 'content') book.chapters = [{ title: '调试', url: value }];
  else if (phase === 'toc') book = await loadSourceToc({ ...book, tocUrl: value }, source, execution);
  else {
    const result = phase === 'info' ? { name: '调试', author: '', url: value, sourceUrl: source.bookSourceUrl, sourceName: source.bookSourceName } : (await searchSource(source, phase === 'search' ? value : '', phase === 'explore', phase === 'explore' ? value : undefined, 1, execution))[0];
    if (!result) throw new Error('未获取到书籍');
    book = await loadOnlineBook(result, source, execution);
  }
  checkSourceCancelled(execution.signal);
  const index = book.chapters.findIndex(chapter => !(chapter.isVolume && chapter.url?.startsWith(chapter.title)));
  if (index < 0) throw new Error('没有正文章节');
  book.chapter = index;
  const content = await loadChapter(book.chapters[index], source, book, execution);
  checkSourceCancelled(execution.signal);
  return { book, content };
}
