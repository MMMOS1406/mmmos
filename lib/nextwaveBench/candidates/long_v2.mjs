// BENCHMARK CANDIDATE — LONG CHAPTER v2 (16:9, ~90 s): "What ten years of waiting really costs".
// Seven beats, five environments (office, road, kitchen, studio, city), progressive evidence, one argument.
// Every figure comes from the deterministic calculators and is re-derived by an independent closed form.
import { compute, statedMatches, growthSeries } from '../../nextwaveV2FinanceCalculators.mjs';
import { P, tw, ease, lerp, countTo, fmtMoney, text, rr, lin, shadowed, groundShadow } from '../core.mjs';
import * as pr from '../props.mjs';
import * as p2 from '../props2.mjs';
import * as st from '../sets.mjs';
import { anchorTimes } from '../motion.mjs';
import { drawCaptions, chunkWords } from '../captions.mjs';
import { makeSequence, hostLayer } from '../scenes.mjs';
import * as p3 from '../props3.mjs';

const MO = 350, RATE = 7;
const end = (d = 0, m = MO) => compute('compound_growth', { recurring: m, cadence: 'month', rate: RATE, years: 30, delay: d }, 'end_value')[0].value;
const fvCF = (n, m = MO) => m * ((Math.pow(1 + RATE / 1200, n) - 1) / (RATE / 1200));   // closed-form ordinary annuity
export function verifiedNumbers() {
  const V = { nora: Math.round(end(0)), owen: Math.round(end(10)) };
  const cf = { nora: Math.round(fvCF(360)), owen: Math.round(fvCF(240)) };
  for (const k of ['nora', 'owen']) if (!statedMatches(cf[k], V[k], 'money')) throw new Error(`closed form ${k} ${cf[k]} != ${V[k]}`);
  V.gap = V.nora - V.owen; V.putN = MO * 360; V.putO = MO * 240; V.putLess = V.putN - V.putO;
  V.earnN = V.nora - V.putN; V.earnO = V.owen - V.putO;
  const n20 = Math.round(end(0) * 0 + fvCF(240)); V.nora20 = n20; if (n20 !== V.owen) throw new Error('nora@20 != owen@30'); if (V.nora - n20 !== V.gap) throw new Error('last decade != gap');
  V.catchup = Math.round(MO * V.nora / V.owen);                                      // monthly amount for 20 years that reaches Nora's balance
  const chk = Math.round(fvCF(240, V.catchup)); if (Math.abs(chk - V.nora) / V.nora > 0.005) throw new Error(`catch-up ${V.catchup} gives ${chk}`);
  V.catchupEnd = chk; V.ratio = V.catchup / MO; if (!(V.ratio > 2)) throw new Error('"more than double" is false');
  return V;
}
const V0 = verifiedNumbers(); const f = (n) => fmtMoney(n);
export const SCRIPT = [
  `Every month, $${MO} leaves your paycheck and lands in an index fund. It feels small enough to skip. Invested at ${RATE} percent, every dollar keeps earning, and then its earnings earn too. That is why when you start can matter more than almost anything else.`,
  `Meet Nora and Owen. Both earn ${RATE} percent a year. Both invest $${MO} a month. Nora starts today and invests for 30 years. Owen waits 10 years, then invests for 20.`,
  `Same monthly amount. Same return. Same finish line. The only difference is the day Owen pressed start.`,
  `After 30 years, Nora has ${f(V0.nora)}. Owen has ${f(V0.owen)}. Waiting ten years cost him ${f(V0.gap)}. Here's why. After 20 years, Nora had ${f(V0.owen)}, exactly what Owen ends up with. Her last ten years added ${f(V0.gap)}, the amount Owen never got.`,
  `Now look at where that money came from. Nora put in ${f(V0.putN)} of her own. Owen put in ${f(V0.putO)}, just ${f(V0.putLess)} less. But Nora's money earned ${f(V0.earnN)}, while Owen's earned only ${f(V0.earnO)}. Those extra ten years did the heavy lifting.`,
  `Could Owen catch up? He would need to invest about $${V0.catchup} a month, more than double, for all 20 years, just to match Nora.`,
  `The best time to start was ten years ago. The second best time is today. Set up your $${MO} this week, and let time do the work.`,
].join(' ');
export const ANCHORS = {
  pay: '$350', fund: { text: 'index fund.', after: 'pay' }, skip: { text: 'small enough', after: 'fund' }, earn: { text: 'keeps earning', after: 'skip' }, when: { text: 'when you start', after: 'earn' },
  meet: 'Meet Nora', seven: { text: '7 percent', after: 'meet' }, noraStart: { text: 'Nora starts', after: 'seven' }, wait: { text: 'Owen waits', after: 'noraStart' }, y10: { text: '10 years,', after: 'wait' }, y20: { text: 'for 20.', after: 'y10' },
  same: 'Same monthly', ret: { text: 'Same return', after: 'same' }, fin: { text: 'Same finish', after: 'ret' }, diff: { text: 'The only difference', after: 'fin' }, pressed: { text: 'pressed start', after: 'diff' },
  after30: { text: 'After 30 years', after: 'pressed' }, noraHas: { text: 'Nora has', after: 'after30' }, owenHas: { text: 'Owen has', after: 'noraHas' }, costs: { text: 'cost him', after: 'owenHas' },
  why: { text: "Here's why", after: 'costs' }, at20: { text: 'After 20 years', after: 'why' }, last10: { text: 'last ten years', after: 'at20' },
  where: { text: 'where that money', after: 'last10' }, putN: { text: 'Nora put', after: 'where' }, putO: { text: 'Owen put', after: 'putN' }, less: { text: 'just $42,000', after: 'putO' }, earnN: { text: "Nora's money", after: 'less' }, earnO: { text: "Owen's earned", after: 'earnN' }, heavy: { text: 'heavy lifting', after: 'earnO' },
  catch: { text: 'Could Owen', after: 'heavy' }, need: { text: 'He would need', after: 'catch' }, dbl: { text: 'more than double', after: 'need' }, y20b: { text: 'all 20 years', after: 'dbl' }, match: { text: 'match Nora', after: 'y20b' },
  best: { text: 'The best time', after: 'match' }, second: { text: 'second best', after: 'best' }, setup: { text: 'Set up', after: 'second' }, work: { text: 'do the work', after: 'setup' },
};

export function buildLongV2({ format, words, assets }) {
  const { w: W, h: H } = format; const V = verifiedNumbers(); const A = anchorTimes(words, ANCHORS); const endT = words[words.length - 1].end + 1.4;
  const chunks = chunkWords(words); const poses = assets.poses; const BN = assets.bench; const DESK = 790; const HS = 0.78;
  const nora = growthSeries({ recurring: MO, cadence: 'month', rate: RATE, years: 30, delay: 0 }, 'monthly_annuity');
  const owen = growthSeries({ recurring: MO, cadence: 'month', rate: RATE, years: 30, delay: 10 }, 'monthly_annuity');
  const TOP = 450000;
  const B1 = A.meet - 0.35, B2 = A.same - 0.35, B3 = A.after30 - 0.5, B4 = A.where - 0.35, B5 = A.catch - 0.35, B6 = A.best - 0.45;
  const pop = (g, k, x, y, str, o) => { if (k <= 0.01) return; g.save(); g.translate(x, y); g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k); pr.tag(g, 0, 0, str, { ...o, alpha: Math.min(1, k * 1.4) }); g.restore(); };
  const pill = (g, k, x, y, str, o) => { if (k <= 0.01) return; g.save(); g.globalAlpha *= Math.min(1, k * 1.5); g.translate(x, y + (1 - k) * 18); pr.pill(g, 0, 0, str, o); g.restore(); };
  const bal = (arr, yr) => { const i = Math.min(30, Math.floor(yr)), j = Math.min(30, i + 1); return lerp(arr[i] ?? 0, arr[j] ?? 0, yr - i); };

  // ── L1 OFFICE: the monthly flow ───────────────────────────────────────────────
  const l1 = {
    t0: 0, t1: B1, world: { w: W, h: H }, camera: [{ t: 0, x: 960, y: 540, z: 1.0 }, { t: B1, x: 900, y: 520, z: 1.06 }],
    draw(g, t) {
      st.officeSet(g, { w: W, h: H, t, deskY: DESK });
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'react' }, { t: A.pay + 0.3, pose: 'point' }, { t: A.skip, pose: 'think' }, { t: A.when, pose: 'compare' }], x: 1540, bottom: DESK + 150, scale: HS, enter: tw(t, 0.1, 0.9, ease.outBack) });
      pr.desk(g, { x0: -200, x1: W + 200, topY: DESK, bottom: H + 40 });
      const inn = tw(t, A.pay - 0.3, 0.6, ease.outBack); const sx = 560, jx = 1010, jy = DESK + 14, sy = DESK + 6;
      g.save(); g.globalAlpha = inn;
      shadowed(g, () => { rr(g, sx - 110, sy - 150, 220, 146, 12); g.fillStyle = '#fff'; g.fill(); }, { blur: 16, dy: 8 }); g.fillStyle = P.canvasDeep; g.fillRect(sx - 88, sy - 120, 120, 12); g.fillRect(sx - 88, sy - 90, 170, 10); g.fillRect(sx - 88, sy - 66, 140, 10); text(g, 'PAYCHECK', sx, sy - 20, { weight: 800, size: 24, color: P.inkMute, align: 'center', spacing: 2 });
      const level = 0.10 + 0.5 * tw(t, A.pay, A.when - A.pay, ease.inOutCubic); pr.jar(g, jx, jy, { w: 230, level });
      pill(g, tw(t, A.fund - 0.2, 0.5, ease.outBack), jx, jy - 96, 'INDEX FUND', { size: 30, fill: P.navy });
      for (let k = 0; k < 5; k++) { const p = ((t - A.pay - k * 0.36) % 1.7) / 1.7; if (t < A.pay || p < 0 || p > 1) continue; const x = lerp(sx + 60, jx, p), y = lerp(sy - 90, jy - 250, p) - Math.sin(p * Math.PI) * 140; g.save(); g.globalAlpha *= Math.sin(p * Math.PI); pr.bill(g, x, y, 110, 52, { rot: (p - 0.5) * 0.9 }); g.restore(); }
      pop(g, tw(t, A.pay, 0.5, ease.outBack), 700, DESK - 470, `$${MO}`, { size: 78, sub: 'EVERY MONTH', pad: 30, pointer: 'none' });
      const tg = tw(t, A.earn - 0.2, 0.5, ease.outCubic); if (tg > 0.01) { g.save(); g.globalAlpha = tg; p2.tree(g, 1290, DESK + 8, { h: 330, grow: 0.15 + 0.85 * tw(t, A.earn, A.when - A.earn, ease.inOutCubic), coins: Math.round(8 * tw(t, A.earn + 0.6, A.when - A.earn, ease.outCubic)) }); pr.pill(g, 1290, DESK - 360, 'EARNINGS EARN TOO', { size: 26, fill: P.green }); g.restore(); }
      p2.calendar(g, 250, DESK + 4, { w: 210, day: Math.floor(Math.max(0, t - A.pay) / 0.9) % 20 });
      g.restore();
    },
  };

  // ── L2 ROAD: a two-lane race through time (wagons carry the balance as a gold heap) ─────────────
  const LN = { x0: 330, x1: 1480 }; const LANE = { nora: 585, owen: 835 }; const WW = 350;
  const yr = (t) => t < A.wait ? 0 : t < A.y10_end ? 10 * tw(t, A.wait, A.y10_end - A.wait, ease.linear) : t < B2 - 0.3 ? 10 + 20 * tw(t, A.y10_end, B2 - 0.3 - A.y10_end, ease.inOutCubic) : 30;
  const wagon = (g, x, base, level, drop, t) => {
    const s = p3.sprite(g, BN.prop.wagon, x, base + 26, WW); const rim = base + 26 - s.h * 0.44;
    p3.coinHeap(g, x + 10, rim + 4, WW * 0.66, level * 230, 5);
    g.save(); g.beginPath(); g.rect(x - WW / 2 - 5, rim + 8, WW + 10, s.h); g.clip(); p3.sprite(g, BN.prop.wagon, x, base + 26, WW); g.restore();
    if (drop) { const p = (t * 1.4) % 1; g.save(); g.globalAlpha = Math.sin(p * Math.PI); pr.bill(g, x + 10, rim - 210 + p * 170, 86, 42, { rot: 0.3 }); g.restore(); }
    return rim;
  };
  const l2 = {
    t0: B1, t1: B2, world: { w: W, h: H }, camera: [{ t: B1, x: 960, y: 540, z: 1.0 }, { t: A.noraStart, x: 900, y: 520, z: 1.07 }, { t: A.wait + 0.4, x: 960, y: 540, z: 1.02 }, { t: B2, x: 1000, y: 540, z: 1.0 }],
    draw(g, t) {
      p3.coverImage(g, BN.bg.roadWide, W, H, { ay: 0.7 }); g.fillStyle = 'rgba(247,244,238,0.10)'; g.fillRect(0, 0, W, H);
      const y_ = yr(t); const yO = Math.max(0, y_ - 10); const xN = lerp(LN.x0, LN.x1, y_ / 30), xO = lerp(LN.x0, LN.x1, yO / 30);
      const nl = tw(t, A.meet + 0.5, 0.6, ease.outCubic);
      // milestone ruler (years) with a moving marker — doubles as the year counter
      const rk = tw(t, B1 + 0.2, 0.6, ease.outCubic); g.save(); g.globalAlpha = rk; const RY = 165;
      shadowed(g, () => { rr(g, LN.x0 - 150, RY - 62, LN.x1 - LN.x0 + 300, 132, 26); g.fillStyle = 'rgba(255,255,255,0.92)'; g.fill(); }, { blur: 24, dy: 10 });
      g.strokeStyle = P.canvasDeep; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(LN.x0, RY); g.lineTo(LN.x1, RY); g.stroke(); g.strokeStyle = P.gold; g.beginPath(); g.moveTo(LN.x0, RY); g.lineTo(xN, RY); g.stroke();
      ['NOW', '10 YEARS', '20 YEARS', '30 YEARS'].forEach((lab, i) => { const x = lerp(LN.x0, LN.x1, i / 3); g.fillStyle = x <= xN + 1 ? P.gold : P.canvasDeep; g.beginPath(); g.arc(x, RY, 15, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke(); text(g, lab, x, RY + 46, { weight: 800, size: 28, color: P.ink, align: 'center' }); });
      g.fillStyle = P.ink; g.beginPath(); g.arc(xN, RY, 9, 0, 7); g.fill(); g.restore(); g.save(); g.globalAlpha = rk; pr.pill(g, Math.max(xN, LN.x0 + 20), RY - 92, `YEAR ${Math.round(y_)}`, { size: 30, fill: P.ink, pad: 22 }); g.restore();
      // lanes
      p3.pathRibbon(g, 120, 1800, LANE.nora - 22, { h: 74, alpha: 0.85 * nl }); p3.pathRibbon(g, 120, 1800, LANE.owen - 22, { h: 74, alpha: 0.85 * nl });
      groundShadow(g, xN, LANE.nora + 22, 300, 0.25); groundShadow(g, xO, LANE.owen + 22, 300, 0.25);
      if (nl > 0.01) {
        g.save(); g.globalAlpha = nl;
        wagon(g, xN, LANE.nora, bal(nora, y_) / TOP, y_ > 0.05 && y_ < 29.9, t);
        wagon(g, xO, LANE.owen, bal(owen, y_) / TOP, y_ > 10.05 && y_ < 29.9, t);
        pr.pill(g, 90, LANE.nora + 44, 'NORA', { size: 34, fill: P.goldDark, align: 'left' }); pr.pill(g, 90, LANE.owen + 44, 'OWEN', { size: 34, fill: P.navyLight, align: 'left' });
        // Owen's gate: closed while he waits, lifted at year 10
        p3.gate(g, 600, LANE.owen + 44, { open: tw(t, A.y10_end - 0.1, 0.9, ease.inOutCubic) }); const wt = tw(t, A.wait, 0.4) * (1 - tw(t, A.y10_end, 0.5));
        if (wt > 0.01) { g.save(); g.globalAlpha = wt; pr.hourglass(g, 740, LANE.owen + 34, { h: 150, sand: 1 - Math.min(1, y_ / 10) }); pr.pill(g, 740, LANE.owen - 150, 'WAITS 10 YEARS', { size: 28, fill: P.red }); g.restore(); }
        g.restore();
      }
      const kf = tw(t, A.y20 + 1.2, 0.6, ease.outBack); if (kf > 0.01) { g.save(); g.globalAlpha = kf; p3.flagPole(g, 1740, LANE.nora + 44, 200, { color: P.green, wave: t * 5 }); p3.flagPole(g, 1740, LANE.owen + 44, 200, { color: P.green, wave: t * 5 + 1 }); pr.pill(g, 1740, 330, 'SAME FINISH · YEAR 30', { size: 28, fill: P.green }); g.restore(); }
    },
  };

  // ── L3 KITCHEN: same amount, same return, same finish — the evidence stands on the counter ──────
  const l3 = {
    t0: B2, t1: B3, world: { w: W, h: H }, camera: [{ t: B2, x: 960, y: 540, z: 1.0 }, { t: A.diff, x: 960, y: 540, z: 1.0 }, { t: A.pressed + 0.6, x: 960, y: 520, z: 1.08 }, { t: B3, x: 960, y: 520, z: 1.08 }],
    draw(g, t) {
      p3.coverImage(g, BN.bg.kitchenWide, W, H, { ay: 0.3 }); const y = DESK + 6;
      g.fillStyle = lin(g, 0, y - 40, 0, H, [[0, '#D9B98C'], [1, '#B58F63']]); g.fillRect(0, y - 40, W, H); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(0, y - 40, W, 6);
      const J = [{ x: 290, name: 'NORA', c: P.goldDark, st: 'STARTS TODAY', sc: P.green }, { x: 1300, name: 'OWEN', c: P.navyLight, st: 'STARTS IN YEAR 10', sc: P.red }];
      J.forEach((s) => { g.fillStyle = 'rgba(244,236,220,0.96)'; rr(g, s.x - 118, y - 335, 236, 335, 30); g.fill(); pr.jar(g, s.x, y + 6, { w: 250, level: 0.05 }); shadowed(g, () => { rr(g, s.x - 68, y - 200, 136, 60, 12); g.fillStyle = s.c; g.fill(); }, { blur: 10, dy: 5 }); text(g, s.name, s.x, y - 158, { weight: 900, size: 30, color: '#fff', align: 'center', base: 'middle', spacing: 2 }); });
      // the standing comparison card (evidence lives ON the counter, between the two jars)
      const cx = 795, cw = 720, chh = 330, cy = y - 8; shadowed(g, () => { rr(g, cx - cw / 2, cy - chh, cw, chh, 22); g.fillStyle = '#FFFDF8'; g.fill(); }, { blur: 26, dy: 12 });
      g.strokeStyle = P.gold; g.lineWidth = 6; rr(g, cx - cw / 2 + 12, cy - chh + 12, cw - 24, chh - 24, 14); g.stroke();
      text(g, 'NORA', cx - 215, cy - chh + 68, { weight: 900, size: 32, color: P.goldDark, align: 'center', spacing: 2 }); text(g, 'OWEN', cx + 215, cy - chh + 68, { weight: 900, size: 32, color: P.navyLight, align: 'center', spacing: 2 });
      [['$350 A MONTH', A.same], ['7% A YEAR', A.ret], ['YEAR 30 FINISH', A.fin]].forEach(([lab, ta], i) => { const k = tw(t, ta, 0.4, ease.outBack); if (k < 0.01) return; const ry = cy - chh + 140 + i * 78; g.save(); g.globalAlpha = k; text(g, lab, cx - 215, ry, { weight: 800, size: 26, color: P.ink, align: 'center' }); text(g, lab, cx + 215, ry, { weight: 800, size: 26, color: P.ink, align: 'center' }); g.fillStyle = P.gold; g.beginPath(); g.arc(cx, ry - 10, 22, 0, 7); g.fill(); text(g, '=', cx, ry + 1, { weight: 900, size: 32, color: '#fff', align: 'center' }); g.restore(); });
      const kd = tw(t, A.diff + 0.2, 0.5, ease.outBack); const sw = Math.sin(t * 5) * 0.03;
      J.forEach((s) => { if (kd < 0.01) return; g.save(); g.globalAlpha = kd; g.fillStyle = '#6B4F35'; g.fillRect(s.x - 4, y - 395, 8, 60); g.restore(); g.save(); g.globalAlpha = kd; g.translate(s.x, y - 425); g.scale(0.8 + 0.2 * kd, 0.8 + 0.2 * kd); pr.pill(g, 0, 0, s.st, { size: 34, fill: s.sc }); g.restore(); });
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'compare' }, { t: A.diff, pose: 'point' }], x: 1590, bottom: y + 160, scale: HS });
      st.counterFront(g, { w: W, y: y + 30, h: H + 40 });
    },
  };

  // ── L4 STUDIO: the chart on the easel ─────────────────────────────────────────
  const BD = { x: 640, y: 70, w: 1150, h: 640 }; const CH = { x0: BD.x + 130, x1: BD.x + BD.w - 330, y0: BD.y + BD.h - 110, y1: BD.y + 190 };
  const px = (yy) => lerp(CH.x0, CH.x1, yy / 30), py = (v) => lerp(CH.y0, CH.y1, v / TOP);
  const l4 = {
    t0: B3, t1: B4, world: { w: W, h: H }, camera: [{ t: B3, x: 960, y: 540, z: 1.0 }, { t: A.noraHas, x: 990, y: 450, z: 1.1 }, { t: A.costs + 2, x: 1000, y: 430, z: 1.14 }, { t: B4, x: 1000, y: 430, z: 1.14 }],
    draw(g, t) {
      pr.studioSet(g, { w: W, h: H, t, floor: 0.66, window: true });
      g.strokeStyle = '#8F6B45'; g.lineWidth = 16; g.lineCap = 'round'; g.beginPath(); g.moveTo(BD.x + 120, BD.y + BD.h); g.lineTo(BD.x + 60, DESK); g.moveTo(BD.x + BD.w - 120, BD.y + BD.h); g.lineTo(BD.x + BD.w - 60, DESK); g.stroke();
      shadowed(g, () => { rr(g, BD.x, BD.y, BD.w, BD.h, 26); g.fillStyle = '#fff'; g.fill(); }, { blur: 40, dy: 16 });
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'point' }, { t: A.owenHas, pose: 'compare' }, { t: A.costs, pose: 'react' }], x: 290, bottom: DESK + 60, scale: HS * 0.92, enter: tw(t, B3, 0.5) });
      pr.desk(g, { x0: -200, x1: W + 200, topY: DESK, bottom: H + 40 });
      const inn = tw(t, B3 + 0.2, 0.6, ease.outCubic); g.save(); g.globalAlpha = inn;
      text(g, 'BALANCE OVER TIME', BD.x + 60, BD.y + 78, { weight: 900, size: 40, spacing: 2 }); text(g, `$${MO} A MONTH AT ${RATE}%`, BD.x + 60, BD.y + 122, { weight: 700, size: 30, color: P.inkMute });
      g.strokeStyle = 'rgba(26,39,68,0.10)'; g.lineWidth = 3; [0, 150000, 300000, 450000].forEach((v) => { const yy = py(v); g.beginPath(); g.moveTo(CH.x0, yy); g.lineTo(CH.x1, yy); g.stroke(); text(g, v === 0 ? '$0' : `$${v / 1000}K`, CH.x0 - 16, yy + 10, { weight: 700, size: 28, color: P.inkMute, align: 'right' }); });
      [0, 10, 20, 30].forEach((y2) => text(g, y2 === 0 ? 'NOW' : `${y2} YRS`, px(y2), CH.y0 + 52, { weight: 700, size: 28, color: P.inkMute, align: 'center' }));
      const line = (pts, col, t0, t1) => { const pr_ = tw(t, t0, t1 - t0, ease.inOutCubic); const upto = pr_ * 30; g.strokeStyle = col; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); let s = false; let tip = null; for (let i = 0; i <= 30; i++) { if (pts[i] == null) continue; if (i > upto) { const fr = upto - (i - 1); if (fr > 0 && pts[i - 1] != null) { const xx = lerp(px(i - 1), px(i), fr), yy = lerp(py(pts[i - 1]), py(pts[i]), fr); g.lineTo(xx, yy); tip = { x: xx, y: yy }; } break; } if (!s) { g.moveTo(px(i), py(pts[i])); s = true; } else g.lineTo(px(i), py(pts[i])); tip = { x: px(i), y: py(pts[i]) }; } g.stroke(); return tip; };
      const nt = line(nora, P.gold, A.after30, A.noraHas + 0.8);
      const wp = tw(t, A.after30 + 0.3, 1.2, ease.inOutCubic); if (wp > 0.01) { g.save(); g.setLineDash([16, 14]); g.strokeStyle = P.navy; g.lineWidth = 8; g.beginPath(); g.moveTo(px(0), py(0)); g.lineTo(lerp(px(0), px(10), wp), py(0)); g.stroke(); g.restore(); pill(g, tw(t, A.after30 + 0.6, 0.4, ease.outBack) * (1 - tw(t, A.at20 - 0.2, 0.3, ease.inCubic)), px(10), CH.y0 - 44, '10-YEAR WAIT', { size: 26, fill: P.navy }); }
      const ot = line(owen, P.navy, A.noraHas + 0.9, A.owenHas + 0.9);
      if (nt && t > A.after30) { g.fillStyle = P.gold; g.beginPath(); g.arc(nt.x, nt.y, 14, 0, 7); g.fill(); }
      if (ot && t > A.noraHas + 1) { g.fillStyle = P.navy; g.beginPath(); g.arc(ot.x, ot.y, 14, 0, 7); g.fill(); }
      pop(g, tw(t, A.noraHas + 0.7, 0.45, ease.outBack), px(30) + 170, py(V.nora), fmtMoney(V.nora), { size: 44, sub: 'NORA · STARTS NOW', pad: 20, pointer: 'none' });
      pop(g, tw(t, A.owenHas + 0.7, 0.45, ease.outBack), px(30) + 170, py(V.owen) + 96, fmtMoney(V.owen), { size: 44, sub: 'OWEN · WAITS 10 YRS', pad: 20, pointer: 'none' });
      const gp = tw(t, A.costs, 0.8, ease.outCubic); if (gp > 0.01) { g.save(); const xg = px(30) + 22, y0 = py(V.nora), y1 = py(V.owen), ye = y0 + (y1 - y0) * gp; g.strokeStyle = P.red; g.lineWidth = 8; g.beginPath(); g.moveTo(xg, y0); g.lineTo(xg, ye); g.moveTo(xg - 14, y0); g.lineTo(xg + 14, y0); g.moveTo(xg - 14, ye); g.lineTo(xg + 14, ye); g.stroke(); g.restore(); pop(g, tw(t, A.costs + 0.3, 0.45, ease.outBack) * (1 - tw(t, A.why, 0.4, ease.inCubic)), px(17), CH.y1 + 120, fmtMoney(V.gap), { size: 56, sub: 'THE COST OF WAITING', pad: 24, fill: P.redSoft, ink: P.red, pointer: 'none' }); }
      const k20 = tw(t, A.at20, 0.5, ease.outBack); if (k20 > 0.01) { g.save(); g.globalAlpha = k20; const x20 = px(20), y20 = py(V.nora20); g.setLineDash([10, 8]); g.strokeStyle = P.gold; g.lineWidth = 5; g.beginPath(); g.moveTo(x20, y20); g.lineTo(px(30), y20); g.stroke(); g.setLineDash([]); g.fillStyle = P.gold; g.beginPath(); g.arc(x20, y20, 17, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke(); g.restore(); pop(g, k20, x20 - 90, y20 - 100, fmtMoney(V.nora20), { size: 40, sub: 'NORA · YEAR 20', pad: 18, pointer: 'none' }); }
      const kl = tw(t, A.last10, 0.6, ease.outCubic); if (kl > 0.01) { g.save(); g.globalAlpha = 0.18 * kl; g.fillStyle = P.gold; g.beginPath(); g.moveTo(px(20), CH.y0); for (let i = 20; i <= 30; i++) g.lineTo(px(i), py(nora[i])); g.lineTo(px(30), CH.y0); g.closePath(); g.fill(); g.restore(); pill(g, kl, px(12.5), py(330000), `LAST 10 YEARS +${fmtMoney(V.gap)}`, { size: 28, fill: P.goldDark }); }
      g.restore();
    },
  };

  // ── L5 CITY: where the money came from (one scale: bill = $3,000, coin = $6,000) ───
  const PXK = 1.55; const BILL_K = 3, COIN_K = 6;
  const stackAt = (g, x, y, put, earn) => { const rb = pr.billStack(g, x, y, { n: Math.max(0.01, put / (BILL_K * 1000)), w: 220, th: PXK * BILL_K, ground: false }); const bh = (put / 1000) * PXK; pr.coinStack(g, x, y - bh - 3, { n: Math.max(0.01, earn / (COIN_K * 1000)), w: 190, th: PXK * COIN_K, ground: false }); return { billTop: y - bh, top: y - bh - (earn / 1000) * PXK }; };
  const l5 = {
    t0: B4, t1: B5, world: { w: W, h: H }, camera: [{ t: B4, x: 960, y: 540, z: 1.0 }, { t: B5, x: 960, y: 540, z: 1.03 }],
    draw(g, t) {
      st.citySet(g, { w: W, h: H, deskY: DESK }); pr.desk(g, { x0: -200, x1: W + 200, topY: DESK, bottom: H + 40 }); const y = DESK + 14; const xN = 520, xO = 1000;
      const putN = V.putN * tw(t, A.putN, 1.6, ease.outCubic), putO = V.putO * tw(t, A.putO, 1.4, ease.outCubic);
      const eN = V.earnN * tw(t, A.earnN, 2.0, ease.inOutCubic), eO = V.earnO * tw(t, A.earnO, 1.6, ease.inOutCubic);
      groundShadow(g, xN, y, 300, 0.24); groundShadow(g, xO, y, 300, 0.24);
      const sN = stackAt(g, xN, y, putN, eN), sO = stackAt(g, xO, y, putO, eO);
      pop(g, tw(t, A.putN + 1.2, 0.45, ease.outBack), xN - 250, y - (V.putN / 1000) * PXK / 2, fmtMoney(V.putN), { size: 44, sub: 'NORA · HER OWN MONEY', pad: 20, pointer: 'none' });
      pop(g, tw(t, A.putO + 1.0, 0.45, ease.outBack), xO + 215, y - (V.putO / 1000) * PXK / 2, fmtMoney(V.putO), { size: 44, sub: 'OWEN · HIS OWN MONEY', pad: 20, pointer: 'none' });
      const kl = tw(t, A.less, 0.6, ease.outCubic); if (kl > 0.01) { const yN = y - (V.putN / 1000) * PXK, yO = y - (V.putO / 1000) * PXK; g.save(); g.globalAlpha = kl; g.setLineDash([12, 9]); g.strokeStyle = P.red; g.lineWidth = 4; g.beginPath(); g.moveTo(xN + 120, yN); g.lineTo(xO + 120, yN); g.stroke(); g.setLineDash([]); g.lineWidth = 7; g.beginPath(); g.moveTo(xO + 130, yN); g.lineTo(xO + 130, yO); g.stroke(); g.restore(); pill(g, kl, 760, yN - 40, `${fmtMoney(V.putLess)} LESS`, { size: 28, fill: P.red }); }
      pop(g, tw(t, A.earnN + 2.0, 0.45, ease.outBack), xN - 260, sN.top + 130, fmtMoney(V.earnN), { size: 52, sub: 'NORA · EARNED', pad: 22, pointer: 'none', fill: P.greenSoft, ink: P.green });
      pop(g, tw(t, A.earnO + 1.6, 0.45, ease.outBack), xO, sO.top - 70, fmtMoney(V.earnO), { size: 52, sub: 'OWEN · EARNED', pad: 22, pointer: 'none', fill: P.greenSoft, ink: P.green });
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'compare' }, { t: A.earnN, pose: 'point' }, { t: A.heavy, pose: 'react' }], x: 1720, bottom: DESK + 150, scale: HS });
      pr.desk(g, { x0: 1300, x1: W + 200, topY: DESK, bottom: H + 40 });
    },
  };

  // ── L6 OFFICE: what catching up would take ────────────────────────────────────
  const l6 = {
    t0: B5, t1: B6, world: { w: W, h: H }, camera: [{ t: B5, x: 960, y: 540, z: 1.0 }, { t: A.need, x: 940, y: 520, z: 1.06 }, { t: B6, x: 940, y: 520, z: 1.08 }],
    draw(g, t) {
      st.officeSet(g, { w: W, h: H, t, deskY: DESK });
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'think' }, { t: A.need, pose: 'point' }, { t: A.dbl, pose: 'compare' }], x: 1560, bottom: DESK + 150, scale: HS });
      pr.desk(g, { x0: -200, x1: W + 200, topY: DESK, bottom: H + 40 });
      const jn = 560, jo = 1080, jy = DESK + 14;
      const fill = tw(t, A.y20b - 0.3, A.match - A.y20b + 0.8, ease.inOutCubic);
      pr.jar(g, jn, jy, { w: 240, level: V.nora / TOP }); pr.jar(g, jo, jy, { w: 240, level: (V.nora / TOP) * fill });
      const topY = jy - 200 - (V.nora / TOP) * 1.0 * 0; // dashed match line at Nora's level (jar body height = ~ level * bodyH)
      pill(g, tw(t, B5 + 0.3, 0.5, ease.outBack), jn, jy - 350, 'NORA', { size: 32, fill: P.goldDark }); pill(g, tw(t, B5 + 0.3, 0.5, ease.outBack), jo, jy - 350, 'OWEN', { size: 32, fill: P.navyLight });
      pop(g, tw(t, B5 + 0.5, 0.45, ease.outBack), jn, jy - 400, fmtMoney(V.nora), { size: 46, sub: 'NORA AT YEAR 30', pad: 20, pointer: 'down' });
      const q = tw(t, A.need, 0.5, ease.outBack);
      if (q > 0.01) { const m = t < A.dbl ? MO : countTo(t, A.dbl, 0.9, MO, V.catchup, ease.inOutCubic); pop(g, q, jo - 30, jy - 400, `$${Math.round(m)}`, { size: 66, sub: 'A MONTH · 20 YEARS', pad: 24, pointer: 'none', fill: P.redSoft, ink: P.red }); }
      for (let k = 0; k < 7; k++) { const p = ((t - A.need - k * 0.22) % 1.3) / 1.3; if (t < A.need || p < 0 || p > 1) continue; const x = lerp(jo - 380, jo, p), yb = lerp(jy - 130, jy - 260, p) - Math.sin(p * Math.PI) * 110; g.save(); g.globalAlpha *= Math.sin(p * Math.PI); pr.bill(g, x, yb, 110, 52, { rot: (p - 0.5) * 0.8 }); g.restore(); }
      pill(g, tw(t, A.match, 0.5, ease.outBack), jo, jy - 460, 'REACHES NORA\'S TOTAL', { size: 28, fill: P.green });
      pill(g, tw(t, A.dbl + 0.4, 0.5, ease.outBack), 820, jy - 40, `${(V.catchup / MO).toFixed(1)}× THE MONEY`, { size: 32, fill: P.red });
    },
  };

  // ── L7 STUDIO: the takeaway ───────────────────────────────────────────────────
  const l7 = {
    t0: B6, t1: endT + 1, world: { w: W, h: H }, camera: [{ t: B6, x: 960, y: 540, z: 1.0 }, { t: endT, x: 980, y: 530, z: 1.05 }],
    draw(g, t) {
      pr.studioSet(g, { w: W, h: H, t, floor: 0.66, window: true });
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'react' }, { t: A.second, pose: 'point' }, { t: A.setup, pose: 'compare' }], x: 1440, bottom: DESK + 150, scale: HS });
      pr.desk(g, { x0: -200, x1: W + 200, topY: DESK, bottom: H + 40 });
      p2.tree(g, 260, DESK + 20, { h: 560, grow: 0.3 + 0.7 * tw(t, A.setup, A.work - A.setup + 1.5, ease.inOutCubic), coins: Math.round(9 * tw(t, A.setup, 3, ease.outCubic)) });
      g.save(); g.globalAlpha = 0.86 * tw(t, A.best - 0.2, 0.5); g.fillStyle = P.canvas; rr(g, 480, 150, 780, 470, 30); g.fill(); g.restore();
      const a1 = tw(t, A.best, 0.6, ease.outCubic), a2 = tw(t, A.second, 0.6, ease.outCubic), a3 = tw(t, A.setup, 0.6, ease.outCubic);
      if (a1 > 0.01) { g.save(); g.globalAlpha = a1; g.translate(0, (1 - a1) * 22); text(g, 'Best time to start:', 520, 250, { kind: 'display', weight: 700, size: 60, color: P.inkMute }); text(g, '10 years ago.', 520, 335, { kind: 'display', weight: 800, size: 100, color: P.ink }); g.restore(); }
      if (a2 > 0.01) { g.save(); g.globalAlpha = a2; g.translate(0, (1 - a2) * 22); text(g, 'Second best:', 520, 450, { kind: 'display', weight: 700, size: 60, color: P.inkMute }); text(g, 'Today.', 520, 545, { kind: 'display', weight: 800, size: 110, color: P.goldDark }); g.fillStyle = P.gold; g.fillRect(520, 566, 300 * a2, 9); g.restore(); }
      if (a3 > 0.01) pill(g, a3, 700, 690, `SET UP $${MO} A MONTH`, { size: 38, fill: P.navy, pad: 30 });
    },
  };

  const seq = makeSequence({ format, scenes: [l1, l2, l3, l4, l5, l6, l7], transition: 0.6 });
  function draw(g, t) {
    seq(g, t); drawCaptions(g, chunks, t, format);
    text(g, 'NEXTWAVE', 70, 78, { weight: 900, size: 32, color: P.ink, spacing: 3, alpha: 0.9 }); g.fillStyle = P.gold; g.fillRect(70, 92, 66, 5);
  }
  return { draw, duration: endT, anchors: A, verified: V, scenes: [['office', 0, B1], ['road', B1, B2], ['kitchen', B2, B3], ['studio', B3, B4], ['city', B4, B5], ['office2', B5, B6], ['studio2', B6, endT]] };
}
