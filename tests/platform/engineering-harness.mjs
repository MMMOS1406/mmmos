// Shared in-memory stand-in for Supabase REST + Storage + the GitHub read API,
// used to run the REAL api/ops.js handler in tests. Never touches production:
// any request to another host fails the test run.
import { createHash, createHmac, randomUUID } from 'node:crypto';

export const SB = 'https://tldcwvtwjypmwynsklsd.supabase.co';
export const SESSION_SECRET = 'test-session-secret';
export const CEO_PIN = '4826';
export const GITHUB_REPO = 'MMMOS1406/mmmos';
export const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

export const db = {
  engineering_tasks: [], engineering_workers: [], engineering_advisers: [], brain_evidence: [],
  brain_agent_runs: [], engineering_brain: [], brain_knowledge: [], brain_learning_memory: [],
  engineering_workspace_files: [], brain_test_runs: [], production_deployments: [], production_release_authorizations: [],
  app_settings: [],
  mmm_platform_flags: [], // release switches; tests turn them on explicitly
  ceo_auth_config: [{ key: 'ceo_session_secret_production', value: SESSION_SECRET }, { key: 'ceo_pin_hash_production', value: sha(CEO_PIN) }],
};
export const storage = { objects: new Map() };
// GitHub: branch name → { files, commits, pr: { number, head, base, state, merged } | null, pullsStatus }
export const github = { branches: new Map(), pullsStatus: 200, calls: [] };
export const calls = [];

const toUuid = (v) => (typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v)) ? `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`.toLowerCase() : v;
const UUID_COLS = { engineering_tasks: ['agent_run_id', 'claimed_by_worker_id'] };

function getField(row, key) {
  const parts = key.split(/->>|->/);
  if (parts.length > 1) { let v = row[parts[0]]; for (const k of parts.slice(1)) v = v == null ? undefined : v[k]; return v == null ? null : (key.includes('->>') ? String(v) : v); }
  return row[key];
}
function cond(row, key, expr) {
  const v = getField(row, key);
  if (expr === 'is.null') return v == null;
  if (expr === 'not.is.null') return v != null;
  const op = expr.slice(0, expr.indexOf('.')), t = decodeURIComponent(expr.slice(expr.indexOf('.') + 1));
  if (op === 'eq') return v != null && String(v) === t;
  if (op === 'lt') return v != null && new Date(v) < new Date(t);
  if (op === 'gt') return v != null && new Date(v) > new Date(t);
  if (op === 'in') return t.slice(1, -1).split(',').includes(String(v));
  throw new Error('unsupported filter ' + key + '=' + expr);
}
function matches(row, params) {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    if (k === 'or') { const inner = raw.slice(1, -1).split(','); if (!inner.some(p => { const i = p.indexOf('.'); return cond(row, p.slice(0, i), p.slice(i + 1)); })) return false; continue; }
    if (!cond(row, k, raw)) return false;
  }
  return true;
}
const parseQuery = (qs) => qs.split('&').filter(Boolean).map(part => { const i = part.indexOf('='); return [decodeURIComponent(part.slice(0, i)), part.slice(i + 1)]; });
function project(row, params) {
  const sel = params.find(([k]) => k === 'select')?.[1];
  if (!sel) return { ...row };
  const out = {};
  for (const s of decodeURIComponent(sel).split(',')) {
    if (s === '*') { Object.assign(out, row); continue; }
    const m = /^(\w+)->>(\w+)$/.exec(s);
    if (m) out[m[2]] = row[m[1]]?.[m[2]] ?? null; else out[s] = row[s] ?? null;
  }
  return out;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  calls.push({ method, url: u });
  if (u.startsWith('https://api.github.com/')) {
    github.calls.push(u);
    // 035: a test may install a full GitHub simulation; it sees every GitHub call first.
    if (typeof github.handler === 'function') { const r = await github.handler(u, method, opts); if (r) return r; }
    const c = /\/repos\/([^/]+\/[^/]+)\/compare\/main\.\.\.(.+)$/.exec(u);
    if (c) { const b = github.branches.get(decodeURIComponent(c[2])); if (!b || c[1] !== GITHUB_REPO) return json(404, {}); return json(200, { ahead_by: b.commits.length, commits: b.commits.map(s => ({ sha: s })), files: b.files.map(f => ({ filename: f })) }); }
    const pl = /\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(u);
    if (pl) { if (github.pullsStatus !== 200) return json(github.pullsStatus, {}); for (const [name, b] of github.branches) if (b.pr && String(b.pr.number) === pl[2]) return json(200, { head: { ref: b.pr.head || name }, base: { ref: b.pr.base || 'main' }, state: b.pr.state || 'open', merged: !!b.pr.merged }); return json(404, {}); }
    return json(404, {});
  }
  if (!u.startsWith(SB)) return json(599, { error: 'unexpected network call in test: ' + u });
  const path = u.slice(SB.length);
  const UP = '/storage/v1/object/upload/sign/engineering-artifacts/', SG = '/storage/v1/object/sign/engineering-artifacts/';
  if (path.startsWith(UP)) { const p = decodeURIComponent(path.slice(UP.length)); return json(200, { url: `/object/upload/sign/engineering-artifacts/${p}?token=up` }); }
  if (path === '/storage/v1/object/list/engineering-artifacts') { const { prefix, search } = JSON.parse(opts.body); return json(200, [...storage.objects.entries()].filter(([k]) => k.startsWith(prefix + '/') && k.slice(prefix.length + 1).includes(search)).map(([k, v]) => ({ name: k.slice(prefix.length + 1), id: randomUUID(), metadata: v }))); }
  // 033: object download (only objects given a body; others behave as missing, like a failed read).
  const OB = '/storage/v1/object/engineering-artifacts/';
  if (path.startsWith(OB)) { const p = decodeURIComponent(path.slice(OB.length)); const o = storage.objects.get(p); return o && o.body !== undefined ? new Response(o.body, { status: 200 }) : json(404, {}); }
  if (path.startsWith(SG)) { const p = decodeURIComponent(path.slice(SG.length)); return storage.objects.has(p) ? json(200, { signedURL: `/object/sign/engineering-artifacts/${p}?token=dl` }) : json(404, {}); }
  const m = /^\/rest\/v1\/(\w+)\??(.*)$/.exec(path);
  if (!m) return json(404, { error: 'no route ' + path });
  const [, table, qs] = m;
  if (!db[table]) return json(404, { message: `relation "${table}" does not exist` });
  const params = parseQuery(qs);
  const norm = (o) => { for (const c of UUID_COLS[table] || []) if (c in o) o[c] = toUuid(o[c]); return o; };
  if (method === 'GET') {
    let rows = db[table].filter(r => matches(r, params));
    const off = params.find(([k]) => k === 'offset'); if (off) rows = rows.slice(Number(off[1]));
    const lim = params.find(([k]) => k === 'limit'); if (lim) rows = rows.slice(0, Number(lim[1]));
    return json(200, rows.map(r => project(r, params)));
  }
  if (method === 'POST') { const body = JSON.parse(opts.body); const list = (Array.isArray(body) ? body : [body]).map(r => norm({ id: randomUUID(), created_at: new Date().toISOString(), ...r })); db[table].push(...list); return json(201, list); }
  if (method === 'PATCH') { const patch = norm(JSON.parse(opts.body)); const rows = db[table].filter(r => matches(r, params)); rows.forEach(r => Object.assign(r, patch)); return json(200, rows); }
  return json(405, {});
};
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.GITHUB_REPO = GITHUB_REPO;
process.env.GITHUB_TOKEN = 'test-github-token';
const { default: handler } = await import('../../api/ops.js');

/** Calls the real handler. Returns { status, body (JSON or text), headers }. */
export async function call(action, body = {}, { method = 'POST', headers = {}, query = {} } = {}) {
  const req = { method, query: { action, ...query }, body, headers };
  let status = 200, payload, text = null; const h = {};
  const res = {
    setHeader(k, v) { h[k.toLowerCase()] = v; }, removeHeader(k) { delete h[k.toLowerCase()]; },
    status(s) { status = s; return res; }, json(p) { payload = p; return res; }, send(t) { text = String(t); return res; }, end() { return res; },
  };
  await handler(req, res);
  return { status, body: payload !== undefined ? payload : text, headers: h };
}
export function ceoToken() {
  const payload = Buffer.from(JSON.stringify({ sub: 'ceo', exp: Date.now() + 3600e3 })).toString('base64url');
  return `${payload}.${createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')}`;
}
export function makeOk() {
  const r = { pass: 0, fail: 0 };
  r.ok = (n, c, x = '') => { c ? r.pass++ : r.fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
  return r;
}
export { randomUUID };
