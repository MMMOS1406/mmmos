// CEO-017B — PIN hashing. New hashes are salted scrypt (memory-hard, per-PIN random salt, versioned string).
// Legacy unsalted SHA-256 hex hashes still VERIFY (so no one is locked out) and can be upgraded on a successful login.
// Pure functions, no I/O, no secrets of its own.
import { randomBytes, scrypt, createHash, timingSafeEqual } from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };   // ~16 MiB, tens of milliseconds per check
const PREFIX = 'scrypt$v1$';
const scryptAsync = (pin, salt, keylen, opts) => new Promise((res, rej) => scrypt(pin, salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
const sha256hex = (s) => createHash('sha256').update(String(s)).digest('hex');
const LEGACY = /^[0-9a-f]{64}$/;

export const isLegacyHash = (stored) => typeof stored === 'string' && LEGACY.test(stored);
export const isScryptHash = (stored) => typeof stored === 'string' && stored.startsWith(PREFIX);

export async function hashPin(pin) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(pin), salt, PARAMS.keylen, PARAMS);
  return `${PREFIX}N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** @returns {Promise<boolean>} constant-time comparison; false for anything malformed */
export async function verifyPin(pin, stored) {
  try {
    if (typeof pin !== 'string' || typeof stored !== 'string') return false;
    if (isLegacyHash(stored)) { const a = Buffer.from(sha256hex(pin)), b = Buffer.from(stored); return a.length === b.length && timingSafeEqual(a, b); }
    if (!isScryptHash(stored)) return false;
    const [, , params, salt, key] = stored.split('$'); const m = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(params || ''); if (!m || !salt || !key) return false;
    const N = +m[1], r = +m[2], p = +m[3]; if (N > 1 << 17 || r > 16 || p > 4) return false;      // refuse absurd cost parameters from a corrupted row
    const want = Buffer.from(key, 'base64url'); const got = await scryptAsync(pin, Buffer.from(salt, 'base64url'), want.length, { N, r, p });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}

/** Stable, non-reversible id of a stored hash, used to tie a session to the PIN it was issued under (changing the PIN signs everyone out). Legacy hashes keep their old 12-character prefix so existing sessions stay valid. */
export function pinFingerprint(stored) {
  if (typeof stored !== 'string' || !stored) return '';
  return isLegacyHash(stored) ? stored.slice(0, 12) : sha256hex(stored).slice(0, 12);
}

export const pinPolicyError = (pin) => (typeof pin !== 'string' || pin.length < 6 || pin.length > 32 || /^(.)\1*$/.test(pin) ? 'pin_must_be_6_to_32_characters' : null);
