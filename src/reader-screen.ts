import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Settings } from './model';
export async function readerScreen(prefs?:Settings) {
  if(!isTauri())return;
  const request={active:!!prefs,keepScreenOn:prefs?.keepScreenOn||false,brightness:prefs?.showBrightnessView===false?-1:prefs?.brightness??-1,orientation:prefs?.screenOrientation||'auto'};
  if(/Android/i.test(navigator.userAgent))await invoke('java_bridge',{payload:JSON.stringify({operation:'readerScreen',...request})});
  else await invoke('source_browser',{request:{mode:'readerScreen',...request}});
}
