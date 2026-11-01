// SRV-STUDIO-V2-032 — Monthly Mix Builder PREVIEW in real Chrome (isolated preview server; no production access).
// Drives /studio/mix: eligibility, ~30-min selection, ordering/removal/replacement, transition preview (real song audio
// when SRV2_MIX_REAL_DIR holds local copies), image library, metadata/timestamps/lineage, a representative 1920×1080
// excerpt render at the full-mix bitrate (saved and checked with ffprobe/ffmpeg), mock private upload + duplicate refusal.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> SRV2_MIX_REAL_DIR=<dir with photograph.mp4, passenger.mp4> node headless-032.mjs OUTDIR
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startPreview } from './server.mjs';
import * as M from '../../../lib/srvStudioV2Mix.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PUPPETEER_CORE || here, 'x.js'));
const puppeteer = require('puppeteer-core');
const outDir = path.resolve(process.argv[2]); fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-032-'));
const srv = await startPreview({ publicDir: path.resolve(here, '../../../public'), port: 0, storageDir: path.join(tmp, 's'), dataFile: path.join(tmp, 'state.json') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks = []; const ok = (n, c, x) => { checks.push({ n, pass: !!c, x }); console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 320) : '')); };
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 1600 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(srv.origin + '/studio/mix'); await page.waitForFunction(() => window.__mixReady === true, { timeout: 30000 });
const S = () => page.evaluate(() => ({ order: __mix.order, tl: __mix.tl, validation: __mix.validation, title: __mix.title, description: __mix.description, mixKey: __mix.mixKey, lineage: __mix.lineage, slot: __mix.slot, plan: __mix.plan, checks: __mix.checks, ledger: __mix.ledger, build: __mix.build, joins: __mix.joins, eligible: __mix.eligible }));

// 1. eligibility
let s = await S();
const el = Object.fromEntries(s.eligible.map((e) => [e.title, e]));
ok('eligibility: the 5 public SRV Studio Longs are eligible; "I don’t know you anymore" (uploaded, not public) is not', ['You never saw me break', 'Gone Before Goodbye', 'The day I stopped waiting', 'But the photograph lied', 'Passenger Seat Witness'].every((t) => el[t] && el[t].eligible) && el['I don’t know you anymore'] && el['I don’t know you anymore'].reason === 'not_public');
ok('Shorts and other businesses are never offered (promo Short and an SRV Farsi package filtered out)', !s.eligible.some((e) => e.pkgId === 'pkg_1792875882770' || e.pkgId === 'pkg_farsi_example'));
ok('audio source per song is shown: none of the real Longs has a stored original MP3 — the Long video soundtrack is used', s.eligible.filter((e) => /^pkg_179/.test(e.pkgId)).every((e) => e.source === 'long-video-aac'));
// 2. suggest ~30 min
await page.click('#suggest'); s = await S();
ok('Suggest ~30 min: 5–8 songs, total within 30 min ± 4, chapters valid', s.order.length >= 5 && s.order.length <= 8 && s.validation.ok && Math.abs(s.tl.totalSec - 1800) <= 240, { n: s.order.length, total: s.tl.totalLabel });
const expect = M.srv2MixTimeline(s.order.map((id) => s.eligible.find((e) => e.pkgId === id)));
ok('duration and timestamps on screen equal the reference calculation (crossfades included)', s.tl.totalSec === expect.totalSec && JSON.stringify(s.tl.items.map((x) => x.timestamp)) === JSON.stringify(expect.items.map((x) => x.timestamp)), s.tl.items.map((x) => x.timestamp));
// 3. ordering: move the two songs with local real audio to the top (clicking ↑), then remove + replace
const moveTop = async (title) => { for (let k = 0; k < 10; k++) { const st = await S(); const i = st.tl.items.findIndex((x) => x.title === title); if (i <= 0) return; await page.click(`button[data-up="${i}"]`); } };
await moveTop('Passenger Seat Witness'); await moveTop('But the photograph lied');
s = await S();
ok('ordering: songs move up/down; chapters recompute (photograph → passenger now first)', s.tl.items[0].title === 'But the photograph lied' && s.tl.items[1].title === 'Passenger Seat Witness' && s.tl.items[0].chapterSec === 0 && s.tl.items[1].chapterSec === Math.floor(208.4 - 6 + 3));
const before = s.order.length; const last = s.tl.items[s.tl.items.length - 1].title;
await page.click(`button[data-rm="${s.order.length - 1}"]`); s = await S();
ok('removal: the last song is removed and the total shrinks', s.order.length === before - 1 && !s.tl.items.some((x) => x.title === last));
await page.evaluate(() => { const sel = document.querySelector('select[data-rep="2"]'); sel.value = [...sel.options].find((o) => /TEST stand-in song C/.test(o.textContent)).value; sel.dispatchEvent(new Event('change', { bubbles: true })); });
s = await S();
ok('replacement: song 3 replaced with another eligible song in place', s.tl.items[2].title === 'TEST stand-in song C', s.tl.items.map((x) => x.title));
// restore ~30 min with the suggestion order but keep the real pair first
await page.click('#suggest'); await moveTop('Passenger Seat Witness'); await moveTop('But the photograph lied'); s = await S();
// 4. transition preview (join 1: two real songs when local copies exist)
await page.click('button[data-join="1"]');
await page.waitForFunction(() => !!__mix.joins[1], { timeout: 60000 });
s = await S(); const j = s.joins[1];
ok('transition preview: plays tail of A + head of B with the production crossfade; no gap (level stays within normal music range)', j.continuity.minDb > -45 && j.lengthSec > 20, j);
ok('transition preview uses the real song audio when available (' + j.sources.join(' / ') + ')', process.env.SRV2_MIX_REAL_DIR ? j.sources.every((x) => /real song audio/.test(x)) : true);
ok('loudness normalisation: each song gets a gain toward −14 LUFS', j.gains.every((g) => Number.isFinite(g.gainDb) && Math.abs(g.gainDb) < 12), j.gains);
// 5. image library
const libN = await page.$$eval('#lib button', (b) => b.length);
await page.click('#lib button[data-av="srv2-fm-17"]');
ok('visual: the full approved library (19 images) is offered and an image can be chosen', libN === 19 && (await page.evaluate(() => __mix.avatarId)) === 'srv2-fm-17', libN);
// 6. metadata
s = await S();
const tlines = s.tl.items.map((x) => `${x.timestamp} ${x.title}`);
ok('title ≤ 100 characters, names the month and length', s.title.length <= 100 && /November 2026/.test(s.title) && new RegExp(Math.round(s.tl.totalSec / 60) + ' Min').test(s.title), s.title);
ok('description: tracklist with accurate timestamps (first 0:00), a link to every original song, AI disclosure', tlines.every((l) => s.description.includes(l)) && s.description.includes('0:00 ') && s.tl.items.filter((x) => !/^TEST/.test(x.youtubeVideoId || '')).every((x) => s.description.includes('https://youtu.be/' + x.youtubeVideoId)) && s.description.includes(M.SRV2_MIX_AI_DISCLOSURE));
ok('lineage: every source song keeps its package, task, YouTube id and audio source', s.lineage.length === s.tl.items.length && s.lineage.every((l, i) => l.pkgId === s.tl.items[i].pkgId && l.taskUid && l.youtubeVideoId && l.source));
ok('monthly slot proposed separately: last Saturday of the month 2:00 PM ET (Sat 28 Nov 2026 = 19:00 UTC), never a Long/Short slot', s.slot.utcIso === '2026-11-28T19:00:00.000Z' && s.slot.mode === 'manual-public' && !M.srv2MixSlotCollides(s.slot));
ok('file plan keeps the ~30-min 1080p file under the 500 MB storage limit', s.plan.fitsLimit && s.plan.videoBitsPerSecond > 1_500_000, s.plan);
// 7. build excerpt
await page.click('#build');
await page.waitForFunction(() => !!__mix.build || /failed/i.test(document.getElementById('buildst').textContent), { timeout: 400000, polling: 1000 });
s = await S(); const b = s.build;
ok('representative render: 1920×1080, 30 fps, at the full-mix bitrate plan', b && b.stats.width === 1920 && b.stats.height === 1080 && b.stats.fps === 30 && Math.abs(b.stats.measuredKbps - b.stats.targetVideoKbps) / b.stats.targetVideoKbps < 0.5, b && b.stats);
ok('render frames: ≤ 2% dropped', b && b.stats.frames.droppedPct <= 2, b && b.stats.frames);
ok('excerpt mix: peaks at or below the −1 dBFS ceiling; joins without gaps (full-song −14 LUFS normalisation is proven on the real two-song mix)', b && b.loudness.samplePeakDb <= -0.9 && b.continuity.every((c) => c.minDb > -45), b && { l: b.loudness, c: b.continuity });
const vbytes = await page.evaluate(async () => { const r = await fetch('/__stub/save-render?name=mix-excerpt.' + (__mix.blob.type.includes('mp4') ? 'mp4' : 'webm'), { method: 'POST', body: __mix.blob }); const t = await fetch('/__stub/save-render?name=mix-thumb.jpg', { method: 'POST', body: __mix.thumb }); return (await r.json()).bytes; });
const vf = fs.readdirSync(path.join(tmp, 's', 'renders')).find((f) => /^mix-excerpt\./.test(f)); const vpath = path.join(tmp, 's', 'renders', vf);
fs.copyFileSync(vpath, path.join(outDir, vf)); fs.copyFileSync(path.join(tmp, 's', 'renders', 'mix-thumb.jpg'), path.join(outDir, 'mix-thumb.jpg'));
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate,channels', '-show_entries', 'format=duration', '-of', 'json', vpath]).toString());
const vs = probe.streams.find((x) => x.codec_type === 'video'), as = probe.streams.find((x) => x.codec_type === 'audio');
ok('ffprobe: saved excerpt is 1920×1080 video + stereo audio, duration matches the excerpt plan', vs.width === 1920 && vs.height === 1080 && as && as.channels === 2 && Math.abs(Number(probe.format.duration) - b.excerpt.totalSec) < 1.5, { v: vs.codec_name, a: as && as.codec_name, dur: probe.format.duration, plan: b.excerpt.totalSec, bytes: vbytes });
const r128 = execFileSync('ffmpeg', ['-nostats', '-i', vpath, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString() + '';
let ffl = null; try { const o = execFileSync('sh', ['-c', `ffmpeg -nostats -i "${vpath}" -vn -af ebur128 -f null - 2>&1 | grep -A3 Summary | grep 'I:'`]).toString(); ffl = Number(o.match(/I:\s+(-?[\d.]+)/)[1]); } catch (_) { ffl = null; }
const sil = execFileSync('sh', ['-c', `ffmpeg -nostats -i "${vpath}" -vn -af silencedetect=n=-45dB:d=0.4 -f null - 2>&1 | grep silence_start || true`]).toString().trim().split('\n').filter(Boolean).map((l) => Number(l.match(/silence_start: (-?[\d.]+)/)[1]));
const joinsAt = b.excerpt.items.slice(1).map((x) => x.startSec);
ok('ffmpeg on the encoded excerpt: loudness equals the mixed audio before encoding (±1 LU) and no silence at any join', ffl !== null && Math.abs(ffl - b.loudness.lufs) <= 1 && !sil.some((t) => joinsAt.some((jx) => t > jx - 2 && t < jx + 8)), { ffmpegLufs: ffl, mixLufs: b.loudness.lufs, silences: sil, joins: joinsAt });
await page.screenshot({ path: path.join(outDir, '032-mix-builder.png'), fullPage: true });
// 8. mock private upload + duplicate protection
s = await S();
ok('upload checklist before upload: private, verified channel, AI disclosure, rules met, size within limit, built, not uploaded before, sources unchanged', s.checks.every((c) => c[2] === 'ok'), s.checks.filter((c) => c[2] !== 'ok'));
await page.click('#upload'); s = await S();
ok('mock private upload recorded: PRIVATE, publishAt null, lineage kept, planned public release stored (manual)', s.ledger.entries.length === 1 && s.ledger.entries[0].privacyStatus === 'private' && s.ledger.entries[0].publishAt === null && s.ledger.entries[0].lineage.length === s.tl.items.length && s.ledger.entries[0].plannedRelease.utcIso === s.slot.utcIso);
await page.click('#upload'); const refused = await page.evaluate(() => __mix.lastRefusal);
ok('duplicate protection: the same mix cannot be uploaded twice', refused === 'mix_already_uploaded_or_in_progress' && (await S()).ledger.entries.length === 1, refused);
ok('source songs and packages were never modified', await page.evaluate(() => JSON.stringify(__mix.cat.packages) === __mix.sourcesBefore));
ok('no page errors; no production requests', errors.length === 0 && srv.productionHits === 0, errors.slice(0, 3));
fs.writeFileSync(path.join(outDir, '032-checks.json'), JSON.stringify({ checks, build: b, title: s.title, mixKey: s.mixKey, slot: s.slot, plan: s.plan, timeline: s.tl }, null, 1));
const failed = checks.filter((c) => !c.pass).length; console.log(`\n${checks.length - failed} passed, ${failed} failed · productionHits ${srv.productionHits}`);
await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(failed ? 1 : 0);
