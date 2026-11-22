// G1 / S-A, S-B — unit proof of lib/cronAuth.mjs, lib/cronLock.mjs and lib/ceoSession.mjs. No network, nothing written anywhere; SYNTHETIC keys.
// node tests/g1security/test_g1_units.mjs
import * as A from '../../lib/cronAuth.mjs'; import * as L from '../../lib/cronLock.mjs'; import * as S from '../../lib/ceoSession.mjs';
import { world, resetWorld, reporter, signCeo, SECRET } from '../g0safety/world.mjs';
import { createHmac } from 'node:crypto';
const { check, done } = reporter(); const KEY = 'svc-key-for-tests';

/* ── cronAuth: derived signature ── */
const good = A.cronSignature('sync', KEY);
check('signature is a 64-hex string and differs per scope', /^[0-9a-f]{64}$/.test(good) && good !== A.cronSignature('analytics_auto_run', KEY));
check('valid signature accepted for its own scope', A.verifyCronSignature({ 'x-mmm-cron': good }, 'sync', KEY) === true);
check('header name is case-insensitive', A.verifyCronSignature({ 'X-MMM-Cron': good }, 'sync', KEY) === true);
check('a signature for another scope is refused (scope separation)', A.verifyCronSignature({ 'x-mmm-cron': A.cronSignature('analytics_auto_run', KEY) }, 'sync', KEY) === false);
check('the growth hook signature is not accepted (different label)', A.verifyCronSignature({ 'x-mmm-cron': 'a'.repeat(64) }, 'sync', KEY) === false);
for (const [n, h] of [['missing', {}], ['empty', { 'x-mmm-cron': '' }], ['truncated', { 'x-mmm-cron': good.slice(0, 63) }], ['extended', { 'x-mmm-cron': good + '0' }], ['upper-cased', { 'x-mmm-cron': good.toUpperCase() }], ['array (repeated header)', { 'x-mmm-cron': [good, good] }], ['number', { 'x-mmm-cron': 12345 }], ['null headers', null], ['wrong key', { 'x-mmm-cron': A.cronSignature('sync', 'other-key') }]])
  check(`signature ${n}: refused`, A.verifyCronSignature(h, 'sync', KEY) === false);
check('unknown scope refused', A.verifyCronSignature({ 'x-mmm-cron': good }, 'growth', KEY) === false);
check('empty service key refuses everything (fails closed)', A.verifyCronSignature({ 'x-mmm-cron': good }, 'sync', '') === false && A.verifyCronSignature({ 'x-mmm-cron': good }, 'sync', undefined) === false);
check('creating a signature with no key or an unknown scope throws (a wiring mistake is loud)', (() => { try { A.cronSignature('sync', ''); return false; } catch (e) { try { A.cronSignature('nope', KEY); return false; } catch (e2) { return true; } } })());

/* ── cronAuth: bearer and the entry decision ── */
check('bearer: exact match accepted; wrong / missing / prefix-only / empty secret refused', A.bearerOk({ authorization: 'Bearer s3cret' }, 's3cret') && !A.bearerOk({ authorization: 'Bearer s3cret2' }, 's3cret') && !A.bearerOk({}, 's3cret') && !A.bearerOk({ authorization: 'Bearer ' }, '') && !A.bearerOk({ authorization: 's3cret' }, 's3cret') && !A.bearerOk({ authorization: 'bearer s3cret' }, 's3cret'));
const D = (env, headers, ceoOk) => A.cronEntryDecision({ env, headers, ceoOk });
check('secret configured + correct bearer → allowed (mode bearer)', D({ CRON_SECRET: 'abc' }, { authorization: 'Bearer abc' }).mode === 'bearer');
check('secret configured + no / wrong bearer and no CEO session → 401', D({ CRON_SECRET: 'abc' }, {}).status === 401 && D({ CRON_SECRET: 'abc' }, { authorization: 'Bearer x' }).status === 401 && D({ CRON_SECRET: 'abc' }, { authorization: 'Bearer abcd' }).status === 401);
check('secret configured + wrong bearer but a valid CEO session → allowed (manual recovery run)', D({ CRON_SECRET: 'abc' }, { authorization: 'Bearer x' }, true).mode === 'ceo');
check('secret ABSENT on any Vercel deployment (production, preview, development) and no CEO session → 503 cron_secret_not_configured', ['production', 'preview', 'development'].every((v) => D({ VERCEL_ENV: v }, {}).status === 503 && D({ VERCEL_ENV: v }, {}).error === 'cron_secret_not_configured' && D({ VERCEL_ENV: v }, { authorization: 'Bearer ' }).allow === false));
check('secret ABSENT on Vercel + a valid CEO session → allowed (recovery); an empty-string secret counts as absent', D({ VERCEL_ENV: 'production' }, {}, true).mode === 'ceo' && D({ VERCEL_ENV: 'production', CRON_SECRET: '' }, { authorization: 'Bearer ' }).status === 503);
check('secret absent and NOT on Vercel (local development / these tests) → allowed (mode local)', D({}, {}).mode === 'local' && D({ VERCEL_ENV: '' }, {}).allow === true);
check('there is no transitional / unauthenticated production mode and no switch that could re-open it', !('CRON_FAIL_CLOSED_WHEN_UNCONFIGURED' in A) && Object.keys(A).every((k) => !/transitional|failClosed/i.test(k)) && !/transitional/i.test(JSON.stringify(D({ VERCEL_ENV: 'production' }, {}))));

/* ── ceoSession: token shape and verification ── */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const sign = (p, sec = SECRET) => `${p}.${createHmac('sha256', sec).update(p).digest('base64url')}`;
const now = Date.now(); const ok = signCeo();
check('valid CEO token verifies', !!S.verifyCeoToken(ok, SECRET));
for (const [n, t] of [['empty', ''], ['no dot', 'abc'], ['three segments', ok + '.x'], ['non-base64url characters', 'a b.c d'], ['wrong secret', sign(b64({ sub: 'ceo', exp: now + 1e6 }), 'other')], ['operator subject', sign(b64({ sub: 'operator', exp: now + 1e6 }))], ['no expiry', sign(b64({ sub: 'ceo' }))], ['expired', sign(b64({ sub: 'ceo', exp: now - 1 }))], ['4 KB+ token', 'a'.repeat(4097) + '.b'], ['number', 5], ['array', [ok]]])
  check(`ceo token ${n}: refused`, S.verifyCeoToken(t, SECRET) === null);
check('empty secret refuses a well-formed token', S.verifyCeoToken(ok, '') === null);
check('token location: header for any method, body for POST, query for the others', S.tokenFromRequest({ method: 'GET', headers: { 'x-mmm-ceo-session': 'H' }, query: {} }) === 'H' && S.tokenFromRequest({ method: 'POST', headers: {}, body: { ceo_session_token: 'B' } }) === 'B' && S.tokenFromRequest({ method: 'GET', headers: {}, query: { ceo_session_token: 'Q' } }) === 'Q' && S.tokenFromRequest({ method: 'GET', headers: {}, body: { ceo_session_token: 'B' }, query: {} }) === '');

/* ── cronLock: atomic single-flight with a cooldown (fake database: one conditional update is atomic, as in PostgreSQL) ── */
const CFG = () => ({ fetchImpl: fetch, supabaseUrl: 'https://supabase.test', serviceKey: 'svc-test' });
check('lock names never include the shared-state key', Object.values(L.LOCKS).every((k) => /^cron_lock_/.test(k) && k !== 'mmm_finance_v118'));
{ resetWorld(); const a = await L.acquire({ name: 'autosync', ...CFG() }); const b = await L.acquire({ name: 'autosync', ...CFG() });
  check('first acquire wins; an immediate second is refused as run_in_progress with a retry hint', a.ok && !b.ok && b.reason === 'run_in_progress' && b.retryAfterMs > 0); }
{ resetWorld(); const n = 25; const res = await Promise.all(Array.from({ length: n }, () => L.acquire({ name: 'analytics', ...CFG() })));
  check(`${n} simultaneous claimants → exactly ONE wins, ${n - 1} refused`, res.filter((r) => r.ok).length === 1 && res.filter((r) => !r.ok && r.reason === 'run_in_progress').length === n - 1, JSON.stringify(res.map((r) => r.ok))); }
{ resetWorld(); const a = await L.acquire({ name: 'autosync', ...CFG() }); await L.release({ lock: a, success: true, ...CFG() }); const b = await L.acquire({ name: 'autosync', ...CFG() });
  check('after a SUCCESSFUL run the cooldown still holds (refused as cooldown, not run_in_progress)', !b.ok && b.reason === 'cooldown' && b.retryAfterMs > 9.9 * 60e3 - 5000);
  world.locks[L.LOCKS.autosync].updated_at -= 10 * 60e3 + 1000; const c = await L.acquire({ name: 'autosync', ...CFG() });
  check('once the 10-minute cooldown has elapsed the next run is allowed', c.ok); }
{ resetWorld(); const a = await L.acquire({ name: 'autosync', ...CFG() }); await L.release({ lock: a, success: false, ...CFG() }); const b = await L.acquire({ name: 'autosync', ...CFG() });
  check('after a FAILED run the lock is freed immediately (retry allowed)', b.ok); }
{ resetWorld(); const a = await L.acquire({ name: 'autosync', ...CFG() }); const wrong = await L.release({ lock: { ...a, token: 'someone-else' }, success: false, ...CFG() });
  check('a release with the wrong token changes nothing (cannot free another run\'s lock)', JSON.parse(world.locks[L.LOCKS.autosync].value).state === 'running'); }
{ resetWorld(); const a = await L.acquire({ name: 'analytics', ...CFG() }); await L.release({ lock: a, success: true, ...CFG() });
  const f1 = await L.acquire({ name: 'analytics', force: true, ...CFG() });
  check('force inside the 2-minute minimum gap is refused', !f1.ok);
  world.locks[L.LOCKS.analytics].updated_at -= 3 * 60e3; const f2 = await L.acquire({ name: 'analytics', force: true, ...CFG() });
  check('force after the minimum gap is allowed even inside the cooldown', f2.ok); }
{ resetWorld(); const a = await L.acquire({ name: 'autosync', ...CFG() }); const b = await L.acquire({ name: 'analytics', ...CFG() });
  check('the two locks are independent', a.ok && b.ok); }
{ resetWorld(); world.failLocks = true; const a = await L.acquire({ name: 'autosync', ...CFG() }); const u = await L.acquire({ name: 'nope', ...CFG() }); const m = await L.acquire({ name: 'autosync', fetchImpl: null, supabaseUrl: '', serviceKey: '' });
  check('infrastructure failure → reason lock_unavailable (distinct from a refusal); unknown lock name and missing configuration refused', !a.ok && a.reason === 'lock_unavailable' && u.reason === 'unknown_lock' && m.reason === 'lock_unavailable'); }
{ resetWorld(); const a = await L.acquire({ name: 'autosync', ...CFG() });
  check('the lock row stores only state/token/time — no secret', /^\{"state":"running","token":"r[a-z0-9]+","started":"[^"]+","forced":false\}$/.test(world.locks[L.LOCKS.autosync].value)); }

/* ── lock infrastructure: an unreadable / missing lock row is "unavailable", never "busy" ── */
{ const j = (b, st = 200) => ({ ok: st < 400, status: st, json: async () => b });
  const noRow = await L.acquire({ name: 'autosync', fetchImpl: async (u, i = {}) => (i.method === 'PATCH' ? j([]) : j([])), supabaseUrl: 'https://x', serviceKey: 'k' });
  const claimErr = await L.acquire({ name: 'autosync', fetchImpl: async (u, i = {}) => (i.method === 'PATCH' ? j({ message: 'x' }, 500) : j([])), supabaseUrl: 'https://x', serviceKey: 'k' });
  const throws = await L.acquire({ name: 'autosync', fetchImpl: async () => { throw new Error('network'); }, supabaseUrl: 'https://x', serviceKey: 'k' });
  check('claim returns nothing AND the row cannot be read back → lock_unavailable; a 5xx on the claim → lock_unavailable; a thrown network error → lock_unavailable', noRow.reason === 'lock_unavailable' && claimErr.reason === 'lock_unavailable' && throws.reason === 'lock_unavailable'); }

/* ── outcome capture: the lock follows what the handler actually answered ── */
const fakeRes = () => { const r = { code: 200, body: null, headers: {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, setHeader(k, v) { r.headers[k] = v; } }; return r; };
{ const raw = fakeRes(); const { res, outcome } = L.captureOutcome(raw); res.setHeader('x', 'y'); res.status(502).json({ failed: 1 });
  check('captureOutcome records status and body through chained status().json(), and still delegates to the real response', outcome().code === 502 && outcome().body.failed === 1 && outcome().sent && raw.code === 502 && raw.body.failed === 1 && raw.headers.x === 'y'); }
{ const cap = (code, body, sent = true) => ({ code, body, sent });
  check('autosync: all channels synced (200, failed 0) → success', L.runSucceeded('autosync', cap(200, { total: 2, succeeded: 2, failed: 0 })) === true);
  check('autosync: nothing connected (200, message + synced []) → success', L.runSucceeded('autosync', cap(200, { message: 'No channels connected', synced: [] })) === true);
  check('autosync: a channel failed (200, failed 1) → NOT success (lock freed for a retry)', L.runSucceeded('autosync', cap(200, { total: 2, succeeded: 1, failed: 1 })) === false);
  check('autosync: a 5xx answer, a 4xx answer, no response sent, or a non-object body → NOT success', [cap(500, { failed: 0 }), cap(401, { failed: 0 }), cap(200, undefined, false), cap(200, 'ok')].every((c) => L.runSucceeded('autosync', c) === false));
  check('analytics: status "healthy" (200) → success; "partial" or "failed" → NOT success; healthy body with a 5xx code → NOT success', L.runSucceeded('analytics', cap(200, { status: 'healthy' })) && !L.runSucceeded('analytics', cap(200, { status: 'partial' })) && !L.runSucceeded('analytics', cap(200, { status: 'failed' })) && !L.runSucceeded('analytics', cap(500, { status: 'healthy' })));
  check('an unknown run kind is never a success', L.runSucceeded('other', cap(200, { status: 'healthy', failed: 0 })) === false); }
process.exit(done() ? 1 : 0);
