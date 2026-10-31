// MMMOS-R2-CONSOLIDATED-034 — Engineering Brain v2 actions require the CEO session.
// Runs the REAL api/ops.js against the in-memory stand-in. Never touches production.
// Run: node tests/platform/test_engineering_auth_034.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, call, ceoToken, makeOk } from './engineering-harness.mjs';
const T = makeOk(); const ok = T.ok;
const CEO = ceoToken();
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'api', 'ops.js'), 'utf8');
const html = readFileSync(join(here, '..', '..', 'public', 'index.html'), 'utf8');
const actions = [...new Set([...src.matchAll(/action === '(brain_v2_[a-z_]+)'/g)].map(m => m[1]))].sort();
ok(`found the brain_v2 actions in the router (${actions.length})`, actions.length >= 25, actions.join(','));
const snapshot = () => JSON.stringify(Object.fromEntries(Object.entries(db).filter(([k]) => k.startsWith('brain_')).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])));
const before = snapshot();
let refused = 0; const notRefused = [];
for (const a of actions) {
  const r = await call(a, { title: 'x', problem: 'x', engine: 'x', task_id: '00000000-0000-0000-0000-000000000000', version: 'x', key: 'x', section: 'x' });
  if (r.status === 401 && r.body.error === 'ceo_session_required') refused++; else notRefused.push(`${a}:${r.status}`);
}
ok(`every brain_v2 action refuses an anonymous caller (${refused}/${actions.length})`, refused === actions.length, notRefused.join(' '));
ok('anonymous calls wrote nothing to any brain_* table', snapshot() === before, snapshot());
for (const a of ['brain_v2_get_agent_runs', 'brain_v2_overview', 'brain_v2_get_metrics', 'brain_v2_get_deployments']) {
  const r = await call(a, { ceo_session_token: CEO });
  ok(`${a} works with the CEO session`, r.status !== 401 && r.body && r.body.error !== 'ceo_session_required', `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
}
const forged = await call('brain_v2_get_agent_runs', { ceo_session_token: 'a.b' });
ok('a forged session token is refused', forged.status === 401);
// The app sends the session on every brain_v2 call and never fails silently on a status change.
ok('the app has no plain fetch() to a brain_v2 action', !/(?<![A-Za-z_])fetch\('\/api\/ops\?action=brain_v2_/.test(html));
ok('the app calls brain_v2 actions with the CEO session', (html.match(/_ceoAuthedFetch\('\/api\/ops\?action=brain_v2_/g) || []).length >= 13);
const upd = html.slice(html.indexOf('async function _ebUpdateStatus('), html.indexOf('async function _ebUpdateStatus(') + 600);
ok('a refused status change is reported, not silently shown as saved', /if\(!d\.ok\)\{ alert\('Status not saved: '\+_engErrMsg\(d\)\)/.test(upd));
ok('refusal text is escaped where it is inserted as HTML', !/Error: \$\{d\.error\|\|'unknown'\}/.test(html.slice(html.indexOf("action=engineering_task_create_from_decision") - 2000, html.indexOf("action=engineering_task_update"))));
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
