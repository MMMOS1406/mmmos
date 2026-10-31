// SRV-STUDIO-V2-032 — Monthly Mix Builder, browser side of the ISOLATED PREVIEW (not part of the app, never deployed).
// Decodes audio, builds transition previews with the shared pure mixer (lib/srvStudioV2Mix.mjs), synthesises clearly
// labelled stand-in test audio, and renders a representative 1920×1080 excerpt with the SRV Studio cinematic scene
// (reused read-only from /srv-studio-v2/srv2-render.mjs) plus "now playing" captions.
import * as R from '/srv-studio-v2/srv2-render.mjs';
import * as M from '/__v2/lib/srvStudioV2Mix.mjs';

export const SR = 48000;
const toChannels = (buf) => Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
export function toAudioBuffer(chs, sr = SR) { const b = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate: sr }); chs.forEach((c, i) => b.copyToChannel(c, i)); return b; }

export async function decodeUrl(url) {
  const ab = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(2, SR, SR);
  return ctx.decodeAudioData(ab);
}
// Stand-in test audio (synthetic, generated here — not a real SRV song): 122 BPM four-on-the-floor, off-beat hats,
// a minor chord pad and bass, key and mix varied by seed. Lets the preview show real crossfades without using
// unpublished or third-party music.
export async function synthTrack(seconds, seed) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const rnd = R.srv2Rng('mix-' + seed);
  const bpm = 120 + (seed % 4), beat = 60 / bpm; const root = [45, 47, 48, 50, 52, 53, 55, 57][seed % 8];
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
  const prog = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 3]];
  for (let t = 0, i = 0; t < seconds; t += beat, i++) {
    // kick
    const k = ctx.createOscillator(), kg = ctx.createGain(); k.frequency.setValueAtTime(110, t); k.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    kg.gain.setValueAtTime(0.9, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.28); k.connect(kg).connect(master); k.start(t); k.stop(t + 0.3);
    // off-beat hat (filtered noise burst)
    const ht = t + beat / 2; if (ht < seconds) { const nb = ctx.createBuffer(1, Math.ceil(0.05 * SR), SR); const d = nb.getChannelData(0); for (let j = 0; j < d.length; j++) d[j] = (rnd() * 2 - 1) * (1 - j / d.length);
      const hs = ctx.createBufferSource(); hs.buffer = nb; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; const hg = ctx.createGain(); hg.gain.value = 0.18; hs.connect(hp).connect(hg).connect(master); hs.start(ht); }
    // chords + bass every bar
    if (i % 4 === 0) { const ch = prog[(i / 4) % 4]; const bar = beat * 4;
      for (const iv of ch) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(root + 12 + iv); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + 300 * Math.sin(i / 16); const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045, t + 0.3); g.gain.linearRampToValueAtTime(0, t + bar);
        o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + bar + 0.05); }
      const b = ctx.createOscillator(); b.type = 'triangle'; b.frequency.value = hz(root - 12 + ch[0]); const bg = ctx.createGain(); bg.gain.setValueAtTime(0.25, t); bg.gain.linearRampToValueAtTime(0.12, t + bar); b.connect(bg).connect(master); b.start(t); b.stop(t + bar); }
  }
  return ctx.startRendering();
}
export function measure(buf) { return M.srv2Loudness(toChannels(buf), buf.sampleRate); }

// Transition preview: tail of A + head of B, mixed with the production rules (gains, equal-power crossfade).
export function joinPreview(bufA, bufB, gains, crossfadeSec = M.SRV2_MIX_CONFIG.crossfadeSec, padSec = 10) {
  const take = (b, from, to) => toChannels(b).map((c) => c.slice(Math.max(0, Math.floor(from * b.sampleRate)), Math.floor(to * b.sampleRate)));
  const a = take(bufA, bufA.duration - (padSec + crossfadeSec), bufA.duration), b = take(bufB, 0, padSec + crossfadeSec);
  const tl = M.srv2MixTimeline([{ pkgId: 'a', title: 'A', durationSec: a[0].length / SR }, { pkgId: 'b', title: 'B', durationSec: b[0].length / SR }], { crossfadeSec });
  const cfg = { ...M.SRV2_MIX_CONFIG, introFadeSec: 0.01, outroFadeSec: 0.01 };
  const mix = M.srv2MixPcm([a, b], tl, gains, SR, cfg);
  return { buffer: toAudioBuffer(mix), joinAtSec: tl.items[1].startSec, continuity: M.srv2JoinContinuity(mix, SR, tl, Math.min(padSec, 6))[0] };
}
let _player = null;
export function play(buf, offset = 0) {
  stop(); const ctx = new AudioContext({ sampleRate: buf.sampleRate }); const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start(0, offset);
  _player = { ctx, s }; s.onended = () => stop(); return _player;
}
export function stop() { if (_player) { try { _player.s.stop(); } catch (_) {} try { _player.ctx.close(); } catch (_) {} _player = null; } }

// Representative render: real-time 1920×1080 recording of the cinematic scene over a mixed audio buffer, at the
// bitrate the full mix would need, with an opening mix card and a "now playing" caption at every track start.
export async function renderExcerpt({ mixBuffer, tl, avatar, monthLabel, videoBitsPerSecond, canvas, onProgress }) {
  const cfg = M.SRV2_MIX_CONFIG; const say = (m) => { try { onProgress && onProgress(m); } catch (_) {} };
  if (!R.srv2AvatarProductionReady(avatar)) throw new Error('only an approved final image can be used');
  const mime = R.srv2PickMime((m) => MediaRecorder.isTypeSupported(m)); const info = R.srv2MimeInfo(mime);
  const [fontsOk, img, logo] = await Promise.all([R.srv2LoadFonts(), R.srv2LoadImage(avatar.src), Promise.resolve(null)]);
  const duration = mixBuffer.duration;
  const prepared = R.srv2PrepareSource(img, avatar.crop);
  const timeline = R.srv2LongTimeline({ duration, chorusStart: null, hook: '', seed: avatar.id + '|mix|' + monthLabel });
  const scene = R.srv2CreateScene({ kind: 'long', img, avatar, title: 'Monthly Mix', hook: '', timeline, logo, prepared, fx: R.srv2NormalizeFx(R.SRV2_FX_DEFAULTS) });
  canvas.width = cfg.width; canvas.height = cfg.height; const ctx = canvas.getContext('2d', { alpha: false });
  const actx = new AudioContext({ sampleRate: SR }); const src = actx.createBufferSource(); src.buffer = mixBuffer;
  const an = actx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.6; const dest = actx.createMediaStreamDestination(); src.connect(dest); src.connect(an);
  let stream = canvas.captureStream(0); let vt = stream.getVideoTracks()[0]; if (!vt || typeof vt.requestFrame !== 'function') { stream = canvas.captureStream(cfg.fps); vt = null; }
  const rec = new MediaRecorder(new MediaStream(stream.getVideoTracks().concat(dest.stream.getAudioTracks())), { mimeType: mime, videoBitsPerSecond, audioBitsPerSecond: cfg.audioBitsPerSecond });
  const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); }; const stopped = new Promise((r) => { rec.onstop = r; });
  const bins = new Uint8Array(an.frequencyBinCount); const binHz = actx.sampleRate / an.fftSize; const bass = R.srv2BassFollower(); const mon = new R.Srv2FrameMonitor(cfg.fps);
  await actx.resume(); for (let c0 = actx.currentTime, i = 0; actx.currentTime === c0 && i < 300; i++) await new Promise((r) => setTimeout(r, 10));
  const t0 = actx.currentTime + 0.1; rec.start(1000); src.start(t0); const started = performance.now(); let frame = 0;
  await new Promise((resolve) => {
    const step = () => {
      const t = actx.currentTime - t0; if (t >= duration) { resolve(); return; }
      an.getByteFrequencyData(bins); const lv = bass(bins, binHz);
      const p0 = performance.now(); R.srv2DrawFrame(ctx, scene, Math.max(0, t), lv, frame++); drawMixOverlay(ctx, tl, Math.max(0, t), monthLabel); if (vt) vt.requestFrame(); mon.tick(performance.now() / 1000, performance.now() - p0);
      if (frame % 60 === 0) say(`Rendering 1920×1080 · ${Math.floor(t)} s / ${Math.round(duration)} s`);
      setTimeout(step, 1000 / cfg.fps - 2);
    };
    step();
  });
  await new Promise((r) => setTimeout(r, 300)); rec.stop(); try { src.stop(); } catch (_) {} await stopped; try { await actx.close(); } catch (_) {}
  stream.getTracks().forEach((x) => x.stop());
  const blob = new Blob(chunks, { type: info.type });
  const tc = document.createElement('canvas'); tc.width = 1280; tc.height = 720; R.srv2PaintThumbnail(tc.getContext('2d'), prepared, avatar, { title: 'Monthly Mix', W: 1280, H: 720, logo });
  drawThumbBadge(tc.getContext('2d'), monthLabel, tl);
  const thumbBlob = await new Promise((r) => tc.toBlob(r, 'image/jpeg', 0.9));
  return { blob, ext: info.ext, mime, thumbBlob, stats: { width: cfg.width, height: cfg.height, fps: cfg.fps, durationSec: +duration.toFixed(2), sizeBytes: blob.size, measuredKbps: Math.round(blob.size * 8 / duration / 1000), targetVideoKbps: Math.round(videoBitsPerSecond / 1000), renderSec: +((performance.now() - started) / 1000).toFixed(1), frames: mon.summary(duration), fontsLoaded: !!fontsOk, codec: info.video + '/' + info.audio } };
}
// "Now playing" lower-third for the first 10 s of every track (chapter), plus a mix card in the first 8 s.
export function drawMixOverlay(ctx, tl, t, monthLabel) {
  // Placement avoids the scene's own text: wordmark top-right, corner tag bottom-left (~y 950–1030), title card right.
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const cur = tl.items.filter((x) => x.chapterSec <= t).pop(); if (!cur) return;
  const since = t - cur.chapterSec; const a = since < 0.8 ? since / 0.8 : since > 9 ? Math.max(0, (10 - since)) : 1;
  ctx.save(); ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 14;
  if (t < 8) { ctx.globalAlpha = t < 1 ? t : t > 7 ? 8 - t : 1; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = `600 22px ${R.SRV2_FONTS.sans}`; ctx.fillText(('Monthly Mix · ' + monthLabel).toUpperCase(), 72, 96); }
  if (a > 0) {
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.font = `600 19px ${R.SRV2_FONTS.sans}`; ctx.fillText(String(cur.index + 1).padStart(2, '0') + ' / ' + String(tl.items.length).padStart(2, '0') + '  ·  NOW PLAYING', 72, H - 214);
    ctx.fillStyle = '#fff'; ctx.font = `600 42px ${R.SRV2_FONTS.display}`; ctx.fillText(cur.title.slice(0, 40), 72, H - 164);
  }
  ctx.restore();
}
function drawThumbBadge(ctx, monthLabel, tl) {
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = `600 26px ${R.SRV2_FONTS.sans}`; ctx.textAlign = 'right';
  ctx.fillText(monthLabel.toUpperCase() + ' · ' + Math.round(tl.totalSec / 60) + ' MIN', 1280 - 48, 720 - 52); ctx.restore();
}
