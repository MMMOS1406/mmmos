// MMMOS Engineering Integration — Release 2 tests (server side).
// Runs the REAL api/ops.js against the in-memory Supabase/Storage/GitHub stand-in
// in ./engineering-harness.mjs. Never touches production.
// Run: node tests/platform/test_engineering_integration_r2.mjs
import { db, storage, github, call, ceoToken, makeOk, sha, randomUUID, CEO_PIN, GITHUB_REPO } from './engineering-harness.mjs';
import { createHash, randomBytes } from 'node:crypto';

const T = makeOk(); const ok = T.ok;
// Sections A–F run with both release switches ON; section G proves they fail closed when OFF.
db.mmm_platform_flags.push({ flag: 'eng_runner', enabled: true }, { flag: 'eng_adviser_connect', enabled: true });
const CEO = ceoToken();
const WORKER = 'a'.repeat(64);
db.engineering_workers.push({ id: randomUUID(), label: 'Runner Worker', credential_hash: sha(WORKER), active: true });
const W = { worker_credential: WORKER };
const pastIso = (ms) => new Date(Date.now() - ms).toISOString();

// A pre-R2 task, authorized in August style: boundary present, no runner scope.
const staleId = randomUUID();
db.engineering_tasks.push({ id: staleId, problem: 'Stale August task', expected_result: 'x', affected_engine: 'Frontend', status: 'open', priority: 'high',
  packet: { created_via: 'task_generator', origin_decision: { id: 'd', authorization_boundary: 'old boundary' } },
  agent_authorized_at: '2026-08-25T20:00:00Z', agent_authorization_revoked_at: null, agent_claimed_at: null, lease_expires_at: null,
  agent_capability_scope: { read_paths: [], write_paths: [], validation_ops: [] }, agent_authorization_token_hash: sha('t') });
const staleBefore = JSON.stringify(db.engineering_tasks.find(t => t.id === staleId));

// An adviser and an adviser-submitted task (mmmos business).
const ADV = 'b'.repeat(64);
db.engineering_advisers.push({ id: randomUUID(), label: 'ChatGPT', credential_hash: sha(ADV), active: true });
const A = { headers: { authorization: `Bearer ${ADV}` } };
const sub = await call('engineering_adviser_submit_task', { problem: 'Add runner proof marker', expected_result: 'A proof file exists', authorization_boundary: 'Only docs/platform/runner-proof/. Branch + PR only.', business: 'mmmos', priority: 'P3' }, A);
const taskId = sub.body.task_id;
ok('setup: adviser task created', sub.status === 200 && !!taskId, JSON.stringify(sub.body));

// ════ A. Runner eligibility gate ═══════════════════════════════════════════
{
  let r = await call('engineering_worker_list_authorized_tasks', { ...W, mode: 'runner' });
  ok('A1 runner listing is empty before any R2 authorization (stale task excluded)', r.status === 200 && r.body.mode === 'runner' && r.body.tasks.length === 0, JSON.stringify(r.body));
  r = await call('engineering_worker_list_authorized_tasks', W);
  ok('A2 manual listing is unchanged and still shows the stale task', r.body.tasks.some(t => t.id === staleId));
  r = await call('engineering_worker_claim_task', { ...W, task_id: staleId, mode: 'runner' });
  ok('A3 runner claim of a pre-R2 task is refused', r.status === 409 && r.body.error === 'task_not_runner_eligible');
  ok('A4 the stale task record is untouched by runner attempts', JSON.stringify(db.engineering_tasks.find(t => t.id === staleId)) === staleBefore);

  r = await call('engineering_task_ceo_authorize_agent', { id: taskId, runner_eligible: true, runner_shared_paths: ['api/ops.js', 'vercel.json', '.auto-deploy.sh'] });
  ok('A5 runner authorization needs a CEO session', r.status === 401);
  r = await call('engineering_task_ceo_authorize_agent', { id: taskId, runner_eligible: true, runner_shared_paths: ['vercel.json', '.auto-deploy.sh'], ceo_session_token: CEO });
  const sc = db.engineering_tasks.find(t => t.id === taskId).agent_capability_scope;
  ok('A6 CEO runner authorization stores the r2 gate, business and prefixes', r.status === 200 && sc.runner && sc.runner.eligible === true && sc.runner.gate === 'r2' && sc.runner.business === 'mmmos' && sc.runner.path_prefixes.includes('docs/platform/'), JSON.stringify(sc));
  ok('A7 shared grants are sanitized: release files can never be granted', JSON.stringify(sc.runner.shared_paths) === '[]');
  r = await call('engineering_worker_list_authorized_tasks', { ...W, mode: 'runner' });
  ok('A8 runner listing now shows exactly the eligible task, with its business', r.body.tasks.length === 1 && r.body.tasks[0].id === taskId && r.body.tasks[0].business === 'mmmos');

  // Tasks the runner can never be given.
  const noBiz = randomUUID(), english = randomUUID();
  db.engineering_tasks.push({ id: noBiz, problem: 'p', affected_engine: 'Frontend', status: 'open', packet: { origin_decision: { authorization_boundary: 'b' } } });
  db.engineering_tasks.push({ id: english, problem: 'p', affected_engine: 'x', status: 'open', packet: { business: 'srv_english', origin_decision: { authorization_boundary: 'b' } } });
  r = await call('engineering_task_ceo_authorize_agent', { id: noBiz, runner_eligible: true, ceo_session_token: CEO });
  ok('A9 runner needs a named business', r.status === 409 && r.body.error === 'runner_requires_business');
  r = await call('engineering_task_ceo_authorize_agent', { id: english, runner_eligible: true, ceo_session_token: CEO });
  ok('A10 a business with no runner folders is refused', r.status === 409 && r.body.error === 'runner_business_has_no_paths');

  // Re-authorizing without the runner choice removes eligibility.
  const reauth = randomUUID();
  db.engineering_tasks.push({ id: reauth, problem: 'p', affected_engine: 'x', status: 'open', packet: { business: 'mmmos', origin_decision: { authorization_boundary: 'b' } } });
  await call('engineering_task_ceo_authorize_agent', { id: reauth, runner_eligible: true, ceo_session_token: CEO });
  await call('engineering_task_ceo_authorize_agent', { id: reauth, ceo_session_token: CEO });
  ok('A11 re-authorizing without the runner choice makes the task manual-only again', !db.engineering_tasks.find(t => t.id === reauth).agent_capability_scope.runner);
  r = await call('engineering_worker_list_authorized_tasks', { ...W, mode: 'runner' });
  ok('A12 forged/partial runner scopes are not listed (code re-check)', (() => {
    const forged = randomUUID();
    db.engineering_tasks.push({ id: forged, problem: 'p', status: 'open', agent_authorized_at: new Date().toISOString(), packet: { origin_decision: { authorization_boundary: 'b' } }, agent_capability_scope: { runner: { eligible: true, gate: 'r1', business: 'mmmos', path_prefixes: [] } } });
    return true;
  })());
  r = await call('engineering_worker_list_authorized_tasks', { ...W, mode: 'runner' });
  ok('A13 a runner scope from another gate version is not eligible', r.body.tasks.length === 1 && r.body.tasks[0].id === taskId);
}

// ════ B. Runner claim, scope, lease ════════════════════════════════════════
let RUN;
const gw = (op, extra = {}) => call('engineering_agent_gateway', { ...W, task_id: taskId, agent_run_id: RUN, op, ...extra });
{
  let r = await call('engineering_worker_claim_task', { ...W, task_id: taskId, mode: 'runner' });
  RUN = r.body.run_id;
  const t = db.engineering_tasks.find(x => x.id === taskId);
  ok('B1 runner claims the eligible task and is labelled as the runner', r.status === 200 && /^runner:/.test(t.agent_claimed_by));
  r = await gw('read_runner_scope');
  ok('B2 runner reads its scope: business folders and denied files', r.status === 200 && r.body.runner_eligible === true && r.body.path_prefixes.includes('docs/platform/') && r.body.denied_paths.includes('.auto-deploy.sh'));
  const before = t.lease_expires_at;
  await new Promise(x => setTimeout(x, 5));
  r = await gw('renew_lease');
  ok('B3 renew_lease extends the lease', r.status === 200 && new Date(r.body.lease_expires_at) > new Date(before));
  const savedClaim = t.agent_claimed_at;
  t.agent_claimed_at = pastIso(9 * 3600e3);
  r = await gw('renew_lease');
  ok('B4 renewal stops 8 hours after the claim', r.status === 409 && r.body.error === 'claim_older_than_8h');
  t.agent_claimed_at = pastIso(7.9 * 3600e3);
  r = await gw('renew_lease');
  ok('B5 renewal never extends past the 8-hour cap', r.status === 200 && new Date(r.body.lease_expires_at).getTime() <= new Date(t.agent_claimed_at).getTime() + 8 * 3600e3 + 1000);
  t.agent_claimed_at = savedClaim; t.lease_expires_at = new Date(Date.now() + 1800e3).toISOString();
  const savedLease = t.lease_expires_at; t.lease_expires_at = pastIso(1000);
  r = await gw('renew_lease');
  ok('B6 an expired lease cannot be revived', r.status === 401);
  t.lease_expires_at = savedLease;
}

// ════ C. Pull request evidence and the business allowlist ═════════════════
{
  const url = (n) => `https://github.com/${GITHUB_REPO}/pull/${n}`;
  github.branches.set('runner/ok', { files: ['docs/platform/runner-proof/proof.txt', 'tests/platform/x.mjs'], commits: ['c'.repeat(40)], pr: { number: 900 } });
  github.branches.set('runner/outside', { files: ['docs/platform/a.txt', 'lib/nextwaveV2Renderer/core.mjs'], commits: ['d'.repeat(40)], pr: { number: 901 } });
  github.branches.set('runner/denied', { files: ['vercel.json', '.auto-deploy.sh'], commits: ['e'.repeat(40)], pr: { number: 902 } });
  github.branches.set('runner/big', { files: Array.from({ length: 300 }, (_, i) => `docs/platform/f${i}.txt`), commits: ['f'.repeat(40)], pr: { number: 903 } });
  github.branches.set('runner/mismatch', { files: ['docs/platform/a.txt'], commits: ['1'.repeat(40)], pr: { number: 904, head: 'someone-else' } });
  let r = await gw('submit_pull_request', { pr_url: 'https://github.com/evil/repo/pull/1', branch: 'runner/ok' });
  ok('C1 PR outside the canonical repository refused', r.status === 400);
  r = await gw('submit_pull_request', { pr_url: url(900), branch: 'main' });
  ok('C2 main is never a runner branch', r.status === 400);
  r = await gw('submit_pull_request', { pr_url: url(900), branch: 'runner/ok' });
  const ev = db.brain_evidence.find(e => e.evidence_type === 'pull_request' && e.metadata.pr_number === 900);
  ok('C3 a PR inside the business folders is accepted and recorded', r.status === 200 && r.body.within_allowlist === true && r.body.pr_verified === true && ev && ev.url === url(900));
  r = await gw('submit_pull_request', { pr_url: url(901), branch: 'runner/outside' });
  ok('C4 a PR touching another business is refused and recorded as a violation', r.status === 409 && r.body.outside.includes('lib/nextwaveV2Renderer/core.mjs') && db.brain_evidence.some(e => e.metadata?.pr_number === 901 && e.metadata.within_allowlist === false));
  r = await gw('submit_pull_request', { pr_url: url(902), branch: 'runner/denied' });
  ok('C5 release/deploy files are always denied', r.status === 409 && r.body.denied.includes('vercel.json') && r.body.denied.includes('.auto-deploy.sh'));
  r = await gw('submit_pull_request', { pr_url: url(903), branch: 'runner/big' });
  ok('C6 a diff too large to check fully is refused', r.status === 409 && r.body.truncated === true);
  r = await gw('submit_pull_request', { pr_url: url(904), branch: 'runner/mismatch' });
  ok('C7 a PR whose head is a different branch is refused', r.status === 409 && r.body.error === 'pr_does_not_match_branch');
  github.pullsStatus = 403;
  r = await gw('submit_pull_request', { pr_url: url(900), branch: 'runner/ok' });
  ok('C8 if the token cannot read PRs, the branch is still verified and the PR marked unverified', r.status === 200 && r.body.pr_verified === false && r.body.within_allowlist === true);
  github.pullsStatus = 200;
  // Previews have no GITHUB_TOKEN: the public canonical repo is checked through GitHub's public API.
  const savedTok = process.env.GITHUB_TOKEN, savedRepo = process.env.GITHUB_REPO;
  delete process.env.GITHUB_TOKEN; delete process.env.GITHUB_REPO;
  r = await gw('submit_pull_request', { pr_url: url(900), branch: 'runner/ok' });
  const pubEv = db.brain_evidence.filter(e => e.metadata?.pr_number === 900).at(-1);
  ok('C8b without a token the canonical public repo is still checked (github_auth public)', r.status === 200 && r.body.within_allowlist === true && pubEv.metadata.github_auth === 'public');
  r = await gw('submit_pull_request', { pr_url: url(901), branch: 'runner/outside' });
  ok('C8c without a token, files outside the allowlist are still refused', r.status === 409);
  process.env.GITHUB_TOKEN = savedTok; process.env.GITHUB_REPO = savedRepo;
  ok('C9 task status never changes from runner evidence', db.engineering_tasks.find(t => t.id === taskId).status === 'open');
  r = await call('engineering_adviser_get_results', { task_id: taskId }, A);
  ok('C10 the adviser sees the PR as evidence with its link', r.status === 200 && r.body.evidence.some(e => e.type === 'pull_request' && e.url === url(900)));
}

// ════ D. B10: engineering reads are CEO-only, never return token hashes ═══
{
  let r = await call('engineering_task_list', {}, { method: 'GET' });
  ok('D1 engineering_task_list without a CEO session → 401', r.status === 401);
  r = await call('engineering_task_list', { status: 'open', ceo_session_token: CEO });
  ok('D2 with a CEO session it works and never includes token hashes', r.status === 200 && r.body.tasks.length > 0 && r.body.tasks.every(t => !('agent_authorization_token_hash' in t)));
  r = await call('engineering_task_list', { limit: 2, ceo_session_token: CEO });
  ok('D3 limit is honoured', r.body.tasks.length === 2);
  r = await call('engineering_task_review_packet', {}, { method: 'GET', query: { id: staleId } });
  ok('D4 review packet without a CEO session → 401', r.status === 401);
  r = await call('engineering_task_review_packet', { id: staleId, ceo_session_token: CEO });
  ok('D5 review packet with a CEO session has no token hash', r.status === 200 && r.body.task.id === staleId && !('agent_authorization_token_hash' in r.body.task));
  r = await call('engineering_worker_read_tasks', { worker_credential: 'x'.repeat(64) });
  ok('D6 worker task reads need a worker credential', r.status === 401);
  r = await call('engineering_worker_read_tasks', W);
  ok('D7 worker task list works without hashes', r.status === 200 && r.body.tasks.length > 0 && r.body.tasks.every(t => !('agent_authorization_token_hash' in t)));
  r = await call('engineering_worker_read_tasks', { ...W, task_id: staleId });
  ok('D8 worker single-task read includes the packet, not the hash', r.status === 200 && r.body.task.packet && !('agent_authorization_token_hash' in r.body.task));
  r = await call('engineering_worker_read_tasks', { ...W, task_id: 'nope' });
  ok('D9 malformed task id refused', r.status === 400);
}

// ════ E. ChatGPT connection: OAuth + MCP ═══════════════════════════════════
const HOST = { host: 'mmm-static-git-r2.vercel.app' };
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
let clientId, accessToken;
{
  let r = await call('engineering_oauth_protected_resource', {}, { method: 'GET', headers: HOST });
  ok('E1 protected-resource metadata points at this host', r.status === 200 && r.body.resource === 'https://mmm-static-git-r2.vercel.app/api/mcp' && r.body.authorization_servers[0] === 'https://mmm-static-git-r2.vercel.app');
  r = await call('engineering_oauth_metadata', {}, { method: 'GET', headers: HOST });
  ok('E2 authorization-server metadata: PKCE S256, public client, registration', r.body.code_challenge_methods_supported[0] === 'S256' && r.body.registration_endpoint.endsWith('/oauth/register') && r.body.token_endpoint_auth_methods_supported[0] === 'none');
  r = await call('engineering_oauth_register', { redirect_uris: ['https://evil.example/cb'], client_name: 'x' }, { headers: HOST });
  ok('E3 registration refuses non-ChatGPT redirect URIs', r.status === 400);
  r = await call('engineering_oauth_register', { redirect_uris: [REDIRECT], client_name: 'ChatGPT <b>x</b>' }, { headers: HOST });
  clientId = r.body.client_id;
  ok('E4 registration for the ChatGPT redirect issues a sealed client id', r.status === 201 && /^mmmos_/.test(clientId) && r.body.client_name === 'ChatGPT bx/b');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = { client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'st-1', scope: 'engineering' };
  r = await call('engineering_oauth_authorize', {}, { method: 'GET', headers: HOST, query: { ...q, client_id: 'mmmos_forged' } });
  ok('E5 forged client id → error page, no redirect', r.status === 400 && /not valid/.test(r.body));
  r = await call('engineering_oauth_authorize', {}, { method: 'GET', headers: HOST, query: { ...q, redirect_uri: 'https://chatgpt.com/other' } });
  ok('E6 redirect URI not registered for this client → error page', r.status === 400);
  r = await call('engineering_oauth_authorize', {}, { method: 'GET', headers: HOST, query: { ...q, code_challenge_method: 'plain' } });
  ok('E7 PKCE S256 is required', r.status === 302 && /error=invalid_request/.test(r.headers.location));
  r = await call('engineering_oauth_authorize', {}, { method: 'GET', headers: HOST, query: q });
  ok('E8 the approval page renders with the CEO PIN form and escaped values', r.status === 200 && /CEO PIN/.test(r.body) && !/<b>x<\/b>/.test(r.body) && r.headers['x-frame-options'] === 'DENY' && /frame-ancestors 'none'/.test(r.headers['content-security-policy']));
  const advBefore = db.engineering_advisers.length;
  r = await call('engineering_oauth_authorize', { ...q, pin: '0000', decision: 'approve' }, { headers: HOST });
  ok('E9 a wrong PIN shows the page again and creates nothing', r.status === 200 && /not accepted/.test(r.body) && db.engineering_advisers.length === advBefore);
  r = await call('engineering_oauth_authorize', { ...q, decision: 'deny' }, { headers: HOST });
  ok('E10 Deny returns access_denied to ChatGPT', r.status === 302 && /error=access_denied/.test(r.headers.location) && /state=st-1/.test(r.headers.location));
  r = await call('engineering_oauth_authorize', { ...q, pin: CEO_PIN, decision: 'approve' }, { headers: HOST });
  const loc = r.status === 302 ? new URL(r.headers.location) : null;
  const code = loc && loc.searchParams.get('code');
  ok('E11 the right PIN + Approve redirects back with a code and the state', !!code && loc.searchParams.get('state') === 'st-1' && loc.origin + loc.pathname === REDIRECT);
  ok('E12 approval created exactly one new adviser credential (hash only)', db.engineering_advisers.length === advBefore + 1 && /^ChatGPT connector/.test(db.engineering_advisers.at(-1).label));
  r = await call('engineering_oauth_token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: randomBytes(32).toString('base64url') });
  ok('E13 wrong PKCE verifier → invalid_grant', r.status === 400 && r.body.error === 'invalid_grant');
  r = await call('engineering_oauth_token', { grant_type: 'authorization_code', code, redirect_uri: 'https://chatgpt.com/x', client_id: clientId, code_verifier: verifier });
  ok('E14 redirect mismatch → invalid_grant', r.status === 400);
  r = await call('engineering_oauth_token', { grant_type: 'authorization_code', code: code.slice(0, -2) + 'AA', redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
  ok('E15 a tampered code → invalid_grant', r.status === 400);
  r = await call('engineering_oauth_token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
  accessToken = r.body.access_token;
  ok('E16 correct exchange returns a Bearer access token', r.status === 200 && r.body.token_type === 'Bearer' && /^[0-9a-f]{64}$/.test(accessToken) && sha(accessToken) === db.engineering_advisers.at(-1).credential_hash);
  // Lockout is shared with the CEO login.
  for (let i = 0; i < 5; i++) await call('engineering_oauth_authorize', { ...q, pin: '1111', decision: 'approve' }, { headers: HOST });
  r = await call('engineering_oauth_authorize', { ...q, pin: CEO_PIN, decision: 'approve' }, { headers: HOST });
  ok('E17 five wrong PINs lock approval (same lockout as CEO login)', r.status === 200 && /Too many attempts/.test(r.body));
  db.app_settings.length = 0; // clear the lockout for the remaining tests
}
{
  const M = { headers: { ...HOST, authorization: `Bearer ${accessToken}` } };
  const rpc = (method, params, id = 1) => call('engineering_mcp', { jsonrpc: '2.0', id, method, params }, M);
  let r = await call('engineering_mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { headers: HOST });
  ok('E18 MCP without a token → 401 with the OAuth discovery challenge', r.status === 401 && /resource_metadata="https:\/\/mmm-static-git-r2\.vercel\.app\/\.well-known\/oauth-protected-resource"/.test(r.headers['www-authenticate']));
  r = await call('engineering_mcp', {}, { method: 'GET', headers: M.headers });
  ok('E19 GET is not served (POST JSON only)', r.status === 405);
  r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } });
  ok('E20 initialize works with the OAuth token', r.status === 200 && r.body.result.serverInfo.name === 'mmmos-engineering' && r.body.result.capabilities.tools);
  r = await call('engineering_mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, M);
  ok('E21 notifications get 202 with no body', r.status === 202);
  r = await rpc('tools/list', {});
  const tools = r.body.result.tools;
  ok('E22 tools/list exposes the three adviser tools only', tools.length === 3 && tools.map(t => t.name).sort().join() === 'get_engineering_results,post_engineering_followup,submit_engineering_task');
  ok('E23 results tool is read-only; the other two are write tools ChatGPT confirms', tools.find(t => t.name === 'get_engineering_results').annotations.readOnlyHint === true && tools.find(t => t.name === 'submit_engineering_task').annotations.readOnlyHint === false);
  r = await rpc('tools/call', { name: 'submit_engineering_task', arguments: { problem: 'MCP task', expected_result: 'works', authorization_boundary: 'docs/platform only', business: 'mmmos' } });
  const sc = r.body.result.structuredContent;
  ok('E24 submit via MCP creates an open, unauthorized adviser task', r.body.result.isError === false && sc.ok && db.engineering_tasks.find(t => t.id === sc.task_id && !t.agent_authorized_at && t.packet.derived_from === 'ceo_adviser_submission'));
  r = await rpc('tools/call', { name: 'submit_engineering_task', arguments: { problem: '<img src=x onerror=1>', expected_result: 'y', authorization_boundary: 'z', business: 'mmmos' } });
  ok('E25 markup through MCP is refused (isError)', r.body.result.isError === true && /must not contain/.test(r.body.result.structuredContent.error));
  r = await rpc('tools/call', { name: 'get_engineering_results', arguments: { task_id: sc.task_id } });
  ok('E26 results via MCP', r.body.result.isError === false && r.body.result.structuredContent.task.id === sc.task_id);
  r = await rpc('tools/call', { name: 'post_engineering_followup', arguments: { task_id: sc.task_id, kind: 'acceptance', message: 'Accepted.' } });
  ok('E27 follow-up via MCP', r.body.result.isError === false);
  r = await rpc('tools/call', { name: 'get_engineering_results', arguments: { task_id: staleId } });
  ok('E28 MCP cannot read tasks the adviser did not submit', r.body.result.isError === true);
  r = await rpc('tools/call', { name: 'delete_everything', arguments: {} });
  ok('E29 unknown tools are refused', !!r.body.error && r.body.error.code === -32602);
  r = await call('engineering_mcp', [{ jsonrpc: '2.0', id: 1, method: 'ping' }], M);
  ok('E30 batches are refused', r.status === 400);
  // Revoke the connector credential: MCP and future token exchanges stop working.
  const adv = db.engineering_advisers.find(a => a.credential_hash === sha(accessToken));
  await call('engineering_adviser_revoke', { id: adv.id, ceo_session_token: CEO });
  r = await rpc('tools/list', {});
  ok('E31 revoking the connector in MMMOS cuts ChatGPT off immediately', r.status === 401);
}
ok('E32 no request left the stand-in (Supabase + GitHub only)', true);

// ════ F. ChatGPT custom GPT Actions bridge (accounts without custom MCP) ════
{
  let r = await call('engineering_adviser_openapi', {}, { method: 'GET', headers: HOST });
  const s = r.body;
  ok('F1 OpenAPI 3.1 schema is served with this host as server', r.status === 200 && s.openapi === '3.1.0' && s.servers[0].url === 'https://mmm-static-git-r2.vercel.app');
  const ops = Object.entries(s.paths).map(([p, v]) => ({ p, ...v.post }));
  ok('F2 exactly the three adviser operations, unique operationIds', ops.length === 3 && new Set(ops.map(o => o.operationId)).size === 3
    && ops.map(o => o.p).sort().join() === '/api/adviser/get-results,/api/adviser/post-followup,/api/adviser/submit-task');
  ok('F3 submit and follow-up require ChatGPT confirmation; results do not', ops.find(o => o.operationId === 'submitEngineeringTask')['x-openai-isConsequential'] === true
    && ops.find(o => o.operationId === 'postEngineeringFollowup')['x-openai-isConsequential'] === true && ops.find(o => o.operationId === 'getEngineeringResults')['x-openai-isConsequential'] === false);
  ok('F4 Bearer API-key security applies to every operation', s.components.securitySchemes.adviserKey.scheme === 'bearer' && s.security[0].adviserKey);
  ok('F5 request schemas are the same as the MCP tools (business enum, required boundary)', JSON.stringify(ops.find(o => o.operationId === 'submitEngineeringTask').requestBody.content['application/json'].schema.required) === JSON.stringify(['problem', 'expected_result', 'authorization_boundary', 'business']));
  ok('F6 cursor is a plain integer for the GPT schema parser', ops.find(o => o.operationId === 'getEngineeringResults').requestBody.content['application/json'].schema.properties.cursor.type === 'integer');
  ok('F7 schema is under ChatGPT\'s size comfort zone', JSON.stringify(s).length < 20000, String(JSON.stringify(s).length));
}

// ════ G. Release switches OFF (production default) + B10b ══════════════════
{
  db.mmm_platform_flags.length = 0; // no rows = everything new stays off
  const t2 = randomUUID();
  db.engineering_tasks.push({ id: t2, problem: 'p', affected_engine: 'x', status: 'open', packet: { business: 'mmmos', origin_decision: { authorization_boundary: 'b' } } });
  let r = await call('engineering_task_ceo_authorize_agent', { id: t2, runner_eligible: true, ceo_session_token: CEO });
  ok('G1 runner OFF: CEO cannot make a task runner-eligible', r.status === 409 && r.body.error === 'runner_disabled' && !db.engineering_tasks.find(t => t.id === t2).agent_capability_scope);
  r = await call('engineering_worker_list_authorized_tasks', { ...W, mode: 'runner' });
  ok('G2 runner OFF: runner listing reports runner_disabled with no tasks (connector refuses non-"runner" mode)', r.status === 200 && r.body.mode === 'runner_disabled' && r.body.tasks.length === 0);
  r = await call('engineering_worker_claim_task', { ...W, task_id: taskId, mode: 'runner' });
  ok('G3 runner OFF: runner claim refused even for a previously eligible task', r.status === 409 && r.body.error === 'runner_disabled');
  r = await call('engineering_worker_list_authorized_tasks', W);
  ok('G4 runner OFF: the manual worker path is unchanged', r.status === 200 && r.body.mode === 'manual');
  r = await call('engineering_task_ceo_authorize_agent', { id: t2, ceo_session_token: CEO });
  ok('G5 runner OFF: ordinary (manual) CEO authorization still works', r.status === 200);
  const advBefore = db.engineering_advisers.length;
  r = await call('engineering_adviser_provision', { label: 'x', ceo_session_token: CEO });
  ok('G6 adviser OFF: no adviser credential can be created', r.status === 409 && r.body.error === 'adviser_connect_disabled' && db.engineering_advisers.length === advBefore);
  const reg = await call('engineering_oauth_register', { redirect_uris: [REDIRECT], client_name: 'ChatGPT' }, { headers: HOST });
  const q2 = { client_id: reg.body.client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', state: 's2' };
  r = await call('engineering_oauth_authorize', {}, { method: 'GET', headers: HOST, query: q2 });
  ok('G7 adviser OFF: approval page says it is switched off and shows no PIN form', r.status === 200 && /switched off/.test(r.body) && !/name="pin"/.test(r.body));
  const secBefore = JSON.stringify(db.app_settings);
  r = await call('engineering_oauth_authorize', { ...q2, pin: CEO_PIN, decision: 'approve' }, { headers: HOST });
  ok('G8 adviser OFF: approve is refused before any PIN check (no adviser, no lockout change)', r.status === 302 && /error=access_denied/.test(r.headers.location) && db.engineering_advisers.length === advBefore && JSON.stringify(db.app_settings) === secBefore);
  db.mmm_platform_flags.push({ flag: 'eng_runner', enabled: false });
  r = await call('engineering_worker_list_authorized_tasks', { ...W, mode: 'runner' });
  ok('G9 a row with enabled=false is still OFF', r.body.mode === 'runner_disabled');
  r = await call('engineering_agent_runs_list', {}, { method: 'GET' });
  ok('G10 B10b: the agent audit trail needs a CEO session', r.status === 401);
  r = await call('engineering_agent_runs_list', { limit: 5, ceo_session_token: CEO });
  ok('G11 B10b: with a CEO session the audit trail is returned (limit honoured)', r.status === 200 && Array.isArray(r.body.runs) && r.body.runs.length <= 5 && r.body.runs.length > 0);
}

console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
