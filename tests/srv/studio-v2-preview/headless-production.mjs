// SRV Studio V2 — order SRV-STUDIO-V2-028: normal VA-operated production end to end in real Chrome against the
// isolated preview (the REAL production policy from lib/srvStudioV2Pilot.mjs runs in the stub; uploads are dry runs).
// Production switched on, pilot switched off; an ordinary Long goes Build → Approve → Publish; then a repeat publish
// and a cancelled task. Checks title, privacy, schedule, ledger, earlier ledgers untouched, no production requests.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node headless-production.mjs OUTDIR
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-prod-'));
const srv = await startPreview({ publicDir: path.resolve(here, '../../../public'), port: 0, storageDir: path.join(tmp, 's'), dataFile: path.join(tmp, 'state.json') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = []; const ok = (n, c, x) => { checks.push({ n, pass: !!c, x }); console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); };
const page = await browser.newPage(); await page.setViewport({ width: 1200, height: 1400 });
const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); }); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(srv.origin + '/'); await login(page, srv.origin, await page.evaluate(() => USERS.find((u) => u.name === 'Mansoor').id));
await sleep(4000); await settle(page, srv.origin, 900);
// production on, pilot off — written through the stub's REST like the admin path writes production
const put = (key, value) => page.evaluate(async (k, v) => { await fetch(SUPABASE_URL + '/rest/v1/app_settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: k, value: v }) }); }, key, value);
await put('srv_studio_v2_production', JSON.stringify({ enabled: true, format: 'long', dailyCap: 5, channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' }));
await put('srv_studio_v2_pilot', JSON.stringify({ enabled: false }));
const stage = (id) => page.evaluate((i) => _srvEnglishV2GetStage(i), id);
const id = '205'; // an ordinary Long task that no allowance names
const pkgId = await page.evaluate((i) => _srvEnglishV2PkgForTask(_srvEnglishTaskById(i)).id, id);
if ((await stage(id)) === 'review') { await page.evaluate((i, p) => _srvEnglishV2ApprovePackage(i, p), id, pkgId); await sleep(1200); }
if ((await stage(id)) === 'approve') await page.evaluate((i) => _srvEnglishV2SetStage(i, 'build'), id);
await page.evaluate(async (p) => { const b = await (await fetch('/__v2/test-audio.mp3')).blob(); _srvAudioData[p] = { file: new File([b], 'a.mp3', { type: 'audio/mpeg' }), name: 'a.mp3', sizeMB: '2' }; }, pkgId);
await page.evaluate((i, p) => _srvEnglishV2Build(p, i), id, pkgId);
await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'approve', { timeout: 300000, polling: 1000 }, id);
await page.evaluate((i) => _srvEnglishV2Show(i), id); await sleep(2500);
const meta = await page.evaluate((p) => (document.getElementById('srv2meta_' + p) || {}).textContent || '', pkgId);
ok('Approve preview announces a SRV Studio production upload: normal title, PRIVATE, not scheduled', /SRV STUDIO PRODUCTION UPLOAD \(LONG\) — normal title, PRIVATE, not scheduled/.test(meta) && !/\[TEST\]/.test(meta), meta.split('\n').slice(0, 2));
await page.evaluate((p, i) => _srvEnglishV2ApproveVideo(p, i), pkgId, id);
await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'done' || /refused|failed/i.test((document.getElementById('srv-lc-publish-status-' + _srvEnglishV2PkgForTask(_srvEnglishTaskById(i)).id) || {}).textContent || ''), { timeout: 60000, polling: 500 }, id);
const pkg = await page.evaluate((p) => { const x = D.packages.find((q) => q.id === p); return { srvProduction: x.srvProduction || null, srvPublish: x.srvPublish || null }; }, pkgId);
ok('Production upload: Done, production record with YouTube id/channel; no [TEST] confirmation was asked', (await stage(id)) === 'done' && pkg.srvProduction && pkg.srvProduction.youtubeVideoId && pkg.srvProduction.channelId === 'UC0nzWQX6AaUqlF5FozNpWPg' && pkg.srvPublish.production === true && !dialogs.some((d) => /\[TEST\]/.test(d)), pkg);
const dry = (await (await fetch(srv.origin + '/__stub/dryrun')).json()).dryRuns.filter((d) => d.action === 'youtube_upload_video');
ok('Upload payload: one, clean title in the CEO convention, PRIVATE, publishAt null, AI disclosure, SRV English engine', dry.length === 1 && / - Emotional Deep House \| Night Drive SRV Studio$/.test(dry[0].payload.title) && !/\[TEST\]/.test(dry[0].payload.title) && dry[0].payload.privacyStatus === 'private' && dry[0].payload.publishAt === null && dry[0].payload.containsSyntheticMedia === true && dry[0].payload.engine === 'SRV English' && /AI-generated/.test(dry[0].payload.description), dry.map((d) => d.payload.title));
// repeat publish of the same task → refused by the server; a cancelled task → never uploaded
await page.evaluate((i) => _srvEnglishV2SetStage(i, 'publish'), id);
await page.evaluate((p, i) => _srvEnglishV2Publish(p, i), pkgId, id); await sleep(1500);
const rep = await page.evaluate((p) => D.packages.find((q) => q.id === p).srvProductionAttempt, pkgId);
ok('Duplicate prevention: a repeat publish of the uploaded (now closed) task is refused by the server (no new upload)', rep && ['task_already_uploaded_or_in_progress', 'task_closed'].includes(rep.error) && (await (await fetch(srv.origin + '/__stub/dryrun')).json()).dryRuns.filter((d) => d.action === 'youtube_upload_video').length === 1, rep);
const cancelled = await page.evaluate(async () => { const t = _srvEnglishTaskById('203'); t.cancelledAt = Date.now(); const r = await _srvEnglishV2PublishRoute(t, 'long'); return r.blocked || null; });
ok('A cancelled or retired task is never uploaded', /cancelled or retired/.test(String(cancelled)), cancelled);
const ledgers = await page.evaluate(async () => { const g = async (k) => { const r = await (await fetch(SUPABASE_URL + '/rest/v1/app_settings?key=eq.' + k + '&select=value')).json(); return r && r[0] ? JSON.parse(r[0].value) : null; }; return { prod: await g('srv_studio_v2_production_ledger'), pilot: await g('srv_studio_v2_pilot_ledger') }; });
ok('Production ledger: exactly one uploaded entry, recorded by the signed-in publisher; the pilot ledger is not written', ledgers.prod && ledgers.prod.entries.length === 1 && ledgers.prod.entries[0].status === 'uploaded' && ledgers.prod.entries[0].by === 'ceo' && !ledgers.pilot, ledgers);
const after = await page.evaluate(() => ({ slots: JSON.stringify(D._publishSlots || {}), engine: _getEngineState('SRV English') }));
ok('No publishing slot taken; nothing scheduled', after.slots === '{}', after);
ok('No page errors; no production requests', errors.length === 0 && srv.productionHits === 0, errors.slice(0, 2));
const failed = checks.filter((c) => !c.pass).length; console.log(`\n${checks.length - failed} passed, ${failed} failed · productionHits ${srv.productionHits}`);
await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(failed ? 1 : 0);
