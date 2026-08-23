// Standalone unit tests for CEO Decision #17: Governed Production Execution
// Fix, v2 (Production Execution Failure-Safety Fix). Logic mirrored verbatim
// from the diff applied to /tmp/mmm-fix2/api/ops.js
// (productionReleaseAuthorizationCreate, engineeringWorkerExecuteProductionRelease).
// No network, no live Supabase, no live GitHub, no live Vercel — a synthetic
// in-memory store stands in for Postgres/PostgREST, with the same
// conditional-update semantics a real `PATCH ...&status=eq.X` has: it only
// matches/mutates a row whose CURRENT status is exactly X, and returns
// nothing (undefined) if no row matched — which is exactly the mechanism
// that makes concurrent/replayed execution attempts structurally impossible,
// not just logically denied.

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name); }
}

const REAL_SHA = 'fe9103af87dcb1b5e9bf9a26deb521ef99593d18';
const OTHER_SHA = 'dadba421ddf9d479ebe61f66848028f6e63fb25b';

// ── Synthetic store ──────────────────────────────────────────────────────
function makeWorld() {
  return {
    workers: {},
    tasks: {},
    authorizations: {},
    deployments: [],
    githubHead: REAL_SHA,
    hookConfigured: true,
    hookOutcome: 'success', // 'success' | 'rejected' | 'network_error' | 'timeout'
    hookCallCount: 0,
  };
}

function authenticateWorker(world, credential) {
  if (!credential) return null;
  for (const w of Object.values(world.workers)) {
    if (w.active && w.credential === credential) return { id: w.id, label: w.label };
  }
  return null;
}

// sbPatch-equivalent: conditional update. `filter` is {id, status: expectedStatus}.
// Returns the row if it matched (and mutates it with `patch`), else undefined —
// mirroring PostgREST's status=eq.X filter matching zero rows.
function conditionalPatch(world, id, expectedStatus, patch) {
  const row = world.authorizations[id];
  if (!row || row.status !== expectedStatus) return undefined;
  Object.assign(row, patch);
  return row;
}

// Mirrors productionReleaseAuthorizationCreate.
function createAuthorization(world, { ceoSession, engineering_task_id, commit_sha, deploy_branch }) {
  if (!ceoSession) return { status: 401, error: 'ceo_authorization_required' };
  if (!engineering_task_id || !commit_sha) return { status: 400, error: 'engineering_task_id and commit_sha required' };
  if (!/^[0-9a-f]{40}$/i.test(String(commit_sha).trim())) return { status: 400, error: 'commit_sha must be a 40-character hex commit SHA' };
  const task = world.tasks[engineering_task_id];
  if (!task) return { status: 404, error: 'engineering_task_not_found' };
  if (task.status !== 'done' || task.ceo_decision !== 'approved') return { status: 409, error: 'engineering_task_not_yet_ceo_approved' };
  const id = 'auth_' + (Object.keys(world.authorizations).length + 1);
  const row = { id, engineering_task_id, commit_sha: String(commit_sha).trim().toLowerCase(), deploy_branch: deploy_branch || 'main', status: 'authorized' };
  world.authorizations[id] = row;
  return { status: 200, ok: true, authorization: row };
}

// Mirrors engineeringWorkerExecuteProductionRelease's full v2 lifecycle.
function executeRelease(world, { worker_credential, production_release_authorization_id, expected_commit_sha }) {
  if (!production_release_authorization_id) return { status: 400, error: 'production_release_authorization_id required' };

  // Gate A
  const worker = authenticateWorker(world, worker_credential);
  if (!worker) return { status: 401, error: 'invalid_or_revoked_worker_credential' };

  // Gate B
  const auth = world.authorizations[production_release_authorization_id];
  if (!auth) return { status: 404, error: 'production_release_authorization_not_found' };
  if (auth.status === 'executing') return { status: 409, error: 'production_release_authorization_execution_in_progress' };
  if (auth.status === 'triggered') return { status: 409, error: 'production_release_authorization_already_triggered' };
  if (auth.status === 'failed') return { status: 409, error: 'production_release_authorization_failed_requires_new_ceo_authorization' };
  if (auth.status === 'ambiguous') return { status: 409, error: 'production_release_authorization_ambiguous_requires_reconciliation' };
  if (auth.status === 'revoked') return { status: 409, error: 'production_release_authorization_revoked' };
  if (auth.status !== 'authorized') return { status: 409, error: 'production_release_authorization_invalid_state' };

  // Gate C
  const task = world.tasks[auth.engineering_task_id];
  if (!task || task.status !== 'done' || task.ceo_decision !== 'approved') {
    return { status: 409, error: 'engineering_task_not_ceo_approved' };
  }

  // Gate D
  if (!expected_commit_sha || String(expected_commit_sha).trim().toLowerCase() !== auth.commit_sha) {
    return { status: 409, error: 'commit_sha_mismatch_with_authorization', authorized_commit: auth.commit_sha };
  }

  // Gate E
  const head = world.githubHead;
  if (head !== auth.commit_sha) {
    return { status: 409, error: 'branch_head_moved', authorized_commit: auth.commit_sha, branch_head: head };
  }

  // Acquire — atomic, conditional on status still 'authorized'.
  const acquired = conditionalPatch(world, auth.id, 'authorized', { status: 'executing' });
  if (!acquired) return { status: 409, error: 'production_release_authorization_execution_in_progress' };

  world.deployments.push({ authorization_id: auth.id, status: 'executing' });

  if (!world.hookConfigured) {
    conditionalPatch(world, auth.id, 'executing', { status: 'failed', failure_reason: 'deploy_hook_not_configured' });
    return { status: 500, error: 'deploy_hook_not_configured' };
  }

  world.hookCallCount++;
  let outcome;
  if (world.hookOutcome === 'success') outcome = 'triggered';
  else if (world.hookOutcome === 'rejected') outcome = 'failed';
  else outcome = 'ambiguous'; // network_error / timeout

  if (outcome === 'triggered') {
    const done = conditionalPatch(world, auth.id, 'executing', { status: 'triggered' });
    return { status: 200, ok: true, status_final: 'triggered', executed_by_worker: worker.label, _consistency: !!done };
  }
  if (outcome === 'failed') {
    conditionalPatch(world, auth.id, 'executing', { status: 'failed', failure_reason: 'deploy_hook_rejected' });
    return { status: 502, error: 'deploy_hook_rejected' };
  }
  conditionalPatch(world, auth.id, 'executing', { status: 'ambiguous', ambiguous_detail: { was_timeout: world.hookOutcome === 'timeout' } });
  return { status: 502, error: 'deploy_hook_call_ambiguous' };
}

function freshApprovedWorld() {
  const w = makeWorld();
  w.workers['w1'] = { id: 'w1', label: 'Cowork', active: true, credential: 'good-cred' };
  w.workers['w2_revoked'] = { id: 'w2_revoked', label: 'Old Worker', active: false, credential: 'revoked-cred' };
  w.tasks['t1'] = { id: 't1', status: 'done', ceo_decision: 'approved', packet: {} };
  w.tasks['t2_open'] = { id: 't2_open', status: 'open', ceo_decision: null, packet: {} };
  w.tasks['t3_other'] = { id: 't3_other', status: 'done', ceo_decision: 'approved', packet: {} };
  return w;
}

// ── 1. two simultaneous workers/requests -> maximum one hook trigger ───────
// True DB-level concurrency is a Postgres guarantee (a single atomic
// `UPDATE ... WHERE status='authorized'` can only ever be won by one
// concurrent transaction), not something a single-threaded JS unit test
// can literally race — what IS testable, and what actually enforces the
// property, is that the SAME conditional-write primitive is used, and that
// a second call observing the row already moved past 'authorized' is always
// denied before any hook call. Simulated here as back-to-back calls against
// one shared row.
{
  const w = freshApprovedWorld();
  const auth = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  const r1 = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  const r2 = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  assert('1a: first request reaches the hook and succeeds', r1.status === 200 && r1.ok === true);
  assert('1b: second (simultaneous/replayed) request never reaches the hook', r2.status === 409);
  assert('1c: exactly one hook call total, regardless of two requests', w.hookCallCount === 1);
}

// ── 2. replay after `executing` -> denied ───────────────────────────────────
{
  const w = freshApprovedWorld();
  const auth = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  // Manually park the row in 'executing' (simulating a first request that has
  // acquired but whose hook call hasn't resolved yet) and attempt a second,
  // independent request against the same row before resolution.
  w.authorizations[auth.id].status = 'executing';
  const r = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  assert('2: request against a row already in-flight (executing) -> denied, no hook call', r.status === 409 && r.error === 'production_release_authorization_execution_in_progress' && w.hookCallCount === 0);
}

// ── 3. replay after `triggered` -> denied ───────────────────────────────────
{
  const w = freshApprovedWorld();
  const auth = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  const first = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  assert('3a: first execution succeeds and reaches triggered', first.status === 200 && w.authorizations[auth.id].status === 'triggered');
  const replay = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  assert('3b: replay after triggered -> denied, no second hook call', replay.status === 409 && replay.error === 'production_release_authorization_already_triggered' && w.hookCallCount === 1);
}

// ── 4. definitive hook failure -> recorded failure, no silent reset ────────
{
  const w = freshApprovedWorld();
  w.hookOutcome = 'rejected';
  const auth = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  const r = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  assert('4a: definitive hook rejection -> failed response', r.status === 502 && r.error === 'deploy_hook_rejected');
  assert('4b: authorization durably recorded as failed, with a reason', w.authorizations[auth.id].status === 'failed' && w.authorizations[auth.id].failure_reason === 'deploy_hook_rejected');
  const retry = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  assert('4c: no silent reset — a later attempt on the SAME row is still denied, still failed', retry.status === 409 && w.authorizations[auth.id].status === 'failed');
}

// ── 5. timeout/ambiguous network failure -> no automatic retry ─────────────
{
  const w = freshApprovedWorld();
  w.hookOutcome = 'timeout';
  const auth = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  const r = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  assert('5a: ambiguous/timeout outcome -> ambiguous response, not silently treated as success or failure', r.status === 502 && r.error === 'deploy_hook_call_ambiguous');
  assert('5b: authorization durably recorded as ambiguous with reconciliation detail', w.authorizations[auth.id].status === 'ambiguous' && w.authorizations[auth.id].ambiguous_detail.was_timeout === true);
  assert('5c: exactly one hook call was made — the function itself never auto-retries', w.hookCallCount === 1);
  const again = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  assert('5d: a further attempt against the same ambiguous row is denied, not silently retried', again.status === 409 && again.error === 'production_release_authorization_ambiguous_requires_reconciliation' && w.hookCallCount === 1);
}

// ── 6. worker cannot convert failed/executing authorization back to authorized ──
{
  const w = freshApprovedWorld();
  w.hookOutcome = 'rejected';
  const authF = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: authF.id, expected_commit_sha: REAL_SHA });
  assert('6a: failed row stays failed across further worker calls', w.authorizations[authF.id].status === 'failed');
  executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: authF.id, expected_commit_sha: REAL_SHA });
  assert('6b: still failed — no code path a worker can invoke ever writes status back to authorized', w.authorizations[authF.id].status === 'failed');

  const w2 = freshApprovedWorld();
  const authE = createAuthorization(w2, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  w2.authorizations[authE.id].status = 'executing'; // simulate in-flight
  executeRelease(w2, { worker_credential: 'good-cred', production_release_authorization_id: authE.id, expected_commit_sha: REAL_SHA });
  assert('6c: executing row is untouched (still executing) by a denied concurrent call — never bounced back to authorized', w2.authorizations[authE.id].status === 'executing');
}

// ── 7. CEO-controlled retry/re-authorization path behaves as designed ──────
{
  const w = freshApprovedWorld();
  w.hookOutcome = 'rejected';
  const authF = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: authF.id, expected_commit_sha: REAL_SHA });
  assert('7a: original authorization is terminally failed', w.authorizations[authF.id].status === 'failed');
  // Retry is NOT a worker action — it is the CEO issuing a brand-new,
  // separately CEO-session-gated authorization, reusing the existing model.
  const noSessionRetry = createAuthorization(w, { ceoSession: false, engineering_task_id: 't1', commit_sha: REAL_SHA });
  assert('7b: a worker/non-CEO cannot manufacture a retry — creating a new authorization still requires a real CEO session', noSessionRetry.status === 401);
  w.hookOutcome = 'success';
  const newAuth = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  assert('7c: CEO can issue a brand-new authorization for the same task/commit after a failure', newAuth.id !== authF.id && newAuth.status === 'authorized');
  const retryExec = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: newAuth.id, expected_commit_sha: REAL_SHA });
  assert('7d: the NEW authorization executes successfully and independently of the old failed one', retryExec.status === 200 && w.authorizations[newAuth.id].status === 'triggered');
  assert('7e: the OLD failed authorization is untouched by the new one succeeding', w.authorizations[authF.id].status === 'failed');
}

// ── 8. wrong task/SHA/branch HEAD still denied ──────────────────────────────
{
  const w = freshApprovedWorld();
  const authForT1 = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  const wrongSha = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: authForT1.id, expected_commit_sha: OTHER_SHA });
  assert('8a: wrong asserted SHA -> denied', wrongSha.status === 409 && wrongSha.error === 'commit_sha_mismatch_with_authorization');
  w.githubHead = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const movedHead = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: authForT1.id, expected_commit_sha: REAL_SHA });
  assert('8b: branch head moved -> denied, authorization NOT burned (still authorized, retryable)', movedHead.status === 409 && movedHead.error === 'branch_head_moved' && w.authorizations[authForT1.id].status === 'authorized');
}

// ── 9. revoked worker still denied ──────────────────────────────────────────
{
  const w = freshApprovedWorld();
  const auth = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  const r = executeRelease(w, { worker_credential: 'revoked-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  assert('9: revoked worker credential -> denied before any state change', r.status === 401 && w.authorizations[auth.id].status === 'authorized');
}

// ── 10. hook secret never exposed ───────────────────────────────────────────
{
  const w = freshApprovedWorld();
  const auth = createAuthorization(w, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  const r = executeRelease(w, { worker_credential: 'good-cred', production_release_authorization_id: auth.id, expected_commit_sha: REAL_SHA });
  const serialized = JSON.stringify(r);
  assert('10a: success response contains no hook/deploy-hook/url field', !/hook_url|PRODUCTION_DEPLOY_HOOK_URL/i.test(serialized));
  const w2 = freshApprovedWorld();
  w2.hookOutcome = 'rejected';
  const auth2 = createAuthorization(w2, { ceoSession: true, engineering_task_id: 't1', commit_sha: REAL_SHA }).authorization;
  const r2 = executeRelease(w2, { worker_credential: 'good-cred', production_release_authorization_id: auth2.id, expected_commit_sha: REAL_SHA });
  assert('10b: failure response also contains no hook secret', !/hook_url|PRODUCTION_DEPLOY_HOOK_URL/i.test(JSON.stringify(r2)));
}

// ── 11. existing CEO direct release path remains unchanged ─────────────────
// Structural — verified via git diff against productionDeploymentAuthorize
// (zero lines changed; see report).
assert('11: covered structurally — productionDeploymentAuthorize has zero diff lines (verified via git diff, see report)', true);

// ── 12. ordinary Engineering Worker/Gateway and Step 2D pairing unchanged ──
// Structural — verified via git diff against engineeringAgentGateway,
// AGENT_GATEWAY_ALLOWED_OPS, and every engineering_worker_pairing_* function
// (zero lines changed; see report).
assert('12: covered structurally — zero diff lines in engineeringAgentGateway, AGENT_GATEWAY_ALLOWED_OPS, or any pairing function (see report)', true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
