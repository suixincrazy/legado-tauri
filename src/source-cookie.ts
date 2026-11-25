import { getDomain } from 'tldts';
export function cookieStorageKey(address: string): string {
  const url = new URL(/^https?:\/\//i.test(address) ? address : 'https://' + address.replace(/^\/\//, ''));
  return `https://${getDomain(url.hostname) || url.hostname}`;
}
