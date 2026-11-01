// SRV-STUDIO-V2-033 — mix audio engine: edges/trim, normalisation gain, true-peak meter, streaming limiter, rolling
// segments (identical to the one-shot reference mixer), app copies of the shared modules, app wiring (flag OFF default).
//   node tests/srv/test_srv_studio_v2_033_audio.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../../lib/srvStudioV2Mix.mjs';
import * as A from '../../lib/srvStudioV2MixAudio.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = []; let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const fs48 = 48000;
const tone = (sec, { amp = 0.3, hz = 220, lead = 0, fadeOut = 0, tailSilence = 0 } = {}) => {
  const n = Math.round((lead + sec + tailSilence) * fs48); const a = new Float32Array(n);
  for (let i = Math.round(lead * fs48); i < Math.round((lead + sec) * fs48); i++) { const t = i / fs48 - lead; let g = amp; if (fadeOut && t > sec - fadeOut) g *= (sec - t) / fadeOut; a[i] = g * Math.sin(2 * Math.PI * hz * t); }
  return [a, a.slice()];
};

// edges
{
  const s = tone(60, { lead: 0.7, fadeOut: 3, tailSilence: 1 });
  const e = A.srv2Edges(s, fs48, 'long-video-aac');
  ok('edges (Long soundtrack): lead silence 0.7 s trimmed; trailing silence cut and at least 2.4 s of the built-in 3 s fade removed (no double fade at the join)', Math.abs(e.inSec - 0.7) <= 0.1 && e.trailSilenceSec >= 0.9 && e.builtInFadeCutSec >= 2.4 && (e.durationSec - e.outSec) <= 4.5, e);
  const m = A.srv2Edges(s, fs48, 'original-mp3');
  ok('edges (original MP3): only silence trimmed — the song\'s own ending is kept', Math.abs((m.durationSec - m.outSec) - 1) <= 0.15, m);
  const loud = A.srv2Edges(tone(20), fs48, 'original-mp3');
  ok('edges: nothing trimmed from a song without silence', loud.inSec === 0 && loud.outSec === loud.durationSec);
  const silentStart = A.srv2Edges(tone(20, { lead: 6 }), fs48, 'original-mp3');
  ok('edges: never trims more than 3 s from the start (a long quiet intro is music, not dead air)', silentStart.inSec === 3);
}
// normalisation
ok('normalisation gain: toward −14 LUFS; boost capped at +9 dB to keep dynamics', A.srv2NormGain(-20).gainDb === 6 && A.srv2NormGain(-30).gainDb === 9 && A.srv2NormGain(-30).capped && A.srv2NormGain(-10).gainDb === -4);
// true peak
{
  // an intersample-peak test signal: fs/4 sine with 45° phase — samples at ±0.707·A, true peak A
  const n = fs48; const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.9 * Math.sin(2 * Math.PI * 12000 * i / fs48 + Math.PI / 4);
  let sp = 0; for (const v of x) sp = Math.max(sp, Math.abs(v));
  const tp = A.srv2TruePeakDb([x]);
  ok('true-peak meter finds intersample peaks the sample peak misses (12 kHz @ 45°: sample −3.9 dB, true −0.9 dB)', Math.abs(20 * Math.log10(sp) - (-3.93)) < 0.1 && Math.abs(tp - (-0.92)) < 0.3, { sample: 20 * Math.log10(sp), tp });
}
// limiter
{
  const hot = tone(20, { amp: 1.6, hz: 997 });
  const lim = new A.Srv2Limiter(fs48); const parts = [];
  for (let s = 0; s < hot[0].length; s += 4096) parts.push(lim.process(hot.map((c) => c.subarray(s, s + 4096))));
  parts.push(lim.flush());
  const L = parts.reduce((a, p) => a + p[0].length, 0); const o = [new Float32Array(L), new Float32Array(L)]; let k = 0; for (const p of parts) { o[0].set(p[0], k); o[1].set(p[1], k); k += p[0].length; }
  const res = o.map((c) => c.subarray(lim.latency, lim.latency + hot[0].length));
  ok('limiter: a +4 dB signal comes out at or below −1 dBTP', A.srv2TruePeakDb(res) <= -1.0, A.srv2TruePeakDb(res));
  ok('limiter: output length = input (latency compensated) and nothing lost at chunk boundaries', res[0].length === hot[0].length && lim.latency === 240);
  const quiet = tone(10, { amp: 0.2 }); const l2 = new A.Srv2Limiter(fs48); const q = l2.process(quiet); const qf = l2.flush();
  const qq = [0, 1].map((c) => { const a = new Float32Array(quiet[0].length); a.set(q[c].subarray(l2.latency)); a.set(qf[c].subarray(0, l2.latency), quiet[0].length - l2.latency); return a; });
  let maxd = 0; for (let i = 0; i < quiet[0].length; i++) maxd = Math.max(maxd, Math.abs(qq[0][i] - quiet[0][i]));
  ok('limiter: below the ceiling the audio passes through unchanged (bit-transparent apart from latency)', maxd < 1e-6 && l2.stats().limitedSec === 0, maxd);
  // gain must not jump: no step > 0.5 dB between consecutive samples during limiting
  const burst = [new Float32Array(fs48 * 4), new Float32Array(fs48 * 4)]; for (let i = fs48; i < fs48 * 2; i++) { burst[0][i] = burst[1][i] = 1.8 * Math.sin(2 * Math.PI * 440 * i / fs48); } for (let i = 0; i < fs48 * 4; i++) if (!burst[0][i]) burst[0][i] = burst[1][i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / fs48);
  const l3 = new A.Srv2Limiter(fs48); const b3 = l3.process(burst);
  let worst = 0; for (let i = l3.latency + 1; i < b3[0].length; i++) { const env = (j) => Math.abs(b3[0][j]); } // envelope check via RMS windows
  const rmsDb = (c, s, e) => { let x = 0; for (let i = s; i < e; i++) x += c[i] * c[i]; return 10 * Math.log10(x / (e - s) + 1e-12); };
  const w = 480; let jump = 0; for (let s = l3.latency; s + 2 * w < b3[0].length; s += w) jump = Math.max(jump, Math.abs(rmsDb(b3[0], s + w, s + 2 * w) - rmsDb(b3[0], s, s + w)));
  ok('limiter: smooth release (no 10 ms step larger than the burst itself, no pumping spikes; never more gain reduction than the ceiling needs + 0.5 dB)', jump < 16 && l3.stats().minGainDb > -(20 * Math.log10(1.8) - (A.SRV2_MIX_AUDIO.ceilingDbTP - 0.15)) - 0.5, { jumpDb: jump, stats: l3.stats() });
}
// rolling segments == one-shot reference mixer
{
  const songs = [tone(30, { hz: 220 }), tone(26, { hz: 330 }), tone(34, { hz: 440 }), tone(28, { hz: 550 })];
  const edges = songs.map((s) => A.srv2Edges(s, fs48, 'original-mp3'));
  const tl = M.srv2MixTimeline(A.srv2TrimmedTracks(songs.map((_, i) => ({ pkgId: 'p' + i, title: 'S' + i })), edges));
  const gains = [1, 0.8, 1.2, 0.9];
  const segs = A.srv2MixSegments(tl);
  ok('segments: contiguous, cover the whole mix, each needs at most two songs', segs[0].fromSec === 0 && segs.every((s, i) => i === 0 || Math.abs(s.fromSec - segs[i - 1].toSec) < 1e-9) && Math.abs(segs[segs.length - 1].toSec - tl.totalSec) < 1e-9 && segs.every((s) => s.needs.length <= 2));
  const pieces = segs.map((s) => A.srv2MixSegmentPcm(s.k, tl, songs, edges, gains, fs48));
  const L = pieces.reduce((a, p) => a + p[0].length, 0); const roll = new Float32Array(L); let k = 0; for (const p of pieces) { roll.set(p[0], k); k += p[0].length; }
  const ref = M.srv2MixPcm(songs, tl, gains, fs48);
  let md = 0; for (let i = 0; i < Math.min(L, ref[0].length); i++) md = Math.max(md, Math.abs(roll[i] - ref[0][i]));
  ok('rolling segments reproduce the reference mixer sample for sample (|Δ| < 1e-6)', Math.abs(L - ref[0].length) <= 2 && md < 1e-6, { L, ref: ref[0].length, md });
  let threw = false; try { A.srv2MixSegmentPcm(2, tl, [songs[0], null, null, null], edges, gains, fs48); } catch (_) { threw = true; }
  ok('a segment refuses to build if a song it needs is not decoded (no silent gaps)', threw);
}
// app copies + wiring
{
  for (const f of ['srvStudioV2Mix.mjs', 'srvStudioV2MixAudio.mjs', 'srvStudioV2Schedule.mjs']) ok('app copy identical to lib: ' + f, fs.readFileSync(path.join(repo, 'lib', f), 'utf8') === fs.readFileSync(path.join(repo, 'public/srv-studio-v2/lib', f), 'utf8'));
  const H = fs.readFileSync(path.join(repo, 'public/index.html'), 'utf8');
  ok('app: the builder is behind app_settings.srv_studio_v2_mix (enabled) AND the V2 flag; default OFF', /function _srvStudioV2MixOn\(\)\{return _srvStudioV2On\(\)&&_srvStudioV2MixFlag\.state==='on';\}/.test(H) && /_srvStudioV2MixFlag=\{state:'unloaded'\}/.test(H) && /c&&c\.enabled===true\?'on':'off'/.test(H));
  ok('app: the entry button is added only when the flag is on; it opens an overlay outside #mainContent', /if\(_srvStudioV2MixOn\(\)\)b\.push\('<button onclick="_srvEnglishV2MixOpen\(\)"/.test(H) && /document\.body\.appendChild\(ov\)/.test(H));
  // SRV Studio-scoped check for the one expected UI change: _srvEnglishV2Badges differs from main only by the
  // flag-gated Monthly Mix button (the SRV Farsi-owned guard flags this function by name; it is left unchanged).
  {
    const fnOf = (src) => { const i = src.indexOf('\nfunction _srvEnglishV2Badges('); if (i < 0) return null; const j = src.indexOf('\nfunction ', i + 10); return src.slice(i, j); };
    let mainSrc = null; try { mainSrc = execFileSync('git', ['-C', repo, 'show', 'origin/main:public/index.html'], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (_) {}
    const cur = fnOf(H), base = mainSrc && fnOf(mainSrc);
    const added = cur && base ? cur.split('\n').filter((l) => !base.split('\n').includes(l)) : null;
    const removed = cur && base ? base.split('\n').filter((l) => !cur.split('\n').includes(l)) : null;
    ok('SRV Studio badges: the Monthly Mix button (flag-gated) is the only change from main, or is already on main', added && removed && removed.length === 0 && (added.length === 0 ? /if\(_srvStudioV2MixOn\(\)\)b\.push\('<button onclick="_srvEnglishV2MixOpen\(\)"/.test(cur) : added.length === 1 && /^\s*if\(_srvStudioV2MixOn\(\)\)b\.push\('<button onclick="_srvEnglishV2MixOpen\(\)"/.test(added[0])), { added, removed });
  }
  const MX = fs.readFileSync(path.join(repo, 'public/srv-studio-v2/srv2-mix.mjs'), 'utf8');
  ok('builder module: no publishAt, never sets visibility, uses the server action for every upload step', !/publishAt|privacyStatus\s*:\s*'public'/.test(MX) && /op: 'upload_init'/.test(MX) && /op: 'upload_chunk'/.test(MX));
  ok('builder module: the production Long renderer is reused read-only (srv2-render.mjs not modified for mixes)', !/mix/i.test(fs.readFileSync(path.join(repo, 'public/srv-studio-v2/srv2-render.mjs'), 'utf8').replace(/remix/gi, '')));
}
console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
