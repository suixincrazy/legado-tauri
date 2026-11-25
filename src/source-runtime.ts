import { newQuickJSAsyncWASMModuleFromVariant, type QuickJSAsyncContext, type QuickJSHandle } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-cjs-release-asyncify';
import CryptoJS from 'crypto-js';
import { Converter } from 'opencc-js';
import bootstrap from './source-vm.js?raw';
import { select, extract, asDocument, jsoupSelect } from './source-rules';
import { fetchText, type TextRequest } from './network';
import { createId, type Source, type Book, type Chapter } from './model';
import { htmlText } from './import';
import { invoke, isTauri } from '@tauri-apps/api/core';
import * as storage from './storage';
import { encodeBytes, formEncode } from './source-encoding';
import { clearBrowserCookies, openSourceBrowser } from './source-browser';

export type RuntimeContext = { key?: string; page?: number; baseUrl?: string; book?: Partial<Book>; chapter?: Chapter; timeoutMs?: number; loginData?: Record<string, string>; isLongClick?: boolean };
type State = Record<string, { value: unknown; expires?: number }>;
const toSimple = Converter({ from: 'tw', to: 'cn' }), toTraditional = Converter({ from: 'cn', to: 'tw' });
const encoder = new TextEncoder();
function bytes(value: unknown): Uint8Array { return Array.isArray(value) ? new Uint8Array(value) : encoder.encode(String(value ?? '')); }
function wordArray(value: unknown) { const data = bytes(value), words: number[] = []; for (let i = 0; i < data.length; i++) words[i >>> 2] = (words[i >>> 2] || 0) | data[i] << (24 - i % 4 * 8); return CryptoJS.lib.WordArray.create(words, data.length); }
function fromWords(value: CryptoJS.lib.WordArray) { return Array.from({ length: value.sigBytes }, (_, i) => value.words[i >>> 2] >>> (24 - (i % 4) * 8) & 255); }

export class SourceRuntime {
  private nodes = new Map<number, Node>();
  private nodeIds = new WeakMap<Node, number>();
  private state: State = {};
  private dirty = new Set<string>();
  private vm!: QuickJSAsyncContext;
  private deadline = 0;
  private disposed = false;
  private sessionId = createId();
  private nativeJava = isTauri() && /Android/i.test(navigator.userAgent);
  readonly logs: string[] = [];
  readonly loginEvents: { type: string; data: unknown }[] = [];
  constructor(readonly source: Source, readonly context: RuntimeContext = {}, private rawRequest = fetchText) {}
  private request = (request: TextRequest) => this.rawRequest({ ...request, sourceKey: this.source.bookSourceUrl, cookieJar: this.source.enabledCookieJar !== false });
  async initialize() {
    this.state = await storage.sourceState(this.source.bookSourceUrl);
    const module = await newQuickJSAsyncWASMModuleFromVariant(variant);
    this.vm = module.newContext();
    this.vm.runtime.setMemoryLimit(48 * 1024 * 1024);
    this.vm.runtime.setMaxStackSize(512 * 1024);
    this.vm.runtime.setInterruptHandler(() => Date.now() > this.deadline);
    this.deadline = Date.now() + 5000;
    this.set('__source', this.source); this.set('__book', this.context.book || {}); this.set('__chapter', this.context.chapter || {});
    this.set('__hasBook', !!this.context.book); this.set('__hasChapter', !!this.context.chapter);
    this.set('__loginData', this.context.loginData || {}); this.set('isLongClick', !!this.context.isLongClick);
    this.set('__nativeJava', this.nativeJava);
    this.set('__baseUrl', this.context.baseUrl || this.source.bookSourceUrl); this.set('__key', this.context.key || ''); this.set('__page', this.context.page || 1);
    const host = this.vm.newFunction('__host', (kind, args) => {
      try { return this.vm.newString(JSON.stringify(this.encode(this.host(this.vm.getString(kind), this.decode(JSON.parse(this.vm.getString(args)))))) ?? 'null'); }
      catch (error) { return { error: this.vm.newError(String(error)) }; }
    });
    this.vm.setProp(this.vm.global, '__host', host); host.dispose();
    const network = this.vm.newAsyncifiedFunction('__request', async handle => {
      const request = JSON.parse(this.vm.getString(handle)); const pausedAt = Date.now();
      try { return this.vm.newString(JSON.stringify(await this.request(request))); }
      catch (error) { return this.vm.newString(JSON.stringify({ error: String(error) })); }
      finally { this.deadline += Date.now() - pausedAt; }
    });
    this.vm.setProp(this.vm.global, '__request', network); network.dispose();
    const browser = this.vm.newAsyncifiedFunction('__browser', async handle => {
      const pausedAt = Date.now();
      try { return this.vm.newString(JSON.stringify({ value: await openSourceBrowser(JSON.parse(this.vm.getString(handle))) })); }
      catch (error) { return this.vm.newString(JSON.stringify({ error: String(error) })); }
      finally { this.deadline += Date.now() - pausedAt; }
    });
    this.vm.setProp(this.vm.global, '__browser', browser); browser.dispose();
    const clearCookies = this.vm.newAsyncifiedFunction('__clearCookies', async handle => {
      const pausedAt = Date.now();
      try { await clearBrowserCookies([this.vm.getString(handle)], this.source.bookSourceUrl); return this.vm.newString('{}'); }
      catch (error) { return this.vm.newString(JSON.stringify({ error: String(error) })); }
      finally { this.deadline += Date.now() - pausedAt; }
    });
    this.vm.setProp(this.vm.global, '__clearCookies', clearCookies); clearCookies.dispose();
    const jvm = this.vm.newAsyncifiedFunction('__jvm', async handle => {
      const pausedAt = Date.now();
      try {
        const payload = { ...JSON.parse(this.vm.getString(handle)), session: this.sessionId };
        const response = await invoke<{ json: string }>('java_bridge', { payload: JSON.stringify(payload) });
        return this.vm.newString(response.json);
      } catch (error) { return this.vm.newString(JSON.stringify({ error: String(error) })); }
      finally { this.deadline += Date.now() - pausedAt; }
    });
    this.vm.setProp(this.vm.global, '__jvm', jvm); jvm.dispose();
    await this.evaluate(bootstrap);
    const library = this.source.jsLib || this.source.mainJs;
    if (library) {
      if (library.trim().startsWith('{')) {
        const entries = Object.values(JSON.parse(library));
        for (const value of entries) if (typeof value === 'string') await this.evaluate(/^https?:\/\//.test(value) ? (await this.request({ url: value })).body : value);
      } else await this.evaluate(library);
    }
    return this;
  }
  private encode(value: unknown): any {
    if (value instanceof Node) {
      let id = this.nodeIds.get(value); if (!id) { id = this.nodes.size + 1; this.nodes.set(id, value); this.nodeIds.set(value, id); }
      return { $node: id };
    }
    if (Array.isArray(value)) return value.map(v => this.encode(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.encode(v)]));
    return value ?? null;
  }
  private decode(value: any): any {
    if (value?.$node) return this.nodes.get(value.$node);
    if (Array.isArray(value)) return value.map(v => this.decode(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.decode(v)]));
    return value;
  }
  private handle(value: unknown): QuickJSHandle {
    const json = this.vm.newString(JSON.stringify(this.encode(value)) ?? 'null');
    const parser = this.vm.evalCode('(s) => JSON.parse(s)');
    const fn = this.vm.unwrapResult(parser);
    try { return this.vm.unwrapResult(this.vm.callFunction(fn, this.vm.undefined, json)); } finally { fn.dispose(); json.dispose(); }
  }
  private set(name: string, value: unknown) { const handle = this.handle(value); this.vm.setProp(this.vm.global, name, handle); handle.dispose(); }
  async evaluate(code: string): Promise<any> {
    this.deadline = Date.now() + (this.context.timeoutMs ?? 5000);
    const result = await this.vm.evalCodeAsync(code, 'book-source.js');
    if (result.error) { const error = this.vm.dump(result.error); result.error.dispose(); throw new Error(`书源脚本：${error.message || JSON.stringify(error)}`); }
    try { return this.decode(this.vm.dump(result.value)); } finally { result.value.dispose(); }
  }
  async rule(input: unknown, rule: string | undefined, list: boolean | 'raw' = false): Promise<any> {
    this.set('__input', input); this.set('__ruleText', rule || '');
    return this.evaluate(`__runRule(revive(__input), __ruleText, ${JSON.stringify(list)})`);
  }
  async setBook(value: Partial<Book>) {
    this.context.book = value; this.set('__book', value); this.set('__hasBook', true);
    await this.evaluate('book = wrapEntity(__book, "book"); book.bookUrl = book.url || ""');
  }
  async setChapter(value?: Chapter) {
    this.context.chapter = value; this.set('__chapter', value || {}); this.set('__hasChapter', !!value);
    await this.evaluate('chapter = wrapEntity(__chapter, "chapter"); title = chapter.title || ""');
  }
  async makeRequest(template: string, base?: string): Promise<TextRequest> {
    if (base) this.set('baseUrl', base);
    this.set('__templateText', template); return this.evaluate('__makeRequest(__templateText)');
  }
  async fetch(template: string, base?: string): ReturnType<typeof fetchText> {
    const response = await this.request(await this.makeRequest(template, base));
    await this.setPage(response.url, response.body);
    if (!this.source.loginCheckJs?.trim()) return response;
    this.set('__response', response); this.set('__checkCode', this.source.loginCheckJs.replace(/^@js:|^<js>|<\/js>$/g, ''));
    return this.evaluate('result = responseObject(__response); var checked = (0, eval)(__checkCode); (checked && typeof checked.body === "function" ? checked : result).toJSON()');
  }
  async setPage(url: string, body: string) { this.set('baseUrl', url); this.set('src', body); this.set('result', body); }
  async close() {
    if (this.disposed) return; this.disposed = true;
    try {
      if (this.vm) this.vm.dispose();
      if (this.nativeJava) await invoke('java_bridge', { payload: JSON.stringify({ session: this.sessionId, operation: 'release' }) });
    } finally { await storage.saveSourceState(this.source.bookSourceUrl, Object.fromEntries([...this.dirty].map(k => [k, this.state[k]]))); }
  }
  private host(kind: string, args: any[]): any {
    const [a, b, c, d, e, f] = args;
    if (kind === 'loginUi') { this.loginEvents.push({ type: a, data: b }); return null; }
    if (kind === 'select') return select(a, b);
    if (kind === 'extract') return extract(a, b);
    if (kind === 'parse') return asDocument(a);
    if (kind === 'parseElement') {
      if (/^\s*(?:<!doctype|<html)/i.test(a)) return asDocument(a);
      const template = document.createElement('template'); template.innerHTML = String(a);
      return template.content.firstElementChild || asDocument(a);
    }
    if (kind === 'dom') {
      const n = a as Element;
      if (b === 'select') return jsoupSelect(n, c);
      if (b === 'text') { const root = a instanceof Document ? a.documentElement : n; if (c !== undefined && c !== null) root.textContent = String(c); return root.textContent?.trim() || ''; }
      if (b === 'ownText') return Array.from(n.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
      if (b === 'html') { if (c !== undefined && c !== null) n.innerHTML = String(c); return n.innerHTML ?? (n as unknown as Document).documentElement.innerHTML; }
      if (b === 'outerHtml') return n.outerHTML ?? (n as unknown as Document).documentElement.outerHTML;
      if (b === 'attr') { if (d !== undefined && d !== null) { n.setAttribute(c, String(d)); return n; } return n.getAttribute(c) || ''; }
      if (b === 'children') return Array.from(n.children);
      if (b === 'parent') return n.parentElement;
      if (b === 'nextElementSibling') return n.nextElementSibling;
      if (b === 'previousElementSibling') return n.previousElementSibling;
      if (b === 'remove') { n.remove(); return null; }
      if (b === 'tagName') return n.tagName?.toLowerCase() || '#document';
      throw new Error(`未支持的 Jsoup 方法：${b}`);
    }
    if (kind === 'state') {
      const entity = a === 'book' ? this.context.book : a === 'chapter' ? this.context.chapter : undefined;
      if (entity) {
        entity.variables ||= {};
        if (b === 'get' && Object.prototype.hasOwnProperty.call(entity.variables, c)) return entity.variables[c];
        if (b !== 'get') entity.variables[c] = b === 'delete' ? '' : d;
        if (!entity.url) return b === 'get' ? '' : d;
      } else if (a === 'book' || a === 'chapter') return '';
      const scope = a === 'book' ? `book:${this.context.book?.url || ''}` : a === 'chapter' ? `chapter:${this.context.chapter?.url || ''}` : a;
      const key = `${scope}:${c}`;
      if (b === 'get') { const entry = this.state[key]; return entry && (!entry.expires || entry.expires > Date.now()) ? entry.value : ''; }
      this.state[key] = { value: b === 'delete' ? '' : d, expires: e ? Date.now() + e * 1000 : undefined }; this.dirty.add(key); return d;
    }
    if (kind === 'url') { const url = /^https?:\/\//i.test(a) ? new URL(a) : new URL(a, b); return { href: url.href, origin: url.origin, protocol: url.protocol, host: url.host, hostname: url.hostname, pathname: url.pathname, search: url.search, hash: url.hash }; }
    if (kind === 'urlEncode') return formEncode(String(a), b);
    if (kind === 'encode') return encodeBytes(String(a), b);
    if (kind === 'decode') return new TextDecoder(b).decode(bytes(a));
    if (kind === 'digest') { const hash = (CryptoJS as unknown as Record<string, (v: CryptoJS.lib.WordArray) => CryptoJS.lib.WordArray>)[a]; if (!hash) throw new Error(`未知摘要算法 ${a}`); return hash(wordArray(b)).toString(); }
    if (kind === 'base64') { if (a === 'encode') return CryptoJS.enc.Base64.stringify(wordArray(b)); const data = fromWords(CryptoJS.enc.Base64.parse(String(b || '').replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/'))); return a === 'bytes' ? data : new TextDecoder(typeof c === 'string' ? c : 'utf-8').decode(new Uint8Array(data)); }
    if (kind === 'hex') { if (a === 'encode') return wordArray(b).toString(CryptoJS.enc.Hex); const data = fromWords(CryptoJS.enc.Hex.parse(b)); return a === 'bytes' ? data : new TextDecoder().decode(new Uint8Array(data)); }
    if (kind === 'crypto') {
      const [algorithm, mode = 'ECB', padding = 'PKCS5Padding'] = String(b).split('/');
      const cipher = { AES: CryptoJS.AES, DES: CryptoJS.DES, DESede: CryptoJS.TripleDES, TripleDES: CryptoJS.TripleDES }[algorithm];
      const modes: Record<string, any> = { CBC: CryptoJS.mode.CBC, ECB: CryptoJS.mode.ECB, CFB: CryptoJS.mode.CFB, OFB: CryptoJS.mode.OFB, CTR: CryptoJS.mode.CTR };
      const paddings: Record<string, any> = { PKCS5Padding: CryptoJS.pad.Pkcs7, PKCS7Padding: CryptoJS.pad.Pkcs7, NoPadding: CryptoJS.pad.NoPadding, ZeroPadding: CryptoJS.pad.ZeroPadding };
      if (!cipher || !modes[mode] || !paddings[padding]) throw new Error(`未支持的加密方式 ${b}`);
      const options = { mode: modes[mode], padding: paddings[padding], iv: d ? wordArray(d) : undefined };
      const data = a === 'encrypt' ? cipher.encrypt(wordArray(e), wordArray(c), options).ciphertext : cipher.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext: typeof e === 'string' ? (/^[0-9a-f]+$/i.test(e) && e.length % 2 === 0 ? CryptoJS.enc.Hex.parse(e) : CryptoJS.enc.Base64.parse(e)) : wordArray(e) }), wordArray(c), options);
      if (data.sigBytes < 0) throw new Error('解密失败：密钥或填充不匹配');
      return f === 'bytes' ? fromWords(data) : data.toString(f === 'base64' ? CryptoJS.enc.Base64 : f === 'hex' ? CryptoJS.enc.Hex : CryptoJS.enc.Utf8);
    }
    if (kind === 'convert') return a === 'cn' ? toSimple(b) : toTraditional(b);
    if (kind === 'htmlText') return htmlText(a);
    if (kind === 'uuid') return createId();
    if (kind === 'number') return String(a).replace(/[零一二三四五六七八九]/g, n => String('零一二三四五六七八九'.indexOf(n)));
    if (kind === 'log') { if (this.logs.length < 100) this.logs.push(String(a).slice(0, 1000)); return a; }
    if (kind === 'time') { const date = new Date(Number(a) + (c || 0) * 3600000); const utc = c !== undefined; const values: Record<string, string> = { yyyy: String(utc ? date.getUTCFullYear() : date.getFullYear()), MM: String((utc ? date.getUTCMonth() : date.getMonth()) + 1).padStart(2, '0'), dd: String(utc ? date.getUTCDate() : date.getDate()).padStart(2, '0'), HH: String(utc ? date.getUTCHours() : date.getHours()).padStart(2, '0'), mm: String(utc ? date.getUTCMinutes() : date.getMinutes()).padStart(2, '0'), ss: String(utc ? date.getUTCSeconds() : date.getSeconds()).padStart(2, '0') }; return String(b).replace(/yyyy|MM|dd|HH|mm|ss/g, key => values[key]); }
    throw new Error(`未支持的书源调用：${kind}`);
  }
}
