// S-G — queue add/process and forced weekly-report generation need the scheduler bearer or a CEO session; reads stay open. REAL handlers, fake network, SYNTHETIC secrets.
import { createHmac } from 'node:crypto'; import { pathToFileURL } from 'node:url'; import path from 'node:path';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 200) : ''); } };
const SEC = 'sg-session-secret', BEARER = 'sg-cron-secret'; const exp = Date.now() + 3600e3;
const ceoTok = (secret = SEC, sub = 'ceo', e = exp) => { const p = Buffer.from(JSON.stringify({ sub, exp: e })).toString('base64url'); return p + '.' + createHmac('sha256', secret).update(p).digest('base64url'); };
process.env.SUPABASE_URL = 'https://supabase.test'; process.env.SUPABASE_SERVICE_KEY = 'svc-test';
let log = [], stored = [];
const J = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });
globalThis.fetch = async (url, opt = {}) => { const u = String(url), method = (opt && opt.method) || 'GET'; log.push({ method, u });
  if (/ceo_auth_config/.test(u)) return J([{ key: 'ceo_session_secret_production', value: SEC }, { key: 'ceo_pin_hash_production', value: 'e'.repeat(64) }]);
  if (/system_reports/.test(u) && method === 'GET' && /report_type=eq\.weekly/.test(u)) return J(stored);
  return J([]); };
const mk = () => { const r = { code: 200, body: null, headers: {}, setHeader() {}, removeHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } }; return r; };
const root = path.resolve(new URL('../../', import.meta.url).pathname) + '/';
const queue = (await import(pathToFileURL(root + 'api/queue.js').href)).default, weekly = (await import(pathToFileURL(root + 'api/reports/weekly.js').href)).default;
const call = async (h, { method = 'POST', url = '', headers = {}, query = {}, body = {} } = {}) => { log = []; const r = mk(); await h({ method, url, headers, query, body }, r); return { r, writes: log.filter((x) => x.method !== 'GET' && !/ceo_auth_config/.test(x.u)), reads: log.filter((x) => x.method === 'GET' && !/ceo_auth_config/.test(x.u)) }; };
const ENVS = { 'production, CRON_SECRET set': { CRON_SECRET: BEARER, VERCEL_ENV: 'production' }, 'production, CRON_SECRET missing': { VERCEL_ENV: 'production' } };
const clr = () => { delete process.env.CRON_SECRET; delete process.env.VERCEL_ENV; };
for (const [en, env] of Object.entries(ENVS)) {
  clr(); Object.assign(process.env, env); const want = env.CRON_SECRET ? 401 : 503;
  const creds = { none: {}, 'forged CEO': { 'x-mmm-ceo-session': ceoTok('wrong') }, 'wrong bearer': { authorization: 'Bearer nope' }, 'VA-shaped token': { 'x-mmm-ceo-session': ceoTok(SEC, 'operator') }, 'expired CEO': { 'x-mmm-ceo-session': ceoTok(SEC, 'ceo', Date.now() - 1) } };
  for (const [cn, headers] of Object.entries(creds)) {
    for (const route of ['/api/queue/add', '/api/queue/process']) { const o = await call(queue, { url: route, headers, body: { provider: 'x' } }); ok(`[${en}] queue ${route} · ${cn} → ${want}, no database access`, o.r.code === want && o.writes.length === 0 && !o.reads.some((x) => /api_queue/.test(x.u)), [o.r.code, o.writes.length]); }
    for (const [mn, a] of [['POST', { method: 'POST' }], ['GET ?gen=1', { method: 'GET', query: { gen: '1' } }]]) { const o = await call(weekly, { ...a, headers }); ok(`[${en}] weekly ${mn} · ${cn} → ${want}, no write`, o.r.code === want && o.writes.length === 0, [o.r.code, o.writes.length]); }
  }
}
clr(); Object.assign(process.env, ENVS['production, CRON_SECRET set']);
for (const [cn, headers] of Object.entries({ 'scheduler bearer': { authorization: 'Bearer ' + BEARER }, 'CEO session': { 'x-mmm-ceo-session': ceoTok() } })) {
  const q = await call(queue, { url: '/api/queue/add', headers, body: { provider: 'x', payload: {} } }); ok(`queue add · ${cn} passes the gate`, q.r.code !== 401 && q.r.code !== 503, q.r.code);
  const p = await call(queue, { url: '/api/queue/process', headers }); ok(`queue process · ${cn} passes the gate`, p.r.code !== 401 && p.r.code !== 503, p.r.code);
  const w = await call(weekly, { method: 'POST', headers }); ok(`weekly POST · ${cn} generates and stores a report`, w.r.code === 200 && w.writes.some((x) => /system_reports/.test(x.u)), [w.r.code, w.writes.length]);
  const g = await call(weekly, { method: 'GET', headers, query: { gen: '1' } }); ok(`weekly ?gen=1 · ${cn} generates`, g.r.code === 200 && g.writes.some((x) => /system_reports/.test(x.u)), g.r.code);
}
stored = [{ data: { week: 'stored' }, generated_at: '2026-11-23T00:00:00Z' }];
const s1 = await call(queue, { method: 'GET', url: '/api/queue/status' }); ok('queue /status is still a plain read (no credential)', s1.r.code === 200 && s1.writes.length === 0, s1.r.code);
const w0 = await call(weekly, { method: 'GET' }); ok('weekly GET (no credential) still returns the stored report, cached, and writes nothing', w0.r.code === 200 && w0.r.body.cached === true && w0.writes.length === 0, w0.r.body);
stored = []; const w1 = await call(weekly, { method: 'GET' }); ok('weekly GET with NO stored report and no credential → "no report yet", nothing generated or written', w1.r.code === 200 && w1.r.body.report === null && w1.writes.length === 0, [w1.r.code, w1.writes.length]);
const w2 = await call(weekly, { method: 'GET', headers: { authorization: 'Bearer ' + BEARER } }); ok('weekly GET with NO stored report, scheduler bearer → generates the first report', w2.r.code === 200 && w2.writes.some((x) => /system_reports/.test(x.u)), w2.r.code);
const sf = await call(weekly, { method: 'GET', query: { type: 'shortform' } }); ok('weekly ?type=shortform is untouched by S-G (read path)', sf.r.code !== 401 && sf.r.code !== 503, sf.r.code);
clr(); const loc = await call(queue, { url: '/api/queue/add', body: { provider: 'x' } }); ok('local development (no secret, not on Vercel) still works without credentials', loc.r.code !== 401 && loc.r.code !== 503, loc.r.code);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
