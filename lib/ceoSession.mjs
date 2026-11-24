// CEO session check for the standalone API files (api/youtube/sync.js, api/tiktok/sync.js) that cannot import the helpers inside api/ops.js (G1 / S-A).
// It re-implements exactly the CEO verification of api/ops.js (`_ceoVerifySession` + `_requireCeoSessionStrict`): token `payload.signature` (base64url), HMAC-SHA256 with the
// server-held secret from ceo_auth_config, subject "ceo", unexpired. The token shape check is the STRICT one (string, <= 4 KB, exactly two base64url segments).
// tests/g1security proves that both implementations accept and refuse the same tokens.
// PURE except `ceoSessionOk`, which reads ceo_auth_config through the injected fetch (no cache; these endpoints are rarely called).
import { createHmac, timingSafeEqual } from 'node:crypto';

const B64URL = /^[A-Za-z0-9_-]+$/;
export function parseSessionToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.'); if (parts.length !== 2) return null;
  const [payload, sig] = parts; if (!payload || !sig || !B64URL.test(payload) || !B64URL.test(sig)) return null;
  return { payload, sig };
}
export function verifyCeoToken(token, secret, now = Date.now()) {
  const p = parseSessionToken(token); if (!p || !secret) return null;
  const expected = createHmac('sha256', secret).update(p.payload).digest('base64url');
  const a = Buffer.from(p.sig, 'utf8'), b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let obj; try { obj = JSON.parse(Buffer.from(p.payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!obj || obj.sub !== 'ceo' || !obj.exp || now > obj.exp) return null;
  return obj;
}
// Token location: header `x-mmm-ceo-session` (any method) or `ceo_session_token` in the JSON body (POST) / query (other methods) — the same places api/ops.js reads.
export function tokenFromRequest(req) {
  const src = (req && (req.method === 'POST' ? req.body : req.query)) || {};
  const h = req && req.headers ? req.headers['x-mmm-ceo-session'] : undefined;
  return (src && typeof src === 'object' && src.ceo_session_token) || (typeof h === 'string' ? h : '');
}
export async function ceoSessionOk(req, { fetchImpl, supabaseUrl, serviceKey, now = Date.now() }) {
  const token = tokenFromRequest(req); if (!parseSessionToken(token)) return false;
  try {
    const r = await fetchImpl(`${supabaseUrl}/rest/v1/ceo_auth_config?key=in.(ceo_session_secret_production,ceo_pin_hash_production)&select=key,value`, { headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey } });
    if (!r.ok) return false;
    const map = {}; for (const row of (await r.json()) || []) map[row.key] = row.value;
    if (!map.ceo_session_secret_production || !map.ceo_pin_hash_production) return false;   // same precondition as ops.js: both rows must exist
    return !!verifyCeoToken(token, map.ceo_session_secret_production, now);
  } catch (_) { return false; }
}
