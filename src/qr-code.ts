import { invoke, isTauri } from '@tauri-apps/api/core';
import { shareBytes } from './sharing';

export async function qrPixels(text: string): Promise<ImageData> {
  const { default: QRCode } = await import('qrcode');
  let code;
  try { code = QRCode.create(text, { errorCorrectionLevel: 'L' }); }
  catch { throw new Error('文字太多，生成二维码失败'); }
  const size = 640, modules = code.modules.size, scale = Math.floor(size / (modules + 2)), offset = Math.floor((size - modules * scale) / 2);
  const pixels = new Uint8ClampedArray(size * size * 4); pixels.fill(255);
  for (let y = 0; y < modules; y++) for (let x = 0; x < modules; x++) {
    if (!code.modules.get(y, x)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const index = ((offset + y * scale + dy) * size + offset + x * scale + dx) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = 0;
    }
  }
  return { data: pixels, width: size, height: size, colorSpace: 'srgb' } as ImageData;
}

export async function decodeQrPixels(pixels: Pick<ImageData, 'data' | 'width' | 'height'>): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  return jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

export async function decodeQrImage(bytes: Uint8Array): Promise<string> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'), scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法读取图片');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const value = await decodeQrPixels(context.getImageData(0, 0, canvas.width, canvas.height));
    if (value === null) throw new Error('未识别到二维码');
    return value;
  } finally { URL.revokeObjectURL(url); }
}

export async function shareQr(text: string): Promise<boolean> {
  const pixels = await qrPixels(text), canvas = document.createElement('canvas');
  canvas.width = pixels.width; canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法生成二维码');
  const image = context.createImageData(pixels.width, pixels.height); image.data.set(pixels.data); context.putImageData(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法生成二维码')), 'image/png'));
  return shareBytes('qr.png', 'image/png', new Uint8Array(await blob.arrayBuffer()), '分享书源');
}

async function nativeQr(operation: 'qrScan' | 'qrCancel'): Promise<string | null> {
  const response = await (/Android/i.test(navigator.userAgent)
    ? invoke<{ json: string }>('java_bridge', { payload: JSON.stringify({ operation }) })
    : invoke<{ json: string }>('source_browser', { request: { mode: operation } }));
  const result = JSON.parse(response.json);
  if (result.error) throw new Error(result.error);
  return typeof result.value === 'string' ? result.value : null;
}
export const nativeQrAvailable = () => isTauri();
export const scanNativeQr = () => nativeQr('qrScan');
export const cancelNativeQr = () => nativeQr('qrCancel');
