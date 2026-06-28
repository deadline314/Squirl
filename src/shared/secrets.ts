/**
 * 機密小值的本機加密存放（WebCrypto AES-GCM，金鑰由 PBKDF2 衍生）。
 *
 * 誠實的安全邊界：用戶端無法達成絕對保密——衍生金鑰的材料同樣在本機。
 * 此層的目的是確保機密值「永不以明文落地」：不會出現在 storage 檢視器、
 * 設定匯出、備份、同步與日誌中，防範的是旁觀與順手複製，而非針對性攻擊。
 */
import { createLogger } from './logger';

const log = createLogger('secrets');

const PREFIX = 'secret.';
const PEPPER = 'squirl/secrets@1';
const SALT = 'squirl-static-salt';

let keyPromise: Promise<CryptoKey> | null = null;

function deriveKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(chrome.runtime.id + PEPPER),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode(SALT), iterations: 100_000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  return keyPromise;
}

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
};

const unb64 = (s: string): Uint8Array => {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export async function saveSecret(name: string, value: string): Promise<void> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  await chrome.storage.local.set({ [`${PREFIX}${name}`]: { iv: b64(iv), ct: b64(ct) } });
}

/** 讀取並解密；任何失敗（含資料毀損）回 null，永不 throw */
export async function loadSecret(name: string): Promise<string | null> {
  try {
    const res = await chrome.storage.local.get(`${PREFIX}${name}`);
    const stored = res[`${PREFIX}${name}`] as { iv: string; ct: string } | undefined;
    if (!stored?.iv || !stored?.ct) return null;
    const key = await deriveKey();
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(stored.iv) as BufferSource },
      key,
      unb64(stored.ct) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch (e) {
    log.warn(`loadSecret(${name}) failed`, e);
    return null;
  }
}

export async function clearSecret(name: string): Promise<void> {
  await chrome.storage.local.remove(`${PREFIX}${name}`);
}
