// Runs inside QuickJS. Only explicit host calls cross into the reader.
function callHost(kind, ...args) { return revive(JSON.parse(__host(kind, JSON.stringify(args)))); }
function revive(value) {
  if (value && value.$java) return javaProxy(value);
  if (value && value.$node) return new DomNode(value.$node);
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') for (const key of Object.keys(value)) value[key] = revive(value[key]);
  return value;
}
class DomNode {
  constructor(id) { this.$node = id; }
  toJSON() { return { $node: this.$node }; }
  select(rule) { return callHost('dom', this, 'select', rule); }
  selectFirst(rule) { return this.select(rule).first(); }
  text(value) { return callHost('dom', this, 'text', value); }
  ownText() { return callHost('dom', this, 'ownText'); }
  html(value) { return callHost('dom', this, 'html', value); }
  outerHtml() { return callHost('dom', this, 'outerHtml'); }
  attr(name, value) { return callHost('dom', this, 'attr', name, value); }
  absUrl(name) { return new URL(this.attr(name), baseUrl).href; }
  children() { return callHost('dom', this, 'children'); }
  child(index) { return this.children()[index]; }
  parent() { return callHost('dom', this, 'parent'); }
  parents() { const out = []; let n = this.parent(); while (n) { out.push(n); n = n.parent(); } return out; }
  nextElementSibling() { return callHost('dom', this, 'nextElementSibling'); }
  previousElementSibling() { return callHost('dom', this, 'previousElementSibling'); }
  remove() { callHost('dom', this, 'remove'); return this; }
  tagName() { return callHost('dom', this, 'tagName'); }
  hasAttr(name) { return this.attr(name) !== ''; }
  toString() { return this.outerHtml(); }
}
Object.defineProperties(Array.prototype, {
  size: { value() { return this.length; } }, get: { value(i) { return this[i]; } },
  isEmpty: { value() { return this.length === 0; } }, first: { value() { return this[0] ?? null; } },
  last: { value() { return this[this.length - 1] ?? null; } },
  toArray: { value() { return Array.from(this); } }, add: { value(v) { this.push(v); return true; } },
  select: { value(s) { return this.flatMap(n => n.select(s)); } },
  text: { value() { return this.map(n => n.text()).join(' '); } },
  html: { value() { return this.map(n => n.html()).join('\n'); } },
  attr: { value(key, value) { if (value !== undefined) { this.forEach(n => n.attr(key, value)); return this; } return this[0]?.attr(key) || ''; } },
  remove: { value() { this.forEach(n => n.remove()); return this; } }
});
Object.defineProperties(String.prototype, {
  getBytes: { value(charset) { return callHost('encode', String(this), charset || 'utf-8'); } },
  equals: { value(other) { return String(this) === String(other); } },
  contains: { value(other) { return this.includes(String(other)); } },
  matches: { value(regex) { return new RegExp('^(?:' + regex + ')$').test(String(this)); } }
});
class URL {
  constructor(url, base) { Object.assign(this, callHost('url', String(url), base === undefined ? baseUrl : String(base))); }
  toString() { return this.href; }
}
function stateGet(scope, key) { return callHost('state', scope, 'get', String(key)) ?? ''; }
function statePut(scope, key, value, ttl) { callHost('state', scope, 'put', String(key), value, ttl); return value; }
function mapObject(value) { Object.defineProperties(value, { get: { value(key) { return this[key] ?? null; } }, put: { value(key, item) { this[key] = item; return item; } }, containsKey: { value(key) { return Object.prototype.hasOwnProperty.call(this,key); } }, size: { value() { return Object.keys(this).length; } } }); return value; }
function wrapEntity(data, scope) {
  return Object.assign(data || {}, {
    getVariable(key) { return stateGet(scope, key); },
    putVariable(key, value) { return statePut(scope, key, value); },
    putCustomVariable(key, value) { return statePut(scope, key, value); }
  });
}
var source = Object.assign(__source, {
  getKey() { return this.bookSourceUrl; }, getTag() { return this.bookSourceName; },
  getVariable() { return stateGet('source', 'variable'); }, setVariable(v) { return statePut('source', 'variable', v); },
  get(k) { return stateGet('source', k); }, put(k, v) { return statePut('source', k, v); },
  getLoginInfo() { return stateGet('source', 'loginInfo'); },
  getLoginInfoMap() { return mapObject(JSON.parse(this.getLoginInfo() || '{}')); },
  putLoginInfo(v) { return statePut('source', 'loginInfo', typeof v === 'string' ? v : JSON.stringify(v)); },
  removeLoginInfo() { return statePut('source', 'loginInfo', ''); },
  getLoginHeaderMap() { return mapObject(JSON.parse(stateGet('source', 'loginHeader') || '{}')); },
  putLoginHeader(v) { return statePut('source', 'loginHeader', typeof v === 'string' ? v : JSON.stringify(v)); },
  removeLoginHeader() { statePut('source', 'loginHeader', ''); }
});
source.refreshExplore = () => { callHost('loginUi', 'refresh', false); return source.exploreUrl; };
var __infoValues = JSON.parse(stateGet('cache', 'exploreInfo') || '{}'), __infoSave = false, __infoTtl = 0;
var infoMap = {
  get(key) { return key === undefined ? mapObject(Object.assign({}, __infoValues)) : __infoValues[key] ?? null; },
  set(value) { __infoValues = Object.assign({}, value); }, put(key, value) { const old = __infoValues[key]; __infoValues[key] = value; return old; },
  putAll(value) { Object.assign(__infoValues, value); }, remove(key) { const old = __infoValues[key]; delete __infoValues[key]; return old; },
  clear() { __infoValues = {}; }, containsKey(key) { return Object.prototype.hasOwnProperty.call(__infoValues, key); }, isEmpty() { return !Object.keys(__infoValues).length; },
  save(time = 0, need = true) { __infoTtl = time; __infoSave = need; }, saveNow() { statePut('cache', 'exploreInfo', JSON.stringify(__infoValues), __infoTtl); __infoSave = false; }
};
var book = wrapEntity(__book, 'book'), chapter = wrapEntity(__chapter, 'chapter');
book.bookUrl = book.url || '';
var baseUrl = __baseUrl, key = __key, page = __page, title = chapter.title || '', result = '', src = '';
var cache = { get: k => stateGet('cache', k), put: (k, v, ttl) => statePut('cache', k, v, ttl), delete: k => callHost('state', 'cache', 'delete', k) };
function cookieUrl(url) { return new URL(/^https?:\/\//i.test(url) ? url : 'https://' + String(url).replace(/^\/\//, '')); }
function cookieKey(url) { return callHost('cookieKey', url); }
var cookie = {
  getCookie(url, name) { const all = stateGet('cookie', cookieKey(url)); return name ? all.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '' : all; },
  setCookie(url, value) { return statePut('cookie', cookieKey(url), value || ''); },
  replaceCookie(url, value) { return this.setCookie(url, this.mapToCookie(Object.assign(this.cookieToMap(this.getCookie(url)), this.cookieToMap(value)))); },
  removeCookie(url) { const address = cookieUrl(url).href; const envelope = JSON.parse(__clearCookies(address)); if (envelope.error) throw new Error(envelope.error); return statePut('cookie', cookieKey(url), ''); },
  getKey(url, name) { return this.getCookie(url, name); },
  cookieToMap(value) { const result = {}; for (const part of String(value || '').split(';')) { const index = part.indexOf('='); if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim(); } return mapObject(result); },
  mapToCookie(value) { return Object.keys(value).map(key => key + '=' + value[key]).join('; '); }
};
function responseObject(response) { return { body: () => response.body, url: () => response.url, code: () => response.status || 200, statusCode: () => response.status || 200, headers: () => response.headers || {}, toString: () => response.body, toJSON: () => response }; }
function network(url, options, raw) {
  const request = __makeRequest(String(url), options);
  const response = JSON.parse(__request(JSON.stringify(request)));
  if (response.error) throw new Error(response.error);
  return raw ? response : responseObject(response);
}
function sourceBrowser(url, mode, title, html, js, preloadJs) {
  const request = __makeRequest(url || baseUrl);
  const envelope = JSON.parse(__browser(JSON.stringify({ mode, title, url: request.url, headers: request.headers, html, js, preloadJs })));
  if (envelope.error) throw new Error(envelope.error);
  const response = envelope.value;
  if (response?.cookies) statePut('source', 'browserUrls', [...new Set([...(stateGet('source', 'browserUrls') || []), ...Object.keys(response.cookies)])]);
  if (response?.cookies) for (const address of Object.keys(response.cookies)) cookie.setCookie(address, response.cookies[address]);
  if (response?.cookie) cookie.setCookie(response.url, response.cookie);
  return response;
}
function symmetric(transformation, key, iv) {
  const run = (op, data, output) => callHost('crypto', op, transformation, key, iv, data, output);
  return { setIv(v) { iv = v; return this; }, encrypt: d => run('encrypt', d, 'bytes'), encryptBase64: d => run('encrypt', d, 'base64'), encryptHex: d => run('encrypt', d, 'hex'), decrypt: d => run('decrypt', d, 'bytes'), decryptStr: d => run('decrypt', d, 'utf8') };
}
var java = {
  upLoginData(data) { callHost('loginUi', 'data', data); if (data) Object.assign(result, data); },
  reLoginView(deltaUp = false) { callHost('loginUi', 'refresh', deltaUp); },
  getLoginInfoMap: () => source.getLoginInfoMap(), getLoginInfo: () => source.getLoginInfo(),
  getVariable: () => source.getVariable(), setVariable: value => source.setVariable(value),
  showBrowser(url, html, preloadJs) { return sourceBrowser(url, 'login', '书源网页登录', html, undefined, preloadJs); },
  startBrowserAwait(url, title, refetch = true, html) { const response = sourceBrowser(url, 'login', title || '书源登录', html); return refetch ? network(response.url) : responseObject(response); },
  startBrowser(url, title, html) { sourceBrowser(url, 'login', title || '书源登录', html); },
  webView(html, url, js) { return sourceBrowser(url, 'render', '正在解析书源', html, js).body; },
  getVerificationCode(url) { return sourceBrowser(url, 'code', '输入书源验证码'); },
  ajax(url) { return network(Array.isArray(url) ? url[0] : url, null, true).body; },
  ajaxAll(urls) { return urls.map(url => network(url)); }, connect(url, header) { return network(url, { headers: typeof header === 'string' ? JSON.parse(header) : header }); },
  get(name, headers) { if (headers !== undefined) return network(name, { headers }); if (name === 'bookName') return book.name || ''; if (name === 'title') return chapter.title || ''; return stateGet('chapter', name) || stateGet('book', name) || stateGet('source', name); },
  put(name, value) { return statePut(__hasChapter ? 'chapter' : __hasBook ? 'book' : 'source', name, value); },
  post(url, body, headers) { return network(url, { method: 'POST', body, headers }); },
  getString(rule) { return String(__runRule(src, rule, false) ?? ''); },
  getStringList(rule) { return __runRule(src, rule, true).map(String); },
  getElements(rule) { return __runRule(src, rule, true); }, getElement(rule) { return __runRule(src, rule, true); },
  setContent(content) { src = content; return this; },
  getSource() { return source; }, getTag() { return source.getKey(); },
  md5Encode: value => callHost('digest', 'MD5', value), md5Encode16: value => callHost('digest', 'MD5', value).slice(8, 24),
  base64Encode: value => callHost('base64', 'encode', value),
  base64Decode: (value, charset) => callHost('base64', 'decode', value, charset),
  base64DecodeToByteArray: value => callHost('base64', 'bytes', value),
  hexDecodeToByteArray: value => callHost('hex', 'bytes', value), hexDecodeToString: value => callHost('hex', 'decode', value), hexEncodeToString: value => callHost('hex', 'encode', value),
  strToBytes: (value, charset) => callHost('encode', value, charset || 'utf-8'), bytesToStr: (value, charset) => callHost('decode', value, charset || 'utf-8'),
  encodeURI: (value, charset) => callHost('urlEncode', value, charset || 'utf-8'),
  createSymmetricCrypto: symmetric,
  aesBase64DecodeToString: (value, key, mode, iv) => symmetric(mode || 'AES/CBC/PKCS5Padding', key, iv).decryptStr(value),
  aesDecodeToString: (value, key, mode, iv) => symmetric(mode || 'AES/CBC/PKCS5Padding', key, iv).decryptStr(value),
  t2s: value => callHost('convert', 'cn', value), s2t: value => callHost('convert', 'tw', value),
  timeFormat: value => callHost('time', value, 'yyyy/MM/dd HH:mm'), timeFormatUTC: (value, format, offset) => callHost('time', value, format, offset),
  htmlFormat: value => callHost('htmlText', value), toNumChapter: value => callHost('number', value),
  log(value) { callHost('log', String(value)); return value; }, toast: value => callHost('log', String(value)), longToast: value => callHost('log', String(value)),
  getCookie: (url, name) => cookie.getCookie(url, name), removeCookie: url => cookie.removeCookie(url),
  randomUUID: () => callHost('uuid'), androidId: () => stateGet('source', 'deviceId') || statePut('source', 'deviceId', callHost('uuid')),
  getWebViewUA: () => 'Mozilla/5.0 LegadoTauri', toURL: (url, base) => new URL(url, base),
  refreshTocUrl() { return book.tocUrl || book.url || baseUrl; }, refreshExplore() { callHost('loginUi', 'refresh', false); return source.exploreUrl; },
  getReadBookConfigMap: () => ({}), getThemeMode: () => 'light', getThemeConfigMap: () => ({ isNightTheme: false }),
  importScript: path => network(path, null, true).body
};
var Jsoup = { parse(markup, base) { return callHost('parse', String(markup), base || baseUrl); } };
function JavaString(value, charset) { const text = Array.isArray(value) ? java.bytesToStr(value, charset) : String(value ?? ''); return new String(text); }
function ByteSpec(bytes) { return { bytes: typeof bytes === 'string' ? java.strToBytes(bytes) : bytes }; }
const Base64 = { getDecoder: () => ({ decode: java.base64DecodeToByteArray }), getEncoder: () => ({ encode: value => java.strToBytes(java.base64Encode(value)), encodeToString: java.base64Encode }), decode: java.base64DecodeToByteArray, decodeStr: java.base64Decode, encode: java.base64Encode };
const Arrays = { copyOfRange: (a, start, end) => a.slice(start, end), copyOf: (a, len) => Array.from({ length: len }, (_, i) => a[i] || 0), asList: (...a) => a };
const Cipher = { DECRYPT_MODE: 2, ENCRYPT_MODE: 1, getInstance(mode) { let direction, key, iv; return { init(d, k, v) { direction = d; key = k.bytes || k; iv = v?.bytes || v; }, doFinal(data) { const c = symmetric(mode, key, iv); return direction === 2 ? c.decrypt(data) : c.encrypt(data); } }; } };
function JavaMap() { const data = new Map(); this.put = (k, v) => data.set(k, v); this.get = k => data.get(k); this.containsKey = k => data.has(k); this.size = () => data.size; this.toJSON = () => Object.fromEntries(data); }
var Packages = {
  org: { jsoup: { Jsoup } },
  java: { lang: { String: JavaString, Integer: { parseInt }, Long: { parseLong: Number }, System: { currentTimeMillis: () => Date.now() } }, util: { Base64, Arrays, ArrayList: Array, HashMap: JavaMap, UUID: { randomUUID: java.randomUUID } }, net: { URLEncoder: { encode: java.encodeURI }, URLDecoder: { decode: v => decodeURIComponent(v.replace(/\+/g, ' ')) } } },
  javax: { crypto: { Cipher, spec: { SecretKeySpec: ByteSpec, IvParameterSpec: ByteSpec } } },
  cn: { hutool: { core: { codec: { Base64 }, util: { HexUtil: { decodeHex: java.hexDecodeToByteArray, encodeHexStr: java.hexEncodeToString }, CharsetUtil: { CHARSET_UTF_8: 'utf-8' }, StrUtil: { utf8Str: java.bytesToStr, isBlank: v => !String(v || '').trim() } } }, crypto: { digest: { DigestUtil: { md5Hex: java.md5Encode, sha256Hex: v => callHost('digest', 'SHA256', v) } }, symmetric: { SymmetricCrypto: symmetric } } } }
};
var org = Packages.org, javax = Packages.javax, cn = Packages.cn;
Object.assign(java, Packages.java);
function nativeCall(request) { const response = JSON.parse(__jvm(JSON.stringify(request))); if (response.error) throw new Error(response.error); return revive(response.value); }
function javaProxy(reference) {
  const target = reference.kind === 'array' ? reference.items.map(revive) : function () {};
  return new Proxy(target, {
    get(_, name) {
      if (name === '$java') return reference.$java;
      if (name === '$kind') return reference.kind;
      if (name === '$className') return reference.className;
      if (name === 'toJSON') return () => reference;
      if (reference.kind === 'array' && name in target) return target[name];
      if (name === Symbol.toPrimitive || name === 'toString') return () => nativeCall({ operation: 'string', ref: reference.$java });
      if (name === 'then' || typeof name === 'symbol') return undefined;
      const value = nativeCall({ operation: 'get', ref: reference.$java, name });
      if (value && value.$kind === 'method') return (...args) => nativeCall({ operation: 'call', ref: reference.$java, name, args });
      return value;
    },
    apply(_, receiver, args) { return nativeCall({ operation: 'construct', ref: reference.$java, args }); },
    construct(_, args) { const result = nativeCall({ operation: 'construct', ref: reference.$java, args }); return typeof result === 'object' || typeof result === 'function' ? result : Object(result); }
  });
}
function javaPackage(path) {
  return new Proxy({}, { get(_, name) {
    if (name === '$package') return path;
    if (name === 'then' || name === 'toJSON' || typeof name === 'symbol') return undefined;
    const full = path ? path + '.' + name : name;
    if (/^[A-Z]/.test(name)) return nativeCall({ operation: 'class', name: full });
    return javaPackage(full);
  } });
}
if (__nativeJava) {
  Packages = javaPackage(''); org = Packages.org; javax = Packages.javax; cn = Packages.cn;
  java.lang = Packages.java.lang; java.util = Packages.java.util; java.net = Packages.java.net;
}
function importPackage(...packages) { for (const p of packages) if (p) Object.assign(globalThis, p); }
function importClass(...classes) { for (const cls of classes) { if (cls?.$className) globalThis[cls.$className.split('.').pop()] = cls; else if (cls === Jsoup) globalThis.Jsoup = cls; else if (typeof cls === 'function') globalThis[cls.name] = cls; } }
function JavaImporter(...packages) {
  const roots = [], target = this;
  this.importPackage = (...values) => { for (const p of values) if (p?.$package !== undefined) roots.push(p.$package); else if (p) Object.assign(target, p); };
  this.importPackage(...packages);
  if (__nativeJava) return new Proxy(target, { has(object, name) { if (name in object) return true; if (typeof name !== 'string' || !/^[A-Z]/.test(name)) return false; for (const root of roots) { try { object[name] = nativeCall({ operation: 'class', name: root + '.' + name }); return true; } catch {} } return false; } });
}
function __template(text) {
  const charset = /["']?charset["']?\s*:\s*["']([^"']+)/i.exec(text)?.[1];
  return text.replace(/\{\{([\s\S]*?)\}\}/g, (_, code) => { const value = (0, eval)(code); return code.trim() === 'key' ? charset ? java.encodeURI(String(value), charset) : encodeURIComponent(String(value)) : String(value ?? ''); });
}
function __makeRequest(template, extra) {
  let value = String(template).trim();
  if (/^@js:/i.test(value)) value = String((0, eval)(__template(value.slice(4))));
  else if (value.startsWith('<js>')) value = String((0, eval)(__template(value.replace(/^<js>|<\/js>$/gi, ''))));
  else value = __template(value);
  const match = value.match(/,\s*(\{[\s\S]*\})\s*$/);
  let options = {};
  if (match) { options = (0, eval)('(' + match[1] + ')'); value = value.slice(0, match.index); }
  if (options.js) value = String((0, eval)(options.js));
  const address = new URL(value, baseUrl).href;
  let headers = source.header || '{}';
  if (typeof headers === 'string') headers = headers.startsWith('@js:') ? (0, eval)(headers.slice(4)) : headers;
  if (typeof headers === 'string') headers = (0, eval)('(' + (headers || '{}') + ')');
  headers = Object.assign({}, headers, source.getLoginHeaderMap(), options.headers || options.header, extra?.headers);
  const cookies = source.enabledCookieJar !== false && cookie.getCookie(address); if (cookies && !Object.keys(headers).some(key => key.toLowerCase() === 'cookie')) headers.Cookie = cookies;
  options = Object.assign({}, options, extra || {});
  let body = options.body;
  if (body && typeof body === 'object') { body = JSON.stringify(body); if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'; }
  return { url: address, method: String(options.method || 'GET').toUpperCase(), headers, body, charset: options.charset };
}
function __runRule(input, rule, list) {
  if (!rule) return list === 'raw' ? input : list ? (Array.isArray(input) ? input : [input]) : '';
  result = input; src = input;
  rule = String(rule);
  rule = rule.replace(/@put:(\{[^}]*\})/g, (_, json) => { const values = {}; for (const pair of json.slice(1,-1).split(',')) { const colon=pair.indexOf(':'); const name=pair.slice(0,colon).trim().replace(/^['"]|['"]$/g,''); values[name]=pair.slice(colon+1).trim().replace(/^['"]|['"]$/g,''); } for (const name of Object.keys(values)) java.put(name, __runRule(input, values[name], false)); return ''; });
  rule = rule.replace(/@get:\{([^}]*)\}/g, (_, name) => String(java.get(name)));
  const start = rule.search(/@js:|<js>/i);
  if (start >= 0) {
    const before = rule.slice(0, start).trim();
    if (before) result = __runRule(input, before, list);
    const tag = rule.slice(start, start + 4).toLowerCase();
    const end = tag === '<js>' ? rule.indexOf('</js>', start + 4) : -1;
    const code = rule.slice(start + 4, end < 0 ? undefined : end);
    result = (0, eval)(code);
    if (end >= 0 && rule.slice(end + 5).trim()) return __runRule(result, rule.slice(end + 5).replace(/^@/, ''), list);
  } else if (/\{\{[\s\S]*\}\}/.test(rule)) {
    result = rule.replace(/\{\{([\s\S]*?)\}\}/g, (_, code) => String(code.trim().startsWith('$.') || code.trim().startsWith('$[') ? callHost('extract',input,code.trim()) : (0, eval)(code) ?? ''));
  } else if (/^https?:\/\//i.test(rule)) {
    result = rule;
  } else result = callHost(list === true ? 'select' : 'extract', input?.$java ? callHost('parseElement', String(input)) : Array.isArray(input) ? input.map(n => n?.$java ? callHost('parseElement', String(n)) : n) : input, rule);
  if (list === 'raw') return result;
  if (list) return result == null ? [] : Array.isArray(result) ? result : [result];
  return result == null ? '' : Array.isArray(result) ? result.map(String).join('\n') : String(result);
}
