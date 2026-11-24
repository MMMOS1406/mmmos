// S-F — session authorization for the standalone paid-model endpoint (api/generate.js).
// It re-implements, in a pure and testable form, exactly what api/ops.js does for CEO and VA ("operator") sessions:
//   CEO      payload.signature, HMAC-SHA256 with ceo_session_secret_production, sub "ceo", unexpired (lib/ceoSession.mjs)
//   operator payload.signature, HMAC-SHA256 with HMAC(ceo secret, "mmmos-operator-session-v1"), sub "operator", unexpired,
//            pv = first 12 characters of operator_pin_hash_production (a PIN change signs every VA out)
// Both use the strict token shape (string, <= 4096 chars, exactly two non-empty base64url segments).
// FAILS CLOSED: any missing configuration row, network error or malformed token answers { ok: false }. There is no log-only mode here.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseSessionToken, verifyCeoToken } from './ceoSession.mjs';

export function operatorSecret(ceoSecret) {
  return createHmac('sha256', String(ceoSecret)).update('mmmos-operator-session-v1').digest('base64url');
}
export function verifyOperatorToken(token, ceoSecret, pinHash, now = Date.now()) {
  const p = parseSessionToken(token); if (!p || !ceoSecret || !pinHash) return null;
  const expected = createHmac('sha256', operatorSecret(ceoSecret)).update(p.payload).digest('base64url');
  const a = Buffer.from(p.sig, 'utf8'), b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let obj; try { obj = JSON.parse(Buffer.from(p.payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!obj || obj.sub !== 'operator' || !obj.exp || now > obj.exp || obj.pv !== String(pinHash).slice(0, 12)) return null;
  return obj;
}
// Where the tokens may be sent: headers (x-mmm-ceo-session / x-mmm-operator-session) or the same-named fields in the JSON body (POST) / query.
export function sessionTokensFromRequest(req) {
  const src = (req && (req.method === 'POST' ? req.body : req.query)) || {};
  const h = (req && req.headers) || {};
  const pick = (hv, bv) => (typeof hv === 'string' && hv) || (src && typeof src === 'object' && typeof bv === 'string' && bv) || '';
  return { ceo: pick(h['x-mmm-ceo-session'], src && src.ceo_session_token), operator: pick(h['x-mmm-operator-session'], src && src.operator_session_token) };
}
// -> { ok: true, role: 'ceo' | 'operator' } or { ok: false }. `fetchImpl` is injected so tests never reach the network.
export async function paidSessionOk(req, { fetchImpl, supabaseUrl, serviceKey, now = Date.now() }) {
  const t = sessionTokensFromRequest(req);
  if (!parseSessionToken(t.ceo) && !parseSessionToken(t.operator)) return { ok: false };   // no well-formed token: no database read at all
  try {
    const r = await fetchImpl(`${supabaseUrl}/rest/v1/ceo_auth_config?key=in.(ceo_session_secret_production,ceo_pin_hash_production,operator_pin_hash_production)&select=key,value`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!r.ok) return { ok: false };
    const m = {}; for (const row of (await r.json()) || []) m[row.key] = row.value;
    if (!m.ceo_session_secret_production || !m.ceo_pin_hash_production) return { ok: false };   // same precondition as api/ops.js
    if (t.ceo && verifyCeoToken(t.ceo, m.ceo_session_secret_production, now)) return { ok: true, role: 'ceo' };
    if (t.operator && m.operator_pin_hash_production && verifyOperatorToken(t.operator, m.ceo_session_secret_production, m.operator_pin_hash_production, now)) return { ok: true, role: 'operator' };
    return { ok: false };
  } catch (_) { return { ok: false }; }
}
