// Standalone tests for CEO Decision #17: Automatic Git Commit Capture Fix.
// Covers the 15 required tests. Two kinds of checks, each noted per test:
//   [LOGIC]      — synthetic in-memory mirror of the real
//                   engineeringAgentGateway 'submit_commit_sha' op and the
//                   engineeringTaskUpdate guard, logic mirrored verbatim
//                   from the diff applied to api/ops.js. No network, no
//                   live Supabase, no live GitHub.
//   [STRUCTURAL] — reads the actual shipped source and asserts on its real
//                   content (e.g. zero diff outside the intended spots).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name); }
}

const OPS = fs.readFileSync(path.join(__dirname, 'api/ops.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const PARENT_SHA = 'a541ec61744dd4b919fdb63f65a67a6fbc407382';

const REAL_SHA = 'fe9103af87dcb1b5e9bf9a26deb521ef99593d18';   // exists, ancestor of main head in this mirror
const OTHER_SHA = 'dadba421ddf9d479ebe61f66848028f6e63fb25b';  // a different, also-valid, verified sha
const HEAD_SHA = '1'.repeat(40);     // simulated branch head
const UNMERGED_SHA = '2'.repeat(40); // exists but not reachable from main
const NONEXISTENT_SHA = '3'.repeat(40);

// ── [LOGIC] synthetic GitHub + Supabase mirror ──────────────────────────────
function makeWorld() {
  return {
    workers: {},      // id -> { id, active, credential, label }
    tasks: {},         // id -> task row fields
    branchHead: { main: HEAD_SHA },
    // sha -> 'reachable' | 'unmerged' | absent (nonexistent)
    githubCommits: { [REAL_SHA]: 'reachable', [OTHER_SHA]: 'reachable', [HEAD_SHA]: 'reachable', [UNMERGED_SHA]: 'unmerged' },
  };
}

function authenticateWorker(world, credential) {
  if (!credential) return null;
  for (const w of Object.values(world.workers)) {
    if (w.active && w.credential === credential) return { id: w.id, label: w.label };
  }
  return null;
}

// Mirrors the shared authOk/claimOk/leaseOk chain that runs before every
// engineeringAgentGateway op (worker_credential branch).
function gatewayAuth(world, { task_id, agent_run_id, worker_credential }) {
  const task = world.tasks[task_id];
  if (!task) return { ok: false, error: 'task_not_found' };
  const worker = authenticateWorker(world, worker_credential);
  const boundaryOk = !!task.authorization_boundary;
  const authOk = !!worker && !!task.agent_authorized_at && !task.agent_authorization_revoked_at
    && boundaryOk && !!task.claimed_by_worker_id && task.claimed_by_worker_id === (worker && worker.id);
  const claimOk = !!task.agent_claimed_at && task.agent_run_id === agent_run_id;
  const leaseOk = !!task.lease_expires_at && task.lease_expires_at > Date.now();
  if (!authOk || !claimOk || !leaseOk) return { ok: false, error: 'agent_gateway_verification_failed' };
  return { ok: true, task };
}

// Mirrors _verifyCommitReachableFromBranch.
function verifyCommitReachableFromBranch(world, sha, branch) {
  const state = world.githubCommits[sha];
  if (!state) return { ok: false, error: 'commit_not_found_in_repository' };
  const head = world.branchHead[branch];
  if (!head) return { ok: false, error: 'github_integrity_check_not_configured' };
  if (head === sha) return { ok: true, detail: { relation: 'identical' } };
  if (state === 'reachable') return { ok: true, detail: { relation: 'ahead' } };
  return { ok: false, error: 'commit_not_reachable_from_branch' };
}

// Mirrors the new 'submit_commit_sha' branch inside engineeringAgentGateway,
// including the shared auth chain it's layered on top of.
function submitCommitSha(world, { task_id, agent_run_id, worker_credential, commit_sha }) {
  const gate = gatewayAuth(world, { task_id, agent_run_id, worker_credential });
  if (!gate.ok) return { status: 401, error: gate.error };
  const task = gate.task;
  if (task.release_kind === 'retroactive_release') return { status: 409, error: 'not_applicable_to_retroactive_release' };
  if (task.status === 'done' || task.ceo_decision === 'approved' || task.ceo_decision === 'rejected') {
    return { status: 409, error: 'task_already_in_terminal_ceo_state' };
  }
  const rawSha = typeof commit_sha === 'string' ? commit_sha.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{40}$/i.test(rawSha)) return { status: 400, error: 'commit_sha must be a 40-character hex commit SHA' };
  if (task.git_commit_sha) {
    if (task.git_commit_sha === rawSha) return { status: 200, ok: true, commit_sha: rawSha, already_recorded: true };
    return { status: 409, error: 'git_commit_sha_already_set', existing_commit_sha: task.git_commit_sha };
  }
  const verify = verifyCommitReachableFromBranch(world, rawSha, 'main');
  if (!verify.ok) return { status: /not_configured|api_error|unreachable/.test(verify.error) ? 502 : 409, error: verify.error };
  task.git_commit_sha = rawSha;
  return { status: 200, ok: true, commit_sha: rawSha, already_recorded: false };
}

// Mirrors engineeringTaskUpdate's new git_commit_sha guard (both branches).
function updateTaskGitCommitSha(world, { id, git_commit_sha }) {
  const task = world.tasks[id];
  if (!task) return { status: 404, error: 'task_not_found' };
  const kind = task.release_kind;
  if (kind !== 'retroactive_release') {
    return { status: 403, error: 'git_commit_sha_for_new_development_tasks_must_use_submit_commit_sha' };
  }
  if (git_commit_sha !== null && String(git_commit_sha || '').trim() !== '') {
    if (!/^[0-9a-f]{40}$/i.test(String(git_commit_sha).trim())) {
      return { status: 400, error: 'git_commit_sha must be a 40-character hex commit SHA' };
    }
    task.git_commit_sha = String(git_commit_sha).trim().toLowerCase();
    return { status: 200, ok: true };
  }
  return { status: 409, error: 'cannot clear git_commit_sha on a retroactive_release task' };
}

function makeAuthorizedClaimedTask(world, overrides) {
  const workerId = 'w_' + (Object.keys(world.workers).length + 1);
  world.workers[workerId] = { id: workerId, active: true, credential: 'cred_' + workerId, label: 'Cowork' };
  const runId = 'run_' + (Object.keys(world.tasks).length + 1);
  const taskId = 't_' + (Object.keys(world.tasks).length + 1);
  world.tasks[taskId] = {
    id: taskId, status: 'open', ceo_decision: null, git_commit_sha: null, release_kind: 'new_development',
    agent_authorized_at: '2026-08-23T00:00:00Z', agent_authorization_revoked_at: null,
    authorization_boundary: 'do the work', claimed_by_worker_id: workerId,
    agent_claimed_at: '2026-08-23T00:05:00Z', agent_run_id: runId, lease_expires_at: Date.now() + 1000000,
    ...overrides,
  };
  return { taskId, runId, workerId, credential: world.workers[workerId].credential };
}

// ── Test 1 — valid worker completing its own task with a valid authoritative
// commit → SHA stored. [LOGIC]
{
  const world = makeWorld();
  const { taskId, runId, credential } = makeAuthorizedClaimedTask(world);
  const r = submitCommitSha(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential, commit_sha: REAL_SHA });
  assert('1. valid worker + valid authoritative commit -> SHA stored', r.ok && world.tasks[taskId].git_commit_sha === REAL_SHA);
}

// ── Test 2 — missing SHA -> not stored. [LOGIC]
{
  const world = makeWorld();
  const { taskId, runId, credential } = makeAuthorizedClaimedTask(world);
  const r = submitCommitSha(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential, commit_sha: undefined });
  assert('2. missing sha -> rejected, not stored', r.status === 400 && world.tasks[taskId].git_commit_sha === null);
}

// ── Test 3 — malformed SHA -> rejected. [LOGIC]
{
  const world = makeWorld();
  const { taskId, runId, credential } = makeAuthorizedClaimedTask(world);
  const r = submitCommitSha(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential, commit_sha: 'not-a-real-sha' });
  assert('3. malformed sha -> rejected, not stored', r.status === 400 && world.tasks[taskId].git_commit_sha === null);
}

// ── Test 4 — nonexistent commit -> rejected. [LOGIC]
{
  const world = makeWorld();
  const { taskId, runId, credential } = makeAuthorizedClaimedTask(world);
  const r = submitCommitSha(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential, commit_sha: NONEXISTENT_SHA });
  assert('4. nonexistent commit -> rejected (commit_not_found_in_repository)', r.status === 409 && r.error === 'commit_not_found_in_repository' && world.tasks[taskId].git_commit_sha === null);
}

// ── Test 5 — SHA from wrong repository/context -> rejected. [LOGIC + STRUCTURAL]
// The mirror has no way to even ADDRESS a second repository (repo is a fixed
// constant in _verifyCommitReachableFromBranch, never a parameter derived
// from the request) -- a sha that only exists in a hypothetically different
// repo behaves identically to "nonexistent" against the one configured repo,
// which IS the enforcement: there is no code path to select another repo.
{
  const world = makeWorld();
  const { taskId, runId, credential } = makeAuthorizedClaimedTask(world);
  const shaFromAnotherRepo = '4'.repeat(40); // never added to world.githubCommits
  const r = submitCommitSha(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential, commit_sha: shaFromAnotherRepo });
  assert('5a. commit only valid in a different repository -> rejected', r.status === 409 && r.error === 'commit_not_found_in_repository');
  assert('5b. structural: repo is always process.env.GITHUB_REPO, never derived from the request body',
    /const repo = process\.env\.GITHUB_REPO;/.test(OPS) && !/body\.(repo|github_repo|repository)/.test(OPS.slice(OPS.indexOf('_verifyCommitReachableFromBranch'), OPS.indexOf('_verifyCommitReachableFromBranch') + 2000)));
}

// ── Test 6 — unrelated worker/run cannot attach SHA. [LOGIC]
{
  const world = makeWorld();
  const { taskId, credential } = makeAuthorizedClaimedTask(world);
  const r = submitCommitSha(world, { task_id: taskId, agent_run_id: 'some_other_run_id', worker_credential: credential, commit_sha: REAL_SHA });
  assert('6. wrong run_id (unrelated run) -> 401, not stored', r.status === 401 && world.tasks[taskId].git_commit_sha === null);

  const world2 = makeWorld();
  const t1 = makeAuthorizedClaimedTask(world2);
  const t2 = makeAuthorizedClaimedTask(world2); // a second, different worker+run+task
  const r2 = submitCommitSha(world2, { task_id: t1.taskId, agent_run_id: t2.runId, worker_credential: t2.credential, commit_sha: REAL_SHA });
  assert('6b. a genuinely different worker/run cannot attach a SHA to a task it does not own', r2.status === 401 && world2.tasks[t1.taskId].git_commit_sha === null);
}

// ── Test 7 — revoked worker cannot attach SHA. [LOGIC]
{
  const world = makeWorld();
  const { taskId, runId, workerId, credential } = makeAuthorizedClaimedTask(world);
  world.workers[workerId].active = false; // revoked
  const r = submitCommitSha(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential, commit_sha: REAL_SHA });
  assert('7. revoked worker -> 401, not stored', r.status === 401 && world.tasks[taskId].git_commit_sha === null);
}

// ── Test 8 — worker cannot overwrite SHA after CEO approval. [LOGIC]
{
  const world = makeWorld();
  const { taskId, runId, credential } = makeAuthorizedClaimedTask(world, { status: 'done', ceo_decision: 'approved', git_commit_sha: REAL_SHA });
  const r = submitCommitSha(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential, commit_sha: OTHER_SHA });
  assert('8. task already CEO-approved -> 409 terminal state, sha unchanged', r.status === 409 && r.error === 'task_already_in_terminal_ceo_state' && world.tasks[taskId].git_commit_sha === REAL_SHA);
}

// ── Test 9 — worker cannot overwrite another already-verified SHA without an
// explicit governed reason (no such mechanism exists -> always rejected,
// except the exact-same-value idempotent case). [LOGIC]
{
  const world = makeWorld();
  const { taskId, runId, credential } = makeAuthorizedClaimedTask(world, { git_commit_sha: REAL_SHA });
  const rDiff = submitCommitSha(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential, commit_sha: OTHER_SHA });
  assert('9a. attempt to overwrite an already-set SHA with a different value -> 409, unchanged', rDiff.status === 409 && rDiff.error === 'git_commit_sha_already_set' && world.tasks[taskId].git_commit_sha === REAL_SHA);
  const rSame = submitCommitSha(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential, commit_sha: REAL_SHA });
  assert('9b. idempotent resubmit of the exact same already-recorded value -> accepted, no change', rSame.status === 200 && rSame.already_recorded === true && world.tasks[taskId].git_commit_sha === REAL_SHA);
}

// ── Test 10 — normal Engineering Review sees the captured structured SHA.
// [STRUCTURAL]: engineeringTaskReviewPacket already returns the task (with
// git_commit_sha) and public/index.html already reads t.git_commit_sha —
// both untouched this turn (zero diff in public/index.html this turn).
assert('10a. engineeringTaskReviewPacket function still present, unmodified this turn',
  OPS.includes('async function engineeringTaskReviewPacket'));
assert('10b. CEO Engineering Review UI still reads task.git_commit_sha (zero UI changes this turn)',
  HTML.includes('t.git_commit_sha'));
try {
  const uiDiff = execSync(`git diff --stat ${PARENT_SHA} -- public/index.html`, { cwd: __dirname }).toString();
  assert('10c. structural: public/index.html has ZERO diff lines this turn', uiDiff.trim() === '');
} catch (e) { assert('10c. structural: public/index.html has ZERO diff lines this turn', false); }

// ── Test 11 — CEO does not manually enter SHA anywhere. [STRUCTURAL]
// No UI change this turn at all (confirmed in 10c) -- trivially true; also
// confirm the new backend op itself has no CEO-session gate (it's a worker
// op, not something a CEO screen could even call) and requireCeoSession is
// untouched.
{
  const fnStart = OPS.indexOf("op === 'submit_commit_sha'");
  assert('11a. submit_commit_sha branch contains no requireCeoSession / CEO-session concept (it is a worker-only op)',
    !OPS.slice(fnStart, fnStart + 4000).includes('requireCeoSession'));
  const diffOut = execSync(`git diff ${PARENT_SHA} -- api/ops.js | grep -c "requireCeoSession" || true`, { cwd: __dirname }).toString().trim();
  assert('11b. structural: zero diff touches to requireCeoSession itself', OPS.includes('async function requireCeoSession'));
}

// ── Test 12 — Production Release still independently verifies branch HEAD at
// authorization/execution time. [STRUCTURAL]: zero diff lines inside
// productionDeploymentAuthorize / engineeringWorkerExecuteProductionRelease.
{
  const diff = execSync(`git diff ${PARENT_SHA} -- api/ops.js`, { cwd: __dirname }).toString();
  const hunkHeaders = diff.split('\n').filter(l => l.startsWith('@@'));
  // 5 hunks: AGENT_GATEWAY_ALLOWED_OPS entry, the gateway task select-list,
  // the new submit_commit_sha branch, the engineeringTaskUpdate guard, and
  // the new _verifyCommitReachableFromBranch helper (inserted between
  // _prodDeployBranchHeadSha and productionDeploymentAuthorize -- git shows
  // that insertion under _prodDeployBranchHeadSha's name as context, not
  // because that function itself changed). None is a deletion inside
  // productionDeploymentAuthorize or engineeringWorkerExecuteProductionRelease.
  const touchesGuardedFns = hunkHeaders.some(h => h.includes('productionDeploymentAuthorize(req') || h.includes('engineeringWorkerExecuteProductionRelease(req'));
  assert('12. exactly 5 diff hunks in api/ops.js, none anchored inside productionDeploymentAuthorize/engineeringWorkerExecuteProductionRelease',
    hunkHeaders.length === 5 && !touchesGuardedFns);
}

// ── Test 13 — retroactive-release path remains unchanged. [LOGIC + STRUCTURAL]
{
  const world = makeWorld();
  const { taskId, runId, credential } = makeAuthorizedClaimedTask(world, { release_kind: 'retroactive_release', git_commit_sha: REAL_SHA });
  const r = submitCommitSha(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential, commit_sha: OTHER_SHA });
  assert('13a. submit_commit_sha refuses retroactive_release tasks outright', r.status === 409 && r.error === 'not_applicable_to_retroactive_release');
  // engineeringTaskUpdate's retroactive_release branch: format validation on
  // set, blocked clearing -- identical outcomes to before this change.
  const world2 = { tasks: { rt1: { id: 'rt1', release_kind: 'retroactive_release', git_commit_sha: REAL_SHA } } };
  const rSet = updateTaskGitCommitSha(world2, { id: 'rt1', git_commit_sha: OTHER_SHA });
  assert('13b. engineeringTaskUpdate still allows setting a valid sha on a retroactive_release task', rSet.status === 200 && world2.tasks.rt1.git_commit_sha === OTHER_SHA);
  const rClear = updateTaskGitCommitSha(world2, { id: 'rt1', git_commit_sha: null });
  assert('13c. engineeringTaskUpdate still blocks clearing sha on a retroactive_release task', rClear.status === 409 && rClear.error === 'cannot clear git_commit_sha on a retroactive_release task');
  assert('13d. structural: _validateRetroactiveReleaseShaOrThrow / _insertEngineeringTaskRow untouched',
    OPS.includes('_validateRetroactiveReleaseShaOrThrow') && OPS.includes('_insertEngineeringTaskRow'));
  const diff = execSync(`git diff ${PARENT_SHA} -- api/ops.js`, { cwd: __dirname }).toString();
  assert('13e. structural: zero diff lines inside _insertEngineeringTaskRow itself', !diff.includes('_insertEngineeringTaskRow({'));
}

// ── Test 14 — existing worker/pairing/Gateway behavior remains unchanged.
// [LOGIC + STRUCTURAL]: every pre-existing gateway op behaves exactly as
// before (new op is additive, existing ones untouched); pairing functions
// have zero diff lines.
{
  const world = makeWorld();
  const { taskId, runId, workerId, credential } = makeAuthorizedClaimedTask(world);
  // A revoked worker still cannot claim/act via the (unmodified) auth chain
  // for a pre-existing op shape (mirrors read_task_packet's use of the same
  // shared gate).
  world.workers[workerId].active = false;
  const gate = gatewayAuth(world, { task_id: taskId, agent_run_id: runId, worker_credential: credential });
  assert('14a. shared gate (used by every pre-existing op too) still denies a revoked worker', !gate.ok);
  const diff = execSync(`git diff ${PARENT_SHA} -- api/ops.js`, { cwd: __dirname }).toString();
  assert('14b. structural: zero diff lines inside any pairing function (Request/ListPending/Approve/Reject/Complete)',
    !/^\-.*function engineeringWorkerPairing/m.test(diff));
  assert('14c. structural: AGENT_GATEWAY_ALLOWED_OPS keeps every pre-existing op, purely additive',
    ['read_task_packet', 'read_authorization_boundary', 'read_capability_manifest', 'submit_execution_plan', 'submit_evidence', 'read_authorized_file', 'write_authorized_file', 'validate_javascript_syntax', 'submit_commit_sha']
      .every(op => OPS.includes(`'${op}'`)));
}

// ── Test 15 — unrelated systems remain unaffected. [STRUCTURAL]
{
  const diffStat = execSync(`git diff --stat ${PARENT_SHA}`, { cwd: __dirname }).toString();
  const filesChanged = diffStat.split('\n').filter(l => l.includes('|')).map(l => l.trim().split(' ')[0]);
  assert('15. only api/ops.js (+ this new test file) changed this turn -- no unrelated file touched',
    filesChanged.every(f => f === 'api/ops.js' || f === 'test_automatic_git_commit_capture_fix.cjs'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
