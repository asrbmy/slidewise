// Optional per-deck password lock: PBKDF2-SHA256 -> AES-GCM-256 via Web Crypto. Nothing is sent anywhere.
// Protects: the stored deck contents (slides, notes, images) at rest in this browser's IndexedDB and in backup files.
// Does NOT protect: the deck's name and metadata (kept in plain text so the home screen can list it), a deck while it is
// unlocked and open (it is in memory and visible on screen), exports you make (PDF/PPTX/etc. are plain), or against a
// weak password, malware, or someone watching you type. There is no password recovery: a forgotten password means lost data.
export const KDF_ITERATIONS = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();

export function b64encode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
export function b64decode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) throw new Error('Invalid base64');
  const s = atob(str); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const subtle = () => { const s = globalThis.crypto && globalThis.crypto.subtle; if (!s) throw new Error('Web Crypto is not available in this browser context (it requires HTTPS or localhost).'); return s; };

export async function deriveKey(password, salt, iterations = KDF_ITERATIONS) {
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export function newSalt() { return crypto.getRandomValues(new Uint8Array(16)); }

// A "session" is what we keep in memory while a deck is unlocked: the derived key plus its salt/iterations.
export async function createLockSession(password, iterations = KDF_ITERATIONS) {
  if (typeof password !== 'string' || password.length < 4) throw new Error('Password must be at least 4 characters.');
  const salt = newSalt();
  return { key: await deriveKey(password, salt, iterations), salt, iterations };
}
export async function encryptJson(obj, session) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, session.key, enc.encode(JSON.stringify(obj)));
  return { v: 1, alg: 'PBKDF2-SHA256/AES-GCM-256', iter: session.iterations, salt: b64encode(session.salt), iv: b64encode(iv), ct: b64encode(ct) };
}
export function validateEnc(e) {
  if (!e || typeof e !== 'object' || e.v !== 1 || e.alg !== 'PBKDF2-SHA256/AES-GCM-256') throw new Error('Unsupported encrypted data');
  if (!Number.isInteger(e.iter) || e.iter < 1000 || e.iter > 5000000) throw new Error('Invalid key-derivation settings');
  const salt = b64decode(e.salt), iv = b64decode(e.iv), ct = b64decode(e.ct);
  if (salt.length !== 16 || iv.length !== 12 || ct.length < 16) throw new Error('Invalid encrypted data');
  return { salt, iv, ct, iter: e.iter };
}
export async function unlock(encrypted, password) {
  const { salt, iv, ct, iter } = validateEnc(encrypted);
  const key = await deriveKey(password, salt, iter);
  let plain;
  try { plain = await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct); } catch { throw new WrongPasswordError(); }
  return { obj: JSON.parse(dec.decode(plain)), session: { key, salt, iterations: iter } };
}
export async function decryptWithSession(encrypted, session) {
  const { iv, ct } = validateEnc(encrypted);
  try { return JSON.parse(dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv }, session.key, ct))); } catch { throw new WrongPasswordError(); }
}
export class WrongPasswordError extends Error { constructor() { super('Wrong password, or the data is damaged.'); this.name = 'WrongPasswordError'; } }
