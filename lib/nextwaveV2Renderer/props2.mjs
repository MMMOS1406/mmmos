// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: second prop family (topic metaphors). Bottom-centre anchored.
import { P, rr, lin, shadowed, groundShadow, text } from './core.mjs';
import { coinStack, billStack, bill } from './props.mjs';

// Piggy bank (savings). `coin` 0..1 drops a coin into the slot.
export function piggy(g, x, y, { w = 300, coin = -1, ground = true, blink = false } = {}) {
  const W = w, H = W * 0.72; if (ground) groundShadow(g, x, y, W * 1.05, 0.24);
  g.save(); g.translate(x, y);
  // legs
  g.fillStyle = '#E58FA0'; rr(g, -W * 0.3, -H * 0.2, W * 0.14, H * 0.22, 8); g.fill(); rr(g, W * 0.16, -H * 0.2, W * 0.14, H * 0.22, 8); g.fill();
  // body
  shadowed(g, () => { g.fillStyle = lin(g, 0, -H, 0, -H * 0.1, [[0, '#F8B4C2'], [1, '#EE94A6']]); g.beginPath(); g.ellipse(0, -H * 0.55, W * 0.44, H * 0.42, 0, 0, 7); g.fill(); }, { blur: 16, dy: 8 });
  // ear
  g.fillStyle = '#EE94A6'; g.beginPath(); g.moveTo(W * 0.14, -H * 0.9); g.lineTo(W * 0.3, -H * 1.08); g.lineTo(W * 0.34, -H * 0.82); g.closePath(); g.fill();
  // snout
  g.fillStyle = '#F4A0B2'; g.beginPath(); g.ellipse(W * 0.44, -H * 0.55, W * 0.11, H * 0.19, 0, 0, 7); g.fill(); g.fillStyle = '#C96F82'; g.beginPath(); g.ellipse(W * 0.46, -H * 0.6, 6, 10, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(W * 0.46, -H * 0.48, 6, 10, 0, 0, 7); g.fill();
  // eye + cheek
  g.fillStyle = P.ink; g.beginPath(); g.ellipse(W * 0.25, -H * 0.7, 9, blink ? 2 : 11, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(-W * 0.15, -H * 0.85, W * 0.14, H * 0.07, -0.3, 0, 7); g.fill();
  // tail
  g.strokeStyle = '#EE94A6'; g.lineWidth = 10; g.lineCap = 'round'; g.beginPath(); g.arc(-W * 0.46, -H * 0.6, 22, 0.3, 4.6); g.stroke();
  // slot (on top)
  g.fillStyle = '#B85F73'; rr(g, -W * 0.1, -H * 0.97, W * 0.2, 12, 6); g.fill();
  if (coin >= 0 && coin <= 1) { const cy = -H * 1.75 + coin * H * 0.78; g.save(); g.globalAlpha = coin < 0.9 ? 1 : 1 - (coin - 0.9) * 10; g.fillStyle = lin(g, -30, cy - 30, 30, cy + 30, [[0, '#F2D384'], [1, '#D9A94A']]); g.beginPath(); g.ellipse(0, cy, 32, 32, 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(166,124,46,0.8)'; g.lineWidth = 4; g.beginPath(); g.arc(0, cy, 22, 0, 7); g.stroke(); g.restore(); }
  g.restore();
}

// Growth tree: canopy fullness = `grow` (0..1); coins hang in the canopy proportional to grow.
export function tree(g, x, y, { h = 520, grow = 1, coins = 0, ground = true } = {}) {
  const H = h; if (ground) groundShadow(g, x, y, H * 0.5, 0.2);
  g.save(); g.translate(x, y);
  const trunkH = H * (0.25 + 0.35 * grow), tw_ = 26 + 26 * grow;
  g.fillStyle = lin(g, -tw_, 0, tw_, 0, [[0, '#7B5A3A'], [1, '#5E432A']]); g.beginPath(); g.moveTo(-tw_ / 2, 0); g.lineTo(-tw_ / 3, -trunkH); g.lineTo(tw_ / 3, -trunkH); g.lineTo(tw_ / 2, 0); g.closePath(); g.fill();
  const r = H * (0.10 + 0.22 * grow); const cy = -trunkH - r * 0.5; const blobs = [[0, 0, 1], [-0.75, 0.25, 0.75], [0.75, 0.25, 0.75], [-0.35, -0.6, 0.72], [0.4, -0.55, 0.7]];
  blobs.forEach(([bx, by, s], i) => { g.fillStyle = i % 2 ? '#5FA37C' : '#4E8F6A'; g.beginPath(); g.arc(bx * r, cy + by * r, r * s, 0, 7); g.fill(); });
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(-r * 0.3, cy - r * 0.35, r * 0.5, 0, 7); g.fill();
  const n = Math.round(coins); for (let i = 0; i < n; i++) { const a = i * 2.4, rad = r * (0.25 + ((i * 37) % 60) / 100); const cx = Math.cos(a) * rad * 1.15, cyy = cy + Math.sin(a) * rad * 0.9; g.fillStyle = '#E8C46A'; g.beginPath(); g.arc(cx, cyy, 17, 0, 7); g.fill(); g.strokeStyle = '#A67C2E'; g.lineWidth = 3; g.stroke(); }
  g.restore(); return { top: y - trunkH - r * 1.6 };
}

// Stack split into what YOU put in (bills) and what it EARNED (coins): height = value, one scale.
export function splitStack(g, x, y, { put = 0, earned = 0, pxPerK = 3, w = 200, ground = true } = {}) {
  if (ground) groundShadow(g, x, y, w * 1.2, 0.24);
  const billTh = Math.max(3, pxPerK), billsN = put / 1000; // one bill per $1K
  const r1 = billStack(g, x, y, { n: Math.max(0.01, billsN), w, th: billTh, ground: false });
  const bh = Math.max(1, billsN) * billTh; const coinTh = pxPerK * 2; // one coin per $2K
  coinStack(g, x, y - bh - 4, { n: earned / 2000, w: w * 0.86, th: coinTh, ground: false });
  return { top: y - bh - (earned / 2000) * coinTh - 40, splitY: y - bh };
}

// Signboard on a post (milestone). Label is programmatic text.
export function signboard(g, x, y, label, { h = 260, size = 40, alpha = 1 } = {}) {
  g.save(); g.globalAlpha *= alpha; g.translate(x, y); g.fillStyle = '#8F6B45'; g.fillRect(-9, -h, 18, h);
  g.font = `800 ${size}px "NW Inter"`; const w = g.measureText(label).width + 56;
  shadowed(g, () => { rr(g, -w / 2, -h - 74, w, 74, 14); g.fillStyle = P.paper; g.fill(); }, { blur: 16, dy: 8 }); g.fillStyle = P.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, -h - 34);
  g.restore();
}

// Calendar with a highlighted day (time passing).
export function calendar(g, x, y, { w = 260, day = 12, flip = 0, ground = true } = {}) {
  const W = w, H = W * 0.95; if (ground) groundShadow(g, x, y, W * 1.05, 0.2);
  g.save(); g.translate(x - W / 2, y - H);
  shadowed(g, () => { rr(g, 0, 0, W, H, 16); g.fillStyle = '#fff'; g.fill(); }, { blur: 18, dy: 10 }); g.fillStyle = P.red; rr(g, 0, 0, W, H * 0.22, 16); g.fill(); g.fillRect(0, H * 0.12, W, H * 0.1);
  g.fillStyle = '#fff'; for (const cx of [0.22, 0.78]) { g.beginPath(); g.arc(W * cx, 8, 9, 0, 7); g.fill(); }
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) { const i = r * 5 + c; const cx = W * (0.14 + c * 0.18), cy = H * (0.38 + r * 0.17); const on = i === day; if (on) { g.fillStyle = P.gold; g.beginPath(); g.arc(cx, cy, W * 0.075, 0, 7); g.fill(); } else { g.fillStyle = 'rgba(26,39,68,0.16)'; g.beginPath(); g.arc(cx, cy, W * 0.03, 0, 7); g.fill(); } }
  g.restore();
}

// Grocery items (no text): bread, milk, apple, cheese, carrot, tomato
export function grocery(g, kind, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s); groundShadow(g, 0, 0, 120, 0.18);
  if (kind === 'bread') { g.fillStyle = lin(g, 0, -110, 0, 0, [[0, '#E6B36E'], [1, '#C98F4A']]); rr(g, -80, -100, 160, 100, 46); g.fill(); g.strokeStyle = '#B67D3E'; g.lineWidth = 6; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-40 + i * 40, -84); g.lineTo(-28 + i * 40, -40); g.stroke(); } }
  else if (kind === 'milk') { g.fillStyle = '#F7FAFC'; rr(g, -40, -150, 80, 150, 8); g.fill(); g.fillStyle = '#4C86C5'; g.fillRect(-40, -110, 80, 44); g.fillStyle = '#F7FAFC'; g.beginPath(); g.moveTo(-40, -150); g.lineTo(-24, -184); g.lineTo(24, -184); g.lineTo(40, -150); g.closePath(); g.fill(); g.strokeStyle = 'rgba(26,39,68,0.15)'; g.lineWidth = 3; rr(g, -40, -150, 80, 150, 8); g.stroke(); }
  else if (kind === 'apple') { g.fillStyle = lin(g, -50, -100, 50, 0, [[0, '#DB5A4E'], [1, '#B8362E']]); g.beginPath(); g.arc(-18, -48, 46, 0, 7); g.arc(18, -48, 46, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(-26, -66, 10, 16, -0.5, 0, 7); g.fill(); g.fillStyle = '#4E8F5C'; g.beginPath(); g.ellipse(14, -104, 26, 12, -0.5, 0, 7); g.fill(); g.strokeStyle = '#6B4F35'; g.lineWidth = 6; g.beginPath(); g.moveTo(0, -92); g.lineTo(0, -112); g.stroke(); }
  else if (kind === 'cheese') { g.fillStyle = '#F2C94C'; g.beginPath(); g.moveTo(-90, 0); g.lineTo(90, 0); g.lineTo(90, -60); g.lineTo(-90, -110); g.closePath(); g.fill(); g.fillStyle = '#D9A92E'; [[-40, -30, 12], [30, -24, 9], [60, -44, 8]].forEach(([cx, cy, r]) => { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); }); }
  else if (kind === 'carrot') { g.fillStyle = '#EE8A3E'; g.beginPath(); g.moveTo(-30, -90); g.lineTo(30, -90); g.lineTo(0, 0); g.closePath(); g.fill(); g.fillStyle = '#5FA37C'; for (const dx of [-16, 0, 16]) { g.beginPath(); g.ellipse(dx, -112, 8, 26, dx / 60, 0, 7); g.fill(); } }
  g.restore();
}
