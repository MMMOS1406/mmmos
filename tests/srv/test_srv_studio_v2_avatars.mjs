// SRV Studio V2 — Checkpoints C + C2 (orders SRV-STUDIO-V2-004/-005): final avatar registry, archived concept
// history, selection/rotation, task
// persistence, build integration, V1 + SRV Farsi avatar protection. Offline; real code, mocked network.
// Run: node tests/srv/test_srv_studio_v2_avatars.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as A from '../../lib/srvStudioV2Avatars.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
const H = read('public/index.html'), LIB = read('lib/srvStudioV2Avatars.mjs');
// db766dd = main before SRV Studio V2 shipped (PR #40): the protected baseline these checks diff against.
const base = (f) => execSync(`git show db766dd6ed3c561bdb5ea3577ab4e1bf68c98912:${f}`, { cwd: repo, maxBuffer: 64 << 20 }).toString('utf8');
const BASE_H = base('public/index.html');
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const top = (src, name) => { const m = src.match(new RegExp('\\n(async )?function ' + name + '\\(')); if (!m) throw new Error('missing ' + name); const s = m.index + 1; return src.slice(s, src.indexOf('\n}\n', s) + 2); };
const png = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

// ── 1. Registry ──
const R = A.SRV_STUDIO_V2_AVATARS;
ok('Registry: exactly 20 final avatars, unique ids, numbers 1-20', R.length === 20 && R.every((a) => a.collection === 'final' && /^srv2-fm-\d\d$/.test(a.id)) && new Set(R.map((a) => a.id)).size === 20 && R.map((a) => a.number).join() === Array.from({ length: 20 }, (_, i) => i + 1).join());
const files = R.map((a) => path.join(repo, 'public', a.src));
ok('Registry: every asset file exists under public/assets/srv-studio-v2/avatars/final/', files.every((f) => fs.existsSync(f)) && R.every((a) => a.src.startsWith('/assets/srv-studio-v2/avatars/final/srv-studio-v2-')));
ok('Registry: every file matches its recorded SHA-256 (byte-identical to the CEO final collection)', R.every((a, i) => crypto.createHash('sha256').update(fs.readFileSync(files[i])).digest('hex') === a.sha256));
ok('Registry: original filenames recorded and all 20 distinct', new Set(R.map((a) => a.originalFile)).size === 20 && R.every((a) => /\.png$/.test(a.originalFile) && a.title));
ok('Registry: recorded native size matches the PNG header (1668-1672 x 941-943)', R.every((a, i) => { const d = png(fs.readFileSync(files[i])); return d.w === a.native.w && d.h === a.native.h && d.w >= 1668 && d.w <= 1672 && d.h >= 941 && d.h <= 943; }));
ok('Registry: orientation and aspect recorded truthfully (landscape ~16:9)', R.every((a) => a.orientation === 'landscape' && Math.abs(a.aspect - 16 / 9) < 0.02));
ok('Registry: quality is final-master — HD for 1280x720, explicitly NOT full HD', R.every((a) => a.quality.status === 'final-master' && a.quality.hdReady === true && a.quality.fullHD === false && a.quality.scale.thumbnail1280x720 < 1 && a.quality.scale.long1920x1080 > 1));
ok('Registry: crop is the whole image (no sheet residue to remove)', R.every((a) => a.crop.x === 0 && a.crop.y === 0 && a.crop.w === a.native.w && a.crop.h === a.native.h));
ok('Registry: focus point inside the image', R.every((a) => a.focus.fx > 0 && a.focus.fx < 1 && a.focus.fy > 0 && a.focus.fy < 1));
ok('Registry: moods limited to romantic / emotional / hopeful; formats long + short; pose group set', R.every((a) => a.moods.length && a.moods.every((m) => ['romantic', 'emotional', 'hopeful'].includes(m)) && a.formats.join() === 'long,short' && a.pose));
const pool = A.srv2AvatarPool();
ok('Registry: 19 rotation-eligible after CEO decisions; #09 kept as alternate to #15; #14 approved (recorded)', pool.length === 19 && R.filter((a) => !a.rotationEligible).map((a) => a.number).join() === '9' && /kept as an alternate to #15 \(CEO decision/.test(R[8].flags.join()) && R[13].rotationEligible && /approved by the CEO for rotation and thumbnails/.test(R[13].flags.join()));
ok('Registry: #13 confirmed by the CEO as the same artist (in rotation)', R[12].rotationEligible && /confirmed by the CEO as the same artist/.test(R[12].flags.join()) && !/CEO to confirm/.test(R[12].flags.join()));
ok('Registry: every mood has at least 5 eligible avatars and at least 6 pose groups rotate', ['romantic', 'emotional', 'hopeful'].every((m) => pool.filter((a) => a.moods.includes(m)).length >= 5) && new Set(pool.map((a) => a.pose)).size >= 6);
ok('Registry: one female artist only — no male/duet entries or fields', !/\b(male|duet|man|boy)\b/i.test(JSON.stringify(R).replace(/female/gi, '')));
ok('Registry: client copy in public/index.html is byte-identical to the lib block', (() => { const a = LIB.indexOf('// <srv-v2-avatars>'), b = LIB.indexOf('// </srv-v2-avatars>') + '// </srv-v2-avatars>'.length; return H.includes(LIB.slice(a, b)); })());

// ── 1b. Archived concept collection (history) ──
const ARCH = A.SRV_STUDIO_V2_AVATARS_ARCHIVED;
ok('Archive: the 20 concept avatars stay registered, archived, never eligible', ARCH.length === 20 && ARCH.every((a) => a.archived && !a.rotationEligible && a.quality.status === 'archived-concept' && a.quality.hdReady === false));
ok('Archive: concept files still present and byte-identical (historical references intact)', ARCH.every((a) => crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, 'public', a.src))).digest('hex') === a.sha256));
ok('Archive: old package avatar ids still resolve (srv2-av-01..20)', Array.from({ length: 20 }, (_, i) => 'srv2-av-' + String(i + 1).padStart(2, '0')).every((id) => A.srv2AvatarById(id) && A.srv2AvatarById(id).archived));
ok('Archive: concept registry backed up before C2', fs.existsSync(path.join(repo, 'docs/srv-studio-v2/backup/srvStudioV2Avatars.concept-registry-03ebdd0.mjs.txt')) && JSON.parse(read('docs/srv-studio-v2/backup/concept-registry-backup.json')).assets.every((x) => x.shaMatches));
ok('Archive: quality labels are honest for both collections', /below full HD/.test(A.srv2AvatarQualityLabel(R[0])) && /Archived concept image 303×252/.test(A.srv2AvatarQualityLabel(ARCH[0])));

// ── 2. Selection and rotation ──
{
  const at = (i) => new Date(1e12 + i * 1000).toISOString();
  const runA = (n, moodFn) => { const h = []; for (let i = 0; i < n; i++) { const a = A.srv2AvatarPick({ history: h, moodKey: moodFn(i) }); h.push({ id: a.id, at: at(i) }); } return h.map((x) => A.srv2AvatarById(x.id)); };
  const mix = ['romantic', 'emotional', 'romantic', 'hopeful', 'emotional'];
  const seqA = runA(200, (i) => mix[i % 5]); const seq = seqA.map((a) => a.id);
  ok('Rotation: 200 picks with the task mood mix → zero immediate repeats', seq.every((x, i) => !i || x !== seq[i - 1]));
  ok('Rotation: only final, rotation-eligible avatars are ever picked (never held, never archived)', seqA.every((a) => a.rotationEligible && !a.archived && a.collection === 'final'));
  ok('Rotation: no two consecutive picks share a pose group', seqA.every((a, i) => !i || a.pose !== seqA[i - 1].pose));
  ok('Rotation: every eligible avatar is used within the first 40 mixed picks', new Set(seq.slice(0, 40)).size === 19);
  for (const m of ['romantic', 'emotional', 'hopeful']) {
    const s2 = runA(60, () => m); const suited = pool.filter((a) => a.moods.includes(m)).length;
    ok(`Rotation (${m} only): suited avatars only, all ${suited} used within ${2 * suited} picks, no immediate repeats`, s2.every((a) => a.moods.includes(m)) && new Set(s2.slice(0, 2 * suited).map((a) => a.id)).size === suited && s2.every((a, i) => !i || a.id !== s2[i - 1].id));
  }
  ok('Rotation: an archived concept avatar as the previous pick is handled (next pick is final)', A.srv2AvatarPick({ history: [{ id: 'srv2-av-04', at: at(0) }], moodKey: 'emotional' }).collection === 'final');
  ok('Rotation: deterministic — same history gives the same pick', A.srv2AvatarPick({ history: [{ id: 'srv2-fm-01', at: at(0) }], moodKey: 'emotional' }).id === A.srv2AvatarPick({ history: [{ id: 'srv2-fm-01', at: at(0) }], moodKey: 'emotional' }).id);
  ok('Rotation: excludeId is never returned (Next avatar)', pool.map((a) => a.id).every((id) => A.srv2AvatarPick({ history: [], excludeId: id }).id !== id));
  ok('Rotation: history built from packages, oldest first, ignoring packages without avatars', (() => { const h = A.srv2AvatarHistory([{ srvAvatar: { id: 'b', assignedAt: '2' } }, { title: 'x' }, { srvAvatar: { id: 'a', assignedAt: '1' } }]); return h.map((x) => x.id).join() === 'a,b'; })());
  ok('Rotation: pool position labels ("Image N of 19"; held and archived = 0)', A.srv2AvatarPoolPos('srv2-fm-01').n === 1 && A.srv2AvatarPoolPos('srv2-fm-01').of === 19 && A.srv2AvatarPoolPos('srv2-fm-09').n === 0 && A.srv2AvatarPoolPos('srv2-av-01').n === 0);
}

// ── 3. Lifecycle persistence in the real client code (sandbox) ──
function makeEnv() {
  const table = {}; const calls = { upserts: [], alerts: [] };
  const fetch = async (url, opt = {}) => {
    const u = String(url); const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('app_settings?key=eq.srv_studio_v2_enabled')) return json([{ value: 'true' }]);
    if (u.includes('/rest/v1/packages?on_conflict')) { const row = JSON.parse(opt.body); calls.upserts.push(row); table[row.package_id] = row; return json(null); }
    if (u.includes('/rest/v1/packages?order=')) return json(Object.values(table).sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at))));
    return json({ ok: true });
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => setTimeout(() => {}, 0), fetch, AbortSignal: { timeout: () => undefined }, JSON, Date, Math, Number, String, Object, Array, Set, Promise, RegExp, Error, isNaN, isFinite, parseInt,
    location: { search: '' }, alert: (m) => calls.alerts.push(m), confirm: () => true,
    document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } },
    D: { tasks: [], packages: [], srvLifecycleStages: {}, srvEnglishAvatarIdx: 0 }, ENGINES_CONFIG: [{ id: 'srv_english', lifecycle: { requireApprove: true } }],
    SUPABASE_URL: 'https://stub.invalid', SUPABASE_KEY: 'k', SB_PACKAGES_BACKUP_KEY: 'b', saveAppState() {}, renderTab() {}, openExec() {}, closeExec() {}, currentTab: 'tasks', activeExec: null,
    _getEngineState: () => 'running', escHTML: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  };
  vm.createContext(ctx);
  vm.runInContext([top(H, 'savePackageToSupabase'), H.slice(H.indexOf('const _farsiPkgSaveQueues={};'), H.indexOf('// Write all packages as a backup')), top(H, 'writePackagesBackup'), top(H, 'fetchPackagesFromTable'),
    H.slice(H.indexOf('// ── Lifecycle helpers'), H.indexOf('// ── Stage transition actions')), top(H, 'vaGeneratePackage')].join('\n'), ctx);
  let n = 0;
  ctx.generatePackage = async (taskId) => { n++; const t = ctx.D.tasks.find((x) => String(x.id) === String(taskId)); ctx.D.packages.unshift({ id: 'pkg_' + n, taskId, engine: t.engine, generatedAt: new Date(Date.now() + n).toISOString(), title: 'Song ' + n, lyrics: 'l', shortLyrics: 's', sunoPrompt: 'p', shortSunoPrompt: 'sp' }); };
  return { ctx, table, calls, settle: () => new Promise((r) => setTimeout(r, 25)) };
}
{
  const E = makeEnv(); await E.settle(); const { ctx } = E;
  const T0 = Date.UTC(2026, 9, 1);
  ctx.D.tasks = [{ id: 1, engine: 'SRV English', mood: 'Female — Emotional', contentType: 'Long', contentFormat: 'long', isLong: true, createdAt: T0 + 1, status: 'assigned' }, /* 026: Long only */ { id: 2, engine: 'SRV English', mood: 'Female — Emotional', contentType: 'Long', contentFormat: 'long', isLong: true, createdAt: T0 + 2, status: 'assigned' }];
  await vm.runInContext("vaGeneratePackage('1')", ctx); await E.settle();
  const p1 = ctx.D.packages[0];
  ok('Generate: the new package gets an avatar from the rotation, mood-suited', p1.srvAvatar && A.srv2AvatarById(p1.srvAvatar.id).moods.includes('emotional') && p1.srvAvatar.by === 'rotation');
  ok('Generate: the avatar is saved with the package (database row full_package)', E.calls.upserts.some((r) => JSON.parse(r.full_package).srvAvatar && JSON.parse(r.full_package).srvAvatar.id === p1.srvAvatar.id));
  await vm.runInContext("vaGeneratePackage('2')", ctx); await E.settle();
  const p2 = ctx.D.packages[0];
  ok('Next task: a different avatar (no immediate repetition across tasks)', p2.srvAvatar.id !== p1.srvAvatar.id);
  ok('Task identity: each package is bound to its own task (srvTaskUid) with its own avatar', p1.srvTaskUid === 'srve_' + (T0 + 1) + '_1' && p2.srvTaskUid === 'srve_' + (T0 + 2) + '_2');
  const first = p1.srvAvatar.id;
  await vm.runInContext(`_srvEnglishV2RegeneratePackage('1','${p1.id}')`, ctx); await E.settle();
  const p1b = vm.runInContext("_srvEnglishPkgForTask(_srvEnglishTaskById('1'))", ctx);
  ok('Regenerate: new song keeps the task\'s avatar (inherited)', p1b.id !== p1.id && p1b.srvAvatar.id === first && p1b.srvAvatar.inherited === true);
  await vm.runInContext(`_srvEnglishV2NextAvatar('1','${p1b.id}')`, ctx); await E.settle();
  ok('Next avatar: changes to a different eligible avatar and records who chose it', p1b.srvAvatar.id !== first && A.srv2AvatarById(p1b.srvAvatar.id).rotationEligible && p1b.srvAvatar.by === 'operator-next');
  const reloaded = await vm.runInContext('fetchPackagesFromTable()', ctx);
  ok('Reload: the avatar choice comes back from the database for both tasks', reloaded.find((x) => x.id === p1b.id).srvAvatar.id === p1b.srvAvatar.id && reloaded.find((x) => x.id === p2.id).srvAvatar.id === p2.srvAvatar.id);
  ok('EnsureAvatar is idempotent — an existing avatar is never replaced silently', (() => { const before = p2.srvAvatar.id; vm.runInContext('_srvEnglishV2EnsureAvatar(D.tasks[1], D.packages.find(p=>p.id==="' + p2.id + '"))', ctx); return p2.srvAvatar.id === before; })());
  ok('V1 avatar pointer srvEnglishAvatarIdx untouched by V2 selection', ctx.D.srvEnglishAvatarIdx === 0);
  const html = vm.runInContext("_srvEnglishV2SetStage('2','build'); renderSRVEnglishLifecycleCard(D.tasks[1])", ctx);
  ok('Card: Build shows the task\'s avatar, rotation position and the honest quality label', html.includes(A.srv2AvatarById(p2.srvAvatar.id).src) && /Image \d+ of 19 in rotation/.test(html) && /Final master \d+×\d+ — HD for thumbnails, below full HD/.test(html) && /Next avatar/.test(html));
  const appr = vm.runInContext("_srvEnglishV2SetStage('2','approve'); renderSRVEnglishLifecycleCard(D.tasks[1])", ctx);
  ok('Card: Approve shows the avatar but no Next avatar (the avatar is fixed once the video is built)', appr.includes('ARTIST IMAGE') && !/Next avatar/.test(appr));
  // A package assigned during Checkpoint C (archived concept avatar) still resolves, and Next avatar moves it to the final collection.
  ctx.D.tasks.push({ id: 3, engine: 'SRV English', mood: 'Female — Romantic', contentType: 'Short Video', createdAt: T0 + 3, status: 'assigned' });
  ctx.D.packages.push({ id: 'pkg_old', taskId: 3, engine: 'SRV English', srvTaskUid: 'srve_' + (T0 + 3) + '_3', generatedAt: new Date(T0 + 4000).toISOString(), title: 'Old', lyrics: 'l', shortLyrics: 's', sunoPrompt: 'p', shortSunoPrompt: 'sp', srvAvatar: { id: 'srv2-av-04', assignedAt: new Date(T0 + 4000).toISOString(), by: 'rotation', registry: 'srv2-avatars-1' } });
  const oldHtml = vm.runInContext("_srvEnglishV2SetStage('3','review'); renderSRVEnglishLifecycleCard(D.tasks[2])", ctx);
  ok('History: a Checkpoint C package keeps its archived concept avatar and the card labels it honestly', oldHtml.includes('/assets/srv-studio-v2/avatars/concept/SRV-Avatar-04.png') && /ARCHIVED CONCEPT/.test(oldHtml) && /Archived concept image/.test(oldHtml));
  await vm.runInContext("_srvEnglishV2NextAvatar('3','pkg_old')", ctx); await E.settle();
  const po = ctx.D.packages.find((p) => p.id === 'pkg_old');
  ok('History: Next avatar on an archived avatar moves the task to the final collection', A.srv2AvatarById(po.srvAvatar.id).collection === 'final' && po.srvAvatar.by === 'operator-next');
  ok('Engines: no other engine\'s package ever gets an SRV Studio avatar', ctx.D.packages.filter((p) => p.engine !== 'SRV English').every((p) => !p.srvAvatar));
}

// ── 4. Build stage uses the V2 avatar; V1 path unchanged ──
{
  const bt = top(H, '_srvEnglishBuildTrigger'), bt0 = top(BASE_H, '_srvEnglishBuildTrigger');
  const v2Line = "  if(_srvStudioV2On())return _srvEnglishV2Build(pkgId,taskId); // SRV Studio V2 cinematic renderer (flag OFF in production)\n";
  ok('Build (D2): V2 returns into _srvEnglishV2Build before any V1 code runs', bt.split('\n')[1] + '\n' === v2Line);
  const vb = top(H, '_srvEnglishV2Build');
  ok('Build (D2): the V2 render uses the package\'s own V2 avatar (pkg.srvAvatar → registry src)', /let av=pkg\.srvAvatar&&srv2AvatarById\(pkg\.srvAvatar\.id\);/.test(vb) && /avatar:av,imageUrl:av\.src/.test(vb) && !/srvEnglishAvatarIdx|avatarLibrary/.test(vb));
  ok('Build: with V2 off, _srvEnglishBuildTrigger is byte-identical to main (V1 avatar library + pointer)', bt.replace(v2Line, '') === bt0);
}

// ── 5. Protected avatar systems unchanged ──
{
  const diffFiles = execSync('git diff --name-only db766dd6ed3c561bdb5ea3577ab4e1bf68c98912 -- public/assets/avatars public/assets/srv-farsi-avatars', { cwd: repo }).toString().trim();
  ok('V1 SRV English avatars (public/assets/avatars) and SRV Farsi avatar files unchanged vs main', diffFiles === '');
  // 026 changed SRV English's modes/hint/productionFormat (Long-only, Emotional-only); the V1 avatar library itself must not change.
  const cfg = (s) => { const b = s.slice(s.indexOf('{id:"srv_english"'), s.indexOf('{id:"nextwave"')); return b.slice(b.indexOf('avatarLibrary:'), b.indexOf('lifecycle:')); };
  ok('V1 avatarLibrary config (ENGINES_CONFIG.srv_english) unchanged', cfg(H).length > 200 && cfg(H) === cfg(BASE_H));
  const farsiCfg = (s) => s.slice(s.indexOf('{id:"srv_farsi"'), s.indexOf('{id:"srv_english"'));
  ok('SRV Farsi avatar pools config unchanged', farsiCfg(H) === farsiCfg(BASE_H));
  const nested = (s, sig) => { const i = s.indexOf(sig); return s.slice(i, s.indexOf('\n    }\n', i)); };
  ok('SRV Farsi avatar picker (_farsiPickAvatar) unchanged', nested(H, '    function _farsiPickAvatar(') === nested(BASE_H, '    function _farsiPickAvatar('));
  ok('SRV Farsi build trigger unchanged', top(H, '_srvFarsiBuildTrigger') === top(BASE_H, '_srvFarsiBuildTrigger'));
  ok('Shared renderer _srvRenderVideo unchanged', top(H, '_srvRenderVideo') === top(BASE_H, '_srvRenderVideo'));
  const man = JSON.parse(read('docs/srv-studio-v2/avatar-rollback-manifest.json'));
  ok('Rollback manifest: 8 V1 files, each matching the file on disk today', man.collection.length === 8 && man.collection.every((e) => crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, e.path))).digest('hex') === e.sha256));
}

// ── 6. Composition module is honest about resolution ──
{
  const C = await import('../srv/studio-v2-preview/srv2-compose.mjs');
  const fakeCtx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : typeof t[k] !== 'undefined' ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const a = A.srv2AvatarById('srv2-av-08'); // archived concept crop
  const t = C.composeThumbnail(fakeCtx, {}, a, { title: 'Test' }), s = C.composeShort(fakeCtx, {}, a, { title: 'Test', lyric: 'line' });
  ok('Compositions on an archived concept crop still report its large enlargement (> 3×)', t.upscale > 3 && s.upscale > 3 && /×/.test(t.sourcePx));
  const f6 = A.srv2AvatarById('srv2-fm-06');
  const tf = C.composeThumbnail(fakeCtx, {}, f6, { title: 'Test' }), sf = C.composeShort(fakeCtx, {}, f6, { title: 'Test', lyric: 'line' });
  ok('Final masters: the 16:9 thumbnail is downscaled (true HD) and the square Short card enlarges ≤ 1.2×', tf.upscale < 1 && sf.upscale > 1 && sf.upscale <= 1.2 && /^942×942$/.test(sf.sourcePx));
  ok('Compositions use an original SRV STUDIO wordmark and the genre line', C.SRV2_BRAND.word === 'SRV STUDIO' && /Emotional Deep House · Night Drive/.test(C.SRV2_BRAND.genre));
}

console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
