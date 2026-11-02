// Order 049 — NextWave Finance Pilot L1 (isolated state) and L2 (CEO read-only status).
// Real api/ops.js against the in-memory stand-in; never touches production.
// Run: node tests/projects/nextwave-finance-pilot/test_nwfp_l1_l2_049.mjs
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { db, call, ceoToken, makeOk, randomUUID } from '../../platform/engineering-harness.mjs';
import * as P from '../../../projects/nextwave-finance-pilot/lib/pilotState.mjs';
const T = makeOk(); const ok = T.ok;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = readFileSync(join(root, 'api', 'ops.js'), 'utf8');
const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
const cfg = JSON.parse(readFileSync(join(root, 'projects', 'nextwave-finance-pilot', 'pilot.config.json'), 'utf8'));
const CEO = ceoToken();
const C = { ceo_session_token: CEO };
delete process.env.VERCEL_ENV;

// ── Other businesses' state, seeded so we can prove it never changes ──
db.app_settings.push(
  { key: 'mmm_finance_v118', value: JSON.stringify({ srvLifecycleStages: { a: 1 }, nextWaveTaskSeq: 7, tasks: [{ id: 't1' }] }) },
  { key: 'srv_studio_v2_enabled', value: 'true' },
  { key: 'nextwave_v2_route_enabled', value: '{"enabled":false}' },
);
const others = () => JSON.stringify(db.app_settings.filter(r => !P.isPilotSettingsKey(r.key)));
const othersBefore = others();
const tablesSnap = () => JSON.stringify(Object.fromEntries(Object.entries(db).filter(([k]) => k !== 'app_settings').map(([k, v]) => [k, v.length])));

// ── 1. Pure L1 rules ──
ok('pilot config and module agree on the business key; generation and publishing disabled in both',
  cfg.business_key === P.PILOT_KEY && cfg.reserved_namespaces.state_key === P.PILOT_KEY && cfg.paid_generation.enabled === false && cfg.publishing.enabled === false &&
  P.defaultState().generation.enabled === false && P.defaultState().publishing.enabled === false);
ok('the state key is under the pilot prefix only', P.isPilotSettingsKey(P.PILOT_STATE_KEY) && !P.isPilotSettingsKey('mmm_finance_v118') && !P.isPilotSettingsKey('nextwave_v2_route_enabled') && !P.isPilotSettingsKey('nextwave_finance_pilo'));
ok('a patch may not touch generation, publishing, business_key or unknown fields',
  ['generation', 'publishing', 'business_key', 'schema', 'revision', 'srvLifecycleStages', 'tasks'].every(f => !P.validatePatch({ [f]: { enabled: true } }).ok));
ok('a valid patch is applied and generation/publishing are always stored disabled',
  (() => { const r = P.applyPatch(null, { lifecycle_stage: 'planning', notes: ['first note'] }, { now: '2026-11-02T00:00:00Z' }); return r.ok && r.state.lifecycle_stage === 'planning' && r.state.generation.enabled === false && r.state.publishing.enabled === false && r.state.revision === 1 && r.state.business_key === P.PILOT_KEY; })());
ok('stored data from another business, or malformed data, is never adopted',
  P.parseStoredState(JSON.stringify({ business_key: 'nextwave', schema: 1, lifecycle_stage: 'planning', notes: ['x'] })).state.notes.length === 0 &&
  P.parseStoredState('{not json').valid === false &&
  P.parseStoredState(JSON.stringify({ business_key: P.PILOT_KEY, schema: 1, generation: { enabled: true }, publishing: { enabled: true } })).state.generation.enabled === false);
ok('oversized or empty lists are refused', !P.validatePatch({ notes: Array(21).fill('a') }).ok && !P.validatePatch({ planning_topics: [''] }).ok && !P.validatePatch({ notes: ['x'.repeat(501)] }).ok && !P.validatePatch({}).ok);

// ── 2. Authentication ──
let refused = 0;
for (const a of ['nwfp_status', 'nwfp_state_get', 'nwfp_state_update']) {
  const anon = await call(a, { patch: { notes: ['x'] } });
  const forged = await call(a, { ceo_session_token: 'forged.token', operator_session_token: 'forged', patch: { notes: ['x'] } });
  if (anon.status === 401 && forged.status === 401) refused++;
}
ok(`anonymous and forged callers are refused by all 3 pilot actions (${refused}/3)`, refused === 3);

// ── 3. Writes are OFF by default ──
let r = await call('nwfp_state_update', { ...C, patch: { notes: ['x'] } });
ok('with the switch row missing, a CEO write is refused (409 pilot_state_writes_off) and nothing is stored',
  r.status === 409 && r.body.error === 'pilot_state_writes_off' && !db.app_settings.some(x => x.key === P.PILOT_STATE_KEY));
r = await call('nwfp_state_get', C);
ok('a CEO read returns the default state, not stored, writes OFF', r.status === 200 && r.body.stored === false && r.body.writes === 'OFF' && r.body.state.lifecycle_stage === 'registered');

// ── 4. Writes with the switch ON (stand-in only) ──
db.mmm_platform_flags.push({ flag: P.PILOT_WRITES_FLAG, enabled: true });
const tb = tablesSnap();
r = await call('nwfp_state_update', { ...C, patch: { lifecycle_stage: 'planning', planning_topics: ['Emergency fund basics'] } });
const pilotRows = () => db.app_settings.filter(x => P.isPilotSettingsKey(x.key));
ok('a CEO write stores exactly one row, the pilot state key', r.status === 200 && pilotRows().length === 1 && pilotRows()[0].key === P.PILOT_STATE_KEY && r.body.state.revision === 1);
r = await call('nwfp_state_update', { ...C, patch: { notes: ['second'] }, expected_revision: 1 });
ok('a second write updates the same row (no duplicates) and bumps the revision', r.status === 200 && pilotRows().length === 1 && r.body.state.revision === 2 && r.body.state.planning_topics.length === 1);
r = await call('nwfp_state_update', { ...C, patch: { notes: ['stale'] }, expected_revision: 1 });
ok('a write based on an old revision is refused (409 revision_conflict)', r.status === 409 && r.body.error === 'revision_conflict');
r = await call('nwfp_state_update', { ...C, patch: { publishing: { enabled: true } } });
const stored = JSON.parse(pilotRows()[0].value);
ok('an attempt to enable publishing is refused and the stored state stays disabled', r.status === 400 && stored.publishing.enabled === false && stored.generation.enabled === false);
r = await call('nwfp_state_update', { ...C, patch: { srvLifecycleStages: { a: 2 } } });
ok('a pilot write cannot carry another business\'s fields', r.status === 400);
ok('every other business\'s app_settings row (shared state, SRV Studio V2, NextWave V2) is byte-identical', others() === othersBefore);
ok('no other table changed during pilot writes', tablesSnap() === tb);
r = await call('nwfp_state_update', { ...C, patch: { notes: ['x'] } }, { method: 'GET', query: { ceo_session_token: CEO } });
ok('writes are POST only', r.status === 405);

// ── 5. Other businesses cannot reach the pilot state ──
const saveBlock = html.slice(html.indexOf('async function saveAppState(){'), html.indexOf('// 1. localStorage', html.indexOf('async function saveAppState(){')));
ok('the shared company state payload (saveAppState) contains nothing of the pilot', saveBlock.length > 1000 && !/nextwave_finance_pilot|nwfp/i.test(saveBlock));
const keyRefs = (src.match(/nextwave_finance_pilot_state|PILOT_STATE_KEY/g) || []).length;
const block = src.slice(src.indexOf('// 049 — NextWave Finance Pilot L1'), src.indexOf('async function _engCeoTaskArtifactRows('));
ok('api/ops.js writes the pilot key only inside the 049 pilot block', keyRefs === (block.match(/nextwave_finance_pilot_state|PILOT_STATE_KEY/g) || []).length && keyRefs >= 3);
ok('no browser code writes pilot keys (the app only reads through nwfp_status)', !/nextwave_finance_pilot_state/.test(html) && (html.match(/action=nwfp_state_update/g) || []).length === 0);
db.app_settings.find(x => x.key === P.PILOT_STATE_KEY).value = JSON.stringify({ business_key: 'srv_farsi', schema: 1, lifecycle_stage: 'planning', notes: ['foreign'] });
r = await call('nwfp_state_get', C);
ok('a foreign value written into the pilot row (e.g. through the public key before the write-lock) is ignored', r.status === 200 && r.body.valid === false && r.body.state.notes.length === 0);

// ── 6. L2 status: task and artifact isolation, no foreign data ──
const pid = randomUUID(), nid = randomUUID(), fid = randomUUID();
db.engineering_tasks.push(
  { id: pid, status: 'open', problem: 'pilot task', packet: { business: P.PILOT_KEY } },
  { id: nid, status: 'open', problem: 'V2 SECRET TASK', packet: { business: 'nextwave' } },
  { id: fid, status: 'closed', problem: 'farsi', packet: { business: 'srv_farsi' } },
);
db.brain_evidence.push(
  { id: randomUUID(), task_id: pid, evidence_type: 'artifact', created_at: '2026-11-02T01:00:00Z', metadata: { bucket: 'engineering-artifacts', object_path: `${P.PILOT_KEY}/${pid}/run1/a.json`, size_bytes: 100 } },
  { id: randomUUID(), task_id: pid, evidence_type: 'artifact', created_at: '2026-11-02T02:00:00Z', metadata: { bucket: 'engineering-artifacts', object_path: `nextwave/${pid}/run1/forged.json`, size_bytes: 999 } },
  { id: randomUUID(), task_id: nid, evidence_type: 'artifact', created_at: '2026-11-02T03:00:00Z', metadata: { bucket: 'engineering-artifacts', object_path: `nextwave/${nid}/run1/v2.json`, size_bytes: 5 } },
);
r = await call('nwfp_status', C);
const st = r.body.status, out = JSON.stringify(r.body);
ok('status counts only pilot tasks (1) and only artifacts in the pilot\'s own folder (1 file, 100 B)', r.status === 200 && st.tasks.total === 1 && st.artifacts.files === 1 && st.artifacts.total_bytes === 100);
ok('status returns no storage paths, other task ids, other titles or tokens', !/object_path|nextwave\/|run1|V2 SECRET|ceo_session|service|token/i.test(out) && !out.includes(nid) && !out.includes(fid) && !out.includes(pid));
ok('outside production nothing is LIVE or DEPLOYED (registration, L1, L2, L3 show PREVIEW READY)', st.stages.every(s => !/^(LIVE|DEPLOYED)/.test(s.status)) && st.registration === 'PREVIEW READY' && st.stages.filter(s => s.status === 'PREVIEW READY').map(s => s.id).join() === 'registration,L1,L2,L3');
process.env.VERCEL_ENV = 'production';
r = await call('nwfp_status', C);
const sp = r.body.status;
ok('in production (stand-in state switch is ON here): REGISTERED, NOT OPERATIONAL; registration LIVE; L1 shows the real switch, DEPLOYED \u2014 WRITES ON; L2 DEPLOYED \u2014 READ ONLY; L3 DEPLOYED \u2014 SAVING OFF; L4-L7 NOT STARTED',
  sp.registration === 'REGISTERED' && sp.operational === 'NOT OPERATIONAL' && sp.stages.filter(s => s.status === 'LIVE').map(s => s.id).join() === 'registration' &&
  sp.stages.find(s => s.id === 'L1').status === 'DEPLOYED \u2014 WRITES ON' && sp.stages.find(s => s.id === 'L2').status === 'DEPLOYED \u2014 READ ONLY' &&
  sp.stages.find(s => s.id === 'L3').status === 'DEPLOYED \u2014 SAVING OFF' && sp.stages.filter(s => s.status === 'NOT STARTED').length === 4);
ok('generation and publishing shown DISABLED; latest verified checkpoint 052', sp.generation === 'DISABLED' && sp.publishing === 'DISABLED' && sp.latest_verified_checkpoint === '052');
delete process.env.VERCEL_ENV;
ok('the stage manifest uses only the allowed statuses, and no L4-L7 stage claims LIVE or DEPLOYED', P.STAGES.every(s => P.STAGE_STATUSES.includes(s.status)) && P.STAGES.filter(s => /^L[4-7]$/.test(s.id)).every(s => s.status === 'NOT STARTED'));

// ── 7. L2 card (real app code in a sandbox) ──
const grab = (name) => { const i = html.indexOf(`function ${name}(`); const s0 = html.lastIndexOf('\n', i) + 1; let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(s0, j + 1); };
const ctx = { escHTML: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') };
vm.createContext(ctx);
vm.runInContext(['_engFmtBytes', '_nwfpCardSection', '_nwfpBadge', '_nwfpCardHtml'].map(grab).join('\n'), ctx);
const evil = { ...sp, display_name: '<img src=x onerror=alert(1)>', stages: [{ id: 'L1', label: '<script>x</script>', status: 'LIVE"><b>' }] };
const card = vm.runInContext('_nwfpCardHtml', ctx)(evil);
ok('the card escapes every value (no injected tags)', !/<img|<script|"><b>/.test(card) && card.includes('&lt;img'));
const real = vm.runInContext('_nwfpCardHtml', ctx)(sp);
ok('the card shows identity, REGISTERED, NOT OPERATIONAL, DISABLED generation/publishing, all 8 stages and checkpoint 052',
  real.includes('NextWave Finance Pilot (nextwave_finance_pilot)') && real.includes('data-nwfp-badge="REGISTERED"') && real.includes('data-nwfp-badge="NOT OPERATIONAL"') &&
  (real.match(/data-nwfp-badge="DISABLED"/g) || []).length === 2 && (real.match(/data-nwfp-stage=/g) || []).length === 8 && real.includes('052'));
const sectionAndCard = grab('_nwfpCardSection') + grab('_nwfpCardHtml') + grab('_nwfpCardLoad');
ok('the card is read-only: one SHOW button, no inputs, and it calls only nwfp_status through the CEO session',
  (sectionAndCard.match(/<button/g) || []).length === 1 && !/<input|<textarea|<select|contenteditable/.test(sectionAndCard) &&
  (sectionAndCard.match(/\/api\/ops\?action=/g) || []).length === 1 && sectionAndCard.includes("_ceoAuthedFetch('/api/ops?action=nwfp_status'"));
ok('the card is mounted once, in the CEO Engineering Review, right after Stored artifacts', (html.match(/\$\{_nwfpCardSection\(\)\}/g) || []).length === 1 && html.includes('${_engArtifactsSection()}\n      ${_nwfpCardSection()}'));

// ── 8. Scope of the change ──
let changed = [];
try { changed = execSync('git diff --name-only origin/main -- .', { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { changed = null; }
if (changed) {
  const allowed = (f) => f === 'api/ops.js' || f === 'public/index.html' || f.startsWith('projects/nextwave-finance-pilot/') || f.startsWith('tests/projects/nextwave-finance-pilot/') || f.startsWith('docs/projects/nextwave-finance-pilot/');
  ok('only api/ops.js, public/index.html and the pilot\'s own folders are changed (no NextWave V1/V2, SRV, SMM or AI Studio file)', changed.every(allowed), changed.filter(f => !allowed(f)).join(','));
  const removed = execSync('git diff -U0 origin/main -- api/ops.js public/index.html', { cwd: root, encoding: 'utf8' }).split('\n').filter(l => /^-[^-]/.test(l));
  // A changed line is allowed only inside a pilot-owned function (function _nwfp… / nwfp…) as it stands on main.
  const mainText = { 'api/ops.js': execSync('git show origin/main:api/ops.js', { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }), 'public/index.html': execSync('git show origin/main:public/index.html', { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }) };
  const ownerOf = (txt, line) => { const i = txt.indexOf(line); if (i < 0) return null; const m = [...txt.slice(0, i).matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)].pop(); return m ? m[1] : null; };
  const foreign = removed.map(l => l.slice(1)).filter(l => !['api/ops.js', 'public/index.html'].some(f => { const o = ownerOf(mainText[f], l); return o && /^_?nwfp/i.test(o); }));
  ok('in the shared files, only lines inside pilot-owned functions change (nothing of another feature is removed or edited)', foreign.length === 0, foreign.slice(0, 3).join(' | '));
}
ok('the 3 pilot actions are dispatched and are not in the publishing or session gate lists (they check the CEO session themselves)',
  ['nwfp_status', 'nwfp_state_get', 'nwfp_state_update'].every(a => src.includes(`if (action === '${a}')`) && !new RegExp(`const (PUBLISH|SESSION)_GATED_ACTIONS = new Set\\(\\[[^\\]]*'${a}'`).test(src)));
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
