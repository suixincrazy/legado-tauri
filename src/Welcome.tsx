import { useEffect, useState } from 'react';
import { pickFiles } from './files';
import type { Settings } from './model';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { themeColors } from './theme-model';

export function Welcome({ ready, prefs, error }: { ready: boolean; prefs: Settings; error?: string }) {
  const native = isTauri() && /Android/i.test(navigator.userAgent);
  const [nativeError,setNativeError] = useState('');
  useEffect(()=>{
    if (!ready || !native) return;
    const {dark,welcomeShowTime,customWelcome,welcomeImage,welcomeImageDark,welcomeShowText,welcomeShowTextDark,welcomeShowIcon,welcomeShowIconDark}=prefs;
    const theme=themeColors(prefs);
    const frame=requestAnimationFrame(()=>requestAnimationFrame(()=>invoke('java_bridge',{payload:JSON.stringify({operation:'welcome',ready:true,preferences:{dark,welcomeShowTime,customWelcome,welcomeImage,welcomeImageDark,welcomeShowText,welcomeShowTextDark,welcomeShowIcon,welcomeShowIconDark,accentColor:theme.accentColor,backgroundColor:theme.backgroundColor}})}).catch(error=>setNativeError(String(error)))));
    return ()=>cancelAnimationFrame(frame);
  },[native,ready,prefs]);
  const [elapsed, setElapsed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setElapsed(true), Math.max(0,prefs.welcomeShowTime-performance.now()));
    return () => clearTimeout(timer);
  }, [ready, prefs.welcomeShowTime]);
  useEffect(() => {
    if (!elapsed || !ready) return;
    if (!prefs.welcomeShowTime) { setFinished(true); return; }
    setLeaving(true);
    const timer = setTimeout(() => setFinished(true), 200);
    return () => clearTimeout(timer);
  }, [elapsed, ready, prefs.welcomeShowTime]);
  if (native && !nativeError) return null;
  if (finished || (ready && prefs.welcomeShowTime === 0)) return null;
  const night = prefs.dark;
  const showText = night ? prefs.welcomeShowTextDark : prefs.welcomeShowText;
  const showIcon = night ? prefs.welcomeShowIconDark : prefs.welcomeShowIcon;
  const background = prefs.customWelcome ? (night ? prefs.welcomeImageDark : prefs.welcomeImage) : '';
  return <div className={`welcome-screen ${leaving ? 'welcome-leaving' : ''}`} role="status" aria-label="欢迎页">
    {background && <img className="welcome-background" src={background} alt="" />}
    {showText && <div className="welcome-title"><div className="welcome-title-line" /><span className="welcome-name">阅读</span><span className="welcome-subtitle">享受美好时光</span></div>}
    {showIcon && <div className="welcome-book" />}
    {showText && <div className="welcome-footer">品读万千故事</div>}
    {error && <p className="welcome-error" role="alert">{error}</p>}
  </div>;
}

export function WelcomeSettings({ prefs, save, notify }: { prefs: Settings; save: (prefs: Settings) => void; notify: (text: string) => void }) {
  const background = async (night: boolean) => {
    try {
      const files = await pickFiles(['png', 'jpg', 'jpeg', 'gif', 'webp']);
      if (!files[0]) return;
      const file = files[0];
      const extension = file.name.split('.').pop()?.toLowerCase();
      const type = extension === 'jpg' ? 'jpeg' : extension;
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([new Uint8Array(file.bytes)], { type: `image/${type}` }));
      });
      save({ ...prefs, customWelcome: true, [night ? 'welcomeImageDark' : 'welcomeImage']: data });
    } catch (e) { notify(String(e)); }
  };
  return <div className="preference-list">
    <label className="preference-range">欢迎页显示时间 <output>{prefs.welcomeShowTime} ms</output><small>设为 0 不显示欢迎页</small><input aria-label="欢迎页显示时间" type="range" min="0" max="800" step="50" value={prefs.welcomeShowTime} onChange={e => save({ ...prefs, welcomeShowTime: +e.target.value })} /></label>
    <label className="setting-row"><span>自定义欢迎页<small>是否使用自定义的欢迎页</small></span><input type="checkbox" role="switch" checked={prefs.customWelcome} onChange={e => save({ ...prefs, customWelcome: e.target.checked })} /></label>
    {[false, true].map(night => <div key={String(night)}><h3 className="preference-category">{night ? '夜间' : '白天'}</h3><button className="setting-row" onClick={() => background(night)}><span>背景图片</span></button><label className="setting-row"><span>显示文字<small>阅读｜享受美好时光</small></span><input type="checkbox" role="switch" checked={night ? prefs.welcomeShowTextDark : prefs.welcomeShowText} onChange={e => save({ ...prefs, [night ? 'welcomeShowTextDark' : 'welcomeShowText']: e.target.checked })} /></label><label className="setting-row"><span>显示图标<small>显示默认的书本图标</small></span><input type="checkbox" role="switch" checked={night ? prefs.welcomeShowIconDark : prefs.welcomeShowIcon} onChange={e => save({ ...prefs, [night ? 'welcomeShowIconDark' : 'welcomeShowIcon']: e.target.checked })} /></label></div>)}
  </div>;
}
