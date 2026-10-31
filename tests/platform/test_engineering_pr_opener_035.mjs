// MMMOS-R2-READINESS-035 (H4) — the MMMOS PR opener, against a simulated GitHub.
// Real api/ops.js + in-memory stand-in. The RSA key is generated for this test run only (not a credential).
// Run: node tests/platform/test_engineering_pr_opener_035.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createHash, createVerify } from 'node:crypto';
import { db, github, call, ceoToken, makeOk, sha, randomUUID, GITHUB_REPO } from './engineering-harness.mjs';

const T = makeOk(); const ok = T.ok;
const STAGING = 'MMMOS1406/mmmos-runner-staging';
db.mmm_platform_flags.push({ flag: 'eng_runner', enabled: true }, { flag: 'eng_adviser_connect', enabled: true });
const CEO = ceoToken();
const WORKER = 'e'.repeat(64);
db.engineering_workers.push({ id: randomUUID(), label: 'Runner Worker', credential_hash: sha(WORKER), active: true });
const W = { worker_credential: WORKER };
const ADV = 'f'.repeat(64);
db.engineering_advisers.push({ id: randomUUID(), label: 'ChatGPT', credential_hash: sha(ADV), active: true });
const A = { headers: { authorization: `Bearer ${ADV}` } };

// ── Simulated GitHub: two repositories, content-addressed blobs, trees, commits, refs, pulls ──
const gitSha = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const sim = { calls: [], blobs: { [GITHUB_REPO]: new Map(), [STAGING]: new Map() }, refs: new Map(), pulls: [], tokens: [], jwt: [], mainAheadOf: new Set(), stagingBranches: new Map(), nextPr: 700, failBlobCopy: false };
const BASE = 'b'.repeat(40);
sim.mainAheadOf.add(BASE);
const addStagingBranch = (name, files) => { // files: [{ filename, status, content?, previous_filename? }]
  const out = files.map(f => { if (f.content === undefined) return { ...f, sha: '0'.repeat(40) }; const buf = Buffer.from(f.content); const s = gitSha(buf); sim.blobs[STAGING].set(s, buf); return { filename: f.filename, status: f.status, sha: s, previous_filename: f.previous_filename }; });
  sim.stagingBranches.set(name, { files: out, head: createHash('sha1').update(name).digest('hex') });
};
const R = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
github.handler = async (u, method, opts) => {
  const path = u.replace('https://api.github.com', '');
  sim.calls.push(`${method} ${path}`);
  let m;
  if ((m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path)) && method === 'POST') {
    sim.jwt.push(opts.headers.Authorization.replace('Bearer ', '')); sim.tokens.push(JSON.parse(opts.body));
    return R(201, { token: 'ghs_simulated_installation_token' });
  }
  if (opts.headers && opts.headers.Authorization !== 'Bearer ghs_simulated_installation_token') return R(401, { message: 'bad token' });
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/compare\/([0-9a-f]{40})\.\.\.main$/.exec(path))) return R(200, { status: m[1] === GITHUB_REPO && sim.mainAheadOf.has(m[2]) ? 'ahead' : 'diverged' });
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/compare\/([0-9a-f]{40})\.\.\.(.+)$/.exec(path))) {
    const b = sim.stagingBranches.get(decodeURIComponent(m[3]));
    if (m[1] !== STAGING || !b) return R(404, {});
    return R(200, { files: b.files, commits: [{ sha: b.head }] });
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/git\/blobs\/([0-9a-f]{40})$/.exec(path)) && method === 'GET') {
    const buf = sim.blobs[m[1]] && sim.blobs[m[1]].get(m[2]); if (!buf) return R(404, {});
    return R(200, { sha: m[2], size: buf.length, encoding: 'base64', content: buf.toString('base64').replace(/(.{60})/g, '$1\n') });
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/git\/blobs$/.exec(path)) && method === 'POST') {
    const j = JSON.parse(opts.body); const buf = Buffer.from(j.content, 'base64'); const s = gitSha(buf);
    sim.blobs[m[1]].set(s, buf); return R(201, { sha: sim.failBlobCopy ? '1'.repeat(40) : s });
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/git\/commits\/([0-9a-f]{40})$/.exec(path)) && method === 'GET') return R(200, { sha: m[2], tree: { sha: 't'.repeat(40) } });
  if (/^\/repos\/[^/]+\/[^/]+\/git\/trees$/.test(path) && method === 'POST') { sim.lastTree = JSON.parse(opts.body); return R(201, { sha: 'a'.repeat(40) }); }
  if (/^\/repos\/[^/]+\/[^/]+\/git\/commits$/.test(path) && method === 'POST') { sim.lastCommit = JSON.parse(opts.body); return R(201, { sha: 'c'.repeat(40) }); }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/git\/refs$/.exec(path)) && method === 'POST') {
    const j = JSON.parse(opts.body); if (m[1] !== GITHUB_REPO) return R(403, {});
    if (sim.refs.has(j.ref)) return R(422, { message: 'Reference already exists' });
    sim.refs.set(j.ref, j.sha); return R(201, { ref: j.ref });
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/git\/refs\/heads\/(.+)$/.exec(path)) && method === 'PATCH') { sim.refs.set(`refs/heads/${m[2]}`, JSON.parse(opts.body).sha); return R(200, {}); }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(path)) && method === 'POST') {
    const j = JSON.parse(opts.body); const n = sim.nextPr++; sim.pulls.push({ n, ...j }); return R(201, { number: n, html_url: `https://github.com/${GITHUB_REPO}/pull/${n}` });
  }
  if (/\/merge\b/.test(path) || (/\/pulls\/\d+$/.test(path) && method !== 'GET')) { sim.mergeAttempt = path; return R(405, {}); }
  return R(404, { message: 'not simulated: ' + method + ' ' + path });
};

// A CEO-authorized, runner-claimed task (business mmmos).
const sub = await call('engineering_adviser_submit_task', { problem: 'Add runner proof marker', expected_result: 'proof file', authorization_boundary: 'Only docs/platform/runner-proof/. Branch + PR only.', business: 'mmmos', priority: 'P3' }, A);
const taskId = sub.body.task_id;
await call('engineering_task_ceo_authorize_agent', { id: taskId, runner_eligible: true, ceo_session_token: CEO });
const claim = await call('engineering_worker_claim_task', { ...W, task_id: taskId, mode: 'runner' });
const RUN = claim.body.run_id;
const gw = (op, extra = {}) => call('engineering_agent_gateway', { ...W, task_id: taskId, agent_run_id: RUN, op, ...extra });
const id8 = taskId.slice(0, 8);
const B = (n) => `runner/${id8}-${n}`;
const open = (branch, extra = {}) => gw('open_runner_pull_request', { branch, base_sha: BASE, title: 'Proof marker', summary: 'Adds the proof file.', ...extra });
ok('setup: runner claim', claim.status === 200 && !!RUN);

// P1–P3: fail closed without the App settings; nothing reaches GitHub.
addStagingBranch(B('proof'), [{ filename: 'docs/platform/runner-proof/proof.txt', status: 'added', content: 'proof 035\n' }]);
let r = await open(B('proof'));
ok('P1 without the PR-opener settings: 503 pr_opener_not_configured', r.status === 503 && r.body.error === 'pr_opener_not_configured');
ok('P2 …and no GitHub call was made', sim.calls.length === 0, sim.calls.join(' | '));
ok('P3 …and the refusal is audited', db.brain_agent_runs.some(a => a.task_id === taskId && a.output && a.output.reason === 'pr_opener_not_configured'));
process.env.ENG_RUNNER_STAGING_REPO = GITHUB_REPO; process.env.ENG_PR_APP_ID = '1'; process.env.ENG_PR_APP_INSTALLATION_ID = '2';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
process.env.ENG_PR_APP_PRIVATE_KEY = privateKey;
r = await open(B('proof'));
ok('P4 a staging repo equal to the canonical repo is treated as not configured', r.status === 503 && sim.calls.length === 0);
process.env.ENG_RUNNER_STAGING_REPO = STAGING;

// P5–P8: input and branch checks before any GitHub call.
r = await open('runner/ok');
ok('P5 a branch not bound to the task is refused before GitHub', r.status === 400 && r.body.error === 'branch_not_bound_to_task' && sim.calls.length === 0);
r = await open(B('proof'), { base_sha: 'main' });
ok('P6 base_sha must be a full commit id', r.status === 400 && sim.calls.length === 0);
r = await open(B('proof'), { title: '<b>x</b>' });
ok('P7 markup in the title is refused', r.status === 400 && sim.calls.length === 0);
r = await open(B('proof'), { title: '' });
ok('P8 a title is required', r.status === 400 && sim.calls.length === 0);

// P9–P16: the happy path.
r = await open(B('proof'));
ok('P9 MMMOS opens a DRAFT pull request from the checked staging branch', r.status === 200 && r.body.accepted === true && r.body.draft === true && r.body.pr_number === 700, JSON.stringify(r.body));
const [hdr, claims, sig] = sim.jwt[0].split('.');
const cl = JSON.parse(Buffer.from(claims, 'base64url').toString());
ok('P10 the App JWT is RS256, short-lived, issued by the App id, and verifies with the App key', JSON.parse(Buffer.from(hdr, 'base64url').toString()).alg === 'RS256' && cl.iss === '1' && cl.exp - cl.iat <= 600
  && createVerify('RSA-SHA256').update(`${hdr}.${claims}`).verify(publicKey, Buffer.from(sig, 'base64url')));
ok('P11 the installation token is narrowed to the two repositories and contents/pull_requests/metadata only', JSON.stringify(sim.tokens[0].repositories.sort()) === JSON.stringify(['mmmos', 'mmmos-runner-staging']) && JSON.stringify(sim.tokens[0].permissions) === JSON.stringify({ contents: 'write', pull_requests: 'write', metadata: 'read' }));
ok('P12 the commit is built on the runner base commit, with the exact staging blob', sim.lastCommit.parents[0] === BASE && sim.lastTree.tree.length === 1 && sim.lastTree.tree[0].path === 'docs/platform/runner-proof/proof.txt' && sim.blobs[GITHUB_REPO].get(sim.lastTree.tree[0].sha).toString() === 'proof 035\n');
ok('P13 the canonical ref created is the task-bound runner branch', sim.refs.get(`refs/heads/${B('proof')}`) === 'c'.repeat(40) && [...sim.refs.keys()].every(k => k.startsWith('refs/heads/runner/')));
const pr = sim.pulls[0];
ok('P14 the PR targets main, is a draft, maintainers cannot be edited in, and states MMMOS never merges', pr.base === 'main' && pr.head === B('proof') && pr.draft === true && pr.maintainer_can_modify === false && /never merges/.test(pr.body));
const ev = db.brain_evidence.find(e => e.task_id === taskId && e.evidence_type === 'pull_request' && e.metadata && e.metadata.opened_by === 'mmmos');
ok('P15 evidence records PR, commit, staging head, base and files', ev && ev.metadata.pr_number === 700 && ev.metadata.base_sha === BASE && ev.metadata.files.length === 1 && ev.metadata.draft === true);
ok('P16 no merge call was ever attempted', !sim.mergeAttempt && !sim.calls.some(c => /merge/.test(c)));

// P17: idempotent — a second call returns the same PR and makes no GitHub calls.
const before = sim.calls.length;
r = await open(B('proof'));
ok('P17 opening again returns the existing PR without touching GitHub', r.status === 200 && r.body.already_open === true && r.body.pr_number === 700 && sim.calls.length === before);

// P18–P23: refusals use fresh tasks so the idempotency record does not hide them.
async function freshTask(label) {
  const s = await call('engineering_adviser_submit_task', { problem: label, expected_result: 'x', authorization_boundary: 'Only docs/platform/. Branch + PR only.', business: 'mmmos', priority: 'P3' }, A);
  await call('engineering_task_ceo_authorize_agent', { id: s.body.task_id, runner_eligible: true, ceo_session_token: CEO });
  const c = await call('engineering_worker_claim_task', { ...W, task_id: s.body.task_id, mode: 'runner' });
  return { id: s.body.task_id, run: c.body.run_id, b: (n) => `runner/${s.body.task_id.slice(0, 8)}-${n}` };
}
const go = (t, branch, extra = {}) => call('engineering_agent_gateway', { ...W, task_id: t.id, agent_run_id: t.run, op: 'open_runner_pull_request', branch, base_sha: BASE, title: 'x', ...extra });
let t = await freshTask('outside');
addStagingBranch(t.b('outside'), [{ filename: 'docs/platform/a.txt', status: 'added', content: 'a' }, { filename: 'lib/nextwaveV2Renderer/core.mjs', status: 'modified', content: 'evil' }]);
let pulls = sim.pulls.length, refs = sim.refs.size;
r = await go(t, t.b('outside'));
ok('P18 another business\'s file is refused before anything is written to the canonical repo', r.status === 409 && r.body.error === 'paths_outside_business_allowlist' && r.body.outside.includes('lib/nextwaveV2Renderer/core.mjs') && sim.pulls.length === pulls && sim.refs.size === refs);
t = await freshTask('build');
addStagingBranch(t.b('build'), [{ filename: 'docs/platform/a.txt', status: 'added', content: 'a' }, { filename: '.npmrc', status: 'added', content: 'node-options=--require ./x.js' }]);
r = await go(t, t.b('build'));
ok('P19 build/install config is refused (.npmrc)', r.status === 409 && r.body.denied.includes('.npmrc') && sim.pulls.length === pulls);
t = await freshTask('rename');
addStagingBranch(t.b('rename'), [{ filename: 'docs/platform/moved.txt', previous_filename: 'api/ops.js', status: 'renamed', content: 'x' }]);
r = await go(t, t.b('rename'));
ok('P20 a rename out of a protected file counts its old path (api/ops.js not granted)', r.status === 409 && r.body.outside.includes('api/ops.js'));
t = await freshTask('base');
addStagingBranch(t.b('base'), [{ filename: 'docs/platform/a.txt', status: 'added', content: 'a' }]);
r = await go(t, t.b('base'), { base_sha: '9'.repeat(40) });
ok('P21 a base commit that is not on main is refused', r.status === 409 && r.body.error === 'base_not_on_main' && sim.pulls.length === pulls);
t = await freshTask('mismatch');
addStagingBranch(t.b('mismatch'), [{ filename: 'docs/platform/a.txt', status: 'added', content: 'zz' }]);
sim.failBlobCopy = true;
r = await go(t, t.b('mismatch'));
sim.failBlobCopy = false;
ok('P22 a copied blob whose id differs from the staging blob is refused (no PR)', r.status === 502 && r.body.error === 'blob_copy_mismatch' && sim.pulls.length === pulls);
t = await freshTask('many');
addStagingBranch(t.b('many'), Array.from({ length: 101 }, (_, i) => ({ filename: `docs/platform/f${i}.txt`, status: 'added', content: String(i) })));
r = await go(t, t.b('many'));
ok('P23 more than 100 files is refused', r.status === 409 && r.body.error === 'too_many_files');

// P24–P26: who may call it.
const mid = randomUUID();
db.engineering_tasks.push({ id: mid, problem: 'manual', expected_result: 'x', affected_engine: 'Frontend', status: 'open', priority: 'low', packet: { business: 'mmmos', origin_decision: { authorization_boundary: 'b' } } });
await call('engineering_task_ceo_authorize_agent', { id: mid, ceo_session_token: CEO });
const mc = await call('engineering_worker_claim_task', { ...W, task_id: mid });
r = await call('engineering_agent_gateway', { ...W, task_id: mid, agent_run_id: mc.body.run_id, op: 'open_runner_pull_request', branch: `runner/${mid.slice(0, 8)}-x`, base_sha: BASE, title: 'x' });
ok('P24 a manual (non-runner) claim cannot use the PR opener', r.status === 403 && r.body.error === 'runner_task_required');
db.mmm_platform_flags.find(f => f.flag === 'eng_runner').enabled = false;
t = await freshTask('off');
r = await open(B('proof'));
ok('P25 with eng_runner OFF the PR opener is refused like every runner op', r.status === 409 && r.body.error === 'runner_disabled');
db.mmm_platform_flags.find(f => f.flag === 'eng_runner').enabled = true;
r = await call('engineering_agent_gateway', { worker_credential: 'x'.repeat(64), task_id: taskId, agent_run_id: RUN, op: 'open_runner_pull_request', branch: B('proof'), base_sha: BASE, title: 'x' });
ok('P26 a wrong worker credential is refused', r.status === 401);

// P27: static — the PR-opener code contains no merge call.
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'api', 'ops.js'), 'utf8');
const a = src.indexOf('// ── 035 — PR opener (H4)'), b = src.indexOf('async function _engGithubBranchFacts', a);
const h = src.indexOf("} else if (op === 'open_runner_pull_request') {"), e = src.indexOf("} else if (op === 'submit_pull_request') {", h);
const code = src.slice(a, b) + src.slice(h, e);
ok('P27 the PR-opener source has no merge endpoint and no PUT', a > 0 && h > 0 && !/\/merge/.test(code) && !/'PUT'/.test(code));

console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
