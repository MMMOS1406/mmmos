// G1 / S-A, S-B, S-C — the REAL handlers (api/ops.js, api/youtube/autosync.js, api/youtube/sync.js, api/tiktok/sync.js) of this branch and of the G0 release (7d3f81a) run against ONE fake
// world: no network, nothing written anywhere, SYNTHETIC keys. Covers authentication failures, retries, concurrent requests, normal scheduled execution and queued-rule de-duplication.
// node tests/g1security/test_g1_handlers.mjs
import fs from 'node:fs'; import { createHmac } from 'node:crypto';
import { world, resetWorld, loadPair, makeCall, cleanup, reporter, mkRes, json, signCeo, SECRET } from '../g0safety/world.mjs';
import { cronSignature } from '../../lib/cronAuth.mjs';
import { ceoSessionOk } from '../../lib/ceoSession.mjs';
const { check, done } = reporter(); const REL = '7d3f81a', KEY = 'svc-test';
const SIG = (scope) => ({ 'x-mmm-cron': cronSignature(scope, KEY) });
const CONNS = [{ channel_id: 'UC_A', refresh_token: 'RT_A', scope: 'yt-analytics.readonly youtube.upload', status: 'connected' }, { channel_id: 'UC_B', refresh_token: 'RT_B', scope: 'yt-analytics.readonly youtube.upload', status: 'connected' }];
const log = console.log; const quiet = () => { console.log = (...a) => { if (typeof a[0] === 'string' && /^(PASS|FAIL|\d+ passed)/.test(a[0])) log(...a); }; console.warn = () => {}; console.error = () => {}; };   // keep only the test verdict lines
const loud = () => { console.log = log; };
try {
  const ops = await loadPair('ops.js', REL), auto = await loadPair('youtube/autosync.js', REL), yts = await loadPair('youtube/sync.js', REL), tts = await loadPair('tiktok/sync.js', REL); quiet();
  const OPS = makeCall(ops.cur), OPSB = makeCall(ops.base);
  const call = async (mod, { method = 'POST', headers = {}, body = null, query = {} } = {}) => { const res = mkRes(); await mod.default({ method, headers: { host: 'app.test', ...headers }, query, body }, res); return res; };
  const seed = () => { resetWorld(); world.connections = CONNS.map((c) => ({ ...c })); delete process.env.CRON_SECRET; };
  const noWork = () => world.google.length === 0 && world.writes.length === 0;
  // Internal hops (autosync → the project's own endpoints) are dispatched to the REAL handlers of the chosen side ('cur' = this branch, 'base' = the G0 release).
  // The only liberty taken: the sync endpoints answer in MOCK mode here (no YouTube credentials in the test world) and the mock payload has no `success` flag, so the
  // payload gets success:true — otherwise autosync would count a retry per channel. The gates in front of the handlers are the real ones.
  const route = (which = 'cur') => { world.router = async (url, opts = {}) => { const u = new URL(url); const hdr = {}; for (const [k, v] of Object.entries(opts.headers || {})) hdr[k.toLowerCase()] = v;
      const go = async (mod, method, query) => { const res = await call(mod, { method, headers: hdr, body: opts.body ? JSON.parse(opts.body) : null, query }); const b = res.body && res.body.mode === 'mock' ? { ...res.body, success: true } : res.body; return json(b, res.code); };
      if (u.pathname === '/api/youtube/sync') return go(yts[which], 'POST', {});
      if (u.pathname === '/api/tiktok/sync') return go(tts[which], 'POST', {});
      if (u.pathname === '/api/ops') return go(ops[which], (opts.method || 'GET'), Object.fromEntries(u.searchParams));
      return json({}, 404); }; };

  /* ───────── api/ops.js: analytics_auto_run ───────── */
  for (const [n, h] of [['no credentials', {}], ['forged signature', { 'x-mmm-cron': 'f'.repeat(64) }], ['signature of another scope', SIG('sync')], ['repeated header', { 'x-mmm-cron': [cronSignature('analytics_auto_run', KEY), 'x'] }], ['forged CEO session header', { 'x-mmm-ceo-session': 'forged.token.value' }], ['VA-style token in the query', {}]]) {
    seed(); const r = await OPS({ action: 'analytics_auto_run', method: 'GET', headers: h, query: n.startsWith('VA') ? { operator_session_token: 'forged.va' } : {} });
    check(`analytics_auto_run, ${n}: 401, ZERO Google calls and ZERO database writes`, r.code === 401 && r.body.error === 'cron_signature_required' && noWork(), `${r.code} google=${world.google.length} writes=${world.writes.length}`); }
  { seed(); const r = await OPS({ action: 'analytics_auto_run', method: 'GET', headers: SIG('analytics_auto_run') }); const g1 = world.google.length;
    check('analytics_auto_run with the cron signature runs the three steps (normal scheduled execution)', r.code === 200 && r.body.steps.youtube_analytics_pull.ok && r.body.steps.youtube_snapshot_now.ok && r.body.steps.optimization_apply_recs.ok && g1 > 0, JSON.stringify(r.body && r.body.steps));
    const r2 = await OPS({ action: 'analytics_auto_run', method: 'GET', headers: SIG('analytics_auto_run') });
    check('a repeat inside the cooldown is refused 429 (cooldown) with NO further Google call', r2.code === 429 && r2.body.error === 'cooldown' && world.google.length === g1, `${r2.code} ${r2.body && r2.body.error}`); }
  { seed(); const r = await OPS({ action: 'analytics_auto_run', method: 'GET', ceo: true, ceoHeader: true });
    check('a CEO session may also run it (manual refresh)', r.code === 200 && r.body.status === 'healthy'); }
  { seed(); await OPS({ action: 'analytics_auto_run', method: 'GET', headers: SIG('analytics_auto_run') }); const one = world.google.length;
    seed(); const res = await Promise.all(Array.from({ length: 12 }, () => OPS({ action: 'analytics_auto_run', method: 'GET', headers: SIG('analytics_auto_run') })));
    check('12 simultaneous scheduled-style requests → exactly ONE runs (200), eleven are refused (429); Google calls equal one run', res.filter((r) => r.code === 200).length === 1 && res.filter((r) => r.code === 429).length === 11 && world.google.length === one, `${res.map((r) => r.code).join(',')} google=${world.google.length} vs ${one}`); }
  { seed(); await OPS({ action: 'analytics_auto_run', method: 'GET', headers: SIG('analytics_auto_run') });
    world.locks['cron_lock_analytics'].updated_at -= 3 * 60e3;   // 3 minutes ago: inside the cooldown, outside the 2-minute minimum gap
    const noCeo = await OPS({ action: 'analytics_auto_run', method: 'GET', headers: SIG('analytics_auto_run'), query: { force: 'true' } });
    const ceo = await OPS({ action: 'analytics_auto_run', method: 'GET', ceo: true, ceoHeader: true, query: { force: 'true' } });
    check('force=true is honoured only for a CEO session (the signature path cannot force)', noCeo.code === 429 && ceo.code === 200, `${noCeo.code}/${ceo.code}`); }
  { seed(); world.failLocks = true; const r = await OPS({ action: 'analytics_auto_run', method: 'GET', headers: SIG('analytics_auto_run') });
    check('lock infrastructure failure does not stop an AUTHENTICATED scheduled run (runs with a warning)', r.code === 200); }
  { seed(); const r = await OPSB({ action: 'analytics_auto_run', method: 'GET' }); const rr = await OPSB({ action: 'analytics_auto_run', method: 'GET' }); const g = world.google.length;
    check('BEFORE (G0 release): an anonymous caller runs it, and a repeat runs it again (cost per call = ' + (g / 2) + ' Google requests)', r.code === 200 && rr.code === 200 && g >= 4); }

  /* ───────── api/ops.js: the two analytics twins ───────── */
  for (const a of ['youtube_analytics_pull', 'youtube_snapshot_now']) {
    for (const [n, h] of [['no credentials', {}], ['forged CEO token', { 'x-mmm-ceo-session': 'forged.token.value' }], ['cron signature (not accepted here)', SIG('analytics_auto_run')]]) { seed(); const r = await OPS({ action: a, method: 'GET', headers: h });
      check(`${a}, ${n}: 401 ceo_authorization_required, ZERO Google calls and writes`, r.code === 401 && r.body.error === 'ceo_authorization_required' && noWork(), `${r.code}`); }
    seed(); const ok = await OPS({ action: a, method: 'GET', ceo: true, ceoHeader: true }); check(`${a}: a CEO session runs it`, ok.code === 200 && ok.body.ok === true, `${ok.code} ${JSON.stringify(ok.body).slice(0, 80)}`);
    seed(); const b = await OPSB({ action: a, method: 'GET' }); check(`BEFORE: ${a} accepted an anonymous caller`, b.code === 200); }
  { seed(); const days = ['100000', '-5', 'abc', '0', '30']; const starts = [];
    for (const d of days) { world.googleFull = []; await OPS({ action: 'youtube_analytics_pull', method: 'GET', ceo: true, ceoHeader: true, query: { days: d } }); const u = world.googleFull.find((x) => /youtubeanalytics/.test(x)); const m = /startDate=(\d{4}-\d{2}-\d{2})/.exec(u || ''); starts.push(m ? Math.round((Date.now() - Date.parse(m[1])) / 86400e3) : null); }
    check('the look-back is clamped to 1..400 days (100000→400, -5→1, abc→30, 0→30, 30→30)', starts[0] <= 401 && starts[0] >= 399 && starts[1] <= 2 && starts[2] >= 29 && starts[2] <= 31 && starts[3] >= 29 && starts[3] <= 31 && starts[4] >= 29 && starts[4] <= 31, JSON.stringify(starts)); }

  /* ───────── S-C: queued-rule de-duplication ───────── */
  const REC = (d, a = 'INCREASE') => ({ action: a, priority: 'high', detail: d });
  const setRecs = (arr) => { world.decision = { ok: true, perChannel: [{ engine: 'SRV Farsi', recommendations: arr }] }; };
  const apply = () => OPS({ action: 'optimization_apply_recs', method: 'GET', ceo: true, ceoHeader: true });
  { resetWorld(); setRecs([REC('Top retainers use "alpha" pattern.'), REC('Mood "romantic" averages 70% retention (3 videos).')]);
    await apply(); const n1 = world.rules.length, a1 = world.audit.length; await apply(); await apply();
    check('auto_apply OFF: the same recommendations are queued ONCE; two more runs add no rule and no audit row', n1 === 2 && world.rules.length === 2 && world.audit.length === a1 && a1 === 2, `${n1}→${world.rules.length}, audit ${a1}→${world.audit.length}`); }
  { resetWorld(); setRecs([REC('Top retainers use "alpha" pattern.')]); await apply();
    world.rules[0].rule_data = Object.fromEntries(Object.entries(world.rules[0].rule_data).reverse());   // the database returns JSON with its own key order
    await apply(); check('identical data with a different key order is recognised as the same rule (canonical comparison)', world.rules.length === 1); }
  { resetWorld(); setRecs([REC('Top retainers use "alpha" pattern.')]); await apply(); setRecs([REC('Top retainers use "beta" pattern.')]); await apply();
    check('a changed recommendation is queued as a new rule; the old one is kept', world.rules.length === 2 && world.rules.map((r) => r.rule_data.pattern).join() === 'alpha,beta'); }
  { resetWorld(); setRecs([REC('Top retainers use "alpha" pattern.')]); await apply(); world.rules[0].expires_at = new Date(Date.now() - 1000).toISOString(); await apply();
    check('an EXPIRED queued rule does not block re-queuing', world.rules.length === 2); }
  { resetWorld(); world.decision = { ok: true, perChannel: [{ engine: 'SRV Farsi', recommendations: [REC('Top retainers use "alpha" pattern.')] }, { engine: 'SRV English', recommendations: [REC('Top retainers use "alpha" pattern.')] }] }; await apply(); await apply();
    check('de-duplication is per engine: the same text for both engines creates one row each', world.rules.length === 2 && new Set(world.rules.map((r) => r.engine)).size === 2); }
  { resetWorld(); setRecs([REC('Top retainers use "alpha" pattern.')]); await apply(); const before = JSON.stringify(world.rules[0]); await apply();
    check('nothing is deleted or rewritten: the existing queued row is byte-identical after a skipped duplicate', JSON.stringify(world.rules[0]) === before && !world.writes.some((w) => w.method === 'DELETE')); }
  { // auto_apply ON: behaviour identical to the G0 release, call for call
    const run = async (M) => { resetWorld(); world.settings.forEach((s) => { s.auto_apply = true; }); world.rules = [{ id: 1, engine: 'SRV Farsi', rule_type: 'hook_pattern_weight', rule_data: { pattern: 'old', weight: 2, instruction: 'x' }, active: true, auto_applied: true, superseded_at: null }]; world.nextRuleId = 100; setRecs([REC('Top retainers use "new" pattern.')]);
      await M({ action: 'optimization_apply_recs', method: 'GET', ceo: true, ceoHeader: true }); await M({ action: 'optimization_apply_recs', method: 'GET', ceo: true, ceoHeader: true });
      return JSON.stringify([world.writes.map((w) => [w.method, w.table, w.body && w.body.active, w.body && w.body.rule_type]), world.rules.map((r) => [r.id, r.active, r.auto_applied]), world.audit.map((a) => a.action)]); };
    const b = await run(OPSB), c = await run(OPS); check('auto_apply ON: writes, rules and audit rows are IDENTICAL to the G0 release (supersede + active insert unchanged)', b === c, c.slice(0, 120)); }

  /* ───────── api/youtube/autosync.js ───────── */
  const hops = () => world.hopLog || (world.hopLog = []);
  const track = () => { world.hopLog = []; const prev = world.router; world.router = async (url, opts = {}) => { const u = new URL(url); world.hopLog.push({ path: u.pathname + (u.searchParams.get('action') ? '?action=' + u.searchParams.get('action') : ''), headers: Object.fromEntries(Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v])) }); return prev ? prev(url, opts) : json({ success: true }); }; };
  const ar = (mod, headers = {}, method = 'GET') => call(mod, { method, headers });
  { seed(); route(); track(); process.env.CRON_SECRET = 'cs-test-secret';
    for (const [n, h] of [['no bearer', {}], ['wrong bearer', { authorization: 'Bearer nope' }], ['bearer without the word Bearer', { authorization: 'cs-test-secret' }], ['lower-case scheme', { authorization: 'bearer cs-test-secret' }], ['bearer + 1 character', { authorization: 'Bearer cs-test-secrett' }]]) { const r = await ar(auto.cur, h);
      check(`autosync, CRON_SECRET set, ${n}: 401 and no downstream call, no lock row`, r.code === 401 && hops().length === 0 && Object.keys(world.locks).length === 0 && world.google.length === 0, `${r.code}`); }
    const r = await ar(auto.cur, { authorization: 'Bearer cs-test-secret' }); const paths = hops().map((h) => h.path);
    check('autosync, correct bearer: normal scheduled execution — syncs both channels, then analytics, then the growth hook', r.code === 200 && paths.filter((p) => p === '/api/youtube/sync').length === 2 && paths.includes('/api/ops?action=analytics_auto_run') && paths.includes('/api/ops?action=growth_collect_scheduled'), JSON.stringify(paths));
    check('…every sync hop carries a valid "sync" signature and the analytics hop a valid "analytics_auto_run" signature', hops().filter((h) => h.path === '/api/youtube/sync').every((h) => h.headers['x-mmm-cron'] === cronSignature('sync', KEY)) && hops().find((h) => h.path === '/api/ops?action=analytics_auto_run').headers['x-mmm-cron'] === cronSignature('analytics_auto_run', KEY));
    check('…and the whole chain really worked through the REAL gated endpoints (sync answered 200 mock for both channels; analytics run logged)', r.body.results.length === 2 && world.writes.some((w) => w.table === 'analytics_sync_log'), JSON.stringify(r.body.analyticsAuto && r.body.analyticsAuto.status));
    check('…the lock row exists and finished (state done)', JSON.parse(world.locks.cron_lock_autosync.value).state === 'done' && JSON.parse(world.locks.cron_lock_analytics.value).state === 'done');
    const r2 = await ar(auto.cur, { authorization: 'Bearer cs-test-secret' });
    check('a second authenticated trigger inside the cooldown is refused 429 and does nothing', r2.code === 429 && r2.body.skipped === true, `${r2.code}`);
    check('PUT/DELETE are refused 405', (await ar(auto.cur, {}, 'PUT')).code === 405 && (await ar(auto.cur, {}, 'DELETE')).code === 405); }
  { seed(); route(); track(); delete process.env.CRON_SECRET;
    const r1 = await ar(auto.cur); const n1 = hops().length; const r2 = await ar(auto.cur);
    check('autosync, CRON_SECRET not configured (transitional): the scheduled run still works exactly once…', r1.code === 200 && hops().filter((h) => h.path === '/api/youtube/sync').length === 2);
    check('…and an immediate repeat by anyone is refused 429 with no downstream call (abuse bounded to one run per cooldown)', r2.code === 429 && hops().length === n1);
    seed(); route(); track(); const res = await Promise.all(Array.from({ length: 12 }, () => ar(auto.cur)));
    check('12 simultaneous anonymous requests → exactly ONE run: sync hops = number of channels (2), not 24', res.filter((r) => r.code === 200).length === 1 && hops().filter((h) => h.path === '/api/youtube/sync').length === 2, `${res.map((r) => r.code).join(',')} hops=${hops().length}`); }
  { seed(); route(); track(); world.failLocks = true; const r = await ar(auto.cur); check('autosync: lock infrastructure failure does not stop the scheduled run (proceeds with a warning)', r.code === 200 && hops().length > 0); }
  { seed(); route('base'); track(); const runs = []; for (let i = 0; i < 5; i++) runs.push((await ar(auto.base)).code);
    check('BEFORE (G0 release): five anonymous requests ran five full syncs (' + hops().filter((h) => h.path === '/api/youtube/sync').length + ' channel syncs, ' + world.google.length + ' Google calls)', runs.every((c) => c === 200) && hops().filter((h) => h.path === '/api/youtube/sync').length === 10); }
  { seed(); route(); track(); const r = await ar(auto.cur, { authorization: 'Bearer x' }); check('control: with no CRON_SECRET a bearer header is not required (transitional) — documented residual until the secret exists', r.code === 200); }

  /* ───────── api/youtube/sync.js and api/tiktok/sync.js (POST) ───────── */
  for (const [label, M, base, body] of [['api/youtube/sync', yts, yts.base, { channelId: 'UC_A' }], ['api/tiktok/sync', tts, tts.base, { openId: 'OPEN_A' }]]) {
    for (const [n, h, b] of [['no credentials', {}, body], ['forged signature', { 'x-mmm-cron': '0'.repeat(64) }, body], ['analytics-scope signature', SIG('analytics_auto_run'), body], ['forged CEO header', { 'x-mmm-ceo-session': 'forged.x' }, body], ['forged CEO body token', {}, { ...body, ceo_session_token: 'forged.x' }]]) {
      seed(); const r = await call(M.cur, { headers: h, body: b }); check(`${label}, ${n}: 401, no Google call, no write`, r.code === 401 && noWork(), `${r.code}`); }
    seed(); const s1 = await call(M.cur, { headers: SIG('sync'), body }); check(`${label}: the daily job signature is accepted`, s1.code === 200 && s1.body.mode === 'mock', `${s1.code}`);
    seed(); const s2 = await call(M.cur, { headers: { 'x-mmm-ceo-session': signCeo() }, body }); const s3 = await call(M.cur, { body: { ...body, ceo_session_token: signCeo() } }); check(`${label}: a CEO session (header or body) is accepted`, s2.code === 200 && s3.code === 200);
    seed(); const s4 = await call(M.cur, { method: 'OPTIONS' }); const s5 = await call(M.cur, { method: 'PUT', body }); check(`${label}: OPTIONS 200 and PUT 405 unchanged`, s4.code === 200 && s5.code === 405);
    seed(); const s6 = await call(base, { body }); check(`BEFORE: ${label} accepted an anonymous caller`, s6.code === 200); }
  { seed(); const r = await call(tts.cur, { method: 'GET', query: {} }); check('api/tiktok/sync GET (status read) is unchanged: not refused for lack of a session', r.code !== 401, `${r.code}`); }

  /* ───────── token-acceptance equivalence: ops strict gate vs lib/ceoSession ───────── */
  { const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const sign = (p, sec = SECRET) => `${p}.${createHmac('sha256', sec).update(p).digest('base64url')}`; const now = Date.now(); const v = signCeo();
    const T = { valid: v, 'valid+extra': v + '.x', operator: sign(b64({ sub: 'operator', exp: now + 1e6 })), 'no exp': sign(b64({ sub: 'ceo' })), expired: sign(b64({ sub: 'ceo', exp: now - 1 })), 'other secret': sign(b64({ sub: 'ceo', exp: now + 1e6 }), 'zz'), empty: '', junk: 'let-me-in', 'empty sig': b64({ sub: 'ceo', exp: now + 1e6 }) + '.', long: 'a'.repeat(5000) + '.b' };
    const disagree = []; for (const [n, t] of Object.entries(T)) { seed(); const r = await OPS({ action: 'youtube_snapshot_now', method: 'GET', headers: { 'x-mmm-ceo-session': t } }); const opsOk = r.code !== 401;
      const libOk = await ceoSessionOk({ method: 'GET', headers: { 'x-mmm-ceo-session': t }, query: {} }, { fetchImpl: fetch, supabaseUrl: 'https://supabase.test', serviceKey: KEY }); if (opsOk !== libOk) disagree.push(`${n}: ops=${opsOk} lib=${libOk}`); }
    check('the ops gate and the standalone-endpoint check accept and refuse exactly the same ' + Object.keys(T).length + ' tokens', disagree.length === 0, disagree.join(' ; ')); }

  /* ───────── client: the four buttons send the CEO session ───────── */
  { loud(); const html = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
    for (const [name, re] of [['youtube sync', /fetch\('\/api\/youtube\/sync',\{\s*method:'POST',\s*headers:\{'Content-Type':'application\/json','X-MMM-CEO-Session'/], ['tiktok sync', /fetch\('\/api\/tiktok\/sync',\{\s*method:'POST',\s*headers:\{'Content-Type':'application\/json','X-MMM-CEO-Session'/], ['analytics pull', /action=youtube_analytics_pull[^\n]*X-MMM-CEO-Session/], ['snapshot now', /action=youtube_snapshot_now',\{headers:\{'X-MMM-CEO-Session'/]])
      check(`UI: the ${name} button sends X-MMM-CEO-Session`, re.test(html)); quiet(); }
} finally { loud(); cleanup(); delete process.env.CRON_SECRET; }
process.exit(done() ? 1 : 0);
