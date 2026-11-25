import type { Source } from './model';
import { SourceRuntime } from './source-runtime';
export type LoginField = { name: string; key?: string; type?: string; action?: string; chars?: string[]; options?: string[]; default?: string; value?: string; viewName?: string; hint?: string; style?: Record<string, string | number | boolean> };
export function scriptBody(value: string): string { return value.replace(/^\s*(?:@js:|<js>)/i, '').replace(/<\/js>\s*$/i, ''); }
export function isLoginScript(source: Source): boolean { return !!source.loginUrl?.trim() && !/^https?:\/\//i.test(source.loginUrl.trim()); }
export function loginDefaults(fields: LoginField[], values: Record<string, string>): Record<string, string> {
  const next = { ...values };
  for (const field of fields) if (!['label', 'button'].includes(field.type || '') && next[field.name] === undefined) next[field.name] = field.default ?? field.value ?? field.chars?.[0] ?? field.options?.[0] ?? '';
  return next;
}
export async function initializeLogin(vm: SourceRuntime, source: Source): Promise<void> {
  await vm.initialize();
  await vm.evaluate('result = mapObject(__loginData)');
  if (isLoginScript(source)) await vm.evaluate(scriptBody(source.loginUrl!));
}
export async function readLoginFields(vm: SourceRuntime, source: Source): Promise<LoginField[]> {
  if (!source.loginUi?.trim()) return [];
  const raw = /^\s*@js:|^\s*<js>/i.test(source.loginUi) ? await vm.evaluate(scriptBody(source.loginUi)) : source.loginUi;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const fields = Array.isArray(parsed) ? parsed : parsed?.fields ?? parsed?.rows;
  if (!Array.isArray(fields)) throw new Error('登录界面需要字段数组');
  const output: LoginField[] = [];
  for (const field of fields as LoginField[]) {
    if (!field || typeof (field.name || field.key) !== 'string') throw new Error('登录字段缺少名称');
    const copy = { ...field, name: field.name || field.key! };
    // Legacy viewName is a JS expression; plain text remains a useful fallback.
    if (copy.viewName) { try { const label = await vm.evaluate(copy.viewName); if (label != null) copy.viewName = String(label); } catch { /* Literal labels also occur in sources. */ } }
    output.push(copy);
  }
  return output;
}
export async function performLogin(vm: SourceRuntime, source: Source, action?: string, submit = false) {
  await initializeLogin(vm, source);
  if (action) {
    if (/^https?:\/\//i.test(action)) await vm.evaluate(`java.startBrowserAwait(${JSON.stringify(action)}, "书源网页登录", false)`);
    else await vm.evaluate(scriptBody(action));
  } else if (submit && isLoginScript(source)) await vm.evaluate('if (typeof login === "function") login()');
  if (source.loginCheckJs?.trim() && submit && /^https?:\/\//i.test(source.loginUrl || '')) await vm.fetch(source.loginUrl!);
}
