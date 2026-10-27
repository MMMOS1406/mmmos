// MMMOS Engineering Integration — Release 1 tests.
// Runs the REAL api/ops.js handler against an in-memory stand-in for
// Supabase REST + Storage (global fetch is replaced before import). Never
// touches production. Migration + rollback SQL are tested separately in
// tests/platform/test_engineering_integration_r1_migration.mjs.
// Run: node tests/platform/test_engineering_integration_r1.mjs
import { createHash, createHmac, randomUUID } from 'node:crypto';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra ? '  ' + extra : ''}`); };

// ── In-memory Supabase ───────────────────────────────────────────────────────
const SB = 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SESSION_SECRET = 'test-session-secret';
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const db = {
  engineering_tasks: [], engineering_workers: [], engineering_advisers: [], brain_evidence: [],
  brain_agent_runs: [], engineering_brain: [], brain_knowledge: [], brain_learning_memory: [],
  ceo_auth_config: [{ key: 'ceo_session_secret_production', value: SESSION_SECRET }, { key: 'ceo_pin_hash_production', value: sha('0000') }],
};
const storage = { objects: new Map(), signedUploads: new Set() }; // key = path in engineering-artifacts
const calls = [];

// Emulates Postgres uuid: a 32-hex value written to a uuid column comes back hyphenated.
const toUuid = (v) => (typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v)) ? `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`.toLowerCase() : v;
const UUID_COLS = { engineering_tasks: ['agent_run_id', 'claimed_by_worker_id'] };

function getField(row, key) {
  const m = /^(\w+)->>(\w+)$/.exec(key);
  if (m) { const v = row[m[1]]?.[m[2]]; return v == null ? null : String(v); }
  return row[key];
}
function cond(row, key, expr) {
  const v = getField(row, key);
  if (expr === 'is.null') return v == null;
  if (expr === 'not.is.null') return v != null;
  if (expr.startsWith('eq.')) { const t = decodeURIComponent(expr.slice(3)); return v != null && String(v) === t; }
  if (expr.startsWith('lt.')) { const t = decodeURIComponent(expr.slice(3)); return v != null && new Date(v) < new Date(t); }
  if (expr.startsWith('in.(')) { const set = expr.slice(4, -1).split(','); return set.includes(String(v)); }
  throw new Error('unsupported filter ' + key + '=' + expr);
}
function matches(row, params) {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    if (k === 'or') {
      const inner = raw.slice(1, -1).split(',');
      if (!inner.some(p => { const i = p.indexOf('.'); return cond(row, p.slice(0, i), p.slice(i + 1)); })) return false;
      continue;
    }
    if (!cond(row, k, raw)) return false;
  }
  return true;
}
function parseQuery(qs) {
  const out = [];
  for (const part of qs.split('&').filter(Boolean)) {
    const i = part.indexOf('=');
    out.push([decodeURIComponent(part.slice(0, i)), part.slice(i + 1)]);
  }
  return out;
}
function project(row, params) {
  // Honors select like PostgREST: '*' = all columns, otherwise only the named
  // columns (and col->>key as "key").
  const sel = params.find(([k]) => k === 'select')?.[1];
  if (!sel) return { ...row };
  const out = {};
  for (const s of decodeURIComponent(sel).split(',')) {
    if (s === '*') { Object.assign(out, row); continue; }
    const m = /^(\w+)->>(\w+)$/.exec(s);
    if (m) out[m[2]] = row[m[1]]?.[m[2]] ?? null;
    else out[s] = row[s] ?? null;
  }
  return out;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();
  calls.push({ method, url: u });
  if (!u.startsWith(SB)) return json(599, { error: 'unexpected network call in test: ' + u });
  const path = u.slice(SB.length);
  // Storage
  if (path.startsWith('/storage/v1/object/upload/sign/engineering-artifacts/')) {
    const p = decodeURIComponent(path.slice('/storage/v1/object/upload/sign/engineering-artifacts/'.length));
    storage.signedUploads.add(p);
    return json(200, { url: `/object/upload/sign/engineering-artifacts/${p}?token=up-${sha(p).slice(0, 8)}` });
  }
  if (path === '/storage/v1/object/list/engineering-artifacts') {
    const { prefix, search } = JSON.parse(opts.body);
    const hits = [...storage.objects.entries()].filter(([k]) => k.startsWith(prefix + '/') && k.slice(prefix.length + 1).includes(search))
      .map(([k, v]) => ({ name: k.slice(prefix.length + 1), id: randomUUID(), metadata: v }));
    return json(200, hits);
  }
  if (path.startsWith('/storage/v1/object/sign/engineering-artifacts/')) {
    const p = decodeURIComponent(path.slice('/storage/v1/object/sign/engineering-artifacts/'.length));
    if (!storage.objects.has(p)) return json(404, { error: 'not found' });
    return json(200, { signedURL: `/object/sign/engineering-artifacts/${p}?token=dl-${sha(p).slice(0, 8)}` });
  }
  // REST
  const m = /^\/rest\/v1\/(\w+)\??(.*)$/.exec(path);
  if (!m) return json(404, { error: 'no route ' + path });
  const [, table, qs] = m;
  if (!db[table]) return json(404, { message: `relation "${table}" does not exist` });
  const params = parseQuery(qs);
  const uuidCols = UUID_COLS[table] || [];
  const norm = (o) => { for (const c of uuidCols) if (c in o) o[c] = toUuid(o[c]); return o; };
  if (method === 'GET') {
    let rows = db[table].filter(r => matches(r, params));
    const off = params.find(([k]) => k === 'offset'); if (off) rows = rows.slice(Number(off[1]));
    const lim = params.find(([k]) => k === 'limit'); if (lim) rows = rows.slice(0, Number(lim[1]));
    return json(200, rows.map(r => project(r, params)));
  }
  if (method === 'POST') {
    const body = JSON.parse(opts.body);
    const list = Array.isArray(body) ? body : [body];
    const inserted = list.map(r => norm({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
    db[table].push(...inserted);
    return json(201, inserted);
  }
  if (method === 'PATCH') {
    const patch = norm(JSON.parse(opts.body));
    const rows = db[table].filter(r => matches(r, params));
    rows.forEach(r => Object.assign(r, patch));
    return json(200, rows);
  }
  return json(405, {});
};

process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('../../api/ops.js');

async function call(action, body = {}, { method = 'POST', headers = {} } = {}) {
  const req = { method, query: { action }, body, headers };
  let status = 200, payload;
  const res = {
    setHeader() {}, removeHeader() {}, end() { return res; },
    status(s) { status = s; return res; }, json(p) { payload = p; return res; },
  };
  await handler(req, res);
  return { status, body: payload };
}
function ceoToken() {
  const payload = Buffer.from(JSON.stringify({ sub: 'ceo', exp: Date.now() + 3600e3 })).toString('base64url');
  return `${payload}.${createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')}`;
}
const CEO = ceoToken();

// Seed: one worker and one CEO-authorized task with a boundary.
const WORKER_CRED = 'a'.repeat(64);
db.engineering_workers.push({ id: randomUUID(), label: 'Test Worker', credential_hash: sha(WORKER_CRED), active: true });
const seededTaskId = randomUUID();
db.engineering_tasks.push({
  id: seededTaskId, problem: 'Seeded task', expected_result: 'x', affected_engine: 'MMMOS', priority: 'high', status: 'open',
  packet: { created_via: 'task_generator', business: 'mmmos', origin_decision: { id: 'd1', authorization_boundary: 'Only touch sandbox.' } },
  agent_authorized_at: new Date().toISOString(), agent_authorization_revoked_at: null, agent_claimed_at: null, lease_expires_at: null,
  agent_capability_scope: { read_paths: [], write_paths: [], validation_ops: [] }, agent_authorization_token_hash: sha('legacy-token'),
});

// ════ 1. Gateway run_id fix ═════════════════════════════════════════════════
{
  const claim = await call('engineering_worker_claim_task', { worker_credential: WORKER_CRED, task_id: seededTaskId });
  ok('worker claim succeeds', claim.status === 200 && /^[0-9a-f]{32}$/.test(claim.body.run_id), JSON.stringify(claim));
  const runHex = claim.body.run_id;
  const stored = db.engineering_tasks.find(t => t.id === seededTaskId).agent_run_id;
  ok('stored run id comes back hyphenated (the original mismatch condition)', stored !== runHex && stored.replace(/-/g, '') === runHex);

  const gw = (run, op = 'read_task_packet', extra = {}) => call('engineering_agent_gateway', { worker_credential: WORKER_CRED, task_id: seededTaskId, agent_run_id: run, op, ...extra });
  let r = await gw(runHex);
  ok('gateway accepts the run id exactly as the claim returned it (was 401 before fix)', r.status === 200 && r.body.ok && r.body.problem === 'Seeded task' || (r.status === 200 && r.body.ok), JSON.stringify(r));
  r = await gw(stored);
  ok('gateway accepts the hyphenated form too', r.status === 200);
  r = await gw(runHex.toUpperCase());
  ok('gateway accepts upper-case hex', r.status === 200);
  r = await gw('f'.repeat(32));
  ok('gateway rejects a different run id', r.status === 401 && r.body.error === 'agent_gateway_verification_failed');
  r = await gw('not-a-run-id');
  ok('gateway rejects a malformed run id', r.status === 401);
  r = await gw(runHex.slice(0, 31));
  ok('gateway rejects a truncated run id', r.status === 401);
  r = await call('engineering_agent_gateway', { agent_token: 'legacy-token', task_id: seededTaskId, agent_run_id: runHex, op: 'read_authorization_boundary' });
  ok('legacy per-task token path also works with the fix', r.status === 200 && r.body.authorization_boundary === 'Only touch sandbox.', JSON.stringify(r));
  r = await call('engineering_agent_gateway', { worker_credential: 'b'.repeat(64), task_id: seededTaskId, agent_run_id: runHex, op: 'read_task_packet' });
  ok('unknown worker credential still rejected', r.status === 401);
  r = await gw(runHex, 'deploy_production');
  ok('ops outside the whitelist still denied', r.status === 403 && r.body.error === 'capability_denied');

  // Lease expiry still enforced.
  const t = db.engineering_tasks.find(x => x.id === seededTaskId);
  const savedLease = t.lease_expires_at;
  t.lease_expires_at = new Date(Date.now() - 1000).toISOString();
  r = await gw(runHex);
  ok('expired lease still rejected', r.status === 401);
  t.lease_expires_at = savedLease;

  // ════ 2. Artifacts ════════════════════════════════════════════════════════
  r = await gw(runHex, 'create_artifact_upload', { file_name: '../../etc/passwd.txt' });
  ok('artifact upload rejects traversal file names', r.status === 400);
  r = await gw(runHex, 'create_artifact_upload', { file_name: 'noextension' });
  ok('artifact upload rejects names without an extension', r.status === 400);
  r = await gw(runHex, 'create_artifact_upload', { file_name: 'final_short.mp4' });
  const objPath = r.body.object_path;
  ok('artifact upload returns a signed URL in this task\'s own folder', r.status === 200
    && objPath.startsWith(`mmmos/${seededTaskId}/${runHex}/`) && objPath.endsWith('-final_short.mp4')
    && r.body.upload_url.startsWith(`${SB}/storage/v1/object/upload/sign/engineering-artifacts/`) && r.body.method === 'PUT', JSON.stringify(r));
  r = await gw(runHex, 'submit_artifact', { object_path: objPath, artifact_kind: 'video', title: 'Final Short' });
  ok('registering before upload fails (server checks storage)', r.status === 404 && r.body.error === 'artifact_not_found');
  storage.objects.set(objPath, { size: 1234567, mimetype: 'video/mp4' }); // simulate the worker's PUT
  r = await gw(runHex, 'submit_artifact', { object_path: objPath, artifact_kind: 'video', title: 'Final Short', description: 'QA passed' });
  const ev = db.brain_evidence.find(e => e.evidence_type === 'artifact');
  ok('registering after upload records evidence with storage-derived size/type', r.status === 200 && ev
    && ev.metadata.object_path === objPath && ev.metadata.size_bytes === 1234567 && ev.metadata.mime_type === 'video/mp4'
    && ev.metadata.bucket === 'engineering-artifacts' && ev.metadata.non_authoritative === true, JSON.stringify(r));
  const otherTask = randomUUID();
  storage.objects.set(`mmmos/${otherTask}/${runHex}/1-x.mp4`, { size: 1, mimetype: 'video/mp4' });
  r = await gw(runHex, 'submit_artifact', { object_path: `mmmos/${otherTask}/${runHex}/1-x.mp4` });
  ok('cannot register another task\'s file', r.status === 403);
  r = await gw(runHex, 'submit_artifact', { object_path: `nextwave/${seededTaskId}/${runHex}/1-x.mp4` });
  ok('cannot register a file under another business', r.status === 403);
  r = await gw(runHex, 'submit_artifact', { object_path: `mmmos/${seededTaskId}/../${otherTask}/1-x.mp4` });
  ok('path traversal in object_path rejected', r.status === 403);
  ok('task status unchanged by artifact ops', db.engineering_tasks.find(x => x.id === seededTaskId).status === 'open');
}

// ════ 3. CEO Adviser identity ═══════════════════════════════════════════════
let ADVISER_CRED;
{
  let r = await call('engineering_adviser_provision', { label: 'ChatGPT CEO Adviser' });
  ok('provision without CEO session is refused', r.status === 401);
  r = await call('engineering_adviser_provision', { label: 'ChatGPT CEO Adviser', ceo_session_token: CEO });
  ADVISER_CRED = r.body.adviser_credential;
  const row = db.engineering_advisers[0];
  ok('CEO can provision an adviser; only the hash is stored', r.status === 200 && /^[0-9a-f]{64}$/.test(ADVISER_CRED)
    && row.credential_hash === sha(ADVISER_CRED) && !JSON.stringify(db.engineering_advisers).includes(ADVISER_CRED));
  r = await call('engineering_adviser_list', { ceo_session_token: CEO });
  ok('adviser list never includes the credential hash', r.status === 200 && r.body.advisers.length === 1 && !('credential_hash' in r.body.advisers[0]));
}

const bearer = (c) => ({ headers: { authorization: `Bearer ${c}` } });
const goodTask = {
  problem: 'Fix the Approve video caption timing in the SRV Farsi Short preview.',
  expected_result: 'Captions match the vocal within 100 ms.',
  authorization_boundary: 'Branch + PR only. SRV Farsi Short preview files only. No production, no migrations.',
  business: 'srv_farsi', priority: 'high', acceptance_criteria: 'QA report with 3 test renders',
};
let advTaskId;
{
  let r = await call('engineering_adviser_submit_task', goodTask);
  ok('submit without credential → 401', r.status === 401 && r.body.error === 'adviser_authentication_failed');
  r = await call('engineering_adviser_submit_task', goodTask, bearer(WORKER_CRED));
  ok('a worker credential cannot act as the adviser', r.status === 401);
  r = await call('engineering_worker_list_authorized_tasks', { worker_credential: ADVISER_CRED });
  ok('the adviser credential cannot act as a worker', r.status === 401);
  r = await call('engineering_adviser_submit_task', goodTask, { method: 'GET', ...bearer(ADVISER_CRED) });
  ok('GET is refused', r.status === 405);
  r = await call('engineering_adviser_submit_task', { ...goodTask, authorization_boundary: '' }, bearer(ADVISER_CRED));
  ok('authorization boundary is required', r.status === 400);
  r = await call('engineering_adviser_submit_task', { ...goodTask, business: 'all' }, bearer(ADVISER_CRED));
  ok('business must be one named business', r.status === 400);

  r = await call('engineering_adviser_submit_task', { ...goodTask, submission_idempotency_key: 'k-1' }, bearer(ADVISER_CRED));
  advTaskId = r.body.task_id;
  const t = db.engineering_tasks.find(x => x.id === advTaskId);
  ok('adviser task lands open and NOT authorized', r.status === 200 && t && t.status === 'open' && !t.agent_authorized_at && t.ceo_decision == null);
  ok('adviser task carries business, boundary and provenance', t.packet.business === 'srv_farsi'
    && t.packet.origin_decision.authorization_boundary === goodTask.authorization_boundary
    && t.packet.derived_from === 'ceo_adviser_submission' && t.packet.created_via === 'task_generator'
    && t.packet.submitted_by_adviser_id === db.engineering_advisers[0].id);
  const before = db.engineering_tasks.length;
  r = await call('engineering_adviser_submit_task', { ...goodTask, submission_idempotency_key: 'k-1', adviser_credential: ADVISER_CRED });
  ok('retry with the same idempotency key returns the same task (body credential also accepted)', r.status === 200 && r.body.deduped === true && r.body.task_id === advTaskId && db.engineering_tasks.length === before);

  r = await call('engineering_worker_list_authorized_tasks', { worker_credential: WORKER_CRED });
  ok('unauthorized adviser task is not offered to workers', r.status === 200 && !r.body.tasks.some(x => x.id === advTaskId));
  r = await call('engineering_worker_claim_task', { worker_credential: WORKER_CRED, task_id: advTaskId });
  ok('worker cannot claim it before the CEO authorizes', r.status === 409 && r.body.error === 'task_not_authorized');
  r = await call('engineering_task_ceo_authorize_agent', { id: advTaskId, adviser_credential: ADVISER_CRED }, bearer(ADVISER_CRED));
  ok('the adviser cannot authorize its own task', r.status === 401);
}

// ════ 4. End to end: adviser → CEO → worker → adviser ═══════════════════════
{
  let r = await call('engineering_task_ceo_authorize_agent', { id: advTaskId, ceo_session_token: CEO });
  ok('CEO authorizes the adviser task (boundary is where the gate reads it)', r.status === 200, JSON.stringify(r));
  r = await call('engineering_worker_claim_task', { worker_credential: WORKER_CRED, task_id: advTaskId });
  const run = r.body.run_id;
  ok('worker claims the authorized adviser task', r.status === 200);
  const gw = (op, extra = {}) => call('engineering_agent_gateway', { worker_credential: WORKER_CRED, task_id: advTaskId, agent_run_id: run, op, ...extra });
  r = await gw('read_authorization_boundary');
  ok('worker reads the adviser-written boundary', r.status === 200 && r.body.authorization_boundary === goodTask.authorization_boundary);

  r = await call('engineering_adviser_post_followup', { task_id: advTaskId, kind: 'correction', message: 'Captions drift after 0:20; fix and re-render.' }, bearer(ADVISER_CRED));
  ok('adviser posts a follow-up', r.status === 200 && r.body.kind === 'correction');
  r = await call('engineering_adviser_post_followup', { task_id: randomUUID(), message: 'x' }, bearer(ADVISER_CRED));
  ok('follow-up on a missing task → 404', r.status === 404);
  r = await gw('read_adviser_followups');
  ok('worker reads the follow-up through the gateway', r.status === 200 && r.body.followups.length === 1 && r.body.followups[0].kind === 'correction');

  r = await gw('create_artifact_upload', { file_name: 'qa_report.md' });
  const p = r.body.object_path;
  ok('artifact path uses the task\'s business folder', p.startsWith(`srv_farsi/${advTaskId}/`));
  storage.objects.set(p, { size: 2048, mimetype: 'text/markdown' });
  r = await gw('submit_artifact', { object_path: p, artifact_kind: 'qa_report', title: 'QA report' });
  ok('worker registers the QA report', r.status === 200);
  await gw('submit_evidence', { evidence_type: 'note', title: 'PR opened', content: 'https://github.com/MMMOS1406/mmmos/pull/999' });

  r = await call('engineering_adviser_get_results', { task_id: advTaskId }, bearer(ADVISER_CRED));
  const b = r.body;
  ok('adviser reads results: artifacts with signed download links', r.status === 200 && b.artifacts.length === 1
    && b.artifacts[0].download_url.startsWith(`${SB}/storage/v1/object/sign/engineering-artifacts/`) && b.artifacts[0].artifact_kind === 'qa_report', JSON.stringify(b).slice(0, 400));
  ok('adviser reads results: follow-ups and evidence', b.followups.length === 1 && b.evidence.some(e => e.title === 'PR opened'));
  ok('results include business and boundary, never secrets', b.task.business === 'srv_farsi' && b.task.authorization_boundary === goodTask.authorization_boundary
    && !JSON.stringify(b).includes('token_hash') && !JSON.stringify(b).includes('credential') && !('packet' in b.task));
  ok('task status unchanged by adviser and worker evidence', db.engineering_tasks.find(x => x.id === advTaskId).status === 'open');

  r = await call('engineering_adviser_get_results', {}, bearer(ADVISER_CRED));
  ok('list mode returns only adviser-submitted tasks', r.status === 200 && r.body.tasks.length === 1 && r.body.tasks[0].id === advTaskId && r.body.tasks[0].business === 'srv_farsi');
  r = await call('engineering_adviser_get_results', { task_id: 'nope' }, bearer(ADVISER_CRED));
  ok('malformed task id → 400', r.status === 400);
}

// ════ 5. Revocation ═════════════════════════════════════════════════════════
{
  const id = db.engineering_advisers[0].id;
  let r = await call('engineering_adviser_revoke', { id, ceo_session_token: CEO });
  ok('CEO revokes the adviser', r.status === 200);
  r = await call('engineering_adviser_get_results', {}, bearer(ADVISER_CRED));
  ok('revoked adviser is refused immediately', r.status === 401);
}

// ════ 5b. Readiness-review corrections C1–C5 ═══════════════════════════════
let AC2;
{
  const pr = await call('engineering_adviser_provision', { label: 'Adviser 2', ceo_session_token: CEO });
  AC2 = pr.body.adviser_credential;
}
const H2 = { headers: { authorization: `Bearer ${AC2}` } };
{
  // C1 — no markup from the adviser or in worker artifact text.
  const tasksBefore = db.engineering_tasks.length, evBefore = db.brain_evidence.length;
  const xss = '<img src=x onerror="fetch(1)">';
  for (const field of ['problem', 'expected_result', 'authorization_boundary', 'acceptance_criteria', 'affected_engine']) {
    const r = await call('engineering_adviser_submit_task', { ...goodTask, [field]: `Fix it ${xss}` }, H2);
    ok(`C1 HTML refused in ${field}`, r.status === 400 && /must not contain < or >/.test(r.body.error), JSON.stringify(r.body));
  }
  let r = await call('engineering_adviser_submit_task', { ...goodTask, problem: 'Show 3 > 2 items' }, H2);
  ok('C1 a lone ">" is refused too', r.status === 400);
  r = await call('engineering_adviser_post_followup', { task_id: advTaskId, message: '<script>steal()</script>' }, H2);
  ok('C1 HTML refused in follow-up messages', r.status === 400);
  ok('C1 nothing was written by refused requests', db.engineering_tasks.length === tasksBefore && db.brain_evidence.length === evBefore);
  r = await call('engineering_adviser_submit_task', { ...goodTask, problem: 'Fix "quotes" & ampersands, 50% faster' }, H2);
  ok('C1 ordinary punctuation is still accepted', r.status === 200);
}
{
  // C1/C5 on the worker artifact path.
  const claim = await call('engineering_worker_claim_task', { worker_credential: WORKER_CRED, task_id: seededTaskId });
  const run = claim.body.run_id || db.engineering_tasks.find(t => t.id === seededTaskId).agent_run_id;
  const gw = (op, extra = {}) => call('engineering_agent_gateway', { worker_credential: WORKER_CRED, task_id: seededTaskId, agent_run_id: run, op, ...extra });
  let r = await gw('create_artifact_upload', { file_name: 'shot.png' });
  const p = r.body.object_path;
  storage.objects.set(p, { size: 10, mimetype: 'image/png' });
  r = await gw('submit_artifact', { object_path: p, title: '<b>shot</b>' });
  ok('C1 HTML refused in artifact titles', r.status === 400);
  r = await gw('submit_artifact', { object_path: p, description: 'x'.repeat(5001) });
  ok('C5 over-length artifact description refused', r.status === 400 && /too long/.test(r.body.error));
  r = await gw('submit_artifact', { object_path: p, artifact_kind: 'movie' });
  ok('C5 unknown artifact_kind refused', r.status === 400);
  r = await gw('submit_artifact', { object_path: p, artifact_kind: 'screenshot', title: 'Approve page' });
  const audit = db.brain_agent_runs.find(a => a.action === 'gateway:submit_artifact' && a.status === 'allowed' && a.output?.object_path === p);
  ok('C5 successful artifact registration is audited', r.status === 200 && !!audit);
}
{
  // C2 — the adviser sees and comments on its own tasks only.
  const evBefore = db.brain_evidence.length;
  let r = await call('engineering_adviser_get_results', { task_id: seededTaskId }, H2);
  ok('C2 non-adviser task reads as task_not_found', r.status === 404 && r.body.error === 'task_not_found');
  r = await call('engineering_adviser_post_followup', { task_id: seededTaskId, message: 'hello' }, H2);
  ok('C2 follow-up on a non-adviser task refused as task_not_found', r.status === 404);
  ok('C2 refused follow-up wrote nothing', db.brain_evidence.length === evBefore);
  r = await call('engineering_adviser_get_results', { task_id: advTaskId }, H2);
  ok('C2 adviser-submitted tasks are still readable', r.status === 200 && r.body.task.id === advTaskId);
}
{
  // C3 — bounded, paginated responses.
  for (let i = 0; i < 200; i++) db.brain_evidence.push({ id: randomUUID(), task_id: advTaskId, evidence_type: 'note', title: 'bulk ' + i, content: 'x'.repeat(5000), metadata: {}, created_at: new Date(Date.now() + 1000 + i).toISOString() });
  const total = db.brain_evidence.filter(e => e.task_id === advTaskId).length;
  let cursor, pages = 0, seen = new Set(), maxLen = 0, maxItems = 0, truncated = false;
  do {
    const r = await call('engineering_adviser_get_results', { task_id: advTaskId, ...(cursor !== undefined ? { cursor } : {}) }, H2);
    if (r.status !== 200) { ok('C3 paging call succeeds', false, JSON.stringify(r.body)); break; }
    const len = JSON.stringify(r.body).length; maxLen = Math.max(maxLen, len);
    const items = [...r.body.evidence, ...r.body.artifacts, ...r.body.followups];
    maxItems = Math.max(maxItems, items.length);
    items.forEach(i => seen.add(i.id));
    truncated = truncated || r.body.evidence.some(e => e.content_truncated && e.content.length === 1500);
    cursor = r.body.next_cursor; pages++;
  } while (cursor !== null && pages < 50);
  ok('C3 every response stays under 60,000 characters', maxLen <= 60000, String(maxLen));
  ok('C3 at most 30 evidence entries per page', maxItems <= 30, String(maxItems));
  ok('C3 long evidence text is shortened and flagged', truncated);
  ok('C3 paging returns every evidence entry exactly once', seen.size === total, `${seen.size}/${total}`);
  let r = await call('engineering_adviser_get_results', { task_id: advTaskId, cursor: 'abc' }, H2);
  ok('C3 malformed cursor refused', r.status === 400);
  r = await call('engineering_adviser_get_results', {}, H2);
  ok('C3 task list stays within budget', r.status === 200 && JSON.stringify(r.body).length <= 60000);
}
{
  // C5 — input handling.
  let r = await call('engineering_adviser_get_results', {}, { headers: { authorization: `bearer ${AC2}` } });
  ok('C5 lowercase "bearer" accepted', r.status === 200);
  r = await call('engineering_adviser_submit_task', { ...goodTask, priority: 'P1' }, H2);
  ok('C5 P1 maps to high', r.status === 200 && db.engineering_tasks.find(t => t.id === r.body.task_id).priority === 'high');
  r = await call('engineering_adviser_submit_task', { ...goodTask, priority: 'p3' }, H2);
  ok('C5 p3 maps to low', r.status === 200 && db.engineering_tasks.find(t => t.id === r.body.task_id).priority === 'low');
  r = await call('engineering_adviser_submit_task', { ...goodTask, priority: 'urgent' }, H2);
  ok('C5 unknown priority refused, not guessed', r.status === 400);
  r = await call('engineering_adviser_submit_task', { ...goodTask, problem: 'p'.repeat(5001) }, H2);
  ok('C5 over-length problem refused instead of cut', r.status === 400 && /too long/.test(r.body.error));
  r = await call('engineering_adviser_submit_task', { ...goodTask, problem: 'p'.repeat(5000) }, H2);
  ok('C5 problem at exactly the limit accepted', r.status === 200);
  r = await call('engineering_adviser_submit_task', { ...goodTask, parent_task_id: 'not-a-uuid' }, H2);
  ok('C5 malformed parent_task_id refused', r.status === 400);
  r = await call('engineering_adviser_post_followup', { task_id: advTaskId, message: 'm'.repeat(5001) }, H2);
  ok('C5 over-length follow-up refused', r.status === 400);
  r = await call('engineering_adviser_post_followup', { task_id: advTaskId, kind: 'order', message: 'x' }, H2);
  ok('C5 unknown follow-up kind refused', r.status === 400);
  r = await call('engineering_adviser_submit_task', { ...goodTask, problem: 12345 }, H2);
  ok('C5 non-text field refused', r.status === 400);
}

// ════ 6. Fail-closed when the migration has not been applied ═══════════════
{
  const saved = db.engineering_advisers; delete db.engineering_advisers;
  const r = await call('engineering_adviser_submit_task', goodTask, bearer(ADVISER_CRED));
  ok('without the adviser table the actions fail closed (401)', r.status === 401);
  db.engineering_advisers = saved;
}
ok('no network call left the in-memory Supabase', calls.every(c => c.url.startsWith(SB)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
