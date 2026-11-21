// Shared fake world for the G0 safety tests: NO network, NO credentials, NOTHING is written anywhere. SYNTHETIC data only.
// Loads the REAL api/ops.js and api/generate.js of this branch AND of origin/main (as temporary files inside api/, removed afterwards) against ONE in-memory world.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { pathToFileURL } from 'node:url'; import { createHmac } from 'node:crypto';
export const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const SECRET = 'g0-test-session-secret';
export const signCeo = () => { const p = Buffer.from(JSON.stringify({ sub: 'ceo', exp: Date.now() + 3600e3 })).toString('base64url'); return `${p}.${createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
export const json = (o, status = 200) => ({ ok: status < 400, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) }, json: async () => o, text: async () => JSON.stringify(o) });
export const world = { writes: [], reads: [], anthropic: [], settings: [], rules: [], audit: [], decision: { ok: true, perChannel: [] }, nextRuleId: 1000, flags: { srv_studio_v2_enabled: 'true', srv_farsi_creative_v2: 'on' } };
export function resetWorld() { world.writes = []; world.reads = []; world.anthropic = []; world.settings = [{ engine: 'SRV Farsi', auto_apply: false, updated_at: '2026-06-15T17:12:26Z' }, { engine: 'SRV English', auto_apply: false, updated_at: '2026-06-15T17:12:29Z' }]; world.rules = []; world.audit = []; world.nextRuleId = 1000; world.decision = { ok: true, perChannel: [] }; }
const eq = (q, k) => { const m = new RegExp('(?:^|[?&])' + k + '=eq\\.([^&]+)').exec(q); return m ? decodeURIComponent(m[1]) : null; };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), method = (opts && opts.method) || 'GET';
  if (u.startsWith('https://api.anthropic.com')) { world.anthropic.push(JSON.parse(opts.body)); return json({ content: [{ type: 'text', text: '<package>{"title":"T","concept":"c","mood":"m","hook":"h"}</package>' }], stop_reason: 'end_turn' }); }
  if (u.includes('action=decision_engine')) return json(world.decision);
  const m = /\/rest\/v1\/([a-z_]+)(\?(.*))?$/.exec(u); if (!m) return json({}, 404);
  const table = m[1], q = m[3] || ''; const body = opts.body ? JSON.parse(opts.body) : null;
  if (method !== 'GET') world.writes.push({ method, table, q, body }); else world.reads.push(table + '?' + q);
  if (table === 'ceo_auth_config') return json(/operator_pin_hash/.test(q) ? [{ key: 'operator_pin_hash_production', value: 'f'.repeat(64) }] : [{ key: 'ceo_session_secret_production', value: SECRET }, { key: 'ceo_pin_hash_production', value: 'e'.repeat(64) }]);
  if (table === 'app_settings' && method === 'GET') { const k = eq(q, 'key'); return json(k && world.flags[k] !== undefined ? [{ key: k, value: world.flags[k] }] : []); }
  if (table === 'optimization_settings') {
    if (method === 'GET') return json(world.settings.map((s) => ({ ...s })));
    for (const row of [].concat(body || [])) { const i = world.settings.findIndex((s) => s.engine === row.engine); if (i >= 0) world.settings[i] = { ...world.settings[i], ...row }; else world.settings.push(row); } return json([]);
  }
  if (table === 'optimization_rules') {
    if (method === 'GET') { let r = world.rules.slice(); const e = eq(q, 'engine'), t = eq(q, 'rule_type'); if (e) r = r.filter((x) => x.engine === e); if (t) r = r.filter((x) => x.rule_type === t); if (/active=eq\.true/.test(q)) r = r.filter((x) => x.active); return json(r.map((x) => ({ ...x }))); }
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
export async function loadPair(rel) {   // returns { base, cur } modules: origin/main version and this branch's version of api/<rel>
  const baseFile = path.join(repo, 'api', '.baseline_g0_' + rel);
  fs.writeFileSync(baseFile, execFileSync('git', ['show', 'origin/main:api/' + rel], { cwd: repo, maxBuffer: 256 * 1024 * 1024 })); baselineFiles.push(baseFile);
  return { base: await load(baseFile), cur: await load(path.join(repo, 'api', rel)) };
}
export const cleanup = () => { for (const f of baselineFiles) try { fs.unlinkSync(f); } catch (_) {} };
export const makeCall = (mod) => async ({ action, method = 'POST', body = {}, query = {}, headers = {}, ceo = false, ceoHeader = false } = {}) => {
  const res = mkRes(); const b = { ...body }; const h = { origin: 'https://mmm-static.vercel.app', ...headers };
  if (ceo && !ceoHeader) b.ceo_session_token = signCeo(); if (ceo && ceoHeader) h['x-mmm-ceo-session'] = signCeo();
  await mod.default({ method, query: { action, ...query }, headers: h, body: method === 'POST' ? b : null }, res); return res;
};
export const reporter = () => { const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }; const done = () => { const f = R.filter((x) => !x).length; console.log(`\n${R.length - f} passed, ${f} failed`); return f; }; return { check, done }; };
