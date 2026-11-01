// SRV-STUDIO-V2-037 — VA Suno steps in real Chrome against the isolated preview (stub Supabase/YouTube; nothing
// reaches Suno or production): approved-text copy, refusal after an unapproved change, MP3 checks (wrong type, too
// short), drag-and-drop of a valid MP3 with preview, then the UNCHANGED Build consumes it and stores the original MP3.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> SRV2_037_AUDIO=<dir with valid_long.mp3, short_clip.mp3, not_mp3.wav> node headless-037.mjs OUTDIR
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
const AUD = process.env.SRV2_037_AUDIO;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-037-'));
const srv = await startPreview({ publicDir: path.resolve(here, '../../../public'), port: 0, storageDir: path.join(tmp, 's'), dataFile: path.join(tmp, 'state.json') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', protocolTimeout: 900000, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
await browser.defaultBrowserContext().overridePermissions(srv.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = []; const ok = (n, c, x) => { checks.push({ n, pass: !!c, x }); console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); };
const page = await browser.newPage(); await page.setViewport({ width: 1200, height: 1500 });
const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); }); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(srv.origin + '/'); await login(page, srv.origin, await page.evaluate(() => USERS.find((u) => u.name === 'Mansoor').id));
await sleep(4000); await settle(page, srv.origin, 900);
await page.evaluate(() => renderTab('tasks'));
await page.waitForFunction(() => typeof _smmOperatorState === 'undefined' || (!_smmOperatorState.loading && (_smmOperatorState.loaded || _smmOperatorState.error)), { timeout: 30000 }).catch(() => null); await sleep(1500);
const put = (key, value) => page.evaluate(async (k, v) => { await fetch(SUPABASE_URL + '/rest/v1/app_settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: k, value: v }) }); }, key, value);
await put('srv_studio_v2_production', JSON.stringify({ enabled: true, formats: ['long', 'short'], dailyCap: 5, channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' }));
const stage = (id) => page.evaluate((i) => _srvEnglishV2GetStage(i), id);
const L = '205';
const P = await page.evaluate((i) => _srvEnglishV2PkgForTask(_srvEnglishTaskById(i)).id, L);
if ((await stage(L)) === 'review') { await page.evaluate((i, p) => _srvEnglishV2ApprovePackage(i, p), L, P); await sleep(1200); }
await page.evaluate((i) => _srvEnglishV2SetStage(i, 'build'), L);
const show = async () => { await page.evaluate((i) => _srvEnglishV2Show(i), L); await page.waitForSelector('#srv2-suno-steps-' + P, { timeout: 15000 }); };
await show();
const txt = (sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);

// 1. layout
const lay = await page.evaluate((p) => ({ steps: !!document.querySelector('[data-srv2-suno-steps]'), oldUpload: /Upload MP3 \(from Suno\)/.test(document.body.innerText), drop: /Drop the MP3 from Suno here/.test(document.body.innerText), build: !!document.getElementById('srv-lc-build-btn-' + p), copyBtns: [...document.querySelectorAll('button')].filter((b) => /Copy approved/.test(b.textContent)).map((b) => b.disabled) }), P);
ok('Build stage shows the V2 Suno steps (approved copy buttons, drop zone) and keeps the Build button; the old upload control is replaced', lay.steps && !lay.oldUpload && lay.drop && lay.build && lay.copyBtns.length === 2 && lay.copyBtns.every((d) => !d), lay);
await page.screenshot({ path: path.join(outDir, '037-build-stage.png'), fullPage: false });

// 2. copy approved text
const pk = await page.evaluate((p) => { const x = D.packages.find((q) => q.id === p); return { sp: x.sunoPrompt, ly: x.lyrics, ssp: x.shortSunoPrompt || '', sly: x.shortLyrics || '' }; }, P);
const clickCopy = (which) => page.evaluate((w) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(w)); b.click(); }, which);
await clickCopy('Copy approved style prompt'); await sleep(500);
const c1 = await page.evaluate(() => navigator.clipboard.readText());
await clickCopy('Copy approved lyrics'); await sleep(500);
const c2 = await page.evaluate(() => navigator.clipboard.readText());
ok('copy: the Long\'s exact approved style prompt and lyrics reach the clipboard (not the Short fields)', c1 === pk.sp && c2 === pk.ly && c1 !== pk.ssp, { spLen: c1.length, lyLen: c2.length });
ok('copy: the VA sees what was copied and where to paste it', /Copied the approved lyrics \(\d+ characters\)\. Paste it into Suno's Lyrics box/.test(await txt('#srv2-suno-copy-status-' + P)));

// 3. unapproved change → refused
await page.evaluate((i, p) => { const x = D.packages.find((q) => q.id === p); x._037hadApproval = 'x' in {}; x._037appr = x._srvV2Approved; x._srvV2Approved = _srvEnglishV2ApprovalOf(_srvEnglishTaskById(i), x); x._037orig = x.sunoPrompt; x.sunoPrompt = x.sunoPrompt + ' (edited)'; }, L, P);
await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
const refused = await page.evaluate((i, p) => _srvEnglishV2CopyApproved(i, p, 'sunoPrompt', null), L, P);
const c3 = await page.evaluate(() => navigator.clipboard.readText());
ok('copy is refused when the text no longer matches its approval record (clipboard untouched, clear message)', refused === false && c3 === 'sentinel' && /changed after approval/.test(await txt('#srv2-suno-copy-status-' + P)));
await page.evaluate((p) => { const x = D.packages.find((q) => q.id === p); x.sunoPrompt = x._037orig; if (x._037appr) x._srvV2Approved = x._037appr; else delete x._srvV2Approved; delete x._037orig; delete x._037appr; delete x._037hadApproval; }, P);

// 4. wrong files
const input = async (file) => { const h = await page.$('#srv2-mp3-input-' + P); await h.uploadFile(path.join(AUD, file)); await page.waitForFunction((p) => !/^Checking/.test((document.getElementById('srv2-mp3-status-' + p) || {}).textContent || ''), { timeout: 20000 }, P); await sleep(200); };
await input('not_mp3.wav');
const w1 = await txt('#srv2-mp3-status-' + P); const a1 = await page.evaluate((p) => !!_srvAudioData[p], P);
ok('a WAV file is refused and not loaded for Build', /Not loaded: This is not an MP3/.test(w1) && !a1, w1);
await input('short_clip.mp3');
const w2 = await txt('#srv2-mp3-status-' + P); const a2 = await page.evaluate((p) => !!_srvAudioData[p], P);
ok('a 1:50 MP3 is refused for a Long (wrong song) and not loaded', /song is 1:50 long — a Long song must be 2:00–7:00/.test(w2) && !a2, w2);

// 5. drag-and-drop a valid MP3
const b64 = fs.readFileSync(path.join(AUD, 'valid_long.mp3')).toString('base64');
await page.evaluate((p, b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], 'My Suno Song.mp3', { type: 'audio/mpeg' }); const dt = new DataTransfer(); dt.items.add(f); const z = document.querySelector('#srv2-suno-steps-' + p + ' [role=button]'); z.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, P, b64);
await page.waitForFunction((p) => /ready to build/.test((document.getElementById('srv2-mp3-status-' + p) || {}).textContent || ''), { timeout: 20000 }, P);
const w3 = await txt('#srv2-mp3-status-' + P);
const a3 = await page.evaluate((p) => { const a = _srvAudioData[p]; const pv = document.getElementById('srv2-mp3-preview-' + p); return { name: a && a.name, dur: a && a.durationSec, file: !!(a && a.file instanceof File), preview: pv && pv.style.display !== 'none' && !!pv.src }; }, P);
ok('drag-and-drop: a valid 3:20 MP3 is checked, loaded for Build, previewable, with a clear "saved when you press Build" note', /My Suno Song\.mp3 · 3:20 · 4\.6 MB — ready to build/.test(w3) && /saved with the package when you press Build/.test(w3) && a3.file && Math.abs(a3.dur - 200) < 1 && a3.preview, { w3, a3 });
await page.screenshot({ path: path.join(outDir, '037-mp3-ready.png'), fullPage: false });

// 6. the unchanged Build consumes it and stores the original MP3 (029)
await page.evaluate((p) => document.getElementById('srv-lc-build-btn-' + p).click(), P);
await page.waitForFunction((i) => _srvEnglishV2GetStage(i) === 'approve' || /failed|refused|⚠/i.test((document.querySelector('[id^="srv-lc-build-status-"]') || {}).textContent || ''), { timeout: 420000, polling: 1000 }, L);
const b = await page.evaluate((p) => { const x = D.packages.find((q) => q.id === p); return { audioUrl: x._srvAudioUrl || null, video: x._srvLongVideoUrl || null, song: x.srvRender && x.srvRender.audioDurationSec, w: x.srvRender && x.srvRender.width }; }, P);
ok('Build (unchanged) used the dropped MP3: Long video rendered, original MP3 stored with the package', (await stage(L)) === 'approve' && !!b.video && /\.mp3/.test(b.audioUrl || '') && Math.abs(Number(b.song) - 200) < 2 && b.w === 1920, b);

// 7. V2 off → generic SRV English markup (old controls), and a promotional Short has no Suno steps
const off = await page.evaluate((i) => { const orig = window._srvStudioV2On; window._srvStudioV2On = () => false; try { const t = _srvEnglishTaskById(i); const h = renderSRVEnglishLifecycleCard(t); return { generic: /Upload MP3 \(from Suno\)/.test(h || ''), v2: /data-srv2-suno-steps/.test(h || '') }; } catch (e) { return { err: String(e) }; } finally { window._srvStudioV2On = orig; } }, L);
ok('without V2 the card never shows the V2 Suno steps (V1 markup itself is proven unchanged except two invisible markers by the unit test)', !off.err && !off.v2, off);
ok('no page errors; no production requests', errors.length === 0 && srv.productionHits === 0, errors.slice(0, 2));
fs.writeFileSync(path.join(outDir, '037-checks.json'), JSON.stringify({ checks, dialogs }, null, 2));
const failed = checks.filter((c) => !c.pass).length; console.log(`\n${checks.length - failed} passed, ${failed} failed · productionHits ${srv.productionHits}`);
await browser.close(); await srv.close(); process.exit(failed ? 1 : 0);
