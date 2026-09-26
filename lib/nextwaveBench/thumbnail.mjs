// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: thumbnail templates (verified number + illustrated object + host + <=4 words).
import { P, makeCanvas, text, rr, shadowed, groundShadow, drawMoney, measure } from './core.mjs';
import * as pr from './props.mjs';

// LONG 1280x720: contrast of two stacks + the verified cost, host reacting.
export function longThumb({ host, headline, number, sub, tall, short }) {
  const W = 1280, H = 720; const { c, g } = makeCanvas(W, H);
  g.fillStyle = P.canvas; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(201,158,76,0.22)'; g.beginPath(); g.arc(1080, 130, 420, 0, 7); g.fill(); g.fillStyle = 'rgba(26,39,68,0.06)'; g.beginPath(); g.arc(120, 700, 380, 0, 7); g.fill();
  // ledge + two stacks (same scale: coins per $ value)
  const ledgeY = 600; g.fillStyle = '#B98F5F'; g.fillRect(0, ledgeY, W, H - ledgeY); g.fillStyle = '#E2BE8A'; g.fillRect(0, ledgeY - 8, W, 16);
  const th = 1.4, per = 3000; pr.coinStack(g, 780, ledgeY, { n: tall / per, w: 150, th });
  pr.coinStack(g, 1030, ledgeY, { n: short / per, w: 150, th });
  text(g, '$' + Math.round(tall / 1000) + 'K', 780, ledgeY + 58, { weight: 900, size: 44, color: '#fff', align: 'center' }); text(g, '$' + Math.round(short / 1000) + 'K', 1030, ledgeY + 58, { weight: 900, size: 44, color: '#fff', align: 'center' });
  text(g, 'NORA', 780, ledgeY + 86, { weight: 800, size: 20, color: P.goldLight, align: 'center', spacing: 2 }); text(g, 'OWEN', 1030, ledgeY + 86, { weight: 800, size: 20, color: P.goldLight, align: 'center', spacing: 2 });
  // host
  if (host) { const sc = 640 / host.h; const cw = host.w * sc; g.drawImage(host.canvas, 20, H - 640 - 30, cw, 640); }
  // headline
  text(g, headline[0], 560, 130, { kind: 'display', weight: 800, size: 84, color: P.ink }); text(g, headline[1], 560, 218, { kind: 'display', weight: 800, size: 84, color: P.goldDark });
  drawMoney(g, number, 560, 340, { size: 124, color: P.red }); text(g, sub, 566, 392, { weight: 800, size: 30, color: P.inkMute, spacing: 3 });
  g.fillStyle = P.gold; g.fillRect(640, 108 - 84, 0, 0);
  return c;
}
// SHORT cover 1080x1920 (first-frame / cover): hook question over the hero object.
export function shortCover({ host, line1, line2, value, label }) {
  const W = 1080, H = 1920; const { c, g } = makeCanvas(W, H);
  pr.studioSet(g, { w: W, h: H, t: 0, floor: 0.51, window: false });
  text(g, line1, 70, 330, { kind: 'display', weight: 800, size: 104, color: P.ink }); text(g, line2, 70, 440, { kind: 'display', weight: 800, size: 104, color: P.goldDark });
  const DESK = 1300; if (host) { const sc = 0.95; g.drawImage(host.canvas, 620 - host.w * sc / 2, DESK + 90 - host.h * sc, host.w * sc, host.h * sc); }
  pr.desk(g, { x0: -300, x1: W + 300, topY: DESK, bottom: H + 40 });
  pr.billStack(g, 200, DESK + 40, { n: 40, w: 250, th: 8 }); pr.tag(g, 200, DESK - 360, value, { size: 72, sub: label, pad: 28 });
  return c;
}
