// SRV-STUDIO-V2-032A — measured FULL-LENGTH mix render in real Chrome (preview only, local, free).
// Builds the 8-song ~30-minute mix (2 real songs from local copies of their Long soundtracks, 6 synthetic stand-ins with
// the real songs' lengths), renders 1920×1080 at the planned bitrate in real time, and records wall time, peak memory
// (Chrome renderer RSS + JS heap, sampled every 5 s), file size, then checks the file with ffprobe/ffmpeg: duration,
// resolution, loudness, silence at joins, and chapter positions.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> SRV2_MIX_REAL_DIR=<dir> node headless-032-full.mjs OUTDIR
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startPreview } from './server.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PUPPETEER_CORE || here, 'x.js'));
const puppeteer = require('puppeteer-core');
const outDir = path.resolve(process.argv[2]); fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-032f-'));
const srv = await startPreview({ publicDir: path.resolve(here, '../../../public'), port: 0, storageDir: path.join(tmp, 's'), dataFile: path.join(tmp, 'state.json') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', protocolTimeout: 4 * 3600 * 1000, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--js-flags=--max-old-space-size=4096'] });
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
const cdp = await page.target().createCDPSession(); await cdp.send('Performance.enable');
await page.goto(srv.origin + '/studio/mix'); await page.waitForFunction(() => window.__mixReady === true, { timeout: 30000 });
const rendererPid = (await browser.process()) && null; // RSS is read for all Chrome processes of this browser
const chromePids = () => { try { return execFileSync('pgrep', ['-P', String(browser.process().pid)]).toString().trim().split('\n').filter(Boolean).concat(String(browser.process().pid)); } catch { return [String(browser.process().pid)]; } };
const rssMB = () => { try { const pids = chromePids(); const o = execFileSync('ps', ['-o', 'rss=', '-p', pids.join(',')]).toString(); return Math.round(o.trim().split('\n').reduce((a, l) => a + Number(l.trim() || 0), 0) / 1024); } catch { return null; } };
const samples = []; let peak = { rss: 0, heap: 0 };
const sampler = setInterval(async () => { try { const m = await cdp.send('Performance.getMetrics'); const heap = Math.round((m.metrics.find((x) => x.name === 'JSHeapUsedSize') || {}).value / 1048576); const rss = rssMB(); samples.push({ t: Date.now(), heap, rss }); peak = { rss: Math.max(peak.rss, rss || 0), heap: Math.max(peak.heap, heap || 0) }; } catch (_) {} }, 5000);
const t0 = Date.now();
// Build the full mix in the page with the same modules the preview uses.
await page.evaluate(() => { window.__fullRun = (async () => {
  const M = await import('/__v2/lib/srvStudioV2Mix.mjs'); const X = await import('/__v2/mix-preview.mjs');
  const S = window.__mix; document.getElementById('suggest').click();
  const order = S.order.slice(); const real = { pkg_1792360206717: 'photograph', pkg_1792604593962: 'passenger' };
  // put the two real songs first so their transition is in the file
  order.sort((a, b) => (real[b] ? 1 : 0) - (real[a] ? 1 : 0));
  const items = order.map((id) => S.eligible.find((e) => e.pkgId === id));
  const tPrep = performance.now(); const bufs = []; const kinds = [];
  for (const it of items) {
    if (real[it.pkgId]) { bufs.push(await X.decodeUrl('/__v2/mix-real/' + real[it.pkgId] + '.mp4')); kinds.push('real'); }
    else { const seed = [...it.pkgId].reduce((a, c) => a + c.charCodeAt(0), 0); bufs.push(await X.synthTrack(it.durationSec, seed)); kinds.push('synthetic'); }
  }
  const tracks = items.map((it, i) => ({ ...it, durationSec: bufs[i].duration }));
  const tl = M.srv2MixTimeline(tracks);
  const gains = bufs.map((b) => M.srv2LoudnessGain(X.measure(b)));
  const chs = bufs.map((b) => [b.getChannelData(0), b.getChannelData(Math.min(1, b.numberOfChannels - 1))]);
  const mix = M.srv2MixPcm(chs, tl, gains.map((g) => g.gain), X.SR);
  const loud = M.srv2Loudness(mix, X.SR); const cont = M.srv2JoinContinuity(mix, X.SR, tl, 6);
  const mixBuf = X.toAudioBuffer(mix); const prepSec = (performance.now() - tPrep) / 1000;
  const plan = M.srv2MixBitratePlan(tl.totalSec);
  const avatar = (await import('/__v2/lib/srvStudioV2Avatars.mjs')).SRV_STUDIO_V2_AVATARS.find((a) => a.id === 'srv2-fm-17');
  const out = await X.renderExcerpt({ mixBuffer: mixBuf, tl, avatar, monthLabel: 'November 2026', videoBitsPerSecond: plan.videoBitsPerSecond, canvas: document.getElementById('cv'), onProgress: (m) => { window.__progress = m; } });
  window.__full = out;
  window.__fullResult = { tl: { totalSec: tl.totalSec, totalLabel: tl.totalLabel, items: tl.items.map((x) => ({ title: x.title, startSec: x.startSec, chapterSec: x.chapterSec, timestamp: x.timestamp })) }, kinds, gains, loud, cont, prepSec, plan, stats: out.stats, mime: out.mime };
  })().catch((e) => { window.__fullError = String(e && e.stack || e); }); });
await page.waitForFunction(() => !!(window.__fullResult || window.__fullError), { timeout: 4 * 3600 * 1000, polling: 5000 });
const fullErr = await page.evaluate(() => window.__fullError || null); if (fullErr) { console.error('render failed:', fullErr); process.exit(2); }
const result = await page.evaluate(() => window.__fullResult);
const wallSec = (Date.now() - t0) / 1000;
clearInterval(sampler);
const saved = await page.evaluate(async () => { const r = await fetch('/__stub/save-render?name=mix-full.' + (window.__full.mime.includes('mp4') ? 'mp4' : 'webm'), { method: 'POST', body: window.__full.blob }); return r.json(); });
const vpath = saved.file;
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,channels,sample_rate', '-show_entries', 'format=duration,size,bit_rate', '-of', 'json', vpath]).toString());
const sh = (c) => { try { return execFileSync('sh', ['-c', c], { maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) { return String(e.stdout || ''); } };
const lufs = Number((sh(`ffmpeg -nostats -i "${vpath}" -vn -af ebur128 -f null - 2>&1 | grep -A3 Summary | grep 'I:'`).match(/I:\s+(-?[\d.]+)/) || [])[1]);
const sil = sh(`ffmpeg -nostats -i "${vpath}" -vn -af silencedetect=n=-45dB:d=0.4 -f null - 2>&1 | grep -E 'silence_start|silence_end'`).trim().split('\n').filter(Boolean);
fs.copyFileSync(vpath, path.join(outDir, path.basename(vpath)));
for (const [i, it] of result.tl.items.entries()) { const at = it.chapterSec + 3; sh(`ffmpeg -v error -y -ss ${at} -i "${vpath}" -frames:v 1 -vf scale=960:-1 "${path.join(outDir, 'chapter-' + (i + 1) + '.jpg')}"`); }
const report = { wallSec: +wallSec.toFixed(1), renderSec: result.stats.renderSec, prepSec: +result.prepSec.toFixed(1), peakRssMB: peak.rss, peakHeapMB: peak.heap, samples: samples.length, file: { bytes: Number(probe.format.size), duration: Number(probe.format.duration), bitRate: Number(probe.format.bit_rate), streams: probe.streams }, planned: result.plan, timeline: result.tl, kinds: result.kinds, gains: result.gains, mixLoudness: result.loud, joinContinuity: result.cont, ffmpegLufs: lufs, silences: sil, frames: result.stats.frames, errors, productionHits: srv.productionHits };
fs.writeFileSync(path.join(outDir, '032A-full-render.json'), JSON.stringify({ ...report, memorySamples: samples }, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
