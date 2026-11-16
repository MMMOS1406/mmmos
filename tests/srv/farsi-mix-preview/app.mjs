// SRV Farsi Mix preview app (CEO order 2026-11-12). Uses the REAL modules (rules, scene, renderer, selection UI). Songs: real Persian titles + real cover library; audio and durations are SAMPLE data.
import * as F from '/srv-farsi-mix/lib/srvFarsiMix.mjs';
import { mountMixBuilder } from '/srv-farsi-mix/ui.mjs';
import { createMixScene, drawMixThumbnail, SRVF_BACKGROUNDS } from '/srv-farsi-mix/scene.mjs';
import * as R from '/srv-farsi-mix/render.mjs';

const titles = await (await fetch('/preview/sample-titles.json')).json(); const lib = await (await fetch('/preview/library.json')).json();
const libPath = (id) => { const a = id.split('_')[0]; return { src: `/assets/srv-farsi-avatars/library/${a}/srv_farsi_${id}.jpg`, thumb: `/assets/srv-farsi-avatars/library/${a}/thumb/srv_farsi_${id}.jpg` }; };
const focusOf = (id) => { const a = id.split('_')[0]; const f = lib[a].find((x) => x.id === id); return f ? { fx: f.fx, fy: f.fy, fw: f.fw } : null; };
const libraryCovers = ['female', 'male', 'duet'].flatMap((a) => lib[a].map((x) => ({ id: x.id, artist: a, label: x.id, ...libPath(x.id), focus: { fx: x.fx, fy: x.fy, fw: x.fw } })));
const cursor = { female: 0, male: 0, duet: 0 }; const pickCover = (artist) => { const l = lib[artist]; const x = l[cursor[artist]++ % l.length]; return x.id; };
// 14 sample songs spread over the three artists and moods, ~3:10–4:20 each, plus three that must NOT be eligible (test-length, test, private)
const mk = (i, t, extra = {}) => ({ id: 'sample_' + i, engine: 'SRV Farsi', title: t.title, titleFinglish: t.finglish, artist: t.artist, mood: t.artist[0].toUpperCase() + t.artist.slice(1) + ' — ' + ((i % 7 === 5) ? 'Emotional' : (i % 4 === 3) ? 'Happy' : 'Romantic'), _srvLongVideoUrl: 'synthetic://song/' + i, _srvYtLongId: 'SAMPLE' + String(i).padStart(5, '0'), _srvLongDurationSec: 190 + ((i * 37) % 75), srvPublish: { privacyStatus: 'public' }, _srvAvatarChoice: { id: pickCover(t.artist), artist: t.artist }, generatedAt: '2026-10-' + String(28 - i).padStart(2, '0'), ...extra });
const pkgs = titles.slice(0, 14).map((t, i) => mk(i, t)); pkgs.push(mk(20, titles[14], { _srvLongDurationSec: 34 }), mk(21, titles[15], { isTest: true }), mk(22, { ...titles[0], title: 'آهنگ خصوصی' }, { srvPublish: { privacyStatus: 'private' } }));
export const candidates = F.srvfMixCandidates(pkgs);
const byId = new Map(candidates.map((c) => [c.pkgId, c]));
const cover = (c) => { const id = (c.cover && c.cover.id) || 'female_01'; return { ...libPath(id), focus: focusOf(id) }; };

// ── synthetic song audio (SAMPLE): a chord pad + a vibrato "voice" line, a short silent lead-in and a fade-out, different per song ──
function synthWav(idx, sec) {
  const sr = 48000, n = Math.round(sec * sr), L = new Float32Array(n), Rr = new Float32Array(n);
  const roots = [196, 220, 233.08, 261.63, 174.61, 246.94, 207.65, 293.66], root = roots[idx % roots.length], scale = [0, 2, 3, 5, 7, 8, 10, 12];
  for (let i = Math.round(0.45 * sr); i < n; i++) {
    const t = i / sr, bar = Math.floor(t / 2), note = scale[(bar * 3 + idx) % 8], f = root * Math.pow(2, note / 12), vib = 1 + 0.004 * Math.sin(t * 5.5), env = Math.min(1, (t - 0.45) / 0.6) * Math.min(1, (sec - 1.2 - t) / 1.0 > 0 ? 1 : Math.max(0, (sec - t) / 1.2));
    const pad = 0.12 * (Math.sin(TAU * root * t) + 0.6 * Math.sin(TAU * root * 1.5 * t) + 0.5 * Math.sin(TAU * root * 1.26 * t)), voice = 0.22 * Math.sin(TAU * f * 2 * vib * t) * (0.6 + 0.4 * Math.sin(t * 2.1)), kick = (t % 0.5) < 0.12 ? 0.25 * Math.sin(TAU * 60 * (t % 0.5)) * (1 - (t % 0.5) / 0.12) : 0;
    const v = (pad + voice + kick) * env; L[i] = v * (0.95 + 0.05 * Math.sin(t)); Rr[i] = v * (0.95 - 0.05 * Math.sin(t));
  }
  const buf = new ArrayBuffer(44 + n * 4), dv = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, Rr[i])) * 32767, true); }
  return buf;
}
const TAU = Math.PI * 2; const wavCache = {};
const synthFetch = async (url) => { const idx = Number(String(url).split('/').pop()); return new Response(wavCache[idx] || (wavCache[idx] = synthWav(idx, window.__sampleSongSec || 16))); };

// ── sample mix used by the video, transition and background demonstrations ──
export async function buildSample({ songs = 10, songSec = 16, background = 'ice', category = 'all', mood = 'romantic' } = {}) {
  window.__sampleSongSec = songSec;
  const chosen = candidates.filter((c) => c.eligible).slice(0, songs); const tracks = chosen.map((c) => ({ ...c, durationSec: songSec, sourceUrl: c.sourceUrl }));
  const analysis = {}; for (const t of tracks) analysis[t.pkgId] = await R.analyseSong(t, { fetchImpl: synthFetch });
  const tl = R.timelineFrom(tracks, analysis); const title = F.srvfMixTitle(category, mood); const covers = {}; for (const t of tracks) covers[t.pkgId] = cover(t);
  return { tracks, analysis, tl, covers, mix: { category, mood, title, titleLatin: title.split('|')[0].trim(), titleFa: (title.split('|')[1] || '').trim(), background, thumbBackground: 'night-gold', thumbCover: null } };
}
window.__fmx = {
  F, R, candidates, buildSample, synthFetch, libraryCovers, cover,
  async frame(canvas, sample, t, background) { const s = sample; const images = { covers: {} }; for (let i = 0; i < s.tracks.length; i++) { const c = s.covers[s.tracks[i].pkgId]; images.covers[i] = { img: await R.loadImage(c.src), focus: c.focus }; } let bg = null; if (String(background || s.mix.background).startsWith('cover:')) { const id = String(background || s.mix.background).slice(6); bg = await R.loadImage(libPath(id).src); } canvas.width = 1920; canvas.height = 1080; const sc = createMixScene({ W: 1920, H: 1080, mix: { ...s.mix, tracks: s.tl.items, totalSec: s.tl.totalSec }, background: background || s.mix.background, images: { ...images, bg }, seed: 5 }); sc.draw(canvas.getContext('2d'), t); return sc.activeAt(t); },
  async thumb(canvas, sample, bg) { const c = sample.covers[sample.tracks[0].pkgId]; const img = await R.loadImage(c.src); canvas.width = 1280; canvas.height = 720; drawMixThumbnail(canvas.getContext('2d'), { background: bg || 'night-gold', categoryLabel: 'All Artists', moodLabel: 'Love Romantic', titleFa: F.srvfMood('romantic').fa, tracks: sample.tl.items, cover: { img, focus: c.focus }, runtimeLabel: '30+ MIN' }); },
  async renderVideo(sample, canvas, onProgress) { const out = await R.renderFarsiMix({ ...sample, canvas, onProgress, fetchImpl: synthFetch, previewSample: true, videoBitsPerSecond: 5_000_000 }); const b64 = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(out.blob); }); const t64 = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(out.thumbBlob); }); return { video: b64, thumb: t64, stats: out.stats }; },
};

// ── the page ──
const view = document.getElementById('view'), nav = document.getElementById('nav'); const tabs = [['select', '1 · Selection interface'], ['video', '2 · Mix video sample'], ['trans', '3 · Song transition'], ['bg', '4 · Backgrounds'], ['thumb', '5 · Thumbnail']];
async function show(id) {
  nav.innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === id ? 'on' : ''}">${l}</button>`).join(''); view.innerHTML = '';
  if (id === 'select') { const el = document.createElement('div'); view.appendChild(el); window.__builder = mountMixBuilder(el, { candidates, cover, libraryCovers, month: '2026-11', onSave: (r) => { window.__saved = r; } }); }
  else if (id === 'video') { view.innerHTML = `<div class="note" style="margin-bottom:10px">A time-compressed demonstration: 10 songs of 16 s each (a real Mix has ~3:30 per song and at least 30 minutes). Same renderer, same scene, same transition rule. Audio is synthetic sample audio.</div><video controls src="/media/farsi-mix-sample.webm" width="960"></video><div class="note" style="margin-top:10px">If the video does not appear, generate it with: <code>node tests/srv/farsi-mix-preview/make-preview.mjs</code></div>`; }
  else if (id === 'trans') { view.innerHTML = '<div class="note" style="margin-bottom:10px">The title highlight and the cover change at the exact transition (the middle of the audio crossfade — the same second as the YouTube chapter).</div><div class="grid2" id="g"></div>'; const s = await buildSample(); const sw = s.tl.items[3].switchAtSec; for (const [dt, label] of [[-2, '2 s before the switch'], [0, 'at the switch'], [2, '2 s after']]) { const f = document.createElement('figure'); const c = document.createElement('canvas'); f.appendChild(c); f.insertAdjacentHTML('beforeend', `<figcaption>${label} · ${F.srvfClock(sw + dt)}</figcaption>`); document.getElementById('g').appendChild(f); await window.__fmx.frame(c, s, sw + dt); } }
  else if (id === 'bg') { view.innerHTML = '<div class="note" style="margin-bottom:10px">Each Mix can use a different approved background (saved with the Mix package).</div><div class="grid2" id="g"></div>'; const s = await buildSample(); for (const b of [...F.SRVF_BACKGROUND_IDS, 'cover:female_05']) { const f = document.createElement('figure'); const c = document.createElement('canvas'); f.appendChild(c); f.insertAdjacentHTML('beforeend', `<figcaption>${b.startsWith('cover:') ? 'Library image: ' + b.slice(6) : SRVF_BACKGROUNDS[b].label}</figcaption>`); document.getElementById('g').appendChild(f); await window.__fmx.frame(c, s, 20, b); } }
  else if (id === 'thumb') { view.innerHTML = '<div class="grid2" id="g"></div>'; const s = await buildSample(); for (const b of ['night-gold', 'teal-dusk', 'rose-dusk']) { const f = document.createElement('figure'); const c = document.createElement('canvas'); f.appendChild(c); f.insertAdjacentHTML('beforeend', `<figcaption>Thumbnail · ${b}</figcaption>`); document.getElementById('g').appendChild(f); await window.__fmx.thumb(c, s, b); } }
}
nav.onclick = (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.t); }; show('select'); window.__fmxReady = true;
