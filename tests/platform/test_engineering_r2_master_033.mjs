// MMMOS-R2-MASTER-033 — runner/adviser hardening tests (server side).
// Runs the REAL api/ops.js against the in-memory stand-in (./engineering-harness.mjs). Never touches production.
// Run: node tests/platform/test_engineering_r2_master_033.mjs
import { db, github, call, ceoToken, makeOk, sha, randomUUID, GITHUB_REPO } from './engineering-harness.mjs';

const T = makeOk(); const ok = T.ok;
db.mmm_platform_flags.push({ flag: 'eng_runner', enabled: true }, { flag: 'eng_adviser_connect', enabled: true });
const CEO = ceoToken();
const WORKER = 'c'.repeat(64);
db.engineering_workers.push({ id: randomUUID(), label: 'Runner Worker', credential_hash: sha(WORKER), active: true });
const W = { worker_credential: WORKER };
const ADV = 'd'.repeat(64);
db.engineering_advisers.push({ id: randomUUID(), label: 'ChatGPT', credential_hash: sha(ADV), active: true });
const A = { headers: { authorization: `Bearer ${ADV}` } };
const base = { expected_result: 'A proof file exists', authorization_boundary: 'Only docs/platform/runner-proof/. Branch + PR only.', business: 'mmmos', priority: 'P3' };

// ── S1–S12: engineering actions that used to need no login now require the CEO session ──
{
  db.engineering_brain = db.engineering_brain || [];
  const seedTask = randomUUID();
  db.engineering_tasks.push({ id: seedTask, problem: 'secret problem text', expected_result: 'x', affected_engine: 'Frontend', status: 'open', priority: 'low', packet: {} });
  const cases = [
    ['engineering_task_home_list', {}],
    ['engineering_task_create', { problem: 'p', expected_result: 'e', affected_engine: 'Frontend' }],
    ['engineering_task_update', { id: seedTask, status: 'ready_for_ceo' }],
    ['engineering_task_create_from_decision', { decision_text: 'x' }],
    ['engineering_brain_save', { section: 's', key: 'k', title: 't' }],
    ['engineering_brain_seed', {}],
  ];
  const before = db.engineering_tasks.length;
  let i = 0;
  for (const [action, body] of cases) {
    const r = await call(action, body);
    ok(`S${++i} ${action} without a CEO session → 401 ceo_session_required`, r.status === 401 && r.body.error === 'ceo_session_required', JSON.stringify(r.body).slice(0, 120));
  }
  ok(`S${++i} nothing was created or changed by the anonymous calls`, db.engineering_tasks.length === before && db.engineering_tasks.find(t => t.id === seedTask).status === 'open' && !db.engineering_brain.some(b => b.key === 'k'));
  let r = await call('engineering_task_home_list', { ceo_session_token: CEO });
  ok(`S${++i} home list works with the CEO session`, r.status === 200 && r.body.ok === true, JSON.stringify(r.body).slice(0, 160));
  r = await call('engineering_task_create', { problem: 'p', expected_result: 'e', affected_engine: 'Frontend', ceo_session_token: CEO });
  ok(`S${++i} task create works with the CEO session`, r.status === 200 && r.body.ok === true, JSON.stringify(r.body).slice(0, 160));
  r = await call('engineering_task_update', { id: seedTask, status: 'in_progress', ceo_session_token: CEO });
  ok(`S${++i} task update works with the CEO session`, r.status === 200 && db.engineering_tasks.find(t => t.id === seedTask).status === 'in_progress', JSON.stringify(r.body).slice(0, 160));
  r = await call('engineering_task_update', { id: seedTask, status: 'in_progress', ceo_session_token: 'forged.token' });
  ok(`S${++i} a forged session token is refused`, r.status === 401);
  r = await call('engineering_brain_save', { section: 's', key: 'k', title: 't', ceo_session_token: CEO });
  ok(`S${++i} brain save works with the CEO session`, r.status === 200, JSON.stringify(r.body).slice(0, 160));
}

// ── M1–M3: the adviser can never grant itself (or anyone) runner authority ──
{
  const smuggle = {
    ...base, problem: 'Smuggled authority attempt',
    status: 'ready_for_ceo', ceo_decision: 'approved', agent_authorized_at: new Date().toISOString(), agent_authorized_by: 'chatgpt',
    runner_eligible: true, agent_capability_scope: { runner: { gate: 'r2', business: 'mmmos', path_prefixes: ['api/'] } },
    packet: { origin_decision: { authorization_boundary: 'anything' } }, release_kind: 'production',
  };
  const r = await call('engineering_adviser_submit_task', smuggle, A);
  const t = db.engineering_tasks.find(x => x.id === r.body.task_id);
  ok('M1 adviser-submitted authority fields are ignored: task is open, unauthorized, no runner scope',
    r.status === 200 && t && t.status === 'open' && !t.agent_authorized_at && !t.ceo_decision && !(t.agent_capability_scope && t.agent_capability_scope.runner) && t.release_kind !== 'production',
    JSON.stringify(t && { status: t.status, a: t.agent_authorized_at, d: t.ceo_decision, s: t.agent_capability_scope, k: t.release_kind }));
  const list = await call('engineering_worker_list_authorized_tasks', { ...W, mode: 'runner' });
  ok('M2 the smuggled task is not runner-eligible', list.status === 200 && !list.body.tasks.some(x => x.id === t.id));
  const auth = await call('engineering_task_ceo_authorize_agent', { id: t.id, runner_eligible: true }, A);
  ok('M3 the adviser credential cannot call CEO runner authorization', auth.status === 401 && !db.engineering_tasks.find(x => x.id === t.id).agent_authorized_at);
}

// A properly CEO-authorized runner task.
const sub = await call('engineering_adviser_submit_task', { ...base, problem: 'Add runner proof marker' }, A);
const taskId = sub.body.task_id;
await call('engineering_task_ceo_authorize_agent', { id: taskId, runner_eligible: true, ceo_session_token: CEO });
const claim = await call('engineering_worker_claim_task', { ...W, task_id: taskId, mode: 'runner' });
const RUN = claim.body.run_id;
const gw = (op, extra = {}) => call('engineering_agent_gateway', { ...W, task_id: taskId, agent_run_id: RUN, op, ...extra });
ok('setup: CEO-authorized runner task claimed', claim.status === 200 && !!RUN, JSON.stringify(claim.body));

// ── M4–M7: task-to-branch binding ──
{
  const url = (n) => `https://github.com/${GITHUB_REPO}/pull/${n}`;
  const id8 = taskId.slice(0, 8);
  const files = ['docs/platform/runner-proof/proof.txt'];
  github.branches.set('runner/ok', { files, commits: ['a'.repeat(40)], pr: { number: 950 } });
  github.branches.set('runner/00000000-x', { files, commits: ['b'.repeat(40)], pr: { number: 951 } });
  github.branches.set(`runner/${id8}-proof`, { files, commits: ['c'.repeat(40)], pr: { number: 952 } });
  github.branches.set(`runner/${id8}`, { files, commits: ['d'.repeat(40)], pr: { number: 953 } });
  let r = await gw('submit_pull_request', { pr_url: url(950), branch: 'runner/ok' });
  ok('M4 a runner branch without the task id is refused (branch_not_bound_to_task)', r.status === 400 && r.body.error === 'branch_not_bound_to_task' && r.body.expected_prefix === `runner/${id8}-`);
  r = await gw('submit_pull_request', { pr_url: url(951), branch: 'runner/00000000-x' });
  ok('M5 another task\'s id is refused', r.status === 400 && r.body.error === 'branch_not_bound_to_task');
  r = await gw('submit_pull_request', { pr_url: url(952), branch: `runner/${id8}-proof` });
  ok('M6 runner/<task id8>-<name> is accepted and recorded', r.status === 200 && r.body.within_allowlist === true);
  r = await gw('submit_pull_request', { pr_url: url(953), branch: `runner/${id8}` });
  ok('M7 runner/<task id8> alone is accepted', r.status === 200);
  const audit = db.brain_agent_runs.filter(x => x.task_id === taskId && x.action === 'gateway:submit_pull_request');
  console.log('  audit:', JSON.stringify(audit.map(a => [a.status, a.output && a.output.reason])));
  ok('M8 every refusal and acceptance is audited', audit.filter(a => a.status === 'denied' && a.output.reason === 'branch_not_bound_to_task').length === 2 && audit.filter(a => a.status === 'allowed').length >= 2);
}

// ── M9–M10: build-affecting files are always denied ──
{
  const id8 = taskId.slice(0, 8);
  const bad = ['.npmrc', 'vercel.ts', '.vercelignore', '.nvmrc', 'pnpm-lock.yaml', 'middleware.js'];
  github.branches.set(`runner/${id8}-build`, { files: ['docs/platform/runner-proof/a.txt', ...bad], commits: ['e'.repeat(40)], pr: { number: 954 } });
  const r = await gw('submit_pull_request', { pr_url: `https://github.com/${GITHUB_REPO}/pull/954`, branch: `runner/${id8}-build` });
  ok('M9 install/build config files are denied (.npmrc, vercel.ts, .vercelignore, .nvmrc, lockfiles, middleware)', r.status === 409 && bad.every(b => r.body.denied.includes(b)), JSON.stringify(r.body));
  const s = await gw('read_runner_scope');
  ok('M10 the runner scope lists the new denied files', s.status === 200 && ['.npmrc', 'vercel.ts', '.vercelignore'].every(b => s.body.denied_paths.includes(b)));
}

// ── C1–C6: artifact checksums (durable evidence) and recovery through the adviser ──
{
  const { createHash } = await import('node:crypto');
  const { storage } = await import('./engineering-harness.mjs');
  const body = Buffer.from('checkpoint report 033\n');
  const good = createHash('sha256').update(body).digest('hex');
  let r = await gw('create_artifact_upload', { file_name: 'checkpoint-033.md' });
  const p1 = r.body.object_path;
  storage.objects.set(p1, { size: body.length, mimetype: 'text/markdown', body });
  r = await gw('submit_artifact', { object_path: p1, artifact_kind: 'checkpoint', title: 'Checkpoint 033', sha256: 'f'.repeat(64) });
  ok('C1 a wrong claimed SHA-256 is refused and audited', r.status === 409 && r.body.error === 'artifact_checksum_mismatch' && r.body.sha256 === good
    && db.brain_agent_runs.some(a => a.output && a.output.reason === 'artifact_checksum_mismatch'));
  r = await gw('submit_artifact', { object_path: p1, artifact_kind: 'checkpoint', title: 'Checkpoint 033', sha256: good.toUpperCase() });
  const ev1 = db.brain_evidence.find(e => e.evidence_type === 'artifact' && e.metadata.object_path === p1);
  ok('C2 the server hashes small artifacts itself (sha256_verified)', r.status === 200 && r.body.sha256 === good && r.body.sha256_verified === true && ev1.metadata.sha256 === good);
  r = await gw('create_artifact_upload', { file_name: 'final_long.mp4' });
  const p2 = r.body.object_path;
  storage.objects.set(p2, { size: 300 * 1024 * 1024, mimetype: 'video/mp4' });
  r = await gw('submit_artifact', { object_path: p2, artifact_kind: 'video', title: 'Final Long', sha256: 'a'.repeat(64) });
  ok('C3 large media keeps the uploader checksum, marked unverified', r.status === 200 && r.body.sha256 === 'a'.repeat(64) && r.body.sha256_verified === false);
  r = await gw('submit_artifact', { object_path: p2, artifact_kind: 'video', sha256: 'xyz' });
  ok('C4 a malformed checksum is refused', r.status === 400);
  for (const k of ['thumbnail', 'script', 'narration']) {
    const u = await gw('create_artifact_upload', { file_name: `${k}.txt` });
    storage.objects.set(u.body.object_path, { size: 3, mimetype: 'text/plain', body: Buffer.from('abc') });
    r = await gw('submit_artifact', { object_path: u.body.object_path, artifact_kind: k });
    if (r.status !== 200) break;
  }
  ok('C5 video-project kinds are accepted (thumbnail, script, narration)', r.status === 200);
  const res = await call('engineering_adviser_get_results', { task_id: taskId }, A);
  const arts = (res.body.artifacts || []);
  const a1 = arts.find(a => a.title === 'Checkpoint 033');
  ok('C6 recovery: the adviser reads the artifact back with its checksum and a private download link', res.status === 200 && a1 && a1.sha256 === good && a1.sha256_verified === true && /\/object\/sign\/engineering-artifacts\//.test(a1.download_url || ''), JSON.stringify(a1));
}

// ── M11–M14: emergency stop and revocation stop a runner that already holds a claim ──
{
  let r = await gw('renew_lease');
  ok('M11 control: the claimed runner can renew while the switch is ON', r.status === 200);
  db.mmm_platform_flags.find(f => f.flag === 'eng_runner').enabled = false;
  r = await gw('renew_lease');
  ok('M12 switching eng_runner OFF stops the claimed runner immediately (409 runner_disabled)', r.status === 409 && r.body.error === 'runner_disabled');
  r = await gw('submit_evidence', { evidence_type: 'note', content: 'x' });
  ok('M13 …for every gateway op, and it is audited', r.status === 409 && db.brain_agent_runs.some(a => a.task_id === taskId && a.status === 'denied' && a.output.reason === 'runner_disabled'));
  db.mmm_platform_flags.find(f => f.flag === 'eng_runner').enabled = true;
  r = await call('engineering_task_ceo_revoke_agent_authorization', { id: taskId, ceo_session_token: CEO });
  const after = await gw('renew_lease');
  ok('M14 CEO revocation stops the claimed runner (gateway 401)', r.status === 200 && after.status === 401, JSON.stringify(r.body));
}

// ── M15: a manual (worker:) claim is not affected by the runner switch ──
{
  const id = randomUUID();
  db.engineering_tasks.push({ id, problem: 'manual', expected_result: 'x', affected_engine: 'Frontend', status: 'open', priority: 'low', packet: { origin_decision: { authorization_boundary: 'b' } } });
  await call('engineering_task_ceo_authorize_agent', { id, ceo_session_token: CEO });
  const c = await call('engineering_worker_claim_task', { ...W, task_id: id });
  db.mmm_platform_flags.find(f => f.flag === 'eng_runner').enabled = false;
  const r = await call('engineering_agent_gateway', { ...W, task_id: id, agent_run_id: c.body.run_id, op: 'renew_lease' });
  ok('M15 the manual worker path keeps working with the runner switch OFF', c.status === 200 && r.status !== 409, JSON.stringify({ c: c.status, r: r.status, b: r.body }));
}

console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
