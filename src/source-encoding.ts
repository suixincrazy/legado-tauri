const maps = new Map<string, Map<string, number[]>>();
export function encodeBytes(value: string, charset = 'utf-8'): number[] {
  if (/^utf-?8$/i.test(charset)) return Array.from(new TextEncoder().encode(value));
  if (!/^(?:gbk|gb2312|gb18030)$/i.test(charset)) throw new Error(`不支持的字符编码：${charset}`);
  let map = maps.get('gbk');
  if (!map) {
    map = new Map(); const decoder = new TextDecoder('gbk');
    for (let lead = 0x81; lead <= 0xfe; lead++) for (let tail = 0x40; tail <= 0xfe; tail++) {
      if (tail === 0x7f) continue; const character = decoder.decode(new Uint8Array([lead, tail]));
      if (character.length === 1 && character !== '\ufffd' && !map.has(character)) map.set(character, [lead, tail]);
    }
    maps.set('gbk', map);
  }
  return Array.from(value).flatMap(character => { const code = character.codePointAt(0)!; if (code < 128) return [code]; const encoded = map!.get(character); if (!encoded) throw new Error(`${charset} 无法编码字符：${character}`); return encoded; });
}
export function formEncode(value: string, charset = 'utf-8') { return encodeBytes(value, charset).map(byte => byte === 32 ? '+' : /[\w.*-]/.test(String.fromCharCode(byte)) && byte < 128 ? String.fromCharCode(byte) : '%' + byte.toString(16).toUpperCase().padStart(2, '0')).join(''); }
