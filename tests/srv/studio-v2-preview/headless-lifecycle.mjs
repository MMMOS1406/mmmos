// SRV Studio V2 — Checkpoint D2 end-to-end lifecycle in real Chrome against the isolated preview:
// Long #203 Review → Build (real V2 render of the full sample song) → Approve (playback) → Publish (dry run) → Done,
// Short #204 Build → Approve → Publish → Done, and the flag-OFF card for comparison. Screenshots + JSON to OUTDIR.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node headless-lifecycle.mjs OUTDIR
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-lifecycle-'));
const srv = await startPreview({ publicDir: path.resolve(here, '../../../public'), port: 0, storageDir: path.join(tmp, 'storage'), dataFile: path.join(tmp, 'state.json') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
const step = (name, data) => { report.steps.push({ name, ...data }); console.log('•', name, JSON.stringify(data).slice(0, 300)); };

async function signedIn(url) {
  const page = await browser.newPage(); await page.setViewport({ width: 1200, height: 1400 });
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
  await page.goto(url); await login(page, srv.origin, await page.evaluate(() => USERS.find((u) => u.name === 'Mansoor').id));
  await sleep(4000); await settle(page, srv.origin, 900); // let the one-time post-login refresh pass
  return page;
}
async function shot(page, taskId, file) {
  await page.evaluate((id) => _srvEnglishV2Show(id), taskId); await sleep(1500);
  const el = await page.evaluateHandle(() => [...document.querySelectorAll('.card')].find((c) => /SRV English · New Lifecycle/.test(c.textContent) && c.offsetParent));
  if (el && el.asElement()) await el.asElement().screenshot({ path: path.join(outDir, file) });
}
const pkgOf = (page, id) => page.evaluate((i) => { const p = _srvEnglishV2PkgForTask(_srvEnglishTaskById(i)); return p && p.id; }, id);
const state = (page, id) => page.evaluate((i) => { const p = _srvEnglishV2PkgForTask(_srvEnglishTaskById(i)); return { stage: _srvEnglishV2GetStage(i), status: _srvEnglishTaskById(i).status, avatar: p.srvAvatar && p.srvAvatar.id, render: p.srvRender && { mime: p.srvRender.mime, w: p.srvRender.width, h: p.srvRender.height, dur: p.srvRender.durationSec, kbps: p.srvRender.measuredKbps, frames: p.srvRender.frames, upscale: p.srvRender.maxSourceUpscale, hooks: p.srvRender.hooks, thumbBytes: p.srvRender.thumb && p.srvRender.thumb.bytes }, publish: p.srvPublish || null }; }, id);
async function loadAudio(page, pkgId) {
  await page.evaluate(async (id) => { const b = await (await fetch('/__v2/test-audio.mp3')).blob(); _srvAudioData[id] = { file: new File([b], 'neon-nights.mp3', { type: 'audio/mpeg' }), name: 'neon-nights.mp3', sizeMB: (b.size / 1048576).toFixed(1) }; }, pkgId);
}
async function buildApprovePublish(page, taskId, label) {
  const pkgId = await pkgOf(page, taskId);
  await shot(page, taskId, `${label}-1-build.png`);
  await loadAudio(page, pkgId);
  const t0 = Date.now();
  await page.evaluate((id) => _srvEnglishV2Show(id), taskId); await sleep(800);
  await page.click('#srv-lc-build-btn-' + pkgId);
  await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'approve', { timeout: 400000, polling: 2000 }, taskId);
  step(`${label}: build → approve`, { seconds: Math.round((Date.now() - t0) / 1000), ...(await state(page, taskId)) });
  await shot(page, taskId, `${label}-2-approve.png`);
  const play = await page.evaluate(async (id) => { const v = document.querySelector(`video[src*="${id}"]`); if (!v) return null; v.muted = true; await new Promise((r) => (v.readyState >= 3 ? r() : v.addEventListener('canplay', r, { once: true }))); v.currentTime = 5; await v.play(); await new Promise((r) => setTimeout(r, 1200)); const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {}; return { duration: v.duration, w: v.videoWidth, h: v.videoHeight, t: v.currentTime, playing: !v.paused, decoded: q.totalVideoFrames }; }, pkgId);
  step(`${label}: approve playback`, { play });
  const meta = await page.evaluate((id) => (document.getElementById('srv2meta_' + id) || {}).textContent, pkgId);
  step(`${label}: approve metadata preview`, { meta: String(meta).split('\n').slice(0, 4).join(' | ') });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Approve & Publish/.test(b.textContent) && b.offsetParent).click());
  await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'done', { timeout: 60000, polling: 500 }, taskId);
  step(`${label}: publish → done`, await state(page, taskId));
  await shot(page, taskId, `${label}-3-done.png`);
}

const page = await signedIn(srv.origin + '/');
// Long #203 starts at Review: approve the reviewed package (the Review "Approve" action), then build.
const p203 = await pkgOf(page, '203');
await shot(page, '203', 'long-0-review.png');
await page.evaluate((id) => _srvEnglishV2ApprovePackage('203', id), p203); await sleep(1500);
step('long: review → build', await state(page, '203'));
await buildApprovePublish(page, '203', 'long');
await buildApprovePublish(page, '204', 'short');
await page.close();

// Flag OFF: the same task card renders the unchanged V1 build stage.
const off = await signedIn(srv.origin + '/?srvStudioV2=off');
const v1 = await off.evaluate(() => { const t = D.tasks.find((x) => String(x.id) === '202'); D.srvLifecycleStages['202'] = 'build'; const h = renderSRVEnglishLifecycleCard(t); return { on: _srvStudioV2On(), v1Label: /Fetch Background \+ Render Video/.test(h), v2Panel: /V2 CINEMATIC RENDER/.test(h), v2Label: /Render Cinematic Video/.test(h) }; });
step('flag OFF: V1 build card unchanged', v1);
await off.close();

const dry = await (await fetch(srv.origin + '/__stub/dryrun')).json();
const log = await (await fetch(srv.origin + '/__stub/log')).json();
report.dryRuns = dry.dryRuns; report.productionHits = srv.productionHits;
report.requests = { total: log.count, storageWrites: log.log.filter((e) => e.kind === 'storage-write').map((e) => ({ path: e.path.split('/').slice(-1)[0], bytes: e.bytes, type: e.type })), pexels: log.log.filter((e) => e.action === 'srv_english_pexels_bg').length };
fs.writeFileSync(path.join(outDir, 'lifecycle-result.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ productionHits: report.productionHits, dryRuns: dry.dryRuns.map((d) => [d.action, d.ok, d.payload.title || d.payload.engine]), requests: report.requests }, null, 1));
await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
