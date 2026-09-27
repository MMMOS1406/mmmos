// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: illustrated-asset helpers (Phase 1C).
// Ideogram backdrops/props are illustration only; every label, figure and value-encoded height is drawn here.
import { join } from 'node:path';
import { P, rr, lin, shadowed, groundShadow, loadSprite } from './core.mjs';
const F = {
  roadWide: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_road_wide.png'),
  roadTall: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_road_tall.png'),
  kitchenWide: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_kitchen_wide.png'),
  kitchenTall: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_kitchen_tall.png'),
  wagon: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'prop_wagon.png'),
  bag: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'prop_bag.png'),
  chest: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'prop_chest.png'),
  beach: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'prop_beach.png'),
  coastWide: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_coast_wide.png'),
  coastTall: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_coast_tall.png'),
  hoodWide: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_neighborhood_wide.png'),
  hoodTall: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_neighborhood_tall.png'),
  finWide: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_finance_wide.png'),
  finTall: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_finance_tall.png'),
  nightWide: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'bg_road_night_wide.png'),
  cartSacks: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'cart_sacks.png'),
  cartChest: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'cart_chest.png'),
  cartPiggy: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'cart_piggy.png'),
  cartHome: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'cart_home.png'),
  propHouse: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'prop_house.png'),
  propToll: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'prop_toll.png'),
  propPiggy: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'prop_piggy.png'),
};
export async function loadBench() {
  const L = async (f) => { const img = await loadSprite(f); return { img, w: img.width, h: img.height }; };
  return { bg: { roadWide: await L(F.roadWide), roadTall: await L(F.roadTall), kitchenWide: await L(F.kitchenWide), kitchenTall: await L(F.kitchenTall), coastWide: await L(F.coastWide), coastTall: await L(F.coastTall), hoodWide: await L(F.hoodWide), hoodTall: await L(F.hoodTall), finWide: await L(F.finWide), finTall: await L(F.finTall), nightWide: await L(F.nightWide) }, prop: { wagon: await L(F.wagon), bag: await L(F.bag), chest: await L(F.chest), beach: await L(F.beach), cartSacks: await L(F.cartSacks), cartChest: await L(F.cartChest), cartPiggy: await L(F.cartPiggy), cartHome: await L(F.cartHome), house: await L(F.propHouse), toll: await L(F.propToll), piggy: await L(F.propPiggy) } };
}
// cover-fit a backdrop into (w,h); ax/ay = anchor 0..1 for the crop
export function coverImage(g, s, w, h, { ax = 0.5, ay = 0.5, x = 0, y = 0 } = {}) {
  const k = Math.max(w / s.w, h / s.h), dw = s.w * k, dh = s.h * k; g.drawImage(s.img, x - (dw - w) * ax, y - (dh - h) * ay, dw, dh);
}
// sprite bottom-centred at (x,y), scaled to width w
export function sprite(g, s, x, y, w, { flip = false, alpha = 1 } = {}) {
  const k = w / s.w, dh = s.h * k; g.save(); g.globalAlpha *= alpha; g.translate(x, y); if (flip) g.scale(-1, 1); g.drawImage(s.img, -w / 2, -dh, w, dh); g.restore(); return { w, h: dh };
}
// heap of gold coins whose HEIGHT is the value (caller supplies px height)
export function coinHeap(g, cx, baseY, w, h, seed = 3) {
  if (h < 2) return; g.save(); g.beginPath(); g.moveTo(cx - w / 2, baseY); g.bezierCurveTo(cx - w / 2, baseY - h * 0.15, cx - w * 0.28, baseY - h, cx, baseY - h); g.bezierCurveTo(cx + w * 0.28, baseY - h, cx + w / 2, baseY - h * 0.15, cx + w / 2, baseY); g.closePath();
  g.fillStyle = lin(g, 0, baseY - h, 0, baseY, [[0, '#F2D384'], [1, '#C99E4C']]); g.fill(); g.clip();
  let r = seed; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 90; i++) { const px = cx + (rnd() - 0.5) * w * 0.95, py = baseY - rnd() * h; g.fillStyle = rnd() > 0.5 ? '#E8C46A' : '#D9A94A'; g.beginPath(); g.ellipse(px, py, 15, 9, (rnd() - 0.5) * 0.6, 0, 7); g.fill(); g.strokeStyle = 'rgba(166,124,46,0.75)'; g.lineWidth = 2.5; g.stroke(); }
  g.restore();
}
// level-crossing style gate: `open` 0..1 lifts the arm
export function gate(g, x, y, { open = 0, h = 190, w = 190 } = {}) {
  g.save(); g.translate(x, y); g.fillStyle = '#6B4F35'; rr(g, -14, -h, 28, h, 6); g.fill();
  g.translate(0, -h + 26); g.rotate(-open * 1.25); const n = 6, sw = w / n; for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#fff' : P.red; g.fillRect(i * sw, -11, sw, 22); } g.strokeStyle = 'rgba(26,39,68,0.4)'; g.lineWidth = 3; g.strokeRect(0, -11, w, 22);
  g.restore();
}
export function pathRibbon(g, x0, x1, y, { h = 80, alpha = 0.9 } = {}) {
  g.save(); g.globalAlpha = alpha; g.fillStyle = lin(g, 0, y, 0, y + h, [[0, '#D8BC8E'], [1, '#B99668']]); rr(g, x0, y, x1 - x0, h, 20); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 4; g.setLineDash([26, 20]); g.beginPath(); g.moveTo(x0 + 20, y + h / 2); g.lineTo(x1 - 20, y + h / 2); g.stroke(); g.restore();
}
export function flagPole(g, x, y, h, { color = P.green, wave = 0, size = 70 } = {}) {
  g.save(); g.translate(x, y); g.fillStyle = '#6B4F35'; g.fillRect(-4, -h, 8, h); g.fillStyle = color; g.beginPath(); g.moveTo(4, -h); g.lineTo(4 + size * 1.5, -h + size * 0.35 + Math.sin(wave) * 4); g.lineTo(4, -h + size * 0.8); g.closePath(); g.fill(); g.restore();
}
