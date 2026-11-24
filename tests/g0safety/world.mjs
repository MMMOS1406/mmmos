// Shared fake world for the G0 safety tests: NO network, NO credentials, NOTHING is written anywhere. SYNTHETIC data only.
// Loads the REAL api/ops.js and api/generate.js of this branch AND of origin/main (as temporary files inside api/, removed afterwards) against ONE in-memory world.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { pathToFileURL } from 'node:url'; import { createHmac } from 'node:crypto';
export const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const SECRET = 'g0-test-session-secret';
export const signCeo = () => { const p = Buffer.from(JSON.stringify({ sub: 'ceo', exp: Date.now() + 3600e3 })).toString('base64url'); return `${p}.${createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
export const json = (o, status = 200) => ({ ok: status < 400, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) }, json: async () => o, text: async () => JSON.stringify(o) });
export const world = { googleFull: [], google: [], connections: [], router: null, locks: {}, writes: [], reads: [], anthropic: [], settings: [], rules: [], audit: [], decision: { ok: true, perChannel: [] }, nextRuleId: 1000, flags: { srv_studio_v2_enabled: 'true', srv_farsi_creative_v2: 'on' } };
export function resetWorld() { world.googleFull = []; world.google = []; world.connections = []; world.router = null; world.failLocks = false; world.locks = {}; world.writes = []; world.reads = []; world.anthropic = []; world.settings = [{ engine: 'SRV Farsi', auto_apply: false, updated_at: '2026-06-15T17:12:26Z' }, { engine: 'SRV English', auto_apply: false, updated_at: '2026-06-15T17:12:29Z' }]; world.rules = []; world.audit = []; world.nextRuleId = 1000; world.decision = { ok: true, perChannel: [] }; }
const eq = (q, k) => { const m = new RegExp('(?:^|[?&])' + k + '=eq\\.([^&]+)').exec(q); return m ? decodeURIComponent(m[1]) : null; };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), method = (opts && opts.method) || 'GET';
  if (u.startsWith('https://api.anthropic.com')) { world.anthropic.push(JSON.parse(opts.body)); return json({ content: [{ type: 'text', text: '<package>{"title":"T","concept":"c","mood":"m","hook":"h"}</package>' }], stop_reason: 'end_turn' }); }
  if (world.router && /^https:\/\/app\.test\//.test(u)) return world.router(u, opts);   // the project's own endpoints (internal hops)
  if (/googleapis\.com|accounts\.google\.com/.test(u)) {
    world.google.push(u.replace(/\?.*/, '').replace('https://', '')); world.googleFull.push(u);
    if (/oauth2/.test(u)) return json({ access_token: 'AT', expires_in: 3600 });
    if (/youtubeanalytics/.test(u)) return json({ columnHeaders: [{ name: 'video' }, { name: 'views' }], rows: [['v1', 5]] });
    return json({ items: [] });
  }
  if (u.includes('action=decision_engine')) return json(world.decision);
  const m = /\/rest\/v1\/([a-z_]+)(\?(.*))?$/.exec(u); if (!m) return json({}, 404);
  const table = m[1], q = m[3] || ''; const body = opts.body ? JSON.parse(opts.body) : null;
  if (method !== 'GET') world.writes.push({ method, table, q, body }); else world.reads.push(table + '?' + q);
  if (table === 'youtube_connections' && method === 'GET') return json(world.connections.map((c) => ({ ...c })));
  if (table === 'youtube_channels' && method === 'GET') return json(world.connections.map((c, i) => ({ channel_id: c.channel_id, title: 'Chan ' + i, mmm_engine: i ? 'SRV English' : 'SRV Farsi' })));
  if (table === 'ceo_auth_config') {   // S-F: a query may ask for several keys at once (the paid-endpoint gate reads CEO and VA rows in one call)
    const all = [{ key: 'ceo_session_secret_production', value: SECRET }, { key: 'ceo_pin_hash_production', value: 'e'.repeat(64) }, { key: 'operator_pin_hash_production', value: 'f'.repeat(64) }];
    return json(all.filter((r) => q.includes(r.key)));
  }
  if (table === 'app_settings' && /^cron_lock_/.test(eq(q, 'key') || '') || (table === 'app_settings' && method === 'POST' && body && [].concat(body).every((r) => /^cron_lock_/.test(r.key || '')))) {
    if (world.failLocks) return json({ message: 'boom' }, 500);
    if (method === 'POST') { for (const r of [].concat(body)) if (!world.locks[r.key]) world.locks[r.key] = { value: r.value, updated_at: Date.parse(r.updated_at) }; return json([]); }
    const k = eq(q, 'key'); const row = world.locks[k];
    if (method === 'GET') return json(row ? [{ value: row.value, updated_at: new Date(row.updated_at).toISOString() }] : []);
    if (method === 'PATCH') {   // one conditional update = atomic (JavaScript runs this block without interleaving)
      if (!row) return json([]);
      const lt = /updated_at=lt\.([^&]+)/.exec(q); if (lt && !(row.updated_at < Date.parse(decodeURIComponent(lt[1])))) return json([]);
      const like = /value=like\.\*([^*&]+)\*/.exec(q); if (like && !String(row.value).includes(decodeURIComponent(like[1]))) return json([]);
      if (body.value !== undefined) row.value = body.value; if (body.updated_at !== undefined) row.updated_at = Date.parse(body.updated_at);
      return json(/return=representation/.test((opts.headers || {}).Prefer || '') ? [{ key: k, value: row.value, updated_at: new Date(row.updated_at).toISOString() }] : []);
    }
  }
  if (table === 'app_settings' && method === 'GET') { const k = eq(q, 'key'); return json(k && world.flags[k] !== undefined ? [{ key: k, value: world.flags[k] }] : []); }
  if (table === 'optimization_settings') {
    if (method === 'GET') return json(world.settings.map((s) => ({ ...s })));
    for (const row of [].concat(body || [])) { const i = world.settings.findIndex((s) => s.engine === row.engine); if (i >= 0) world.settings[i] = { ...world.settings[i], ...row }; else world.settings.push(row); } return json([]);
  }
  if (table === 'optimization_rules') {
    if (method === 'GET') { let r = world.rules.slice(); const e = eq(q, 'engine'), t = eq(q, 'rule_type'); if (e) r = r.filter((x) => x.engine === e); if (t) r = r.filter((x) => x.rule_type === t); if (/active=eq\.true/.test(q)) r = r.filter((x) => x.active); if (/active=eq\.false/.test(q)) r = r.filter((x) => !x.active); if (/auto_applied=eq\.false/.test(q)) r = r.filter((x) => !x.auto_applied); const gt = /expires_at=gt\.([^&]+)/.exec(q); if (gt) r = r.filter((x) => x.expires_at && Date.parse(x.expires_at) > Date.parse(decodeURIComponent(gt[1]))); return json(r.map((x) => ({ ...x }))); }
    if (method === 'PATCH') { const ids = /id=in\.\(([^)]*)\)/.exec(q); const set = ids ? ids[1].split(',').map(Number) : []; for (const r of world.rules) if (set.includes(r.id)) Object.assign(r, body); return json([]); }
    if (method === 'POST') { const rows = [].concat(body).map((r) => ({ id: world.nextRuleId++, ...r })); world.rules.push(...rows); return json(rows); }
  }
  if (table === 'optimization_audit_log') { if (method === 'POST') { world.audit.push(...[].concat(body)); return json([]); } return json(world.audit.slice()); }
  return json([]);
};
process.env.SUPABASE_URL = 'https://supabase.test'; process.env.SUPABASE_SERVICE_KEY = 'svc-test'; process.env.ANTHROPIC_API_KEY = 'sk-test';
export const mkRes = () => ({ code: 200, body: null, headers: {}, setHeader() {}, removeHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end(b) { this.raw = b; return this; } });
export const load = async (file) => import(pathToFileURL(file).href + '?t=' + Math.random());
export const baselineFiles = [];
// The historical baseline is PINNED to a commit (default 41af6d7 = main immediately before the G0 release) so the comparisons keep their meaning after origin/main moves. G1 tests pass 7d3f81a (the G0 release).
export const G0_BASE_REF = process.env.G0_BASE_REF || '41af6d7';
export async function loadPair(rel, ref = G0_BASE_REF) {   // returns { base, cur } modules: the pinned-ref version and this branch's version of api/<rel>
  const baseFile = path.join(repo, 'api', path.dirname(rel), '.baseline_g0_' + String(ref).slice(0, 7) + '_' + path.basename(rel));
  fs.writeFileSync(baseFile, execFileSync('git', ['show', ref + ':api/' + rel], { cwd: repo, maxBuffer: 256 * 1024 * 1024 })); baselineFiles.push(baseFile);
  return { base: await load(baseFile), cur: await load(path.join(repo, 'api', rel)) };
}
export const cleanup = () => { for (const f of baselineFiles) try { fs.unlinkSync(f); } catch (_) {} };
export const makeCall = (mod) => async ({ action, method = 'POST', body = {}, query = {}, headers = {}, ceo = false, ceoHeader = false } = {}) => {
  const res = mkRes(); const b = { ...body }; const h = { origin: 'https://mmm-static.vercel.app', ...headers };
  if (ceo && !ceoHeader) b.ceo_session_token = signCeo(); if (ceo && ceoHeader) h['x-mmm-ceo-session'] = signCeo();
  await mod.default({ method, query: { action, ...query }, headers: h, body: method === 'POST' ? b : null }, res); return res;
};
export const reporter = () => { const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }; const done = () => { const f = R.filter((x) => !x).length; console.log(`\n${R.length - f} passed, ${f} failed`); return f; }; return { check, done }; };
