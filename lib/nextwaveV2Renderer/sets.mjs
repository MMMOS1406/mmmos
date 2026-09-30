// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: environment families (full-frame illustrated contexts).
//   studio (props.mjs)  — evidence desk          kitchen — household / everyday prices
//   city                — investment / skyline    road    — timeline / decision (side-scrolling, wider than the frame)
//   office              — work / paycheck
// Every set paints its whole frame (or world width), leaves a clear "stage" band for objects and data, and
// returns the y of the surface objects stand on. No text, no pseudo-text.
import { P, rr, lin, shadowed, groundShadow } from './core.mjs';
import { plant } from './props.mjs';

const K = (a, b, t) => a + (b - a) * t;

export function kitchenSet(g, { w, h, t = 0, counterY = h * 0.62 }) {
  // sage wall + tile backsplash
  g.fillStyle = lin(g, 0, 0, 0, counterY, [[0, '#E4EBDD'], [1, '#D3DFCB']]); g.fillRect(0, 0, w, counterY);
  const ty = counterY - h * 0.2; g.fillStyle = '#F6F3EA'; g.fillRect(0, ty, w, counterY - ty);
  g.strokeStyle = 'rgba(26,39,68,0.10)'; g.lineWidth = 3; const tile = Math.max(70, w / 16);
  for (let x = 0; x < w; x += tile) { g.beginPath(); g.moveTo(x, ty); g.lineTo(x, counterY); g.stroke(); } for (let y = ty; y < counterY; y += tile * 0.6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  // upper cabinets
  const cw = Math.max(240, w / 6); for (let x = 20; x < w - cw / 2; x += cw + 16) { shadowed(g, () => { rr(g, x, h * 0.05, cw, h * 0.2, 14); g.fillStyle = lin(g, 0, 0, 0, h * 0.25, [[0, '#F3ECDD'], [1, '#E7DDC9']]); g.fill(); }, { blur: 20, dy: 8 }); g.fillStyle = P.goldDark; rr(g, x + cw / 2 - 26, h * 0.05 + h * 0.2 - 34, 52, 10, 5); g.fill(); }
  // window (light)
  const wx = w * 0.42, wy = h * 0.3, ww = Math.min(420, w * 0.3), wh = Math.min(300, h * 0.16);
  if (w > 900) { rr(g, wx, wy, ww, wh, 16); g.fillStyle = lin(g, 0, wy, 0, wy + wh, [[0, '#CDE6F2'], [1, '#F7EBD3']]); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 12; g.stroke(); g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.stroke(); }
  // counter: stone top + wood front
  g.fillStyle = lin(g, 0, counterY, 0, counterY + 40, [[0, '#F1ECE0'], [1, '#DCD4C2']]); g.fillRect(0, counterY - 6, w, 46);
  g.fillStyle = lin(g, 0, counterY + 40, 0, h, [[0, '#C9A57A'], [1, '#A98459']]); g.fillRect(0, counterY + 40, w, h - counterY - 40);
  g.strokeStyle = 'rgba(70,44,20,0.16)'; g.lineWidth = 3; for (let x = 0; x < w; x += 240) { g.beginPath(); g.moveTo(x, counterY + 60); g.lineTo(x, h); g.stroke(); }
  if (w > 900) { // fridge at right edge
    shadowed(g, () => { rr(g, w - 250, h * 0.16, 240, counterY - h * 0.16 + 30, 18); g.fillStyle = lin(g, w - 250, 0, w - 10, 0, [[0, '#EEF2F5'], [1, '#D5DEE6']]); g.fill(); }, { blur: 24, dy: 10 });
    g.strokeStyle = '#C3CDD6'; g.lineWidth = 4; g.beginPath(); g.moveTo(w - 250, h * 0.42); g.lineTo(w - 10, h * 0.42); g.stroke(); g.fillStyle = '#B8C3CD'; rr(g, w - 224, h * 0.3, 12, 90, 6); g.fill(); rr(g, w - 224, h * 0.46, 12, 90, 6); g.fill();
  }
  return { surfaceY: counterY + 6 };
}

export function citySet(g, { w, h, t = 0, deskY = h * 0.72 }) {
  // dusk sky + glow
  g.fillStyle = lin(g, 0, 0, 0, deskY, [[0, '#B9C6E4'], [0.55, '#F1D9C4'], [1, '#F7E8CB']]); g.fillRect(0, 0, w, deskY);
  const sun = g.createRadialGradient(w * 0.72, deskY * 0.72, 0, w * 0.72, deskY * 0.72, w * 0.5); sun.addColorStop(0, 'rgba(255,236,190,0.95)'); sun.addColorStop(1, 'rgba(255,236,190,0)'); g.fillStyle = sun; g.fillRect(0, 0, w, deskY);
  // skyline layers (far -> near)
  const layers = [{ c: '#A9B6D3', hh: 0.34, n: 9, seed: 3 }, { c: '#8C9CC0', hh: 0.26, n: 7, seed: 7 }, { c: '#6F82AB', hh: 0.18, n: 6, seed: 11 }];
  layers.forEach((L, li) => { let x = -40; let s = L.seed; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    while (x < w + 60) { const bw = w / L.n * (0.7 + rnd() * 0.7); const bh = deskY * L.hh * (0.6 + rnd() * 0.8); g.fillStyle = L.c; g.fillRect(x, deskY - bh, bw, bh + 4);
      g.fillStyle = 'rgba(255,255,255,0.22)'; for (let r = 0; r < bh / 46; r++) for (let c = 0; c < bw / 34; c++) if (rnd() > 0.35) g.fillRect(x + 12 + c * 34, deskY - bh + 14 + r * 46, 14, 20); x += bw + 4; } });
  // window mullions (a big glass wall)
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 14; const cols = Math.max(2, Math.round(w / 640)); for (let i = 1; i < cols; i++) { const x = (w * i) / cols; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, deskY); g.stroke(); }
  g.beginPath(); g.moveTo(0, deskY * 0.5); g.lineTo(w, deskY * 0.5); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.moveTo(w * 0.1, 0); g.lineTo(w * 0.28, 0); g.lineTo(w * 0.16, deskY); g.lineTo(w * -0.02, deskY); g.closePath(); g.fill();
  // floor / carpet under the desk
  g.fillStyle = lin(g, 0, deskY, 0, h, [[0, '#6A5B7B'], [1, '#54476A']]); g.fillRect(0, deskY, w, h - deskY);
  return { surfaceY: deskY };
}

export function officeSet(g, { w, h, t = 0, deskY = h * 0.72 }) {
  g.fillStyle = lin(g, 0, 0, 0, deskY, [[0, '#EEF0F4'], [1, '#E2E6EE']]); g.fillRect(0, 0, w, deskY);
  // pin board + shelves (no text)
  shadowed(g, () => { rr(g, w * 0.05, h * 0.1, w * 0.22, h * 0.26, 14); g.fillStyle = '#D9B98C'; g.fill(); }, { blur: 16, dy: 8 });
  const notes = [['#FFE08A', 0.02, 0.03, -0.06], ['#BFE3D1', 0.09, 0.07, 0.05], ['#FFC9BF', 0.14, 0.03, 0.03], ['#C6D6F2', 0.06, 0.14, -0.03]]; notes.forEach(([c, dx, dy, r]) => { g.save(); g.translate(w * (0.05 + dx), h * (0.1 + dy)); g.rotate(r); g.fillStyle = c; g.fillRect(0, 0, w * 0.06, h * 0.07); g.fillStyle = 'rgba(26,39,68,0.2)'; g.fillRect(8, 12, w * 0.04, 6); g.fillRect(8, 28, w * 0.03, 6); g.restore(); });
  // window with skyline
  const wx = w * 0.42, wy = h * 0.08, ww = w * 0.34, wh = h * 0.3; rr(g, wx, wy, ww, wh, 12); g.fillStyle = lin(g, 0, wy, 0, wy + wh, [[0, '#CFE6F1'], [1, '#F1E7D2']]); g.fill(); g.fillStyle = '#B9CBD8'; for (let i = 0; i < 6; i++) g.fillRect(wx + ww * (0.05 + i * 0.16), wy + wh * (0.55 - (i % 3) * 0.12), ww * 0.11, wh * 0.5); g.strokeStyle = '#fff'; g.lineWidth = 10; rr(g, wx, wy, ww, wh, 12); g.stroke();
  // desk surface + front
  g.fillStyle = lin(g, 0, deskY, 0, h, [[0, '#D9B98C'], [1, '#B58F63']]); g.fillRect(0, deskY, w, h - deskY); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, deskY, w, 6);
  // monitor
  const mx = w * 0.62, my = deskY - h * 0.3; shadowed(g, () => { rr(g, mx, my, w * 0.2, h * 0.22, 12); g.fillStyle = '#20293F'; g.fill(); }, { blur: 20, dy: 10 }); rr(g, mx + 10, my + 10, w * 0.2 - 20, h * 0.22 - 20, 6); g.fillStyle = lin(g, 0, my, 0, my + h * 0.22, [[0, '#3C5A8C'], [1, '#243654']]); g.fill();
  g.fillStyle = '#20293F'; g.fillRect(mx + w * 0.09, my + h * 0.22, w * 0.02, h * 0.05); g.fillRect(mx + w * 0.06, my + h * 0.27 - 4, w * 0.08, 10);
  // mug + plant
  g.fillStyle = '#fff'; rr(g, w * 0.86, deskY - 84, 70, 84, 10); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(w * 0.86 + 74, deskY - 44, 22, -1.2, 1.2); g.stroke(); g.fillStyle = 'rgba(120,84,46,0.85)'; g.fillRect(w * 0.86 + 6, deskY - 74, 58, 10);
  plant(g, w * 0.95, deskY + 6, { s: 1.1 });
  return { surfaceY: deskY + 6 };
}

// Side-scrolling timeline road: hills, a straight road, milestone posts. World is wider than the frame; the
// camera pans along it. `posts` = x positions where milestones stand (labels drawn by the scene).
export function roadSet(g, { w, h, t = 0, roadY = h * 0.72, posts = [] }) {
  g.fillStyle = lin(g, 0, 0, 0, roadY, [[0, '#BFDDEB'], [1, '#F6EBD3']]); g.fillRect(0, 0, w, roadY);
  const sun = g.createRadialGradient(w * 0.85, h * 0.14, 0, w * 0.85, h * 0.14, h * 0.32); sun.addColorStop(0, 'rgba(255,240,196,0.95)'); sun.addColorStop(1, 'rgba(255,240,196,0)'); g.fillStyle = sun; g.fillRect(0, 0, w, roadY);
  // clouds
  g.fillStyle = 'rgba(255,255,255,0.85)'; [[0.12, 0.12], [0.36, 0.2], [0.6, 0.09], [0.82, 0.24]].forEach(([cx, cy]) => { g.beginPath(); for (let i = 0; i < 4; i++) g.arc(w * cx + i * 46, h * cy + (i % 2) * -14, 44 - i * 4, 0, 7); g.fill(); });
  // hills
  [['#9FCBA9', 0.62, 0.9], ['#7DB48E', 0.68, 1.3]].forEach(([c, y0, f]) => { g.fillStyle = c; g.beginPath(); g.moveTo(0, roadY); for (let x = 0; x <= w; x += 40) g.lineTo(x, h * y0 - Math.sin(x / (w / (3.2 * f))) * h * 0.06 - Math.sin(x / 260) * 10); g.lineTo(w, roadY); g.closePath(); g.fill(); });
  // trees along the road
  for (let x = 120; x < w; x += 430) { g.fillStyle = '#6B4F35'; g.fillRect(x - 8, roadY - 120, 16, 120); g.fillStyle = '#5FA37C'; g.beginPath(); g.arc(x, roadY - 150, 60, 0, 7); g.fill(); g.fillStyle = '#4E8F6A'; g.beginPath(); g.arc(x + 26, roadY - 130, 40, 0, 7); g.fill(); }
  // road
  g.fillStyle = '#B9A98D'; g.fillRect(0, roadY, w, h - roadY); g.fillStyle = '#A99A7E'; g.fillRect(0, roadY + 6, w, 10);
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 8; g.setLineDash([46, 34]); g.beginPath(); g.moveTo(0, roadY + (h - roadY) * 0.55); g.lineTo(w, roadY + (h - roadY) * 0.55); g.stroke(); g.setLineDash([]);
  // milestone posts
  posts.forEach((px) => { g.fillStyle = '#8F6B45'; g.fillRect(px - 9, roadY - 220, 18, 226); g.fillStyle = P.goldDark; rr(g, px - 20, roadY - 236, 40, 22, 6); g.fill(); });
  return { surfaceY: roadY + 20 };
}

// redraw the front of a counter/desk/hedge OVER the host so a waist-up figure stands behind it
export function counterFront(g, { w, y, h, kind = 'wood' }) {
  if (kind === 'hedge') { g.fillStyle = '#4E8F6A'; for (let x = -60; x < w + 60; x += 110) { g.beginPath(); g.arc(x, y + 30, 90, Math.PI, 0); g.fill(); } g.fillStyle = '#5FA37C'; g.fillRect(-60, y + 24, w + 120, h - y); return; }
  g.fillStyle = lin(g, 0, y, 0, h, [[0, '#C9A57A'], [1, '#A98459']]); g.fillRect(0, y, w, h - y);
  g.fillStyle = lin(g, 0, y - 6, 0, y + 40, [[0, '#F1ECE0'], [1, '#DCD4C2']]); g.fillRect(0, y - 6, w, 46);
  g.strokeStyle = 'rgba(70,44,20,0.16)'; g.lineWidth = 3; for (let x = 0; x < w; x += 240) { g.beginPath(); g.moveTo(x, y + 60); g.lineTo(x, h); g.stroke(); }
}
