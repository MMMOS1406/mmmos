// SRV Farsi Mix — audio analysis and the real-time render (CEO order 2026-11-12, preview only; no upload here, no network except the songs' own audio URLs).
// The AUDIO engine is the one already proven for the SRV Studio Monthly Mix, reused unchanged and read-only (public/srv-studio-v2/lib): edge trimming (lead silence / built-in fade),
// −14 LUFS normalisation, equal-power crossfades, a true-peak limiter (−2.5 dBTP before the AAC/Opus encode) and ROLLING decoding (at most two songs in memory). Source songs are decoded
// for reading only; their files and records are never modified and nothing is regenerated. The VIDEO is the Farsi scene (scene.mjs) drawn in real time and recorded with MediaRecorder.
import * as A from '../srv-studio-v2/lib/srvStudioV2MixAudio.mjs';
import * as EM from '../srv-studio-v2/lib/srvStudioV2Mix.mjs';
import * as F from './lib/srvFarsiMix.mjs';
import { createMixScene, drawMixThumbnail } from './scene.mjs';

export const SRVF_RENDER_VERSION = 'srvf-mix-render-1';
export const SR = 48000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abortErr = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });
const chans = (b) => [b.getChannelData(0), b.getChannelData(Math.min(1, b.numberOfChannels - 1))];
async function decodeFrom(url, fetchImpl, signal) {
  const r = await fetchImpl(url, { signal }); if (!r.ok) throw new Error('could not load song audio (HTTP ' + r.status + ')');
  const ab = await r.arrayBuffer(); const ctx = new OfflineAudioContext(2, SR, SR); return ctx.decodeAudioData(ab);
}

// One song: edges (lead silence, tail silence, built-in fade) and the loudness gain of the part that is used.
export async function analyseSong(song, { fetchImpl = fetch, signal } = {}) {
  const buf = await decodeFrom(song.sourceUrl, fetchImpl, signal); const ch = chans(buf); const edges = A.srv2Edges(ch, SR, song.audioSource);
  const i0 = Math.round(edges.inSec * SR), i1 = Math.round(edges.outSec * SR); const lufs = EM.srv2Loudness(ch.map((c) => c.subarray(i0, i1)), SR).lufs; const g = A.srv2NormGain(lufs);
  return { pkgId: song.pkgId, audioSource: song.audioSource, edges, lufs, gainDb: g.gainDb, gain: g.gain, boostCapped: g.capped, sampleRate: buf.sampleRate, analysedAt: new Date().toISOString(), version: SRVF_RENDER_VERSION };
}
// The timeline the video AND the description both use: each song's length is what is actually used (after trimming).
export function timelineFrom(tracks, analysis) {
  return F.srvfMixTimeline(tracks.map((t) => ({ pkgId: t.pkgId, title: t.title, finglish: t.finglish, youtubeVideoId: t.youtubeVideoId, artist: t.artist, durationSec: analysis && analysis[t.pkgId] ? analysis[t.pkgId].edges.usedSec : t.durationSec })));
}
export function pickMime() { for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m; return null; }

export function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => rej(new Error('could not load image ' + String(src).slice(0, 80))); i.src = src; }); }
export async function loadFonts() { try { const txt = 'آهنگ فارسی دیدار تو ۱۲۳'; await Promise.all([700, 500, 800].map((w) => document.fonts.load(`${w} 28px 'Vazirmatn'`, txt)).concat([document.fonts.load("800 80px 'Lalezar'", 'SRV')])); return true; } catch { return false; } }

// mix: the saved Mix record (tracks with cover refs, title, background). covers: { [pkgId]: { src, focus } } resolved by the caller from the SRV Farsi cover libraries (never regenerated).
// previewSample: ONLY for the CEO preview's time-compressed demonstration (the 30-minute rule is skipped and the result is marked sample). Production callers never pass it.
export async function renderFarsiMix({ tracks, analysis, tl, mix, covers, bgCoverSrc = null, canvas, onProgress, signal, fetchImpl = fetch, videoBitsPerSecond = 6_000_000, fps = F.SRVF_MIX_CONFIG.fps, seed = 1, previewSample = false }) {
  const say = (m, f) => { try { onProgress && onProgress(m, f); } catch (_) {} };
  const v = F.srvfMixValidate(tl, { category: mix.category, mood: mix.mood, songs: tracks });
  if (!v.ok && !previewSample) throw new Error('This Mix cannot be built: ' + v.problems.join('; '));                // the 30-minute rule is enforced here too, not only in the form
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video'); const mime = pickMime(); if (!mime) throw new Error('No supported video format');
  const edges = tracks.map((t) => analysis[t.pkgId].edges), gains = tracks.map((t) => analysis[t.pkgId].gain);
  say('Loading fonts and images…', 0); await loadFonts();
  const images = { covers: {} }; for (let i = 0; i < tracks.length; i++) { const c = covers[tracks[i].pkgId]; images.covers[i] = { img: c ? await loadImage(c.src) : null, focus: c && c.focus }; }
  if (bgCoverSrc) images.bg = await loadImage(bgCoverSrc);
  const duration = tl.totalSec; const cfg = F.SRVF_MIX_CONFIG; canvas.width = cfg.width; canvas.height = cfg.height; const ctx = canvas.getContext('2d', { alpha: false });
  const scene = createMixScene({ W: cfg.width, H: cfg.height, mix: { titleLatin: mix.titleLatin || mix.title.split('|')[0].trim(), titleFa: mix.titleFa || (mix.title.split('|')[1] || '').trim(), tracks: tl.items, totalSec: duration }, background: mix.background, images, seed });
  const actx = new AudioContext({ sampleRate: SR }); const bus = actx.createGain(); const dest = actx.createMediaStreamDestination(); bus.connect(dest);
  const segs = A.srv2MixSegments(tl); const decoded = new Map(); const pending = new Map();
  const getSong = (i) => { if (decoded.has(i)) return Promise.resolve(decoded.get(i)); if (!pending.has(i)) pending.set(i, decodeFrom(tracks[i].sourceUrl, fetchImpl, signal).then((b) => { const c = chans(b); decoded.set(i, c); pending.delete(i); return c; })); return pending.get(i); };
  const lim = new A.Srv2Limiter(SR); let toDrop = lim.latency, outPos = 0; const live = new Set(); let t0 = 0, peakSongs = 0;
  const prepare = async (k) => { const src = []; for (const i of segs[k].needs) src[i] = await getSong(i); peakSongs = Math.max(peakSongs, decoded.size); const pcm = A.srv2MixSegmentPcm(k, tl, src, edges, gains, SR); for (const i of [...decoded.keys()]) if (i < k) decoded.delete(i); return lim.process(pcm); };
  const schedule = (pcm) => { let a = pcm; if (toDrop) { const d = Math.min(toDrop, a[0].length); a = a.map((c) => c.subarray(d)); toDrop -= d; } const n = a[0].length; if (!n) return; const b = actx.createBuffer(2, n, SR); b.copyToChannel(a[0], 0); b.copyToChannel(a[1], 1); const s = actx.createBufferSource(); s.buffer = b; s.connect(bus); s.start(t0 + outPos / SR); outPos += n; live.add(s); s.onended = () => { live.delete(s); s.disconnect(); }; };
  say('Preparing song 1…', 0); const first = await prepare(0); if (segs.length > 1) getSong(1).catch(() => {});
  let stream = canvas.captureStream(0); let vt = stream.getVideoTracks()[0]; if (!vt || typeof vt.requestFrame !== 'function') { stream = canvas.captureStream(fps); vt = null; }
  const rec = new MediaRecorder(new MediaStream(stream.getVideoTracks().concat(dest.stream.getAudioTracks())), { mimeType: mime, videoBitsPerSecond, audioBitsPerSecond: 192_000 });
  const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); }; const stopped = new Promise((r) => { rec.onstop = r; });
  await actx.resume(); for (let c0 = actx.currentTime, i = 0; actx.currentTime === c0 && i < 300; i++) await sleep(10);
  t0 = actx.currentTime + 0.4; schedule(first);
  let failure = null, finished = false; const waitPlaying = async (sec) => { while (!finished && !(signal && signal.aborted) && actx.currentTime < t0 + sec) await sleep(250); };
  const feeder = (async () => { try { for (let k = 1; k < segs.length; k++) { await waitPlaying(segs[k - 1].fromSec); if (finished || (signal && signal.aborted)) return; schedule(await prepare(k)); if (k + 1 < segs.length) getSong(k + 1).catch(() => {}); } } catch (e) { failure = e; } })();
  rec.start(1000); let frame = 0, slow = 0;
  try {
    await new Promise((resolve, reject) => {
      const step = () => {
        if (signal && signal.aborted) { reject(abortErr()); return; } if (failure) { reject(failure); return; }
        const t = actx.currentTime - t0; if (t >= duration + 0.2) { resolve(); return; }
        const p0 = performance.now(); scene.draw(ctx, Math.max(0, t)); if (vt) vt.requestFrame(); if (performance.now() - p0 > 1000 / fps) slow++;
        if (frame++ % 30 === 0) say(`Rendering ${F.srvfClock(Math.max(0, t))} / ${F.srvfClock(duration)}`, Math.min(1, t / duration));
        setTimeout(step, Math.max(0, 1000 / fps - 2));
      }; step();
    });
  } finally {
    finished = true; try { rec.stop(); } catch (_) {} await stopped.catch(() => {}); for (const s of live) { try { s.stop(); } catch (_) {} } try { await actx.close(); } catch (_) {} stream.getTracks().forEach((x) => x.stop()); await feeder; decoded.clear();
  }
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  const tc = document.createElement('canvas'); tc.width = 1280; tc.height = 720; const cv = covers[(mix.thumbCover && mix.thumbCover.pkgId) || tracks[0].pkgId] || covers[tracks[0].pkgId];
  drawMixThumbnail(tc.getContext('2d'), { background: mix.thumbBackground || 'night-gold', categoryLabel: (F.srvfCategory(mix.category) || {}).short || (F.srvfCategory(mix.category) || {}).label, moodLabel: (F.srvfMood(mix.mood) || {}).label, titleFa: (F.srvfMood(mix.mood) || {}).fa, tracks: tl.items, cover: cv ? { img: images.covers[tracks.findIndex((t) => covers[t.pkgId] === cv)].img, focus: cv.focus } : null, runtimeLabel: Math.round(duration / 60) + ' MIN' });
  const thumbBlob = await new Promise((r) => tc.toBlob(r, 'image/jpeg', 0.92));
  return { blob, mime, thumbBlob, stats: { sample: !!previewSample, version: SRVF_RENDER_VERSION, width: cfg.width, height: cfg.height, fps, durationSec: +duration.toFixed(2), sizeBytes: blob.size, slowFrames: slow, frames: frame, peakDecodedSongs: peakSongs, songs: tracks.length, chapters: tl.items.map((x) => ({ at: x.timestamp, title: x.title })) } };
}
