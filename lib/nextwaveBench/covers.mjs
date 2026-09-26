// NextWave V2 — BENCHMARK: object-first covers (v2). No avatar-first composition: the evidence IS the picture.
//   shortCoverV2: the $50,000 you "have" (dashed ghost) vs what it buys in 20 years (real stack + a near-empty basket).
//   longThumbV2 : two coin towers (start now vs wait 10 years) and the number that separates them.
import { makeCanvas, P, text, rr, shadowed, drawMoney, fmtMoney, lin, measure } from './core.mjs';
import * as pr from './props.mjs';
import * as p2 from './props2.mjs';
import * as st from './sets.mjs';

export function shortCoverV2({ host, headline = ['Your $50,000', 'is quietly', 'shrinking.'], value, ghost = 50000, label = 'WHAT IT BUYS IN 20 YEARS' }) {
  const W = 1080, H = 1920; const { c, g } = makeCanvas(W, H); const PX = 14; const Y = 1600;
  st.kitchenSet(g, { w: W, h: H, counterY: Y }); pr.desk(g, { x0: -100, x1: W + 100, topY: Y, bottom: H + 20 });
  // headline block on a cream plate (readable at thumbnail size)
  g.save(); g.globalAlpha = 0.92; g.fillStyle = P.canvas; rr(g, 50, 210, 980, 520, 34); g.fill(); g.restore();
  headline.forEach((ln, i) => text(g, ln, 90, 360 + i * 150, { kind: 'display', weight: 800, size: i === 0 ? 132 : 122, color: i === 2 ? P.red : P.ink }));
  // evidence
  const bx = 300; pr.billStack(g, bx, Y + 16, { n: value / 1000, w: 320, th: PX, ground: true });
  g.save(); g.setLineDash([18, 12]); g.strokeStyle = P.red; g.lineWidth = 6; rr(g, bx - 180, Y + 16 - (ghost / 1000) * PX - 8, 360, (ghost / 1000) * PX + 8, 10); g.stroke(); g.restore();
  pr.pill(g, bx, Y + 16 - (ghost / 1000) * PX - 42, `${fmtMoney(ghost)} TODAY`, { size: 34, fill: P.navy });
  const topV = Y + 16 - (value / 1000) * PX; pr.tag(g, bx, topV - 30, fmtMoney(value), { size: 84, sub: label, pad: 28, pointer: 'down' });
  pr.basket(g, 800, Y + 26, { w: 400, fill: 0 }); ['bread', 'milk', 'apple'].forEach((k, i) => p2.grocery(g, k, 690 + i * 120, Y - 14, 1.0));
  if (host) { const s = 0.5 * 1; const cw = host.w * s, ch = host.h * s; }
  g.fillStyle = P.ink; text(g, 'NEXTWAVE', 70, 150, { weight: 900, size: 44, color: P.ink, spacing: 4 }); g.fillStyle = P.gold; g.fillRect(70, 168, 96, 7);
  return c;
}

export function longThumbV2({ nora, owen, gap, host }) {
  const W = 1280, H = 720; const { c, g } = makeCanvas(W, H);
  g.fillStyle = lin(g, 0, 0, W, H, [[0, '#FBF8F1'], [1, '#EFE7D6']]); g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(201,158,76,0.14)'; g.beginPath(); g.arc(1010, 300, 330, 0, 7); g.fill();
  // ledge
  const LY = 640; g.fillStyle = lin(g, 0, LY, 0, H, [[0, '#D9B98C'], [1, '#B58F63']]); g.fillRect(0, LY, W, H - LY); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(0, LY, W, 6);
  const per = 6000, th = 5.0; const nn = nora / per, no = owen / per;
  pr.coinStack(g, 900, LY + 4, { n: nn, w: 190, th }); pr.coinStack(g, 1130, LY + 4, { n: no, w: 190, th });
  const yN = LY - nn * th, yO = LY - no * th;
  g.save(); g.setLineDash([12, 9]); g.strokeStyle = P.red; g.lineWidth = 5; g.beginPath(); g.moveTo(900, yO); g.lineTo(1250, yO); g.moveTo(1000, yN + 4); g.lineTo(1245, yN + 4); g.stroke(); g.setLineDash([]); g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(1245, yN + 4); g.lineTo(1245, yO); g.moveTo(1231, yN + 4); g.lineTo(1259, yN + 4); g.stroke(); g.restore();
  pr.pill(g, 900, LY + 44, 'STARTS NOW', { size: 26, fill: P.goldDark }); pr.pill(g, 1150, LY + 44, 'WAITS 10 YEARS', { size: 26, fill: P.navy });
  // the number
  text(g, 'WAITING 10 YEARS COSTS', 70, 150, { weight: 900, size: 40, color: P.inkMute, spacing: 3 });
  drawMoney(g, fmtMoney(gap), 62, 330, { size: 160, color: P.red });
  text(g, 'Same $350 a month.', 70, 415, { kind: 'display', weight: 700, size: 50, color: P.ink }); text(g, 'Same 7% return.', 70, 480, { kind: 'display', weight: 700, size: 50, color: P.ink });
  text(g, 'ONLY THE START DATE CHANGED', 70, 560, { weight: 900, size: 34, color: P.goldDark, spacing: 2 });
  g.fillStyle = P.ink; text(g, 'NEXTWAVE', 70, 690, { weight: 900, size: 30, color: '#fff', spacing: 3 });
  return c;
}
