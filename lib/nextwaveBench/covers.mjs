// NextWave V2 — BENCHMARK: object-first covers (v2). No avatar-first composition: the evidence IS the picture.
//   shortCoverV2: the $50,000 you "have" (dashed ghost) vs what it buys in 20 years (real stack + a near-empty basket).
//   longThumbV2 : two coin towers (start now vs wait 10 years) and the number that separates them.
import { makeCanvas, P, text, rr, shadowed, drawMoney, fmtMoney, lin, measure } from './core.mjs';
import * as pr from './props.mjs';
import * as p2 from './props2.mjs';
import * as st from './sets.mjs';
import * as p3 from './props3.mjs';

export function shortCoverV2({ bench, host, headline = ['Your $50,000', 'is quietly', 'shrinking.'], value, ghost = 50000, label = 'WHAT IT BUYS IN 20 YEARS' }) {
  const W = 1080, H = 1920; const { c, g } = makeCanvas(W, H); const PX = 14; const Y = 1600;
  p3.coverImage(g, bench.bg.kitchenTall, W, H, { ay: 0.2 }); pr.desk(g, { x0: -100, x1: W + 100, topY: Y, bottom: H + 20 });
  // headline block on a cream plate (readable at thumbnail size)
  g.save(); g.globalAlpha = 0.92; g.fillStyle = P.canvas; rr(g, 50, 210, 980, 520, 34); g.fill(); g.restore();
  headline.forEach((ln, i) => text(g, ln, 90, 360 + i * 150, { kind: 'display', weight: 800, size: i === 0 ? 132 : 122, color: i === 2 ? P.red : P.ink }));
  // evidence
  const bx = 300; pr.billStack(g, bx, Y + 16, { n: value / 1000, w: 320, th: PX, ground: true });
  g.save(); g.setLineDash([18, 12]); g.strokeStyle = P.red; g.lineWidth = 6; rr(g, bx - 180, Y + 16 - (ghost / 1000) * PX - 8, 360, (ghost / 1000) * PX + 8, 10); g.stroke(); g.restore();
  pr.pill(g, bx, Y + 16 - (ghost / 1000) * PX - 42, `${fmtMoney(ghost)} TODAY`, { size: 34, fill: P.navy });
  const topV = Y + 16 - (value / 1000) * PX; pr.tag(g, bx, topV - 30, fmtMoney(value), { size: 84, sub: label, pad: 28, pointer: 'down' });
  { const f = value / ghost, bw = 360; g.save(); g.setLineDash([16, 12]); g.strokeStyle = P.red; g.lineWidth = 6; g.globalAlpha = 0.85; const bh = bw * bench.prop.bag.h / bench.prop.bag.w; rr(g, 800 - bw / 2 - 8, Y + 26 - bh - 8, bw + 16, bh + 8, 16); g.stroke(); g.restore(); p3.sprite(g, bench.prop.bag, 800, Y + 26, bw * (0.4 + 0.6 * f)); }
  if (host) { const s = 0.5 * 1; const cw = host.w * s, ch = host.h * s; }
  g.fillStyle = P.ink; text(g, 'NEXTWAVE', 70, 150, { weight: 900, size: 44, color: P.ink, spacing: 4 }); g.fillStyle = P.gold; g.fillRect(70, 168, 96, 7);
  return c;
}

export function longThumbV2({ bench, nora, owen, gap, host }) {
  const W = 1280, H = 720; const { c, g } = makeCanvas(W, H);
  p3.coverImage(g, bench.bg.roadWide, W, H, { ay: 0.65 }); g.fillStyle = lin(g, 0, 0, W, 0, [[0, 'rgba(251,248,241,0.96)'], [0.55, 'rgba(251,248,241,0.88)'], [1, 'rgba(251,248,241,0)']]); g.fillRect(0, 0, W, H);
  const TOP = 450000; const hp = (v) => (v / TOP) * 175;
  const lane = (y, val, name, col, x) => { p3.pathRibbon(g, 640, W, y - 4, { h: 60, alpha: 0.85 }); const wgn = bench.prop.wagon; const s = p3.sprite(g, wgn, x, y + 22, 270); const rim = y + 22 - s.h * 0.44; p3.coinHeap(g, x + 8, rim + 4, 180, hp(val), 5); g.save(); g.beginPath(); g.rect(x - 160, rim + 8, 320, s.h); g.clip(); p3.sprite(g, wgn, x, y + 22, 270); g.restore(); pr.pill(g, x, y + 70, name, { size: 26, fill: col }); return rim; };
  lane(340, nora, 'STARTS NOW', P.goldDark, 1040); lane(610, owen, 'WAITS 10 YEARS', P.navy, 1040);
  // the number
  text(g, 'WAITING 10 YEARS COSTS', 70, 150, { weight: 900, size: 40, color: P.inkMute, spacing: 3 });
  drawMoney(g, fmtMoney(gap), 62, 330, { size: 160, color: P.red });
  text(g, 'Same $350 a month.', 70, 415, { kind: 'display', weight: 700, size: 50, color: P.ink }); text(g, 'Same 7% return.', 70, 480, { kind: 'display', weight: 700, size: 50, color: P.ink });
  text(g, 'ONLY THE START DATE CHANGED', 70, 560, { weight: 900, size: 34, color: P.goldDark, spacing: 2 });
  text(g, 'NEXTWAVE', 70, 690, { weight: 900, size: 30, color: P.ink, spacing: 3 });
  return c;
}
