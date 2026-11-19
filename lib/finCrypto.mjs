// Finance credential vault (Finance V2 phase 2A): AES-256-GCM envelope for provider access tokens, with the keys kept OUTSIDE the database.
// PURE: no network, no database, no clock; keys are passed in (the server reads them from environment variables, never from source or the database).
// Format of a sealed value:  enc:v1:<kid>:<iv>:<ciphertext>:<tag>   (base64url parts)
//  - a fresh random 96-bit IV per seal (never reused with a key);
//  - the authenticated data (AAD) binds the ciphertext to ITS record (e.g. "plaid:<item_id>"): a ciphertext copied to another row fails to open;
//  - <kid> names the key, so keys can be rotated: seal with the current key, still open with older keys until they are retired, rewrap in place;
//  - every failure is a CredentialError with a stable code and a generic message — never the plaintext, the key or the ciphertext.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const PREFIX = 'enc:v1:';
const KID_RE = /^[A-Za-z0-9_-]{1,16}$/;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

export class CredentialError extends Error {
  constructor(code, message) { super(message || code); this.name = 'CredentialError'; this.code = code; }
}
const MSG = {
  key_not_configured: 'credential encryption is not configured',
  bad_key: 'an encryption key is invalid (it must be 32 random bytes, base64)',
  unknown_key: 'the key that sealed this credential is not available (retired or never configured)',
  malformed: 'the stored credential is not in the expected format',
  auth_failed: 'the credential could not be decrypted (wrong key, wrong record, or the value was altered)',
  plaintext_refused: 'a plaintext credential was refused because encryption is required',
  bad_aad: 'a record binding is required to seal or open a credential',
  empty: 'there is nothing to seal',
};
const fail = (code) => { throw new CredentialError(code, MSG[code]); };

export const isSealed = (v) => typeof v === 'string' && v.startsWith(PREFIX);

// Keys: a 32-byte key as base64 (or base64url). All-zero / single-byte-repeated keys are refused as obviously not random.
export function parseKey(b64) {
  let buf; try { buf = Buffer.from(String(b64 || '').trim(), 'base64'); } catch (_) { fail('bad_key'); }
  if (buf.length !== 32) fail('bad_key');
  if (buf.every((x) => x === buf[0])) fail('bad_key');
  return buf;
}
// Environment form:  FIN_TOKEN_KEYS="k2026a:<base64>,k2025b:<base64>"   FIN_TOKEN_KEY_CURRENT="k2026a" (defaults to the first listed)   FIN_REQUIRE_ENCRYPTION="1"
export function parseKeyring(raw, currentKid) {
  const keys = new Map(); const s = String(raw || '').trim();
  if (s) for (const part of s.split(',')) {
    const i = part.indexOf(':'); if (i < 1) fail('bad_key'); const kid = part.slice(0, i).trim();
    if (!KID_RE.test(kid) || keys.has(kid)) fail('bad_key'); keys.set(kid, parseKey(part.slice(i + 1)));
  }
  const cur = keys.size ? (currentKid && String(currentKid).trim() ? String(currentKid).trim() : keys.keys().next().value) : null;
  if (cur && !keys.has(cur)) fail('bad_key');
  return { keys, current: cur };
}

export function createVault({ keys = new Map(), current = null, requireEncryption = false } = {}) {
  const configured = keys.size > 0 && !!current && keys.has(current);
  const aadBuf = (aad) => { if (typeof aad !== 'string' || !aad) fail('bad_aad'); return Buffer.from(aad, 'utf8'); };
  function seal(plain, aad) {
    if (typeof plain !== 'string' || !plain) fail('empty');
    const a = aadBuf(aad);
    if (!configured) { if (requireEncryption) fail('plaintext_refused'); fail('key_not_configured'); }
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', keys.get(current), iv, { authTagLength: 16 });
    c.setAAD(a); const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `${PREFIX}${current}:${b64u(iv)}:${b64u(ct)}:${b64u(c.getAuthTag())}`;
  }
  function parse(v) {
    if (!isSealed(v)) fail('malformed');
    const p = v.slice(PREFIX.length).split(':'); if (p.length !== 4 || !KID_RE.test(p[0])) fail('malformed');
    const iv = fromB64u(p[1]), ct = fromB64u(p[2]), tag = fromB64u(p[3]);
    if (iv.length !== 12 || tag.length !== 16 || !ct.length) fail('malformed');
    return { kid: p[0], iv, ct, tag };
  }
  function open(v, aad) {
    const a = aadBuf(aad); const { kid, iv, ct, tag } = parse(v);
    const key = keys.get(kid); if (!key) fail('unknown_key');
    try { const d = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 }); d.setAAD(a); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]).toString('utf8'); }
    catch (_) { fail('auth_failed'); }
  }
  // Compatibility read: a legacy plaintext value is returned as-is (flagged) so existing rows keep working until they are sealed; sealed values are opened.
  function openCompat(v, aad) { if (isSealed(v)) return { value: open(v, aad), legacy: false }; if (typeof v === 'string' && v) { if (requireEncryption) fail('plaintext_refused'); return { value: v, legacy: true }; } fail('malformed'); }
  // Store helper: seals when keys exist; stores plaintext only when encryption is neither configured nor required (today's behaviour).
  function sealOrPlain(plain, aad) { if (configured) return seal(plain, aad); if (requireEncryption) fail('plaintext_refused'); return plain; }
  const kidOf = (v) => (isSealed(v) ? parse(v).kid : null);
  const needsRewrap = (v) => !isSealed(v) || (configured && kidOf(v) !== current);
  function rewrap(v, aad, toKid) { const plain = openCompat(v, aad).value; if (toKid && toKid !== current) { const alt = createVault({ keys, current: toKid, requireEncryption }); return alt.seal(plain, aad); } return seal(plain, aad); }
  return { configured, requireEncryption, current, kids: () => [...keys.keys()], seal, open, openCompat, sealOrPlain, isSealed, kidOf, needsRewrap, rewrap };
}

export function vaultFromEnv(env = {}) {
  const ring = parseKeyring(env.FIN_TOKEN_KEYS, env.FIN_TOKEN_KEY_CURRENT);
  return createVault({ keys: ring.keys, current: ring.current, requireEncryption: String(env.FIN_REQUIRE_ENCRYPTION || '') === '1' });
}
// Scrub anything that looks like a sealed credential or a bearer token from text that may reach a log or a response.
export const redact = (s) => String(s == null ? '' : s).replace(/enc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+/g, '[sealed credential]').replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [removed]').replace(/access-(sandbox|development|production)-[A-Za-z0-9-]{8,}/g, '[plaid token removed]');
// The record binding for a Plaid item (a ciphertext copied to another item will not open).
export const plaidAad = (itemId) => 'plaid:' + String(itemId || '');
// Supabase/PostgREST error bodies can echo the failing ROW (including a token): keep only the HTTP status and the error code.
export function safeDbError(table, op, status, bodyText) { let code = ''; try { const j = JSON.parse(String(bodyText || '{}')); code = typeof j.code === 'string' ? j.code.slice(0, 12) : ''; } catch (_) { /* body is not JSON: ignore it entirely */ } return `${table} ${op} failed (HTTP ${status}${code ? ', ' + code : ''})`; }

// Safe disconnection. A provider-side revoke comes FIRST; the stored ciphertext is deleted only when the provider confirms the item is gone (or was already dead).
//   providerResult: { ok:boolean, status:number, errorCode?:string, networkError?:boolean }   decryptOk: whether the stored credential could be opened   force: explicit CEO override
export function planDisconnect({ providerResult, decryptOk = true, force = false }) {
  const DEAD = new Set(['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN', 'ITEM_LOGIN_REQUIRED_REVOKED']);
  if (!decryptOk) return force ? { action: 'delete', status: 'deleted_unrevoked', warn: 'credential unreadable: the provider item may still be active — revoke it in the provider dashboard' } : { action: 'keep', status: 'needs_manual_revoke', error: 'credential_unreadable' };
  if (providerResult && providerResult.ok) return { action: 'delete', status: 'revoked' };
  if (providerResult && !providerResult.networkError && providerResult.errorCode && DEAD.has(providerResult.errorCode)) return { action: 'delete', status: 'already_inactive' };
  return force ? { action: 'delete', status: 'deleted_unrevoked', warn: 'the provider revoke did not succeed: the item may still be active (and billed) — revoke it in the provider dashboard' } : { action: 'keep', status: 'revoke_pending', error: 'provider_revoke_failed' };
}
