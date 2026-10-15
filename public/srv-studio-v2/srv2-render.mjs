// SRV Studio V2 — cinematic video renderer (Checkpoint D2, order SRV-STUDIO-V2-007).
//
// Used ONLY by the SRV English V2 build/publish paths in public/index.html, and only while the SRV Studio
// V2 flag is on. It is loaded on demand with import(), so nothing here runs for SRV Farsi, for SRV Studio
// V1, or while the flag is off. The shared _srvRenderVideo is not called, copied or changed.
//
// Contents:
//  • config ............ output targets (Long 1920x1080/30/8 Mbps, Short 1080x1920/30/6 Mbps, thumb 1280x720)
//  • metadata .......... YouTube title / description / tags templates (pure; also used for the dry run)
//  • audio analysis .... chorus window, vocal onset and lyric line timing (pure; no shared code)
//  • grade ............. luminance-only black-and-white grade, halation map, blur, vignette, grain
//  • timelines ......... Long shots (wide / medium / close on the face), hook moments, Short lyric lines
//  • painters .......... Long frame, Short frame, 1280x720 thumbnail, Short cover
//  • recorder .......... canvas.captureStream + WebAudio + MediaRecorder, MP4 (H.264) first, then WebM (VP9)
//  • frame monitor ..... dropped-frame accounting with a 2% warning threshold
//
// Painters are plain canvas-2D code, so they run in the browser and in Node (@napi-rs/canvas) for tests
// and report samples. Browser-only parts (fonts, image loading, recording) are guarded.

export const SRV2_RENDER_VERSION = 'srv2-render-1';

export const SRV2_RENDER_CONFIG = {
  long:  { W: 1920, H: 1080, fps: 30, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000, maxSec: 360 },
  short: { W: 1080, H: 1920, fps: 30, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000, maxSec: 60, targetSec: 30 },
  thumb: { W: 1280, H: 720, type: 'image/jpeg', quality: 0.9, maxBytes: 2 * 1024 * 1024 },
  dropWarnPct: 2,
  // Kept clear of text in the Short (YouTube Shorts overlays: header, title/description/buttons, actions).
  shortSafe: { top: 220, bottom: 480, right: 140 },
};

// Codec preference: H.264 MP4 first (YouTube's recommended upload codec), then VP9 / VP8 WebM.
export const SRV2_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2', // H.264 High@4.0 + AAC-LC (covers 1920x1080 and 1080x1920 at 30 fps)
  'video/mp4;codecs=avc1.4d0028,mp4a.40.2', // H.264 Main@4.0 + AAC-LC
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
export function srv2PickMime(isTypeSupported) {
  for (const m of SRV2_MIME_CANDIDATES) { try { if (isTypeSupported(m)) return m; } catch (_) {} }
  return null;
}
export function srv2MimeInfo(mime) {
  const m = String(mime || '');
  const container = m.startsWith('video/mp4') ? 'mp4' : 'webm';
  const video = /avc1/.test(m) || (container === 'mp4') ? 'h264' : /vp9/.test(m) ? 'vp9' : /vp8/.test(m) ? 'vp8' : 'vp9';
  const audio = container === 'mp4' ? 'aac' : 'opus';
  return { container, ext: container, type: 'video/' + container, video, audio };
}

// Branding: an original "SRV STUDIO" wordmark (no logo file exists yet). When the CEO supplies the logo,
// set logoUrl (or pass opts.logoUrl) and every Long, Short and thumbnail uses it in the wordmark's place.
export const SRV2_BRAND = {
  word: 'SRV STUDIO',
  genre: 'Emotional Deep House · Night Drive',
  logoUrl: null, // e.g. '/srv-studio-v2/brand/srv-studio-logo.png' (transparent PNG, white on transparent)
  ink: '#f0f0f0',
};
export const SRV2_FONTS = { display: "'SRV2 Display', 'Playfair Display', Georgia, serif", sans: "'SRV2 Sans', 'Inter', system-ui, sans-serif" };
export const SRV2_FONT_FILES = [
  { family: 'SRV2 Display', file: 'PlayfairDisplay-Variable.ttf', weight: '400 900' },
  { family: 'SRV2 Sans', file: 'Inter-Variable.ttf', weight: '100 900' },
];

// ═══ Metadata (pure) ═════════════════════════════════════════════════════════
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️⃣]/gu;
export function srv2StripEmoji(s) { return String(s || '').replace(EMOJI_RE, ''); }
// A clean song title: no emoji wrappers, no [TEST] prefix, no "| ..." suffixes, no quotes or angle brackets.
export function srv2CleanTitle(t) {
  let s = srv2StripEmoji(t).replace(/^\s*\[test\]\s*/i, '');
  s = s.split('|')[0];
  s = s.replace(/[<>]/g, '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  return s;
}
export function srv2MoodKey(mode) {
  const m = String(mode || '').toLowerCase();
  if (m.includes('romantic')) return 'romantic';
  if (m.includes('happy') || m.includes('hopeful')) return 'hopeful';
  return 'emotional';
}
const MOOD_WORD = { romantic: 'Romantic', emotional: 'Melancholic', hopeful: 'Hopeful' };
const MOOD_TAG = { romantic: '#RomanticHouse', emotional: '#MelancholicHouse', hopeful: '#HopefulHouse' };
export const SRV2_TITLE_MAX = 100;
// Long: "{Title} | Emotional Deep House | Night Drive | SRV Studio"
// Short: "{Title} | Night Drive Deep House | SRV Studio #Shorts"
// Over 100 characters, descriptor segments are dropped (never the song title, never "SRV Studio" while it fits).
export function srv2YouTubeTitle(kind, title, { test = false } = {}) {
  const T = srv2CleanTitle(title) || 'Untitled';
  const pre = test ? '[TEST] ' : '';
  const variants = kind === 'short'
    ? [`${T} | Night Drive Deep House | SRV Studio #Shorts`, `${T} | SRV Studio #Shorts`, `${T} #Shorts`]
    : [`${T} | Emotional Deep House | Night Drive | SRV Studio`, `${T} | Emotional Deep House | SRV Studio`, `${T} | SRV Studio`, T];
  for (const v of variants) if ((pre + v).length <= SRV2_TITLE_MAX) return pre + v;
  // Only a title that is itself over the limit is shortened (at a word boundary).
  const room = SRV2_TITLE_MAX - pre.length - (kind === 'short' ? ' #Shorts'.length : 0) - 1;
  let cut = T.slice(0, room); const sp = cut.lastIndexOf(' '); if (sp > room * 0.6) cut = cut.slice(0, sp);
  return pre + cut.trim() + '…' + (kind === 'short' ? ' #Shorts' : '');
}
export function srv2Hashtags(kind, moodKey) {
  const tags = ['#SRVStudio', '#DeepHouse', '#NightDrive', '#EmotionalHouse', MOOD_TAG[moodKey] || MOOD_TAG.emotional];
  if (kind === 'short') tags.push('#Shorts');
  return tags;
}
export function srv2Tags(kind, moodKey, title) {
  const mood = (MOOD_WORD[moodKey] || 'Melancholic').toLowerCase();
  const out = ['SRV Studio', 'emotional deep house', 'deep house', 'night drive', 'night drive music', 'melodic deep house',
    'female vocal deep house', mood + ' deep house', 'late night music'];
  const T = srv2CleanTitle(title); if (T) out.push(T);
  if (kind === 'short') out.push('shorts');
  let total = 0; return out.filter((t) => (total += t.length + 1) <= 450);
}
// Lyric lines without [Section] tags, blank lines or performance notes.
export function srv2LyricLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\[.*\]$/.test(l) && !/^\(.*\)$/.test(l))
    .map((l) => srv2StripEmoji(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
}
// The hook: the package's hook field, else the first line of the first [Chorus], else the first lyric line.
export function srv2HookLine(pkg) {
  if (pkg && pkg.hook && String(pkg.hook).trim()) return srv2StripEmoji(pkg.hook).trim();
  const txt = String((pkg && pkg.lyrics) || '');
  const m = txt.match(/\[(?:pre-)?chorus[^\]]*\]\s*\r?\n([^\n\[]+)/i);
  if (m && m[1].trim()) return srv2StripEmoji(m[1]).trim();
  return srv2LyricLines(txt)[0] || '';
}
function cleanCaption(s) {
  let t = srv2StripEmoji(s).replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[<>]/g, '').replace(/[ \t]+/g, ' ');
  t = t.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ').trim();
  if (t.length > 420) { const cut = t.slice(0, 420); const dot = cut.lastIndexOf('. '); t = (dot > 160 ? cut.slice(0, dot + 1) : cut.trim() + '…'); }
  return t;
}
export const SRV2_AI_DISCLOSURE = 'Music, vocals and visuals in this video are AI-generated and edited by SRV Studio.';
export function srv2Description(kind, pkg, { moodKey = 'emotional' } = {}) {
  const T = srv2CleanTitle(pkg && pkg.title) || 'Untitled';
  const mood = MOOD_WORD[moodKey] || 'Melancholic';
  const parts = [`${T} — ${mood.toLowerCase()}, emotional deep house for the night drive, from SRV Studio.`];
  const cap = cleanCaption((pkg && (pkg.captionYT || pkg.captionYouTube)) || '');
  if (cap) parts.push(cap);
  if (kind === 'long') {
    const ly = srv2LyricLines(pkg && pkg.lyrics);
    if (ly.length) parts.push('Lyrics\n' + ly.join('\n'));
    parts.push('Subscribe to SRV Studio for more emotional deep house and night-drive music.');
  } else {
    parts.push('Full song on the SRV Studio channel.');
  }
  parts.push(SRV2_AI_DISCLOSURE);
  parts.push(srv2Hashtags(kind, moodKey).join(' '));
  return parts.join('\n\n').replace(/[<>]/g, '').slice(0, 5000);
}
// The exact body the V2 publish step sends to youtube_upload_video (also shown at Approve as the dry run).
export function srv2YouTubeMetadata(kind, pkg, { test = false, moodKey, publishAt = null } = {}) {
  const mk = moodKey || srv2MoodKey(pkg && (pkg.mood || pkg.mode));
  return {
    title: srv2YouTubeTitle(kind, pkg && pkg.title, { test }),
    description: srv2Description(kind, pkg, { moodKey: mk }),
    tags: srv2Tags(kind, mk, pkg && pkg.title),
    categoryId: '10',
    privacyStatus: 'private',
    madeForKids: false,
    publishAt: test ? null : (publishAt || null),
    containsSyntheticMedia: true,
  };
}

// ═══ Audio analysis (pure) ═══════════════════════════════════════════════════
// Energy envelope (50 ms RMS windows) → chorus window (highest sustained energy, skipping intro/outro),
// vocal onset, and phrase breaks mapped to lyric lines. Falls back to even spacing.
export function srv2Envelope(ch, sr, winSec = 0.05, maxSec = 600) {
  const w = Math.max(1, Math.floor(sr * winSec)); const n = Math.min(ch.length, Math.floor(sr * maxSec));
  const env = []; for (let i = 0; i < n; i += w) { let s = 0; const e = Math.min(i + w, n); for (let j = i; j < e; j++) s += ch[j] * ch[j]; env.push(Math.sqrt(s / (e - i))); }
  return env;
}
export function srv2AnalyzeAudio(ch, sr, { lineCount = 0, windowSec = 30, fromStart = false } = {}) {
  const wSec = 0.05; const env = srv2Envelope(ch, sr, wSec); const dur = ch.length / sr;
  const even = (from, span) => Array.from({ length: lineCount }, (_, i) => from + i * (span / Math.max(1, lineCount)));
  const maxE = env.reduce((m, v) => Math.max(m, v), 0);
  if (!maxE) return { chorusStart: Math.min(15, dur / 3), vocalOnset: 0, lineTimings: even(0, windowSec), method: 'fallback-silent', duration: dur };
  const win = Math.round(windowSec / wSec);
  let chorusIdx = 0;
  if (!fromStart) {
    const skipA = Math.round(15 / wSec), skipB = Math.max(skipA + 1, env.length - win - Math.round(20 / wSec));
    let best = -1; for (let i = skipA; i < skipB; i += 10) { let s = 0; const e = Math.min(i + win, env.length); for (let j = i; j < e; j++) s += env[j]; const a = s / Math.max(1, e - i); if (a > best) { best = a; chorusIdx = i; } }
    if (best < 0) chorusIdx = Math.min(env.length - 1, skipA);
  }
  const seg = env.slice(chorusIdx, Math.min(env.length, chorusIdx + win));
  const segMax = seg.reduce((m, v) => Math.max(m, v), 0) || maxE;
  const onI = seg.findIndex((v) => v > segMax * 0.2);
  const onset = onI >= 0 ? Math.max(0, onI * wSec - 0.2) : 0;
  const sm = seg.map((v, i) => ((seg[i - 1] ?? v) + v + (seg[i + 1] ?? v)) / 3);
  const breaks = []; let dip = -1;
  for (let i = 0; i < sm.length; i++) {
    if (sm[i] < segMax * 0.32 && dip < 0) dip = i * wSec;
    else if (sm[i] >= segMax * 0.32 && dip >= 0) { breaks.push((dip + i * wSec) / 2); dip = -1; }
  }
  const valid = []; for (const b of breaks) if (b >= onset + 0.3 && (!valid.length || b - valid[valid.length - 1] >= 1.2)) valid.push(b);
  let timings = [onset]; let method = 'phrase-breaks';
  const need = lineCount - 1;
  if (lineCount <= 0) timings = [];
  else if (valid.length >= need) {
    // lines are sung in order, so line k starts at the k-th phrase break
    for (let k = 0; k < need; k++) timings.push(Math.max(timings[k] + 0.8, valid[k]));
  } else {
    method = valid.length ? 'phrase-breaks+even' : 'even-after-onset';
    timings = even(onset, windowSec - onset);
    valid.forEach((b, i) => { if (i + 1 < timings.length) timings[i + 1] = Math.max(timings[i] + 0.8, b); });
  }
  return { chorusStart: +(chorusIdx * wSec).toFixed(2), vocalOnset: +onset.toFixed(2), lineTimings: timings.map((t) => +t.toFixed(2)), method, duration: +dur.toFixed(2) };
}

// ═══ Deterministic PRNG ═════════════════════════════════════════════════════
export function srv2Rng(seed) {
  let h = 2166136261 >>> 0; for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return function () { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (p) => { p = clamp(p, 0, 1); return p * p * (3 - 2 * p); };
const fade = (t, a, b) => ease((t - a) / Math.max(1e-6, b - a)); // 0→1 between a and b
const win = (t, a, b, fi = 0.8, fo = 0.8) => Math.min(fade(t, a, a + fi), 1 - fade(t, b - fo, b)); // in-hold-out

// ═══ Long timeline (pure) ═══════════════════════════════════════════════════
// Framings are scale factors relative to the cover fit of the frame: wide = whole image, medium and close
// are centred on the face focus point with headroom. Absolute source enlargement at 1920x1080 is
// 1.15 (wide), 1.30 (medium), 1.45 (close); the slow push-in adds up to 6%.
export const SRV2_FRAMINGS = {
  wide:   { z: 1.0,   dy: 0.0,  pull: 0.25 },
  medium: { z: 1.13,  dy: 0.10, pull: 1.0 },
  close:  { z: 1.26,  dy: 0.06, pull: 1.0 },
};
export const SRV2_LONG_TIMING = { titleEnd: 8, outro: 10, shotMin: 20, shotMax: 28, xfade: 1.5, push: 0.06, drift: 0.025, hookSec: 6 };
export function srv2LongTimeline({ duration, chorusStart = null, hook = '', seed = 'srv2' }) {
  const T = SRV2_LONG_TIMING; const rnd = srv2Rng(seed);
  const shots = []; let t = 0; let prev = null;
  while (t < duration - 0.01) {
    let len = T.shotMin + rnd() * (T.shotMax - T.shotMin);
    if (duration - (t + len) < T.shotMin * 0.6) len = duration - t; // absorb a short tail into this shot
    let framing;
    if (!prev) framing = 'wide';
    else { const opts = Object.keys(SRV2_FRAMINGS).filter((f) => f !== prev); framing = opts[Math.floor(rnd() * opts.length)]; }
    shots.push({ start: +t.toFixed(3), end: +Math.min(duration, t + len).toFixed(3), framing, dir: shots.length % 2 ? -1 : 1 });
    prev = framing; t += len;
  }
  const hooks = [];
  if (hook && chorusStart != null && chorusStart > T.titleEnd + 1 && chorusStart + T.hookSec < duration - T.outro) hooks.push({ start: chorusStart, end: chorusStart + T.hookSec, text: hook });
  return { duration, titleEnd: T.titleEnd, outroStart: Math.max(T.titleEnd + 2, duration - T.outro), shots, hooks, xfade: T.xfade };
}
// Short lyric lines on a timeline: each line holds until the next line starts (min 1.8 s, max 7 s).
export const SRV2_MIN_LINE_SEC = 1.8;
export function srv2ShortTimeline({ duration, lines, lineTimings }) {
  const L = (lines || []).slice(0, 24);
  const raw = (lineTimings && lineTimings.length >= L.length) ? lineTimings.slice(0, L.length)
    : L.map((_, i) => (duration / Math.max(1, L.length)) * i);
  // every line stays readable: at least SRV2_MIN_LINE_SEC on screen before the next one
  const starts = []; raw.forEach((t, i) => starts.push(i ? Math.max(t, starts[i - 1] + SRV2_MIN_LINE_SEC) : t));
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const s = starts[i]; if (s >= duration - 1) break;
    const next = i + 1 < L.length ? starts[i + 1] : duration;
    const e = Math.min(duration - 0.2, Math.max(s + SRV2_MIN_LINE_SEC, Math.min(next, s + 7)));
    out.push({ start: +s.toFixed(2), end: +e.toFixed(2), text: L[i] });
  }
  return { duration, lines: out };
}

// ═══ Canvas environment ═════════════════════════════════════════════════════
let _createCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export function srv2SetCanvasFactory(fn) { _createCanvas = fn; }
const mk = (w, h) => _createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));

// ═══ Grade (luminance-only black and white) ═════════════════════════════════
// Rec.709 luminance → S-curve (+18% midtone contrast) → lifted blacks (1.5%) → soft highlight roll-off.
// Every output pixel is neutral (R = G = B), which also neutralises the warm split-tone on some masters.
export const SRV2_GRADE = { contrast: 0.36, lift: 0.015, gain: 0.975 };
const GRADE_LUT = (() => {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let y = i / 255; const s = y * y * (3 - 2 * y); y = y + (s - y) * SRV2_GRADE.contrast;
    y = SRV2_GRADE.lift + y * (SRV2_GRADE.gain - SRV2_GRADE.lift);
    lut[i] = Math.round(y * 255);
  }
  return lut;
})();
export function srv2GradePixels(data) {
  for (let i = 0; i < data.length; i += 4) {
    const v = GRADE_LUT[(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) | 0];
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return data;
}
// Prepares the graded source, a halation map (highlights only, quarter size) and a blurred backdrop.
export function srv2PrepareSource(img, crop) {
  const c = crop || { x: 0, y: 0, w: img.width, h: img.height };
  const g = mk(c.w, c.h); const gx = g.getContext('2d');
  gx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  const id = gx.getImageData(0, 0, c.w, c.h); srv2GradePixels(id.data); gx.putImageData(id, 0, 0);
  // halation: luminance above 70% → soft glow map at quarter size
  const qw = Math.round(c.w / 4), qh = Math.round(c.h / 4);
  const q = mk(qw, qh); const qx = q.getContext('2d'); qx.imageSmoothingQuality = 'high';
  qx.drawImage(g, 0, 0, qw, qh);
  const hd = qx.getImageData(0, 0, qw, qh); const d = hd.data;
  for (let i = 0; i < d.length; i += 4) { const y = d[i] / 255; const h = Math.pow(clamp((y - 0.7) / 0.3, 0, 1), 1.5) * 255; d[i] = d[i + 1] = d[i + 2] = h; d[i + 3] = 255; }
  qx.putImageData(hd, 0, 0);
  const halo = blurBy(q, 3);
  const blurred = blurBy(g, 24);
  return { graded: g, halo, blurred, w: c.w, h: c.h };
}
// Blur by down- then up-sampling (portable: no ctx.filter needed).
function blurBy(src, factor) {
  const w1 = Math.max(4, Math.round(src.width / factor)), h1 = Math.max(4, Math.round(src.height / factor));
  const a = mk(w1, h1); const ax = a.getContext('2d'); ax.imageSmoothingQuality = 'high'; ax.drawImage(src, 0, 0, w1, h1);
  const b = mk(Math.round(w1 / 2), Math.round(h1 / 2)); const bx = b.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(a, 0, 0, b.width, b.height);
  const out = mk(src.width / 2, src.height / 2); const ox = out.getContext('2d'); ox.imageSmoothingQuality = 'high';
  ox.drawImage(b, 0, 0, out.width, out.height);
  return out;
}
function makeVignette(W, H, strength = 0.55) {
  const v = mk(W, H); const x = v.getContext('2d');
  const g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.hypot(W, H) * 0.58);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
  x.fillStyle = g; x.fillRect(0, 0, W, H); return v;
}
function makeGrain(n = 4, size = 256, seed = 'grain') {
  const rnd = srv2Rng(seed); const tiles = [];
  for (let k = 0; k < n; k++) {
    const t = mk(size, size); const x = t.getContext('2d'); const id = x.createImageData(size, size); const d = id.data;
    for (let i = 0; i < d.length; i += 4) { const v = (rnd() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    x.putImageData(id, 0, 0); tiles.push(t);
  }
  return tiles;
}

// Source rect for a framing: scale s relative to the cover fit, centred on (cx, cy) in source-normalised
// coordinates and clamped inside the image.
export function srv2FrameRect(srcW, srcH, W, H, s, cx, cy) {
  const base = Math.max(W / srcW, H / srcH); const k = base * s;
  const w = W / k, h = H / k;
  const x = clamp(cx * srcW - w / 2, 0, srcW - w), y = clamp(cy * srcH - h / 2, 0, srcH - h);
  return { x, y, w, h, scale: k };
}
function shotRect(src, W, H, shot, t, focus) {
  const F = SRV2_FRAMINGS[shot.framing]; const T = SRV2_LONG_TIMING;
  const p = clamp((t - shot.start) / Math.max(1, shot.end - shot.start), -0.1, 1.1);
  const z = F.z * (1 + T.push * ease(p));
  const fx = 0.5 + (focus.fx - 0.5) * F.pull, fy = 0.5 + (focus.fy + F.dy - 0.5) * F.pull;
  const cx = fx + shot.dir * T.drift * (p - 0.5);
  return srv2FrameRect(src.w, src.h, W, H, z, cx, fy);
}
function drawGradedRect(ctx, src, r, dx, dy, dw, dh, haloAlpha) {
  ctx.drawImage(src.graded, r.x, r.y, r.w, r.h, dx, dy, dw, dh);
  if (haloAlpha > 0) {
    const sx = src.halo.width / src.w, sy = src.halo.height / src.h;
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = haloAlpha;
    ctx.drawImage(src.halo, r.x * sx, r.y * sy, r.w * sx, r.h * sy, dx, dy, dw, dh); ctx.restore();
  }
}
function drawGrain(ctx, scene, W, H, frame, alpha) {
  const tile = scene.grain[frame % scene.grain.length];
  const pat = ctx.createPattern(tile, 'repeat'); if (!pat) return;
  const r = srv2Rng('g' + frame); const ox = (r() * 256) | 0, oy = (r() * 256) | 0;
  ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'overlay';
  ctx.translate(-ox, -oy); ctx.fillStyle = pat; ctx.fillRect(0, 0, W + 256, H + 256); ctx.restore();
}
function spaced(ctx, text, x, y, spacing) {
  let w = 0; for (const ch of text) w += ctx.measureText(ch).width + spacing; w -= spacing;
  let cx = ctx.textAlign === 'center' ? x - w / 2 : ctx.textAlign === 'right' ? x - w : x;
  const al = ctx.textAlign; ctx.textAlign = 'left';
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
  ctx.textAlign = al; return w;
}
function wrap(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
// Wordmark (or the configured logo) — returns its box.
function drawBrand(ctx, scene, x, y, size, align, alpha) {
  ctx.save(); ctx.globalAlpha *= alpha;
  if (scene.logo) {
    const h = size * 1.6, w = h * (scene.logo.width / scene.logo.height);
    const lx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.drawImage(scene.logo, lx, y - h * 0.8, w, h); ctx.restore(); return { x: lx, y: y - h * 0.8, w, h };
  }
  ctx.fillStyle = SRV2_BRAND.ink; ctx.font = `600 ${size}px ${SRV2_FONTS.sans}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  const w = spaced(ctx, SRV2_BRAND.word, x, y, size * 0.42);
  const lx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.globalAlpha *= 0.55; ctx.fillRect(align === 'center' ? x - size : lx, y + size * 0.55, size * 2, Math.max(1, size * 0.07));
  ctx.restore(); return { x: lx, y: y - size, w, h: size * 1.7 };
}

// ═══ Scene ══════════════════════════════════════════════════════════════════
// opts: { kind:'long'|'short', img, avatar, title, hook, lines (short), timeline, logo, reactive }
export function srv2CreateScene(opts) {
  const kind = opts.kind === 'short' ? 'short' : 'long';
  const cfg = SRV2_RENDER_CONFIG[kind]; const W = cfg.W, H = cfg.H;
  const avatar = opts.avatar || {}; const crop = avatar.crop || { x: 0, y: 0, w: opts.img.width, h: opts.img.height };
  const focus = avatar.focus || { fx: 0.5, fy: 0.4 };
  const src = opts.prepared || srv2PrepareSource(opts.img, crop);
  return {
    kind, W, H, src, focus, logo: opts.logo || null, reactive: opts.reactive !== false,
    title: srv2CleanTitle(opts.title), hook: opts.hook || '', timeline: opts.timeline,
    vignette: makeVignette(W, H, kind === 'short' ? 0.5 : 0.55), grain: makeGrain(4, 256, 'grain-' + kind),
    textSide: focus.fx >= 0.5 ? 'left' : 'right',
    stats: { maxUpscale: 0 },
  };
}
// Draws one frame at time t (seconds). level = bass energy 0..1 from the analyser (0 when not reactive).
export function srv2DrawFrame(ctx, scene, t, level = 0, frame = 0) {
  return scene.kind === 'short' ? drawShort(ctx, scene, t, level, frame) : drawLong(ctx, scene, t, level, frame);
}

function drawLong(ctx, s, t, level, frame) {
  const { W, H, src, timeline: tl } = s; const lv = s.reactive ? level : 0;
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
  // shots + cross-dissolves
  const halo = 0.10 + 0.22 * lv; const hx = tl.xfade / 2;
  let i = tl.shots.findIndex((sh) => t < sh.end); if (i < 0) i = tl.shots.length - 1;
  const cur = tl.shots[i]; const next = tl.shots[i + 1]; const prev = tl.shots[i - 1];
  const r = shotRect(src, W, H, cur, t, s.focus); s.stats.maxUpscale = Math.max(s.stats.maxUpscale, r.scale);
  drawGradedRect(ctx, src, r, 0, 0, W, H, halo);
  if (prev && t < cur.start + hx) { // finish dissolving in from the previous shot
    ctx.save(); ctx.globalAlpha = 1 - fade(t, cur.start - hx, cur.start + hx);
    drawGradedRect(ctx, src, shotRect(src, W, H, prev, t, s.focus), 0, 0, W, H, halo); ctx.restore();
  }
  if (next && t > cur.end - hx) {
    ctx.save(); ctx.globalAlpha = fade(t, next.start - hx, next.start + hx);
    drawGradedRect(ctx, src, shotRect(src, W, H, next, t, s.focus), 0, 0, W, H, halo); ctx.restore();
  }
  ctx.drawImage(s.vignette, 0, 0);
  drawGrain(ctx, s, W, H, frame, 0.055);
  // title card (0–8 s) and outro card
  const titleA = Math.min(fade(t, 1.2, 2.6), 1 - fade(t, 6.6, tl.titleEnd));
  const outroA = fade(t, tl.outroStart + 1, tl.outroStart + 2.6);
  const cardA = Math.max(titleA, outroA);
  if (cardA > 0) drawTitleCard(ctx, s, cardA, t < tl.titleEnd ? (1 - fade(t, 1.2, 2.6)) * 24 : 0);
  if (outroA > 0) {
    ctx.save(); ctx.globalAlpha = fade(t, tl.outroStart + 2.5, tl.outroStart + 3.8);
    ctx.fillStyle = 'rgba(240,240,240,0.82)'; ctx.font = `500 ${Math.round(H * 0.026)}px ${SRV2_FONTS.sans}`;
    ctx.textAlign = s.textSide === 'left' ? 'left' : 'right';
    ctx.fillText('Subscribe for more SRV Studio', s.textSide === 'left' ? W * 0.07 : W * 0.93, H * 0.80); ctx.restore();
  }
  // quiet lower third between the cards
  const lowA = 0.6 * Math.min(fade(t, tl.titleEnd + 1, tl.titleEnd + 2.5), 1 - fade(t, tl.outroStart - 0.5, tl.outroStart + 1));
  if (lowA > 0) {
    ctx.save(); ctx.globalAlpha = lowA; ctx.textAlign = 'left'; ctx.fillStyle = SRV2_BRAND.ink;
    ctx.font = `600 ${Math.round(H * 0.026)}px ${SRV2_FONTS.display}`; ctx.fillText(s.title, W * 0.045, H * 0.915);
    ctx.restore(); drawBrand(ctx, s, W * 0.045, H * 0.952, Math.round(H * 0.014), 'left', lowA);
  }
  // hook at the chorus
  for (const hk of tl.hooks) {
    const a = win(t, hk.start, hk.end, 0.8, 0.8); if (a <= 0) continue;
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.fillStyle = SRV2_BRAND.ink;
    const fs = Math.round(H * 0.052); ctx.font = `italic 500 ${fs}px ${SRV2_FONTS.display}`;
    ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 24;
    const lines = wrap(ctx, hk.text, W * 0.62).slice(0, 2);
    lines.forEach((l, k) => ctx.fillText(l, W / 2, H * 0.80 + (k - (lines.length - 1)) * fs * 1.2 + (1 - a) * 12));
    ctx.restore();
  }
  // fade from black at the start, to black at the end
  const black = Math.max(1 - fade(t, 0, 1.5), fade(t, tl.duration - 1.5, tl.duration));
  if (black > 0) { ctx.globalAlpha = black; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}
function drawTitleCard(ctx, s, a, slide) {
  const { W, H } = s; const left = s.textSide === 'left';
  ctx.save();
  const g = ctx.createLinearGradient(left ? 0 : W, 0, left ? W * 0.62 : W * 0.38, 0);
  g.addColorStop(0, `rgba(5,5,5,${0.78 * a})`); g.addColorStop(1, 'rgba(5,5,5,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const x = left ? W * 0.07 : W * 0.93; const align = left ? 'left' : 'right';
  drawBrand(ctx, s, x, H * 0.13, Math.round(H * 0.022), align, a);
  ctx.globalAlpha = a; ctx.fillStyle = SRV2_BRAND.ink; ctx.textAlign = align;
  let fs = Math.round(H * 0.092); ctx.font = `700 ${fs}px ${SRV2_FONTS.display}`;
  let lines = wrap(ctx, s.title, W * 0.40);
  if (lines.length > 3) { fs = Math.round(fs * 0.78); ctx.font = `700 ${fs}px ${SRV2_FONTS.display}`; lines = wrap(ctx, s.title, W * 0.40).slice(0, 3); }
  const y0 = H * 0.5 - (lines.length - 1) * fs * 0.55 + slide;
  lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * fs * 1.08));
  ctx.fillStyle = 'rgba(240,240,240,0.72)'; ctx.font = `500 ${Math.round(H * 0.028)}px ${SRV2_FONTS.sans}`;
  ctx.fillText(SRV2_BRAND.genre, x, y0 + lines.length * fs * 1.08 + H * 0.02);
  ctx.restore();
}

// Short layout (1080x1920). All text sits outside the Shorts safe zones (top 220, bottom 480, right 140).
export const SRV2_SHORT_LAYOUT = {
  brandY: 262, brandSize: 26, titleY: 330, titleSize: 50, genreY: 372, genreSize: 26,
  card: { x: 110, y: 410, size: 860 }, lyricY: 1340, lyricSize: 50, lyricLine: 62, lyricMaxW: 780, lyricMaxLines: 2,
  centerX: 540, textMaxW: 800,
};
function drawShort(ctx, s, t, level, frame) {
  const { W, H, src } = s; const L = SRV2_SHORT_LAYOUT; const lv = s.reactive ? level : 0; const dur = s.timeline.duration;
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
  // blurred backdrop, slow zoom
  const bz = 1.08 + 0.04 * (t / Math.max(1, dur));
  const br = srv2FrameRect(src.blurred.width, src.blurred.height, W, H, bz, s.focus.fx, s.focus.fy + 0.05);
  ctx.drawImage(src.blurred, br.x, br.y, br.w, br.h, 0, 0, W, H);
  ctx.fillStyle = 'rgba(5,5,5,0.56)'; ctx.fillRect(0, 0, W, H);
  // face card: square around the face, push-in 1.00→1.06 over the Short
  const side = Math.min(src.w, src.h); const p = t / Math.max(1, dur); const z = 1 + SRV2_LONG_TIMING.push * ease(p);
  const sw = side / z; const sx = clamp(s.focus.fx * src.w - sw / 2 + (p - 0.5) * sw * 0.02, 0, src.w - sw);
  const sy = clamp((s.focus.fy + 0.12) * src.h - sw / 2, 0, src.h - sw);
  const C = L.card; s.stats.maxUpscale = Math.max(s.stats.maxUpscale, C.size / sw);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 40; ctx.fillStyle = '#000'; ctx.fillRect(C.x, C.y, C.size, C.size); ctx.restore();
  drawGradedRect(ctx, src, { x: sx, y: sy, w: sw, h: sw }, C.x, C.y, C.size, C.size, 0.10 + 0.22 * lv);
  ctx.strokeStyle = 'rgba(240,240,240,0.10)'; ctx.lineWidth = 2; ctx.strokeRect(C.x + 1, C.y + 1, C.size - 2, C.size - 2);
  ctx.drawImage(s.vignette, 0, 0);
  drawGrain(ctx, s, W, H, frame, 0.05);
  // header: wordmark, title, genre
  drawBrand(ctx, s, L.centerX, L.brandY, L.brandSize, 'center', 1);
  ctx.textAlign = 'center'; ctx.fillStyle = SRV2_BRAND.ink;
  let ts = L.titleSize; ctx.font = `700 ${ts}px ${SRV2_FONTS.display}`;
  while (ctx.measureText(s.title).width > L.textMaxW && ts > 30) { ts -= 2; ctx.font = `700 ${ts}px ${SRV2_FONTS.display}`; }
  ctx.fillText(s.title, L.centerX, L.titleY);
  ctx.fillStyle = 'rgba(240,240,240,0.62)'; ctx.font = `500 ${L.genreSize}px ${SRV2_FONTS.sans}`;
  ctx.fillText(SRV2_BRAND.genre, L.centerX, L.genreY);
  // current lyric line: fades and lifts in
  const ln = s.timeline.lines.find((x) => t >= x.start - 0.05 && t < x.end);
  if (ln) {
    const a = win(t, ln.start, ln.end, 0.45, 0.35);
    let fs = L.lyricSize; ctx.font = `italic 500 ${fs}px ${SRV2_FONTS.display}`;
    let lines = wrap(ctx, ln.text, L.lyricMaxW);
    while (lines.length > L.lyricMaxLines && fs > 34) { fs -= 4; ctx.font = `italic 500 ${fs}px ${SRV2_FONTS.display}`; lines = wrap(ctx, ln.text, L.lyricMaxW); }
    lines = lines.slice(0, L.lyricMaxLines);
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = SRV2_BRAND.ink; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 18;
    const lift = (1 - fade(t, ln.start, ln.start + 0.45)) * 18;
    lines.forEach((l, k) => ctx.fillText(l, L.centerX, L.lyricY + k * L.lyricLine + lift));
    ctx.restore();
  }
  const black = Math.max(1 - fade(t, 0, 0.6), fade(t, dur - 0.8, dur));
  if (black > 0) { ctx.globalAlpha = black; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}
// Text boxes of the Short layout (for the safe-zone check).
export function srv2ShortTextBoxes() {
  const L = SRV2_SHORT_LAYOUT; const half = L.textMaxW / 2;
  return [
    { name: 'brand', x: L.centerX - half, y: L.brandY - L.brandSize, w: L.textMaxW, h: L.brandSize * 1.7 },
    { name: 'title', x: L.centerX - half, y: L.titleY - L.titleSize, w: L.textMaxW, h: L.titleSize * 1.25 },
    { name: 'genre', x: L.centerX - half, y: L.genreY - L.genreSize, w: L.textMaxW, h: L.genreSize * 1.3 },
    { name: 'lyrics', x: L.centerX - L.lyricMaxW / 2, y: L.lyricY - L.lyricSize, w: L.lyricMaxW, h: L.lyricLine * (L.lyricMaxLines - 1) + L.lyricSize * 1.3 + 18 },
  ];
}

// ═══ Thumbnail (1280x720) and covers ════════════════════════════════════════
// Face-aware: the face is placed on its own side (about 64% or 36% of the width), the clean title on the
// other side over a soft gradient. Source is downscaled (never enlarged) at 1280x720.
export function srv2PaintThumbnail(ctx, prepared, avatar, { title, W = 1280, H = 720, logo = null } = {}) {
  const focus = (avatar && avatar.focus) || { fx: 0.5, fy: 0.4 };
  const left = focus.fx >= 0.5; // face right of centre → title on the left
  const z = 1.22; const base = Math.max(W / prepared.w, H / prepared.h); const k = base * z;
  const sw = W / k, sh = H / k; const target = left ? 0.64 : 0.36;
  const sx = clamp(focus.fx * prepared.w - target * sw, 0, prepared.w - sw);
  const sy = clamp((focus.fy + 0.08) * prepared.h - sh * 0.42, 0, prepared.h - sh);
  ctx.save(); ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
  drawGradedRect(ctx, prepared, { x: sx, y: sy, w: sw, h: sh }, 0, 0, W, H, 0.14);
  const g = ctx.createLinearGradient(left ? 0 : W, 0, left ? W * 0.66 : W * 0.34, 0);
  g.addColorStop(0, 'rgba(5,5,5,0.86)'); g.addColorStop(0.55, 'rgba(5,5,5,0.45)'); g.addColorStop(1, 'rgba(5,5,5,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(makeVignette(W, H, 0.5), 0, 0);
  const s = { logo, grain: makeGrain(1, 256, 'thumb') }; drawGrain(ctx, s, W, H, 0, 0.04);
  const x = left ? W * 0.065 : W * 0.935; const align = left ? 'left' : 'right';
  drawBrand(ctx, s, x, H * 0.135, Math.round(H * 0.027), align, 1);
  const T = srv2CleanTitle(title) || 'Untitled';
  ctx.fillStyle = SRV2_BRAND.ink; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  let fs = Math.round(H * 0.112); ctx.font = `700 ${fs}px ${SRV2_FONTS.display}`;
  let lines = wrap(ctx, T, W * 0.42);
  while (lines.length > 3 && fs > 40) { fs -= 6; ctx.font = `700 ${fs}px ${SRV2_FONTS.display}`; lines = wrap(ctx, T, W * 0.42); }
  lines = lines.slice(0, 3);
  const y0 = H * 0.53 - (lines.length - 1) * fs * 0.54;
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 16;
  lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * fs * 1.06));
  ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(240,240,240,0.74)'; ctx.font = `500 ${Math.round(H * 0.032)}px ${SRV2_FONTS.sans}`;
  ctx.fillText(SRV2_BRAND.genre, x, y0 + lines.length * fs * 1.06 + H * 0.025);
  ctx.restore();
  return { layout: left ? 'title-left' : 'title-right', sourceScale: +k.toFixed(3), sourcePx: `${Math.round(sw)}×${Math.round(sh)}`, lines: lines.length };
}

// ═══ Frame-drop monitor (pure) ══════════════════════════════════════════════
export class Srv2FrameMonitor {
  constructor(fps) { this.fps = fps; this.interval = 1 / fps; this.last = null; this.drawn = 0; this.dropped = 0; this.maxGap = 0; this.paintMs = []; }
  tick(nowSec, paintMs) {
    if (this.last != null) {
      const gap = nowSec - this.last; this.maxGap = Math.max(this.maxGap, gap);
      if (gap > this.interval * 1.5) this.dropped += Math.max(0, Math.round(gap / this.interval) - 1);
    }
    this.last = nowSec; this.drawn++; if (paintMs != null) this.paintMs.push(paintMs);
  }
  summary(durationSec) {
    const expected = Math.round(durationSec * this.fps);
    const missing = Math.max(this.dropped, expected - this.drawn);
    const pct = expected ? +((missing / expected) * 100).toFixed(2) : 0;
    const pm = this.paintMs.slice().sort((a, b) => a - b);
    const p = (q) => (pm.length ? +pm[Math.min(pm.length - 1, Math.floor(q * pm.length))].toFixed(2) : null);
    return { expected, drawn: this.drawn, dropped: missing, droppedPct: pct, maxGapMs: +(this.maxGap * 1000).toFixed(1),
      paintMsP50: p(0.5), paintMsP95: p(0.95), warn: pct > SRV2_RENDER_CONFIG.dropWarnPct };
  }
}
// Bass level 0..1 from analyser bins (≈ 30–150 Hz), with adaptive normalisation and attack/release.
export function srv2BassFollower() {
  let env = 0, peak = 0.25;
  return function (bins, binHz) {
    const a = Math.max(1, Math.floor(30 / binHz)), b = Math.max(a + 1, Math.ceil(150 / binHz));
    let s = 0; for (let i = a; i < b && i < bins.length; i++) s += bins[i]; const v = s / Math.max(1, b - a) / 255;
    peak = Math.max(v, peak * 0.999); const n = clamp(v / Math.max(0.05, peak), 0, 1);
    const x = n * n; env = x > env ? env + (x - env) * 0.5 : env + (x - env) * 0.08; return env;
  };
}

// ═══ Browser: fonts, images, recording ══════════════════════════════════════
const MODULE_BASE = (() => { try { return new URL('.', import.meta.url).href; } catch (_) { return '/srv-studio-v2/'; } })();
let _fontsP = null;
export function srv2LoadFonts() {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  if (!_fontsP) _fontsP = Promise.all(SRV2_FONT_FILES.map(async (f) => {
    const ff = new FontFace(f.family, `url(${MODULE_BASE}fonts/${f.file})`, { weight: f.weight, style: 'normal' });
    await ff.load(); document.fonts.add(ff);
  })).then(() => true).catch(() => false);
  return _fontsP;
}
export function srv2LoadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
    im.onload = () => resolve(im); im.onerror = () => reject(new Error('Image could not be loaded: ' + url)); im.src = url;
  });
}
function canvasToBlob(c, type, q) { return new Promise((res) => c.toBlob((b) => res(b), type, q)); }
// A timer in a worker keeps ticking when the tab is in the background (main-thread timers are throttled).
function makeTicker(fps, onTick) {
  let w = null, id = null; const ms = 1000 / fps;
  try {
    const code = `let t=null,n=0,s=0;onmessage=e=>{if(e.data==='stop'){clearTimeout(t);return;}s=performance.now();n=0;const k=()=>{n++;postMessage(0);t=setTimeout(k,Math.max(0,s+n*${ms}-performance.now()));};k();};`;
    w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    w.onmessage = onTick; w.postMessage('start');
    return () => { w.postMessage('stop'); w.terminate(); };
  } catch (_) {
    const s = performance.now(); let n = 0; const k = () => { n++; onTick(); id = setTimeout(k, Math.max(0, s + n * ms - performance.now())); }; k();
    return () => clearTimeout(id);
  }
}
async function readAudio(input) {
  if (input instanceof ArrayBuffer) return input;
  if (input && typeof input.arrayBuffer === 'function') return input.arrayBuffer();
  if (typeof input === 'string') { const r = await fetch(input); if (!r.ok) throw new Error('Audio could not be loaded'); return r.arrayBuffer(); }
  throw new Error('No audio');
}

export function srv2AvatarProductionReady(a) {
  return !!a && !a.archived && a.collection === 'final' && !!(a.quality && a.quality.hdReady === true);
}

// Renders a Long or a Short in real time and returns the video, the thumbnail and measurements.
// opts: { kind, audio (File|Blob|ArrayBuffer|url), avatar, imageUrl, title, lyrics, shortLyrics, hook,
//         maxDuration, logoUrl, reactive, onProgress(msg, fraction), canvas (optional, for a live preview) }
export async function srv2RenderVideo(opts) {
  const kind = opts.kind === 'short' ? 'short' : 'long'; const cfg = SRV2_RENDER_CONFIG[kind];
  const say = (m, f) => { try { opts.onProgress && opts.onProgress(m, f); } catch (_) {} };
  // D4 (F-1): only final masters may enter production video (archived concept crops are refused here too).
  if (!srv2AvatarProductionReady(opts.avatar)) throw new Error('Only a final-master avatar can be used for production video (archived or unknown avatar refused)');
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video (MediaRecorder missing)');
  const mime = srv2PickMime((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('This browser supports neither MP4 (H.264) nor WebM recording');
  const info = srv2MimeInfo(mime);
  say('Loading fonts, avatar and audio…', 0);
  const [fontsOk, img, ab, logo] = await Promise.all([
    srv2LoadFonts(), srv2LoadImage(opts.imageUrl || opts.avatar.src), readAudio(opts.audio),
    (opts.logoUrl || SRV2_BRAND.logoUrl) ? srv2LoadImage(opts.logoUrl || SRV2_BRAND.logoUrl).catch(() => null) : Promise.resolve(null),
  ]);
  const actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  const buf = await actx.decodeAudioData(ab.slice(0));
  const ch = buf.getChannelData(0);
  const lines = srv2LyricLines(kind === 'short' ? (opts.shortLyrics || opts.lyrics) : '');
  const duration = Math.min(buf.duration, kind === 'short' ? (opts.maxDuration || cfg.targetSec) : (opts.maxDuration || cfg.maxSec), cfg.maxSec);
  const analysis = kind === 'short'
    ? srv2AnalyzeAudio(ch, buf.sampleRate, { lineCount: lines.length, windowSec: duration, fromStart: true })
    : srv2AnalyzeAudio(ch, buf.sampleRate, { lineCount: 0, windowSec: 30 });
  const timeline = kind === 'short'
    ? srv2ShortTimeline({ duration, lines, lineTimings: analysis.lineTimings })
    : srv2LongTimeline({ duration, chorusStart: analysis.chorusStart + analysis.vocalOnset, hook: opts.hook || '', seed: (opts.avatar && opts.avatar.id) + '|' + opts.title });
  say('Preparing the black-and-white grade…', 0);
  const prepared = srv2PrepareSource(img, opts.avatar && opts.avatar.crop);
  const scene = srv2CreateScene({ kind, img, avatar: opts.avatar, title: opts.title, hook: opts.hook, timeline, logo, reactive: opts.reactive, prepared });

  const canvas = opts.canvas || mk(cfg.W, cfg.H); canvas.width = cfg.W; canvas.height = cfg.H;
  const ctx = canvas.getContext('2d', { alpha: false });
  srv2DrawFrame(ctx, scene, 0, 0, 0);

  // thumbnail now (independent of the recording)
  const th = SRV2_RENDER_CONFIG.thumb; const tc = mk(th.W, th.H);
  const thumbInfo = srv2PaintThumbnail(tc.getContext('2d'), prepared, opts.avatar, { title: opts.title, W: th.W, H: th.H, logo });
  const thumbBlob = await canvasToBlob(tc, th.type, th.quality);

  // captureStream(0) + requestFrame(): every painted frame becomes exactly one video frame (captureStream(fps)
  // samples the canvas on its own clock and silently skips frames when paints jitter).
  let stream = canvas.captureStream(0); let vtrack = stream.getVideoTracks()[0];
  if (!vtrack || typeof vtrack.requestFrame !== 'function') { stream = canvas.captureStream(cfg.fps); vtrack = null; }
  const src = actx.createBufferSource(); src.buffer = buf;
  const gain = actx.createGain(); const an = actx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.6;
  const dest = actx.createMediaStreamDestination();
  src.connect(gain); gain.connect(dest); gain.connect(an);
  const tracks = stream.getVideoTracks().concat(dest.stream.getAudioTracks());
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: cfg.videoBitsPerSecond, audioBitsPerSecond: cfg.audioBitsPerSecond });
  const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  const bins = new Uint8Array(an.frequencyBinCount); const binHz = actx.sampleRate / an.fftSize; const bass = srv2BassFollower();
  const mon = new Srv2FrameMonitor(cfg.fps); let hidden = 0;
  const onVis = () => { if (document.hidden) hidden++; }; document.addEventListener('visibilitychange', onVis);

  await actx.resume();
  // Wait for the audio clock to actually run (it can stall after resume), so the video has no black lead-in.
  for (let c0 = actx.currentTime, i = 0; actx.currentTime === c0 && i < 300; i++) await new Promise((r) => setTimeout(r, 10));
  const t0 = actx.currentTime + 0.1; const fadeSec = kind === 'short' ? 1.5 : 3;
  gain.gain.setValueAtTime(1, t0 + Math.max(0, duration - fadeSec)); gain.gain.linearRampToValueAtTime(0, t0 + duration);
  rec.start(1000); src.start(t0, 0, duration);
  const started = performance.now(); let frame = 0; let lastSay = -1;
  await new Promise((resolve) => {
    const stop = makeTicker(cfg.fps, () => {
      const t = actx.currentTime - t0;
      if (t >= duration) { stop(); resolve(); return; }
      an.getByteFrequencyData(bins); const lv = bass(bins, binHz);
      const p0 = performance.now(); srv2DrawFrame(ctx, scene, Math.max(0, t), lv, frame++); if (vtrack) vtrack.requestFrame(); mon.tick(performance.now() / 1000, performance.now() - p0);
      const sec = Math.floor(t); if (sec !== lastSay && sec % 2 === 0) { lastSay = sec; say(`Rendering ${kind.toUpperCase()} ${cfg.W}×${cfg.H} · ${Math.max(0, sec)}s / ${Math.round(duration)}s — keep this tab open`, Math.max(0, t) / duration); }
    });
  });
  srv2DrawFrame(ctx, scene, duration, 0, frame++); if (vtrack) vtrack.requestFrame();
  await new Promise((r) => setTimeout(r, 300));
  rec.stop(); try { src.stop(); } catch (_) {} await stopped;
  document.removeEventListener('visibilitychange', onVis);
  try { await actx.close(); } catch (_) {}
  stream.getTracks().forEach((tr) => tr.stop());
  const blob = new Blob(chunks, { type: info.type });
  const m = mon.summary(duration);
  const stats = {
    version: SRV2_RENDER_VERSION, kind, mime, container: info.container, videoCodec: info.video, audioCodec: info.audio,
    width: cfg.W, height: cfg.H, fps: cfg.fps, videoBitsPerSecondTarget: cfg.videoBitsPerSecond, audioBitsPerSecondTarget: cfg.audioBitsPerSecond,
    durationSec: +duration.toFixed(2), audioDurationSec: +buf.duration.toFixed(2), sizeBytes: blob.size,
    measuredKbps: Math.round((blob.size * 8) / duration / 1000), renderSec: +((performance.now() - started) / 1000).toFixed(1),
    captureMode: vtrack ? 'requestFrame' : 'captureStream(fps)', frames: m, hiddenDuringRender: hidden > 0, fontsLoaded: !!fontsOk, maxSourceUpscale: +scene.stats.maxUpscale.toFixed(2),
    analysis, hooks: timeline.hooks || [], lyricLines: (timeline.lines || []).length,
    avatarId: opts.avatar && opts.avatar.id, logo: !!logo,
    thumb: Object.assign({ width: th.W, height: th.H, type: th.type, bytes: thumbBlob ? thumbBlob.size : 0 }, thumbInfo),
  };
  return { blob, mime, ext: info.ext, stats, thumbBlob };
}
