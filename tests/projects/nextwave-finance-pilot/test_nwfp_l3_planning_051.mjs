// Order 051 — NextWave Finance Pilot L3 content planning. Real api/ops.js against the in-memory stand-in
// (never production). Run: node tests/projects/nextwave-finance-pilot/test_nwfp_l3_planning_051.mjs
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, call, calls, ceoToken, makeOk } from '../../platform/engineering-harness.mjs';
import * as L3 from '../../../projects/nextwave-finance-pilot/lib/contentPlan.mjs';
import * as P from '../../../projects/nextwave-finance-pilot/lib/pilotState.mjs';
const T = makeOk(); const ok = T.ok;
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..', '..', '..');
const src = readFileSync(join(root, 'api', 'ops.js'), 'utf8');
const example = JSON.parse(readFileSync(join(here, 'fixtures', 'example_plan_emergency_fund.json'), 'utf8'));
const CEO = ceoToken(), C = { ceo_session_token: CEO };
const clone = (o) => JSON.parse(JSON.stringify(o));

db.app_settings.push(
  { key: 'mmm_finance_v118', value: JSON.stringify({ nextWaveTaskSeq: 7, tasks: [{ id: 't1' }] }) },
  { key: 'nextwave_v2_route_enabled', value: '{"enabled":false}' },
  { key: 'srv_studio_v2_enabled', value: 'true' },
  { key: P.PILOT_STATE_KEY, value: JSON.stringify({ ...P.defaultState(), notes: ['L1 note'] }) },
);
const nonPlanRows = () => JSON.stringify(db.app_settings.filter(r => r.key !== L3.PLANS_KEY));
const before = nonPlanRows();
const tables = () => JSON.stringify(Object.fromEntries(Object.entries(db).filter(([k]) => k !== 'app_settings' && k !== 'mmm_platform_flags').map(([k, v]) => [k, v.length]))); // switch rows are set by this test itself
const tb = tables();

// ── 1. Pure rules ──
ok('plans live under the write-locked pilot prefix (no new migration needed)', P.isPilotSettingsKey(L3.PLANS_KEY) && L3.PLANS_KEY !== P.PILOT_STATE_KEY);
ok('the representative example passes every Creative Quality item', L3.evaluateQuality(example).ready, JSON.stringify(L3.evaluateQuality(example).items.filter(i => !i.pass)));
const d = L3.draftPlan({ title: 'Budgeting for an irregular income', topic_category: 'budgeting' }, { now: '2026-11-02T00:00:00Z', idSeed: 'abc123' });
ok('a draft skeleton is structurally valid but NOT ready (placeholders must be replaced by a person)', L3.validatePlan(d).ok && !L3.evaluateQuality(d).ready &&
  ['financial_accuracy', 'audience_usefulness', 'originality'].every(id => !L3.evaluateQuality(d).items.find(i => i.id === id).pass));
const bad = (mut) => { const p = clone(example); mut(p); return L3.evaluateQuality(p); };
const failsOn = (q, id) => !q.ready && q.items.find(i => i.id === id).pass === false;
ok('responsible framing: guaranteed returns, risk-free, tickers, buy/sell instructions and hype are rejected',
  failsOn(bad(p => { p.title = 'Guaranteed returns with this emergency fund'; }), 'responsible_framing') &&
  failsOn(bad(p => { p.long_form.outline[2].key_points.push('This is completely risk-free'); }), 'responsible_framing') &&
  failsOn(bad(p => { p.script_structure[2].notes = 'Mention $ABCD as the pick'; }), 'responsible_framing') &&
  failsOn(bad(p => { p.short_form.hook = 'You should buy index funds today'; }), 'responsible_framing') &&
  failsOn(bad(p => { p.short_form.concept = 'The insane emergency fund trick'; }), 'responsible_framing'));
ok('financial accuracy needs the disclaimer, a source and a human claims check',
  failsOn(bad(p => { p.compliance.educational_disclaimer = false; }), 'financial_accuracy') && failsOn(bad(p => { p.compliance.sources = []; }), 'financial_accuracy') && failsOn(bad(p => { p.compliance.claims_checked = false; }), 'financial_accuracy'));
ok('originality must be confirmed by the author', failsOn(bad(p => { p.originality = { original_concept: false, notes: '' }; }), 'originality'));
ok('the Short must link to and share the Long\'s idea', failsOn(bad(p => { p.short_form.links_to_long = false; }), 'long_short_relationship') &&
  failsOn(bad(p => { p.short_form.concept = 'Morning routine ideas for busy people'; p.short_form.hook = 'Try this simple daily habit'; }), 'long_short_relationship'));
ok('generic AI/tech content is rejected for this business', failsOn(bad(p => { p.title = 'How AI will manage your emergency fund'; }), 'distinct_from_ai_tech'));
ok('a non-finance topic category is invalid', failsOn(bad(p => { p.topic_category = 'gadgets'; }), 'topic_relevance'));
ok('plans cannot carry generation, publishing, business or foreign fields',
  ['generation', 'publishing', 'business_key', 'channel_id', 'upload', 'srvLifecycleStages'].every(f => !L3.validatePlan({ ...example, [f]: { enabled: true } }).ok));
ok('review flow: draft -> ready_for_review (only when ready) -> accepted_for_planning; no skipping, no going back from accepted',
  L3.applyReview(example, 'ready_for_review').ok && !L3.applyReview(d, 'ready_for_review').ok && !L3.applyReview(example, 'accepted_for_planning').ok &&
  L3.applyReview({ ...example, review_status: 'ready_for_review' }, 'accepted_for_planning').ok && !L3.applyReview({ ...example, review_status: 'accepted_for_planning' }, 'draft').ok);
ok('accepting a plan changes only its review status (no generation or publishing flag appears)', (() => { const r = L3.applyReview({ ...example, review_status: 'ready_for_review' }, 'accepted_for_planning'); return r.ok && Object.keys(r.plan).every(k => Object.keys(example).includes(k)); })());
ok('stored data from another business or malformed data is never adopted', L3.parseStore(JSON.stringify({ business_key: 'nextwave', schema: 1, plans: [example] })).plans.length === 0 && L3.parseStore('{bad').valid === false);

// ── 2. Authentication ──
const acts = ['nwfp_plan_draft', 'nwfp_plan_evaluate', 'nwfp_plan_list', 'nwfp_plan_save', 'nwfp_plan_review'];
let refused = 0;
for (const a of acts) { const x = await call(a, { plan: example }); const y = await call(a, { ceo_session_token: 'forged.token', operator_session_token: 'forged', plan: example }); if (x.status === 401 && y.status === 401) refused++; }
ok(`anonymous and forged callers are refused by all 5 L3 actions (${refused}/5)`, refused === 5);

// ── 3. Draft/evaluate/list store nothing; save/review OFF by default ──
const callsBefore = calls.length;
let r = await call('nwfp_plan_draft', { ...C, title: 'Credit reports: what is on yours and why it matters', topic_category: 'credit' });
ok('CEO draft returns a skeleton and its checklist, stored:false', r.status === 200 && r.body.stored === false && r.body.plan.topic_category === 'credit' && r.body.quality.items.length === 10);
r = await call('nwfp_plan_evaluate', { ...C, plan: example });
ok('CEO evaluate returns validation + quality for the example (ready), stored:false', r.status === 200 && r.body.quality.ready && r.body.validation.ok && r.body.stored === false);
r = await call('nwfp_plan_list', C);
ok('CEO list with nothing stored: 0 plans, writes OFF', r.status === 200 && r.body.plans.length === 0 && r.body.writes === 'OFF');
ok('draft, evaluate and list made no outside call and wrote nothing', calls.slice(callsBefore).every(c => c.method === 'GET') && nonPlanRows() === before && !db.app_settings.some(x => x.key === L3.PLANS_KEY));
r = await call('nwfp_plan_save', { ...C, plan: example });
const r2 = await call('nwfp_plan_review', { ...C, plan_id: example.id, review_status: 'ready_for_review' });
ok('with the switch missing, save and review are refused (409 pilot_plan_writes_off) and nothing is stored', r.status === 409 && r.body.error === 'pilot_plan_writes_off' && r2.status === 409 && !db.app_settings.some(x => x.key === L3.PLANS_KEY));
db.mmm_platform_flags.push({ flag: P.PILOT_WRITES_FLAG, enabled: true });
r = await call('nwfp_plan_save', { ...C, plan: example });
ok('turning on the L1 state switch does NOT enable plan saving (separate switch)', r.status === 409);

// ── 4. With the plan switch ON (stand-in only) ──
db.mmm_platform_flags.push({ flag: L3.PLAN_WRITES_FLAG, enabled: true });
r = await call('nwfp_plan_save', { ...C, plan: example });
const planRows = () => db.app_settings.filter(x => x.key === L3.PLANS_KEY);
ok('save writes exactly one row, the plans key, and the plan starts as draft', r.status === 200 && planRows().length === 1 && r.body.plan.review_status === 'draft' && r.body.revision === 1);
r = await call('nwfp_plan_save', { ...C, plan: { ...example, title: 'Emergency fund: how many months of essentials do you need?' }, expected_revision: 1 });
ok('editing the same plan updates the same row (no duplicates)', r.status === 200 && planRows().length === 1 && JSON.parse(planRows()[0].value).plans.length === 1 && r.body.revision === 2);
r = await call('nwfp_plan_save', { ...C, plan: example, expected_revision: 1 });
ok('a save based on an old revision is refused (409 revision_conflict)', r.status === 409 && r.body.error === 'revision_conflict');
r = await call('nwfp_plan_save', { ...C, plan: { ...example, id: 'plan_x2', publishing: { enabled: true } } });
ok('a plan carrying publishing is refused', r.status === 400 && r.body.error === 'invalid_plan');
r = await call('nwfp_plan_review', { ...C, plan_id: example.id, review_status: 'accepted_for_planning' });
ok('review cannot skip ready_for_review', r.status === 409 && r.body.error === 'transition_not_allowed');
r = await call('nwfp_plan_review', { ...C, plan_id: example.id, review_status: 'ready_for_review' });
const r3 = await call('nwfp_plan_review', { ...C, plan_id: example.id, review_status: 'accepted_for_planning' });
ok('review moves draft -> ready_for_review -> accepted_for_planning', r.status === 200 && r3.status === 200 && r3.body.plan.review_status === 'accepted_for_planning');
r = await call('nwfp_plan_save', { ...C, plan: d });
const r4 = await call('nwfp_plan_review', { ...C, plan_id: d.id, review_status: 'ready_for_review' });
ok('an incomplete plan cannot be sent for review (quality checklist incomplete)', r.status === 200 && r4.status === 409 && r4.body.error === 'quality_checklist_incomplete');
r = await call('nwfp_plan_review', { ...C, plan_id: 'plan_nothere', review_status: 'ready_for_review' });
ok('reviewing an unknown plan is 404', r.status === 404);
r = await call('nwfp_plan_list', C);
ok('list returns the 2 stored plans with their checklists', r.status === 200 && r.body.plans.length === 2 && r.body.plans.every(p => p.quality && p.quality.items.length === 10) && r.body.writes === 'ON');
r = await call('nwfp_plan_save', { ...C, plan: example }, { method: 'GET', query: { ceo_session_token: CEO } });
ok('saving is POST only', r.status === 405);

// ── 5. Isolation ──
ok('every non-plan app_settings row (shared state, NextWave V2, SRV Studio V2, the L1 pilot state) is byte-identical', nonPlanRows() === before);
ok('no other table changed (no tasks, evidence, assets or packages created)', tables() === tb);
ok('no outside service was called (no AI, media, YouTube or publishing)', calls.every(c => c.url.startsWith('https://tldcwvtwjypmwynsklsd.supabase.co/rest/v1/')));
const block = src.slice(src.indexOf('async function _nwfpPlanRow()'), src.indexOf('async function _engCeoTaskArtifactRows('));
ok('the L3 server block writes only app_settings (the plans row) and calls no generation, upload or publishing helper',
  block.length > 2000 && block.length < 8000 && !/sbInsert\('(?!app_settings)|sbPatch\('(?!app_settings)|fetch\(|anthropic|heygen|elevenlabs|runway|submagic|youtube|upload|publish\w*\(/i.test(block.replace(/no generation, upload or publishing|nothing here generates or publishes|Nothing here generates or publishes/gi, '')) && /PLANS_KEY/.test(block));
let changed = null;
try { changed = execSync('git diff --name-only origin/main -- .', { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { }
if (changed) {
  // Same rule as the L1/L2 suite: only the two shared files and the pilot's own folders may change, and in the
  // shared files only lines inside pilot-owned functions (function _nwfp… / nwfp…) may be edited or removed.
  const allowed = (f) => f === 'api/ops.js' || f === 'public/index.html' || f.startsWith('projects/nextwave-finance-pilot/') || f.startsWith('tests/projects/nextwave-finance-pilot/') || f.startsWith('docs/projects/nextwave-finance-pilot/');
  ok('only api/ops.js, public/index.html and the pilot\'s own folders changed (no NextWave V1/V2, SRV, SMM or AI Studio file)', changed.every(allowed), changed.filter(f => !allowed(f)).join(','));
  const mainText = { 'api/ops.js': execSync('git show origin/main:api/ops.js', { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }), 'public/index.html': execSync('git show origin/main:public/index.html', { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }) };
  const ownerOf = (txt, line) => { const i = txt.indexOf(line); if (i < 0) return null; const m = [...txt.slice(0, i).matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)].pop(); return m ? m[1] : null; };
  const removed = execSync('git diff -U0 origin/main -- api/ops.js public/index.html', { cwd: root, encoding: 'utf8' }).split('\n').filter(l => /^-[^-]/.test(l)).map(l => l.slice(1));
  const foreign = removed.filter(l => !['api/ops.js', 'public/index.html'].some(f => { const o = ownerOf(mainText[f], l); return o && /^_?nwfp/i.test(o); }));
  ok('in the shared files, only lines inside pilot-owned functions are edited or removed', foreign.length === 0, foreign.slice(0, 2).join(' | '));
}
ok('the 5 L3 actions are dispatched and check the CEO session themselves (not in publishing/session gate lists)',
  acts.every(a => src.includes(`if (action === '${a}')`) && !new RegExp(`const (PUBLISH|SESSION)_GATED_ACTIONS = new Set\\(\\[[^\\]]*'${a}'`).test(src)));
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
