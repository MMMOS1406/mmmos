// SRV Studio V2 — order SRV-STUDIO-V2-023: VA upload allowance (server-enforced, separate ledger) and the one-time,
// admin-authorized title correction. Runs the REAL lib/srvStudioV2Pilot.mjs with in-memory settings; nothing leaves
// this machine. Run: node tests/srv/test_srv_studio_v2_023.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../../lib/srvStudioV2Pilot.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 300) : '')); };
const SB = 'https://tldcwvtwjypmwynsklsd.supabase.co';
const CH = 'UC0nzWQX6AaUqlF5FozNpWPg';
const NOW = Date.UTC(2026, 9, 16, 15, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const PILOT_LEDGER = JSON.stringify({ rev: 2, entries: [{ id: 'pl_1', taskUid: 'srve_1791661404055_133', kind: 'short', status: 'uploaded', youtubeVideoId: 'vX_L0Z9kN-k', channelId: CH, privacyStatus: 'private' }] });
const PILOT_CFG = JSON.stringify({ enabled: true, tasks: { long: 'srve_1791661440767_137', short: 'srve_1791661404055_133' }, maxUploads: 2, expires: iso(NOW + 6 * 86400000), channelId: CH });
const VA_CFG = JSON.stringify({ enabled: true, maxUploads: 2, perKind: { long: 1, short: 1 }, expires: iso(NOW + 6 * 86400000), channelId: CH });

function world(settings = {}, o = {}) {
  const table = { [P.SRV2_PILOT_KEY]: PILOT_CFG, [P.SRV2_PILOT_LEDGER_KEY]: PILOT_LEDGER, ...settings };
  const writes = []; const uploads = []; let n = 0;
  const deps = {
    now: () => NOW, flagOn: async () => o.flag !== false, engineState: async () => o.engine || 'test',
    getSetting: async (k) => (k in table ? { text: table[k] } : null),
    casSetting: async (k, oldT, newT) => { writes.push(k); if ((k in table ? table[k] : null) !== oldT) return false; table[k] = newT; return true; },
    lookupChannel: async () => ({ channel_id: o.channel || CH }),
    upload: async (b) => { uploads.push(b); return { status: 200, json: { ok: true, youtubeVideoId: 'yt' + (++n), channelId: CH, privacyStatus: 'private' } }; },
    newId: () => 'va_' + (++n), by: o.by || 'operator',
  };
  return { table, writes, uploads, deps };
}
const req = (uid, kind, o = {}) => ({ taskUid: uid, kind, pkgId: 'pkg_' + uid.slice(-3), videoUrl: `${SB}/storage/v1/object/public/srv-assets/pkg_${uid.slice(-3)}/v.mp4`, title: 'Song ' + uid.slice(-3) + ' - Emotional Deep House | Night Drive SRV Studio', description: 'x\nMusic, vocals and visuals in this video are AI-generated and edited by SRV Studio.', tags: ['SRV Studio'], ...o });
const L = (w) => JSON.parse(w.table[P.SRV2_VA_LEDGER_KEY] || '{"entries":[]}').entries;

// ── VA allowance ──
{
  const w = world();
  const r = await P.srv2RunVaUpload(w.deps, req('srve_1791661404055_201', 'short'), { supabaseUrl: SB });
  ok('VA: OFF until the CEO authorizes it (no allowance row → refused, nothing uploaded)', r.status === 403 && r.json.error === 'va_allowance_not_configured' && r.json.va === true && w.uploads.length === 0);
}
{
  const w = world({ [P.SRV2_VA_KEY]: VA_CFG });
  const a = await P.srv2RunVaUpload(w.deps, req('srve_1791661404055_202', 'long'), { supabaseUrl: SB });
  const b = await P.srv2RunVaUpload(w.deps, req('srve_1791661404055_203', 'short'), { supabaseUrl: SB });
  const c = await P.srv2RunVaUpload(w.deps, req('srve_1791661404055_204', 'short'), { supabaseUrl: SB });
  ok('VA: one Long + one Short upload private, unscheduled, clean title, SRV English engine', a.status === 200 && b.status === 200 && a.json.va === true && w.uploads.length === 2 && w.uploads.every((u) => u.privacyStatus === 'private' && u.publishAt === null && u.engine === 'SRV English' && !/\[TEST\]/.test(u.title)));
  ok('VA: a third upload is refused — the two-upload ceiling is enforced on the server', c.status === 409 && ['va_allowance_limit_reached', 'va_allowance_format_used'].includes(c.json.error) && w.uploads.length === 2);
  ok('VA: its own ledger records both uploads with who uploaded them', L(w).length === 2 && L(w).every((e) => e.status === 'uploaded' && e.by === 'operator'));
  ok('VA: the CEO pilot ledger and configuration are never written', w.table[P.SRV2_PILOT_LEDGER_KEY] === PILOT_LEDGER && w.table[P.SRV2_PILOT_KEY] === PILOT_CFG && !w.writes.includes(P.SRV2_PILOT_LEDGER_KEY));
}
{
  const w = world({ [P.SRV2_VA_KEY]: VA_CFG });
  await P.srv2RunVaUpload(w.deps, req('srve_1791661404055_205', 'short'), { supabaseUrl: SB });
  const again = await P.srv2RunVaUpload(w.deps, req('srve_1791661404055_206', 'short'), { supabaseUrl: SB });
  const same = await P.srv2RunVaUpload(w.deps, req('srve_1791661404055_205', 'long'), { supabaseUrl: SB });
  ok('VA: at most one per format; the same task never twice', again.json.error === 'va_allowance_format_used' && same.json.error === 'task_already_uploaded_or_in_progress' && w.uploads.length === 1);
}
{
  const base = { [P.SRV2_VA_KEY]: VA_CFG };
  const eng = await P.srv2RunVaUpload(world(base, { engine: 'running' }).deps, req('srve_1791661404055_207', 'short'), { supabaseUrl: SB });
  const ch = await P.srv2RunVaUpload(world(base, { channel: 'UC_other' }).deps, req('srve_1791661404055_207', 'short'), { supabaseUrl: SB });
  const fl = await P.srv2RunVaUpload(world(base, { flag: false }).deps, req('srve_1791661404055_207', 'short'), { supabaseUrl: SB });
  const tt = await P.srv2RunVaUpload(world(base).deps, req('srve_1791661404055_207', 'short', { title: '[TEST] x' }), { supabaseUrl: SB });
  const src = await P.srv2RunVaUpload(world(base).deps, req('srve_1791661404055_207', 'short', { videoUrl: 'https://evil.example/v.mp4' }), { supabaseUrl: SB });
  ok('VA: refused unless engine TEST, SRV Studio channel, V2 on, clean title and a video from the package', eng.json.error === 'engine_not_in_test' && ch.json.error === 'wrong_channel' && fl.json.error === 'srv_studio_v2_off' && tt.json.error === 'bad_title' && src.json.error === 'video_not_from_this_package');
}
{
  const bad = (o) => P.srv2ParseVaConfig(JSON.stringify({ enabled: true, maxUploads: 2, perKind: { long: 1, short: 1 }, expires: iso(NOW + 86400000), channelId: CH, ...o }), NOW).error;
  ok('VA config: ceiling ≤ 2, per-format quota ≤ ceiling, SRV Studio channel, expiry within 14 days', bad({ maxUploads: 3 }) === 'va_allowance_max_invalid' && bad({ perKind: { long: 3, short: 0 } }) === 'va_allowance_per_kind_invalid' && bad({ perKind: { long: 0, short: 0 } }) === 'va_allowance_per_kind_invalid' && !bad({ perKind: { long: 2, short: 0 } }) && bad({ channelId: 'UC_x' }) === 'va_allowance_channel_invalid' && bad({ expires: iso(NOW + 20 * 86400000) }) === 'va_allowance_expiry_too_far' && bad({ enabled: false }) === 'va_allowance_disabled' && !bad({}));
}
{
  // The pilot is unchanged by the shared runner: still its own key/ledger/tag, one Long slot left.
  const w = world();
  const r = await P.srv2RunPilotUpload(w.deps, req('srve_1791661440767_137', 'long'), { supabaseUrl: SB });
  ok('Pilot unchanged: Long #137 uses the remaining pilot slot, recorded in the pilot ledger only', r.status === 200 && r.json.pilot === true && JSON.parse(w.table[P.SRV2_PILOT_LEDGER_KEY]).entries.length === 2 && !(P.SRV2_VA_LEDGER_KEY in w.table));
  const r2 = await P.srv2RunPilotUpload(w.deps, req('srve_1791661404055_133', 'short'), { supabaseUrl: SB });
  ok('Pilot unchanged: the already-uploaded Short #133 is refused (ledger not reset)', r2.json.error === 'task_already_uploaded_or_in_progress');
}

// ── 026: Long-only VA allowance on the existing ledger (one Long already uploaded) ──
{
  const LONG_ONLY = JSON.stringify({ enabled: true, maxUploads: 2, perKind: { long: 2, short: 0 }, expires: iso(NOW + 6 * 86400000), channelId: CH });
  const prior = JSON.stringify({ rev: 2, entries: [{ id: 'va_1', taskUid: 'srve_1791661404055_136', kind: 'long', status: 'uploaded', youtubeVideoId: '9-GE-FEAUNM', channelId: CH, by: 'operator' }] });
  const w = world({ [P.SRV2_VA_KEY]: LONG_ONLY, [P.SRV2_VA_LEDGER_KEY]: prior });
  const sh = await P.srv2RunVaUpload(w.deps, req('srve_1792170000000_150', 'short'), { supabaseUrl: SB });
  const l1 = await P.srv2RunVaUpload(w.deps, req('srve_1792170000000_151', 'long'), { supabaseUrl: SB });
  const l2 = await P.srv2RunVaUpload(w.deps, req('srve_1792170000000_152', 'long'), { supabaseUrl: SB });
  const entries = L(w);
  ok('026 VA allowance: a Short is refused (format not allowed) and nothing is uploaded for it', sh.json.error === 'va_allowance_format_not_allowed' && !w.uploads.some((u) => u.title.includes('_150') || /150/.test(u.title)));
  ok('026 VA allowance: exactly ONE new Long is allowed on top of the existing upload; a further Long is refused', l1.status === 200 && l2.json.error === 'va_allowance_limit_reached' && w.uploads.length === 1);
  ok('026 the existing ledger entry (#136, 9-GE-FEAUNM) is kept — counters are not reset', entries.length === 2 && entries[0].youtubeVideoId === '9-GE-FEAUNM' && entries[1].kind === 'long' && entries[1].status === 'uploaded');
}

// ── One-time title correction ──
const TITLE = 'The part you left behind - Emotional Deep House | Night Drive SRV Studio';
function rworld(job, o = {}) {
  const w = world({ [P.SRV2_RETITLE_KEY]: job === undefined ? JSON.stringify({ videoId: 'vX_L0Z9kN-k', title: TITLE, expires: iso(NOW + 86400000) }) : job }, o);
  const calls = { get: 0, put: [] };
  const video = { snippet: { channelId: o.vchannel || CH, title: 'The part you left behind | Night Drive Deep House | SRV Studio #Shorts', description: 'desc', tags: ['SRV Studio'], categoryId: '10' }, status: { privacyStatus: o.privacy || 'private' } };
  Object.assign(w.deps, {
    accessToken: async () => 'tok',
    ytGetVideo: async () => { calls.get++; return o.missing ? null : video; },
    ytPutSnippet: async (t, id, snippet) => { calls.put.push({ id, snippet }); return { snippet: { ...snippet } }; },
  });
  return { ...w, calls };
}
{
  const w = rworld();
  const r = await P.srv2RunRetitleJob(w.deps);
  const put = w.calls.put[0];
  ok('Retitle: the exact CEO title is applied to vX_L0Z9kN-k (metadata only)', r.status === 200 && r.json.title === TITLE && put.id === 'vX_L0Z9kN-k' && put.snippet.title === TITLE);
  ok('Retitle: description, tags and category are sent back unchanged; privacy is never sent', put.snippet.description === 'desc' && JSON.stringify(put.snippet.tags) === '["SRV Studio"]' && put.snippet.categoryId === '10' && !('status' in put) && !('privacyStatus' in put.snippet));
  ok('Retitle: nothing uploaded, no allowance or pilot slot consumed, ledgers untouched', w.uploads.length === 0 && w.table[P.SRV2_PILOT_LEDGER_KEY] === PILOT_LEDGER && !(P.SRV2_VA_LEDGER_KEY in w.table));
  const job = JSON.parse(w.table[P.SRV2_RETITLE_KEY]);
  ok('Retitle: the job records done, the previous and the new title', job.status === 'done' && job.previousTitle === 'The part you left behind | Night Drive Deep House | SRV Studio #Shorts' && job.newTitle === TITLE);
  const again = await P.srv2RunRetitleJob(w.deps);
  ok('Retitle: a job runs at most once', again.json.error === 'retitle_job_already_done' && w.calls.put.length === 1);
}
{
  const none = await P.srv2RunRetitleJob(rworld(null).deps);
  const notLedger = await P.srv2RunRetitleJob(rworld(JSON.stringify({ videoId: 'AAAAAAAAAAA', title: TITLE, expires: iso(NOW + 86400000) })).deps);
  const testTitle = await P.srv2RunRetitleJob(rworld(JSON.stringify({ videoId: 'vX_L0Z9kN-k', title: '[TEST] x', expires: iso(NOW + 86400000) })).deps);
  const expired = await P.srv2RunRetitleJob(rworld(JSON.stringify({ videoId: 'vX_L0Z9kN-k', title: TITLE, expires: iso(NOW - 1000) })).deps);
  ok('Retitle: refused without an admin job, for a video not in an upload ledger, a [TEST] title or an expired job', none.json.error === 'no_retitle_job' && notLedger.json.error === 'video_not_in_upload_ledger' && testTitle.json.error === 'retitle_bad_title' && expired.json.error === 'retitle_job_expired_or_invalid');
  const pub = rworld(undefined, { privacy: 'public' }); const rp = await P.srv2RunRetitleJob(pub.deps);
  const oth = rworld(undefined, { vchannel: 'UC_other' }); const ro = await P.srv2RunRetitleJob(oth.deps);
  ok('Retitle: refuses (and records failed) when the video is not private or not on SRV Studio — no write to YouTube', rp.json.error === 'video_not_private' && ro.json.error === 'video_on_other_channel' && pub.calls.put.length === 0 && oth.calls.put.length === 0 && JSON.parse(pub.table[P.SRV2_RETITLE_KEY]).status === 'failed');
}

// ── Server wiring (api/ops.js) ──
{
  const OPS = fs.readFileSync(path.join(repo, 'api/ops.js'), 'utf8');
  const fnSrc = (name) => { const i = OPS.indexOf('async function ' + name + '('); return OPS.slice(i, OPS.indexOf('\n}\n', i)); };
  const va = fnSrc('srvStudioV2VaUpload');
  ok('Server: VA upload requires a VA (operator) or CEO session — never an unsigned call, even in log-only mode', /const who = await _publisherFromRequest\(req\);\n\s*if \(!who \|\| \(who\.role !== 'operator' && who\.role !== 'ceo'\)\) return res\.status\(401\)/.test(va));
  ok('Server: VA upload is also behind the publishing gate (CORS + logging) and uses exact SRV Studio routing', /'srv_studio_v2_va_upload', \/\/ SRV-STUDIO-V2-023/.test(OPS) && /_getYoutubeConnectionByTitle\('SRV Studio', \{ exact: true \}\)/.test(va));
  const rt = fnSrc('srvStudioV2RetitleJob');
  ok('Server: retitle uses videos.update part=snippet only (no upload endpoint, no status part)', /videos\?part=snippet'/.test(rt) && !/upload\/youtube|part=status'|privacyStatus:/.test(rt));
  ok('Server: both actions dispatched; CEO-only actions untouched', /action === 'srv_studio_v2_va_upload'\)\s+return await srvStudioV2VaUpload/.test(OPS) && /action === 'srv_studio_v2_retitle_job'\)\s+return await srvStudioV2RetitleJob/.test(OPS) && /if \(!\(await requireCeoSession\(req\)\)\) return res\.status\(401\)\.json\(\{ ok: false, pilot: true, error: 'ceo_session_required' \}\)/.test(OPS));
}

console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
