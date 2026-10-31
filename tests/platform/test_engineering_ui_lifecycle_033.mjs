// MMMOS-R2-MASTER-033 — Engineering UI lifecycle labels + task-list escaping.
// Loads the real helpers out of public/index.html (no browser needed).
// Run: node tests/platform/test_engineering_ui_lifecycle_033.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
const grab = (name) => { const i = html.indexOf(`function ${name}(`); if (i < 0) throw new Error('missing ' + name); let d = 0, j = html.indexOf('{', i); for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1); } };
const src = ['escHTML', '_engAttr', '_engLifecycle', '_engLifecycleChip'].map(grab).join('\n');
const { _engLifecycle, _engLifecycleChip } = new Function(`${src}; return { _engLifecycle, _engLifecycleChip };`)();
const soon = new Date(Date.now() + 3600e3).toISOString(), past = new Date(Date.now() - 3600e3).toISOString();
const cases = [
  [{ status: 'open' }, 'Draft'],
  [{ status: 'open', agent_authorized_at: past }, 'Authorized'],
  [{ status: 'open', agent_authorized_at: past, agent_authorization_revoked_at: past }, 'Draft'],
  [{ status: 'open', agent_authorized_at: past, lease_expires_at: soon }, 'Running'],
  [{ status: 'open', agent_authorized_at: past, lease_expires_at: past }, 'Authorized'],
  [{ status: 'in_progress' }, 'Running'],
  [{ status: 'blocked', lease_expires_at: soon }, 'Blocked'],
  [{ status: 'testing' }, 'PM Review'],
  [{ status: 'ready_for_ceo' }, 'CEO Review'],
  [{ status: 'open', ceo_decision: 'approved' }, 'Approved'],
  [{ status: 'done', ceo_decision: 'approved' }, 'Closed'],
  [{ status: 'completed' }, 'Closed'], [{ status: 'complete' }, 'Closed'], [{}, 'Draft'], [null, 'Draft'],
];
for (const [t, want] of cases) ok(`lifecycle ${JSON.stringify(t)} → ${want}`, _engLifecycle(t) === want, _engLifecycle(t));
ok('chip is escaped and labelled', /data-eng-lifecycle="CEO Review"/.test(_engLifecycleChip({ status: 'ready_for_ceo' })) && !/<script/i.test(_engLifecycleChip({ status: '<script>' })));
// The Engineering Brain task list must escape every task field it shows.
const a = html.indexOf("else if(_ebActiveSub==='tasks'){"), b = html.indexOf('const _v2chip=', a), blk = html.slice(a, b);
for (const raw of ['${t.problem', '${t.affected_engine}', '${t.expected_result}', '${t.acceptance_criteria}', '${k.title}', "${t.id}'", '${t.priority.toUpperCase()}'])
  ok(`task list never inserts ${raw} raw`, !blk.includes(raw));
ok('task list shows the lifecycle chip', blk.includes('${_engLifecycleChip(t)}'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
