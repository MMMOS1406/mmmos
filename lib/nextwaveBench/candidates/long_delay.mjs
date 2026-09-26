// BENCHMARK CANDIDATE — LONG SEGMENT (16:9): "The cost of waiting 10 years" (start now vs start later).
// Structural scene stays put (studio, desk, easel); the information develops IN it: a monthly flow into a jar,
// then a chart drawn on the easel, then the gap. All numbers are computed with the deterministic calculators.
import { compute, statedMatches, growthSeries } from '../../nextwaveV2FinanceCalculators.mjs';
import { P, STYLE, tw, ease, clamp01, lerp, countTo, fmtMoney, text, rr, shadowed, groundShadow, measure, wrap } from '../core.mjs';
import * as pr from '../props.mjs';
import { makeCamera, applyCamera, drift, anchorTimes } from '../motion.mjs';
import { drawCaptions, chunkWords } from '../captions.mjs';

export function verifiedNumbers() {
  const end = (years, delay = 0) => compute('compound_growth', { recurring: 350, cadence: 'month', rate: 7, years, delay }, 'end_value')[0].value;
  const v = { nora: end(30), owen: end(30, 10) };
  v.gap = v.nora - v.owen;
  // independent closed-form check (ordinary annuity, monthly compounding) of what the script will state
  const fv = (n) => 350 * ((Math.pow(1 + 0.07 / 12, n) - 1) / (0.07 / 12));
  const stated = { nora: Math.round(fv(360)), owen: Math.round(fv(240)), gap: Math.round(fv(360)) - Math.round(fv(240)) };
  for (const [k, s] of Object.entries(stated)) if (!statedMatches(s, v[k], 'money')) throw new Error(`stated ${k}=${s} not reproduced (${v[k].toFixed(2)})`);
  v.stated = stated; return v;
}
const V0 = (() => { const end = (y, d = 0) => compute('compound_growth', { recurring: 350, cadence: 'month', rate: 7, years: y, delay: d }, 'end_value')[0].value; return { n: Math.round(end(30)), o: Math.round(end(30, 10)) }; })();
export const SCRIPT = `Every month, $350 moves from your paycheck into an index fund. Now meet two savers, Nora and Owen. Both earn 7 percent. Nora starts today and invests for 30 years. Owen waits 10 years, then invests for 20. After 30 years, Nora has $${V0.n.toLocaleString('en-US')}. Owen has $${V0.o.toLocaleString('en-US')}. Same monthly amount. Same return. The only difference is the 10-year wait, and it costs Owen $${(V0.n - V0.o).toLocaleString('en-US')}. The best time to start was yesterday. The second best time is today.`;

export const ANCHORS = {
  pay: '$350', fund: { text: 'index fund.', after: 'pay' }, meet: 'Nora', seven: '7 percent', noraStart: { text: 'Nora starts', after: 'seven' }, wait: { text: 'Owen waits', after: 'noraStart' },
  y10: { text: '10 years,', after: 'wait' }, y20: { text: 'for 20.', after: 'y10' }, noraHas: { text: 'Nora has', after: 'y20' }, owenHas: { text: 'Owen has', after: 'noraHas' },
  same: 'Same monthly', diff: 'The only', costs: { text: 'costs Owen', after: 'diff' }, best: 'The best', second: 'second best',
};

export function buildLong({ format, words, assets }) {
  const { w: W, h: H } = format; const V = verifiedNumbers(); const A = anchorTimes(words, ANCHORS); const endT = words[words.length - 1].end + 1.4;
  const chunks = chunkWords(words); const FLOOR = 0.64, DESK = 850;
  // chart data (yearly): computed, not drawn by hand
  const nora = growthSeries({ recurring: 350, cadence: 'month', rate: 7, years: 30, delay: 0 }, 'monthly_annuity');
  const owen = growthSeries({ recurring: 350, cadence: 'month', rate: 7, years: 30, delay: 10 }, 'monthly_annuity');
  const top = 450000; const B = { x: 660, y: 95, w: 1130, h: 640 };           // easel board
  const CH = { x0: B.x + 130, x1: B.x + B.w - 320, y0: B.y + B.h - 110, y1: B.y + 190 }; // plot area
  const px = (yr) => lerp(CH.x0, CH.x1, yr / 30), py = (v) => lerp(CH.y0, CH.y1, v / top);

  const cam = makeCamera([
    { t: 0, x: 960, y: 540, z: 1.0 }, { t: A.meet - 0.3, x: 960, y: 540, z: 1.0 },
    { t: A.meet + 0.6, x: 940, y: 440, z: 1.08 }, { t: A.owenHas + 1.2, x: 940, y: 440, z: 1.08 },
    { t: A.costs, x: 1000, y: 420, z: 1.14 }, { t: A.costs + 2.5, x: 1000, y: 420, z: 1.14 }, { t: A.best, x: 960, y: 540, z: 1.0 }, { t: endT, x: 960, y: 540, z: 1.0 },
  ], { w: W, h: H });
  const camC = (t) => { const c = cam(t); const hw = W / (2 * c.z), hh = H / (2 * c.z); return { x: Math.max(hw, Math.min(W - hw, c.x)), y: Math.max(hh, Math.min(H - hh, c.y)), z: c.z }; };

  const popTag = (g, k, x, y, str, o) => { if (k <= 0.01) return; g.save(); g.translate(x, y); g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k); pr.tag(g, 0, 0, str, { ...o, alpha: Math.min(1, k * 1.4) }); g.restore(); };
  function board(g, t) {
    // legs to the desk
    g.strokeStyle = '#8F6B45'; g.lineWidth = 16; g.lineCap = 'round'; g.beginPath(); g.moveTo(B.x + 120, B.y + B.h); g.lineTo(B.x + 60, DESK); g.moveTo(B.x + B.w - 120, B.y + B.h); g.lineTo(B.x + B.w - 60, DESK); g.stroke();
    shadowed(g, () => { rr(g, B.x, B.y, B.w, B.h, 26); g.fillStyle = '#FFFFFF'; g.fill(); }, { blur: 40, dy: 16 });
    g.strokeStyle = P.canvasDeep; g.lineWidth = 6; rr(g, B.x, B.y, B.w, B.h, 26); g.stroke();
  }
  function title(g, t) { // before the chart: the monthly flow, typeset on the board
    const a = 1 - tw(t, A.meet - 0.2, 0.5, ease.inCubic); if (a < 0.01) return; const inn = tw(t, A.pay - 0.1, 0.6, ease.outBack);
    g.save(); g.globalAlpha = a * inn; g.translate(0, (1 - inn) * 24);
    text(g, '$350', B.x + B.w / 2, B.y + 250, { kind: 'display', weight: 800, size: 220, color: P.ink, align: 'center' });
    text(g, 'A MONTH, INTO AN INDEX FUND', B.x + B.w / 2, B.y + 330, { weight: 800, size: 44, color: P.inkMute, align: 'center', spacing: 3 }); g.restore();
  }
  function chart(g, t) {
    const inn = tw(t, A.meet, 0.6, ease.outCubic); if (inn < 0.01) return; g.save(); g.globalAlpha = inn;
    text(g, 'BALANCE OVER TIME', B.x + 60, B.y + 78, { weight: 900, size: 40, color: P.ink, spacing: 2 }); text(g, '$350 A MONTH AT 7%', B.x + 60, B.y + 122, { weight: 700, size: 30, color: P.inkMute });
    // axes & grid (round-number scale)
    g.strokeStyle = 'rgba(26,39,68,0.10)'; g.lineWidth = 3;
    [0, 150000, 300000, 450000].forEach((v) => { const y = py(v); g.beginPath(); g.moveTo(CH.x0, y); g.lineTo(CH.x1, y); g.stroke(); text(g, v === 0 ? '$0' : `$${(v / 1000)}K`, CH.x0 - 16, y + 10, { weight: 700, size: 28, color: P.inkMute, align: 'right' }); });
    [0, 10, 20, 30].forEach((yr) => text(g, yr === 0 ? 'NOW' : `${yr} YRS`, px(yr), CH.y0 + 52, { weight: 700, size: 28, color: P.inkMute, align: 'center' }));
    const drawLine = (pts, color, t0, t1, w) => {
      const prog = tw(t, t0, t1 - t0, ease.inOutCubic); const nPts = pts.length - 1; const upto = prog * nPts; let started = false;
      g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
      for (let i = 0; i <= nPts; i++) { if (pts[i] == null) continue; const x = px(i), y = py(pts[i]); if (i > upto) { const f = upto - (i - 1); if (f > 0 && pts[i - 1] != null) { g.lineTo(lerp(px(i - 1), x, f), lerp(py(pts[i - 1]), y, f)); } break; } if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }
      g.stroke(); return { prog, tip: (() => { const k = Math.min(nPts, Math.floor(upto)); const f = upto - k; const a = pts[k], b2 = pts[Math.min(nPts, k + 1)]; if (a == null) return null; return { x: lerp(px(k), px(Math.min(nPts, k + 1)), f), y: lerp(py(a), py(b2 == null ? a : b2), f), v: lerp(a, b2 == null ? a : b2, f) }; })() };
    };
    const tN0 = A.noraStart, tN1 = A.y10 + 0.4;
    const nl = drawLine(nora, P.gold, tN0, A.noraHas + 0.6, 12);
    // Owen: dashed flat while waiting, then his line from year 10
    const owenWaitIn = tw(t, A.wait, 0.4, ease.outCubic);
    if (owenWaitIn > 0.01) { g.save(); g.globalAlpha = inn * owenWaitIn; g.setLineDash([16, 14]); g.strokeStyle = P.navy; g.lineWidth = 8; g.beginPath(); g.moveTo(px(0), py(0)); g.lineTo(lerp(px(0), px(10), tw(t, A.wait, A.y10 - A.wait + 0.2, ease.inOutCubic)), py(0)); g.stroke(); g.restore(); }
    const ol = drawLine(owen, P.navy, A.y20 - 0.2, A.owenHas + 0.6, 12);
    // delay marker
    const dm = tw(t, A.y10, 0.5, ease.outBack); if (dm > 0.01) { g.save(); g.globalAlpha = inn * dm; g.setLineDash([]); g.strokeStyle = 'rgba(26,39,68,0.35)'; g.lineWidth = 4; g.beginPath(); g.moveTo(px(10), CH.y0); g.lineTo(px(10), CH.y1 + 60); g.stroke(); pr.pill(g, px(10), CH.y0 - 44, '10-YEAR WAIT', { size: 26, fill: P.navy }); g.restore(); }
    // labels & value tags at the tips
    if (nl.tip && t > A.noraStart) { const v = t > A.noraHas ? V.nora : nl.tip.v; g.save(); g.fillStyle = P.gold; g.beginPath(); g.arc(nl.tip.x, nl.tip.y, 14, 0, 7); g.fill(); g.restore(); if (t > A.noraHas + 0.6) popTag(g, tw(t, A.noraHas + 0.6, 0.45, ease.outBack), px(30) + 170, py(V.nora) - 4, fmtMoney(V.nora), { size: 44, sub: 'NORA · STARTS NOW', pad: 20, fill: '#FFF8E7', pointer: 'none' }); }
    if (ol.tip && t > A.y20) { g.save(); g.fillStyle = P.navy; g.beginPath(); g.arc(ol.tip.x, ol.tip.y, 14, 0, 7); g.fill(); g.restore(); if (t > A.owenHas + 0.6) popTag(g, tw(t, A.owenHas + 0.6, 0.45, ease.outBack), px(30) + 170, py(V.owen) + 96, fmtMoney(V.owen), { size: 44, sub: 'OWEN · WAITS 10 YRS', pad: 20, pointer: 'none' }); }
    // the gap
    const gp = tw(t, A.costs, 0.8, ease.outCubic); if (gp > 0.01) {
      g.save(); g.globalAlpha = inn * gp; const xg = px(30) + 22; const y0 = py(V.nora), y1 = py(V.owen); const ye = y0 + (y1 - y0) * gp;
      g.strokeStyle = P.red; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(xg, y0); g.lineTo(xg, ye); g.moveTo(xg - 14, y0); g.lineTo(xg + 14, y0); g.moveTo(xg - 14, ye); g.lineTo(xg + 14, ye); g.stroke();
      const tx = px(17), ty = CH.y1 + 120; g.lineWidth = 4; g.setLineDash([10, 8]); g.beginPath(); g.moveTo(tx + 150, ty - 40); g.lineTo(xg - 10, (y0 + ye) / 2); g.stroke(); g.setLineDash([]);
      popTag(g, tw(t, A.costs + 0.3, 0.45, ease.outBack), tx, ty, fmtMoney(V.gap), { size: 56, sub: 'THE COST OF WAITING', pad: 24, fill: P.redSoft, ink: P.red, pointer: 'none' }); g.restore();
    }
    g.restore();
  }
  function flowProps(g, t) { // the monthly flow: paycheck -> jar, on the desk
    const a = 1 - tw(t, A.meet - 0.2, 0.5, ease.inCubic); if (a < 0.01) return; const inn = tw(t, A.pay - 0.2, 0.6, ease.outBack);
    g.save(); g.globalAlpha = a * inn;
    const jx = 1230, jy = DESK + 20, sx = 900, sy = DESK + 8;
    // paycheck slip
    shadowed(g, () => { rr(g, sx - 90, sy - 120, 180, 118, 10); g.fillStyle = '#fff'; g.fill(); }, { blur: 16, dy: 8 }); g.fillStyle = P.canvasDeep; g.fillRect(sx - 70, sy - 96, 100, 10); g.fillRect(sx - 70, sy - 72, 140, 8); g.fillRect(sx - 70, sy - 52, 120, 8); text(g, 'PAYCHECK', sx, sy - 12, { weight: 800, size: 20, color: P.inkMute, align: 'center', spacing: 2 });
    const level = 0.12 + 0.45 * tw(t, A.pay, A.fund - A.pay + 1.0, ease.inOutCubic); pr.jar(g, jx, jy, { w: 170, level });
    // bills arcing from paycheck to jar
    for (let k = 0; k < 5; k++) { const p = ((t - A.pay - k * 0.35) % 1.6) / 1.6; if (t < A.pay || p < 0 || p > 1) continue; const x = lerp(sx, jx, p), y = lerp(sy - 60, jy - 190, p) - Math.sin(p * Math.PI) * 120; g.save(); g.globalAlpha *= Math.sin(p * Math.PI); pr.bill(g, x, y, 90, 42, { rot: (p - 0.5) * 0.9 }); g.restore(); }
    pr.tag(g, 1490, jy - 20, '$350', { size: 50, sub: 'EVERY MONTH', pad: 22, pointer: 'none' }); g.restore();
  }
  function drawWorld(g, t) {
    pr.studioSet(g, { w: W, h: H, t, floor: FLOOR, window: true });
    board(g, t); title(g, t); chart(g, t);
    // host behind desk (left)
    const tl = [{ t: 0, pose: 'react' }, { t: A.pay + 0.5, pose: 'point' }, { t: A.meet, pose: 'compare' }, { t: A.noraStart, pose: 'point' }, { t: A.wait, pose: 'think' }, { t: A.noraHas, pose: 'point' }, { t: A.costs - 0.2, pose: 'compare' }, { t: A.best, pose: 'react' }];
    let idx = 0; tl.forEach((k, i) => { if (t >= k.t) idx = i; }); const cur = tl[idx], prev = null; const xf = 1; const swap = tw(t, cur.t, 0.28, ease.outBack); const enter = tw(t, 0.1, 0.9, ease.outBack);
    const SC = 0.7; const draw = (n, a) => { const sp = assets.pose(n); if (!sp) return; const cw = sp.w * SC, ch = sp.h * SC; g.save(); g.globalAlpha *= a; g.translate(290 - (1 - enter) * 300, DESK + 60 + Math.sin(t * 1.8) * 2 + (idx > 0 ? (1 - swap) * 14 : 0)); g.drawImage(sp.canvas, -cw / 2, -ch, cw, ch); g.restore(); };
    if (prev && xf < 1) draw(prev.pose, 1 - xf); draw(cur.pose, prev ? xf : 1);
    pr.desk(g, { x0: -200, x1: W + 200, topY: DESK, bottom: H + 40 });
    flowProps(g, t);
  }
  function draw(g, t) {
    g.save(); const d = drift(t, 5, 8); const c = camC(t); applyCamera(g, { x: c.x + d.dx, y: c.y + d.dy, z: c.z }, { w: W, h: H }); drawWorld(g, t); g.restore();
    drawCaptions(g, chunks, t, format);
    text(g, 'NEXTWAVE', 70, 78, { weight: 900, size: 32, color: P.ink, spacing: 3, alpha: 0.9 }); g.fillStyle = P.gold; g.fillRect(70, 92, 66, 5);
  }
  return { draw, duration: endT, anchors: A, verified: V };
}
