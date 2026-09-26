// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: programmatic vector PROPS and SETS.
// Objects the numbers attach to. Parametric on purpose: a stack's height IS the value, a jar's fill
// level IS the percentage, so the picture and the verified number cannot disagree.
// Every prop draws with its BOTTOM-CENTER at (x, y) and scales with `s` (1 = nominal size).
import { P, rr, lin, shadowed, groundShadow, text, lerp } from './core.mjs';

const K = (c, a) => { // rgba from hex
  const n = parseInt(c.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

// ── COINS ────────────────────────────────────────────────────────────────────
export function coinStack(g, x, y, { n = 8, w = 150, s = 1, ground = true, th: thIn } = {}) {
  const cw = w * s, ch = cw * 0.3, th = thIn || cw * 0.1;
  if (ground) groundShadow(g, x, y, cw * 1.25, 0.25);
  const nFull = Math.floor(n), nFrac = n - nFull; const total = nFull + (nFrac > 0.02 ? 1 : 0);
  for (let i = 0; i < total; i++) {
    g.save(); if (i === nFull) g.globalAlpha *= nFrac;
    const cy = y - i * th - ch / 2;
    g.save(); g.translate(x, cy);
    // side
    g.fillStyle = lin(g, -cw / 2, 0, cw / 2, 0, [[0, '#B98A38'], [0.5, '#E3B95E'], [1, '#B58432']]);
    g.beginPath(); g.ellipse(0, th, cw / 2, ch / 2, 0, 0, Math.PI); g.lineTo(-cw / 2, 0); g.lineTo(cw / 2, 0); g.closePath(); g.fill();
    g.fillRect(-cw / 2, 0, cw, th);
    g.beginPath(); g.ellipse(0, th, cw / 2, ch / 2, 0, 0, Math.PI); g.fill();
    // top
    g.fillStyle = lin(g, -cw / 2, -ch / 2, cw / 2, ch / 2, [[0, '#F2D384'], [1, '#D9A94A']]);
    g.beginPath(); g.ellipse(0, 0, cw / 2, ch / 2, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(166,124,46,0.75)'; g.lineWidth = Math.max(1.5, cw * 0.012); g.beginPath(); g.ellipse(0, 0, cw / 2 * 0.72, ch / 2 * 0.72, 0, 0, Math.PI * 2); g.stroke();
    g.restore(); g.restore();
  }
}

// ── BILLS ────────────────────────────────────────────────────────────────────
export function bill(g, x, y, w, h, { rot = 0, tone = 0 } = {}) {
  g.save(); g.translate(x, y); g.rotate(rot);
  shadowed(g, () => { rr(g, -w / 2, -h / 2, w, h, h * 0.1); g.fillStyle = lin(g, -w / 2, -h / 2, w / 2, h / 2, [[0, tone ? '#8CC2A6' : P.bill], [1, tone ? '#6FAA8F' : P.billDark]]); g.fill(); }, { blur: 10, dy: 4, color: 'rgba(26,39,68,0.18)' });
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = Math.max(2, h * 0.04); rr(g, -w / 2 + h * 0.08, -h / 2 + h * 0.08, w - h * 0.16, h - h * 0.16, h * 0.06); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(0, 0, h * 0.27, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(46,110,84,0.85)'; g.font = `800 ${h * 0.36}px "NW Inter"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 0, h * 0.02);
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(-w / 2 + h * 0.22, -h * 0.05, h * 0.3, h * 0.1); g.fillRect(w / 2 - h * 0.52, -h * 0.05, h * 0.3, h * 0.1);
  g.restore();
}
// A tidy stack of bills; n bills, each `th` thick. Height = n * th (so height encodes value).
export function billStack(g, x, y, { n = 10, w = 330, s = 1, ground = true, th: thIn } = {}) {
  const bw = w * s, bh = bw * 0.44, th = thIn || Math.max(5, bw * 0.032);
  if (ground) groundShadow(g, x, y, bw * 1.2, 0.24);
  const full = Math.floor(n), frac = n - full;
  for (let i = 0; i < full; i++) bill(g, x + (i % 2 ? 2 : -2) * s, y - bh * 0.5 * 0.42 - i * th, bw, bh * 0.42 + 0, { tone: i % 2 });
  if (frac > 0.02) { g.save(); g.globalAlpha *= frac; bill(g, x + (full % 2 ? 2 : -2) * s, y - bh * 0.5 * 0.42 - full * th, bw, bh * 0.42, { tone: full % 2 }); g.restore(); }
  n = Math.max(1, n);
  // paper band on top-most bills
  const topY = y - bh * 0.5 * 0.42 - (n - 1) * th;
  g.save(); g.fillStyle = P.goldLight; rr(g, x - bw * 0.06, topY - bh * 0.21, bw * 0.12, bh * 0.42, 6 * s); g.fill(); g.restore();
  return { top: topY - bh * 0.21 };
}

// ── HOUSE ────────────────────────────────────────────────────────────────────
export function house(g, x, y, { w = 420, s = 1, ground = true, tint = 0 } = {}) {
  const W = w * s, H = W * 0.78; if (ground) groundShadow(g, x, y, W * 1.15, 0.24);
  g.save(); g.translate(x - W / 2, y - H);
  // body
  shadowed(g, () => { rr(g, W * 0.08, H * 0.42, W * 0.84, H * 0.58, W * 0.02); g.fillStyle = lin(g, 0, H * 0.4, 0, H, [[0, '#F6E9D2'], [1, '#EBD7B5']]); g.fill(); }, { blur: 18, dy: 8 });
  // roof
  g.fillStyle = lin(g, 0, 0, 0, H * 0.5, [[0, P.navyLight], [1, P.navy]]);
  g.beginPath(); g.moveTo(0, H * 0.48); g.lineTo(W / 2, 0); g.lineTo(W, H * 0.48); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W, H * 0.48); g.lineTo(W / 2, H * 0.48); g.closePath(); g.fill();
  // chimney
  g.fillStyle = '#A57A5A'; g.fillRect(W * 0.7, H * 0.06, W * 0.07, H * 0.22);
  // door
  rr(g, W * 0.43, H * 0.66, W * 0.14, H * 0.34, W * 0.02); g.fillStyle = P.gold; g.fill();
  g.fillStyle = P.goldDark; g.beginPath(); g.arc(W * 0.54, H * 0.84, W * 0.006, 0, 7); g.fill();
  // windows
  for (const wx of [0.16, 0.66]) { rr(g, W * wx, H * 0.56, W * 0.17, H * 0.2, W * 0.012); g.fillStyle = '#CFE3EC'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = W * 0.008; g.stroke(); g.beginPath(); g.moveTo(W * (wx + 0.085), H * 0.56); g.lineTo(W * (wx + 0.085), H * 0.76); g.stroke(); }
  g.restore();
}

// ── GROCERY BASKET (inflation) ───────────────────────────────────────────────
export function basket(g, x, y, { w = 360, s = 1, fill = 1, ground = true } = {}) {
  const W = w * s, H = W * 0.5; if (ground) groundShadow(g, x, y, W * 1.15, 0.22);
  g.save(); g.translate(x, y);
  // items (behind front of basket): bread, milk, apples — scale with `fill`
  const items = () => {
    g.save(); g.scale(fill, fill);
    // milk carton
    g.fillStyle = '#F4F7FA'; rr(g, -W * 0.16, -H * 1.55, W * 0.16, H * 0.72, 8); g.fill(); g.fillStyle = '#4C86C5'; g.fillRect(-W * 0.16, -H * 1.3, W * 0.16, H * 0.2); g.fillStyle = '#F4F7FA'; g.beginPath(); g.moveTo(-W * 0.16, -H * 1.55); g.lineTo(-W * 0.12, -H * 1.72); g.lineTo(-W * 0.04, -H * 1.72); g.lineTo(0, -H * 1.55); g.closePath(); g.fill();
    // bread
    g.fillStyle = '#D9A15C'; rr(g, W * 0.02, -H * 1.42, W * 0.32, H * 0.6, H * 0.28); g.fill(); g.strokeStyle = '#B67D3E'; g.lineWidth = 4; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(W * (0.08 + i * 0.09), -H * 1.3); g.lineTo(W * (0.11 + i * 0.09), -H * 1.0); g.stroke(); }
    // apples
    for (const [ax, ay] of [[-W * 0.3, -H * 1.0], [-W * 0.19, -H * 0.95]]) { g.fillStyle = '#C8483F'; g.beginPath(); g.arc(ax, ay, H * 0.26, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(ax - H * 0.09, ay - H * 0.09, H * 0.07, 0, 7); g.fill(); g.fillStyle = '#4E8F5C'; g.beginPath(); g.ellipse(ax + H * 0.05, ay - H * 0.27, H * 0.09, H * 0.05, -0.5, 0, 7); g.fill(); }
    g.restore();
  };
  items();
  // basket body
  g.fillStyle = lin(g, 0, -H, 0, 0, [[0, P.wood], [1, P.woodDark]]); g.beginPath(); g.moveTo(-W / 2, -H); g.lineTo(W / 2, -H); g.lineTo(W * 0.4, 0); g.lineTo(-W * 0.4, 0); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(90,58,28,0.35)'; g.lineWidth = 4; for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(-W / 2 + (i * W) / 5 * 0.98, -H); g.lineTo(-W * 0.4 + (i * W * 0.8) / 5, 0); g.stroke(); } for (let j = 1; j < 3; j++) { g.beginPath(); g.moveTo(-W / 2 + j * W * 0.02, -H + (H * j) / 3); g.lineTo(W / 2 - j * W * 0.02, -H + (H * j) / 3); g.stroke(); }
  g.fillStyle = P.woodDark; rr(g, -W / 2 - 6, -H - 12, W + 12, 22, 10); g.fill();
  g.strokeStyle = P.woodDark; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.arc(0, -H - 6, W * 0.34, Math.PI, 0); g.stroke();
  g.restore();
}

// ── JAR (savings / percentage) ───────────────────────────────────────────────
export function jar(g, x, y, { w = 230, s = 1, level = 0.5, ground = true } = {}) {
  const W = w * s, H = W * 1.25; if (ground) groundShadow(g, x, y, W * 1.1, 0.22);
  g.save(); g.translate(x - W / 2, y - H);
  g.fillStyle = 'rgba(210,232,240,0.55)'; rr(g, 0, H * 0.12, W, H * 0.88, W * 0.16); g.fill();
  // fill (coins colour)
  g.save(); rr(g, 4, H * 0.12 + 4, W - 8, H * 0.88 - 8, W * 0.14); g.clip(); const fh = (H * 0.88 - 8) * level; g.fillStyle = lin(g, 0, H - fh, 0, H, [[0, '#F0CE7A'], [1, '#C99E4C']]); g.fillRect(0, H - fh - 4, W, fh + 8); g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 5; rr(g, 0, H * 0.12, W, H * 0.88, W * 0.16); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.5)'; rr(g, W * 0.12, H * 0.22, W * 0.07, H * 0.5, 8); g.fill();
  g.fillStyle = P.goldDark; rr(g, W * 0.12, 0, W * 0.76, H * 0.14, 10); g.fill();
  g.restore();
}

// ── HOURGLASS / CLOCK ────────────────────────────────────────────────────────
export function hourglass(g, x, y, { h = 300, s = 1, sand = 0.5, ground = true } = {}) {
  const H = h * s, W = H * 0.55; if (ground) groundShadow(g, x, y, W * 1.2, 0.2);
  g.save(); g.translate(x, y - H);
  g.fillStyle = P.woodDark; rr(g, -W / 2 - 8, -6, W + 16, 22, 8); g.fill(); rr(g, -W / 2 - 8, H - 16, W + 16, 22, 8); g.fill();
  g.fillStyle = 'rgba(205,228,238,0.55)'; g.beginPath(); g.moveTo(-W / 2, 16); g.lineTo(W / 2, 16); g.lineTo(W * 0.06, H / 2); g.lineTo(W / 2, H - 16); g.lineTo(-W / 2, H - 16); g.lineTo(-W * 0.06, H / 2); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#E3B95E';
  const top = 1 - sand; g.save(); g.beginPath(); g.moveTo(-W / 2 + 6, 20); g.lineTo(W / 2 - 6, 20); g.lineTo(W * 0.05, H / 2 - 4); g.lineTo(-W * 0.05, H / 2 - 4); g.closePath(); g.clip(); g.fillRect(-W / 2, 20 + (H / 2 - 24) * top, W, H); g.restore();
  g.save(); g.beginPath(); g.moveTo(-W * 0.05, H / 2 + 4); g.lineTo(W * 0.05, H / 2 + 4); g.lineTo(W / 2 - 6, H - 20); g.lineTo(-W / 2 + 6, H - 20); g.closePath(); g.clip(); g.fillRect(-W / 2, H - 20 - (H / 2 - 24) * sand, W, H); g.restore();
  g.restore();
}

// ── ARROWS / BADGES ──────────────────────────────────────────────────────────
export function arrow(g, x0, y0, x1, y1, { color = P.gold, width = 22, head = 54, progress = 1 } = {}) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), a = Math.atan2(dy, dx); const l = L * progress; if (l < 2) return;
  g.save(); g.translate(x0, y0); g.rotate(a); g.fillStyle = color; g.strokeStyle = color; g.lineCap = 'round';
  shadowed(g, () => { g.lineWidth = width; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.max(0, l - head * 0.6), 0); g.stroke(); if (l > head * 0.8) { g.beginPath(); g.moveTo(l, 0); g.lineTo(l - head, -head * 0.62); g.lineTo(l - head, head * 0.62); g.closePath(); g.fill(); } }, { blur: 14, dy: 6, color: 'rgba(26,39,68,0.16)' });
  g.restore();
}
// value tag pinned to an object: rounded pill with a pointer notch
export function tag(g, x, y, str, { size = 64, fill = P.paper, ink = P.ink, sub = '', pointer = 'down', alpha = 1, pad = 30 } = {}) {
  g.save(); g.globalAlpha *= alpha; g.font = `800 ${size}px "NW Inter"`; const tw_ = g.measureText(str).width; g.font = `700 ${Math.max(24, size * 0.42)}px "NW Inter"`; const sw = sub ? g.measureText(sub).width : 0;
  const w = Math.max(tw_, sw) + pad * 2, h = size + pad * 1.1 + (sub ? Math.max(24, size * 0.42) * 1.25 : 0);
  shadowed(g, () => { rr(g, x - w / 2, y - h, w, h, h * 0.28); g.fillStyle = fill; g.fill(); if (pointer === 'down') { g.beginPath(); g.moveTo(x - 16, y - 1); g.lineTo(x, y + 20); g.lineTo(x + 16, y - 1); g.closePath(); g.fill(); } }, { blur: 24, dy: 10 });
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `800 ${size}px "NW Inter"`; g.fillStyle = ink; g.fillText(str, x, y - h + pad * 0.55 + size * 0.86);
  if (sub) { g.font = `700 ${Math.max(24, size * 0.42)}px "NW Inter"`; g.fillStyle = P.inkMute; g.fillText(sub, x, y - pad * 0.55); }
  g.restore(); return { w, h };
}
export function pill(g, x, y, str, { size = 34, fill = P.navy, ink = '#fff', align = 'center', pad = 24 } = {}) {
  g.save(); g.font = `800 ${size}px "NW Inter"`; const w = g.measureText(str).width + pad * 2, h = size * 1.7; const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  rr(g, x0, y - h / 2, w, h, h / 2); g.fillStyle = fill; g.fill(); g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(str, x0 + w / 2, y + size * 0.04); g.restore(); return { w, h };
}

// ── SETS (environments) ──────────────────────────────────────────────────────
// A set is a full-frame illustrated context: wall, floor, window light, furniture. Props and the
// character stand IN it. `t` drives a very slow ambient drift (light), never distracting motion.
function windowFrame(g, x, y, w, h, t = 0) {
  shadowed(g, () => { rr(g, x, y, w, h, 14); g.fillStyle = '#fff'; g.fill(); }, { blur: 30, dy: 12 });
  g.save(); rr(g, x + 14, y + 14, w - 28, h - 28, 8); g.clip();
  g.fillStyle = lin(g, 0, y, 0, y + h, [[0, '#CFE6F1'], [1, '#F7EBD3']]); g.fillRect(x, y, w, h);
  // skyline
  const base = y + h - 14; const cols = ['#B9CBD8', '#A9BDCB', '#C9D6DF'];
  const blds = [[0.02, 0.32, 0.5], [0.18, 0.2, 0.34], [0.34, 0.16, 0.6], [0.5, 0.2, 0.42], [0.68, 0.14, 0.3], [0.8, 0.18, 0.52]];
  blds.forEach(([bx, bw, bh], i) => { g.fillStyle = cols[i % 3]; g.fillRect(x + w * bx, base - h * bh, w * bw, h * bh); g.fillStyle = 'rgba(255,255,255,0.35)'; for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) g.fillRect(x + w * bx + w * bw * (0.15 + c * 0.28), base - h * bh + h * bh * (0.08 + r * 0.17), w * bw * 0.16, h * bh * 0.08); });
  // sun glow
  const gl = g.createRadialGradient(x + w * (0.78 + Math.sin(t * 0.05) * 0.005), y + h * 0.22, 0, x + w * 0.78, y + h * 0.22, w * 0.5); gl.addColorStop(0, 'rgba(255,238,190,0.85)'); gl.addColorStop(1, 'rgba(255,238,190,0)'); g.fillStyle = gl; g.fillRect(x, y, w, h);
  g.restore();
  g.strokeStyle = '#fff'; g.lineWidth = 12; g.beginPath(); g.moveTo(x + w / 2, y + 14); g.lineTo(x + w / 2, y + h - 14); g.moveTo(x + 14, y + h * 0.5); g.lineTo(x + w - 14, y + h * 0.5); g.stroke();
}
export function plant(g, x, y, { s = 1 } = {}) {
  g.save(); g.translate(x, y); g.scale(s, s); groundShadow(g, 0, 0, 150, 0.18);
  g.fillStyle = '#4E8F6A'; for (const [a, l] of [[-0.9, 130], [-0.45, 170], [0, 190], [0.45, 165], [0.9, 125]]) { g.save(); g.translate(0, -70); g.rotate(a); g.beginPath(); g.ellipse(0, -l / 2, 24, l / 2, 0, 0, 7); g.fillStyle = a % 2 ? '#5FA37C' : '#4E8F6A'; g.fill(); g.restore(); }
  g.fillStyle = lin(g, -50, -80, 50, 0, [[0, '#E8D2B0'], [1, '#C9A97F']]); g.beginPath(); g.moveTo(-52, -84); g.lineTo(52, -84); g.lineTo(38, 0); g.lineTo(-38, 0); g.closePath(); g.fill(); g.restore();
}
export function shelf(g, x, y, w, { s = 1 } = {}) {
  g.save(); g.translate(x, y); shadowed(g, () => { g.fillStyle = P.woodDark; rr(g, 0, 0, w, 16 * s, 6); g.fill(); }, { blur: 14, dy: 8 });
  // books
  const colors = ['#1A2744', '#C99E4C', '#3C8C88', '#B0413E', '#5B6B8C']; let bx = 24 * s; colors.forEach((c, i) => { const bh = (86 + (i * 17) % 40) * s, bw = (26 + (i * 7) % 12) * s; g.fillStyle = c; rr(g, bx, -bh, bw, bh, 4); g.fill(); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(bx + 4, -bh + 12 * s, bw - 8, 3); bx += bw + 4 * s; });
  // small frame
  g.fillStyle = '#fff'; rr(g, w * 0.55, -104 * s, 78 * s, 96 * s, 6); g.fill(); g.fillStyle = '#DCE7EC'; rr(g, w * 0.55 + 8 * s, -96 * s, 62 * s, 80 * s, 3); g.fill(); g.fillStyle = '#A9C3B5'; g.beginPath(); g.moveTo(w * 0.55 + 8 * s, -16 * s); g.lineTo(w * 0.55 + 30 * s, -52 * s); g.lineTo(w * 0.55 + 46 * s, -30 * s); g.lineTo(w * 0.55 + 56 * s, -44 * s); g.lineTo(w * 0.55 + 70 * s, -16 * s); g.closePath(); g.fill();
  g.restore();
}
// The studio set. `format` = {w,h}. Composition is orientation-aware (window & shelf positions differ).
export function studioSet(g, { w, h, t = 0, floor = 0.72, window: showWindow = true }) {
  // wall
  g.fillStyle = lin(g, 0, 0, 0, h * floor, [[0, '#F8F4EA'], [1, '#EFE7D6']]); g.fillRect(0, 0, w, h * floor);
  // soft wall panels (editorial arches)
  g.fillStyle = 'rgba(201,158,76,0.07)'; g.beginPath(); g.arc(w * 0.16, h * floor * 0.5, Math.min(w, h) * 0.42, 0, 7); g.fill();
  g.fillStyle = 'rgba(26,39,68,0.035)'; g.beginPath(); g.arc(w * 0.86, h * floor * 0.35, Math.min(w, h) * 0.34, 0, 7); g.fill();
  const portrait = h > w;
  if (showWindow) { if (portrait) windowFrame(g, w * 0.5 - 240, h * 0.1, 480, 400, t); else windowFrame(g, w * 0.5 - 300, h * 0.1, 600, 400, t); }
  // baseboard + floor
  g.fillStyle = '#E4DAC6'; g.fillRect(0, h * floor - 14, w, 14);
  g.fillStyle = lin(g, 0, h * floor, 0, h, [[0, '#E5D2AE'], [1, '#D3B98D']]); g.fillRect(0, h * floor, w, h * (1 - floor));
  g.strokeStyle = 'rgba(120,84,46,0.10)'; g.lineWidth = 2; for (let i = 1; i < 9; i++) { const yy = h * floor + ((h * (1 - floor)) * i) / 9; g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke(); }
  if (portrait) { shelf(g, w * 0.04, h * 0.44, w * 0.32, { s: 0.9 }); plant(g, w * 0.9, h * floor + 6, { s: 1.2 }); }
  else { shelf(g, w * 0.06, h * 0.36, w * 0.22); plant(g, w * 0.93, h * floor + 8, { s: 1.5 }); }
  return { floorY: h * floor, floorH: h * (1 - floor) };
}
// clean editorial stage (no furniture): for chart-heavy scenes where data needs the room
export function paperStage(g, { w, h, t = 0 }) {
  g.fillStyle = P.canvas; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(201,158,76,0.10)'; g.beginPath(); g.arc(w * 0.9, h * 0.12, Math.min(w, h) * 0.38, 0, 7); g.fill();
  g.fillStyle = 'rgba(26,39,68,0.045)'; g.beginPath(); g.arc(w * 0.05, h * 0.9, Math.min(w, h) * 0.44, 0, 7); g.fill();
  // fine grid
  g.strokeStyle = 'rgba(26,39,68,0.045)'; g.lineWidth = 2; const step = Math.round(Math.min(w, h) / 14); for (let x = 0; x < w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y < h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
}

// A counter/desk the host stands behind (hides the waist-up crop naturally) and objects stand ON.
// Returns the surface y. Draw it AFTER the character and BEFORE the objects that stand on it.
export function desk(g, { x0 = -200, x1, topY, frontH = 150, bottom }) {
  const w = x1 - x0; if (bottom) frontH = bottom - topY - 26;
  // front panel
  g.fillStyle = lin(g, 0, topY, 0, topY + frontH, [[0, '#B98F5F'], [1, '#9A7248']]); g.fillRect(x0, topY + 26, w, frontH);
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x0, topY + 26, w, 6);
  for (let x = x0 + 120; x < x1; x += 260) { g.strokeStyle = 'rgba(70,44,20,0.18)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, topY + 44); g.lineTo(x, topY + frontH + 20); g.stroke(); }
  // top surface with lip
  shadowed(g, () => { g.fillStyle = lin(g, 0, topY - 8, 0, topY + 30, [[0, '#E2BE8A'], [1, '#CFA872']]); rr(g, x0, topY - 8, w, 38, 10); g.fill(); }, { blur: 26, dy: 14, color: 'rgba(60,36,12,0.28)' });
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x0, topY - 6, w, 4);
  return topY + 6;
}
