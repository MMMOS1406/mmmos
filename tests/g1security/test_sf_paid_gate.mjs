// S-F — the paid-model entry points need a signed-in CEO or VA. REAL api/generate.js, REAL api/ops.js router, REAL shared verifier (lib/sessionAuth.mjs), one fake world:
// no network, SYNTHETIC keys; every refusal is proved to make ZERO model calls. node tests/g1security/test_sf_paid_gate.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import { createHmac, timingSafeEqual } from 'node:crypto';
import { world, resetWorld, loadPair, cleanup, repo, mkRes, json, SECRET, reporter } from '../g0safety/world.mjs';
import { operatorSecret, verifyOperatorToken, paidSessionOk, sessionTokensFromRequest } from '../../lib/sessionAuth.mjs';
import { parseSessionToken } from '../../lib/ceoSession.mjs';
const { check, done } = reporter();
const OPPIN = 'f'.repeat(64), FP = OPPIN.slice(0, 12), now = Date.now(), exp = now + 3600e3;
const sign = (obj, secret) => { const p = Buffer.from(JSON.stringify(obj)).toString('base64url'); return p + '.' + createHmac('sha256', secret).update(p).digest('base64url'); };
const CEO = sign({ sub: 'ceo', exp }, SECRET), OP = sign({ sub: 'operator', exp, pv: FP }, operatorSecret(SECRET));
const baseFetch = globalThis.fetch; let authReads = 0, authRows = null;
globalThis.fetch = async (url, opts) => { const u = String(url);
  if (/\/rest\/v1\/ceo_auth_config/.test(u)) { authReads++; return json(authRows || [{ key: 'ceo_session_secret_production', value: SECRET }, { key: 'ceo_pin_hash_production', value: 'e'.repeat(64) }, { key: 'operator_pin_hash_production', value: OPPIN }]); }
  return baseFetch(url, opts); };
const log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && /^(PASS|FAIL|\d+ passed)/.test(a[0])) log(...a); }; console.warn = () => {}; console.error = () => {};
const req = (headers = {}, body = null, method = 'POST', query = {}) => ({ method, headers: { host: 'app.test', ...headers }, query, body });

/* ───────── 1. the shared verifier ───────── */
const fx = { fetchImpl: globalThis.fetch, supabaseUrl: 'https://supabase.test', serviceKey: 'svc-test' };
const who = async (r, o = {}) => (await paidSessionOk(r, { ...fx, ...o })).ok ? (await paidSessionOk(r, { ...fx, ...o })).role : null;
check('CEO token (header) → role ceo; VA token (header) → role operator', (await who(req({ 'x-mmm-ceo-session': CEO }))) === 'ceo' && (await who(req({ 'x-mmm-operator-session': OP }))) === 'operator');
check('tokens in the JSON body are accepted too (same places api/ops.js reads)', (await who(req({}, { ceo_session_token: CEO }))) === 'ceo' && (await who(req({}, { operator_session_token: OP }))) === 'operator');
const bad = { 'no token': req(), 'empty': req({ 'x-mmm-ceo-session': '', 'x-mmm-operator-session': '' }), 'garbage': req({ 'x-mmm-ceo-session': 'garbage' }), 'forged CEO': req({ 'x-mmm-ceo-session': sign({ sub: 'ceo', exp }, 'wrong') }),
  'expired CEO': req({ 'x-mmm-ceo-session': sign({ sub: 'ceo', exp: now - 1 }, SECRET) }), 'VA token used as CEO': req({ 'x-mmm-ceo-session': OP }), 'CEO token used as VA': req({ 'x-mmm-operator-session': CEO }),
  'wrong subject (family)': req({ 'x-mmm-ceo-session': sign({ sub: 'family', exp, pv: FP }, SECRET) }), 'VA wrong PIN fingerprint': req({ 'x-mmm-operator-session': sign({ sub: 'operator', exp, pv: 'zzzzzzzzzzzz' }, operatorSecret(SECRET)) }),
  'VA expired': req({ 'x-mmm-operator-session': sign({ sub: 'operator', exp: now - 1, pv: FP }, operatorSecret(SECRET)) }), 'VA signed with the CEO secret': req({ 'x-mmm-operator-session': sign({ sub: 'operator', exp, pv: FP }, SECRET) }),
  'tampered payload': req({ 'x-mmm-ceo-session': CEO.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }), 'junk segment appended (S-D shape)': req({ 'x-mmm-ceo-session': CEO + '.x' }), 'oversize': req({ 'x-mmm-ceo-session': CEO + 'A'.repeat(5000) }),
  'whitespace': req({ 'x-mmm-ceo-session': ' ' + CEO }), 'non-string body token': req({}, { ceo_session_token: { a: 1 } }) };
for (const [n, r] of Object.entries(bad)) check('refused: ' + n, !(await paidSessionOk(r, fx)).ok);
authReads = 0; await paidSessionOk(req(), fx); await paidSessionOk(req({ 'x-mmm-ceo-session': 'garbage' }), fx);
check('a request with no well-formed token makes NO database read', authReads === 0, authReads);
authRows = []; check('missing configuration rows → refused (fails closed)', !(await paidSessionOk(req({ 'x-mmm-ceo-session': CEO }), fx)).ok);
authRows = [{ key: 'ceo_session_secret_production', value: SECRET }, { key: 'ceo_pin_hash_production', value: 'e'.repeat(64) }]; check('no VA PIN configured → CEO still accepted, any VA token refused', (await who(req({ 'x-mmm-ceo-session': CEO }))) === 'ceo' && !(await paidSessionOk(req({ 'x-mmm-operator-session': OP }), fx)).ok);
authRows = null;
check('database error / throw → refused (fails closed)', !(await paidSessionOk(req({ 'x-mmm-ceo-session': CEO }), { ...fx, fetchImpl: async () => { throw new Error('boom'); } })).ok && !(await paidSessionOk(req({ 'x-mmm-ceo-session': CEO }), { ...fx, fetchImpl: async () => json({}, 500) })).ok);
check('a changed VA PIN signs the VA out (token tied to the PIN fingerprint)', !verifyOperatorToken(OP, SECRET, 'a'.repeat(64)) && !!verifyOperatorToken(OP, SECRET, OPPIN));

/* parity with the verifier api/ops.js actually uses for VA sessions */
const opsSrc = fs.readFileSync(repo + '/api/ops.js', 'utf8'); const fn = (name) => { const i = opsSrc.indexOf('function ' + name); const j = opsSrc.indexOf('\n}\n', i); return opsSrc.slice(i, j + 3); };
const ctx = { createHmac, timingSafeEqual, Buffer, JSON, Date, _splitSessionToken: parseSessionToken }; vm.createContext(ctx); vm.runInContext(fn('_operatorSecret') + fn('_operatorVerifySession') + '\nthis.sec=_operatorSecret; this.ver=_operatorVerifySession;', ctx);
const samples = [OP, OP + '.x', 'x', sign({ sub: 'operator', exp, pv: 'q' }, operatorSecret(SECRET)), sign({ sub: 'operator', exp: now - 5, pv: FP }, operatorSecret(SECRET)), CEO];
check('parity: shared verifier and api/ops.js _operatorVerifySession agree on every sample', samples.every((t) => !!verifyOperatorToken(t, SECRET, OPPIN) === !!ctx.ver(t, ctx.sec(SECRET), OPPIN.slice(0, 12))) && ctx.sec(SECRET) === operatorSecret(SECRET));

/* ───────── 2. api/generate.js ───────── */
resetWorld(); const gen = (await loadPair('generate.js', '7d3f81a')).cur.default;
const callGen = async (headers, body) => { const res = mkRes(); await gen(req(headers, body), res); return res; };
const B = { engine: 'SRV Farsi', mood: 'romantic', contentFormat: 'short', taskName: 't', recentPackages: [] };
for (const [n, r] of Object.entries(bad)) { world.anthropic = []; const res = await callGen(r.headers, { ...B, ...(r.body || {}) }); check('generate: ' + n + ' → 401 and ZERO model calls', res.code === 401 && world.anthropic.length === 0 && res.body && res.body.error === 'session_required', [res.code, world.anthropic.length]); }
world.anthropic = []; const m405 = mkRes(); await gen(req({ 'x-mmm-ceo-session': CEO }, null, 'GET'), m405); check('generate: GET still 405 and no model call', m405.code === 405 && world.anthropic.length === 0);
world.anthropic = []; let r1 = await callGen({ 'x-mmm-ceo-session': CEO }, B); check('generate: signed-in CEO reaches the model (legitimate generation preserved)', r1.code !== 401 && world.anthropic.length >= 1, [r1.code, world.anthropic.length]);
world.anthropic = []; let r2 = await callGen({ 'x-mmm-operator-session': OP }, { ...B, engine: 'SRV English' }); check('generate: signed-in VA reaches the model', r2.code !== 401 && world.anthropic.length >= 1, [r2.code, world.anthropic.length]);
world.anthropic = []; let r3 = await callGen({ 'x-mmm-ceo-session': CEO }, { mood: 'x' }); check('generate: signed in but invalid body → 400 (past the gate), still no model call', r3.code === 400 && world.anthropic.length === 0);
const oldBody = JSON.stringify(world.anthropic); world.anthropic = []; await callGen({ 'x-mmm-ceo-session': CEO }, B); const a1 = JSON.stringify(world.anthropic); world.anthropic = []; await callGen({ 'x-mmm-operator-session': OP }, B); const a2 = JSON.stringify(world.anthropic);
check('generate: the model request is byte-identical for CEO and VA (the gate adds nothing to the prompt)', a1 === a2 && a1.length > 10);

/* ───────── 3. api/ops.js router: the eight paid actions ───────── */
const ops = (await loadPair('ops.js', '7d3f81a')).cur.default;
const ACTIONS = ['srv_build_package', 'farsi_regen_caption', 'srv_english_regen_caption', 'srv_english_build', 'srv_english_render_status', 'sm_va_task_generate_package', 'va_task_queue_generate', 'nextwave_v2_debug_storyboard'];
const callOps = async (action, headers, body, method = 'POST', query = {}) => { const res = mkRes(); await ops(req(headers, body, method, { action, ...query }), res); return res; };
for (const a of ACTIONS) {
  world.anthropic = []; world.writes = []; const m = a === 'srv_english_render_status' ? 'GET' : 'POST';
  const none = await callOps(a, {}, m === 'POST' ? {} : null, m, { long_id: 'x' }); const forged = await callOps(a, { 'x-mmm-ceo-session': sign({ sub: 'ceo', exp }, 'wrong') }, m === 'POST' ? {} : null, m, { long_id: 'x' });
  const fam = await callOps(a, { 'x-mmm-operator-session': sign({ sub: 'family', exp, pv: FP }, operatorSecret(SECRET)) }, m === 'POST' ? {} : null, m, { long_id: 'x' });
  check(a + ': no session / forged / wrong-role → 401 session_required, no model call, no write', [none, forged, fam].every((x) => x.code === 401 && x.body && x.body.error === 'session_required') && world.anthropic.length === 0 && world.writes.length === 0, [none.code, forged.code, fam.code]);
  const c = await callOps(a, { 'x-mmm-ceo-session': CEO }, m === 'POST' ? {} : null, m, { long_id: 'x' }); const v = await callOps(a, { 'x-mmm-operator-session': OP }, m === 'POST' ? {} : null, m, { long_id: 'x' });
  check(a + ': CEO and VA sessions pass the gate (handler answers on its own terms, not 401)', c.code !== 401 && v.code !== 401, [c.code, v.code]);
}
const src = fs.readFileSync(repo + '/api/ops.js', 'utf8'); const setBlock = src.slice(src.indexOf('const SESSION_GATED_ACTIONS'), src.indexOf(']);', src.indexOf('const SESSION_GATED_ACTIONS')));
check('source: all eight actions are in SESSION_GATED_ACTIONS and none was removed (the original nine remain)', ACTIONS.every((a) => setBlock.includes("'" + a + "'")) && ["sm_video_production_generate", "generate_package", "nextwave_v2_generate_scene_package", "nextwave_v2_generate_visual_plan", "delete_memory_item", "save_suno_execution", "delete_asset", "approve", "reject"].every((a) => setBlock.includes("'" + a + "'")));
/* ───────── 4. client ───────── */
const html = fs.readFileSync(repo + '/public/index.html', 'utf8');
check('client: every paid call site goes through _gfetch (7 sites) and none still uses a bare fetch for these endpoints', (html.match(/_gfetch\(/g) || []).length === 8 && !/(?<![\w$])fetch\(API_URL/.test(html) && !/(?<![\w$])fetch\([`'](\/api\/ops\?action=(srv_build_package|farsi_regen_caption|srv_english_regen_caption|srv_english_render_status|sm_va_task_generate_package))/.test(html));
const helper = html.slice(html.indexOf('function _gfetch'), html.indexOf('async function tryLogin'));
const calls = []; const H = vm.runInNewContext(helper + '; _gfetch', { fetch: (u, o) => { calls.push({ u, o }); return 1; }, _ceoGetSessionToken: () => globalThis.__ceo || '', _operatorGetSessionToken: () => globalThis.__op || '', Object, console });
globalThis.__ceo = 'C.T'; globalThis.__op = 'O.T'; H('/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' }); globalThis.__ceo = ''; H('/y'); globalThis.__op = ''; H('/z', { method: 'GET' });
check('client helper: CEO session wins, else VA session, else nothing; method/body/content-type untouched', calls[0].o.headers['X-MMM-CEO-Session'] === 'C.T' && !calls[0].o.headers['X-MMM-Operator-Session'] && calls[0].o.headers['Content-Type'] === 'application/json' && calls[0].o.body === '{"a":1}' && calls[1].o.headers['X-MMM-Operator-Session'] === 'O.T' && !calls[2].o.headers['X-MMM-CEO-Session'] && !calls[2].o.headers['X-MMM-Operator-Session'] && calls[2].o.method === 'GET');
console.log = log; cleanup(); done();
