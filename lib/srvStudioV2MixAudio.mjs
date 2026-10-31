// SRV-STUDIO-V2-033 — Monthly Mix audio engine (pure; runs in the browser and in the tests).
//   • edges: lead-in / trailing silence and the Long renderer's built-in fade-out are trimmed so a join never
//     contains silence or a double fade;
//   • a streaming true-peak limiter (4× oversampled peak detection, lookahead, smooth release) keeps the output at or
//     below −1 dBTP after loudness normalisation without clipping or pumping;
//   • rolling segments: the mix is produced one song-window at a time, so at most two decoded songs are in memory.
import { srv2EqualPowerGain, SRV2_MIX_CONFIG } from './srvStudioV2Mix.mjs';

export const SRV2_MIX_AUDIO = Object.freeze({
  silenceDb: -50,           // below this (100 ms RMS) counts as silence
  maxLeadTrimSec: 3,        // never trim more than this off the start
  maxTailTrimSec: 8,        // never trim more than this off the end (silence + fade)
  builtInFadeSec: { 'long-video-aac': 3, 'original-mp3': 0 }, // the Long renderer fades its last 3 s
  maxBoostDb: 9,            // loudness normalisation never adds more than this
  ceilingDbTP: -2,          // limit to −2 dBTP before lossy (AAC) encoding so the delivered file stays ≤ −1 dBTP
  limiter: { lookaheadMs: 5, releaseMs: 120 },
});
const dbToLin = (db) => Math.pow(10, db / 20);

// ── edges ──
// Lead/trail silence from 100 ms RMS windows; for a Long soundtrack the renderer's fixed fade-out is cut too, so the
// mix crossfade (not a pre-baked fade) shapes every join.
export function srv2Edges(channels, fs, source, A = SRV2_MIX_AUDIO) {
  const n = channels[0].length, w = Math.round(0.1 * fs), thr = dbToLin(A.silenceDb);
  const rms = (s) => { let e = 0, c = 0; for (const ch of channels) for (let i = Math.max(0, s); i < Math.min(n, s + w); i++) { e += ch[i] * ch[i]; c++; } return Math.sqrt(e / Math.max(1, c)); };
  let lead = 0; while (lead + w <= n && rms(lead) < thr) lead += w;
  let tail = n; while (tail - w >= 0 && rms(tail - w) < thr) tail -= w;
  const leadSec = Math.min(lead / fs, A.maxLeadTrimSec);
  const fade = A.builtInFadeSec[source] || 0;
  let end = tail; // without a built-in fade: cut only the trailing silence
  if (fade) {
    // measured fade start: inside the last (fade + 0.5 s) before the silence, the first 400 ms window that is 1.5 dB
    // below the music just before it (median of the 3 s preceding that region)
    const regionStart = Math.max(lead, tail - Math.round((fade + 0.5) * fs));
    const w4 = 4 * w; const rms4 = (s0) => { let e = 0, c = 0; for (const ch of channels) for (let i = Math.max(0, s0); i < Math.min(n, s0 + w4); i++) { e += ch[i] * ch[i]; c++; } return Math.sqrt(e / Math.max(1, c)); };
    const ref = []; for (let s0 = Math.max(lead, regionStart - 3 * fs); s0 + w4 <= regionStart; s0 += w) ref.push(rms4(s0));
    const refLvl = ref.length ? ref.sort((x, y) => x - y)[ref.length >> 1] : rms4(regionStart);
    end = tail;
    for (let s0 = regionStart; s0 + w4 <= tail; s0 += w) if (rms4(s0) < refLvl * 0.8414) { end = s0; break; } // −1.5 dB over 400 ms
  }
  const tailCutSec = Math.min((n - end) / fs, A.maxTailTrimSec);
  const trailSilenceSec = (n - tail) / fs;
  const inSec = +leadSec.toFixed(3), outSec = +(n / fs - tailCutSec).toFixed(3);
  return { durationSec: +(n / fs).toFixed(3), inSec, outSec, usedSec: +(outSec - inSec).toFixed(3), leadSilenceSec: +(lead / fs).toFixed(3), trailSilenceSec: +trailSilenceSec.toFixed(3), builtInFadeCutSec: +Math.max(0, tailCutSec - trailSilenceSec).toFixed(3) };
}

// Loudness gain toward the target; peaks are left to the limiter (boost capped to keep dynamics natural).
export function srv2NormGain(lufs, A = SRV2_MIX_AUDIO, cfg = SRV2_MIX_CONFIG) {
  const db = Math.min(A.maxBoostDb, cfg.loudnessTargetLufs - lufs);
  return { gainDb: +db.toFixed(2), gain: dbToLin(db), capped: cfg.loudnessTargetLufs - lufs > A.maxBoostDb };
}

// ── true peak (BS.1770-4 style 4× oversampling with a windowed-sinc interpolator) ──
const OS = 4, TAPS = 12; // 12 taps per phase (48-tap prototype)
const PHASES = (() => {
  const L = OS * TAPS, ph = [];
  for (let p = 0; p < OS; p++) {
    const c = new Float64Array(TAPS);
    for (let k = 0; k < TAPS; k++) {
      const m = k * OS + p, t = (m - (L - 1) / 2) / OS;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const win = 0.42 - 0.5 * Math.cos(2 * Math.PI * m / (L - 1)) + 0.08 * Math.cos(4 * Math.PI * m / (L - 1)); // Blackman
      c[k] = sinc * win;
    }
    const s = c.reduce((a, b) => a + b, 0); for (let k = 0; k < TAPS; k++) c[k] /= s;
    ph.push(c);
  }
  return ph;
})();
// Highest absolute value among the 4 oversampled points around sample i (needs TAPS/2 samples of context).
function tpAt(x, i) {
  let m = Math.abs(x[i]);
  for (let p = 0; p < OS; p++) { const c = PHASES[p]; let v = 0; for (let k = 0; k < TAPS; k++) { const j = i + k - (TAPS >> 1) + 1; if (j >= 0 && j < x.length) v += c[k] * x[j]; } const a = Math.abs(v); if (a > m) m = a; }
  return m;
}
export function srv2TruePeakDb(channels) {
  let m = 0; for (const x of channels) for (let i = 0; i < x.length; i++) { const v = tpAt(x, i); if (v > m) m = v; }
  return +(20 * Math.log10(m || 1e-12)).toFixed(2);
}

// ── streaming true-peak limiter ──
// Delay line of `lookahead` samples; required gain per sample = ceiling / truePeak; a sliding minimum over the
// lookahead window gives a gain that reaches its value before the peak arrives; release is exponential. Stateful
// across process() calls, so segments join seamlessly.
export class Srv2Limiter {
  constructor(fs, channels = 2, A = SRV2_MIX_AUDIO) {
    this.fs = fs; this.ch = channels; this.ceil = dbToLin(A.ceilingDbTP - 0.15); // 0.15 dB margin for interpolation error
    this.quick = this.ceil * 0.5; // below this a sample (and its intersample peaks) cannot reach the ceiling
    this.la = Math.max(1, Math.round(A.limiter.lookaheadMs / 1000 * fs));
    this.rel = Math.exp(-1 / (A.limiter.releaseMs / 1000 * fs));
    this.delay = Array.from({ length: channels }, () => new Float32Array(this.la));
    this.dqI = new Int32Array(this.la + 1); this.dqV = new Float32Array(this.la + 1); this.dqH = 0; this.dqT = 0; // sliding-minimum deque (ring)
    this.pos = 0; this.g = 1; this.filled = 0; this.minGain = 1; this.limitedSamples = 0;
    this.hist = Array.from({ length: channels }, () => new Float32Array(TAPS)); // context for true-peak detection
  }
  _push(i, v) { const N = this.la + 1; while (this.dqT !== this.dqH && this.dqV[(this.dqT - 1 + N) % N] >= v) this.dqT = (this.dqT - 1 + N) % N; this.dqI[this.dqT] = i; this.dqV[this.dqT] = v; this.dqT = (this.dqT + 1) % N; while (this.dqI[this.dqH] <= i - this.la) this.dqH = (this.dqH + 1) % N; return this.dqV[this.dqH]; }
  // in: array of Float32Array (one per channel, equal length) → out: same shape, delayed by `latency` samples overall
  process(input) {
    const n = input[0].length, out = Array.from({ length: this.ch }, () => new Float32Array(n));
    const det = input.map((x, c) => { const d = new Float32Array(TAPS + n); d.set(this.hist[c], 0); d.set(x, TAPS); return d; });
    for (let i = 0; i < n; i++) {
      let pk = 0;
      for (let c = 0; c < this.ch; c++) { const a = Math.abs(det[c][i + TAPS]); const v = a < this.quick && Math.abs(det[c][i + TAPS + 1] || 0) < this.quick ? a : tpAt(det[c], i + TAPS); if (v > pk) pk = v; }
      const need = pk > this.ceil ? this.ceil / pk : 1;
      const target = this._push(this.pos, need);
      this.g = target < this.g ? target : target + (this.g - target) * this.rel; // attack within the lookahead, smooth release
      if (this.g < this.minGain) this.minGain = this.g; if (this.g < 0.999) this.limitedSamples++;
      const di = this.pos % this.la;
      for (let c = 0; c < this.ch; c++) { const d = this.delay[c]; const delayed = this.filled >= this.la ? d[di] : 0; d[di] = input[c][i]; out[c][i] = delayed * this.g; }
      this.pos++; if (this.filled < this.la) this.filled++;
    }
    for (let c = 0; c < this.ch; c++) this.hist[c] = det[c].slice(n, n + TAPS);
    return out;
  }
  flush() { const z = Array.from({ length: this.ch }, () => new Float32Array(this.la)); return this.process(z); }
  get latency() { return this.la; }
  stats() { return { minGainDb: +(20 * Math.log10(this.minGain)).toFixed(2), limitedSec: +(this.limitedSamples / this.fs).toFixed(2) }; }
}

// ── rolling segments ──
// Segment k spans mix time [start_k, start_{k+1}) (the last runs to the end). It contains song k from its trimmed
// start, plus the tail of song k−1 inside the crossfade. Producing segments in order needs only songs k−1 and k.
export function srv2MixSegments(tl) {
  return tl.items.map((it, k) => ({ k, fromSec: it.startSec, toSec: k + 1 < tl.items.length ? tl.items[k + 1].startSec : tl.totalSec, needs: k ? [k - 1, k] : [k] }));
}
// Builds segment k's PCM. src[i] = decoded channels of song i (only k−1 and k are read); edges[i] = {inSec,outSec};
// gains[i] = linear. Same shaping as the reference mixer: equal-power crossfades, intro fade on the first song, outro
// fade on the last.
export function srv2MixSegmentPcm(k, tl, src, edges, gains, fs, cfg = SRV2_MIX_CONFIG) {
  const seg = srv2MixSegments(tl)[k];
  const n0 = Math.round(seg.fromSec * fs), n1 = Math.round(seg.toSec * fs), len = n1 - n0;
  const out = [new Float32Array(len), new Float32Array(len)];
  const xf = Math.round(tl.crossfadeSec * fs), last = tl.items.length - 1;
  for (const i of seg.needs) {
    const it = tl.items[i], s = src[i]; if (!s) throw new Error('segment ' + k + ' needs song ' + (i + 1) + ' decoded');
    const off = Math.round(it.startSec * fs), inS = Math.round(edges[i].inSec * fs), used = Math.round((edges[i].outSec - edges[i].inSec) * fs);
    const from = Math.max(n0, off), to = Math.min(n1, off + used);
    for (let m = from; m < to; m++) {
      const kk = m - off; let w = gains[i];
      if (i > 0 && kk < xf) w *= srv2EqualPowerGain(kk / xf, 'in');
      if (i === 0 && kk < cfg.introFadeSec * fs) w *= kk / (cfg.introFadeSec * fs);
      if (i < last && kk >= used - xf) w *= srv2EqualPowerGain((kk - (used - xf)) / xf, 'out');
      if (i === last && kk >= used - cfg.outroFadeSec * fs) w *= Math.max(0, (used - kk) / (cfg.outroFadeSec * fs));
      for (let c = 0; c < 2; c++) out[c][m - n0] += s[Math.min(c, s.length - 1)][inS + kk] * w;
    }
  }
  return out;
}
// Timeline from trimmed songs (the durations used are outSec − inSec).
export function srv2TrimmedTracks(tracks, edges) { return tracks.map((t, i) => ({ ...t, durationSec: edges[i].usedSec, inSec: edges[i].inSec, outSec: edges[i].outSec })); }
