// Order 043 — CEO Artifacts view (UI). Loads the real helpers from public/index.html with a stub page.
// Run: node tests/platform/test_engineering_artifacts_ui_043.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
const grab = (name) => { const i = html.indexOf(`function ${name}(`); if (i < 0) throw new Error('missing ' + name); const st = html.lastIndexOf('\n', i) + 1; let d = 0; for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(st, k + 1); } };
const names = ['escHTML', '_engAttr', '_engErrMsg', '_engArtifactsSection', '_engFmtBytes', '_engArtifactsLoad', '_engArtifactsOpen', '_engSha256Hex', '_engArtifactDownload'];
const calls = []; const alerts = []; const saved = [];
let responses = {}; let fetched = null;
const el = { innerHTML: '' };
const env = {
  document: { getElementById: () => el, createElement: () => ({ click() { saved.push(this.download); }, remove() {} }), body: { appendChild() {} } },
  _ceoAuthedFetch: async (url, body) => { calls.push([url, body]); const a = /action=([a-z_]+)/.exec(url)[1]; return { json: async () => responses[a] }; },
  fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => fetched }),
  alert: (m) => alerts.push(m), window: { open: (u) => saved.push('open:' + u) },
};
const f = new Function(...Object.keys(env), names.map(grab).join('\n') + `; return { ${names.join(',')} };`)(...Object.values(env));

const tid = '11111111-1111-4111-8111-111111111111', aid = '22222222-2222-4222-8222-222222222222';
ok('section renders a SHOW control', f._engArtifactsSection().includes('_engArtifactsLoad()'));
responses.engineering_artifacts_index = { ok: true, tasks: [{ task_id: tid, title: '<img src=x onerror=alert(1)>', business: 'unassigned', files: 2, total_bytes: 2048, last_upload: '2026-11-01T18:55:00Z' }] };
await f._engArtifactsLoad();
ok('index uses the CEO session action', calls.some(c => c[0].includes('engineering_artifacts_index')));
ok('index output escapes task titles', !el.innerHTML.includes('<img') && el.innerHTML.includes('&lt;img'));
responses.engineering_task_artifacts = { ok: true, task: { title: 'Checkpoint archive' }, link_ttl_s: 120, artifacts: [{ artifact_id: aid, name: '"><script>x</script>.txt', checkpoint: '041', size_bytes: 10, sha256: 'a'.repeat(64), sha256_verified: true, uploaded_at: '2026-11-01T18:55:00Z' }] };
await f._engArtifactsOpen(tid);
ok('file list escapes names and shows checkpoint, size, SHA-256 and upload date', !el.innerHTML.includes('<script>') && el.innerHTML.includes('041') && el.innerHTML.includes('10 B') && el.innerHTML.includes('a'.repeat(64)) && el.innerHTML.includes('2026-11-01 18:55'));
ok('file list shows no storage path', !/unassigned\/|object_path/.test(el.innerHTML));
ok('the 120-second link lifetime is stated', el.innerHTML.includes('120 seconds'));
const body = Buffer.from('checkpoint bytes');
const good = createHash('sha256').update(body).digest('hex');
fetched = body.buffer.slice(body.byteOffset, body.byteOffset + body.length);
responses.engineering_artifact_download_link = { ok: true, url: 'https://x/storage/v1/object/sign/engineering-artifacts/p?token=t', name: 'R2_CHECKPOINT_041.txt', size_bytes: body.length, sha256: good };
const btn = { textContent: 'DOWNLOAD', disabled: false };
await f._engArtifactDownload(tid, aid, btn);
ok('download asks for a per-file link with the CEO session', calls.some(c => c[0].includes('engineering_artifact_download_link') && c[1].task_id === tid && c[1].artifact_id === aid));
ok('a download whose SHA-256 matches is saved and marked ✓', saved.includes('R2_CHECKPOINT_041.txt') && btn.textContent === '✓ SHA OK');
responses.engineering_artifact_download_link = { ...responses.engineering_artifact_download_link, sha256: 'b'.repeat(64) };
saved.length = 0;
await f._engArtifactDownload(tid, aid, { textContent: 'DOWNLOAD' });
ok('a download whose SHA-256 does not match is NOT saved and the CEO is told', saved.length === 0 && alerts.some(a => /Checksum mismatch/.test(a)));
responses.engineering_artifact_download_link = { ok: false, error: 'ceo_session_required' };
await f._engArtifactDownload(tid, aid, { textContent: 'DOWNLOAD' });
ok('an expired CEO session gives a plain-language message', alerts.some(a => /Sign in as CEO/.test(a)));
ok('Engineering Review renders the Stored artifacts section', html.includes('${_engArtifactsSection()}'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
