// SRV Studio V2 — Checkpoint E3: the two-video pilot end to end in real Chrome against the isolated preview.
// #203 (Long) and #204 (Short) are authorized; #205 is not. Build → Approve → Publish through the real app, then
// a repeat publish of #204 and an unlisted #205. Checks titles, privacy, schedule, slots, ledger, engine state.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node headless-pilot.mjs OUTDIR
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-pilot-'));
const srv = await startPreview({ publicDir: path.resolve(here, '../../../public'), port: 0, storageDir: path.join(tmp, 's'), dataFile: path.join(tmp, 'state.json') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = []; const ok = (n, c, x) => { checks.push({ n, pass: !!c, x }); console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const page = await browser.newPage(); await page.setViewport({ width: 1200, height: 1400 });
page.on('dialog', (d) => d.accept()); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(srv.origin + '/'); await login(page, srv.origin, await page.evaluate(() => USERS.find((u) => u.name === 'Mansoor').id));
await sleep(4000); await settle(page, srv.origin, 900);
const pkgOf = (id) => page.evaluate((i) => { const p = _srvEnglishV2PkgForTask(_srvEnglishTaskById(i)); return p && p.id; }, id);
const stage = (id) => page.evaluate((i) => _srvEnglishV2GetStage(i), id);
const shot = async (id, file) => { await page.evaluate((i) => _srvEnglishV2Show(i), id); await sleep(1500); const el = await page.evaluateHandle(() => [...document.querySelectorAll('.card')].find((c) => /SRV English · New Lifecycle/.test(c.textContent) && c.offsetParent)); if (el && el.asElement()) await el.asElement().screenshot({ path: path.join(outDir, file) }); };
const slots0 = await page.evaluate(() => JSON.stringify(D._publishSlots || {}));
async function buildAndPublish(id, label) {
  const pkgId = await pkgOf(id);
  if ((await stage(id)) === 'review') { await page.evaluate((i, p) => _srvEnglishV2ApprovePackage(i, p), id, pkgId); await sleep(1200); }
  if ((await stage(id)) === 'approve') await page.evaluate((i) => _srvEnglishV2SetStage(i, 'build'), id);
  await page.evaluate(async (p) => { const b = await (await fetch('/__v2/test-audio.mp3')).blob(); _srvAudioData[p] = { file: new File([b], 'a.mp3', { type: 'audio/mpeg' }), name: 'a.mp3', sizeMB: '2' }; }, pkgId);
  await page.evaluate((i, p) => _srvEnglishV2Build(p, i), id, pkgId);
  await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'approve', { timeout: 300000, polling: 1000 }, id);
  await page.evaluate((i) => _srvEnglishV2Show(i), id); await sleep(2500);
  const meta = await page.evaluate((p) => (document.getElementById('srv2meta_' + p) || {}).textContent || '', pkgId);
  await shot(id, `pilot-${label}-approve.png`);
  await page.evaluate((p, i) => _srvEnglishV2ApproveVideo(p, i), pkgId, id);
  await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'done' || /refused|failed/i.test((document.getElementById('srv-lc-publish-status-' + _srvEnglishV2PkgForTask(_srvEnglishTaskById(i)).id) || {}).textContent || ''), { timeout: 60000, polling: 500 }, id);
  await shot(id, `pilot-${label}-done.png`);
  return { pkgId, meta, stage: await stage(id), pkg: await page.evaluate((p) => { const x = D.packages.find((q) => q.id === p); return { isTest: x.isTest, srvPilot: x.srvPilot || null, srvPublish: x.srvPublish || null, attempt: x.srvPilotAttempt || null }; }, pkgId) };
}
const L = await buildAndPublish('203', 'long');
ok('Approve preview announces the pilot upload with the normal title', /PILOT UPLOAD \(LONG/.test(L.meta) && /Title \(\d+\/100\): Leave the Engine Running - Emotional Deep House \| Night Drive SRV Studio/.test(L.meta) && !/\[TEST\]/.test(L.meta), L.meta.split('\n').slice(0, 2));
ok('Long pilot: Done, pilot record with YouTube id/time/channel, package still isTest', L.stage === 'done' && L.pkg.isTest === true && L.pkg.srvPilot && L.pkg.srvPilot.youtubeVideoId && L.pkg.srvPilot.channelId === 'UC0nzWQX6AaUqlF5FozNpWPg' && L.pkg.srvPublish.pilot === true, L.pkg.srvPilot);
const S = await buildAndPublish('204', 'short');
ok('Short pilot: Done with its own pilot record', S.stage === 'done' && S.pkg.srvPilot && S.pkg.srvPilot.kind === 'short' && S.pkg.isTest === true, S.pkg.srvPilot);
const dry = (await (await fetch(srv.origin + '/__stub/dryrun')).json()).dryRuns.filter((d) => d.action === 'youtube_upload_video');
ok('Uploads: two, normal titles, private, publishAt null, AI disclosure, SRV English engine', dry.length === 2 && dry.every((d) => !/\[TEST\]/.test(d.payload.title) && d.payload.privacyStatus === 'private' && d.payload.publishAt === null && d.payload.containsSyntheticMedia === true && d.payload.engine === 'SRV English'), dry.map((d) => d.payload.title));
// a repeat publish of #204 and an unlisted #205
await page.evaluate((i) => _srvEnglishV2SetStage(i, 'publish'), '204');
const pkg204 = S.pkgId; await page.evaluate((p, i) => _srvEnglishV2Publish(p, i), pkg204, '204'); await sleep(1500);
const rep = await page.evaluate((p) => D.packages.find((q) => q.id === p).srvPilotAttempt, pkg204);
ok('Repeat publish of an already-uploaded pilot task is refused by the server (no new upload)', rep && rep.error === 'task_already_uploaded_or_in_progress' && (await (await fetch(srv.origin + '/__stub/dryrun')).json()).dryRuns.filter((d) => d.action === 'youtube_upload_video').length === 2, rep);
const U = await buildAndPublish('205', 'unlisted');
const dry2 = (await (await fetch(srv.origin + '/__stub/dryrun')).json()).dryRuns.filter((d) => d.action === 'youtube_upload_video');
ok('Unlisted task #205 still publishes as ordinary TEST ([TEST] title, private, unscheduled)', U.stage === 'done' && !U.pkg.srvPilot && dry2.length === 3 && /^\[TEST\] /.test(dry2[2].payload.title) && dry2[2].payload.publishAt === null);
const pilot = await (await fetch(srv.origin + '/__stub/pilot')).json();
ok('Ledger: exactly two "uploaded" entries (Long #203, Short #204) with ids and timestamps', pilot.ledger && pilot.ledger.entries.filter((e) => e.status === 'uploaded').length === 2 && pilot.ledger.entries.every((e) => e.status !== 'uploaded' || (e.youtubeVideoId && e.uploadedAt && e.claimedAt)), pilot.ledger && pilot.ledger.entries.map((e) => [e.kind, e.status, e.youtubeVideoId]));
const after = await page.evaluate(() => ({ slots: JSON.stringify(D._publishSlots || {}), engine: _getEngineState('SRV English') }));
ok('Zero publishing slots taken; the SRV English engine is still in TEST', after.slots === slots0 && after.engine === 'test', after);
ok('No page errors; no production requests', errors.length === 0 && srv.productionHits === 0, errors.slice(0, 2));
fs.writeFileSync(path.join(outDir, 'pilot-result.json'), JSON.stringify({ checks, ledger: pilot.ledger, uploads: dry2.map((d) => ({ title: d.payload.title, privacy: d.payload.privacyStatus, publishAt: d.payload.publishAt })) }, null, 1));
const failed = checks.filter((c) => !c.pass).length; console.log(`\n${checks.length - failed} passed, ${failed} failed · productionHits ${srv.productionHits}`);
await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(failed ? 1 : 0);
