// MMMOS-R2 Order 043 — CEO Artifacts view (server side). Real api/ops.js against the in-memory stand-in.
// Run: node tests/platform/test_engineering_artifacts_view_043.mjs
import { db, storage, call, ceoToken, makeOk, sha, randomUUID } from './engineering-harness.mjs';
const T = makeOk(); const ok = T.ok;
const CEO = ceoToken();
const WORKER = '9'.repeat(64);
db.engineering_workers.push({ id: randomUUID(), label: 'Worker', credential_hash: sha(WORKER), active: true });

// Two tasks in different businesses, each with its own stored artifacts.
const A = randomUUID(), B = randomUUID(), run = 'a'.repeat(32);
db.engineering_tasks.push(
  { id: A, problem: 'Checkpoint archive', expected_result: 'x', affected_engine: 'Engineering Tasks', status: 'open', packet: {} },
  { id: B, problem: 'SRV task', expected_result: 'x', affected_engine: 'SRV Farsi', status: 'open', packet: { business: 'srv_farsi' } });
const art = (task, biz, file, extra = {}) => {
  const object_path = `${biz}/${task}/${run}/1-${file}`;
  storage.objects.set(object_path, { size: 10, mimetype: 'text/plain' });
  const row = { id: randomUUID(), task_id: task, evidence_type: 'artifact', title: file, created_at: new Date().toISOString(),
    metadata: { bucket: 'engineering-artifacts', object_path, artifact_kind: 'checkpoint', size_bytes: 10, mime_type: 'text/plain', sha256: 'f'.repeat(64), sha256_verified: true, ...extra } };
  db.brain_evidence.push(row); return row;
};
const a1 = art(A, 'unassigned', 'R2_CHECKPOINT_041.txt');
const a2 = art(A, 'unassigned', 'ARCHIVE_042_MANIFEST.sha256.txt');
const b1 = art(B, 'srv_farsi', 'srv-qa.txt');
// A forged row on task A pointing at task B's object (cross-task / cross-business).
const forged = { id: randomUUID(), task_id: A, evidence_type: 'artifact', title: 'forged.txt', created_at: new Date().toISOString(),
  metadata: { bucket: 'engineering-artifacts', object_path: b1.metadata.object_path, size_bytes: 10, sha256: 'e'.repeat(64) } };
db.brain_evidence.push(forged);
db.brain_evidence.push({ id: randomUUID(), task_id: A, evidence_type: 'note', title: 'a note', created_at: new Date().toISOString(), metadata: {} });

const actions = ['engineering_artifacts_index', 'engineering_task_artifacts', 'engineering_artifact_download_link'];
for (const a of actions) {
  let r = await call(a, { task_id: A, artifact_id: a1.id });
  ok(`${a}: anonymous caller refused (401)`, r.status === 401 && r.body.error === 'ceo_session_required');
  r = await call(a, { task_id: A, artifact_id: a1.id, worker_credential: WORKER });
  ok(`${a}: a worker credential is not enough (401)`, r.status === 401);
  r = await call(a, { task_id: A, artifact_id: a1.id, ceo_session_token: 'forged.token' });
  ok(`${a}: a forged CEO token is refused (401)`, r.status === 401);
}

let r = await call('engineering_artifacts_index', { ceo_session_token: CEO });
const ia = (r.body.tasks || []).find(t => t.task_id === A);
ok('index lists tasks with artifact counts, sizes and last upload', r.status === 200 && ia && ia.files === 3 && ia.total_bytes === 30 && !!ia.last_upload, JSON.stringify(r.body).slice(0, 200));
ok('index never contains storage paths', !JSON.stringify(r.body).includes('/1-') && !JSON.stringify(r.body).includes('object_path'));

r = await call('engineering_task_artifacts', { task_id: A, ceo_session_token: CEO });
const names = (r.body.artifacts || []).map(x => x.name);
ok('task view lists only artifacts stored in that task\'s own folder', r.status === 200 && names.length === 2 && names.includes('R2_CHECKPOINT_041.txt') && names.includes('ARCHIVE_042_MANIFEST.sha256.txt'), JSON.stringify(names));
ok('the forged cross-task row and non-artifact evidence are excluded', !names.includes('forged.txt') && !names.includes('a note'));
const f = (r.body.artifacts || [])[0] || {};
ok('each file shows name, size, SHA-256, verified flag, upload date and checkpoint', f.artifact_id && f.size_bytes === 10 && f.sha256 === 'f'.repeat(64) && f.sha256_verified === true && f.uploaded_at && (r.body.artifacts.find(x => x.name === 'R2_CHECKPOINT_041.txt') || {}).checkpoint === '041');
ok('task view never contains storage paths', !JSON.stringify(r.body).includes('object_path') && !JSON.stringify(r.body).includes(run));
r = await call('engineering_task_artifacts', { task_id: 'not-a-uuid', ceo_session_token: CEO });
ok('a malformed task id is refused (400)', r.status === 400);
r = await call('engineering_task_artifacts', { task_id: randomUUID(), ceo_session_token: CEO });
ok('an unknown task is 404 (no enumeration of other data)', r.status === 404);

r = await call('engineering_artifact_download_link', { task_id: A, artifact_id: a1.id, ceo_session_token: CEO });
ok('CEO gets a signed link for one file, valid 120 seconds', r.status === 200 && /\/storage\/v1\/object\/sign\/engineering-artifacts\//.test(r.body.url || '') && r.body.expires_in_s === 120 && storage.lastSignBody && storage.lastSignBody.expiresIn === 120, JSON.stringify(r.body));
ok('the link response carries the expected SHA-256 for checking the download', r.body.sha256 === 'f'.repeat(64) && r.body.size_bytes === 10);
r = await call('engineering_artifact_download_link', { task_id: B, artifact_id: a1.id, ceo_session_token: CEO });
ok('an artifact id used with another task is refused (404)', r.status === 404 && r.body.error === 'artifact_not_found');
r = await call('engineering_artifact_download_link', { task_id: A, artifact_id: forged.id, ceo_session_token: CEO });
ok('a forged row pointing into another business\'s folder gets no link (404)', r.status === 404);
r = await call('engineering_artifact_download_link', { task_id: A, artifact_id: 'x', ceo_session_token: CEO });
ok('a malformed artifact id is refused (400)', r.status === 400);
storage.objects.delete(a2.metadata.object_path);
r = await call('engineering_artifact_download_link', { task_id: A, artifact_id: a2.id, ceo_session_token: CEO });
ok('a missing stored object yields no link (502), not a broken URL', r.status === 502 && !r.body.url);
// Existing review packet behaviour is unchanged (still CEO-gated).
r = await call('engineering_task_review_packet', { id: A });
ok('existing review packet still requires the CEO session', r.status === 401);

console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
