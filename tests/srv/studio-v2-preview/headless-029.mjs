// SRV Studio V2 — order SRV-STUDIO-V2-029 end to end in real Chrome against the isolated preview (the REAL production
// policy from lib/srvStudioV2Pilot.mjs runs in the stub; every upload is a dry run, nothing reaches YouTube).
// Production with formats ["long","short"]: an ordinary Long is built + published; a second task is switched to SHORT
// at Generate, cut from that Long (30 s section), given a cover from the full library, approved, rendered 1080×1920
// and published. Checks the shared title, audio source, render size/duration, privacy, ledger and identity.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node headless-029.mjs OUTDIR
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startPreview } from './server.mjs';
import { login, settle } from '../../preservation/driver.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PUPPETEER_CORE || here, 'x.js'));
const puppeteer = require('puppeteer-core');
const outDir = path.resolve(process.argv[2]); fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-029-'));
const srv = await startPreview({ publicDir: path.resolve(here, '../../../public'), port: 0, storageDir: path.join(tmp, 's'), dataFile: path.join(tmp, 'state.json') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = []; const ok = (n, c, x) => { checks.push({ n, pass: !!c, x }); console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); };
const page = await browser.newPage(); await page.setViewport({ width: 1200, height: 1400 });
const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); }); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(srv.origin + '/'); await login(page, srv.origin, await page.evaluate(() => USERS.find((u) => u.name === 'Mansoor').id));
await sleep(4000); await settle(page, srv.origin, 900);
// work from the Tasks tab like the VA (the CEO dashboard re-renders itself from async data and would replace the task panel)
await page.evaluate(() => renderTab('tasks'));
// the existing SMM operator loader redraws the Tasks tab once when its data arrives (it would close an open SRV panel) — let it finish first
await page.waitForFunction(() => typeof _smmOperatorState === 'undefined' || (!_smmOperatorState.loading && (_smmOperatorState.loaded || _smmOperatorState.error)), { timeout: 30000 }).catch(() => null); await sleep(1500);
const view = async (id, sel) => { await page.evaluate((i) => _srvEnglishV2Show(i), id); if (sel) await page.waitForSelector(sel, { timeout: 15000 }); else await sleep(1500); };
const put = (key, value) => page.evaluate(async (k, v) => { await fetch(SUPABASE_URL + '/rest/v1/app_settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: k, value: v }) }); }, key, value);
await put('srv_studio_v2_production', JSON.stringify({ enabled: true, formats: ['long', 'short'], dailyCap: 5, channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' }));
await put('srv_studio_v2_pilot', JSON.stringify({ enabled: false }));
const stage = (id) => page.evaluate((i) => _srvEnglishV2GetStage(i), id);
const dryUploads = async () => (await (await fetch(srv.origin + '/__stub/dryrun')).json()).dryRuns.filter((d) => d.action === 'youtube_upload_video');

// ── 1. LONG: the existing lifecycle (unchanged) ──
const L = '205';
const longPkgId = await page.evaluate((i) => _srvEnglishV2PkgForTask(_srvEnglishTaskById(i)).id, L);
if ((await stage(L)) === 'review') { await page.evaluate((i, p) => _srvEnglishV2ApprovePackage(i, p), L, longPkgId); await sleep(1200); }
if ((await stage(L)) === 'approve') await page.evaluate((i) => _srvEnglishV2SetStage(i, 'build'), L);
await page.evaluate(async (p) => { const b = await (await fetch('/__v2/test-audio.mp3')).blob(); _srvAudioData[p] = { file: new File([b], 'a.mp3', { type: 'audio/mpeg' }), name: 'a.mp3', sizeMB: '2' }; }, longPkgId);
await page.evaluate((i, p) => _srvEnglishV2Build(p, i), L, longPkgId);
await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'approve', { timeout: 300000, polling: 1000 }, L);
const longP = await page.evaluate((p) => { const x = D.packages.find((q) => q.id === p); return { title: x.title, audio: x._srvAudioUrl || null, video: x._srvLongVideoUrl, r: x.srvRender }; }, longPkgId);
ok('Long: built 1920×1080 with the cinematic renderer; its original MP3 is now kept for Shorts', longP.r.width === 1920 && longP.r.height === 1080 && /srv-assets\/pkg_preview_205\/audio_/.test(longP.audio || '') && /srv-assets\/pkg_preview_205\/long_/.test(longP.video), { r: [longP.r.width, longP.r.height, longP.r.durationSec], audio: longP.audio });
await page.evaluate((p, i) => _srvEnglishV2ApproveVideo(p, i), longPkgId, L);
await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'done', { timeout: 60000, polling: 500 }, L);
const up1 = await dryUploads();
ok('Long: uploaded through normal production — one PRIVATE, unscheduled upload with the clean title', up1.length === 1 && up1[0].payload.privacyStatus === 'private' && up1[0].payload.publishAt === null && up1[0].payload.title.startsWith(longP.title + ' - '), up1.map((d) => d.payload.title));

// ── 2. SHORT: a new task (id 9206 — the shared fixture already has an SRV Farsi task #206), switched to SHORT at Generate, cut from that Long ──
const S = '9206';
await page.evaluate(() => {
  const src = _srvEnglishTaskById('203'); const t = JSON.parse(JSON.stringify(src));
  t.id = 9206; t.createdAt = Date.now(); t.srvUid = 'srve_' + t.createdAt + '_9206'; t.status = 'assigned'; t.name = 'SRV English — Female — Emotional · Long [PREVIEW TEST]';
  delete t.vaOverrides; D.tasks.push(t); _srvEnglishV2SetStage('9206', 'generate'); saveAppState();
});
await view(S, '#srv2fmtsel_9206');
const sel0 = await page.evaluate(() => !!document.getElementById('srv2fmtsel_9206'));
ok('Generate shows the LONG / SHORT selector', sel0);
await page.evaluate(() => { [...document.querySelectorAll('#srv2fmtsel_9206 button')].find((b) => /SHORT/.test(b.textContent)).click(); });
await page.waitForSelector('#srv2promo_long_9206', { timeout: 15000 }).catch(() => null);
const g = await page.evaluate(() => ({ t: (({ isLong, contentFormat, srvPromo, name }) => ({ isLong, contentFormat, srvPromo, name }))(_srvEnglishTaskById('9206')), opts: [...(document.getElementById('srv2promo_long_9206') || { options: [] }).options].map((o) => o.value), dur: (document.getElementById('srv2promo_dur_9206') || {}).value }));
ok('SHORT (clicked): task is a promotional Short; the Long picker lists the built SRV Studio Long; length defaults to 30 s', g.t.srvPromo === true && g.t.isLong === false && g.opts.includes('pkg_preview_205') && g.dur === '30', g);
await page.select('#srv2promo_long_9206', 'pkg_preview_205'); await page.waitForSelector('#srv2promo_start_9206', { timeout: 15000 });
await page.evaluate(() => { const el = document.getElementById('srv2promo_start_9206'); el.value = '12'; el.dispatchEvent(new Event('change')); }); await page.waitForFunction(() => /0:12 – 0:42/.test((document.getElementById('srv2promo_range_9206') || {}).textContent || ''), { timeout: 15000 });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Create Short from this Long/.test(b.textContent)).click());
await page.waitForFunction(() => _srvEnglishV2GetStage('9206') === 'review', { timeout: 30000, polling: 300 });
const sp = await page.evaluate(() => { const p = _srvEnglishV2PkgForTask(_srvEnglishTaskById('9206')); return { id: p.id, title: p.title, lyrics: p.lyrics, so: p.srvShortOf, av: p.srvAvatar }; });
ok('Short created from the Long (Create clicked): same song title and lyrics, section 12 s + 30 s, Long MP3 as audio', sp.title === longP.title && sp.so.longPkgId === 'pkg_preview_205' && sp.so.startSec === 12 && sp.so.durationSec === 30 && sp.so.audioSource === 'long-mp3' && sp.so.longYoutubeVideoId === 'dryrun00001', sp.so);
const rows = await (await fetch(srv.origin + '/__stub/state')).json();
ok('Both packages are stored with the identical title (separate package ids)', rows.packages.filter((r) => r.title === longP.title).map((r) => r.id).sort().join(',') === ['pkg_preview_205', sp.id].sort().join(','), rows.packages.filter((r) => r.title === longP.title));
await view(S, '#srv2avlib_' + sp.id);
// full avatar library (clicked)
await page.evaluate((p) => [...document.querySelectorAll('button')].find((b) => /Choose from library/.test(b.textContent)).click(), sp.id); await sleep(500);
const lib = await page.evaluate((p) => { const box = document.getElementById('srv2avlib_' + p); const imgs = [...box.querySelectorAll('img')]; return { shown: box.style.display, n: imgs.length, gray: imgs.every((i) => /grayscale\(1\)/.test(i.style.filter)), src: imgs.map((i) => i.getAttribute('src')) }; }, sp.id);
ok('Avatar library: opens with 19 previews of the approved images, all monochrome (none archived, #09 held out)', lib.shown === 'block' && lib.n === 19 && lib.gray && !lib.src.some((s) => /concept|-09-/.test(s)), { n: lib.n });
const loaded = await page.evaluate(async (p) => { const imgs = [...document.getElementById('srv2avlib_' + p).querySelectorAll('img')]; await Promise.all(imgs.map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; i.loading = 'eager'; })))); return imgs.filter((i) => i.naturalWidth > 0).length; }, sp.id);
ok('Avatar library: all 19 previews load', loaded === 19, loaded);
await page.screenshot({ path: path.join(outDir, '029-review-short-library.png'), fullPage: false });
await page.evaluate((p) => document.querySelector(`#srv2avlib_${p} button[onclick*="srv2-fm-17"]`).click(), sp.id);
await page.waitForFunction((p) => D.packages.find((q) => q.id === p).srvAvatar.id === 'srv2-fm-17', { timeout: 15000, polling: 300 }, sp.id);
ok('Avatar library: a tapped image is saved for the Short as the operator\'s choice', await page.evaluate((p) => { const a = D.packages.find((q) => q.id === p).srvAvatar; return a.id === 'srv2-fm-17' && a.by === 'operator-choice'; }, sp.id));
await sleep(800);
const rv = await page.evaluate(() => document.body.innerHTML);
ok('Review (Short): source panel + caption only — the song title / lyrics / prompt are not editable', /PROMOTIONAL SHORT · FROM AN SRV STUDIO LONG/.test(rv) && new RegExp('srv2f_' + sp.id + '_captionYT').test(rv) && !new RegExp('srv2f_' + sp.id + '_(title|lyrics|sunoPrompt|shortLyrics)"').test(rv));
await page.evaluate((p) => _srvEnglishV2ApprovePackage('9206', p), sp.id);
await page.waitForFunction(() => _srvEnglishV2GetStage('9206') === 'build', { timeout: 30000, polling: 300 });
await view(S, '#srv-lc-build-btn-' + sp.id);
const bh = await page.evaluate(() => document.body.innerText);
ok('Build (Short): no Suno / MP3 steps — the audio comes from the Long', !/UPLOAD MP3/.test(bh) && /BUILD THE SHORT/.test(bh) && /30 s from the Long \(0:12–0:42\)/.test(bh));
await page.evaluate((p) => document.getElementById('srv-lc-build-btn-' + p).click(), sp.id);
await page.waitForFunction(() => _srvEnglishV2GetStage('9206') === 'approve' || /failed|refused/i.test((document.querySelector('[id^="srv-lc-build-status-"]') || {}).textContent || ''), { timeout: 300000, polling: 1000 });
const sr = await page.evaluate((p) => { const x = D.packages.find((q) => q.id === p); return { r: x.srvRender, url: x._srvShortVideoUrl, st: (document.getElementById('srv-lc-build-status-' + p) || {}).textContent }; }, sp.id);
ok('Short render: 1080×1920 vertical, 25–35 s (here ~30 s), from second 12 of the Long', sr.r && sr.r.width === 1080 && sr.r.height === 1920 && sr.r.durationSec >= 25 && sr.r.durationSec <= 35 && sr.r.startSec === 12 && sr.r.section && sr.r.section.longPkgId === 'pkg_preview_205', sr.r ? { w: sr.r.width, h: sr.r.height, d: sr.r.durationSec, start: sr.r.startSec, frames: sr.r.frames } : sr.st);
// measure the uploaded file in the browser: real duration + size of the stored Short
const meas = await page.evaluate(async (u) => new Promise((res) => { const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.onloadedmetadata = () => res({ w: v.videoWidth, h: v.videoHeight, d: v.duration }); v.onerror = () => res({ err: 'load' }); v.src = u; }), sr.url);
ok('Stored Short file plays as 1080×1920, 25–35 s', meas.w === 1080 && meas.h === 1920 && meas.d >= 25 && meas.d <= 35.5, meas);
await view(S, '#srv2meta_' + sp.id); await page.waitForFunction((p) => !/^Loading/.test(document.getElementById('srv2meta_' + p).textContent), { timeout: 15000 }, sp.id);
await page.screenshot({ path: path.join(outDir, '029-approve-short.png'), fullPage: false });
const meta = await page.evaluate((p) => (document.getElementById('srv2meta_' + p) || {}).textContent || '', sp.id);
ok('Approve preview: SRV STUDIO PRODUCTION UPLOAD (SHORT), private, not scheduled, names its Long', /SRV STUDIO PRODUCTION UPLOAD \(SHORT\) — normal title, PRIVATE, not scheduled/.test(meta) && /Promotional Short of the Long/.test(meta) && /#Shorts/.test(meta), meta.split('\n').slice(0, 3));
await page.evaluate((p) => _srvEnglishV2ApproveVideo(p, '9206'), sp.id);
await page.waitForFunction(() => _srvEnglishV2GetStage('9206') === 'done' || /refused|failed/i.test((document.querySelector('[id^="srv-lc-publish-status-"]') || {}).textContent || ''), { timeout: 60000, polling: 500 });
const up2 = await dryUploads();
const shortUp = up2[1] && up2[1].payload;
ok('Short published through normal production: PRIVATE, publishAt null, AI disclosure, the Long\'s exact song title', up2.length === 2 && shortUp.privacyStatus === 'private' && shortUp.publishAt === null && shortUp.containsSyntheticMedia === true && shortUp.title === up1[0].payload.title && /AI-generated/.test(shortUp.description) && /srv-assets\/pkg_/.test(shortUp.videoUrl) && shortUp.videoUrl === sr.url, up2.map((d) => d.payload.title));
const ledger = await page.evaluate(async () => { const r = await (await fetch(SUPABASE_URL + '/rest/v1/app_settings?key=eq.srv_studio_v2_production_ledger&select=value')).json(); return JSON.parse(r[0].value); });
ok('Ledger: two entries keyed by their own task uid + package id (one long, one short), same title — neither consumed the other', ledger.entries.length === 2 && ledger.entries[0].kind === 'long' && ledger.entries[1].kind === 'short' && ledger.entries[0].taskUid !== ledger.entries[1].taskUid && ledger.entries[1].pkgId === sp.id && ledger.entries[0].pkgId === 'pkg_preview_205' && ledger.entries.every((e) => e.status === 'uploaded'), ledger.entries.map((e) => [e.kind, e.taskUid, e.pkgId]));
// duplicate-upload protection: re-publishing the Short is refused
await page.evaluate(() => _srvEnglishV2SetStage('9206', 'publish'));
await page.evaluate((p) => _srvEnglishV2Publish(p, '9206'), sp.id); await sleep(1500);
const rep = await page.evaluate((p) => D.packages.find((q) => q.id === p).srvProductionAttempt, sp.id);
ok('Duplicate-upload protection: a repeat publish of the Short is refused by the server, no new upload', rep && ['task_already_uploaded_or_in_progress', 'task_closed'].includes(rep.error) && (await dryUploads()).length === 2, rep);
const after = await page.evaluate(() => ({ slots: JSON.stringify(D._publishSlots || {}), longTask: (({ isLong, contentFormat, srvPromo }) => ({ isLong, contentFormat, srvPromo }))(_srvEnglishTaskById('205')) }));
ok('No publishing slot taken; the Long task is unchanged (still Long)', after.slots === '{}' && after.longTask.isLong === true && !after.longTask.srvPromo, after);
ok('No page errors; no production requests', errors.length === 0 && srv.productionHits === 0, errors.slice(0, 2));
fs.writeFileSync(path.join(outDir, '029-checks.json'), JSON.stringify(checks, null, 1));
const failed = checks.filter((c) => !c.pass).length; console.log(`\n${checks.length - failed} passed, ${failed} failed · productionHits ${srv.productionHits}`);
await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(failed ? 1 : 0);
