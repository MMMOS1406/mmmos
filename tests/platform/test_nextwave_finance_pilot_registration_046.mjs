// Order 046 — NextWave Finance Pilot registration and isolation. Real api/ops.js against the in-memory stand-in.
// Run: node tests/platform/test_nextwave_finance_pilot_registration_046.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, github, call, ceoToken, makeOk, sha, randomUUID, GITHUB_REPO } from './engineering-harness.mjs';
const T = makeOk(); const ok = T.ok;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'api', 'ops.js'), 'utf8');
db.mmm_platform_flags.push({ flag: 'eng_runner', enabled: true }, { flag: 'eng_adviser_connect', enabled: true });
delete process.env.ANTHROPIC_API_KEY;
const CEO = ceoToken();
const WORKER = '5'.repeat(64);
db.engineering_workers.push({ id: randomUUID(), label: 'Runner Worker', credential_hash: sha(WORKER), active: true });
const W = { worker_credential: WORKER };
const ADV = '6'.repeat(64);
db.engineering_advisers.push({ id: randomUUID(), label: 'ChatGPT', credential_hash: sha(ADV), active: true });
const A = { headers: { authorization: `Bearer ${ADV}` } };

// Registration itself
ok('business key nextwave_finance_pilot is registered', /const ENG_BUSINESSES = \[[^\]]*'nextwave_finance_pilot'/.test(src));
ok('NextWave V2 key "nextwave" keeps exactly its V2 folders', src.includes("nextwave: ['lib/nextwaveV2', 'nextwave_v2_storyboard_eval/', 'test_nextwave'],"));
ok('the pilot has only its own three folders', src.includes("nextwave_finance_pilot: ['projects/nextwave-finance-pilot/', 'tests/projects/nextwave-finance-pilot/', 'docs/projects/nextwave-finance-pilot/'],"));
const cfg = JSON.parse(readFileSync(join(root, 'projects', 'nextwave-finance-pilot', 'pilot.config.json'), 'utf8'));
ok('pilot config: own key, paid generation and publishing disabled', cfg.business_key === 'nextwave_finance_pilot' && cfg.paid_generation.enabled === false && cfg.publishing.enabled === false);

// Adviser submit, CEO authorization, runner scope
let r = await call('engineering_adviser_submit_task', { problem: 'Pilot scaffold', expected_result: 'x', authorization_boundary: 'Only the pilot folders. Branch + PR only.', business: 'nextwave_finance_pilot', priority: 'P3' }, A);
const pid = r.body.task_id;
const pt = db.engineering_tasks.find(t => t.id === pid);
ok('the adviser can file a task for the pilot business', r.status === 200 && pt && pt.packet.business === 'nextwave_finance_pilot', JSON.stringify(r.body).slice(0, 160));
r = await call('engineering_task_ceo_authorize_agent', { id: pid, runner_eligible: true, ceo_session_token: CEO });
const scope = db.engineering_tasks.find(t => t.id === pid).agent_capability_scope.runner;
ok('runner scope for a pilot task is only the pilot folders', r.status === 200 && JSON.stringify(scope.path_prefixes) === JSON.stringify(cfg.engineering.runner_folders), JSON.stringify(scope));
const c = await call('engineering_worker_claim_task', { ...W, task_id: pid, mode: 'runner' });
const gw = (op, extra = {}) => call('engineering_agent_gateway', { ...W, task_id: pid, agent_run_id: c.body.run_id, op, ...extra });
const id8 = pid.slice(0, 8);
const pr = (n, files) => { github.branches.set(`runner/${id8}-${n}`, { files, commits: [String(n).padEnd(40, '0').slice(0, 40)], pr: { number: 600 + n } }); return gw('submit_pull_request', { pr_url: `https://github.com/${GITHUB_REPO}/pull/${600 + n}`, branch: `runner/${id8}-${n}` }); };
r = await pr(1, ['projects/nextwave-finance-pilot/scenes.json', 'tests/projects/nextwave-finance-pilot/a.test.mjs']);
ok('a pilot PR inside the pilot folders is accepted', r.status === 200 && r.body.within_allowlist === true, JSON.stringify(r.body).slice(0, 160));
r = await pr(2, ['projects/nextwave-finance-pilot/a.json', 'lib/nextwaveV2Renderer/core.mjs']);
ok('a pilot PR touching NextWave V2 code is refused', r.status === 409 && r.body.outside.includes('lib/nextwaveV2Renderer/core.mjs'));
r = await pr(3, ['projects/nextwave-finance-pilot/a.json', 'test_nextwave_v2_production_route.mjs']);
ok('a pilot PR touching NextWave V2 tests is refused', r.status === 409);
r = await pr(4, ['projects/nextwave-finance-pilot/a.json', 'lib/srvFarsi/x.mjs', 'api/ops.js']);
ok('a pilot PR touching another business or the shared server file is refused', r.status === 409 && r.body.outside.includes('lib/srvFarsi/x.mjs') && r.body.outside.includes('api/ops.js'));

// Artifact storage is separate
r = await gw('create_artifact_upload', { file_name: 'storyboard.json' });
ok('pilot artifacts are stored under nextwave_finance_pilot/<task>/<run>/', r.status === 200 && r.body.object_path.startsWith(`nextwave_finance_pilot/${pid}/`), r.body.object_path);

// A NextWave V2 task cannot reach the pilot
r = await call('engineering_adviser_submit_task', { problem: 'V2 work', expected_result: 'x', authorization_boundary: 'V2 only.', business: 'nextwave', priority: 'P3' }, A);
const vid = r.body.task_id;
await call('engineering_task_ceo_authorize_agent', { id: vid, runner_eligible: true, ceo_session_token: CEO });
const vc = await call('engineering_worker_claim_task', { ...W, task_id: vid, mode: 'runner' });
const v8 = vid.slice(0, 8);
github.branches.set(`runner/${v8}-x`, { files: ['lib/nextwaveV2Renderer/a.mjs', 'projects/nextwave-finance-pilot/scenes.json'], commits: ['7'.repeat(40)], pr: { number: 700 } });
r = await call('engineering_agent_gateway', { ...W, task_id: vid, agent_run_id: vc.body.run_id, op: 'submit_pull_request', pr_url: `https://github.com/${GITHUB_REPO}/pull/700`, branch: `runner/${v8}-x` });
ok('a NextWave V2 task touching pilot folders is refused', r.status === 409 && r.body.outside.includes('projects/nextwave-finance-pilot/scenes.json'));
const va = await call('engineering_agent_gateway', { ...W, task_id: vid, agent_run_id: vc.body.run_id, op: 'create_artifact_upload', file_name: 'a.txt' });
ok('NextWave V2 artifacts stay under nextwave/, never under the pilot prefix', va.status === 200 && va.body.object_path.startsWith(`nextwave/${vid}/`));

// Task Generator keeps the pilot key; "NextWave" engine labels never map to the pilot
r = await call('engineering_task_create_from_decision', { decision_text: 'Decision: prepare the first storyboard outline (business: nextwave_finance_pilot). Docs only.', ceo_session_token: CEO });
const gt = db.engineering_tasks.find(t => t.id === r.body.task?.id);
ok('a CEO decision naming the pilot stores business nextwave_finance_pilot', r.status === 200 && gt && gt.packet.business === 'nextwave_finance_pilot');
const slug = new Function(src.slice(src.indexOf('const ENG_BUSINESSES'), src.indexOf(';', src.indexOf('const ENG_BUSINESSES')) + 1) + src.slice(src.indexOf('function _engBusinessSlug('), src.indexOf('function _engTaskBusiness(')) + 'return _engBusinessSlug;')();
ok('engine label "NextWave" stays nextwave (V2); "NextWave Finance Pilot" maps to the pilot', slug('NextWave') === 'nextwave' && slug('NextWave Finance Pilot') === 'nextwave_finance_pilot' && slug('NextWave Systems') === null);

// Adviser schema advertises the new business
r = await call('engineering_adviser_openapi', {}, A);
ok('the adviser schema lists the pilot as a business', JSON.stringify(r.body).includes('nextwave_finance_pilot'));
// UI label
const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
ok('Engineering screens label the pilot "NextWave Finance Pilot"', html.includes("nextwave_finance_pilot:'NextWave Finance Pilot'") && html.includes('_engBusinessLabel(p.business'));
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
