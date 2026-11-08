// CEO-017A — Family sign-in on the server. Loads the REAL api/ops.js against a fake, stateful ceo_auth_config. No network, no real credentials; every PIN here is a throw-away test value.
//   node tests/ceo017a/test_auth_remediation.mjs
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; import { createHmac, createHash } from 'node:crypto';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); process.chdir(repo);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const H = (s) => createHash('sha256').update(String(s)).digest('hex'); const SECRET = 'test-session-secret'; const CEO_PIN = 'test-ceo-pin-1', VA_PIN = 'test-va-pin-22', FAM_PIN = 'test-family-pin-3';
const cfg = new Map([['ceo_session_secret_production', SECRET], ['ceo_pin_hash_production', H(CEO_PIN)], ['operator_pin_hash_production', H(VA_PIN)]]);
const json = (o, status = 200) => ({ ok: status < 400, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) }, json: async () => o, text: async () => JSON.stringify(o) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || 'GET').toUpperCase();
  if (u.includes('/rest/v1/ceo_auth_config')) {
    if (m === 'GET') { const inList = /key=in\.\(([^)]*)\)/.exec(u), eq = /key=eq\.([^&]+)/.exec(u); const keys = inList ? inList[1].split(',') : eq ? [decodeURIComponent(eq[1])] : [...cfg.keys()]; return json(keys.filter((k) => cfg.has(k)).map((k) => ({ key: k, value: cfg.get(k) }))); }
    const body = JSON.parse(opts.body || '{}'); if (m === 'POST') cfg.set(body.key, body.value); if (m === 'PATCH') cfg.set(/key=eq\.([^&]+)/.exec(u)[1], body.value); return json([body]);
  }
  return json([]);
};
process.env.SUPABASE_URL = 'https://supabase.test'; process.env.SUPABASE_SERVICE_KEY = 'svc-test';
const mkRes = () => ({ code: 200, body: null, setHeader() {}, removeHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
const call = async (mod, action, body, token) => { const res = mkRes(); const b = { ...body }; if (token === 'ceo') { const p = Buffer.from(JSON.stringify({ sub: 'ceo', exp: Date.now() + 3600e3 })).toString('base64url'); b.ceo_session_token = `${p}.${createHmac('sha256', SECRET).update(p).digest('base64url')}`; } await mod.default({ method: 'POST', query: { action }, headers: { origin: 'https://mmm-static.vercel.app' }, body: b }, res); return res; };
const logged = []; for (const k of ['log', 'warn', 'error', 'info']) { const o = console[k].bind(console); console[k] = (...a) => { logged.push(a.map(String).join(' ')); o(...a); }; }
const mod = await import(pathToFileURL(path.join(repo, 'api', 'ops.js')).href + '?t=' + Math.random());
const noSecrets = (r) => !/hash|secret|pin_hash/i.test(JSON.stringify(r.body || {}).replace(/family_session_token|retry_after_seconds/g, ''));

let r = await call(mod, 'family_login', { pin: FAM_PIN });
check('before the CEO sets a Family PIN: family_not_configured (browser keeps its legacy check during the transition)', r.code === 200 && r.body.error === 'family_not_configured');
r = await call(mod, 'auth_set_family_pin', { pin: FAM_PIN });
check('setting a Family PIN requires the CEO session (no session -> 401)', r.code === 401 && !cfg.has('family_pin_hash_production'));
for (const [name, pin] of [['too short', '12345'], ['all zeros', '000000'], ['equals CEO PIN', CEO_PIN], ['equals VA PIN', VA_PIN]]) { r = await call(mod, 'auth_set_family_pin', { pin }, 'ceo'); check(`weak/duplicate PIN refused: ${name}`, r.code === 400 && !cfg.has('family_pin_hash_production'), r.body.error); }
r = await call(mod, 'auth_set_family_pin', { pin: FAM_PIN }, 'ceo');
check('CEO sets the Family PIN: stored only as a salted scrypt hash, response carries no secret', r.code === 200 && /^scrypt\$v1\$/.test(cfg.get('family_pin_hash_production')) && !cfg.get('family_pin_hash_production').includes(FAM_PIN) && !JSON.stringify(r.body).includes(FAM_PIN) && noSecrets(r));
r = await call(mod, 'family_login', { pin: FAM_PIN });
const tok = r.body && r.body.family_session_token;
check('correct PIN -> 200 and a signed session, response carries no hash/secret', r.code === 200 && r.body.ok === true && /^[\w-]+\.[\w-]+$/.test(tok || '') && noSecrets(r));
r = await call(mod, 'family_check_session', { family_session_token: tok }); check('session verifies', r.body.ok === true);
const forged = tok.split('.')[0] + '.' + 'A'.repeat(43); r = await call(mod, 'family_check_session', { family_session_token: forged }); check('forged signature rejected', r.body.ok === false);
const p2 = JSON.parse(Buffer.from(tok.split('.')[0], 'base64url')); p2.exp = Date.now() - 1; const pb = Buffer.from(JSON.stringify(p2)).toString('base64url'); r = await call(mod, 'family_check_session', { family_session_token: pb + '.' + createHmac('sha256', createHmac('sha256', SECRET).update('mmmos-family-session-v1').digest('base64url')).update(pb).digest('base64url') }); check('expired session rejected', r.body.ok === false);
r = await call(mod, 'family_login', { pin: VA_PIN }); check('the VA PIN does not open Family', r.code === 401);
r = await call(mod, 'family_login', { pin: CEO_PIN }); check('the CEO PIN does not open Family', r.code === 401);
const opTok = (() => { const p = Buffer.from(JSON.stringify({ sub: 'operator', exp: Date.now() + 3600e3, pv: H(VA_PIN).slice(0, 12) })).toString('base64url'); return p + '.' + createHmac('sha256', createHmac('sha256', SECRET).update('mmmos-operator-session-v1').digest('base64url')).update(p).digest('base64url'); })();
r = await call(mod, 'family_check_session', { family_session_token: opTok }); check('a VA session is not a Family session', r.body.ok === false);
let last; for (let i = 0; i < 5; i++) last = await call(mod, 'family_login', { pin: 'wrong-' + i });
check('5 wrong PINs lock Family out (429) ...', last.code === 401 || last.code === 429, 'status ' + last.code);
r = await call(mod, 'family_login', { pin: FAM_PIN }); check('... and while locked even the correct PIN is refused', r.code === 429 && r.body.error === 'temporarily_locked');
cfg.set('family_login_security_production', JSON.stringify({ failCount: 0 }));
r = await call(mod, 'auth_set_family_pin', { pin: 'test-family-pin-NEW' }, 'ceo'); r = await call(mod, 'family_check_session', { family_session_token: tok });
check('changing the Family PIN signs every Family session out', r.body.ok === false);
r = await call(mod, 'family_login', { pin: FAM_PIN }); check('the old Family PIN stops working', r.code === 401);
/* existing CEO / VA behaviour is untouched */
r = await call(mod, 'operator_login', { pin: VA_PIN }); check('VA login unchanged (still works)', r.code === 200 && r.body.ok === true && !!r.body.operator_session_token);
r = await call(mod, 'ceo_login', { pin: CEO_PIN }); check('CEO login unchanged (still works)', r.code === 200 && r.body.ok === true);
r = await call(mod, 'ceo_login', { pin: 'nope' }); check('CEO wrong PIN still refused', r.code === 401 || r.body.ok === false);
/* ---- CEO-017B: hashing, upgrade, CEO PIN rotation, nothing plaintext anywhere ---- */
const { hashPin, verifyPin, pinFingerprint, isLegacyHash } = await import(pathToFileURL(path.join(repo, 'lib', 'pinHash.mjs')).href);
const h1 = await hashPin('same-pin-123'), h2 = await hashPin('same-pin-123');
check('salted: the same PIN hashes differently each time; both verify', h1 !== h2 && await verifyPin('same-pin-123', h1) && await verifyPin('same-pin-123', h2));
check('wrong PIN, empty, non-string and malformed/hostile stored values all fail closed', !(await verifyPin('nope', h1)) && !(await verifyPin('', h1)) && !(await verifyPin(123, h1)) && !(await verifyPin('same-pin-123', 'scrypt$v1$N=999999999,r=8,p=1$AA$AA')) && !(await verifyPin('same-pin-123', 'garbage')) && !(await verifyPin('x', null)));
check('legacy unsalted SHA-256 hashes still verify (nobody is locked out during the transition)', isLegacyHash(H('abc-def-1')) && await verifyPin('abc-def-1', H('abc-def-1')) && !(await verifyPin('abc-def-2', H('abc-def-1'))));
check('session fingerprint: legacy keeps its old prefix; scrypt is a digest, not a slice of the stored string', pinFingerprint(H('x')) === H('x').slice(0, 12) && pinFingerprint(h1) !== pinFingerprint(h2) && pinFingerprint(h1).length === 12 && !h1.includes(pinFingerprint(h1)));
const t0 = Date.now(); await verifyPin('same-pin-123', h1); const ms = Date.now() - t0; check('verification is deliberately slow (memory-hard) but cheap enough for login', ms >= 5 && ms < 1500, ms + ' ms');
/* upgrade on login: OFF by default */
const vaBefore = cfg.get('operator_pin_hash_production'); const opTok0 = (await call(mod, 'operator_login', { pin: VA_PIN })).body.operator_session_token;
check('upgrade flag off: a legacy VA hash is left exactly as it was', cfg.get('operator_pin_hash_production') === vaBefore && isLegacyHash(vaBefore));
cfg.set('pin_hash_upgrade_on_login', 'on');
r = await call(mod, 'operator_login', { pin: VA_PIN });
check('upgrade flag on: the VA hash is deliberately left alone in Release 1 (the publishing-gate code stays byte-identical to main); VA login works', r.code === 200 && r.body.ok && cfg.get('operator_pin_hash_production') === vaBefore);
r = await call(mod, 'operator_login', { pin: VA_PIN }); check('VA logs in again with the same PIN', r.code === 200 && r.body.ok === true);
check('the VA session verifies', (await call(mod, 'operator_check_session', { operator_session_token: (await call(mod, 'operator_login', { pin: VA_PIN })).body.operator_session_token })).body.ok === true);
r = await call(mod, 'ceo_login', { pin: CEO_PIN }); check('CEO login upgrades too and still works', r.body.ok === true && /^scrypt\$v1\$/.test(cfg.get('ceo_pin_hash_production')));
/* CEO PIN rotation */
const oldCeoTok = (await call(mod, 'ceo_login', { pin: CEO_PIN })).body.ceo_session_token; const NEW_CEO = 'test-ceo-pin-ROTATED';
r = await call(mod, 'auth_set_ceo_pin', { pin: NEW_CEO, current_pin: 'wrong' }, 'ceo'); check('CEO PIN change needs the current PIN (a session alone is not enough)', r.code === 401 && r.body.error === 'current_pin_incorrect');
r = await call(mod, 'auth_set_ceo_pin', { pin: NEW_CEO, current_pin: CEO_PIN }); check('... and a CEO session', r.code === 401);
r = await call(mod, 'auth_set_ceo_pin', { pin: VA_PIN, current_pin: CEO_PIN }, 'ceo'); check('new CEO PIN may not equal the VA PIN', r.code === 400);
r = await call(mod, 'auth_set_ceo_pin', { pin: '111111', current_pin: CEO_PIN }, 'ceo'); check('repeated-character PINs refused', r.code === 400);
const secretBefore = cfg.get('ceo_session_secret_production'); const famTokBefore = (await call(mod, 'family_login', { pin: 'test-family-pin-NEW' })).body.family_session_token;
r = await call(mod, 'auth_set_ceo_pin', { pin: NEW_CEO, current_pin: CEO_PIN }, 'ceo'); const freshTok = r.body.ceo_session_token;
check('CEO PIN rotated: scrypt hash stored, session secret replaced, response has a fresh CEO session and no secret/hash', r.code === 200 && r.body.sessionsRotated && cfg.get('ceo_session_secret_production') !== secretBefore && /^scrypt\$v1\$/.test(cfg.get('ceo_pin_hash_production')) && !JSON.stringify(r.body).match(/scrypt|secret_production/));
mod.__reset?.(); const probe = async (tok) => (await mod.default({ method: 'POST', query: { action: 'ceo_check_session' }, headers: { origin: 'https://mmm-static.vercel.app' }, body: { ceo_session_token: tok } }, (() => { const x = mkRes(); probe.res = x; return x; })()), probe.res.body.ok);
check('every old CEO session ended; the fresh one works', (await probe(oldCeoTok)) === false && (await probe(freshTok)) === true);
check('old VA and Family sessions ended too (one secret signs them all)', (await call(mod, 'operator_check_session', { operator_session_token: opTok0 })).body.ok === false && (await call(mod, 'family_check_session', { family_session_token: famTokBefore })).body.ok === false);
check('old CEO PIN refused, new CEO PIN accepted', (await call(mod, 'ceo_login', { pin: CEO_PIN })).code === 401 && (await call(mod, 'ceo_login', { pin: NEW_CEO })).body.ok === true);
/* nothing plaintext anywhere */
const allStored = JSON.stringify([...cfg.entries()]); const pins = [CEO_PIN, VA_PIN, FAM_PIN, NEW_CEO, 'test-family-pin-NEW'];
check('no PIN appears in plaintext in the stored configuration', pins.every((x) => !allStored.includes(x)));
check('no PIN was written to the console during any of this', pins.every((x) => !logged.join('\n').includes(x)), logged.length + ' log lines inspected');
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
