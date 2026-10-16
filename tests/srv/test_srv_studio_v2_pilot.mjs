// SRV Studio V2 — Checkpoint E3 (order SRV-STUDIO-V2-015): the controlled two-video private pilot.
// Library rules, server-side enforcement under concurrency (compare-and-set ledger), the real ops.js handler
// against a PostgREST-like mock, the real client publish path in a vm, and protection of shared code.
// Run: node tests/srv/test_srv_studio_v2_pilot.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as P from '../../lib/srvStudioV2Pilot.mjs';
import * as RM from '../../public/srv-studio-v2/srv2-render.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
const H = read('public/index.html'), OPS = read('api/ops.js');
// db766dd = main before SRV Studio V2 shipped (PR #40): the protected baseline these checks diff against.
const base = (f) => execSync(`git show db766dd6ed3c561bdb5ea3577ab4e1bf68c98912:${f}`, { cwd: repo, maxBuffer: 64 << 20 }).toString('utf8');
const n017 = (s) => s.replace(/_publishFetch\('/g, "fetch('"); // SRV-STUDIO-V2-017: the only allowed change to shared publish functions is fetch( → _publishFetch(
const BASE_H = base('public/index.html'), BASE_OPS = base('api/ops.js');
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); };
const top = (src, name) => { const m = src.match(new RegExp('\\n(async )?function ' + name + '\\(')); if (!m) throw new Error('missing ' + name); const s = m.index + 1; return src.slice(s, src.indexOf('\n}\n', s) + 2); };
const slice = (src, a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('slice ' + a); return src.slice(i, j); };
const lineOf = (src, re) => src.split('\n').find((l) => re.test(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NOW = Date.UTC(2026, 9, 16, 12);
const LONG = 'srve_1791661440767_137', SHORT = 'srve_1791661404055_131', OTHER = 'srve_1791661404055_133';
const CH = P.SRV2_PILOT_CHANNEL_ID;
const SB = 'https://tldcwvtwjypmwynsklsd.supabase.co';
const cfg = (o = {}) => JSON.stringify({ enabled: true, tasks: { long: LONG, short: SHORT }, maxUploads: 2, expires: new Date(NOW + 6 * 86400000).toISOString(), channelId: CH, ...o });
const body = (taskUid, kind, o = {}) => ({ taskUid, kind, pkgId: 'pkg_' + kind + '_1', videoUrl: `${SB}/storage/v1/object/public/srv-assets/pkg_${kind}_1/${kind}_1_srv2_${kind}.mp4`, title: kind === 'long' ? 'Leave the Engine Running | Emotional Deep House | Night Drive | SRV Studio' : "Don't Let Me Go Tonight | Night Drive Deep House | SRV Studio #Shorts", description: 'Song — night drive.\n\n' + RM.SRV2_AI_DISCLOSURE + '\n\n#SRVStudio', tags: ['SRV Studio'], ...o });

// In-memory deps with a real compare-and-set store and async interleaving.
function env(o = {}) {
  const store = { [P.SRV2_PILOT_KEY]: o.config === undefined ? cfg() : o.config, ...(o.ledger ? { [P.SRV2_PILOT_LEDGER_KEY]: o.ledger } : {}) };
  const calls = { uploads: [], cas: 0, casFail: 0 }; let n = 0;
  const deps = {
    now: () => o.now || NOW,
    flagOn: async () => o.flag !== false,
    getSetting: async (k) => { await sleep(Math.random() * 4); return k in store && store[k] != null ? { text: store[k] } : null; },
    casSetting: async (k, oldT, newT) => { await sleep(Math.random() * 6); calls.cas++; const cur = k in store ? store[k] : null; if (cur !== oldT) { calls.casFail++; return false; } store[k] = newT; return true; },
    engineState: async () => o.engine || 'test',
    lookupChannel: async () => (o.channel === null ? null : { channel_id: o.channel || CH }),
    upload: async (b) => { calls.uploads.push(b); await sleep(10 + Math.random() * 20); if (o.uploadFail) return { status: 502, json: { ok: false, error: 'upload_failed', message: 'boom' } }; return { status: 200, json: { ok: true, youtubeVideoId: 'yt_' + (++n), channelId: o.resultChannel || CH, privacyStatus: o.resultPrivacy || 'private', uploadedAt: new Date(NOW).toISOString() } }; },
    newId: () => 'pl_' + Math.random().toString(36).slice(2, 10),
  };
  const ledger = () => JSON.parse(store[P.SRV2_PILOT_LEDGER_KEY] || '{"entries":[]}');
  return { deps, store, calls, ledger, run: (b) => P.srv2RunPilotUpload(deps, b, { supabaseUrl: SB }) };
}

(async () => {
  // ── 1. Configuration ──
  {
    const e = (raw, now = NOW) => P.srv2ParsePilotConfig(raw, now).error || 'ok';
    ok('Config: absent / unreadable / disabled → pilot OFF', e(null) === 'pilot_not_configured' && e('{') === 'pilot_config_unreadable' && e(cfg({ enabled: false })) === 'pilot_disabled' && e(cfg({ enabled: 'true' })) === 'pilot_disabled');
    ok('Config: exactly one Long and one Short task, distinct, valid uids', e(cfg({ tasks: { long: LONG } })) === 'pilot_tasks_invalid' && e(cfg({ tasks: { long: LONG, short: LONG } })) === 'pilot_tasks_invalid' && e(cfg({ tasks: { long: LONG, short: SHORT, extra: OTHER } })) === 'pilot_tasks_invalid' && e(cfg({ tasks: { long: '137', short: SHORT } })) === 'pilot_tasks_invalid');
    ok('Config: maxUploads must be exactly 2; channel must be SRV Studio', e(cfg({ maxUploads: 3 })) === 'pilot_max_uploads_invalid' && e(cfg({ maxUploads: 1 })) === 'pilot_max_uploads_invalid' && e(cfg({ channelId: 'UCCUa5BLzGh2eRBoqqWBCK_g' })) === 'pilot_channel_invalid');
    ok('Config: expired, missing or more than 14 days ahead is refused', e(cfg({ expires: new Date(NOW - 1).toISOString() })) === 'pilot_expired' && e(cfg({ expires: 'soon' })) === 'pilot_expiry_invalid' && e(cfg({ expires: new Date(NOW + 15 * 86400000).toISOString() })) === 'pilot_expiry_too_far');
    ok('Config: the valid two-task authorization parses', e(cfg()) === 'ok' && P.srv2ParsePilotConfig(cfg(), NOW).config.tasks.long === LONG);
  }
  // ── 2. Happy path: clean title, private, unscheduled, AI disclosure, audit history ──
  {
    const E = env();
    const r1 = await E.run(body(LONG, 'long')); const r2 = await E.run(body(SHORT, 'short'));
    const u = E.calls.uploads;
    ok('Pilot: the authorized Long and Short both upload', r1.status === 200 && r1.json.ok && r2.status === 200 && r2.json.ok && u.length === 2, [r1.status, r2.status]);
    ok('Pilot: normal title kept (no [TEST]); privacy forced private; publishAt forced null', u.every((b) => !/\[TEST\]/.test(b.title) && b.privacyStatus === 'private' && b.publishAt === null) && u[0].title.startsWith('Leave the Engine Running'));
    ok('Pilot: AI disclosure kept (containsSyntheticMedia + description), category Music, engine SRV English', u.every((b) => b.containsSyntheticMedia === true && /AI-generated/.test(b.description) && b.categoryId === '10' && b.engine === 'SRV English' && b.madeForKids === false));
    const L = E.ledger();
    ok('Ledger: two "uploaded" entries with YouTube ids, channel, privacy, claim and upload timestamps', L.entries.length === 2 && L.entries.every((x) => x.status === 'uploaded' && /^yt_/.test(x.youtubeVideoId) && x.channelId === CH && x.privacyStatus === 'private' && x.claimedAt && x.uploadedAt && x.finishedAt && x.pkgId && x.title) && L.rev === 4);
    ok('Response: returns youtubeVideoId (+ videoId alias), channel, privacy, entry id', r1.json.youtubeVideoId === r1.json.videoId && r1.json.channelId === CH && r1.json.privacyStatus === 'private' && !!r1.json.entryId);
    const r3 = await E.run(body(LONG, 'long')); const r4 = await E.run(body(OTHER, 'short'));
    ok('Limit: a second upload of the same task and any unlisted task are refused; still exactly 2 uploads', r3.status === 409 && r3.json.error === 'task_already_uploaded_or_in_progress' && r4.status === 409 && r4.json.error === 'task_not_allowlisted' && E.calls.uploads.length === 2);
  }
  // ── 3. Refusals before anything is claimed ──
  {
    const cases = [
      ['V2 flag off', { flag: false }, body(LONG, 'long'), 403, 'srv_studio_v2_off'],
      ['no authorization', { config: null }, body(LONG, 'long'), 403, 'pilot_not_configured'],
      ['authorization disabled', { config: cfg({ enabled: false }) }, body(LONG, 'long'), 403, 'pilot_disabled'],
      ['authorization expired', { now: NOW + 7 * 86400000 }, body(LONG, 'long'), 403, 'pilot_expired'],
      ['engine not in TEST', { engine: 'running' }, body(LONG, 'long'), 409, 'engine_not_in_test'],
      ['wrong channel connected', { channel: 'UCCUa5BLzGh2eRBoqqWBCK_g' }, body(LONG, 'long'), 409, 'wrong_channel'],
      ['no channel connected', { channel: null }, body(LONG, 'long'), 409, 'wrong_channel'],
      ['unlisted task', {}, body(OTHER, 'long'), 409, 'task_not_allowlisted'],
      ['format mismatch (Long task as Short)', {}, body(LONG, 'short'), 409, 'format_mismatch'],
      ['[TEST] title', {}, body(LONG, 'long', { title: '[TEST] Leave the Engine Running' }), 400, 'bad_title'],
      ['title over 100 characters', {}, body(LONG, 'long', { title: 'x'.repeat(101) }), 400, 'bad_title'],
      ['missing AI disclosure', {}, body(LONG, 'long', { description: 'A song.' }), 400, 'missing_ai_disclosure'],
      ["another package's video", {}, body(LONG, 'long', { videoUrl: `${SB}/storage/v1/object/public/srv-assets/pkg_other/long.mp4` }), 400, 'video_not_from_this_package'],
      ['video on another host', {}, body(LONG, 'long', { videoUrl: 'https://evil.example/pkg_long_1/x.mp4' }), 400, 'video_not_from_this_package'],
    ];
    let all = true; const bad = [];
    for (const [name, o, b, st, err] of cases) { const E = env(o); const r = await E.run(b); const good = r.status === st && r.json.error === err && E.calls.uploads.length === 0 && !E.store[P.SRV2_PILOT_LEDGER_KEY]; if (!good) { all = false; bad.push(name + ' → ' + r.status + ' ' + r.json.error); } }
    ok('Refusals: flag off, no/disabled/expired authorization, engine not TEST, wrong channel, unlisted, wrong format, bad title, no AI disclosure, foreign video — nothing claimed, nothing uploaded', all, bad.join('; ') || cases.length + ' cases');
    const E = env({ ledger: '{oops' }); const r = await E.run(body(LONG, 'long'));
    ok('Refusal: an unreadable ledger is never guessed (500, no upload)', r.status === 500 && r.json.error === 'pilot_ledger_unreadable' && E.calls.uploads.length === 0);
    const seeded = JSON.stringify({ rev: 2, entries: [{ id: 'a', taskUid: OTHER, status: 'uploaded' }, { id: 'b', taskUid: 'srve_1_9', status: 'uploaded' }] });
    const E2 = env({ ledger: seeded }); const r2 = await E2.run(body(LONG, 'long'));
    ok('Limit: with two uploads already recorded, even an authorized task is refused (pilot_limit_reached)', r2.status === 409 && r2.json.error === 'pilot_limit_reached' && E2.calls.uploads.length === 0);
  }
  // ── 4. Concurrency (server-side; requests interleave at every await) ──
  {
    let worst = 0, dupes = 0;
    for (let round = 0; round < 25; round++) {
      const E = env(); const reqs = [];
      for (let i = 0; i < 6; i++) reqs.push(E.run(body(LONG, 'long')));
      for (let i = 0; i < 6; i++) reqs.push(E.run(body(SHORT, 'short')));
      const res = await Promise.all(reqs);
      const okN = res.filter((r) => r.json.ok).length; worst = Math.max(worst, E.calls.uploads.length);
      const byTask = {}; for (const b of E.calls.uploads) byTask[b.title] = (byTask[b.title] || 0) + 1; if (Object.values(byTask).some((v) => v > 1) || okN !== 2) dupes++;
    }
    ok('Concurrency: 25 rounds × 12 simultaneous requests (6 per task) → exactly one upload per task, never more than 2', worst === 2 && dupes === 0, { maxUploadsInARound: worst, badRounds: dupes });
    const E = env(); const res = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(() => E.run(body(LONG, 'long'))));
    ok('Concurrency: 8 simultaneous clicks on one task → 1 upload, 7 refused as already in progress', E.calls.uploads.length === 1 && res.filter((r) => r.json.error === 'task_already_uploaded_or_in_progress').length === 7 && E.calls.casFail >= 0);
  }
  // ── 5. Failures and verification ──
  {
    const E = env({ uploadFail: true }); const r = await E.run(body(LONG, 'long'));
    ok('Failure: a failed upload is recorded as failed and frees the task for one retry', r.status === 502 && r.json.error === 'upload_failed' && E.ledger().entries[0].status === 'failed' && /boom/.test(E.ledger().entries[0].error));
    E.deps.upload = env().deps.upload; const r2 = await E.run(body(LONG, 'long'));
    ok('Failure: the retry succeeds; history keeps both attempts', r2.json.ok === true && E.ledger().entries.length === 2 && E.ledger().entries.map((x) => x.status).join() === 'failed,uploaded');
    const W = env({ resultChannel: 'UC41nsMBfVJCqj4vJRLktZTQ' }); const w = await W.run(body(LONG, 'long'));
    ok('Wrong channel after upload: kept as a blocking "pending" entry (not counted as success, not retryable) and reported', w.status === 502 && w.json.error === 'uploaded_but_unverified_channel_or_privacy' && W.ledger().entries[0].status === 'pending' && (await W.run(body(LONG, 'long'))).json.error === 'task_already_uploaded_or_in_progress');
    const V = env({ resultPrivacy: 'public' }); const v = await V.run(body(SHORT, 'short'));
    ok('Privacy check after upload: anything but private is flagged and blocks the task', v.json.error === 'uploaded_but_unverified_channel_or_privacy' && V.ledger().entries[0].status === 'pending');
  }
  // ── 6. The real ops.js handler against a PostgREST-like mock (CAS via value=eq filter) ──
  {
    const names = ['srvStudioV2PilotSetting', 'srvStudioV2PilotCas', 'srvStudioV2PilotUpload'];
    const src = names.map((n) => top(OPS, n)).join('\n');
    const table = { [P.SRV2_PILOT_KEY]: cfg({ expires: new Date(Date.now() + 5 * 86400000).toISOString() }), mmm_finance_v118: JSON.stringify({ engineState: { 'SRV English': 'test', 'AI Studio': 'paused' } }) };
    const ups = [];
    const fetchMock = async (url, opt = {}) => {
      await sleep(Math.random() * 5); const u = new URL(url); const key = decodeURIComponent((u.searchParams.get('key') || '').replace(/^eq\./, ''));
      const j = (b, s = 200) => ({ ok: s < 300, status: s, json: async () => b, text: async () => JSON.stringify(b) });
      if (opt.method === 'POST') { const b = JSON.parse(opt.body); if (b.key in table) return j({ message: 'duplicate' }, 409); table[b.key] = b.value; return j([b], 201); }
      if (opt.method === 'PATCH') { const want = u.searchParams.get('value').replace(/^eq\./, ''); if (table[key] !== want) return j([]); table[key] = JSON.parse(opt.body).value; return j([{ key }]); }
      return j([]);
    };
    const sbGet = async (p) => { const u = new URL('http://x/' + p); const key = decodeURIComponent((u.searchParams.get('key') || '').replace(/^eq\./, '')); return key in table ? [{ value: table[key] }] : []; };
    const youtubeUploadVideo = async (req, res) => { ups.push(req.body); await sleep(15); return res.status(200).json({ ok: true, youtubeVideoId: 'yt' + ups.length, channelId: CH, channelTitle: 'SRV Studio ', privacyStatus: req.body.publishAt ? 'private' : req.body.privacyStatus, uploadedAt: new Date().toISOString() }); };
    const lib = await import('../../lib/srvStudioV2Pilot.mjs');
    let settingReads = 0; const sbGetCounted = async (p) => { settingReads++; return sbGet(p); };
    const requireCeoSession = async (req) => ((req.method === 'POST' ? req.body : req.query) || {}).ceo_session_token === 'valid-ceo-session';
    const handler = new Function('srv2RunPilotUpload', 'srvStudioV2FlagEnabled', 'sbGet', 'fetch', '_getYoutubeConnectionByTitle', 'youtubeUploadVideo', 'requireCeoSession', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', src + '\nreturn srvStudioV2PilotUpload;')(
      lib.srv2RunPilotUpload, async () => true, sbGetCounted, fetchMock, async (t) => (t === 'SRV Studio' ? { channel_id: CH } : null), youtubeUploadVideo, requireCeoSession, SB, 'svc');
    const callAs = async (b, token) => { const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; } }; await handler({ method: 'POST', body: token === undefined ? b : { ...b, ceo_session_token: token } }, res); return res; };
    const call = (b) => callAs(b, 'valid-ceo-session');
    const anon = await callAs(body(LONG, 'long')); const forged = await callAs(body(LONG, 'long'), 'forged.token');
    ok('E4 Handler: no CEO session or a forged token → 401 ceo_session_required, before any pilot state is read; nothing uploaded', anon.code === 401 && anon.body.error === 'ceo_session_required' && forged.code === 401 && settingReads === 0 && ups.length === 0 && !(P.SRV2_PILOT_LEDGER_KEY in table));
    const all = await Promise.all([body(LONG, 'long'), body(LONG, 'long'), body(SHORT, 'short'), body(SHORT, 'short'), body(LONG, 'long'), body(OTHER, 'long')].map(call));
    const L = JSON.parse(table[P.SRV2_PILOT_LEDGER_KEY]);
    ok('Handler: real ops.js code under 6 concurrent requests → exactly 2 uploads (Long + Short), ledger stored in app_settings', ups.length === 2 && all.filter((r) => r.code === 200).length === 2 && L.entries.filter((x) => x.status === 'uploaded').length === 2, all.map((r) => r.code + ':' + (r.body.error || 'ok')).join(' '));
    ok('Handler: the existing upload handler receives private / publishAt null / AI disclosure', ups.every((b) => b.privacyStatus === 'private' && b.publishAt === null && b.containsSyntheticMedia === true && b.engine === 'SRV English'));
    const tampered = JSON.parse(table[P.SRV2_PILOT_LEDGER_KEY]); table[P.SRV2_PILOT_LEDGER_KEY] = JSON.stringify({ rev: 0, entries: [] }); // what an anon write could do today
    const afterReset = await callAs(body(LONG, 'long')); const ups0 = ups.length;
    ok('E4 Handler: even after a ledger reset, an unauthenticated caller still cannot upload (401)', afterReset.code === 401 && ups.length === ups0);
    table[P.SRV2_PILOT_LEDGER_KEY] = JSON.stringify(tampered);
    const get = await call(body(SHORT, 'short')); const getRes = { code: 0, body: null, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; } }; await handler({ method: 'GET', body: {} }, getRes);
    ok('Handler: a fourth request is refused; GET is refused', get.code === 409 && getRes.code === 405);
  }
  // ── 7. Client: the real V2 publish path in a vm ──
  {
    function clientEnv(pilotCfg, opts = {}) {
      const calls = { pilot: [], yt: [], thumbs: [], upserts: [] }; let vid = 0;
      const json = (b, okv = true, st = 200) => ({ ok: okv, status: st, json: async () => b, text: async () => JSON.stringify(b) });
      const fetch = async (url, opt = {}) => {
        const u = String(url);
        if (u.includes('app_settings?key=eq.srv_studio_v2_enabled')) return json([{ value: 'true' }]);
        if (u.includes('app_settings?key=eq.srv_studio_v2_pilot')) return json(pilotCfg ? [{ value: pilotCfg }] : []);
        if (u.includes('/rest/v1/packages?on_conflict')) { calls.upserts.push(JSON.parse(opt.body)); return json(null); }
        if (u.includes('/rest/v1/')) return json([]);
        if (u.includes('action=srv_studio_v2_pilot_upload')) { const b = JSON.parse(opt.body); calls.pilot.push(b); return opts.pilotRefuse ? json({ ok: false, pilot: true, error: 'pilot_limit_reached' }, false, 409) : json({ ok: true, pilot: true, youtubeVideoId: 'ytp' + (++vid), videoId: 'ytp' + vid, channelId: CH, privacyStatus: 'private', uploadedAt: '2026-10-16T12:00:00Z', entryId: 'pl_x' }); }
        if (u.includes('action=youtube_upload_video')) { calls.yt.push(JSON.parse(opt.body)); return json({ ok: true, youtubeVideoId: 'yt' + (++vid), channelId: CH, privacyStatus: 'private', uploadedAt: '2026-10-16T12:00:00Z' }); }
        if (u.includes('action=set_yt_thumbnail')) { calls.thumbs.push(JSON.parse(opt.body)); return json({ ok: true }); }
        return json({ ok: true });
      };
      const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0, fetch, AbortSignal: { timeout: () => undefined }, JSON, Date, Math, Number, String, Object, Array, Set, Promise, RegExp, File, Blob, location: { search: '' }, alert() {}, confirm: () => true,
        document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } },
        D: { tasks: [], packages: [], srvLifecycleStages: {}, engineState: { 'SRV English': 'test' }, _publishSlots: { '2099-01-01T12:00:00.000Z': 'pkg_farsi_1' } },
        ENGINES_CONFIG: [{ id: 'srv_english', lifecycle: { requireApprove: true } }], SUPABASE_URL: SB, SUPABASE_KEY: 'k', SB_PACKAGES_BACKUP_KEY: 'b',
        saveAppState() {}, renderTab() {}, openExec() {}, closeExec() {}, currentTab: 'tasks', activeExec: null, escHTML: (s) => String(s == null ? '' : s), _srvAudioData: {},
        sessionStorage: { getItem: (k) => (k === 'mmm_ceo_session' ? JSON.stringify({ token: 'ceo.tok', expires_at: '2099-01-01' }) : null) } };
      vm.createContext(ctx);
      vm.runInContext(["const _PUBLISH_SLOT_DAYS=['Thursday','Friday','Saturday','Sunday','Monday'];", lineOf(H, /^const _PUBLISH_SLOT_TIMES = /), lineOf(H, /^const _DAY_NAMES = /),
        top(H, '_nextPublishSlotCandidates'), top(H, '_assignPublishSlot'), top(H, '_getEngineState'), top(H, 'savePackageToSupabase'), slice(H, 'const _farsiPkgSaveQueues={};', '// Write all packages as a backup'),
        top(H, 'writePackagesBackup'), top(H, 'fetchPackagesFromTable'), top(H, '_ceoGetSessionToken'), top(H, '_ceoAuthedFetch'), top(H, '_operatorGetSessionToken'), top(H, '_publishAuthedFetch'), top(H, '_publishFetch'), slice(H, '// ── Lifecycle helpers', '// ── Stage transition actions')].join('\n'), ctx);
      vm.runInContext("_srvStudioV2Flag.state='on';", ctx); ctx.__R = RM; vm.runInContext('_srv2RenderModP=Promise.resolve(__R);', ctx);
      return { ctx, calls };
    }
    const T = (id, created, o = {}) => ({ id, engine: 'SRV English', name: 'SRV English — Female · Long', status: 'assigned', contentType: 'Long', contentFormat: 'long', isLong: true, mood: 'Female — Romantic', createdAt: created, ...o });
    const PK = (id, t, o = {}) => ({ id, taskId: t.id, engine: 'SRV English', srvTaskUid: 'srve_' + t.createdAt + '_' + t.id, isTest: true, generatedAt: '2026-10-16T10:00:00Z', title: 'Leave the Engine Running', lyrics: '[Chorus]\nhold me', shortLyrics: 'hold me', mood: 'Female — Romantic', _srvLongVideoUrl: `${SB}/storage/v1/object/public/srv-assets/${id}/long_1_srv2_long.mp4`, _srvShortVideoUrl: `${SB}/storage/v1/object/public/srv-assets/${id}/short_1_srv2_short.mp4`, _srvThumbUrl: `${SB}/storage/v1/object/public/srv-assets/${id}/thumb.jpg`, ...o });
    const tl = T(137, 1791661440767), ts = T(131, 1791661404055, { contentType: 'Short Video', contentFormat: null, isLong: false, name: 'SRV English — Female · Short' }), to = T(133, 1791661404055, { contentType: 'Short Video', contentFormat: null, isLong: false });
    const cfgC = cfg({ expires: new Date(Date.now() + 5 * 86400000).toISOString() });
    {
      const E = clientEnv(cfgC); E.ctx.D.tasks = [tl, ts, to]; const pl = PK('pkg_l', tl), ps = PK('pkg_s', ts, { title: "Don't Let Me Go Tonight" }), po = PK('pkg_o', to, { title: 'Other Song' }); E.ctx.D.packages = [pl, ps, po];
      const slots0 = JSON.stringify(E.ctx.D._publishSlots);
      await vm.runInContext("_srvEnglishV2Publish('pkg_l','137')", E.ctx); await vm.runInContext("_srvEnglishV2Publish('pkg_s','131')", E.ctx); await vm.runInContext("_srvEnglishV2Publish('pkg_o','133')", E.ctx);
      const [cl, cs] = E.calls.pilot;
      ok('E4 Client: pilot requests carry the CEO session token (through _ceoAuthedFetch); since SRV-STUDIO-V2-017 the normal upload carries it too (_publishFetch)', E.calls.pilot.length === 2 && E.calls.pilot.every((b) => b.ceo_session_token === 'ceo.tok') && E.calls.yt.length === 1 && E.calls.yt.every((b) => b.ceo_session_token === 'ceo.tok'));
      ok('Client: the two authorized tasks go to the pilot action with their normal titles (no [TEST])', E.calls.pilot.length === 2 && cl.title === 'Leave the Engine Running | Emotional Deep House | Night Drive | SRV Studio' && cs.title === "Don't Let Me Go Tonight | Night Drive Deep House | SRV Studio #Shorts" && cl.taskUid === 'srve_1791661440767_137' && cl.kind === 'long' && cs.kind === 'short');
      ok('Client: the unlisted task still publishes as TEST ([TEST] title, private, no schedule) through the normal action', E.calls.yt.length === 1 && /^\[TEST\] Other Song/.test(E.calls.yt[0].title) && E.calls.yt[0].privacyStatus === 'private' && E.calls.yt[0].publishAt === null);
      ok('Client: pilot packages stay isTest, take zero publishing slots, record the YouTube id/time/channel', pl.isTest === true && ps.isTest === true && JSON.stringify(E.ctx.D._publishSlots) === slots0 && pl.srvPilot.youtubeVideoId === 'ytp1' && pl.srvPilot.channelId === CH && pl.srvPilot.uploadedAt && pl.srvPublish.pilot === true && pl._srvYtLongId === 'ytp1' && ps._srvYtShortId === 'ytp2');
      ok('Client: the thumbnail is set on the returned YouTube id; all three tasks reach Done', E.calls.thumbs.map((t) => t.videoId).join() === 'ytp1,ytp2,yt3' && ['137', '131', '133'].every((id) => vm.runInContext(`_srvEnglishV2GetStage('${id}')`, E.ctx) === 'done'));
      ok('Client (bug fix): a normal upload answered with youtubeVideoId (the real server shape) is recognised as success', po._srvYtShortId === 'yt3' && po.srvPublish.videoId === 'yt3');
    }
    {
      const E = clientEnv(cfgC, { pilotRefuse: true }); E.ctx.D.tasks = [tl]; const pl = PK('pkg_l', tl); E.ctx.D.packages = [pl];
      await vm.runInContext("_srvEnglishV2Publish('pkg_l','137')", E.ctx);
      ok('Client: a server refusal stops publishing — no fallback upload, attempt recorded, task not Done', E.calls.pilot.length === 1 && E.calls.yt.length === 0 && pl.srvPilotAttempt && pl.srvPilotAttempt.error === 'pilot_limit_reached' && vm.runInContext("_srvEnglishV2GetStage('137')", E.ctx) !== 'done');
    }
    {
      const E = clientEnv(cfg({ enabled: false })); E.ctx.D.tasks = [tl]; const pl = PK('pkg_l', tl); E.ctx.D.packages = [pl];
      await vm.runInContext("_srvEnglishV2Publish('pkg_l','137')", E.ctx);
      ok('Client: with the authorization disabled (release default) every task publishes as ordinary TEST', E.calls.pilot.length === 0 && E.calls.yt.length === 1 && /^\[TEST\] /.test(E.calls.yt[0].title));
    }
  }
  // ── 8. Protection and scope ──
  {
    { const PRE017 = execSync('git show 1724aed:api/ops.js', { cwd: repo, maxBuffer: 64 << 20 }).toString('utf8'); // V2 checkpoints never touched these; SRV-STUDIO-V2-017 hardens them (tests/platform/test_publish_auth.mjs)
    ok('Protected: youtubeUploadVideo, setYtThumbnail, _getYoutubeConnectionByTitle unchanged by the V2 checkpoints; SRV Farsi caption byte-identical to main', ['youtubeUploadVideo', 'setYtThumbnail', '_getYoutubeConnectionByTitle'].every((n) => top(PRE017, n) === top(BASE_OPS, n)) && top(OPS, 'farsiRegenCaption') === top(BASE_OPS, 'farsiRegenCaption')); }
    ok('Protected: V1 publish, _assignPublishSlot, _srvRenderVideo and SRV Farsi publish byte-identical to main', ['_assignPublishSlot', '_srvRenderVideo', '_srvFarsiRunPublish', '_srvFarsiPublishYouTube'].every((n) => n017(top(H, n)) === top(BASE_H, n)) && n017(top(H, '_srvEnglishRunPublish')).replace("  if(_srvStudioV2On())return _srvEnglishV2Publish(pkgId,taskId); // SRV Studio V2 publish (flag OFF in production)\n", '') === top(BASE_H, '_srvEnglishRunPublish'));
    const d = execSync('git diff ff5cc43 62ef91c -U0 -- api/ops.js', { cwd: repo }).toString(); // pinned to the E3 commit (SRV-STUDIO-V2-017 changes ops.js later)
    const minus = d.split('\n').filter((l) => /^-[^-]/.test(l));
    ok('Scope (server): E3 only adds to api/ops.js — the pilot import, three V2 pilot functions and one dispatcher line', minus.length === 0 && (d.match(/^\+\s*if \(action === /gm) || []).length === 1 && /srv_studio_v2_pilot_upload/.test(d));
    const files = execSync('git diff ff5cc43 1724aed --name-only', { cwd: repo }).toString().trim().split('\n').filter(Boolean); // E3+E4 scope, pinned before SRV-STUDIO-V2-017
    const allowed = ['api/ops.js', 'lib/srvStudioV2Pilot.mjs', 'docs/srv-studio-v2/e4-app-settings-v2-write-lock.sql', 'tests/srv/test_srv_studio_v2_e4_security.mjs', 'public/index.html', 'tests/srv/studio-v2-preview/server.mjs', 'tests/srv/studio-v2-preview/fixture.mjs', 'tests/srv/test_srv_studio_v2_pilot.mjs', 'tests/srv/test_srv_studio_v2_isolation.mjs', 'tests/srv/test_srv_studio_v2_render.mjs', 'tests/srv/test_srv_studio_v2_lifecycle.cjs', 'tests/srv/studio-v2-preview/headless-pilot.mjs'];
    ok('Scope: E3 changes only V2 files, the V2 pilot server action, the preview and V2 tests', files.every((f) => allowed.includes(f)), files.join(', '));
  }
  console.log(out.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
