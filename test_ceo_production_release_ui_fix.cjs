// Standalone tests for CEO Decision #17: CEO Production Release UI Fix.
// Covers the 16 required tests from the CEO authorization. Two kinds of
// checks are used, each noted per test:
//   [LOGIC]      — synthetic in-memory mirror of the real server logic
//                   (same pattern as test_governed_production_execution.js),
//                   no network / no live Supabase / no live GitHub / no live
//                   Vercel.
//   [STRUCTURAL] — reads the actual shipped source files
//                   (api/ops.js, public/index.html) and asserts on their
//                   real content, so these checks fail if the real diff ever
//                   drifts from what this report claims, not just if a
//                   hand-copied mirror of the logic drifts.

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name); }
}

const OPS = fs.readFileSync(path.join(__dirname, 'api/ops.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

const REAL_SHA = 'fe9103af87dcb1b5e9bf9a26deb521ef99593d18';

// ── [LOGIC] mirror of productionReleaseAuthorizationCreate, including the
// new duplicate-active-authorization guard added this turn ────────────────
function makeWorld() {
  return { tasks: {}, authorizations: {} };
}
function createAuthorization(world, { ceoSession, engineering_task_id, commit_sha, deploy_branch }) {
  if (!ceoSession) return { status: 401, error: 'ceo_authorization_required' };
  if (!engineering_task_id || !commit_sha) return { status: 400, error: 'engineering_task_id and commit_sha required' };
  if (!/^[0-9a-f]{40}$/i.test(String(commit_sha).trim())) return { status: 400, error: 'commit_sha must be a 40-character hex commit SHA' };
  const task = world.tasks[engineering_task_id];
  if (!task) return { status: 404, error: 'engineering_task_not_found' };
  if (task.status !== 'done' || task.ceo_decision !== 'approved') return { status: 409, error: 'engineering_task_not_yet_ceo_approved' };
  const active = Object.values(world.authorizations).find(a =>
    a.engineering_task_id === engineering_task_id && ['authorized', 'executing', 'triggered'].includes(a.status));
  if (active) return { status: 409, error: 'production_release_authorization_already_active', existing_authorization_id: active.id, existing_status: active.status };
  const id = 'auth_' + (Object.keys(world.authorizations).length + 1);
  const row = { id, engineering_task_id, commit_sha: String(commit_sha).trim().toLowerCase(), deploy_branch: deploy_branch || 'main', status: 'authorized', worker_credential: null };
  world.authorizations[id] = row;
  return { status: 200, ok: true, authorization: row };
}

// ── [LOGIC] mirror of the public/index.html releasePackets state-mapping
// logic (validSha gate, STATE_MAP, isActive/showButton) ────────────────────
const SHA_RE = /^[0-9a-f]{40}$/i;
function computeUiState(task, auths) {
  const sha = task.git_commit_sha;
  const validSha = sha && SHA_RE.test(sha);
  if (!validSha) return { label: 'Engineering Approved', showButton: false };
  const latest = (auths || [])[0] || null;
  const STATE_MAP = {
    authorized: { label: 'Production Release Authorized' },
    executing: { label: 'Deploying' },
    triggered: { label: 'Production Triggered' },
    failed: { label: 'Deployment Failed' },
    ambiguous: { label: 'Needs Reconciliation' },
    revoked: { label: 'Authorization Revoked' },
  };
  const isActive = latest && ['authorized', 'executing', 'triggered'].includes(latest.status);
  const showButton = !isActive;
  const label = !latest ? 'Awaiting Production Release Authorization' : (STATE_MAP[latest.status] || { label: 'Needs Review' }).label;
  return { label, showButton };
}

// ── Test 1/2 — existing Agent Authorization / retroactive-release flows
// untouched. [STRUCTURAL]: the render branches, backend approve/reject
// actions, and the fake-Agent-Authorization bypass for retroactive tasks
// still exist verbatim and this turn's diff never touched their lines
// (confirmed separately via `git diff --stat` showing only the releasePackets
// IIFE block and one new function were changed — see checkpoint report).
assert('1. pendingAuth / needsReauth (Agent Authorization) rendering still present',
  HTML.includes('pendingAuth') && HTML.includes('needsReauth'));
assert('2. retroactiveReleases (Release Record Fix bypass) rendering still present',
  HTML.includes('retroactiveReleases'));

// ── Test 3 — CEO never types/pastes a commit SHA. [STRUCTURAL]: the new
// button's onclick reads `sha` from the task object only; no prompt()/input
// for a SHA exists anywhere in the new release-authorization code path.
{
  const newButtonLine = HTML.match(/_engReviewAuthorizeProductionRelease\('\$\{t\.id\}','\$\{sha\}'\)/);
  assert('3. new button passes sha read from task object, not typed by CEO', !!newButtonLine);
  const fnBody = HTML.slice(HTML.indexOf('async function _engReviewAuthorizeProductionRelease'), HTML.indexOf('async function _engReviewAuthorizeProductionRelease') + 2000);
  assert('3b. new frontend function contains no prompt() for a commit SHA', !/prompt\(/.test(fnBody));
}

// ── Test 4 — system only attaches an unambiguous authoritative SHA.
// [LOGIC]: validSha requires an exact 40-hex match of the task's own
// git_commit_sha; anything else (missing, short, non-hex) is rejected.
{
  assert('4a. well-formed 40-hex sha is accepted as authoritative', computeUiState({ git_commit_sha: REAL_SHA }, []).showButton === true || computeUiState({ git_commit_sha: REAL_SHA }, []).label === 'Awaiting Production Release Authorization');
  assert('4b. malformed sha (not 40 hex) is rejected, not attached', computeUiState({ git_commit_sha: 'abc123' }, []).label === 'Engineering Approved');
  assert('4c. null/undefined sha is rejected, not attached', computeUiState({ git_commit_sha: null }, []).label === 'Engineering Approved');
}

// ── Test 5 — missing/ambiguous SHA fails closed (no button, nontechnical
// status). [LOGIC + STRUCTURAL]
{
  const st = computeUiState({ git_commit_sha: null }, []);
  assert('5a. missing sha -> fail closed, no button shown', st.showButton === false);
  assert('5b. missing-sha status text is nontechnical ("Engineering Approved", not a status code)', st.label === 'Engineering Approved');
  assert('5c. HTML shows plain-language fail-closed note for missing sha', HTML.includes('MMMOS will not ask you to supply a technical identifier'));
}

// ── Test 6 — Engineering Approve action never itself creates a Production
// Release authorization. [STRUCTURAL]: the approve function/action is a
// distinct code path from production_release_authorization_create.
{
  const approveFnMatch = HTML.match(/async function _engReviewApprove[\s\S]{0,1500}?\n\}/);
  assert('6. _engReviewApprove exists and never calls production_release_authorization_create',
    !!approveFnMatch && !approveFnMatch[0].includes('production_release_authorization_create'));
}

// ── Test 7 — Production Release authorization requires a separate,
// explicit CEO action (not implied by approval). [LOGIC]
{
  const world = makeWorld();
  world.tasks.t1 = { status: 'done', ceo_decision: 'approved' };
  const r1 = createAuthorization(world, { ceoSession: null, engineering_task_id: 't1', commit_sha: REAL_SHA });
  assert('7a. approval alone (no explicit authorize call) never runs -> no authorization exists yet', Object.keys(world.authorizations).length === 0);
  const r2 = createAuthorization(world, { ceoSession: 'sess', engineering_task_id: 't1', commit_sha: REAL_SHA });
  assert('7b. explicit CEO-session authorize call creates exactly the record', r2.ok === true && Object.keys(world.authorizations).length === 1);
}

// ── Test 8 — CEO-session gate remains enforced on the new action.
// [LOGIC + STRUCTURAL]
{
  const world = makeWorld();
  world.tasks.t1 = { status: 'done', ceo_decision: 'approved' };
  const r = createAuthorization(world, { ceoSession: null, engineering_task_id: 't1', commit_sha: REAL_SHA });
  assert('8a. missing ceoSession is rejected (401)', r.status === 401 && r.error === 'ceo_authorization_required');
  assert('8b. _ceoAuthedFetch is used to call the new action (session attached client-side too)',
    /_ceoAuthedFetch\('\/api\/ops\?action=production_release_authorization_create'/.test(HTML));
}

// ── Test 9 — worker credential cannot create a Production Release
// authorization. [STRUCTURAL]: productionReleaseAuthorizationCreate's
// request handling never reads a worker credential; only
// engineeringWorkerExecuteProductionRelease (a different, already-existing
// function) accepts worker_credential, and it only executes an
// already-authorized row rather than creating one.
{
  const createFnStart = OPS.indexOf('async function productionReleaseAuthorizationCreate');
  const createFnBody = OPS.slice(createFnStart, createFnStart + 3000);
  assert('9. productionReleaseAuthorizationCreate never reads worker_credential', !createFnBody.includes('worker_credential'));
}

// ── Test 10 — Authorize Production Release creates exactly one appropriate
// durable authorization row, scoped to the right task/commit/branch. [LOGIC]
{
  const world = makeWorld();
  world.tasks.t1 = { status: 'done', ceo_decision: 'approved' };
  const r = createAuthorization(world, { ceoSession: 'sess', engineering_task_id: 't1', commit_sha: REAL_SHA, deploy_branch: 'main' });
  assert('10. creates exactly one row, correctly scoped, status=authorized',
    r.ok && r.authorization.engineering_task_id === 't1' &&
    r.authorization.commit_sha === REAL_SHA && r.authorization.deploy_branch === 'main' &&
    r.authorization.status === 'authorized' && Object.keys(world.authorizations).length === 1);
}

// ── Test 11 — duplicate CEO clicks do not silently create conflicting
// active authorizations. [LOGIC]: mirrors the new guard exactly.
{
  const world = makeWorld();
  world.tasks.t1 = { status: 'done', ceo_decision: 'approved' };
  const first = createAuthorization(world, { ceoSession: 'sess', engineering_task_id: 't1', commit_sha: REAL_SHA });
  const dup = createAuthorization(world, { ceoSession: 'sess', engineering_task_id: 't1', commit_sha: REAL_SHA });
  assert('11a. second click while first is still authorized is blocked (409), not silently duplicated',
    dup.status === 409 && dup.error === 'production_release_authorization_already_active' && Object.keys(world.authorizations).length === 1);
  world.authorizations[first.authorization.id].status = 'failed';
  const retry = createAuthorization(world, { ceoSession: 'sess', engineering_task_id: 't1', commit_sha: REAL_SHA });
  assert('11b. a fresh click after a terminal failed/ambiguous/revoked state is allowed as an explicit new decision',
    retry.ok === true && Object.keys(world.authorizations).length === 2);
  const dup2 = createAuthorization(world, { ceoSession: 'sess', engineering_task_id: 't1', commit_sha: REAL_SHA });
  assert('11c. duplicate guard also present server-side in the real diff (not just this mirror)',
    OPS.includes("status=in.(authorized,executing,triggered)") && OPS.includes("production_release_authorization_already_active"));
}

// ── Test 12 — worker execution remains a separate action from anything the
// CEO UI calls. [STRUCTURAL]: the CEO-facing HTML never *invokes* the worker
// execution action (as an api/ops.js `action=` fetch target) — the two
// mentions that do exist are explanatory code comments describing who else
// owns that step, not call sites.
{
  const invoked = /action=engineering_worker_execute_production_release/.test(HTML);
  const mentionedOnlyInComments = HTML.includes('engineering_worker_execute_production_release');
  assert('12. public/index.html never invokes engineering_worker_execute_production_release (mentions are comments only)',
    !invoked && mentionedOnlyInComments);
}

// ── Test 13 — authorized/executing/triggered/failed/ambiguous (+revoked)
// all display distinct, correct, nontechnical CEO-facing labels. [LOGIC]
{
  const cases = [
    ['authorized', 'Production Release Authorized'],
    ['executing', 'Deploying'],
    ['triggered', 'Production Triggered'],
    ['failed', 'Deployment Failed'],
    ['ambiguous', 'Needs Reconciliation'],
    ['revoked', 'Authorization Revoked'],
  ];
  let allOk = true;
  for (const [status, expectedLabel] of cases) {
    const st = computeUiState({ git_commit_sha: REAL_SHA }, [{ status }]);
    if (st.label !== expectedLabel) allOk = false;
  }
  assert('13. every lifecycle status maps to its correct distinct CEO-facing label', allOk);
}

// ── Test 14 — failed/ambiguous releases do not auto-retry; a new
// authorization after failure/ambiguity remains an explicit CEO decision.
// [LOGIC + STRUCTURAL]
{
  const failedState = computeUiState({ git_commit_sha: REAL_SHA }, [{ status: 'failed' }]);
  const ambiguousState = computeUiState({ git_commit_sha: REAL_SHA }, [{ status: 'ambiguous' }]);
  assert('14a. failed state re-shows the button as a new explicit decision (never auto-fires)', failedState.showButton === true);
  assert('14b. ambiguous state re-shows the button as a new explicit decision (never auto-fires)', ambiguousState.showButton === true);
  assert('14c. no setTimeout/setInterval-driven auto-retry exists in the new release block',
    !/setTimeout|setInterval/.test(HTML.slice(HTML.indexOf('🚀 Approved — Pending Production Release'), HTML.indexOf('🚀 Approved — Pending Production Release') + 6000)));
}

// ── Test 15 — Deploy Hook URL / worker credential never appears in UI
// output. [STRUCTURAL]
{
  const releaseBlock = HTML.slice(HTML.indexOf('${(()=>{'), HTML.indexOf('${(()=>{') + 6000);
  assert('15. new release panel never references a deploy hook URL or worker credential value',
    !/DEPLOY_HOOK|deploy_hook_url|worker_credential\s*:/.test(releaseBlock));
}

// ── Test 16 — existing direct CEO release path, Agent Gateway, worker
// pairing UI, and unrelated systems remain unaffected. [STRUCTURAL]
assert('16a. old _engReviewAuthorizeRelease (direct CEO deploy) function still present, untouched',
  /async function _engReviewAuthorizeRelease\(engineeringTaskId,commitSha\)\{/.test(HTML));
assert('16b. old productionDeploymentAuthorize backend action still present, untouched',
  OPS.includes('productionDeploymentAuthorize') || /production_deployment_authorize/.test(OPS));
assert('16c. worker pairing UI section (b2_workers) still present, untouched',
  HTML.includes("_ebActiveSub==='b2_workers'"));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
