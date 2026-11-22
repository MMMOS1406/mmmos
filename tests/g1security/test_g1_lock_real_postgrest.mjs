// G1 — the single-flight lock verified against REAL PostgREST on a REAL PostgreSQL, entirely NON-PRODUCTION (a throwaway local cluster on 127.0.0.1 started by realdb/run.sh).
// No production credential, URL or data is read or used; the JWT is generated for this run only. Without the G1_REAL_* environment this file reports SKIPPED and exits 0.
// bash tests/g1security/realdb/run.sh   (see the header of that script for the required environment)
import { execFileSync } from 'node:child_process';
const URLB = process.env.G1_REAL_URL;
if (!URLB) { console.log('SKIPPED  no G1_REAL_URL: this test needs the local PostgREST started by tests/g1security/realdb/run.sh'); process.exit(0); }
const JWT = process.env.G1_REAL_JWT, ANON = process.env.G1_REAL_ANON, PSQL = process.env.G1_PSQL, PGPORT = process.env.G1_PGPORT;
if (!URLB.startsWith('http://127.0.0.1:')) { console.log('REFUSED  the real-database test only runs against 127.0.0.1'); process.exit(2); }
const L = await import('../../lib/cronLock.mjs'); const { cronSignature } = await import('../../lib/cronAuth.mjs'); const { createHmac } = await import('node:crypto');
let pass = 0, fail = 0; const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const sql = (q) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', PGPORT, '-U', 'postgres', '-At', '-c', q, 'postgres']).toString().trim();
const CFG = { fetchImpl: (u, i) => fetch(u, i), supabaseUrl: URLB, serviceKey: JWT };
const row = (k) => sql(`select value||'|'||extract(epoch from updated_at)::numeric(16,3) from app_settings where key='${k}'`);
const state = (k) => { const v = sql(`select value from app_settings where key='${k}'`); return v ? JSON.parse(v).state : null; };
const reset = (k) => sql(`delete from app_settings where key='${k}'`);
const ago = (k, sec) => sql(`update app_settings set updated_at = now() - interval '${sec} seconds' where key='${k}'`);
const A = 'cron_lock_autosync', B = 'cron_lock_analytics';
console.log('PostgREST version header: ' + (await fetch(URLB + '/rest/v1/', { headers: { Authorization: 'Bearer ' + JWT } }).then((r) => r.headers.get('server') || 'n/a')));
console.log('PostgreSQL: ' + sql('select version()').slice(0, 40));
sql("insert into app_settings(key,value) values ('mmm_finance_v118','{\"tasks\":[]}')");   // a stand-in for the guarded state row: must never be touched by the lock
const stateBefore = row('mmm_finance_v118');

/* 1–6: sequence semantics */
reset(A); reset(B);
const a1 = await L.acquire({ name: 'autosync', ...CFG });
check('first acquire creates the lock row and wins (row exists, state running, updated_at ≈ now)', a1.ok && state(A) === 'running' && Number(sql(`select extract(epoch from now()-updated_at)::int from app_settings where key='${A}'`)) < 5, JSON.stringify(a1));
const a2 = await L.acquire({ name: 'autosync', ...CFG });
check('an immediate second acquire is refused: run_in_progress with a retry hint of about the 10-minute cooldown', !a2.ok && a2.reason === 'run_in_progress' && a2.retryAfterMs > 9 * 60e3 && a2.retryAfterMs <= 10 * 60e3, JSON.stringify(a2));
const before = row(A);
await L.release({ lock: { ...a1, token: 'wrongtoken123' }, success: false, ...CFG });
check('a release with the wrong token changes nothing (real PostgREST `like` filter matched no row)', row(A) === before && state(A) === 'running');
await L.release({ lock: a1, success: true, ...CFG });
const afterOk = row(A);
check('release(success) records state done and leaves updated_at exactly as it was (the cooldown keeps running from the start)', state(A) === 'done' && afterOk.split('|')[1] === before.split('|')[1], before.split('|')[1] + ' vs ' + afterOk.split('|')[1]);
const a3 = await L.acquire({ name: 'autosync', ...CFG });
check('inside the cooldown a new acquire is refused as "cooldown" (not run_in_progress)', !a3.ok && a3.reason === 'cooldown', JSON.stringify(a3));
ago(A, 11 * 60);
const a4 = await L.acquire({ name: 'autosync', ...CFG });
check('after the cooldown (11 minutes later, set in the throwaway database) the lock can be taken again', a4.ok);
await L.release({ lock: a4, success: false, ...CFG });
check('release(failure) frees the lock: state failed and updated_at back at the epoch', state(A) === 'failed' && sql(`select updated_at = 'epoch'::timestamptz from app_settings where key='${A}'`) === 't');
const a5 = await L.acquire({ name: 'autosync', ...CFG });
check('…so a retry is allowed immediately', a5.ok);
await L.release({ lock: a5, success: true, ...CFG });
const f1 = await L.acquire({ name: 'autosync', force: true, ...CFG });
ago(A, 180); const f2 = await L.acquire({ name: 'autosync', force: true, ...CFG });
check('force inside the 2-minute minimum gap is refused; force after the gap is allowed even inside the cooldown', !f1.ok && f2.ok);
await L.release({ lock: f2, success: true, ...CFG });
const b1 = await L.acquire({ name: 'analytics', ...CFG });
check('the two locks are independent rows', b1.ok && state(B) === 'running' && state(A) === 'done');
const aa = await L.acquire({ name: 'autosync', ...CFG }); await L.release({ lock: b1, success: false, ...CFG });
check('releasing one lock never touches the other (token-scoped filter)', state(A) === 'done' && state(B) === 'failed' && !aa.ok);

/* 7: real concurrency — PostgREST pool of 10 connections, 25 parallel claimants per round */
{ let rounds = 40, bad = [], attempts = 0, winners = 0;
  for (let i = 0; i < rounds; i++) { sql(`insert into app_settings(key,value,updated_at) values ('${A}','{"state":"idle"}','epoch') on conflict (key) do update set value='{"state":"idle"}', updated_at='epoch'`);
    const res = await Promise.all(Array.from({ length: 25 }, () => L.acquire({ name: 'autosync', ...CFG }))); const w = res.filter((r) => r.ok).length; attempts += 25; winners += w;
    const others = res.filter((r) => !r.ok).map((r) => r.reason); if (w !== 1 || !others.every((r) => r === 'run_in_progress')) bad.push(`round ${i}: winners=${w} others=${[...new Set(others)]}`); }
  check(`CONCURRENCY on the existing row: ${rounds} rounds × 25 simultaneous claimants (${attempts} real HTTP requests) → exactly ONE winner in every round, every loser refused as run_in_progress`, bad.length === 0 && winners === rounds, bad.slice(0, 2).join(' ; ')); }
/* 8: first-ever race — the row does not exist yet */
{ let rounds = 25, bad = [];
  for (let i = 0; i < rounds; i++) { reset(B); const res = await Promise.all(Array.from({ length: 25 }, () => L.acquire({ name: 'analytics', ...CFG }))); const w = res.filter((r) => r.ok).length; const odd = res.filter((r) => !r.ok && r.reason !== 'run_in_progress'); if (w !== 1 || odd.length) bad.push(`round ${i}: winners=${w} odd=${odd.map((o) => o.reason)}`); }
  check(`CONCURRENCY on a MISSING row (insert-if-absent race): ${rounds} rounds × 25 claimants → exactly ONE winner each round, no duplicate-key error surfaced`, bad.length === 0 && Number(sql(`select count(*) from app_settings where key='${B}'`)) === 1, bad.slice(0, 2).join(' ; ')); }
{ // a loop of authenticated runs one after the other across the cooldown boundary
  reset(A); let ok = 0; for (let i = 0; i < 12; i++) { const r = await L.acquire({ name: 'autosync', ...CFG }); if (r.ok) { ok++; await L.release({ lock: r, success: true, ...CFG }); } ago(A, 11 * 60); }
  check('12 sequential runs, each 11 minutes after the previous, all acquire (the cooldown never blocks an authenticated run that is due)', ok === 12); }

/* 11: the production-style trigger and the guarded state row */
check('the UPDATE/DELETE guard trigger (same function as production) lets every lock update through, and the guarded state row is byte-identical before and after', row('mmm_finance_v118') === stateBefore);
{ let sent = 0; const counting = (u, i) => { sent++; return fetch(u, i); }; const r = await L.acquire({ name: 'mmm_finance_v118', ...CFG, fetchImpl: counting }); const r2 = await L.acquire({ name: '../x', ...CFG, fetchImpl: counting });
  check('a lock name outside the two allowed names is refused before any request is sent (the state key can never be a lock)', !r.ok && r.reason === 'unknown_lock' && !r2.ok && sent === 0); }

/* 12: authorization and outage — fail closed */
{ reset(A); const anon = await L.acquire({ name: 'autosync', ...CFG, serviceKey: ANON }); const none = await L.acquire({ name: 'autosync', ...CFG, serviceKey: 'not-a-jwt' }); const rows = Number(sql(`select count(*) from app_settings where key='${A}'`));
  check('with the anon role or an invalid credential PostgREST refuses and the lock reports lock_unavailable (no row created) — an unauthorized caller can neither take nor create a lock', anon.reason === 'lock_unavailable' && none.reason === 'lock_unavailable' && rows === 0, JSON.stringify([anon.reason, none.reason, rows])); }
{ const t0 = Date.now(); const dead = await L.acquire({ name: 'autosync', ...CFG, supabaseUrl: 'http://127.0.0.1:9' });
  check('database/gateway unreachable → lock_unavailable quickly (callers refuse with 503)', dead.reason === 'lock_unavailable' && Date.now() - t0 < 5000); }

/* 14: the REAL autosync handler against the real database (its own tables + the lock rows); internal hops answered by a stub */
{ sql("delete from youtube_connections; delete from youtube_channels; delete from youtube_sync_logs; delete from tiktok_connections; delete from app_settings where key like 'cron_lock_%'");
  sql("insert into youtube_connections(channel_id,status,refresh_token,scope) values ('UC_A','connected','x','s'),('UC_B','connected','x','s'); insert into youtube_channels(channel_id,mmm_engine,title) values ('UC_A','SRV Farsi','a'),('UC_B','SRV English','b')");
  process.env.SUPABASE_URL = URLB; process.env.SUPABASE_SERVICE_KEY = JWT; process.env.APP_URL = 'https://app.test'; process.env.CRON_SECRET = 'real-db-test-secret'; process.env.VERCEL_ENV = 'production';
  const hop = []; let failB = false; const realFetch = globalThis.fetch; const log = console.log; const quiet = () => { console.log = (...a) => { if (typeof a[0] === 'string' && /^(PASS|FAIL)/.test(a[0])) log(...a); }; console.warn = () => {}; console.error = () => {}; };
  globalThis.fetch = (u, i) => { const s = String(u); if (!s.startsWith('https://app.test/')) return realFetch(u, i);
    hop.push(new URL(s).pathname + (new URL(s).searchParams.get('action') || '')); const body = i && i.body ? JSON.parse(i.body) : {}; const ok = !(failB && body.channelId === 'UC_B'); const j = ok ? (/analytics_auto_run/.test(s) ? { status: 'healthy' } : { success: true }) : { success: false, message: 'upstream down' };
    return Promise.resolve({ ok, status: ok ? 200 : 502, json: async () => j, text: async () => JSON.stringify(j) }); };
  const auto = await import('../../api/youtube/autosync.js?realdb'); quiet();
  const call = async (headers = {}, query = {}) => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } }; await auto.default({ method: 'GET', headers: { host: 'app.test', ...headers }, query, body: null }, res); return res; };
  const BEAR = { authorization: 'Bearer real-db-test-secret' };
  const flood = []; for (let i = 0; i < 30; i++) flood.push(await call(i % 2 ? {} : { authorization: 'Bearer wrong' + i })); const lockRowsAfterFlood = Number(sql("select count(*) from app_settings where key like 'cron_lock_%'"));
  check('HANDLER vs real DB: 30 unauthorized requests → all 401, no downstream call, NO lock row created (they cannot reach the lock)', flood.every((r) => r.code === 401) && hop.length === 0 && lockRowsAfterFlood === 0);
  const r1 = await call(BEAR);
  check('HANDLER vs real DB: the scheduled run (correct bearer) runs in full right after the flood — 200, both channels synced, lock state done', r1.code === 200 && r1.body.failed === 0 && state(A) === 'done' && hop.filter((p) => p === '/api/youtube/sync').length === 2 && Number(sql('select count(*) from youtube_sync_logs')) === 2);
  const r2 = await call(BEAR); check('HANDLER vs real DB: a duplicate delivery inside the cooldown is refused 429 with no downstream call', r2.code === 429 && hop.filter((p) => p === '/api/youtube/sync').length === 2);
  ago(A, 11 * 60); ago(B, 11 * 60); hop.length = 0; failB = true; const r3 = await call(BEAR);
  check('HANDLER vs real DB: a run in which one channel failed answers failed=1 and FREES the lock (state failed, updated_at at the epoch)', r3.code === 200 && r3.body.failed === 1 && state(A) === 'failed' && sql(`select updated_at='epoch'::timestamptz from app_settings where key='${A}'`) === 't');
  failB = false; hop.length = 0; const r4 = await call(BEAR);
  check('HANDLER vs real DB: the retry runs immediately and, fully successful, holds the cooldown again', r4.code === 200 && r4.body.failed === 0 && state(A) === 'done');
  const racers = await (async () => { ago(A, 11 * 60); ago(B, 11 * 60); hop.length = 0; return Promise.all(Array.from({ length: 15 }, () => call(BEAR))); })();
  check('HANDLER vs real DB: 15 simultaneous authenticated deliveries → exactly ONE run (2 channel syncs, not 30), 14 refused 429', racers.filter((r) => r.code === 200).length === 1 && racers.filter((r) => r.code === 429).length === 14 && hop.filter((p) => p === '/api/youtube/sync').length === 2, racers.map((r) => r.code).join(','));
  const noSecret = await (async () => { delete process.env.CRON_SECRET; sql("delete from app_settings where key like 'cron_lock_%'"); hop.length = 0; return call({}); })();
  check('HANDLER vs real DB: production without CRON_SECRET → 503 for an anonymous caller, no lock row, no downstream call', noSecret.code === 503 && hop.length === 0 && Number(sql("select count(*) from app_settings where key like 'cron_lock_%'")) === 0);
  process.env.CRON_SECRET = 'real-db-test-secret';
  process.env.SUPABASE_URL = 'http://127.0.0.1:9'; const dead = await import('../../api/youtube/autosync.js?deaddb'); process.env.SUPABASE_URL = URLB;
  const resD = { code: 200, body: null, status(c) { resD.code = c; return resD; }, json(b) { resD.body = b; return resD; } }; hop.length = 0; await dead.default({ method: 'GET', headers: { host: 'app.test', ...BEAR }, query: {}, body: null }, resD);
  check('HANDLER vs an unreachable database: the authenticated run is refused 503 lock_unavailable and nothing downstream is called (fail closed)', resD.code === 503 && resD.body.error === 'lock_unavailable' && hop.length === 0);
  globalThis.fetch = realFetch; console.log = log; }

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
