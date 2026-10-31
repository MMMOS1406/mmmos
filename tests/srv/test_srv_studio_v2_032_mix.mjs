// SRV-STUDIO-V2-032 — Monthly Mix Builder logic (preview only): timeline/chapters, rules, metadata, lineage,
// duplicate key/decision, monthly slot (DST), size plan, equal-power crossfade, BS.1770 loudness, reference mixer.
// Optional real-audio checks when SRV2_MIX_REAL_DIR has photograph.f32 / passenger.f32 (48 kHz stereo float).
//   node tests/srv/test_srv_studio_v2_032_mix.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../../lib/srvStudioV2Mix.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = []; let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const cat = JSON.parse(fs.readFileSync(path.join(repo, 'tests/srv/studio-v2-preview/mix-catalog.json'), 'utf8'));
const el = M.srv2MixEligible(cat.packages, cat.publicVideoIds);
const byTitle = (t) => el.find((e) => e.title === t);

// eligibility
ok('eligible: public SRV Studio Longs only; unpublished Long refused (not_public); Short and other business never listed', byTitle('Passenger Seat Witness').eligible && byTitle('I don’t know you anymore').reason === 'not_public' && !el.some((e) => e.pkgId === 'pkg_1792875882770' || e.pkgId === 'pkg_farsi_example'));
ok('audio source: original MP3 preferred, else the Long video soundtrack', M.srv2MixEligible([{ id: 'p1', engine: 'SRV English', title: 't', srvRender: { width: 1920, height: 1080, audioDurationSec: 200 }, srvProduction: { youtubeVideoId: 'aaaaaaaaaaa' }, _srvAudioUrl: 'mp3', _srvLongVideoUrl: 'mp4' }], ['aaaaaaaaaaa'])[0].source === 'original-mp3' && byTitle('Gone Before Goodbye').source === 'long-video-aac');

// timeline
const five = ['You never saw me break', 'Gone Before Goodbye', 'The day I stopped waiting', 'But the photograph lied', 'Passenger Seat Witness'].map(byTitle);
const tl5 = M.srv2MixTimeline(five);
const sum = five.reduce((a, x) => a + x.durationSec, 0);
ok('total = sum of songs − (n−1) × crossfade (today\'s 5 public Longs → 19:01)', Math.abs(tl5.totalSec - (sum - 4 * 6)) < 1e-6 && tl5.totalLabel === '19:01', tl5.totalLabel);
ok('each song starts where the previous ends minus the crossfade; chapter = middle of the crossfade; first chapter 0:00', tl5.items.every((x, i) => i === 0 ? x.startSec === 0 && x.chapterSec === 0 : Math.abs(x.startSec - (tl5.items[i - 1].endSec - 6)) < 1e-6 && x.chapterSec === Math.floor(x.startSec + 3)));
ok('today\'s catalogue is too short for a 30-min mix (19:01) — the rules say so', !M.srv2MixValidate(tl5).ok && /not within 4 min of 30:00/.test(M.srv2MixValidate(tl5).problems.join()));
const eight = el.filter((e) => e.eligible).slice(0, 8); const tl8 = M.srv2MixTimeline(eight);
ok('8 songs (5 real + 3 TEST stand-ins) → 30:49, rules met', tl8.totalLabel === '30:49' && M.srv2MixValidate(tl8).ok, tl8.totalLabel);
ok('rules: at most 8 songs, no repeats, chapters ≥ 10 s apart', !M.srv2MixValidate(M.srv2MixTimeline(eight.concat([eight[0]]))).ok && /twice|at most 8/.test(M.srv2MixValidate(M.srv2MixTimeline(eight.concat([eight[0]]))).problems.join()));
ok('clock labels: m:ss under an hour, h:mm:ss beyond', M.srv2Clock(1849) === '30:49' && M.srv2Clock(3725) === '1:02:05' && M.srv2Clock(0) === '0:00');
let threw = false; try { M.srv2MixTimeline([{ pkgId: 'x', title: 'x', durationSec: 10 }]); } catch (_) { threw = true; }
ok('a song shorter than two crossfades is refused', threw);

// metadata, lineage, key
const title = M.srv2MixTitle('2026-11', tl8), desc = M.srv2MixDescription('2026-11', tl8);
ok('title ≤ 100 chars with month and length', title.length <= 100 && /November 2026/.test(title) && /31 Min/.test(title), title);
ok('description: "0:00" first, every chapter line, a link to each real song, AI disclosure, hashtags', tl8.items.every((x) => desc.includes(`${x.timestamp} ${x.title}`)) && desc.includes('0:00 ') && five.every((x) => desc.includes('https://youtu.be/' + x.youtubeVideoId)) && desc.includes(M.SRV2_MIX_AI_DISCLOSURE) && /#DeepHouseMix/.test(desc));
ok('tags stay under YouTube\'s 500-character limit and include each song title that fits', M.srv2MixTags(tl8).join(',').length <= 500 && M.srv2MixTags(tl8).includes('Passenger Seat Witness'));
const lin = M.srv2MixLineage(tl8, el);
ok('lineage keeps package, task, YouTube id, audio source, position for every song', lin.length === 8 && lin.every((l, i) => l.pkgId === tl8.items[i].pkgId && l.taskUid && l.youtubeVideoId && l.source && l.order === i + 1));
const k1 = M.srv2MixKey('2026-11', tl8), k2 = M.srv2MixKey('2026-11', M.srv2MixTimeline(eight)), k3 = M.srv2MixKey('2026-11', M.srv2MixTimeline(eight.slice().reverse())), k4 = M.srv2MixKey('2026-12', tl8);
ok('mix key: same month + same ordered songs → same key; a different order or month → a different key', k1 === k2 && k1 !== k3 && k1 !== k4 && /^mix_202611_[a-z0-9]+$/.test(k1), [k1, k3, k4]);
const L = { entries: [{ mixKey: k1, mixPkgId: 'pkg_mix_1', monthKey: '2026-11', status: 'uploaded' }] };
ok('duplicate protection: same key refused; same mix package refused; second mix in the same month refused; a failed attempt does not block', M.srv2MixUploadDecide(L, { mixKey: k1, monthKey: '2026-11' }).reason === 'mix_already_uploaded_or_in_progress' && M.srv2MixUploadDecide(L, { mixKey: k4, mixPkgId: 'pkg_mix_1', monthKey: '2026-12' }).reason === 'mix_package_already_uploaded' && M.srv2MixUploadDecide(L, { mixKey: k3, monthKey: '2026-11' }).reason === 'month_already_has_a_mix' && M.srv2MixUploadDecide({ entries: [{ ...L.entries[0], status: 'failed' }] }, { mixKey: k1, monthKey: '2026-11' }).ok && M.srv2MixUploadDecide(L, { mixKey: 'nope' }).reason === 'bad_mix_key');

// monthly slot
const sl = ['2026-11', '2026-12', '2027-01', '2027-03', '2027-10'].map((m) => M.srv2MixMonthlySlot(m));
ok('monthly slot = last Saturday 2:00 PM America/New_York, DST-correct (Nov 28 EST 19:00Z · Mar 27 EDT 18:00Z · Oct 30 2027 EDT 18:00Z)', sl[0].utcIso === '2026-11-28T19:00:00.000Z' && sl[1].utcIso === '2026-12-26T19:00:00.000Z' && sl[2].utcIso === '2027-01-30T19:00:00.000Z' && sl[3].utcIso === '2027-03-27T18:00:00.000Z' && sl[4].utcIso === '2027-10-30T18:00:00.000Z' && sl.every((s) => s.localTime === '14:00' && s.weekday === 'Saturday'), sl.map((s) => s.utcIso));
ok('the monthly slot never coincides with the weekly Long (Fri 7 AM) or Short (Sun 6 PM) slots', sl.every((s) => !M.srv2MixSlotCollides(s)));

// size plan
const p30 = M.srv2MixBitratePlan(1800), p45 = M.srv2MixBitratePlan(2700), p10 = M.srv2MixBitratePlan(300);
ok('size plan: 30 min fits 500 MB at ≈ 1.92 Mbps video; 8 Mbps would be ≈ 1.87 GB; a 5-min mix keeps the Long\'s 8 Mbps ceiling', p30.fitsLimit && Math.abs(p30.videoBitsPerSecond - 1.92e6) < 0.05e6 && p30.bytesAtLongBitrate > 1.8e9 && p10.videoBitsPerSecond === 8_000_000 && p45.fitsLimit && p45.videoBitsPerSecond < p30.videoBitsPerSecond, { p30, p45: p45.videoBitsPerSecond });

// audio maths
let maxDev = 0; for (let i = 0; i <= 100; i++) { const x = i / 100; maxDev = Math.max(maxDev, Math.abs(M.srv2EqualPowerGain(x, 'out') ** 2 + M.srv2EqualPowerGain(x, 'in') ** 2 - 1)); }
ok('equal-power crossfade: out² + in² = 1 at every point (constant power through the join)', maxDev < 1e-12, maxDev);
const fs48 = 48000, sine = (amp, hz = 997, sec = 5) => Float32Array.from({ length: fs48 * sec }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / fs48));
const zeros = new Float32Array(fs48 * 5);
const lL = M.srv2Loudness([sine(1), zeros], fs48).lufs, lB = M.srv2Loudness([sine(1), sine(1)], fs48).lufs, l20 = M.srv2Loudness([sine(0.1), sine(0.1)], fs48).lufs;
ok('BS.1770 reference: full-scale 997 Hz sine in one channel = −3.01 LUFS (±0.1), both channels ≈ 0 LUFS, −20 dB input reads 20 LU lower', Math.abs(lL + 3.01) < 0.1 && Math.abs(lB) < 0.1 && Math.abs(lB - l20 - 20) < 0.05, { lL, lB, l20 });
const g = M.srv2LoudnessGain({ lufs: -20, samplePeakDb: -12 }), gl = M.srv2LoudnessGain({ lufs: -20, samplePeakDb: -3 });
ok('loudness gain: +6 dB to reach −14 LUFS; limited so the peak stays at −1 dBFS (flagged peakLimited)', g.gainDb === 6 && !g.peakLimited && gl.gainDb === 2 && gl.peakLimited);
// reference mixer on synthetic stereo tones: length, no gap, constant power across the join
const tone = (hz, sec) => [sine(0.3, hz, sec), sine(0.3, hz, sec)];
const tlT = M.srv2MixTimeline([{ pkgId: 'a', title: 'A', durationSec: 20 }, { pkgId: 'b', title: 'B', durationSec: 20 }]);
const mixT = M.srv2MixPcm([tone(220, 20), tone(330, 20)], tlT, [1, 1], fs48);
const cT = M.srv2JoinContinuity(mixT, fs48, tlT, 4)[0];
ok('reference mixer: output length = timeline; across the join the level stays within 3 dB (no dip, no bump)', mixT[0].length === Math.ceil(tlT.totalSec * fs48) && cT.maxDb - cT.minDb < 3, cT);

// optional: real song audio (Long soundtracks) — loudness meter vs ffmpeg reference values measured in discovery
const dir = process.env.SRV2_MIX_REAL_DIR;
if (dir && fs.existsSync(path.join(dir, 'photograph.f32')) && fs.existsSync(path.join(dir, 'passenger.f32'))) {
  const load = (n) => { const b = fs.readFileSync(path.join(dir, n + '.f32')); const f = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); const a = new Float32Array(f.length / 2), c = new Float32Array(f.length / 2); for (let i = 0; i < a.length; i++) { a[i] = f[2 * i]; c[i] = f[2 * i + 1]; } return [a, c]; };
  const A = load('photograph'), B = load('passenger'); const mA = M.srv2Loudness(A, fs48), mB = M.srv2Loudness(B, fs48);
  ok('real songs: meter matches ffmpeg ebur128 (−15.5 / −15.0 LUFS) within 0.1 LU', Math.abs(mA.lufs + 15.5) <= 0.1 && Math.abs(mB.lufs + 15.0) <= 0.1, { mA, mB });
  const tlR = M.srv2MixTimeline([{ pkgId: 'pkg_1792360206717', title: 'But the photograph lied', durationSec: A[0].length / fs48 }, { pkgId: 'pkg_1792604593962', title: 'Passenger Seat Witness', durationSec: B[0].length / fs48 }]);
  const mixR = M.srv2MixPcm([A, B], tlR, [M.srv2LoudnessGain(mA).gain, M.srv2LoudnessGain(mB).gain], fs48);
  const lr = M.srv2Loudness(mixR, fs48), cr = M.srv2JoinContinuity(mixR, fs48, tlR)[0];
  ok('real two-song mix: −14.0 LUFS (±0.3), peak ≤ −1 dBFS, join without a gap', Math.abs(lr.lufs + 14) <= 0.3 && lr.samplePeakDb <= -1 && cr.minDb > -40, { lr, cr });
} else out.push('SKIP real-audio checks (set SRV2_MIX_REAL_DIR to a folder with photograph.f32 / passenger.f32)');

// isolation: preview-only — nothing in the app, server or production routing references the mix builder
const H = fs.readFileSync(path.join(repo, 'public/index.html'), 'utf8'), OPS = fs.readFileSync(path.join(repo, 'api/ops.js'), 'utf8');
ok('preview only: the app (index.html) and server (api/ops.js) do not load or call the mix builder', !/srvStudioV2Mix|srv2-mix|mix-studio|srv_studio_v2_mix/.test(H + OPS));
ok('the preview module lives outside public/ (never served by the app)', !fs.existsSync(path.join(repo, 'public/srv-studio-v2/srv2-mix.mjs')) && fs.existsSync(path.join(repo, 'tests/srv/studio-v2-preview/srv2-mix-preview.mjs')));
console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
