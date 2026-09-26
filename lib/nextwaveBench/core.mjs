// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: core (style tokens, motion, canvas helpers).
// One frame renderer for Short (1080x1920) and Long (1920x1080). Everything that looks like
// "NextWave" — palette, two-face typography, number styling, spacing, easing — lives here.
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { join } from 'node:path';

const FONT_DIR = join(process.cwd(), 'api', 'assets', 'fonts');
let fontsReady = false;
export function ensureFonts() {
  if (fontsReady) return;
  GlobalFonts.registerFromPath(join(FONT_DIR, 'Inter-Variable.ttf'), 'NW Inter');
  GlobalFonts.registerFromPath(join(FONT_DIR, 'PlayfairDisplay-Variable.ttf'), 'NW Playfair');
  fontsReady = true;
}

// ── STYLE SYSTEM ────────────────────────────────────────────────────────────
export const STYLE = {
  palette: {
    canvas: '#F7F4EE', canvasDeep: '#EFEADF', wall: '#F3EEE3', wallShade: '#E9E2D3', paper: '#FFFFFF',
    ink: '#1A2744', inkSoft: '#3A4763', inkMute: '#6B7488',
    gold: '#C99E4C', goldDark: '#A67C2E', goldLight: '#E8CC8B',
    navy: '#1A2744', navyLight: '#2C3E6B',
    green: '#2F7D4F', greenSoft: '#CDE9D5', red: '#B0413E', redSoft: '#F6D3CB', teal: '#3C8C88',
    bill: '#7FB59A', billDark: '#5E9A80', wood: '#C9A57A', woodDark: '#A98459', shadow: 'rgba(26,39,68,0.20)',
  },
  fonts: { display: 'NW Playfair', ui: 'NW Inter' },
  // Formats. `safe` = where meaningful content and captions may live (platform UI zones excluded).
  formats: {
    short: { w: 1080, h: 1920, fps: 30, safe: { top: 210, bottom: 420, left: 64, right: 96 }, caption: { y: 1350, w: 900, size: 62 } },
    long: { w: 1920, h: 1080, fps: 30, safe: { top: 70, bottom: 110, left: 110, right: 110 }, caption: { y: 900, w: 1400, size: 50 } },
  },
};
export const P = STYLE.palette;
export const font = (kind, weight, size) => `${weight} ${size}px "${kind === 'display' ? STYLE.fonts.display : STYLE.fonts.ui}"`;

// ── MOTION ──────────────────────────────────────────────────────────────────
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};
// progress of an animation that starts at t0 and lasts dur (0..1, eased)
export const tw = (t, t0, dur, fn = ease.outCubic) => fn(clamp01((t - t0) / Math.max(1e-6, dur)));
// count a number from a to b with an ease
export const countTo = (t, t0, dur, a, b, fn = ease.inOutCubic) => lerp(a, b, tw(t, t0, dur, fn));

// ── CANVAS HELPERS ──────────────────────────────────────────────────────────
export function makeCanvas(w, h) { ensureFonts(); const c = createCanvas(w, h); return { c, g: c.getContext('2d') }; }
export function rr(g, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad); g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath();
}
export function lin(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }
export function shadowed(g, fn, { blur = 30, dy = 14, dx = 0, color = 'rgba(26,39,68,0.22)' } = {}) {
  g.save(); g.shadowColor = color; g.shadowBlur = blur; g.shadowOffsetY = dy; g.shadowOffsetX = dx; fn(); g.restore();
}
// contact shadow: soft ellipse on the floor under an object
export function groundShadow(g, cx, cy, w, alpha = 0.22) {
  g.save(); g.translate(cx, cy); g.scale(1, 0.16);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, w / 2); gr.addColorStop(0, `rgba(26,39,68,${alpha})`); gr.addColorStop(1, 'rgba(26,39,68,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, w / 2, 0, Math.PI * 2); g.fill(); g.restore();
}
export function text(g, str, x, y, { kind = 'ui', weight = 700, size = 40, color = P.ink, align = 'left', base = 'alphabetic', alpha = 1, spacing = 0 } = {}) {
  g.save(); g.globalAlpha *= alpha; g.font = font(kind, weight, size); g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
  if (spacing) g.letterSpacing = `${spacing}px`;
  g.fillText(str, x, y); g.restore();
}
export function measure(g, str, { kind = 'ui', weight = 700, size = 40, spacing = 0 } = {}) {
  g.save(); g.font = font(kind, weight, size); if (spacing) g.letterSpacing = `${spacing}px`; const w = g.measureText(str).width; g.restore(); return w;
}
// wrap text into lines that fit maxW
export function wrap(g, str, maxW, opts) {
  const words = String(str).split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) { const next = cur ? `${cur} ${w}` : w; if (cur && measure(g, next, opts) > maxW) { lines.push(cur); cur = w; } else cur = next; }
  if (cur) lines.push(cur); return lines;
}
// NextWave number styling: a light "$" and a heavy figure, tabular, optional unit suffix in small caps-ish size
export function drawMoney(g, str, x, y, { size = 120, color = P.ink, align = 'left', alpha = 1, suffix = '', suffixColor = P.inkMute } = {}) {
  const m = /^([+-−]?)(\$)(.*)$/.exec(str); const sign = m ? m[1] : ''; const dollar = m ? m[2] : ''; const rest = m ? m[3] : str;
  const wDollar = dollar ? measure(g, dollar, { weight: 600, size: size * 0.62 }) + size * 0.04 : 0;
  const wSign = sign ? measure(g, sign, { weight: 800, size: size * 0.8 }) + size * 0.03 : 0;
  const wRest = measure(g, rest, { weight: 800, size });
  const wSuf = suffix ? measure(g, suffix, { weight: 700, size: size * 0.32 }) + size * 0.1 : 0;
  const total = wSign + wDollar + wRest + wSuf;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  if (sign) { text(g, sign, cx, y, { weight: 800, size: size * 0.8, color, alpha }); cx += wSign; }
  if (dollar) { text(g, dollar, cx, y - size * 0.12, { weight: 600, size: size * 0.62, color, alpha: alpha * 0.8 }); cx += wDollar; }
  text(g, rest, cx, y, { weight: 800, size, color, alpha }); cx += wRest;
  if (suffix) text(g, suffix, cx + size * 0.1, y, { weight: 700, size: size * 0.32, color: suffixColor, alpha });
  return total;
}
export const fmtMoney = (v, d = 0) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// ── ASSETS ──────────────────────────────────────────────────────────────────
const imgCache = new Map();
export async function loadSprite(path) { if (!imgCache.has(path)) imgCache.set(path, await loadImage(path)); return imgCache.get(path); }

// Key a flat / lightly graded background out of an image (flood fill from the borders on colour distance),
// feather the edge, trim to the alpha bounds. Returns { canvas, w, h }.
export function keyOut(img, { tol = 46, feather = 2, globalClear = false } = {}) {
  const { c, g } = makeCanvas(img.width, img.height); g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height); const d = id.data; const W = c.width, H = c.height;
  const at = (x, y) => (y * W + x) * 4;
  // background reference = mean of the four corners
  const corners = [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]].map(([x, y]) => [d[at(x, y)], d[at(x, y) + 1], d[at(x, y) + 2]]);
  const ref = [0, 1, 2].map((k) => corners.reduce((s, c2) => s + c2[k], 0) / 4);
  const dist = (i) => Math.hypot(d[i] - ref[0], d[i + 1] - ref[1], d[i + 2] - ref[2]);
  const seen = new Uint8Array(W * H); const stack = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const k = y * W + x; if (seen[k]) return; if (dist(k * 4) > tol) return; seen[k] = 1; stack.push(k); };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); } for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) { const k = stack.pop(); const x = k % W, y = (k / W) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
  for (let k = 0; k < W * H; k++) if (seen[k]) d[k * 4 + 3] = 0;
  // enclosed pockets of background colour (between an arm and the body) are not reachable by the fill: clear them by colour
  if (globalClear) for (let k = 0; k < W * H; k++) if (d[k * 4 + 3] && dist(k * 4) < tol * 0.75) d[k * 4 + 3] = 0;
  g.putImageData(id, 0, 0);
  // feather: blur the alpha edge slightly
  if (feather > 0) { const { c: c2, g: g2 } = makeCanvas(W, H); g2.filter = `blur(${feather}px)`; g2.drawImage(c, 0, 0); g2.filter = 'none'; const b = g2.getImageData(0, 0, W, H); const o = g.getImageData(0, 0, W, H); for (let k = 0; k < W * H; k++) { if (o.data[k * 4 + 3] > 0) o.data[k * 4 + 3] = Math.min(255, b.data[k * 4 + 3] * 1.0 + 0); } g.putImageData(o, 0, 0); }
  // trim
  let x0 = W, y0 = H, x1 = 0, y1 = 0; const fin = g.getImageData(0, 0, W, H).data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fin[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const w = Math.max(1, x1 - x0 + 1), h = Math.max(1, y1 - y0 + 1); const { c: out, g: go } = makeCanvas(w, h); go.drawImage(c, x0, y0, w, h, 0, 0, w, h);
  return { canvas: out, w, h };
}
