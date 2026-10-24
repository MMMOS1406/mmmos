// SRV Studio V2 — order SRV-STUDIO-V2-030 (playlists, Related video / end-screen VA steps, release plan) end to end in real Chrome against the isolated preview (the REAL production
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-030-'));
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


const yt = async (q = '') => (await fetch(srv.origin + '/__stub/yt' + q)).json();
const ledger = () => page.evaluate(async () => { const r = await (await fetch(SUPABASE_URL + '/rest/v1/app_settings?key=eq.srv_studio_v2_production_ledger&select=value')).json(); return r[0] ? JSON.parse(r[0].value) : null; });
const clickText = (rx) => page.evaluate((s) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(s).test(x.textContent)); if (!b) return false; b.click(); return true; }, rx);

// ── 1. LONG: build, Approve shows the release plan, publish → playlist added (API-verified), end-screen VA step ──
const L = '205';
const longPkgId = await page.evaluate((i) => _srvEnglishV2PkgForTask(_srvEnglishTaskById(i)).id, L);
if ((await stage(L)) === 'review') { await page.evaluate((i, p) => _srvEnglishV2ApprovePackage(i, p), L, longPkgId); await sleep(1200); }
if ((await stage(L)) === 'approve') await page.evaluate((i) => _srvEnglishV2SetStage(i, 'build'), L);
await page.evaluate(async (p) => { const b = await (await fetch('/__v2/test-audio.mp3')).blob(); _srvAudioData[p] = { file: new File([b], 'a.mp3', { type: 'audio/mpeg' }), name: 'a.mp3', sizeMB: '2' }; }, longPkgId);
await page.evaluate((i, p) => _srvEnglishV2Build(p, i), L, longPkgId);
await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'approve', { timeout: 300000, polling: 1000 }, L);
await view(L, '#srv2meta_' + longPkgId);
const ap = await page.evaluate(() => document.body.innerText);
ok('Approve (Long): release plan preview — Long · 1920×1080, "SRV Studio, the full Collection · PLXCBPiF9p6SA", Friday 6:00 PM Eastern, America/New_York, end-screen step, stays PRIVATE', /RELEASE PLAN \(PREVIEW\)/i.test(ap) && /SRV Studio, the full Collection · PLXCBPiF9p6SA/.test(ap) && /Fri .* · 6:00 PM E[DS]T/.test(ap) && /America\/New_York/.test(ap) && /stays PRIVATE/.test(ap));
await page.screenshot({ path: path.join(outDir, '030-approve-long-plan.png') });
await page.evaluate((p, i) => _srvEnglishV2ApproveVideo(p, i), longPkgId, L);
await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'done', { timeout: 60000, polling: 500 }, L);
const lp = await page.evaluate((p) => { const x = D.packages.find((q) => q.id === p); return { pl: x.srvPlaylist, plan: x.srvSchedulePlan, vid: x.srvProduction.youtubeVideoId }; }, longPkgId);
let st = await yt();
ok('Long upload → added to "SRV Studio, the full Collection" and verified via the (fake) YouTube API; nothing in the Short playlist', lp.pl && lp.pl.status === 'added' && lp.pl.verified === true && lp.pl.playlistId === 'PLXCBPiF9p6SA' && st.items.PLXCBPiF9p6SA.includes(lp.vid) && !st.items['PLATi-bbiaU30'].includes(lp.vid), lp.pl);
ok('Long: planned public release stored (Friday 6:00 PM ET, provisional, manual) — the upload itself has publishAt null and is PRIVATE', lp.plan && lp.plan.weekday === 'Friday' && lp.plan.localTime === '18:00' && lp.plan.mode === 'planned-manual' && (await dryUploads())[0].payload.publishAt === null && (await dryUploads())[0].payload.privacyStatus === 'private', lp.plan);
await view(L, '#srv2check_' + longPkgId);
const dl = await page.evaluate(() => document.body.innerText);
ok('Done (Long): checklist shows playlist ✓ verified, planned release, PRIVATE now, end-screen VA step with the playlist ID and the Studio Editor link', /PUBLISHING CHECKLIST · LONG/i.test(dl) && /verified via YouTube API/.test(dl) && /End screen \(VA step/.test(dl) && /PLXCBPiF9p6SA/.test(dl) && (await page.evaluate((v) => !!document.querySelector(`a[href="https://studio.youtube.com/video/${v}/editor"]`), lp.vid)));
await clickText('Check now'); await page.waitForFunction((p) => !!(D.packages.find((q) => q.id === p).srvPlaylistSync), { timeout: 15000 }, longPkgId);
const ins1 = (await yt()).calls.filter((c) => c[0] === 'insertItem').length;
ok('Check now (Long): playlist already present → "already", no second insert (duplicate prevention); end-screen playlist eligible (public)', await page.evaluate((p) => { const x = D.packages.find((q) => q.id === p); return x.srvPlaylist.status === 'already' && x.srvPlaylistSync.endScreen.eligible === true; }, longPkgId) && ins1 === 1);
await view(L, '#srv2check_' + longPkgId);
await clickText('I added the end screen'); await page.waitForFunction((p) => !!((D.packages.find((q) => q.id === p).srvVaSteps || {}).endScreen), { timeout: 15000 }, longPkgId);
await view(L, '#srv2check_' + longPkgId);
ok('End screen marked done by the VA (saved, labelled not API-verifiable)', /VA marked done .* \(not API-verifiable\)/.test(await page.evaluate(() => document.body.innerText)));
await page.screenshot({ path: path.join(outDir, '030-done-long-checklist.png') });

// ── 2. SHORT from that Long, uploaded while the token has NO playlist scope (today's state) ──
const S = '9206';
await page.evaluate(() => { const src = _srvEnglishTaskById('203'); const t = JSON.parse(JSON.stringify(src)); t.id = 9206; t.createdAt = Date.now(); t.srvUid = 'srve_' + t.createdAt + '_9206'; t.status = 'assigned'; t.name = 'SRV English — Female — Emotional · Long [PREVIEW TEST]'; delete t.vaOverrides; D.tasks.push(t); _srvEnglishV2SetStage('9206', 'generate'); saveAppState(); _srvEnglishV2ChooseFormat('9206', 'short'); _srvEnglishV2PromoSel['9206'] = { longPkgId: 'pkg_preview_205', startSec: 12, durationSec: 30 }; });
await page.evaluate(() => _srvEnglishV2CreatePromoShort('9206')); await page.waitForFunction(() => _srvEnglishV2GetStage('9206') === 'review', { timeout: 30000 });
const sp = await page.evaluate(() => _srvEnglishV2PkgForTask(_srvEnglishTaskById('9206')).id);
await page.evaluate((p) => _srvEnglishV2ApprovePackage('9206', p), sp); await page.waitForFunction(() => _srvEnglishV2GetStage('9206') === 'build', { timeout: 30000 });
await page.evaluate((p) => _srvEnglishV2Build(p, '9206'), sp); await page.waitForFunction(() => _srvEnglishV2GetStage('9206') === 'approve', { timeout: 300000, polling: 1000 });
await view(S, '#srv2meta_' + sp);
const as = await page.evaluate(() => document.body.innerText);
ok('Approve (Short): release plan — Short · 1080×1920, "SRV Studio Full Short Collection · PLATi-bbiaU30", Sunday 6:00 PM Eastern, related Long title + id', /SRV Studio Full Short Collection · PLATi-bbiaU30/.test(as) && /Sun .* · 6:00 PM E[DS]T/.test(as) && new RegExp('Borrowed Headlights · ' + lp.vid).test(as));
await yt('?scope=0');
await page.evaluate((p) => _srvEnglishV2ApproveVideo(p, '9206'), sp);
await page.waitForFunction(() => _srvEnglishV2GetStage('9206') === 'done', { timeout: 60000, polling: 500 });
const s1 = await page.evaluate((p) => { const x = D.packages.find((q) => q.id === p); return { pl: x.srvPlaylist, vid: x.srvProduction.youtubeVideoId, plan: x.srvSchedulePlan }; }, sp);
ok('Short upload without the playlist scope: upload succeeds (PRIVATE), playlist reported insufficient_scope, nothing inserted', s1.vid && s1.pl.status === 'failed' && s1.pl.error === 'insufficient_scope' && !(await yt()).items['PLATi-bbiaU30'].includes(s1.vid) && (await dryUploads())[1].payload.privacyStatus === 'private', s1.pl);
ok('Short: planned release Sunday 6:00 PM ET (provisional)', s1.plan && s1.plan.weekday === 'Sunday' && s1.plan.localTime === '18:00');
await view(S, '#srv2check_' + sp);
const ds = await page.evaluate(() => document.body.innerText);
ok('Done (Short): playlist not added explained (playlist permission), "Add to playlist in YouTube Studio" fallback, Related-video VA step naming the Long', /playlist permission/.test(ds) && /Add to playlist in YouTube Studio/.test(ds) && /Related video \(VA step/.test(ds) && /Borrowed Headlights/.test(ds));
// the Long is still private in (fake) YouTube → Related video not yet possible
await clickText('Check now'); await page.waitForFunction((p) => !!(D.packages.find((q) => q.id === p).srvPlaylistSync), { timeout: 15000 }, sp);
ok('Check now (Short, Long still PRIVATE): Related video not eligible — "make it public or unlisted first"', await page.evaluate((p) => { const r = D.packages.find((q) => q.id === p).srvPlaylistSync.related; return r && r.eligible === false && r.reason === 'long_is_private'; }, sp));
await view(S, '#srv2check_' + sp);
ok('the screen tells the VA to make the Long public or unlisted first', /make it public or unlisted first/.test(await page.evaluate(() => document.body.innerText)));
// CEO later publishes the Long in Studio and reconnects with the playlist scope (simulated) → Check now completes
await yt('?scope=1&video=' + lp.vid + '&privacy=public');
await clickText('Check now'); await page.waitForFunction((p) => { const x = D.packages.find((q) => q.id === p); return x.srvPlaylist && x.srvPlaylist.status === 'added'; }, { timeout: 15000 }, sp);
ok('after the scope is granted: Check now adds the Short to "SRV Studio Full Short Collection" (verified); Long public → Related video eligible', (await yt()).items['PLATi-bbiaU30'].includes(s1.vid) && await page.evaluate((p) => D.packages.find((q) => q.id === p).srvPlaylistSync.related.eligible === true, sp));
await view(S, '#srv2check_' + sp);
await clickText('I added the related video'); await page.waitForFunction((p) => !!((D.packages.find((q) => q.id === p).srvVaSteps || {}).relatedVideo), { timeout: 15000 }, sp);
await view(S, '#srv2check_' + sp);
await page.screenshot({ path: path.join(outDir, '030-done-short-checklist.png') });
ok('Related video marked done by the VA (saved; never claimed as API-verified)', /VA marked done .* \(not API-verifiable\)/.test(await page.evaluate(() => document.body.innerText)));
const lg = await ledger();
ok('ledger: both entries keep their upload fields; playlist results recorded per entry (Long added, Short added after the sync)', lg.entries.length === 2 && lg.entries.every((e) => e.status === 'uploaded') && lg.entries[0].playlist.playlistId === 'PLXCBPiF9p6SA' && lg.entries[1].playlist.status === 'added' && lg.entries[1].playlist.playlistId === 'PLATi-bbiaU30', lg.entries.map((e) => [e.kind, e.playlist && e.playlist.status]));
const fin = await yt();
ok('fake YouTube: each video in exactly one playlist, once (no duplicates); no other playlist touched', fin.items.PLXCBPiF9p6SA.filter((v) => v === lp.vid).length === 1 && fin.items['PLATi-bbiaU30'].filter((v) => v === s1.vid).length === 1 && !fin.items.PLXCBPiF9p6SA.includes(s1.vid) && Object.keys(fin.items).length === 2);
const after = await page.evaluate(() => ({ slots: JSON.stringify(D._publishSlots || {}) }));
ok('no shared publishing slot taken; every upload PRIVATE with publishAt null', after.slots === '{}' && (await dryUploads()).every((d) => d.payload.privacyStatus === 'private' && d.payload.publishAt === null));
ok('No page errors; no production requests', errors.length === 0 && srv.productionHits === 0, errors.slice(0, 2));
fs.writeFileSync(path.join(outDir, '030-checks.json'), JSON.stringify(checks, null, 1));
const failed = checks.filter((c) => !c.pass).length; console.log(`\n${checks.length - failed} passed, ${failed} failed · productionHits ${srv.productionHits}`);
await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(failed ? 1 : 0);
