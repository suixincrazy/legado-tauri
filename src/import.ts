import { unzipSync, strFromU8 } from 'fflate';
import { newBook, type Book, type Chapter } from './model';
import {formatChapterWordCount} from './chapter-word-count';

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}
export function parseTxt(text: string, filename: string): Book {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const chapters: Chapter[] = [];
  let title = '正文'; let content: string[] = [];
  const flush = () => { const raw=content.join('\n');if (raw.trim()) chapters.push({ title, content: raw.trim(),wordCount:formatChapterWordCount(raw.length) }); content = []; };
  for (const line of lines) {
    if (/^\s*(第[零〇一二三四五六七八九十百千万两\d]{1,12}[章回节卷部篇].{0,50}|chapter\s+\d+.{0,50}|序章|楔子|后记|尾声)\s*$/i.test(line)) { flush(); title = line.trim(); }
    else content.push(line);
  }
  flush();
  if (!chapters.length) throw new Error('文件没有可阅读的文字');
  return newBook(filename.replace(/\.txt$/i, ''), 'txt', chapters);
}
function xml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('EPUB 的 XML 文件损坏');
  return doc;
}
function resolvePath(base: string, relative: string): string {
  const resolved = new URL(relative, 'https://epub.local/' + base);
  return decodeURIComponent(resolved.pathname.slice(1));
}
export function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,iframe,svg').forEach(el => el.remove());
  doc.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  doc.querySelectorAll('p,div,section,h1,h2,h3,h4,li,blockquote,tr').forEach(el => el.append('\n'));
  return (doc.body.textContent || '').replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function parseEpub(bytes: Uint8Array, filename: string): Book {
  let total = 0;
  const files = unzipSync(bytes, { filter(entry) {
    total += entry.originalSize;
    if (entry.originalSize > 30 * 1024 * 1024 || total > 150 * 1024 * 1024) throw new Error('EPUB 解压后过大');
    return true;
  } });
  const read = (path: string) => { if (!files[path]) throw new Error(`EPUB 缺少文件：${path}`); return strFromU8(files[path]); };
  if (files['META-INF/encryption.xml']) throw new Error('暂不支持加密 EPUB');
  const container = xml(read('META-INF/container.xml'));
  const path = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!path) throw new Error('EPUB 缺少阅读顺序');
  const opf = xml(read(path));
  const items = Array.from(opf.getElementsByTagName('item'));
  const chapters: Chapter[] = [];
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = items.find(i => i.id === ref.getAttribute('idref'));
    const href = item?.getAttribute('href');
    if (!href) continue;
    const markup = read(resolvePath(path, href));
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    const content = htmlText(markup);
    if (content) chapters.push({ title: doc.querySelector('h1,h2,h3,title')?.textContent?.trim() || `第 ${chapters.length + 1} 节`, content });
  }
  if (!chapters.length) throw new Error('EPUB 没有文字章节');
  const metadata = (name: string) => opf.getElementsByTagNameNS('*', name)[0]?.textContent || '';
  const book = newBook(metadata('title') || filename.replace(/\.epub$/i, ''), 'epub', chapters, metadata('creator') || '未知作者');
  const coverId = Array.from(opf.getElementsByTagName('meta')).find(i => i.getAttribute('name') === 'cover')?.getAttribute('content');
  const cover = items.find(i => i.getAttribute('properties')?.includes('cover-image') || i.id === coverId);
  const coverPath = cover?.getAttribute('href');
  if (coverPath && cover) {
    const image = files[resolvePath(path, coverPath)];
    const mime = cover.getAttribute('media-type') || '';
    if (image && image.length < 5 * 1024 * 1024 && /^image\/(png|jpeg|webp|gif)$/.test(mime)) {
      let binary = ''; for (let i = 0; i < image.length; i += 8192) binary += String.fromCharCode(...image.subarray(i, i + 8192));
      book.cover = `data:${mime};base64,${btoa(binary)}`;
    }
  }
  return book;
}
export function importBook(bytes: Uint8Array, filename: string): Book {
  if (bytes.length > 50 * 1024 * 1024) throw new Error('单本文件请小于 50 MB');
  return /\.epub$/i.test(filename) || (bytes[0] === 0x50 && bytes[1] === 0x4b) ? parseEpub(bytes, filename) : parseTxt(decodeText(bytes), filename);
}
