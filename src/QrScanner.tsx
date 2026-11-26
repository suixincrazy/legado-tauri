import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui';
import { pickFiles } from './files';
import { cancelNativeQr, decodeQrImage, decodeQrPixels, nativeQrAvailable, scanNativeQr } from './qr-code';

export function QrScanner({ scanned, close }: { scanned: (text: string) => void; close: () => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const video = useRef<HTMLVideoElement>(null), deliver = useRef(scanned), dismiss = useRef(close);
  const mounted = useRef(true), delivered = useRef(false); deliver.current = scanned; dismiss.current = close;
  const native = nativeQrAvailable();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const result = (text: string) => { if (mounted.current && !delivered.current) { delivered.current = true; deliver.current(text); } };
  useEffect(() => {
    let active = true, running = false, stream: MediaStream | undefined, frame = 0;
    const timer = setTimeout(async () => {
      setError('');
      try {
        if (native) {
          running = true; const text = await scanNativeQr(); running = false;
          if (active) { if (text === null) dismiss.current(); else result(text); }
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!active) { stream.getTracks().forEach(track => track.stop()); return; }
        const view = video.current!; view.srcObject = stream; await view.play();
        const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true })!;
        let last = 0;
        const scan = async (now: number) => {
          if (!active || delivered.current) return;
          try {
            if (now - last > 200 && view.videoWidth) {
              last = now; const scale = Math.min(1, 960 / Math.max(view.videoWidth, view.videoHeight));
              canvas.width = Math.round(view.videoWidth * scale); canvas.height = Math.round(view.videoHeight * scale);
              context.drawImage(view, 0, 0, canvas.width, canvas.height);
              const text = await decodeQrPixels(context.getImageData(0, 0, canvas.width, canvas.height));
              if (active && text !== null) { result(text); return; }
            }
          } catch { if (active) setError('无法读取相机画面，可从图库选择二维码'); stream?.getTracks().forEach(track => track.stop()); return; }
          if (active) frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch (cause) {
        running = false;
        stream?.getTracks().forEach(track => track.stop());
        if (active) setError(cause instanceof Error && cause.name === 'NotAllowedError' ? '相机权限未开启，可从图库选择二维码' : String((cause as Error).message || cause));
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); if (running) void cancelNativeQr().catch(() => {}); };
  }, [native, retry]);
  const album = async () => {
    if (busy) return; setBusy(true); setError('');
    try { const files = await pickFiles(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']); if (files[0]) result(await decodeQrImage(files[0].bytes)); }
    catch (cause) { if (mounted.current) setError(String((cause as Error).message || cause)); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <Modal title="扫描二维码" close={close} actions={<button disabled={busy} className="text-button" onClick={() => void album()}>图库</button>}><div className="qr-scanner">{!native && <video ref={video} muted playsInline aria-label="二维码相机预览" />}{error && <div className="qr-scanner-error"><p role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>重试</button></div>}</div></Modal>;
}
