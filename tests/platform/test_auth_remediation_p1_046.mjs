// Order 046 — business authentication remediation, priority 1 (paid generation, deletion, approvals).
// Real api/ops.js against the in-memory stand-in. The VA PIN row is present, as in production, so the
// publishing gate is in ENFORCE mode. Run: node tests/platform/test_auth_remediation_p1_046.mjs
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, call, ceoToken, makeOk, sha } from './engineering-harness.mjs';
const T = makeOk(); const ok = T.ok;
db.ceo_auth_config.push({ key: 'operator_pin_hash_production', value: sha('va-test-pin') }); // production has a VA PIN
delete process.env.ANTHROPIC_API_KEY;
const CEO = ceoToken();
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'api', 'ops.js'), 'utf8');
const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
const groups = {
  'operator approvals': ['approve', 'reject'],
  'production pipeline and assets': ['heygen_render_status', 'save_heygen_execution', 'save_suno_execution', 'delete_asset'],
  'NextWave V2 generation and memory': ['generate_package', 'nextwave_v2_generate_scene_package', 'nextwave_v2_generate_visual_plan', 'delete_memory_item'],
  'SMM video generation': ['sm_video_production_generate'],
};
const all = Object.values(groups).flat();
const set = (src.match(/const SESSION_GATED_ACTIONS = new Set\(\[([\s\S]*?)\]\);/) || [])[1] || '';
ok('exactly the 11 priority actions are in the session gate (SRV group deferred to the SRV workstream)', all.every(a => set.includes(`'${a}'`)) && (set.match(/^\s*'[a-z0-9_]+',/gm) || []).length === 11);
const snap = () => JSON.stringify(Object.fromEntries(Object.entries(db).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])));
const before = snap();
for (const [g, acts] of Object.entries(groups)) {
  let refused = 0, detail = [];
  for (const a of acts) {
    const r = await call(a, { approval_id: '00000000-0000-4000-8000-000000000000', asset_id: 'x', id: 'x', video_id: 'v', script: 'x', vaTaskId: 'x' });
    if (r.status === 401 && r.body.error === 'session_required') refused++; else detail.push(`${a}:${r.status}`);
  }
  ok(`${g}: every action refuses an anonymous caller (${refused}/${acts.length})`, refused === acts.length, detail.join(' '));
}
ok('anonymous calls changed nothing in any table', snap() === before, snap());
let forged = 0;
for (const a of all) { const r = await call(a, { ceo_session_token: 'forged.token', operator_session_token: 'forged' }); if (r.status === 401) forged++; }
ok(`forged CEO and VA tokens are refused for all 11 (${forged}/11)`, forged === 11);
let passed = 0; const stuck = [];
for (const a of all) {
  const r = await call(a, { ceo_session_token: CEO, approval_id: '00000000-0000-4000-8000-000000000000', video_id: 'v' });
  if (!(r.status === 401 && r.body.error === 'session_required')) passed++; else stuck.push(a);
}
ok(`a CEO session passes the gate for all 11 (${passed}/11; handler errors after the gate are expected with test input)`, passed === 11, stuck.join(' '));
// A VA (operator) session — obtained through the real VA sign-in — keeps access to all 11.
const login = await call('operator_login', { pin: 'va-test-pin' });
const VA = login.body && login.body.operator_session_token;
ok('the real VA sign-in issues an operator session', login.status === 200 && typeof VA === 'string' && VA.length > 20, JSON.stringify(login.body).slice(0, 120));
let vaPassed = 0; const vaStuck = [];
for (const a of all) {
  const r = await call(a, { operator_session_token: VA, approval_id: '00000000-0000-4000-8000-000000000000', video_id: 'v' });
  if (!(r.status === 401 && r.body.error === 'session_required')) vaPassed++; else vaStuck.push(a);
}
ok(`a VA session passes the gate for all 11 (${vaPassed}/11)`, vaPassed === 11, vaStuck.join(' '));
const bad = await call('operator_login', { pin: 'wrong-pin' });
ok('a wrong VA PIN is refused and issues no session', bad.status === 401 && !(bad.body && bad.body.operator_session_token));
// The publishing gate itself is unchanged: same action list and same gate code as main.
let mainSrc = process.env.MAIN_OPS ? readFileSync(process.env.MAIN_OPS, 'utf8') : null;
if (!mainSrc) { try { mainSrc = execSync('git show origin/main:api/ops.js', { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { console.log('NOTE main comparison skipped: origin/main not available'); } }
const grab = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
if (mainSrc) {
  ok('publishing action list (PUBLISH_GATED_ACTIONS) is byte-identical to main', grab(src, 'const PUBLISH_GATED_ACTIONS', ']);') === grab(mainSrc, 'const PUBLISH_GATED_ACTIONS', ']);'));
  ok('publishing gate code (_publisherFromRequest, _publishGate, operatorLogin) is byte-identical to main', grab(src, 'async function _publisherFromRequest', 'async function operatorCheckSession') === grab(mainSrc, 'async function _publisherFromRequest', 'async function operatorCheckSession'));
}
// The app sends the session at every call site of these actions.
const plain = all.filter(a => new RegExp(`(?<![A-Za-z_])fetch\\(\\s*'/api/ops\\?action=${a}(?=[&'])`).test(html));
ok('no plain fetch() remains for any of the 11 actions in the app', plain.length === 0, plain.join(','));
const sessionCalls = all.map(a => (html.match(new RegExp(`_publishFetch\\(\\s*'/api/ops\\?action=${a}(?=[&'])`, 'g')) || []).length + (html.match(new RegExp(`_ceoAuthedFetch\\(\\s*'/api/ops\\?action=${a}(?=[&'])`, 'g')) || []).length);
ok('every action has at least one session-sending call site', sessionCalls.every(n => n >= 1), JSON.stringify(Object.fromEntries(all.map((a, i) => [a, sessionCalls[i]]))));
ok('the gate reuses the publishing gate (same enforce/observe mode, CEO or VA session)', /SESSION_GATED_ACTIONS\.has\(action\)\) \{\s*const gate = await _publishGate\(req, action\);/.test(src));
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
