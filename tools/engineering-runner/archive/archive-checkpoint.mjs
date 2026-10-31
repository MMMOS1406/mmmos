#!/usr/bin/env node
// MMMOS checkpoint archive (H5, prepared in 035). Stores checkpoint files as permanent artifacts of ONE
// CEO-authorized engineering task through the existing Agent Gateway (no new privilege, no RLS bypass):
//   create_artifact_upload → PUT bytes to the signed URL → submit_artifact with the local SHA-256.
// The server hashes each stored object itself (≤ 25 MB) and refuses a mismatch, so "sha256_verified"
// in the reply is proof the stored copy equals the local file. Larger files keep the local checksum
// (marked unverified) and are re-checked by downloading them from Engineering Review.
// Usage (after the CEO authorizes the archive task and the worker has claimed it):
//   node archive-checkpoint.mjs --task <id> --run <run_id> --credential-file <path> [--host https://mmm-static.vercel.app] FILE...
import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MIME = { '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.sha256': 'text/plain', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.html': 'text/html' };
export async function archive({ host, credential, taskId, runId, files, kind = 'checkpoint', fetchImpl = fetch }) {
  if (!/^https:\/\/[a-z0-9.-]+$/.test(host)) throw new Error('host must be an https origin');
  const gw = async (op, extra) => {
    const r = await fetchImpl(`${host}/api/ops?action=engineering_agent_gateway`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_credential: credential, task_id: taskId, agent_run_id: runId, op, ...extra }) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const out = [];
  for (const f of files) {
    const bytes = readFileSync(f);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const name = basename(f).replace(/[^A-Za-z0-9._-]/g, '_');
    const up = await gw('create_artifact_upload', { file_name: name });
    if (up.status !== 200) { out.push({ file: f, ok: false, step: 'create_artifact_upload', status: up.status, error: up.body.error }); continue; }
    const put = await fetchImpl(up.body.upload_url, { method: 'PUT', headers: { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }, body: bytes });
    if (!put.ok) { out.push({ file: f, ok: false, step: 'upload', status: put.status }); continue; }
    const reg = await gw('submit_artifact', { object_path: up.body.object_path, artifact_kind: kind, title: name, description: `Checkpoint archive · sha256 ${sha256}`, sha256 });
    const verified = reg.status === 200 && reg.body.sha256 === sha256;
    out.push({ file: f, ok: verified, object_path: up.body.object_path, size: bytes.length, sha256, server_verified: reg.body.sha256_verified === true, status: reg.status, error: reg.body.error });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const a = process.argv.slice(2); const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a.splice(i, 2)[1] : ''; };
  const taskId = opt('--task'), runId = opt('--run'), credFile = opt('--credential-file'), host = opt('--host') || 'https://mmm-static.vercel.app';
  if (!taskId || !runId || !credFile || !a.length) { console.error('usage: --task <id> --run <run_id> --credential-file <path> FILE...'); process.exit(2); }
  const credential = readFileSync(credFile, 'utf8').trim();
  const res = await archive({ host, credential, taskId, runId, files: a });
  for (const r of res) console.log(`${r.ok ? 'STORED' : 'FAILED'} ${r.file} ${r.sha256 || ''} ${r.server_verified ? 'server-verified' : (r.ok ? 'unverified (large)' : r.error || r.step)}`);
  process.exit(res.every(r => r.ok) ? 0 : 1);
}
