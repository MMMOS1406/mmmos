// SRV-STUDIO-V2-032 — Monthly Mix Builder (DISCOVERY & PREVIEW ONLY — not wired into the app, the server or any upload).
// Pure, isomorphic logic shared by the preview page and the tests: eligibility, the mix timeline (equal-power
// crossfades), YouTube chapters/timestamps, title/description/tracklist, source lineage, the duplicate-protection key,
// the monthly release slot, and a bitrate plan that keeps a ~30-minute 1080p file inside the storage limit.
// Source songs and packages are only ever READ here.
import { srv2PlanRelease, srv2TzParts, srv2ZonedToUtc } from './srvStudioV2Schedule.mjs';

export const SRV2_MIX_CONFIG = Object.freeze({
  targetSec: 30 * 60, toleranceSec: 4 * 60, minTracks: 5, maxTracks: 8,
  crossfadeSec: 6, introFadeSec: 2, outroFadeSec: 6,
  loudnessTargetLufs: -14, truePeakDb: -1,            // YouTube normalises to about -14 LUFS
  width: 1920, height: 1080, fps: 30, audioBitsPerSecond: 192_000,
  maxFileBytes: 500 * 1024 * 1024,                    // srv-assets bucket file_size_limit (524288000)
  sizeMargin: 0.92,                                   // keep 8% headroom under the limit
  maxVideoBitsPerSecond: 8_000_000,                   // same ceiling as a Long
  minChapterSec: 10,                                   // YouTube chapter rule
});
export const SRV2_MIX_CHANNEL = 'UC0nzWQX6AaUqlF5FozNpWPg';
export const SRV2_MIX_PLAYLIST = Object.freeze({
  suggested: { title: 'SRV Studio Mixes', id: null, note: 'new playlist — created once by the CEO/VA in YouTube Studio' },
  fallback: { title: 'SRV Studio, the full Collection', id: 'PLXCBPiF9p6SA' },
});
// Proposed monthly slot — separate from the weekly Long (Fri 7:00 AM) and Short (Sun 6:00 PM) slots:
// the last Saturday of the month, 2:00 PM America/New_York (StillDepths' mixes all went out between 1 and 4 PM ET).
export const SRV2_MIX_SLOT = Object.freeze({ tz: 'America/New_York', rule: 'last-saturday', weekday: 6, hour: 14, minute: 0, status: 'proposed' });

const VID = /^[A-Za-z0-9_-]{11}$/;

// ── eligibility ──
// An SRV Studio Long that is public on YouTube, built, with a known song length. Audio source preference:
// the original Suno MP3 kept by order 029 ('original-mp3'), else the Long video's own soundtrack ('long-video-aac').
// Shorts (srvShortOf), other businesses and unpublished songs are never eligible.
export function srv2MixEligible(pkgs, publicVideoIds) {
  const pub = new Set(publicVideoIds || []);
  const out = [];
  for (const p of pkgs || []) {
    if (!p || p.engine !== 'SRV English' || p.srvShortOf) continue;
    const yt = (p.srvProduction && p.srvProduction.youtubeVideoId) || (p.srvVa && p.srvVa.youtubeVideoId) || (p.srvPilot && p.srvPilot.youtubeVideoId) || p._srvYtLongId || null;
    const r = p.srvRender || {};
    const sec = Number(r.audioDurationSec || r.durationSec || 0);
    const isLong = (r.width === 1920 && r.height === 1080) || p.contentFormat === 'long' || !!p._srvLongVideoUrl;
    const reason = !isLong ? 'not_long' : !VID.test(String(yt || '')) ? 'not_uploaded' : !pub.has(yt) ? 'not_public' : !(sec > 30) ? 'unknown_duration' : !(p._srvAudioUrl || p._srvLongVideoUrl) ? 'no_audio_source' : null;
    out.push({
      pkgId: String(p.id), taskUid: p.srvTaskUid || null, title: String(p.title || '').trim(), youtubeVideoId: yt, durationSec: sec,
      source: p._srvAudioUrl ? 'original-mp3' : 'long-video-aac', sourceUrl: p._srvAudioUrl || p._srvLongVideoUrl || null,
      avatarId: (p.srvAvatar && p.srvAvatar.id) || null, eligible: !reason, reason,
    });
  }
  return out;
}

// ── timeline ──
// Track i starts at sum(d_0..d_{i-1}) - i*crossfade; every join overlaps `crossfadeSec`. Chapter timestamps sit at
// the MIDDLE of each crossfade (where the new song becomes the louder one), rounded down to whole seconds; the first
// chapter is 0:00 (YouTube requires it).
export function srv2MixTimeline(tracks, { crossfadeSec = SRV2_MIX_CONFIG.crossfadeSec, targetSec = SRV2_MIX_CONFIG.targetSec } = {}) {
  const t = (tracks || []).map((x) => ({ ...x, durationSec: Number(x.durationSec) }));
  if (t.some((x) => !(x.durationSec > crossfadeSec * 2))) throw new Error('every track must be longer than two crossfades');
  let at = 0; const items = [];
  t.forEach((x, i) => {
    const start = i === 0 ? 0 : at - crossfadeSec;
    const chapter = i === 0 ? 0 : Math.floor(start + crossfadeSec / 2);
    items.push({ index: i, pkgId: x.pkgId, title: x.title, youtubeVideoId: x.youtubeVideoId || null, source: x.source || null, startSec: +start.toFixed(3), endSec: +(start + x.durationSec).toFixed(3), durationSec: x.durationSec, chapterSec: chapter, timestamp: srv2Clock(chapter) });
    at = start + x.durationSec;
  });
  const totalSec = +at.toFixed(3);
  return { items, totalSec, totalLabel: srv2Clock(Math.round(totalSec)), crossfadeSec, targetSec, deltaSec: +(totalSec - targetSec).toFixed(1), withinTarget: Math.abs(totalSec - targetSec) <= SRV2_MIX_CONFIG.toleranceSec };
}
export function srv2Clock(sec) {
  const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
// Checks a timeline against the selection rules and YouTube's chapter rules.
export function srv2MixValidate(tl, cfg = SRV2_MIX_CONFIG) {
  const problems = [];
  const n = tl.items.length;
  if (n < cfg.minTracks) problems.push(`at least ${cfg.minTracks} songs (now ${n})`);
  if (n > cfg.maxTracks) problems.push(`at most ${cfg.maxTracks} songs (now ${n})`);
  const ids = tl.items.map((x) => x.pkgId);
  if (new Set(ids).size !== ids.length) problems.push('a song is in the mix twice');
  if (!tl.withinTarget) problems.push(`length ${tl.totalLabel} is not within ${Math.round(cfg.toleranceSec / 60)} min of ${srv2Clock(cfg.targetSec)}`);
  if (n && tl.items[0].chapterSec !== 0) problems.push('the first chapter must start at 0:00');
  for (let i = 1; i < n; i++) if (tl.items[i].chapterSec - tl.items[i - 1].chapterSec < cfg.minChapterSec) problems.push(`chapter ${i + 1} is shorter than ${cfg.minChapterSec} s`);
  if (n && n < 3) problems.push('YouTube needs at least 3 chapters');
  return { ok: !problems.length, problems };
}

// ── metadata ──
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function srv2MixTitle(monthKey, tl) {
  const [y, m] = String(monthKey).split('-').map(Number);
  const mins = Math.round(tl.totalSec / 60);
  const variants = [
    `SRV Studio Monthly Mix — ${MONTHS[m - 1]} ${y} | ${mins} Min Emotional Deep House for the Night Drive`,
    `SRV Studio Mix — ${MONTHS[m - 1]} ${y} | ${mins} Min Emotional Deep House`,
    `SRV Studio Mix — ${MONTHS[m - 1]} ${y}`,
  ];
  return variants.find((v) => v.length <= 100);
}
export const SRV2_MIX_AI_DISCLOSURE = 'Music, vocals and visuals in this video are AI-generated and edited by SRV Studio.';
export function srv2MixDescription(monthKey, tl) {
  const [y, m] = String(monthKey).split('-').map(Number);
  const lines = [];
  lines.push(`${tl.items.length} emotional deep house songs from SRV Studio, mixed into one ${Math.round(tl.totalSec / 60)}-minute night drive — ${MONTHS[m - 1]} ${y}.`);
  lines.push('');
  lines.push('Tracklist');
  for (const x of tl.items) lines.push(`${x.timestamp} ${x.title}`);
  lines.push('');
  lines.push('Full songs');
  for (const x of tl.items) if (x.youtubeVideoId) lines.push(`${x.title} — https://youtu.be/${x.youtubeVideoId}`);
  lines.push('');
  lines.push('Subscribe to SRV Studio for a new emotional deep house song every Friday.');
  lines.push(SRV2_MIX_AI_DISCLOSURE);
  lines.push('#SRVStudio #DeepHouse #NightDrive #DeepHouseMix #EmotionalHouse');
  return lines.join('\n');
}
export function srv2MixTags(tl) {
  const base = ['SRV Studio', 'deep house mix', 'emotional deep house', 'night drive music', 'deep house 2026', 'female vocal deep house', 'melancholic deep house', 'late night music', 'mix'];
  const all = base.concat(tl.items.map((x) => x.title)).filter((v, i, a) => a.indexOf(v) === i);
  const out = []; let len = 0;
  for (const t of all) { if (len + t.length + 1 > 450) break; out.push(t); len += t.length + 1; }
  return out;
}
// Every source song with its package, task, YouTube id and audio source — kept on the mix package forever.
export function srv2MixLineage(tl, eligible) {
  const by = new Map((eligible || []).map((e) => [e.pkgId, e]));
  return tl.items.map((x) => { const e = by.get(x.pkgId) || {}; return { order: x.index + 1, pkgId: x.pkgId, taskUid: e.taskUid || null, title: x.title, youtubeVideoId: x.youtubeVideoId, source: e.source || x.source || null, sourceUrl: e.sourceUrl || null, startSec: x.startSec, chapter: x.timestamp }; });
}

// ── duplicate protection ──
// The mix key is the month + the ordered list of source packages: building the same mix twice gives the same key, and the
// (future) server ledger refuses a second upload of a key or of a mix package id.
export function srv2MixKey(monthKey, tl) {
  const s = 'srv2mix|' + monthKey + '|' + tl.items.map((x) => x.pkgId).join(',');
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = ((h2 << 5) + h2 + c) >>> 0; }
  return 'mix_' + monthKey.replace('-', '') + '_' + h1.toString(36) + h2.toString(36);
}
export function srv2MixUploadDecide(ledger, req) {
  const live = ((ledger && ledger.entries) || []).filter((e) => e.status === 'pending' || e.status === 'uploaded');
  if (!/^mix_\d{6}_[a-z0-9]+$/.test(String(req.mixKey || ''))) return { ok: false, reason: 'bad_mix_key' };
  if (live.some((e) => e.mixKey === req.mixKey)) return { ok: false, reason: 'mix_already_uploaded_or_in_progress' };
  if (req.mixPkgId && live.some((e) => e.mixPkgId === req.mixPkgId)) return { ok: false, reason: 'mix_package_already_uploaded' };
  if (live.some((e) => e.monthKey === req.monthKey)) return { ok: false, reason: 'month_already_has_a_mix' };
  return { ok: true };
}

// ── monthly release slot ──
export function srv2MixMonthlySlot(monthKey, S = SRV2_MIX_SLOT) {
  const [y, m] = String(monthKey).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)); // last day of month
  const back = (last.getUTCDay() - S.weekday + 7) % 7;
  const d = last.getUTCDate() - back;
  const utc = srv2ZonedToUtc(y, m, d, S.hour, S.minute, S.tz);
  const lp = srv2TzParts(utc, S.tz);
  return { monthKey, tz: S.tz, tzName: lp.tzName, utcIso: new Date(utc).toISOString(), localDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, localTime: `${String(lp.h).padStart(2, '0')}:${String(lp.mi).padStart(2, '0')}`, weekday: 'Saturday', status: S.status, mode: 'manual-public' };
}
// The monthly mix never collides with a weekly slot (Long Friday 7:00 AM, Short Sunday 6:00 PM).
export function srv2MixSlotCollides(slot) {
  const L = srv2PlanRelease('long', Date.parse(slot.utcIso) - 8 * 86400000);
  const Sh = srv2PlanRelease('short', Date.parse(slot.utcIso) - 8 * 86400000);
  return [L, Sh].some((p) => p && p.utcIso === slot.utcIso);
}

// ── size / bitrate plan ──
// Picks the highest video bitrate (≤ the Long's 8 Mbps) that keeps the whole file under the storage limit with margin.
export function srv2MixBitratePlan(totalSec, cfg = SRV2_MIX_CONFIG) {
  const budgetBits = cfg.maxFileBytes * 8 * cfg.sizeMargin;
  const containerOverhead = 0.015;
  const videoBps = Math.min(cfg.maxVideoBitsPerSecond, Math.floor(budgetBits / totalSec / (1 + containerOverhead) - cfg.audioBitsPerSecond));
  const estBytes = Math.round(((videoBps + cfg.audioBitsPerSecond) * totalSec * (1 + containerOverhead)) / 8);
  const atLongBitrate = Math.round(((cfg.maxVideoBitsPerSecond + cfg.audioBitsPerSecond) * totalSec * (1 + containerOverhead)) / 8);
  return { totalSec, videoBitsPerSecond: videoBps, audioBitsPerSecond: cfg.audioBitsPerSecond, estimatedBytes: estBytes, limitBytes: cfg.maxFileBytes, fitsLimit: estBytes <= cfg.maxFileBytes, bytesAtLongBitrate: atLongBitrate, renderRealtimeSec: Math.ceil(totalSec) };
}

// ── audio maths (pure; the browser module and the tests use the same functions) ──
// Equal-power crossfade: out = cos(x·π/2), in = sin(x·π/2) → constant power through the join (no dip, no bump).
export function srv2EqualPowerGain(x, dir) { const c = Math.min(1, Math.max(0, x)); return dir === 'in' ? Math.sin(c * Math.PI / 2) : Math.cos(c * Math.PI / 2); }
export function srv2EqualPowerCurve(n, dir) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = srv2EqualPowerGain(n === 1 ? 1 : i / (n - 1), dir); return a; }

// Integrated loudness (ITU-R BS.1770-4 / EBU R128): K-weighting (pre-filter shelf + RLB high-pass, coefficients
// derived for any sample rate), 400 ms blocks with 75% overlap, absolute gate -70 LUFS, relative gate -10 LU.
function kCoeffs(fs) {
  // stage 1: high shelf (+4 dB above ~1.5 kHz)
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  // stage 2: high-pass (RLB)
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs); a0 = 1 + K / Q + K * K;
  const s2 = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  return [s1, s2];
}
function biquad(x, { b, a }) {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
export function srv2Loudness(channels, fs) {
  const [s1, s2] = kCoeffs(fs);
  const kw = channels.map((c) => biquad(biquad(c, s1), s2));
  const block = Math.round(0.4 * fs), hop = Math.round(0.1 * fs), n = kw[0].length;
  const z = [];
  for (let st = 0; st + block <= n; st += hop) { let sum = 0; for (const c of kw) { let s = 0; for (let i = st; i < st + block; i++) s += c[i] * c[i]; sum += s / block; } z.push(sum); }
  const L = (p) => -0.691 + 10 * Math.log10(p);
  const absG = z.filter((p) => p > 0 && L(p) > -70);
  if (!absG.length) return { lufs: -Infinity, blocks: z.length };
  const relThr = L(absG.reduce((a, b) => a + b, 0) / absG.length) - 10;
  const g = absG.filter((p) => L(p) > relThr);
  let peak = 0; for (const c of channels) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; }
  return { lufs: +L(g.reduce((a, b) => a + b, 0) / g.length).toFixed(2), samplePeakDb: +(20 * Math.log10(peak || 1e-9)).toFixed(2), blocks: z.length };
}
// Gain (linear) that brings a track to the loudness target without its sample peak passing the ceiling.
export function srv2LoudnessGain(meas, cfg = SRV2_MIX_CONFIG) {
  let db = cfg.loudnessTargetLufs - meas.lufs;
  if (meas.samplePeakDb + db > cfg.truePeakDb) db = cfg.truePeakDb - meas.samplePeakDb;
  return { gainDb: +db.toFixed(2), gain: Math.pow(10, db / 20), peakLimited: meas.samplePeakDb + (cfg.loudnessTargetLufs - meas.lufs) > cfg.truePeakDb };
}
// Reference mixer (tests, transition previews): sums the tracks at their timeline positions with per-track gains,
// equal-power crossfades on every join, a short fade-in and the outro fade.
export function srv2MixPcm(tracks, tl, gains, fs, cfg = SRV2_MIX_CONFIG) {
  const nOut = Math.ceil(tl.totalSec * fs); const ch = tracks[0].length;
  const out = Array.from({ length: ch }, () => new Float32Array(nOut));
  const xf = Math.round(tl.crossfadeSec * fs), last = tl.items.length - 1;
  tl.items.forEach((it, i) => {
    const src = tracks[i]; const g = gains ? gains[i] : 1; const off = Math.round(it.startSec * fs); const len = src[0].length;
    for (let k = 0; k < len && off + k < nOut; k++) {
      let w = g;
      if (i > 0 && k < xf) w *= srv2EqualPowerGain(k / xf, 'in');
      if (i === 0 && k < cfg.introFadeSec * fs) w *= k / (cfg.introFadeSec * fs);
      if (i < last && k >= len - xf) w *= srv2EqualPowerGain((k - (len - xf)) / xf, 'out');
      if (i === last && k >= len - cfg.outroFadeSec * fs) w *= Math.max(0, (len - k) / (cfg.outroFadeSec * fs));
      for (let c = 0; c < ch; c++) out[c][off + k] += src[Math.min(c, src.length - 1)][k] * w;
    }
  });
  return out;
}
// Short-term level (dBFS RMS, 100 ms windows) around each join — finds dips/silences or level jumps at transitions.
export function srv2JoinContinuity(mix, fs, tl, padSec = 8) {
  const res = [];
  for (let i = 1; i < tl.items.length; i++) {
    const c0 = tl.items[i].startSec, from = Math.max(0, Math.floor((c0 - padSec) * fs)), to = Math.min(mix[0].length, Math.floor((c0 + tl.crossfadeSec + padSec) * fs));
    const w = Math.round(0.1 * fs); const lv = [];
    for (let s = from; s + w <= to; s += w) { let e = 0; for (const c of mix) for (let k = s; k < s + w; k++) e += c[k] * c[k]; lv.push(10 * Math.log10(e / (w * mix.length) + 1e-12)); }
    res.push({ join: i, atSec: +c0.toFixed(2), minDb: +Math.min(...lv).toFixed(1), maxDb: +Math.max(...lv).toFixed(1), medianDb: +lv.slice().sort((a, b) => a - b)[lv.length >> 1].toFixed(1) });
  }
  return res;
}
