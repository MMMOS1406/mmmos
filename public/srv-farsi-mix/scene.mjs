// SRV Farsi Mix — the video scene (CEO order 2026-11-12, preview only). Pure canvas drawing: no network, no DOM except the canvas context it is given.
// Layout follows the CEO's benchmark: a full-frame cinematic background with soft light streaks and falling snow/particles; LEFT the title and the ordered tracklist with the
// current song in a highlight pill; RIGHT a large rounded cover for the song that is playing. At each song transition (the middle of the audio crossfade — the same second as the
// YouTube chapter) the highlight slides to the new row and the cover cross-fades to the new song's cover. No other channel's logo or artwork is used: everything is drawn here.
const TAU = Math.PI * 2;
const FONT_FA = "'Vazirmatn','Geeza Pro','Noto Naskh Arabic','Damascus','Tahoma',sans-serif", FONT_DISPLAY = "'Lalezar','Vazirmatn','Geeza Pro',sans-serif", FONT_LATIN = "'Syne','Helvetica Neue',Arial,sans-serif", FONT_MONO = "'JetBrains Mono','Menlo',monospace";

// ── approved backgrounds: procedural (no external assets). theme 'light' draws dark text, 'dark' draws light text. ──
export const SRVF_BACKGROUNDS = Object.freeze({
  ice: { label: 'Ice blue', theme: 'light', top: '#cdeefa', mid: '#7cc4e2', bottom: '#2f86b3', streak: 'rgba(255,255,255,0.34)', particle: 'snow', pill: '#0e4a5a', pillText: '#ffffff', accent: '#0e4a5a', ink: '#072a3c', dim: 'rgba(7,42,60,0.74)', scrim: 'rgba(205,238,250,0.0)' },
  'night-gold': { label: 'Night gold', theme: 'dark', top: '#1b1209', mid: '#2a1b0e', bottom: '#0b0705', streak: 'rgba(255,196,110,0.13)', particle: 'bokeh', pill: 'rgba(212,160,70,0.28)', pillText: '#fff3d6', accent: '#e0b25a', ink: '#f6ead0', dim: 'rgba(246,234,208,0.64)', scrim: 'rgba(8,5,3,0.55)' },
  'teal-dusk': { label: 'Teal dusk', theme: 'dark', top: '#0c3b43', mid: '#0b5560', bottom: '#06212a', streak: 'rgba(160,240,240,0.14)', particle: 'snow', pill: 'rgba(120,230,220,0.22)', pillText: '#ffffff', accent: '#7fe3d8', ink: '#eafafa', dim: 'rgba(234,250,250,0.66)', scrim: 'rgba(3,22,28,0.5)' },
  'rose-dusk': { label: 'Rose dusk', theme: 'dark', top: '#3a1530', mid: '#6b2748', bottom: '#1a0a1d', streak: 'rgba(255,170,200,0.14)', particle: 'bokeh', pill: 'rgba(255,150,190,0.24)', pillText: '#fff0f6', accent: '#ff9fc0', ink: '#fff0f6', dim: 'rgba(255,240,246,0.66)', scrim: 'rgba(24,6,24,0.5)' },
  midnight: { label: 'Midnight blue', theme: 'dark', top: '#0a1230', mid: '#16245a', bottom: '#05081a', streak: 'rgba(150,180,255,0.14)', particle: 'snow', pill: 'rgba(130,160,255,0.24)', pillText: '#ffffff', accent: '#9db4ff', ink: '#eef2ff', dim: 'rgba(238,242,255,0.66)', scrim: 'rgba(4,7,22,0.5)' },
  emerald: { label: 'Emerald', theme: 'dark', top: '#0b2a1f', mid: '#10452f', bottom: '#04130d', streak: 'rgba(170,255,200,0.12)', particle: 'bokeh', pill: 'rgba(224,178,90,0.26)', pillText: '#fff6dd', accent: '#e0b25a', ink: '#f2fbf5', dim: 'rgba(242,251,245,0.66)', scrim: 'rgba(3,16,11,0.5)' },
});
export const srvfBackgroundSpec = (id) => SRVF_BACKGROUNDS[id] || (String(id).startsWith('cover:') ? { ...SRVF_BACKGROUNDS['night-gold'], label: 'Cover image', cover: true } : SRVF_BACKGROUNDS.ice);

function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)); const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function fit(ctx, text, maxW, size, weight, family, min = 14) { let s = size; ctx.font = `${weight} ${s}px ${family}`; while (s > min && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${weight} ${s}px ${family}`; } return s; }

// Square crop of a (usually 16:9) cover around the artist's face(s). focus = {fx,fy,fw} as fractions of the source (the SRV Farsi library fields).
export function srvfCoverCrop(iw, ih, focus) {
  const f = focus || { fx: 0.5, fy: 0.4, fw: 0.2 }; const side = Math.min(iw, ih) * (1 - clamp((f.fw || 0.2) - 0.2, 0, 0.3) * 0.0); const s = Math.min(side, iw, ih);
  const sx = clamp(f.fx * iw - s / 2, 0, iw - s), sy = clamp(f.fy * ih - s * 0.42, 0, ih - s); return { sx, sy, sw: s, sh: s };
}

// ── particles ──
function makeParticles(kind, W, H, seed) {
  const r = rng(seed ^ 0x9e3779b9), n = kind === 'snow' ? 110 : 34, p = [];
  for (let i = 0; i < n; i++) p.push(kind === 'snow'
    ? { x: r() * W, y: r() * H, z: 0.35 + r() * 0.9, v: 22 + r() * 46, sway: 8 + r() * 26, ph: r() * TAU, rad: 1.6 + r() * 3.6 }
    : { x: r() * W, y: r() * H, z: 0.4 + r() * 1, v: 4 + r() * 10, sway: 14 + r() * 30, ph: r() * TAU, rad: 18 + r() * 52 });
  return p;
}

// ── the scene ──
// mix: { titleLatin, titleFa, brand, tracks:[{title, finglish, startSec, switchAtSec, endSec, artist}], totalSec }; images: { covers:{[index]:{img, focus}}, bg?: image|null }
export function createMixScene({ W = 1920, H = 1080, mix, background = 'ice', images = {}, seed = 1 }) {
  const spec = srvfBackgroundSpec(background), tr = mix.tracks, n = tr.length; const parts = makeParticles(spec.particle, W, H, seed ^ hash(background));
  const dark = spec.theme === 'dark';
  const L = { x: 92, w: 930, top: 250, bottom: 985 };                      // left panel
  const C = { x: 1130, y: 180, s: 640 };                                    // cover tile (right)
  const rowsVisible = Math.min(n, 10), rowH = Math.min(84, (L.bottom - L.top) / rowsVisible);
  const switchAt = (i) => (i === 0 ? 0 : tr[i].switchAtSec);
  // activeFloat(t): a continuous "which row is active" value that moves 0.8 s around each switch (used by the highlight pill, the scroll and the cover cross-fade)
  const activeFloat = (t) => { let a = 0; for (let i = 1; i < n; i++) { const k = ease((t - (switchAt(i) - 0.4)) / 0.8); if (k <= 0) break; a = i - 1 + k; } return a; };

  function drawBackground(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, W * 0.25, H); g.addColorStop(0, spec.top); g.addColorStop(0.55, spec.mid); g.addColorStop(1, spec.bottom); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (spec.cover && images.bg) {                                           // a library cover as the backdrop: blurred, darkened, slowly drifting
      const im = images.bg, k = Math.max(W / im.width, H / im.height) * (1.12 + 0.03 * Math.sin(t / 19)); const w = im.width * k, h = im.height * k;
      ctx.save(); ctx.filter = 'blur(28px) brightness(0.55) saturate(1.1)'; ctx.drawImage(im, (W - w) / 2 + Math.sin(t / 23) * 26, (H - h) / 2 + Math.cos(t / 29) * 16, w, h); ctx.restore();
    }
    // slow cinematic light: wide diagonal streaks drifting across the frame
    ctx.save(); ctx.globalCompositeOperation = dark ? 'screen' : 'lighter';
    for (let i = 0; i < 4; i++) {
      const ph = (t / (46 + i * 11) + i * 0.27) % 1, cx = -W * 0.3 + ph * W * 1.7, w = 190 + i * 70; const sg = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, spec.streak); sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.42); ctx.translate(-W / 2, -H / 2); ctx.fillStyle = sg; ctx.fillRect(cx - w, -H, w * 2, H * 3); ctx.restore();
    }
    ctx.restore();
    // vignette keeps edges calm and text readable
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, dark ? 'rgba(0,0,0,0.42)' : 'rgba(10,50,80,0.18)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }
  function drawParticles(ctx, t) {
    ctx.save();
    for (const p of parts) {
      const y = (p.y + t * p.v * p.z) % (H + 60) - 30, x = (p.x + Math.sin(t * 0.5 + p.ph) * p.sway + t * 4 * p.z) % (W + 40) - 20;
      if (spec.particle === 'snow') { ctx.globalAlpha = (dark ? 0.55 : 0.8) * p.z / 1.25; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, p.rad * p.z, 0, TAU); ctx.fill(); }
      else { const a = (0.07 + 0.06 * Math.sin(t * 0.4 + p.ph)) * p.z; const g = ctx.createRadialGradient(x, y, 0, x, y, p.rad); g.addColorStop(0, `rgba(255,226,170,${a * 1.6})`); g.addColorStop(1, 'rgba(255,226,170,0)'); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, p.rad, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }
  function drawHeader(ctx) {
    ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.fillStyle = spec.accent;
    ctx.font = `800 22px ${FONT_LATIN}`; ctx.letterSpacing = '6px'; ctx.textAlign = 'left'; ctx.fillText('TOP PERSIAN', L.x, 96); ctx.letterSpacing = '0px';
    ctx.fillStyle = spec.ink; ctx.shadowColor = dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)'; ctx.shadowBlur = 8;
    const tl1 = mix.titleLatin.replace(/^(SRV Farsi|Top Persian)\s*[—-]\s*/i, '').toUpperCase(); const s1 = fit(ctx, tl1, L.w, 62, 800, FONT_LATIN, 28); ctx.font = `800 ${s1}px ${FONT_LATIN}`; ctx.letterSpacing = '2px'; ctx.fillText(tl1, L.x, 164); ctx.letterSpacing = '0px';
    ctx.fillStyle = spec.dim; ctx.shadowBlur = 0; ctx.direction = 'rtl'; ctx.textAlign = 'left';
    const s2 = fit(ctx, mix.titleFa, L.w, 34, 500, FONT_FA, 20); ctx.font = `500 ${s2}px ${FONT_FA}`; ctx.fillText(mix.titleFa, L.x, 212); ctx.direction = 'ltr';
    ctx.restore();
  }
  function drawTracklist(ctx, t, af) {
    const scroll = clamp(af - (rowsVisible - 1) / 2, 0, Math.max(0, n - rowsVisible)), first = Math.floor(scroll) - 1;
    ctx.save(); rr(ctx, L.x - 26, L.top - 22, L.w + 52, L.bottom - L.top + 36, 30); ctx.clip();
    // pill sliding to the active row
    const py = L.top + (af - scroll) * rowH; ctx.fillStyle = spec.pill; rr(ctx, L.x - 22, py + 2, L.w + 44, rowH - 4, rowH / 2.2); ctx.fill();
    for (let i = Math.max(0, first); i <= Math.min(n - 1, first + rowsVisible + 2); i++) {
      const y = L.top + (i - scroll) * rowH, d = Math.abs(i - af), act = 1 - clamp(d, 0, 1), cy = y + rowH / 2; const a = (dark ? 0.6 : 0.84) + (dark ? 0.4 : 0.16) * act;
      ctx.globalAlpha = a; ctx.fillStyle = act > 0.5 ? (spec.pillText) : spec.ink; ctx.textAlign = 'left';
      ctx.font = `700 ${Math.round(rowH * 0.3)}px ${FONT_MONO}`; ctx.fillText(String(i + 1).padStart(2, '0'), L.x + 8, cy + rowH * 0.1);
      const big = Math.round(rowH * (0.42 + 0.05 * act)), tx = L.x + 78, maxW = L.w - 100;
      // CEO correction 2026-11-12: the tracklist shows the song's FINGLISH (Latin) spelling only — never Persian script.
      const fg = String(tr[i].finglish || '').toUpperCase(); ctx.direction = 'ltr'; const s = fit(ctx, fg, maxW, big, 700, FONT_LATIN, 18); ctx.font = `italic 700 ${s}px ${FONT_LATIN}`; ctx.letterSpacing = '1px'; ctx.fillText(fg, tx, cy + rowH * 0.15); ctx.letterSpacing = '0px';
    }
    ctx.restore();
  }
  function drawCoverTile(ctx, idx, alpha) {
    const info = images.covers && images.covers[idx]; if (alpha <= 0.001) return; const s = C.s;
    ctx.save(); ctx.globalAlpha = alpha; rr(ctx, C.x, C.y, s, s, 36); ctx.clip();
    if (info && info.img) { const c = srvfCoverCrop(info.img.width, info.img.height, info.focus); ctx.drawImage(info.img, c.sx, c.sy, c.sw, c.sh, C.x, C.y, s, s); } else { ctx.fillStyle = '#1c2430'; ctx.fillRect(C.x, C.y, s, s); }
    const g = ctx.createLinearGradient(0, C.y + s * 0.5, 0, C.y + s); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.78)'); ctx.fillStyle = g; ctx.fillRect(C.x, C.y + s * 0.5, s, s * 0.5);
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 14; ctx.direction = 'ltr';
    // CEO correction 2026-11-12 (final): the cover caption shows the song's FINGLISH (Latin) title, large, wrapped onto two lines when long — never Persian script (the Persian title stays in the package metadata).
    const t0 = tr[idx]; const fgt = String(t0.finglish || '').toUpperCase(); const maxCW = s - 90; const words = fgt.split(' '); let lines = [fgt], fs = fit(ctx, fgt, maxCW, 38, 600, FONT_LATIN, 22);
    if (words.length > 1 && fs < 30) { let best = null; for (let k = 1; k < words.length; k++) { const a = words.slice(0, k).join(' '), b = words.slice(k).join(' '); const sz = Math.min(fit(ctx, a, maxCW, 34, 600, FONT_LATIN, 20), fit(ctx, b, maxCW, 34, 600, FONT_LATIN, 20)); if (!best || sz > best.sz) best = { a, b, sz }; } if (best && best.sz > fs) { lines = [best.a, best.b]; fs = best.sz; } }
    ctx.font = `600 ${fs}px ${FONT_LATIN}`; ctx.letterSpacing = '1.2px'; const baseY = C.y + s - 70 - (lines.length - 1) * (fs * 1.2); lines.forEach((ln, k) => ctx.fillText(ln, C.x + s / 2, baseY + k * fs * 1.2)); ctx.letterSpacing = '0px';   // CEO/PM correction: lighter (600) and capped at 38 px — no longer dominates the cover
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = `600 17px ${FONT_LATIN}`; ctx.letterSpacing = '4px'; ctx.fillText('SILK ROAD VOICES', C.x + s / 2, C.y + s - 34); ctx.letterSpacing = '0px';
    ctx.restore();
  }
  function drawCover(ctx, t, af) {
    const zoom = 1 + 0.018 * Math.sin(t / 7);                                  // subtle breathing motion
    const ci = Math.floor(af), k = af - ci; ctx.save(); ctx.translate(C.x + C.s / 2, C.y + C.s / 2); ctx.scale(zoom, zoom); ctx.translate(-(C.x + C.s / 2), -(C.y + C.s / 2));
    // soft shadow under the tile
    ctx.shadowColor = 'rgba(0,0,0,0.42)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 22; rr(ctx, C.x, C.y, C.s, C.s, 36); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    drawCoverTile(ctx, ci, 1); if (k > 0.001 && ci + 1 < n) drawCoverTile(ctx, ci + 1, k);
    ctx.restore();
    // counter + progress under the tile
    const cur = Math.round(af) + 1; ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = spec.ink; ctx.globalAlpha = 0.9; ctx.font = `700 24px ${FONT_MONO}`; ctx.fillText(`${String(cur).padStart(2, '0')} / ${String(n).padStart(2, '0')}`, C.x + C.s / 2, C.y + C.s + 64);
    const px = C.x + 60, pw = C.s - 120, py = C.y + C.s + 92; ctx.globalAlpha = 0.28; ctx.fillStyle = spec.ink; rr(ctx, px, py, pw, 6, 3); ctx.fill(); ctx.globalAlpha = 0.95; ctx.fillStyle = spec.accent; rr(ctx, px, py, Math.max(6, pw * clamp(t / mix.totalSec, 0, 1)), 6, 3); ctx.fill(); ctx.restore();
  }
  return {
    W, H, spec, rowsVisible,
    draw(ctx, t) {
      drawBackground(ctx, t); drawParticles(ctx, t);
      if (dark) { const sc = ctx.createLinearGradient(0, 0, L.x + L.w + 120, 0); sc.addColorStop(0, spec.scrim); sc.addColorStop(0.82, spec.scrim); sc.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sc; ctx.fillRect(0, 0, L.x + L.w + 160, H); }
      else { const sc = ctx.createLinearGradient(0, 0, L.x + L.w + 120, 0); sc.addColorStop(0, 'rgba(235,248,253,0.42)'); sc.addColorStop(0.8, 'rgba(235,248,253,0.32)'); sc.addColorStop(1, 'rgba(235,248,253,0)'); ctx.fillStyle = sc; ctx.fillRect(0, 0, L.x + L.w + 160, H); }
      const af = activeFloat(t); drawHeader(ctx); drawTracklist(ctx, t, af); drawCover(ctx, t, af);
      // brand mark (drawn here, not a copied logo)
      ctx.save(); ctx.fillStyle = spec.accent; ctx.globalAlpha = 0.9; ctx.font = `700 15px ${FONT_LATIN}`; ctx.letterSpacing = '5px'; ctx.textAlign = 'right'; ctx.fillText('SILK ROAD VOICES', W - 70, H - 38); ctx.restore();
    },
    activeAt(t) { let a = 0; for (let i = 1; i < n; i++) if (t >= tr[i].switchAtSec) a = i; return a; },
  };
}

// ── thumbnail (1280×720): gold display type + portrait of the first song (default), tracklist teaser, same background family ──
export function drawMixThumbnail(ctx, { W = 1280, H = 720, background = 'night-gold', categoryLabel, moodLabel, titleFa, tracks = [], cover, bgImage = null, runtimeLabel = '' }) {
  const spec = srvfBackgroundSpec(background); const dark = spec.theme === 'dark' || true;
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, dark ? '#120b06' : spec.top); g.addColorStop(0.6, dark ? '#24170c' : spec.mid); g.addColorStop(1, dark ? '#080503' : spec.bottom); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (bgImage) { ctx.save(); ctx.filter = 'blur(22px) brightness(0.5)'; const k = Math.max(W / bgImage.width, H / bgImage.height) * 1.1; ctx.drawImage(bgImage, (W - bgImage.width * k) / 2, (H - bgImage.height * k) / 2, bgImage.width * k, bgImage.height * k); ctx.restore(); }
  const r = rng(77); for (let i = 0; i < 26; i++) { const x = r() * W, y = r() * H, rad = 14 + r() * 46; const b = ctx.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, 'rgba(255,214,150,0.22)'); b.addColorStop(1, 'rgba(255,214,150,0)'); ctx.fillStyle = b; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill(); }
  const sx = ctx.createLinearGradient(0, 0, W * 0.62, 0); sx.addColorStop(0, 'rgba(0,0,0,0.72)'); sx.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sx; ctx.fillRect(0, 0, W, H);
  // portrait right
  const S = 520, px = W - S - 70, py = (H - S) / 2 - 10; ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 40; rr(ctx, px, py, S, S, 28); ctx.fillStyle = '#111'; ctx.fill(); ctx.restore();
  ctx.save(); rr(ctx, px, py, S, S, 28); ctx.clip(); if (cover && cover.img) { const c = srvfCoverCrop(cover.img.width, cover.img.height, cover.focus); ctx.drawImage(cover.img, c.sx, c.sy, c.sw, c.sh, px, py, S, S); } else { ctx.fillStyle = '#333'; ctx.fillRect(px, py, S, S); }
  const gg = ctx.createLinearGradient(0, py + S * 0.55, 0, py + S); gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(1, 'rgba(0,0,0,0.7)'); ctx.fillStyle = gg; ctx.fillRect(px, py + S * 0.55, S, S * 0.45);
  if (tracks[0]) { ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10; ctx.direction = 'rtl'; const fs = fit(ctx, tracks[0].title, S - 60, 56, 800, FONT_FA, 26); ctx.font = `800 ${fs}px ${FONT_FA}`; ctx.fillText(tracks[0].title, px + S / 2, py + S - 62); ctx.direction = 'ltr'; ctx.shadowBlur = 0; ctx.font = `700 18px ${FONT_LATIN}`; ctx.letterSpacing = '4px'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText('SILK ROAD VOICES', px + S / 2, py + S - 26); ctx.letterSpacing = '0px'; }
  ctx.restore();
  // gold type left
  const gold = ctx.createLinearGradient(0, 150, 0, 420); gold.addColorStop(0, '#fff1c4'); gold.addColorStop(0.45, '#e3b25a'); gold.addColorStop(1, '#9a6a24');
  ctx.save(); ctx.textAlign = 'left'; ctx.fillStyle = '#e3b25a'; ctx.font = `800 24px ${FONT_LATIN}`; ctx.letterSpacing = '9px'; ctx.fillText('TOP PERSIAN', 64, 92); ctx.letterSpacing = '0px';
  const words = String(moodLabel || '').toUpperCase().split(' '); let y = 215; ctx.fillStyle = gold; ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
  for (const w of words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words) { const s = fit(ctx, w, 560, 148, 800, FONT_DISPLAY, 60); ctx.font = `800 ${s}px ${FONT_DISPLAY}`; ctx.fillText(w, 60, y); y += s * 0.92; }
  ctx.font = `800 70px ${FONT_DISPLAY}`; ctx.fillText('MIX', 62, y + 6); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#fff'; ctx.direction = 'rtl'; const fs2 = fit(ctx, titleFa || '', 560, 46, 700, FONT_FA, 22); ctx.font = `700 ${fs2}px ${FONT_FA}`; ctx.fillText(titleFa || '', 64, H - 150); ctx.direction = 'ltr';
  ctx.fillStyle = '#e3b25a'; ctx.font = `700 24px ${FONT_LATIN}`; ctx.letterSpacing = '4px'; ctx.fillText(`${tracks.length} SONGS${runtimeLabel ? ' · ' + runtimeLabel : ''}`, 66, H - 96); ctx.letterSpacing = '0px';
  ctx.restore();
}
// Tracklist-style thumbnail variant (numbered songs), the second layout of the benchmark.
export function drawMixTracklistThumbnail(ctx, { W = 1280, H = 720, moodLabel, tracks = [] }) {
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0f0a05'); g.addColorStop(1, '#2a1b0c'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const gold = ctx.createLinearGradient(0, 40, 0, 200); gold.addColorStop(0, '#fff1c4'); gold.addColorStop(1, '#b8812f');
  ctx.save(); ctx.fillStyle = gold; ctx.textAlign = 'left'; ctx.font = `800 96px ${FONT_DISPLAY}`; ctx.fillText(String(moodLabel || '').toUpperCase(), 64, 150); ctx.font = `700 40px ${FONT_LATIN}`; ctx.letterSpacing = '8px'; ctx.fillText('SILK ROAD VOICES MIX', 66, 206); ctx.letterSpacing = '0px';
  const rows = tracks.slice(0, 9), rh = Math.min(54, 440 / Math.max(1, rows.length)); rows.forEach((t, i) => { const y = 270 + i * rh; ctx.fillStyle = '#e3b25a'; ctx.font = `700 ${Math.round(rh * 0.5)}px ${FONT_MONO}`; ctx.fillText(String(i + 1).padStart(2, '0'), 66, y + rh * 0.6); ctx.fillStyle = '#fff'; ctx.direction = 'rtl'; const s = fit(ctx, t.title, 620, Math.round(rh * 0.62), 700, FONT_FA, 18); ctx.font = `700 ${s}px ${FONT_FA}`; ctx.fillText(t.title, 150, y + rh * 0.62); ctx.direction = 'ltr'; });
  ctx.restore();
}
