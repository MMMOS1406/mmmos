// SRV Studio V2 — Checkpoint D4 (order SRV-STUDIO-V2-009): isolation corrections F-1..F-4 from the D3 audit.
// Runs the real app code (lifecycle + V2 blocks, the real unmodified _assignPublishSlot) in a vm with a
// mocked network, the real ops.js caption handler with a mocked flag row, and static protection checks.
// Run: node tests/srv/test_srv_studio_v2_isolation.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as RM from '../../public/srv-studio-v2/srv2-render.mjs';
import * as A from '../../lib/srvStudioV2Avatars.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
const H = read('public/index.html'), OPS = read('api/ops.js');
const base = (f) => execSync(`git show origin/main:${f}`, { cwd: repo, maxBuffer: 64 << 20 }).toString('utf8');
const BASE_H = base('public/index.html'), BASE_OPS = base('api/ops.js');
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const top = (src, name) => { const m = src.match(new RegExp('\\n(async )?function ' + name + '\\(')); if (!m) throw new Error('missing ' + name); const s = m.index + 1; return src.slice(s, src.indexOf('\n}\n', s) + 2); };
const slice = (src, a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('slice ' + a); return src.slice(i, j); };
const lineOf = (src, re) => src.split('\n').find((l) => re.test(l));

// ── vm harness: real lifecycle + V2 code, real slot assignment, mocked network/renderer ──
function makeEnv({ saveOk = true, engineState = {} } = {}) {
  const calls = { upserts: [], uploads: [], yt: [], thumbs: [], renders: [] };
  const json = (b, okv = true) => ({ ok: okv, status: okv ? 200 : 500, json: async () => b, text: async () => JSON.stringify(b) });
  let vid = 0;
  const fetch = async (url, opt = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/app_settings?key=eq.srv_studio_v2_enabled')) return json([{ value: true }]);
    if (u.includes('/rest/v1/packages?on_conflict')) { const row = JSON.parse(opt.body); calls.upserts.push(row); return saveOk ? json(null) : json({}, false); }
    if (u.includes('/rest/v1/')) return json([]);
    if (u.includes('action=youtube_upload_video')) { const b = JSON.parse(opt.body); calls.yt.push(b); return json({ ok: true, videoId: 'yt' + (++vid) }); }
    if (u.includes('action=set_yt_thumbnail')) { calls.thumbs.push(JSON.parse(opt.body)); return json({ ok: true }); }
    return json({ ok: true });
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => setTimeout(() => {}, 0), fetch, AbortSignal: { timeout: () => undefined },
    JSON, Date, Math, Number, String, Object, Array, Set, Promise, RegExp, File, Blob, location: { search: '' },
    alert() {}, confirm: () => true,
    document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } },
    D: { tasks: [], packages: [], srvLifecycleStages: {}, engineState: { ...engineState }, _publishSlots: {} },
    ENGINES_CONFIG: [{ id: 'srv_english', lifecycle: { requireApprove: true } }],
    SUPABASE_URL: 'https://stub.invalid', SUPABASE_KEY: 'k', SB_PACKAGES_BACKUP_KEY: 'mmm_packages_backup',
    saveAppState() {}, renderTab() {}, openExec() {}, closeExec() {}, currentTab: 'tasks', activeExec: null,
    escHTML: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _srvAudioData: {},
    _srvUploadToStorage: async (pkgId, file, kind) => { calls.uploads.push({ pkgId, kind, name: file.name }); return `https://stub.invalid/storage/v1/object/public/srv-assets/${pkgId}/${kind}_${file.name}`; },
  };
  vm.createContext(ctx);
  vm.runInContext([
    "const _PUBLISH_SLOT_DAYS=['Thursday','Friday','Saturday','Sunday','Monday'];",
    lineOf(H, /^const _PUBLISH_SLOT_TIMES = /), lineOf(H, /^const _DAY_NAMES = /),
    top(H, '_nextPublishSlotCandidates'), top(H, '_assignPublishSlot'), top(H, '_getEngineState'),
    top(H, 'savePackageToSupabase'), slice(H, 'const _farsiPkgSaveQueues={};', '// Write all packages as a backup'),
    top(H, 'writePackagesBackup'), top(H, 'fetchPackagesFromTable'),
    slice(H, '// ── Lifecycle helpers', '// ── Stage transition actions'),
  ].join('\n'), ctx);
  vm.runInContext("_srvStudioV2Flag.state='on';", ctx);
  // Real metadata builders; the recorder is replaced by a stub that records its inputs (no browser here).
  const fakeR = { ...RM, srv2RenderVideo: async (o) => { calls.renders.push({ avatar: o.avatar, title: o.title, lyrics: o.lyrics, kind: o.kind }); if (!RM.srv2AvatarProductionReady(o.avatar)) throw new Error('renderer refused avatar'); return { blob: new Blob(['v'], { type: 'video/mp4' }), ext: 'mp4', mime: 'video/mp4', thumbBlob: new Blob(['t'], { type: 'image/jpeg' }), stats: { avatarId: o.avatar.id, kind: o.kind } }; } };
  ctx.__R = fakeR; vm.runInContext('_srv2RenderModP=Promise.resolve(__R);', ctx);
  return { ctx, calls, run: (code) => vm.runInContext(code, ctx), settle: () => new Promise((r) => setTimeout(r, 30)) };
}
const T0 = Date.UTC(2026, 9, 1);
const task = (id, extra = {}) => ({ id, engine: 'SRV English', name: 'SRV English — Female · Short', status: 'assigned', contentType: 'Short Video', mood: 'Female — Romantic', createdAt: T0 + id * 1000, ...extra });
const pkgOf = (id, t, extra = {}) => ({ id, taskId: t.id, engine: 'SRV English', srvTaskUid: 'srve_' + t.createdAt + '_' + t.id, generatedAt: new Date(T0 + 86400000).toISOString(), title: 'Stay Tonight', lyrics: '[Chorus]\nhold me now\nnight drive', shortLyrics: 'hold me now', sunoPrompt: 'p', shortSunoPrompt: 'sp', mood: 'Female — Romantic', srvAvatar: { id: 'srv2-fm-03', assignedAt: new Date(T0).toISOString(), by: 'rotation' }, ...extra });
const FARSI_SLOT = 'farsi-reserved';
const firstFreeSlot = (E) => E.run("(function(){const t=new Set(Object.keys(D._publishSlots));return _nextPublishSlotCandidates(30).find(s=>!t.has(s.iso)).iso;})()");

(async () => {
  // ── 1. F-2: TEST publish takes no shared slot ──
  {
    const E = makeEnv(); const t = task(1, { name: 'SRV English — Female · Short [TEST]' }); const p = pkgOf('p1', t, { _srvShortVideoUrl: 'https://stub.invalid/v.mp4', _srvThumbUrl: 'https://stub.invalid/t.jpg' });
    E.ctx.D.tasks = [t, { id: 900, engine: 'SRV Farsi', createdAt: T0 }]; E.ctx.D.packages = [p];
    const farsiSlot = firstFreeSlot(E); E.ctx.D._publishSlots[farsiSlot] = 'pkg_farsi_1';
    const before = JSON.stringify(E.ctx.D._publishSlots);
    await E.run("_srvEnglishV2Publish('p1','1')"); await E.settle();
    ok('F-2: a task-level TEST publish reserves zero slots (shared pool byte-identical before/after)', JSON.stringify(E.ctx.D._publishSlots) === before);
    ok('F-2: the TEST package is stamped isTest and sends no schedule, [TEST] title, private', p.isTest === true && E.calls.yt.length === 1 && E.calls.yt[0].publishAt === null && /^\[TEST\] /.test(E.calls.yt[0].title) && E.calls.yt[0].privacyStatus === 'private' && !p.publishAt);
    ok('F-2: the SRV Farsi reservation is untouched', E.ctx.D._publishSlots[farsiSlot] === 'pkg_farsi_1');
  }
  {
    const E = makeEnv(); const t = task(2, { isTest: true }); const p = pkgOf('p2', t, { _srvShortVideoUrl: 'https://stub.invalid/v.mp4' });
    E.ctx.D.tasks = [t]; E.ctx.D.packages = [p];
    const mine = firstFreeSlot(E); E.ctx.D._publishSlots[mine] = 'p2'; p.publishAt = mine; E.ctx.D._publishSlots['2099-01-01T12:00:00.000Z'] = 'pkg_farsi_9';
    await E.run("_srvEnglishV2Publish('p2','2')"); await E.settle();
    ok('F-2: a TEST publish gives back a slot its own package held, and only that one', !(mine in E.ctx.D._publishSlots) && E.ctx.D._publishSlots['2099-01-01T12:00:00.000Z'] === 'pkg_farsi_9' && p.publishAt === null);
  }
  {
    const E = makeEnv({ engineState: { 'SRV English': 'test' } }); const t = task(3); const p = pkgOf('p3', t, { _srvShortVideoUrl: 'https://stub.invalid/v.mp4' });
    E.ctx.D.tasks = [t]; E.ctx.D.packages = [p];
    await E.run("_srvEnglishV2Publish('p3','3')"); await E.settle();
    ok('F-2: engine-wide TEST mode also reserves zero slots', Object.keys(E.ctx.D._publishSlots).length === 0 && E.calls.yt[0].publishAt === null);
  }
  // ── 2. Live SRV Studio scheduling unchanged ──
  {
    const E = makeEnv(); const t = task(4); const p = pkgOf('p4', t, { _srvShortVideoUrl: 'https://stub.invalid/v.mp4' });
    E.ctx.D.tasks = [t]; E.ctx.D.packages = [p];
    const farsiSlot = firstFreeSlot(E); E.ctx.D._publishSlots[farsiSlot] = 'pkg_farsi_1';
    const expected = firstFreeSlot(E);
    await E.run("_srvEnglishV2Publish('p4','4')"); await E.settle();
    ok('Live: a non-TEST publish assigns exactly the next free slot through the unchanged _assignPublishSlot', p.publishAt === expected && E.ctx.D._publishSlots[expected] === 'p4' && Object.keys(E.ctx.D._publishSlots).length === 2);
    ok('Live: the scheduled time is sent to YouTube, title has no [TEST], isTest not stamped', E.calls.yt[0].publishAt === expected && !/\[TEST\]/.test(E.calls.yt[0].title) && p.isTest !== true);
    ok('Live: the SRV Farsi slot is neither reused nor moved', E.ctx.D._publishSlots[farsiSlot] === 'pkg_farsi_1' && expected !== farsiSlot);
  }
  {
    const E = makeEnv({ engineState: { 'SRV English': 'paused' } }); const t = task(5); const p = pkgOf('p5', t, { _srvShortVideoUrl: 'https://stub.invalid/v.mp4' });
    E.ctx.D.tasks = [t]; E.ctx.D.packages = [p];
    await E.run("_srvEnglishV2Publish('p5','5')"); await E.settle();
    ok('Live: a paused engine still gets no slot (unchanged _assignPublishSlot rule)', Object.keys(E.ctx.D._publishSlots).length === 0);
  }
  // ── 3. SRV Farsi scheduling unchanged ──
  {
    const E1 = makeEnv(); const fp1 = { id: 'pkg_farsi_x', engine: 'SRV Farsi' }; E1.ctx.__fp = fp1; E1.run('_assignPublishSlot(__fp)');
    const E2 = makeEnv(); const t = task(6, { isTest: true }); const p = pkgOf('p6', t, { _srvShortVideoUrl: 'https://stub.invalid/v.mp4' });
    E2.ctx.D.tasks = [t]; E2.ctx.D.packages = [p]; await E2.run("_srvEnglishV2Publish('p6','6')"); await E2.settle();
    const fp2 = { id: 'pkg_farsi_x', engine: 'SRV Farsi' }; E2.ctx.__fp = fp2; E2.run('_assignPublishSlot(__fp)');
    ok('Farsi: after an SRV Studio TEST publish, the next SRV Farsi package gets the same slot it would have had', fp1.publishAt && fp2.publishAt === fp1.publishAt);
    ok('Farsi: _assignPublishSlot, _nextPublishSlotCandidates, _srvFarsiRunPublish, _srvFarsiPublishYouTube byte-identical to main', ['_assignPublishSlot', '_nextPublishSlotCandidates', '_srvFarsiRunPublish', '_srvFarsiPublishYouTube', '_srvFarsiBuildTrigger'].every((n) => top(H, n) === top(BASE_H, n)));
  }
  // ── 4/5. F-1: archived avatars never enter Build; the replacement persists ──
  {
    const E = makeEnv(); const t = task(7, { contentType: 'Long', contentFormat: 'long', isLong: true }); const p = pkgOf('p7', t, { srvAvatar: { id: 'srv2-av-04', assignedAt: new Date(T0).toISOString(), by: 'rotation', registry: 'srv2-avatars-1' } });
    E.ctx.D.tasks = [t]; E.ctx.D.packages = [p]; E.ctx._srvAudioData.p7 = { file: new File(['a'], 'a.mp3') };
    const uid = p.srvTaskUid;
    await E.run("_srvEnglishV2Build('p7','7')"); await E.settle();
    const used = E.calls.renders[0] && E.calls.renders[0].avatar;
    ok('F-1: Build never hands an archived concept avatar to the renderer', E.calls.renders.length === 1 && used && used.collection === 'final' && !used.archived && used.quality.hdReady === true, used && used.id);
    ok('F-1: the replacement is a rotation-eligible final avatar suited to the mood (never #09)', used && A.srv2AvatarPool().some((a) => a.id === used.id) && used.id !== 'srv2-fm-09' && used.moods.includes('romantic'));
    ok('F-1: replacement and reason recorded on the package', p.srvAvatar.id === used.id && p.srvAvatar.by === 'auto-replace-archived' && p.srvAvatar.replaced && p.srvAvatar.replaced.from === 'srv2-av-04' && /archived concept image 303×252/.test(p.srvAvatar.replaced.reason));
    const saved = E.calls.upserts.map((r) => JSON.parse(r.full_package)).filter((f) => f.id === 'p7');
    ok('F-1: the replacement is saved to the packages table before rendering', saved.length >= 1 && saved[0].srvAvatar.id === used.id && saved[0].srvAvatar.replaced.from === 'srv2-av-04');
    ok('F-1: task UID and package identity preserved', p.id === 'p7' && p.srvTaskUid === uid && saved.every((f) => f.srvTaskUid === uid && f.id === 'p7'));
    ok('F-1: the build completed with the replacement (render record + video upload)', E.ctx.D.packages[0].srvRender && E.ctx.D.packages[0].srvRender.avatarId === used.id && E.calls.uploads.some((u) => u.kind === 'long'));
  }
  {
    const E = makeEnv({ saveOk: false }); const t = task(8); const p = pkgOf('p8', t, { srvAvatar: { id: 'srv2-av-11', assignedAt: new Date(T0).toISOString(), by: 'rotation' } });
    E.ctx.D.tasks = [t]; E.ctx.D.packages = [p]; E.ctx._srvAudioData.p8 = { file: new File(['a'], 'a.mp3') };
    await E.run("_srvEnglishV2Build('p8','8')"); await E.settle();
    ok('F-1: if the replacement cannot be saved, Build stops before rendering', E.calls.renders.length === 0 && E.calls.uploads.length === 0);
  }
  {
    const E = makeEnv(); let allFinal = true, any09 = false;
    for (const a of A.SRV_STUDIO_V2_AVATARS_ARCHIVED) {
      const t = task(100 + a.number); const p = pkgOf('pa' + a.number, t, { srvAvatar: { id: a.id, assignedAt: new Date(T0).toISOString(), by: 'rotation' } });
      E.ctx.D.tasks.push(t); E.ctx.D.packages.push(p); E.ctx.__t = t; E.ctx.__p = p; E.ctx.__a = a;
      const pick = E.run('_srvEnglishV2ReplaceArchivedAvatar(__t,__p,__a)');
      allFinal = allFinal && !!pick && pick.collection === 'final' && !pick.archived; any09 = any09 || (pick && pick.id === 'srv2-fm-09');
    }
    ok('F-1: every one of the 20 archived concepts is replaced by a final avatar; #09 stays held (never auto-assigned)', allFinal && !any09);
    ok('F-1: final masters (including the #09 alternate) pass the production check; archived concepts fail', A.SRV_STUDIO_V2_AVATARS.every((a) => E.run(`_srvEnglishV2AvatarProductionReady(srv2AvatarById('${a.id}'))`)) && A.SRV_STUDIO_V2_AVATARS_ARCHIVED.every((a) => !E.run(`_srvEnglishV2AvatarProductionReady(srv2AvatarById('${a.id}'))`)));
    let threw = '';
    try { await RM.srv2RenderVideo({ kind: 'long', avatar: A.srv2AvatarById('srv2-av-04'), audio: new ArrayBuffer(1), title: 'x' }); } catch (e) { threw = e.message; }
    ok('F-1: the render module itself refuses an archived avatar (second line of defence)', /final-master avatar/.test(threw) && !RM.srv2AvatarProductionReady(A.srv2AvatarById('srv2-av-04')) && RM.srv2AvatarProductionReady(A.srv2AvatarById('srv2-fm-06')), threw);
  }
  // ── 6. F-3: server flag guard on the V2 caption handler ──
  {
    const fnSrc = ['srvEnglishCaptionPrompt', 'parseSrvEnglishCaption', 'srvEnglishRegenCaption'].map((n) => top(OPS, n)).join('\n');
    const run = async (flagRows, flagStatus = 200) => {
      const lib = await import('../../lib/srvStudioV2Music.mjs?case=' + Math.random()); // fresh flag cache per case
      const calls = { flag: 0, model: 0 };
      const fetchStub = async (url) => {
        const u = String(url);
        if (u.includes('app_settings?key=eq.srv_studio_v2_enabled')) { calls.flag++; if (flagStatus === 'throw') throw new Error('network'); return { ok: flagStatus === 200, json: async () => flagRows }; }
        if (u.includes('api.anthropic.com')) { calls.model++; return { json: async () => ({ content: [{ text: 'CAPTION:\nA caption\n#SRVStudio #NightDrive' }] }) }; }
        throw new Error('unexpected ' + u);
      };
      const g = globalThis.fetch; globalThis.fetch = fetchStub; const key = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key';
      try {
        const handler = new Function('srvStudioV2FlagEnabled', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'process', 'fetch', fnSrc + '\nreturn srvEnglishRegenCaption;')(lib.srvStudioV2FlagEnabled, 'https://stub.invalid', 'svc', process, fetchStub);
        const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        await handler({ method: 'POST', body: { title: 'T', lyrics: 'L', isLong: false } }, res);
        return { res, calls };
      } finally { globalThis.fetch = g; if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key; }
    };
    const off = await run([]); const offFalse = await run([{ value: 'false' }]); const offErr = await run(null, 'throw'); const off500 = await run(null, 500); const on = await run([{ value: true }]);
    ok('F-3: flag row absent → 403 srv_studio_v2_off, no model call (no Anthropic credit spent)', off.res.code === 403 && off.res.body.error === 'srv_studio_v2_off' && off.calls.model === 0 && off.calls.flag === 1);
    ok('F-3: flag "false", flag read error and flag HTTP error all fail closed with no model call', [offFalse, offErr, off500].every((r) => r.res.code === 403 && r.calls.model === 0));
    ok('F-3: flag ON → the handler works as before (one model call, caption + #SRVStudio)', on.res.code === 200 && on.res.body.ok === true && on.calls.model === 1 && /#SRVStudio/.test(on.res.body.hashtags));
    ok('F-3: SRV Farsi caption handler and the dispatcher are byte-identical to main', top(OPS, 'farsiRegenCaption') === top(BASE_OPS, 'farsiRegenCaption') && lineOf(OPS, /action === 'farsi_regen_caption'/) === lineOf(BASE_OPS, /action === 'farsi_regen_caption'/));
    const head = execSync('git diff 2aac4af -U0 -- api/ops.js', { cwd: repo }).toString();
    const hunks = head.split('\n').filter((l) => l.startsWith('@@'));
    ok('F-3: the only api/ops.js change in D4 is inside srvEnglishRegenCaption', hunks.length === 1 && /srvEnglishRegenCaption|async function srvEnglishRegenCaption/.test(hunks[0] + head.split('\n').slice(0, 12).join('\n')) && !/^-[^-]/m.test(head), hunks.join(' | '));
  }
  // ── 7. F-4: posters ──
  {
    const E = makeEnv(); const t = task(9); const p = pkgOf('p9', t, { _srvShortVideoUrl: 'https://stub.invalid/s.mp4', _srvThumbUrl: 'https://stub.invalid/thumb.jpg', srvRender: { width: 1080, height: 1920, fps: 30, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', videoBitsPerSecondTarget: 6e6, measuredKbps: 6100, durationSec: 30, audioDurationSec: 110, sizeBytes: 2e7, frames: { drawn: 900, expected: 900, droppedPct: 0 }, maxSourceUpscale: 0.97 } });
    E.ctx.D.tasks = [t]; E.ctx.D.packages = [p]; E.run("_srvEnglishV2SetStage('9','approve')");
    const html = E.run('renderSRVEnglishLifecycleCard(D.tasks[0])');
    ok('F-4: the Approve player uses the package thumbnail as its poster, playback attributes kept', /<video poster="https:\/\/stub\.invalid\/thumb\.jpg" preload="metadata" src="https:\/\/stub\.invalid\/s\.mp4" controls/.test(html));
    delete p._srvThumbUrl; const html2 = E.run('renderSRVEnglishLifecycleCard(D.tasks[0])');
    ok('F-4: without a thumbnail the player is unchanged', /<video src="https:\/\/stub\.invalid\/s\.mp4" controls/.test(html2) && !/poster=/.test(html2));
    const studio = read('tests/srv/studio-v2-preview/render-studio.html');
    ok('F-4: Render Studio paints poster frames on load, after Stop and on avatar/title change', /await showThumb\(\); await showPoster\(\);/.test(studio) && /stopAnim\(\)[^\n]*showPoster\(\)/.test(studio) && /if \(!anim\) showPoster\(\)/.test(studio));
  }
  // ── 8. V2-only scope of the D4 change (measured against the audited D2 commit 2aac4af) ──
  {
    const diff = execSync('git diff 2aac4af --name-only', { cwd: repo }).toString().trim().split('\n').filter(Boolean);
    const allowed = ['public/index.html', 'api/ops.js', 'public/srv-studio-v2/srv2-render.mjs', 'tests/srv/studio-v2-preview/render-studio.html', 'tests/srv/test_srv_studio_v2_lifecycle.cjs', 'tests/srv/test_srv_studio_v2_render.mjs', 'tests/srv/test_srv_studio_v2_avatars.mjs', 'tests/srv/test_srv_studio_v2_isolation.mjs'];
    ok('Scope: D4 changes only V2 files, the V2 caption handler, the V2 preview page and V2 tests', diff.every((f) => allowed.includes(f)), diff.join(', '));
    const hd = execSync('git diff 2aac4af -U0 -- public/index.html', { cwd: repo }).toString();
    const fns = [...hd.matchAll(/^@@[^@]*@@ (?:async )?function ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
    ok('Scope: every index.html hunk sits in SRV English / V2 code', fns.length > 0 && fns.every((f) => /^_srvEnglish|^renderSRVEnglishLifecycleCard$|^srvStudioV2|^_srvEnglishV2/.test(f)), fns.join(','));
    ok('Protected: _srvRenderVideo byte-identical to main', top(H, '_srvRenderVideo') === top(BASE_H, '_srvRenderVideo'));
  }
  console.log(out.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
