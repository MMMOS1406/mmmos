// Order 043 — Task Generator correction (decision -> task). Real api/ops.js against the in-memory stand-in.
// No AI key in tests, so the generator uses its deterministic fallback (no network).
// Run: node tests/platform/test_task_generator_fix_043.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, call, ceoToken, makeOk } from './engineering-harness.mjs';
const T = makeOk(); const ok = T.ok;
const CEO = ceoToken();
delete process.env.ANTHROPIC_API_KEY;
const archiveDecision = 'Decision: Create one MMMOS engineering task named\n"Checkpoint archive" (business: mmmos).\n\nScope: Store engineering checkpoint reports and\ntheir SHA-256 manifests as private artifacts only.\n\nNo repository changes.\nNo runner activation.\nNo production deployment.\nManual authorization required.';
const make = (text) => call('engineering_task_create_from_decision', { decision_text: text, ceo_session_token: CEO });

let r = await call('engineering_task_create_from_decision', { decision_text: archiveDecision });
ok('still requires the CEO session', r.status === 401);
const before = db.engineering_tasks.length;
r = await make(archiveDecision);
const t1 = db.engineering_tasks.find(t => t.id === r.body.task?.id);
ok('the CEO archive decision creates one task', r.status === 200 && r.body.deduped !== true && t1 && db.engineering_tasks.length === before + 1, JSON.stringify(r.body).slice(0, 200));
ok('business named in the decision is kept (mmmos)', t1 && t1.packet.business === 'mmmos');
ok('storage-only decision is marked evidence_only', t1 && t1.packet.work_type === 'evidence_only');
const proto = (t1 && t1.packet.task_protocol || []).join(' | ');
ok('its protocol has no implement or deploy steps', proto && !/Deploy:|bump version|version badge|Implement ONLY/.test(proto), proto);
const tests = (t1 && t1.packet.testing_checklist || []).join(' | ');
ok('its testing checklist has no screenshot or deployment check', tests && !/screenshot|deployment|version badge/i.test(tests) && /SHA-256/.test(tests), tests);
ok('the authorization boundary still carries the CEO constraints', /No repository changes|repository/i.test(t1.packet.origin_decision.authorization_boundary || '') || /task_generator_decision_scope_only/.test(t1.packet.origin_decision.authorization_boundary || ''));
ok('a SHA-256 of the decision text is recorded', /^[0-9a-f]{64}$/.test(t1.packet.origin_decision_sha256 || ''));

// Duplicate submission (the 4-second double click in 041).
r = await make(archiveDecision);
ok('the same decision within 10 minutes returns the existing task (no duplicate)', r.status === 200 && r.body.deduped === true && r.body.task.id === t1.id && db.engineering_tasks.length === before + 1);
ok('the deduplicated reply carries no token hash', !('agent_authorization_token_hash' in r.body.task));
t1.created_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
r = await make(archiveDecision);
ok('after 10 minutes the same text may create a new task (deliberate re-submission)', r.status === 200 && r.body.deduped !== true && db.engineering_tasks.length === before + 2);

// Ordinary implementation decisions keep the normal protocol; unknown businesses are ignored.
r = await make('Decision: fix the SRV Farsi caption overflow on the Short template. business: acme. Ship it after tests.');
const t3 = db.engineering_tasks.find(t => t.id === r.body.task?.id);
ok('an implementation decision keeps the standard protocol', t3 && !t3.packet.work_type && (t3.packet.task_protocol || []).some(s => /Deploy/.test(s)));
ok('an unknown business name is not stored', t3 && !t3.packet.business);
r = await make('Decision: store the weekly report as an artifact. No production deployment.');
const t4 = db.engineering_tasks.find(t => t.id === r.body.task?.id);
ok('evidence-only needs BOTH no-deployment and no-repository-change (otherwise standard protocol)', t4 && !t4.packet.work_type);

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'index.html'), 'utf8');
const ui = html.slice(html.indexOf('async function _ebCreateTaskFromDecision('), html.indexOf('async function _ebCreateTaskFromDecision(') + 2500);
ok('the Task Generator button ignores a second click while a submission is running', /if\(window\._ebDecisionBusy\)return;/.test(ui) && /finally\{ window\._ebDecisionBusy=false; \}/.test(ui));
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
