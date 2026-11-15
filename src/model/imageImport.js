import { IMAGE_MIMES, LIMITS } from './constants.js';
import { b64encode } from '../crypto/lock.js';
import { uid } from './ids.js';

// Sniff the real type from magic bytes; never trust file.type or the extension.
export function sniffImageType(bytes) {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
async function sha(bytes) {
  try { const d = await crypto.subtle.digest('SHA-256', bytes); return 'a' + Array.from(new Uint8Array(d).slice(0, 10), (x) => x.toString(16).padStart(2, '0')).join(''); } catch { return uid('a'); }
}
function loadDims(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, img });
    img.onerror = () => reject(new Error('This image could not be decoded.'));
    img.src = dataUrl;
  });
}
const MAX_SIDE = 2560;

// bytes -> { id, asset } or throws a friendly Error. SVG and any non-raster type are refused.
export async function assetFromBytes(bytes, name = 'image') {
  if (bytes.length > LIMITS.maxImageBytes) throw new Error(`Image is larger than ${Math.round(LIMITS.maxImageBytes / 1048576)} MB.`);
  let mime = sniffImageType(bytes);
  if (!mime || !IMAGE_MIMES.includes(mime)) throw new Error('Only PNG, JPEG, GIF and WebP images are allowed (SVG is not supported for safety).');
  let data = `data:${mime};base64,${b64encode(bytes)}`;
  const dims = await loadDims(data);
  let { w, h } = dims;
  if ((w > MAX_SIDE || h > MAX_SIDE) && mime !== 'image/gif') {
    const k = MAX_SIDE / Math.max(w, h);
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(dims.img, 0, 0, c.width, c.height);
    const out = mime === 'image/png' ? 'image/png' : 'image/jpeg';
    const url = c.toDataURL(out, 0.9);
    if (url.startsWith('data:' + out)) { data = url; mime = out; w = c.width; h = c.height; }
  }
  const id = await sha(bytes);
  return { id, asset: { mime, name: String(name).slice(0, 200), w, h, data } };
}
export async function assetFromFile(file) {
  if (file.size > LIMITS.maxImageBytes) throw new Error(`Image is larger than ${Math.round(LIMITS.maxImageBytes / 1048576)} MB.`);
  return assetFromBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}
