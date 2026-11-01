// Order 046 — business authentication remediation, priority 1 (paid generation, deletion, approvals).
// Real api/ops.js against the in-memory stand-in. The VA PIN row is present, as in production, so the
// publishing gate is in ENFORCE mode. Run: node tests/platform/test_auth_remediation_p1_046.mjs
import { readFileSync } from 'node:fs';
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
// The app sends the session at every call site of these actions.
const plain = all.filter(a => new RegExp(`(?<![A-Za-z_])fetch\\(\\s*'/api/ops\\?action=${a}(?=[&'])`).test(html));
ok('no plain fetch() remains for any of the 11 actions in the app', plain.length === 0, plain.join(','));
const sessionCalls = all.map(a => (html.match(new RegExp(`_publishFetch\\(\\s*'/api/ops\\?action=${a}(?=[&'])`, 'g')) || []).length + (html.match(new RegExp(`_ceoAuthedFetch\\(\\s*'/api/ops\\?action=${a}(?=[&'])`, 'g')) || []).length);
ok('every action has at least one session-sending call site', sessionCalls.every(n => n >= 1), JSON.stringify(Object.fromEntries(all.map((a, i) => [a, sessionCalls[i]]))));
ok('the gate reuses the publishing gate (same enforce/observe mode, CEO or VA session)', /SESSION_GATED_ACTIONS\.has\(action\)\) \{\s*const gate = await _publishGate\(req, action\);/.test(src));
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
