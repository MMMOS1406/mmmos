// CEO-017F — opt-in LOCKDOWN simulation for the preservation stub (fixture.lockdown = makeLockdown()).
// Models production AFTER Stage 3b: (1) a direct browser call to /rest/v1/* is REFUSED (the public key has no table privileges) and recorded;
// (2) the db_proxy action applies the REAL authorization policy (lib/dataProxy.mjs decide()) for the signed-in role; (3) the srv-assets storage
// accepts an upload only when the object name matches the app's two real upload shapes, never replaces an existing
// object, and serves public reads. Nothing here touches a network or a database.
import { decide } from '../../lib/dataProxy.mjs';
// The object names the browser may create in the srv-assets bucket (the two real upload shapes of the app).
const PKG = '^pkg_[0-9]{10,16}/(photo|audio|long|short|thumb)_[0-9]{10,16}_[A-Za-z0-9._-]{1,255}$'; const MIX = '^mixes/mix_[0-9]{6}_[A-Za-z0-9]{3,40}/(mix_[0-9]{10,16}\\.(webm|mp4)|thumbnail\\.jpg)$';
export function insertPatterns() { return [new RegExp(PKG), new RegExp(MIX)]; }
const readRaw = (req) => new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); req.on('error', () => resolve(Buffer.alloc(0))); });
export function makeLockdown() {
  const pats = insertPatterns(); const objects = new Map(); const rep = { direct: [], proxyAllowed: [], proxyDenied: [], storageAllowed: [], storageDenied: [] };
  const roleOf = (j) => (j.ceo_session_token ? 'ceo' : j.operator_session_token ? 'operator' : j.family_session_token ? 'family' : null);
  return {
    objects, patterns: pats, report: () => rep,
    sb(req, res, u, pre, h) {   // returns a Promise when it handled the request, otherwise null (the stub carries on)
      const rest = u.pathname.replace(/^\/__sb/, ''); const m = rest.match(/^\/storage\/v1\/object\/(public\/)?srv-assets\/(.+)$/);
      if (m) return (async () => {
        const name = decodeURIComponent(m[2]);
        if (m[1]) { if (!objects.has(name)) return h.send(res, 404, { error: 'not_found' }); const b = objects.get(name); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': b.length }); return res.end(b); }
        if (req.method !== 'POST') return h.send(res, 400, { error: 'unsupported' });
        const body = await readRaw(req); const exists = objects.has(name);
        if (!pats.some((r) => r.test(name))) { rep.storageDenied.push({ name, why: 'path' }); return h.send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }); }
        if (exists) { rep.storageDenied.push({ name, why: 'exists' }); return h.send(res, 409, { statusCode: '409', error: 'Duplicate' }); }
        objects.set(name, body); rep.storageAllowed.push(name); return h.send(res, 200, { Key: 'srv-assets/' + name });
      })();
      if (/^\/rest\/v1\//.test(rest) && !(req && req.__via === 'proxy')) { rep.direct.push(`${req.method} ${rest.slice(0, 70)}`); return Promise.resolve(h.send(res, 401, { code: '42501', message: 'permission denied' })); }
      return null;
    },
    proxy(json) {   // the REAL policy decides; the stub only replays what it allows
      const role = roleOf(json || {}); const body = json && json.body ? (typeof json.body === 'string' ? json.body : JSON.stringify(json.body)) : '';
      const d = decide({ role, method: String((json && json.method) || 'GET').toUpperCase(), path: String(json && json.path), body, bodyBytes: Buffer.byteLength(body), prefer: (json && json.headers && json.headers.Prefer) || '' });
      const row = { role, method: json && json.method, path: String(json && json.path).split('?')[0], reason: d.reason || null };
      if (d.allow) { rep.proxyAllowed.push(row); return null; } rep.proxyDenied.push(row); return { status: d.status, body: { ok: false, error: d.reason } };
    },
  };
}
