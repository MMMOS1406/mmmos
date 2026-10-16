// SRV Studio V2 — Checkpoint D5 (order SRV-STUDIO-V2-010): cinematic motion layers.
// A (all layers off) must stay pixel-identical to the D4 renderer; B (production default) must never show an
// image edge, never distort the face, never move text, stay restrained with the music, and keep the look.
// Run: node tests/srv/test_srv_studio_v2_motion.mjs   (needs @napi-rs/canvas for the pixel checks)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as R from '../../public/srv-studio-v2/srv2-render.mjs';
import * as A from '../../lib/srvStudioV2Avatars.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
const H = read('public/index.html'), MOD = read('public/srv-studio-v2/srv2-render.mjs');
const show = (ref, f) => execSync(`git show ${ref}:${f}`, { cwd: repo, maxBuffer: 64 << 20 }).toString('utf8');
const n017 = (s) => s.replace(/_publishFetch\('/g, "fetch('"); // SRV-STUDIO-V2-017: the only allowed change to shared publish functions is fetch( → _publishFetch(
let pass = 0, fail = 0, skip = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const top = (src, name) => { const m = src.match(new RegExp('\\n(async )?function ' + name + '\\(')); if (!m) throw new Error('missing ' + name); const s = m.index + 1; return src.slice(s, src.indexOf('\n}\n', s) + 2); };
const D4_COMMIT = '1dc4f7e', D5_COMMIT = 'a84bccd'; // scope is measured on the D5 commit itself; later checkpoints have their own scope checks

// ── 1. Defaults and wiring ──
ok('Defaults: production = camera, atmosphere, film, music response ON; rain OFF', JSON.stringify(R.SRV2_FX_DEFAULTS) === JSON.stringify({ camera: true, atmosphere: true, film: true, reactive: true, rain: false }));
ok('Defaults: SRV2_FX_STATIC is every layer off; a scene without fx is static (D4)', R.SRV2_FX_KEYS.every((k) => R.SRV2_FX_STATIC[k] === false) && JSON.stringify(R.srv2NormalizeFx(undefined)) === JSON.stringify(R.SRV2_FX_STATIC));
ok('Defaults: the production entry srv2RenderVideo uses the defaults when no fx is given, and records fx in its stats', /opts\.fx === undefined \? SRV2_FX_DEFAULTS : opts\.fx/.test(MOD) && /logo: !!logo, fx,/.test(MOD));
ok('App: V2 Build passes the production defaults explicitly; the render record keeps them (shown at Approve)', /fx:R\.SRV2_FX_DEFAULTS/.test(top(H, '_srvEnglishV2Build')) && /r\.fx\?row\('Motion'/.test(top(H, '_srvEnglishV2RenderHtml')));
ok('Version: renderer version bumped to srv2-render-2', R.SRV2_RENDER_VERSION === 'srv2-render-2');

// ── 2. Camera geometry: never an edge, never distorted, never a jump ──
{
  const M = R.SRV2_MOTION; let inside = true, aspect = true, worst = 0, maxStep = 0, maxAcc = 0, maxZoom = 0;
  for (const a of A.SRV_STUDIO_V2_AVATARS) {
    const srcW = a.crop.w, srcH = a.crop.h;
    for (const fr of Object.keys(R.SRV2_FRAMINGS)) {
      let prev = null, prevV = null;
      for (let f = 0; f <= 30 * 60; f++) { // 60 s at 30 fps, push-in from 0 to 1 over the minute
        const t = f / 30; const cam = R.srv2Camera(t, 12345); const p = t / 60;
        const r = R.srv2ShotCameraRect(srcW, srcH, 1920, 1080, fr, a.focus, p, cam, 0.5 + 0.5 * Math.sin(t * 0.7));
        if (r.x < -1e-6 || r.y < -1e-6 || r.x + r.w > srcW + 1e-6 || r.y + r.h > srcH + 1e-6) inside = false;
        if (Math.abs(r.w / r.h - 16 / 9) > 1e-9) aspect = false;
        worst = Math.max(worst, r.scale); maxZoom = Math.max(maxZoom, cam.zoom);
        const c = { x: (r.x + r.w / 2) / srcW, y: (r.y + r.h / 2) / srcH, w: r.w / srcW };
        if (prev) { const v = { x: c.x - prev.x, y: c.y - prev.y, w: c.w - prev.w }; maxStep = Math.max(maxStep, Math.abs(v.x), Math.abs(v.y), Math.abs(v.w)); if (prevV) maxAcc = Math.max(maxAcc, Math.abs(v.x - prevV.x), Math.abs(v.y - prevV.y), Math.abs(v.w - prevV.w)); prevV = v; }
        prev = c;
      }
    }
  }
  ok('Camera: across all 20 avatars × 3 framings × 60 s, the moving frame never leaves the image (no black borders)', inside);
  ok('Camera: uniform scale only — the frame keeps 16:9 exactly, so the face is never stretched', aspect);
  ok('Camera: slow — at most 0.15% of the image width per frame (≤ 4.5% per second)', maxStep <= 0.0015, (maxStep * 100).toFixed(3) + '% / frame');
  ok('Camera: smooth easing — frame-to-frame speed changes by under 0.01% (no jerks)', maxAcc <= 0.0001, (maxAcc * 100).toFixed(4) + '%');
  ok('Camera: breathing zoom stays within +5.5%; total enlargement of the masters stays ≤ ×1.75 (was ×1.54)', maxZoom <= 1.056 && worst <= 1.75, 'zoom ' + maxZoom.toFixed(3) + ' · ×' + worst.toFixed(2));
}

{
  let ok1 = true, up = 0;
  for (const a of A.SRV_STUDIO_V2_AVATARS) for (let f = 0; f <= 900; f++) {
    const t = f / 30; const q = R.srv2CardCameraRect(a.crop.w, a.crop.h, a.focus, t / 30, R.srv2Camera(t, 777), 1);
    if (q.x < -1e-6 || q.y < -1e-6 || q.x + q.w > a.crop.w + 1e-6 || q.y + q.h > a.crop.h + 1e-6 || Math.abs(q.w - q.h) > 1e-9) ok1 = false; up = Math.max(up, 860 / q.w);
  }
  ok('Short camera: across all 20 avatars the face card stays inside the master, square, and never enlarged (≤ ×1.0)', ok1 && up <= 1.0, '×' + up.toFixed(3));
}
// ── 3. Text stability (recording context: every fillText position, with and without motion) ──
function recorder() {
  const calls = []; const st = { globalAlpha: 1 };
  const grad = { addColorStop() {} };
  const ctx = new Proxy(st, {
    get(o, k) {
      if (k === 'fillText') return (txt, x, y) => calls.push([txt, +x.toFixed(3), +y.toFixed(3)]);
      if (k === 'measureText') return (txt) => ({ width: String(txt).length * 20 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'createPattern') return () => ({});
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray((k === 'createImageData' ? x * y : w * h) * 4) });
      if (k in o) return o[k];
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
  return { ctx, calls };
}
{
  const fakeCanvas = (w, h) => { const r = recorder(); return { width: w, height: h, getContext: () => r.ctx }; };
  R.srv2SetCanvasFactory(fakeCanvas);
  const av = A.srv2AvatarById('srv2-fm-06');
  const prep = { graded: fakeCanvas(av.crop.w, av.crop.h), halo: fakeCanvas(417, 235), blurred: fakeCanvas(834, 471), w: av.crop.w, h: av.crop.h };
  const tl = R.srv2LongTimeline({ duration: 120, chorusStart: 40, hook: 'Under neon lights', seed: 'x' });
  const st = R.srv2ShortTimeline({ duration: 30, lines: ['Under neon lights', 'I find my way back', 'City breathing slow'] });
  const textAt = (kind, fx, t, level) => { const s = R.srv2CreateScene({ kind, img: null, avatar: av, title: 'Neon Nights', timeline: kind === 'long' ? tl : st, prepared: prep, fx }); const r = recorder(); R.srv2DrawFrame(r.ctx, s, t, level, Math.round(t * 30)); return JSON.stringify(r.calls); };
  let same = true, steady = true;
  for (const [kind, times] of [['long', [4, 5, 20, 42, 43, 44, 112, 114]], ['short', [1, 3, 6, 9, 12, 20]]]) {
    for (const t of times) {
      const a = textAt(kind, R.SRV2_FX_STATIC, t, 0), b = textAt(kind, R.SRV2_FX_DEFAULTS, t, 0.9), c = textAt(kind, { ...R.SRV2_FX_DEFAULTS, rain: true }, t, 0.1);
      if (a !== b || b !== c) same = false;
    }
  }
  // holds: consecutive frames inside a hold draw text at identical positions
  for (const [kind, t0] of [['long', 42.5], ['long', 20], ['short', 3.0]]) {
    const ref = textAt(kind, R.SRV2_FX_DEFAULTS, t0, 0.3);
    for (let f = 1; f <= 20; f++) if (textAt(kind, R.SRV2_FX_DEFAULTS, t0 + f / 30, (f % 2) * 0.9) !== ref) steady = false;
  }
  ok('Text: every title, hook, lyric and wordmark is drawn at the same position with motion on or off (any music level)', same);
  ok('Text: within a hold, text does not move between frames even while the bass alternates 0 ↔ 0.9 (no jitter)', steady);
}

// ── 4. Pixel checks (real canvas) ──
let C = null; try { C = await import('@napi-rs/canvas'); } catch { /* optional */ }
if (!C) { skip++; out.push('SKIP pixel checks (@napi-rs/canvas not installed)'); }
else {
  const { createCanvas, loadImage, GlobalFonts } = C;
  GlobalFonts.registerFromPath(path.join(repo, 'public/srv-studio-v2/fonts/PlayfairDisplay-Variable.ttf'), 'SRV2 Display');
  GlobalFonts.registerFromPath(path.join(repo, 'public/srv-studio-v2/fonts/Inter-Variable.ttf'), 'SRV2 Sans');
  R.srv2SetCanvasFactory((w, h) => createCanvas(w, h));
  // the D4 renderer, straight from the D4 commit
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-d4-')); const d4f = path.join(tmp, 'd4.mjs'); fs.writeFileSync(d4f, show(D4_COMMIT, 'public/srv-studio-v2/srv2-render.mjs'));
  const D4 = await import(pathToFileURL(d4f).href); D4.srv2SetCanvasFactory((w, h) => createCanvas(w, h));
  const px = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let identical = true;
  for (const id of ['srv2-fm-06', 'srv2-fm-14']) {
    const av = A.srv2AvatarById(id); const img = await loadImage(path.join(repo, 'public', av.src));
    const p1 = R.srv2PrepareSource(img, av.crop), p0 = D4.srv2PrepareSource(img, av.crop);
    const tl = R.srv2LongTimeline({ duration: 90, chorusStart: 30, hook: 'Under neon lights', seed: id });
    const st = R.srv2ShortTimeline({ duration: 30, lines: ['Under neon lights', 'I find my way back'] });
    for (const [kind, timeline, W, Hh, times] of [['long', tl, 1920, 1080, [0.7, 4, 20, 31, 55, 85]], ['short', st, 1080, 1920, [0.3, 5, 16, 29.5]]]) {
      const a = R.srv2CreateScene({ kind, img, avatar: av, title: 'Neon Nights', timeline, prepared: p1, fx: R.SRV2_FX_STATIC });
      const b = D4.srv2CreateScene({ kind, img, avatar: av, title: 'Neon Nights', timeline, prepared: p0 });
      const ca = createCanvas(W, Hh), cb = createCanvas(W, Hh);
      for (const t of times) { R.srv2DrawFrame(ca.getContext('2d'), a, t, 0.7, Math.round(t * 30)); D4.srv2DrawFrame(cb.getContext('2d'), b, t, 0.7, Math.round(t * 30)); const x = px(ca), y = px(cb); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { identical = false; break; } }
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  ok('A = D4: with every layer off, Long and Short frames are pixel-identical to the D4 commit renderer', identical);
  // look preserved, face kept clear, music restrained
  const av = A.srv2AvatarById('srv2-fm-06'); const img = await loadImage(path.join(repo, 'public', av.src)); const prep = R.srv2PrepareSource(img, av.crop);
  const tl = R.srv2LongTimeline({ duration: 90, chorusStart: 30, hook: '', seed: av.id });
  const c = createCanvas(1920, 1080); const x = c.getContext('2d');
  const mean = (d, x0 = 0, y0 = 0, w = 1920, h = 1080) => { let s = 0, n = 0; for (let y = y0; y < y0 + h; y += 2) for (let xx = x0; xx < x0 + w; xx += 2) { s += d[(y * 1920 + xx) * 4]; n++; } return s / n; };
  const frame = (fx, t, lv) => { const s = R.srv2CreateScene({ kind: 'long', img, avatar: av, title: 'N', timeline: tl, prepared: prep, fx }); for (let k = 0; k < 40; k++) R.srv2DrawFrame(x, s, t, lv, Math.round(t * 30)); return { d: px(c), s }; };
  let neutral = true; let lumA = 0, lumB = 0;
  for (const t of [15, 35, 60, 80]) { const a = frame(R.SRV2_FX_STATIC, t, 0.4).d, b = frame(R.SRV2_FX_DEFAULTS, t, 0.4).d; lumA += mean(a); lumB += mean(b); for (let i = 0; i < b.length; i += 4 * 7) if (Math.abs(b[i] - b[i + 1]) > 2 || Math.abs(b[i + 1] - b[i + 2]) > 2) neutral = false; }
  ok('Look: B stays neutral black-and-white (R = G = B)', neutral);
  ok('Look: B keeps the approved exposure — average brightness within 8% of A', Math.abs(lumB - lumA) / lumA <= 0.08, ((lumB - lumA) / lumA * 100).toFixed(1) + '%');
  // face clarity: atmosphere adds (almost) nothing on the face, while it does show elsewhere
  const off = frame({ camera: false, film: false, atmosphere: false }, 35, 0.6).d; const onF = frame({ camera: false, atmosphere: true }, 35, 0.6);
  const r = onF.s.lastRect; const fxp = Math.round((av.focus.fx * prep.w - r.x) / r.w * 1920), fyp = Math.round((av.focus.fy * prep.h - r.y) / r.h * 1080);
  const box = [Math.max(0, fxp - 120), Math.max(0, fyp - 120), 240, 240];
  const diff = (a, b, x0, y0, w, h) => { let s = 0, n = 0; for (let y = y0; y < y0 + h; y += 2) for (let xx = x0; xx < x0 + w; xx += 2) { s += Math.abs(a[(y * 1920 + xx) * 4] - b[(y * 1920 + xx) * 4]); n++; } return s / n; };
  const onFace = diff(onF.d, off, ...box), whole = diff(onF.d, off, 0, 0, 1920, 1080);
  ok('Face: the night atmosphere leaves the face clear (≤ 1 level on the face) while it shows across the frame', onFace <= 1 && whole > onFace, `face ${onFace.toFixed(2)} · frame ${whole.toFixed(2)}`);
  // music restraint: a full-scale bass step moves the picture by at most a few levels, gradually
  const s = R.srv2CreateScene({ kind: 'long', img, avatar: av, title: 'N', timeline: tl, prepared: prep, fx: R.SRV2_FX_DEFAULTS });
  for (let k = 0; k < 60; k++) R.srv2DrawFrame(x, s, 35, 0, 1050);
  const quiet = mean(px(c)); R.srv2DrawFrame(x, s, 35, 1, 1050); const one = s.state.lvSlow;
  for (let k = 0; k < 120; k++) R.srv2DrawFrame(x, s, 35, 1, 1050); const loud = mean(px(c));
  ok('Music: response is gradual (one frame of full bass moves the effect ≤ 6%) — no pulsing', one <= 0.061, 'first-frame response ' + one.toFixed(3));
  ok('Music: even sustained full bass changes average brightness by under 4%', Math.abs(loud - quiet) / quiet < 0.04, ((loud - quiet) / quiet * 100).toFixed(2) + '%');
  // short: the card camera stays inside the master and keeps the square
  const st = R.srv2ShortTimeline({ duration: 30, lines: ['a'] }); const sb = R.srv2CreateScene({ kind: 'short', img, avatar: av, title: 'N', timeline: st, prepared: prep, fx: R.SRV2_FX_DEFAULTS });
  const sc = createCanvas(1080, 1920); let cardOk = true, upMax = 0;
  for (let f = 0; f < 900; f += 3) { R.srv2DrawFrame(sc.getContext('2d'), sb, f / 30, 0.5, f); const q = sb.lastRect; if (q.x < 0 || q.y < 0 || q.x + q.w > prep.w + 1e-6 || q.y + q.h > prep.h + 1e-6 || Math.abs(q.w - q.h) > 1e-9) cardOk = false; upMax = Math.max(upMax, 860 / q.w); }
  ok('Short: the moving face card never leaves the master, stays square, and is never enlarged (scale ≤ 1)', cardOk && upMax <= 1.0, '×' + upMax.toFixed(2));
  const rain = R.srv2CreateScene({ kind: 'long', img, avatar: av, title: 'N', timeline: tl, prepared: prep, fx: { rain: true } });
  R.srv2DrawFrame(x, rain, 35, 0, 1050); const withRain = px(c); R.srv2DrawFrame(x, R.srv2CreateScene({ kind: 'long', img, avatar: av, title: 'N', timeline: tl, prepared: prep, fx: {} }), 35, 0, 1050);
  ok('Rain: optional layer draws only when switched on (off by default)', diff(withRain, px(c), 0, 0, 1920, 1080) > 0.05 && R.SRV2_FX_DEFAULTS.rain === false);
}

// ── 5. Isolation: D5 touches SRV Studio V2 files only ──
{
  const files = execSync(`git diff ${D4_COMMIT} ${D5_COMMIT} --name-only`, { cwd: repo }).toString().trim().split('\n').filter(Boolean);
  const allowed = ['public/srv-studio-v2/srv2-render.mjs', 'public/index.html', 'tests/srv/studio-v2-preview/render-studio.html', 'tests/srv/studio-v2-preview/headless-render.mjs', 'tests/srv/studio-v2-preview/headless-lifecycle.mjs', 'tests/srv/test_srv_studio_v2_motion.mjs', 'tests/srv/test_srv_studio_v2_render.mjs', 'tests/srv/test_srv_studio_v2_isolation.mjs'];
  ok('Scope: D5 changes only the V2 renderer, V2 Build/Approve lines, the V2 preview and V2 tests', files.every((f) => allowed.includes(f)), files.join(', '));
  const hd = execSync(`git diff ${D4_COMMIT} ${D5_COMMIT} -U0 -- public/index.html`, { cwd: repo }).toString();
  const fns = [...hd.matchAll(/^@@[^@]*@@ (?:async )?function ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
  ok('Scope: every index.html hunk is inside a V2 function', fns.length > 0 && fns.every((f) => /^_srvEnglishV2/.test(f)), fns.join(','));
  // db766dd = main before SRV Studio V2 shipped (PR #40): the protected baseline these checks diff against.
  const base = show('db766dd6ed3c561bdb5ea3577ab4e1bf68c98912', 'public/index.html');
  ok('Protected: _srvRenderVideo, _assignPublishSlot and SRV Farsi build/publish byte-identical to main', ['_srvRenderVideo', '_assignPublishSlot', '_srvFarsiBuildTrigger', '_srvFarsiRunPublish'].every((n) => n017(top(H, n)) === top(base, n)));
  ok('Protected: api/ and lib/ untouched by D5', execSync(`git diff ${D4_COMMIT} ${D5_COMMIT} --name-only -- api lib`, { cwd: repo }).toString().trim() === '');
}

{ // D6 (player fix, 11bab1d): preview-only files
  const d6 = execSync('git diff a84bccd 11bab1d --name-only', { cwd: repo }).toString().trim().split('\n').filter(Boolean);
  ok('Scope D6: the A/B player fix changed only Render Studio preview files', d6.length > 0 && d6.every((f) => f.startsWith('tests/srv/studio-v2-preview/')), d6.join(', '));
}
console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`);
process.exit(fail ? 1 : 0);
