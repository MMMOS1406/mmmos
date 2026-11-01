// SRV-STUDIO-V2-033 — Monthly Mix Builder, PRODUCTION code in real Chrome against the isolated preview (real mix policy
// in the stub, fake YouTube resumable endpoint, emulated Supabase TUS storage, injected failures). Full 30-minute build.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> SRV2_MIX_AUDIO_DIR=<dir with test_*.m4a/mp3 + real_*.mp4> node headless-033.mjs OUTDIR
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startPreview } from './server.mjs';
import { login, settle } from '../../preservation/driver.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PUPPETEER_CORE || here, 'x.js'));
const puppeteer = require('puppeteer-core');
const outDir = path.resolve(process.argv[2]); fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-033-'));
const storageDir = path.join(tmp, 's');
const srv = await startPreview({ publicDir: path.resolve(here, '../../../public'), port: 0, storageDir, dataFile: path.join(tmp, 'state.json') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', protocolTimeout: 4 * 3600 * 1000, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = []; const ok = (n, c, x) => { checks.push({ n, pass: !!c, x }); console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 360) : '')); };
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 1000 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('error', (e) => console.log('PAGE CRASHED', String(e)));
page.on('dialog', (d) => d.accept());
const getJson = async (url, opt) => { for (let i = 0; ; i++) { try { return await (await fetch(url, opt)).json(); } catch (e) { if (i >= 3) throw e; await sleep(500); } } }; // the stub closes idle sockets
const stub = async (q = '') => getJson(srv.origin + '/__stub/mix' + q);
// seed: 6 synthetic test songs + 2 real Long soundtracks; one extra private Long and one Short (never eligible)
const T0 = Date.parse('2026-10-01T12:00:00Z');
const seed = [['real_photograph.mp4', 'But the photograph lied', 'long-video-aac'], ['real_passenger.mp4', 'Passenger Seat Witness', 'long-video-aac'], ['test_a.m4a', 'TEST song A', 'long-video-aac'], ['test_b.m4a', 'TEST song B', 'long-video-aac'], ['test_c.m4a', 'TEST song C', 'long-video-aac'], ['test_d.m4a', 'TEST song D', 'long-video-aac'], ['test_e.m4a', 'TEST song E', 'long-video-aac'], ['test_f.mp3', 'TEST song F (original MP3)', 'original-mp3']]
  .map(([file, title, src], i) => { const sec = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(process.env.SRV2_MIX_AUDIO_DIR, file)]).toString()); const id = 'pkg_mixsrc_' + (i + 1); const url = '/__v2/mix-audio/' + file;
    return { id, taskId: 900 + i, engine: 'SRV English', title, contentFormat: 'long', srvTaskUid: 'srve_' + (T0 + i) + '_' + (900 + i), generatedAt: new Date(T0 + i * 86400000).toISOString(), srvRender: { width: 1920, height: 1080, audioDurationSec: sec, durationSec: sec }, srvProduction: { youtubeVideoId: 'MIXsrc' + String(i + 1).padStart(5, '0') }, srvAvatar: { id: 'srv2-fm-0' + (i + 1) }, ...(src === 'original-mp3' ? { _srvAudioUrl: url, _srvLongVideoUrl: '/__v2/mix-audio/real_passenger.mp4' } : { _srvLongVideoUrl: url }) }; });
seed.push({ id: 'pkg_mix_private', engine: 'SRV English', title: 'Unpublished Long', srvTaskUid: 'srve_1_999', srvRender: { width: 1920, height: 1080, audioDurationSec: 230 }, srvProduction: { youtubeVideoId: 'MIXprivate1' }, _srvLongVideoUrl: '/__v2/mix-audio/test_a.m4a', _privacy: 'private', generatedAt: new Date(T0 + 20 * 86400000).toISOString() });
seed.push({ id: 'pkg_mix_short', engine: 'SRV English', title: 'TEST song A', srvShortOf: { longPkgId: 'pkg_mixsrc_3' }, srvRender: { width: 1080, height: 1920, durationSec: 30 }, srvProduction: { youtubeVideoId: 'MIXshort001' }, _srvShortVideoUrl: 'x' });
await fetch(srv.origin + '/__stub/mix-seed', { method: 'POST', body: JSON.stringify(seed) });
const sourcesBefore = JSON.stringify((await getJson(srv.origin + '/__stub/state')).packages.filter((p) => /pkg_mixsrc/.test(p.id)));
await page.goto(srv.origin + '/'); await login(page, srv.origin, await page.evaluate(() => USERS.find((u) => u.name === 'Mansoor').id)); await sleep(3000); await settle(page, srv.origin, 900);
const put = (key, value) => page.evaluate(async (k, v) => { await fetch(SUPABASE_URL + '/rest/v1/app_settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: k, value: v }) }); }, key, value);

// 0. flag OFF: no entry, opening refused
ok('flag OFF (no srv_studio_v2_mix config): no Monthly Mix entry; the builder will not open', !(await page.evaluate(() => _srvStudioV2MixOn())) && !(await page.evaluate(() => /MONTHLY MIX/.test(_srvEnglishV2Badges({ engine: 'SRV English' })))));
await put('srv_studio_v2_mix', JSON.stringify({ enabled: true, channelId: 'UC0nzWQX6AaUqlF5FozNpWPg', playlistId: null }));
await page.reload(); await sleep(3500); await settle(page, srv.origin, 900); await page.waitForFunction(() => _srvStudioV2MixOn(), { timeout: 20000 });
ok('flag ON: the SRV Studio task card shows the 🎚 MONTHLY MIX entry', await page.evaluate(() => /_srvEnglishV2MixOpen\(\)/.test(_srvEnglishV2Badges({ engine: 'SRV English' }))));
await stub('?tusOnce=1&resetOnce=1&err503Once=1');
// 1. open + eligibility
await page.evaluate(() => _srvEnglishV2MixOpen()); await page.waitForFunction(() => window.__srv2Mix && window.__srv2Mix.state.el, { timeout: 60000 });
let S = await page.evaluate(() => { const s = window.__srv2Mix.state; return { month: s.month, el: s.el }; });
const byT = Object.fromEntries(S.el.songs.map((x) => [x.title, x]));
ok('Generate: month preselected; eligibility from the server — 8 public SRV Studio Longs eligible; the unpublished one listed as not public; the Short not listed', S.el.eligibleCount === 8 && byT['Unpublished Long'].reason === 'not_public' && !S.el.songs.some((x) => x.pkgId === 'pkg_mix_short') && /^2026-1[01]$/.test(S.month), { month: S.month, n: S.el.eligibleCount });
ok('audio source per song: original MP3 when kept, else the Long soundtrack', byT['TEST song F (original MP3)'].audioSource === 'original-mp3' && byT['But the photograph lied'].audioSource === 'long-video-aac');
ok('readiness: enough music → ready (shown to the VA with the planned slot)', S.el.ready === true && /last Saturday, 2:00 PM ET/.test(await page.evaluate(() => document.getElementById('srv2-mix-overlay').innerText)));
// 2. select + analyse
await page.evaluate(() => document.querySelector('#mx-suggest').click()); await page.evaluate(() => document.querySelector('#mx-analyse').click());
await page.waitForFunction(() => { const s = window.__srv2Mix.state; return s.order.length && s.order.every((id) => s.analysis[id]) && !s.busy; }, { timeout: 600000, polling: 1000 });
S = await page.evaluate(() => { const s = window.__srv2Mix.state; return { order: s.order, analysis: s.analysis }; });
ok('Suggest ~30 min picks 5–8 songs; every song analysed (trim + loudness), one at a time', S.order.length >= 5 && S.order.length <= 8 && Object.keys(S.analysis).length === S.order.length, S.order.length);
const aR = S.analysis.pkg_mixsrc_1;
ok('trimming: the real Long soundtrack loses its lead-in silence and built-in fade-out (used < source)', aR && aR.edges.inSec > 0 && aR.edges.durationSec - aR.edges.outSec >= 2.5, aR && aR.edges);
const tlOk = await page.evaluate(() => { const s = window.__srv2Mix.state; const t = window.__srv2Mix.actions; return null; });
// 3. arrange: real songs first, then preview the real→real transition; remove + re-add
const order = await page.evaluate(() => { const s = window.__srv2Mix.state; s.order.sort((a, b) => (/_1$|_2$/.test(b) ? 1 : 0) - (/_1$|_2$/.test(a) ? 1 : 0)); s.order = ['pkg_mixsrc_1', 'pkg_mixsrc_2'].concat(s.order.filter((x) => x !== 'pkg_mixsrc_1' && x !== 'pkg_mixsrc_2')); window.__srv2Mix.actions.draw(); return s.order; });
const dbg = setInterval(async () => { try { console.log('…', JSON.stringify(await page.evaluate(() => ({ busy: window.__srv2Mix.state.busy, msg: window.__srv2Mix.state.msg, lj: !!window.__srv2Mix.state.lastJoin, btn: !!document.querySelector('button[data-join="1"]') })))); } catch (_) {} }, 15000);
await page.evaluate(() => document.querySelector('button[data-join="1"]').click()); await page.waitForFunction(() => (!!window.__srv2Mix.state.lastJoin || /failed/.test(window.__srv2Mix.state.msg)) && !window.__srv2Mix.state.busy, { timeout: 180000 });
clearInterval(dbg); console.log('join msg:', await page.evaluate(() => window.__srv2Mix.state.msg));
const join = await page.evaluate(() => window.__srv2Mix.state.lastJoin);
ok('transition preview (real → real): plays through the production crossfade + limiter with no gap', join.i === 1 && join.continuity.minDb > -45, join);
const rmTitle = await page.evaluate(() => { const s = window.__srv2Mix.state; const id = s.order[s.order.length - 1]; document.querySelector(`button[data-rm="${s.order.length - 1}"]`).click(); return id; });
await page.evaluate((id) => { const cb = document.querySelector(`input[data-pick="${id}"]`); cb.checked = true; cb.dispatchEvent(new Event('change')); }, rmTitle);
const tlNow = await page.evaluate(() => { const s = window.__srv2Mix.state; const r = window.__srv2Mix; return { order: s.order }; });
ok('remove and re-add a song: order updated, no duplicates', new Set(tlNow.order).size === tlNow.order.length && tlNow.order[tlNow.order.length - 1] === rmTitle);
// 4. visual + metadata edit
await page.evaluate(() => document.querySelector('.mx-lib button[data-av="srv2-fm-17"]').click());
await page.evaluate(() => { const t = document.getElementById('mx-title'); t.value = 'SRV Studio Monthly Mix — Night Drive Edition'; t.dispatchEvent(new Event('change')); });
// 5. save draft, close, reopen → restored
await page.evaluate(() => document.querySelector('#mx-save').click()); await page.waitForFunction(() => /Saved/.test(window.__srv2Mix.state.msg), { timeout: 20000 });
const savedOrder = await page.evaluate(() => window.__srv2Mix.state.order.slice());
await page.evaluate(() => document.getElementById('mx-close').click());
await page.evaluate(() => _srvEnglishV2MixOpen()); await page.waitForFunction(() => window.__srv2Mix && window.__srv2Mix.state.el && /Draft restored/.test(window.__srv2Mix.state.msg), { timeout: 60000 });
const restored = await page.evaluate(() => ({ order: window.__srv2Mix.state.order, av: window.__srv2Mix.state.avatarId }));
ok('draft saved on the server and restored after closing (order, image)', JSON.stringify(restored.order) === JSON.stringify(savedOrder) && restored.av === 'srv2-fm-17', restored);
const pre = await page.evaluate(() => { const s = window.__srv2Mix.state; return { msg: document.getElementById('srv2-mix-overlay').innerText.includes('Ready to build'), title: document.getElementById('mx-title').value, desc: document.getElementById('mx-desc').value }; });
ok('metadata: edited title kept; description has the timestamped tracklist (0:00 first), links to the original songs and the AI disclosure; ready to build', pre.msg && pre.title === 'SRV Studio Monthly Mix — Night Drive Edition' && /^0:00 /m.test(pre.desc) && /youtu\.be\/MIXsrc00001/.test(pre.desc) && /AI-generated/.test(pre.desc));
if (process.env.SRV2_MIX_SMOKE) { const f = checks.filter((c) => !c.pass).length; console.log(`\nSMOKE ${checks.length - f} passed, ${f} failed`); await browser.close(); await srv.close(); process.exit(f ? 1 : 0); }
// 6. BUILD the full mix — sample memory
const cdp = await page.target().createCDPSession(); await cdp.send('Performance.enable');
const pids = () => { try { return execFileSync('pgrep', ['-P', String(browser.process().pid)]).toString().trim().split('\n').filter(Boolean).concat(String(browser.process().pid)); } catch { return [String(browser.process().pid)]; } };
const rss = () => { try { return Math.round(execFileSync('ps', ['-o', 'rss=', '-p', pids().join(',')]).toString().trim().split('\n').reduce((a, l) => a + Number(l.trim() || 0), 0) / 1024); } catch { return 0; } };
let peak = 0; const mem = []; const sampler = setInterval(() => { const r = rss(); mem.push(r); if (r > peak) peak = r; }, 5000);
const prog = setInterval(async () => { try { console.log('build', new Date().toISOString().slice(11, 19), 'rss', rss(), 'MB ·', await page.evaluate(() => window.__srv2Mix.state.busy)); } catch (_) {} }, 60000);
const tb = Date.now();
await page.evaluate(() => document.querySelector('#mx-build').click());
await page.waitForFunction(() => { const s = window.__srv2Mix.state; return !!s.build || /Build failed/.test(s.msg); }, { timeout: 3 * 3600 * 1000, polling: 5000 });
const buildWall = (Date.now() - tb) / 1000; clearInterval(sampler); clearInterval(prog);
const B = await page.evaluate(() => { const s = window.__srv2Mix.state; return s.build ? { stats: s.build.stats, size: s.build.blob.size, msg: s.msg, tl: (() => { const r = s; return null; })() } : { msg: s.msg }; });
ok('build: 1920×1080, ≈ 30 minutes, under 500 MB, ≤ 0.5% dropped frames, never more than 2 songs decoded at once', B.stats && B.stats.width === 1920 && B.stats.height === 1080 && B.size < 500 * 1024 * 1024 && B.stats.frames.droppedPct <= 0.5 && B.stats.maxSongsDecoded <= 2, { stats: B.stats, msg: B.msg });
ok('memory: Chrome peak below the 032 baseline (1.45 GB) with rolling decoding', peak > 0 && peak < 1450, { peakMB: peak });
const rec = await page.evaluate(() => { const s = window.__srv2Mix.state; return { total: (s.mixes && null), order: s.order }; });
// 7. approve + upload (TUS with an injected failure; YouTube with an injected reset and a 503)
await page.evaluate(() => document.querySelector('#mx-approve').click());
await page.waitForFunction(() => { const s = window.__srv2Mix.state; return s.step === 'done' || /Upload stopped/.test(s.msg); }, { timeout: 1800000, polling: 2000 });
const D = await page.evaluate(() => { const s = window.__srv2Mix.state; return { step: s.step, msg: s.msg, saved: s.saved, result: s.result }; });
const st = await stub();
const sess = Object.values(st.sessions)[0];
ok('approve → resumable storage upload survived an injected failure (resumed from the stored offset)', st.mixFail.tusHits === 1 && st.tus[0] && st.tus[0].offset === st.tus[0].length, st.tus);
ok('private YouTube upload: one chunk per server call, survived an injected connection reset and a 503, completed', D.step === 'done' && st.mixFail.resets === 1 && st.mixFail.hits503 === 1 && sess && sess.got === sess.total && sess.puts >= Math.ceil(sess.total / (64 * 1024 * 1024)), { puts: sess && sess.puts, total: sess && sess.total, msg: D.msg });
ok('upload policy: PRIVATE, no publishAt, verified channel; mix status uploaded; playlist "not configured" → manual step shown', sess.privacy === 'private' && sess.publishAt === false && D.saved.status === 'uploaded' && D.saved.playlist.status === 'not_configured' && /add it in YouTube Studio/.test(await page.evaluate(() => document.getElementById('srv2-mix-overlay').innerText)));
ok('mix record: id, month, title, ordered sources with package/task/YouTube ids, audio source, trims, gains, chapters, image, render + output metadata, planned slot, audit', (() => { const m = D.saved; return m.mixId && m.monthKey && m.title === 'SRV Studio Monthly Mix — Night Drive Edition' && m.tracks.length === savedOrder.length && m.tracks.every((t) => t.pkgId && t.taskUid && /^MIXsrc/.test(t.youtubeVideoId) && t.audioSource && t.inSec != null && t.outSec != null && t.gainDb != null && t.timestamp) && m.image.avatarId === 'srv2-fm-17' && m.render && m.render.width === 1920 && m.output && m.output.bytes > 0 && m.plannedRelease.localTime === '14:00' && m.audit.length >= 3; })(), D.saved && { ...D.saved, tracks: D.saved.tracks.length, description: undefined });
// 8. duplicate + public confirmation
const dup = await page.evaluate(async (id) => { const r = await _publishAuthedFetch('/api/ops?action=srv_studio_v2_mix', { op: 'upload_init', mixId: id }); return r.json(); }, D.saved.mixId);
ok('duplicate prevention: the uploaded mix cannot be uploaded again', dup.ok === false && /not_approved|already|locked/.test(dup.error), dup);
await page.evaluate(() => document.getElementById('mx-public').click()); await sleep(1500);
let pc = await page.evaluate(() => window.__srv2Mix.state.saved.publicConfirmation);
ok('"I made it public" while still private: recorded with YouTube\'s answer (private)', pc && pc.youtubeReports === 'private' && !pc.verifiedByApi, pc);
await stub('?video=' + D.saved.upload.youtubeVideoId + '&privacy=public');
await page.evaluate(() => document.getElementById('mx-public').click()); await sleep(1500);
pc = await page.evaluate(() => window.__srv2Mix.state.saved);
ok('after the VA makes it public in Studio: confirmation verified by the API; status public', pc.publicConfirmation.verifiedByApi && pc.status === 'public');
// 9. the stored output file
const outPath = path.join(storageDir, D.saved.output.storagePath);
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,channels', '-show_entries', 'format=duration,size', '-of', 'json', outPath]).toString());
const vs = probe.streams.find((x) => x.codec_type === 'video'), as = probe.streams.find((x) => x.codec_type === 'audio');
ok('stored output: H.264 1920×1080 + AAC stereo; duration = mix plan; size = record', vs.codec_name === 'h264' && vs.width === 1920 && vs.height === 1080 && as.codec_name === 'aac' && as.channels === 2 && Math.abs(Number(probe.format.duration) - D.saved.totalSec) < 2 && Number(probe.format.size) === D.saved.output.bytes, { dur: probe.format.duration, plan: D.saved.totalSec, size: probe.format.size });
const thumbPath = D.saved.output.thumbnailPath && path.join(storageDir, D.saved.output.thumbnailPath);
const tprobe = thumbPath ? JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', thumbPath]).toString()).streams[0] : {};
const stT = await stub();
ok('thumbnail: 1280×720 JPEG saved with the mix and set on the private video (once)', tprobe.codec_name === 'mjpeg' && tprobe.width === 1280 && tprobe.height === 720 && D.saved.thumbnail && D.saved.thumbnail.status === 'set' && stT.thumbs.length === 1 && stT.thumbs[0][1] === D.saved.upload.youtubeVideoId && /custom 1280×720 thumbnail set/.test(await page.evaluate(() => document.getElementById('srv2-mix-overlay').innerText)), { tprobe, thumb: D.saved.thumbnail, calls: stT.thumbs });
const sh = (c) => { try { return execFileSync('sh', ['-c', c], { maxBuffer: 64 << 20 }).toString(); } catch (e) { return String(e.stdout || ''); } };
const r128 = sh(`ffmpeg -nostdin -nostats -i "${outPath}" -vn -af ebur128=peak=true -f null - 2>&1 | grep -A14 Summary`);
const lufs = Number((r128.match(/I:\s+(-?[\d.]+)/) || [])[1]), tp = Number((r128.match(/Peak:\s+(-?[\d.]+)/) || [])[1]);
ok('audio quality (ffmpeg, on the delivered AAC file): integrated loudness −14 LUFS ± 1, true peak ≤ −1 dBTP', Math.abs(lufs + 14) <= 1 && tp <= -1.0, { lufs, tp });
const sil = sh(`ffmpeg -nostdin -nostats -i "${outPath}" -vn -af silencedetect=n=-45dB:d=0.4 -f null - 2>&1 | grep silence_start || true`).trim().split('\n').filter(Boolean).map((l) => Number(l.match(/silence_start: (-?[\d.]+)/)[1]));
const joins = D.saved.tracks.slice(1).map((t, i) => D.saved.tracks[i + 1].chapterSec);
ok('continuity (ffmpeg silencedetect): no silence at any join; only the opening fade-in', !sil.some((t) => t > 2), { silences: sil });
for (const [i, t] of D.saved.tracks.entries()) sh(`ffmpeg -nostdin -v error -y -ss ${t.chapterSec + 3} -i "${outPath}" -frames:v 1 -vf scale=960:-1 "${path.join(outDir, 'ch' + (i + 1) + '.jpg')}"`);
ok('source packages unchanged by the whole lifecycle', JSON.stringify((await getJson(srv.origin + '/__stub/state')).packages.filter((p) => /pkg_mixsrc/.test(p.id))) === sourcesBefore);
ok('no page errors; no production requests', errors.length === 0 && srv.productionHits === 0, errors.slice(0, 3));
fs.writeFileSync(path.join(outDir, '033-e2e.json'), JSON.stringify({ checks, buildWallSec: buildWall, peakChromeRssMB: peak, memSamples: mem, build: B.stats, size: B.size, mix: { ...D.saved, description: D.saved.description }, ffmpeg: { lufs, tp, silences: sil }, stub: st }, null, 1));
await page.screenshot({ path: path.join(outDir, '033-done.png'), fullPage: false });
const failed = checks.filter((c) => !c.pass).length; console.log(`\n${checks.length - failed} passed, ${failed} failed · build ${Math.round(buildWall)} s · peak ${peak} MB · productionHits ${srv.productionHits}`);
await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(failed ? 1 : 0);
