// BENCHMARK CANDIDATE — SHORT (9:16): "Your emergency fund is quietly shrinking" (nominal vs real).
// One continuous studio set; the camera moves between stations while the numbers develop IN the scene.
// Every figure on screen is computed here from the script's own inputs with the deterministic finance
// calculators, asserted equal to the figure the script states, and drawn as a stack whose HEIGHT is the value
// (one scale for the whole video: PX_PER_K px per $1,000).
import { compute, statedMatches } from '../../nextwaveV2FinanceCalculators.mjs';
import { P, STYLE, tw, ease, clamp01, lerp, countTo, fmtMoney, text, rr, shadowed, groundShadow, drawMoney, measure } from '../core.mjs';
import * as pr from '../props.mjs';
import { makeCamera, applyCamera, drift, anchorTimes } from '../motion.mjs';
import { drawCaptions, chunkWords } from '../captions.mjs';

export const SCRIPT = "Your $50,000 emergency fund is quietly shrinking. Not in the bank. In what it can buy. Say prices rise 3 percent a year. In 10 years, that money buys only what $37,205 buys today. In 20 years? Just $27,684. Nearly half of its power, gone, while the balance never moved. Now park it in a savings account earning 4.5 percent instead. In 10 years it grows to $77,648. Sounds great, until you adjust for prices: that's only $57,778 in today's dollars. Still ahead of inflation, but not by as much as the big number suggests. Cash isn't safe from time. Put it to work.";

// ── verified numbers (deterministic calculators; nothing here is typed in by hand) ──────────────────────
export function verifiedNumbers() {
  const first = (model, params, out) => compute(model, params, out)[0].value;
  const v = {
    principal: 50000, infl: 3, rate: 4.5,
    real10: first('real_value', { amount: 50000, inflation_rate: 3, years: 10 }, 'purchasing_power'),
    real20: first('real_value', { amount: 50000, inflation_rate: 3, years: 20 }, 'purchasing_power'),
    nominal10: compute('compound_growth', { principal: 50000, rate: 4.5, years: 10 }, 'end_value')[0].value,
  };
  v.realOfNominal10 = first('real_value', { amount: v.nominal10, inflation_rate: 3, years: 10 }, 'purchasing_power');
  const stated = { real10: 37205, real20: 27684, nominal10: 77648, realOfNominal10: 57778 };
  for (const [k, s] of Object.entries(stated)) if (!statedMatches(s, v[k], 'money')) throw new Error(`stated ${k}=${s} is not reproduced by the calculator (${v[k]})`);
  v.stated = stated; v.share20 = v.real20 / v.principal; // 0.5537: "nearly half of its power" = 44.6% lost
  return v;
}

export const ANCHORS = {
  fund: '$50,000', shrinking: 'shrinking.', buy: { text: 'buy.', after: 'shrinking' }, infl: '3 percent',
  y10: { text: '10 years,', after: 'infl' }, v37: '$37,205', y20: { text: '20 years?', after: 'v37' }, v27: '$27,684.',
  half: 'Nearly half', rate: '4.5 percent', grows: { text: 'grows to', after: 'rate' }, v77: '$77,648.', adjust: 'adjust', v57: '$57,778',
  still: 'Still ahead', cash: "Cash isn't", work: { text: 'Put it', after: 'cash' },
};

const PX_PER_K = 8;               // stack scale: pixels per $1,000 (bills 1 per $1k, coins 1 per $2k)
const COIN_TH = PX_PER_K * 2;
const FLOOR = 0.51;

export function buildShort({ format, words, assets }) {
  const { w: W, h: H } = format; const V = verifiedNumbers(); const A = anchorTimes(words, ANCHORS);
  const endT = words[words.length - 1].end + 1.3;
  const floorY = H * FLOOR;
  // stations (world coords): objects stand ON the desk; the host stands behind it
  const DESK_TOP = 1300;
  const X = { stackA: 240, basket: 425, coin: 175, real: 400, char: 700 };
  const baseY = DESK_TOP + 40;                     // objects' base on the desk surface
  const charBottom = DESK_TOP + 90, charH = 960;

  // camera: wide -> push to the objects -> track the two stacks -> pull back for the close
  const cam = makeCamera([
    { t: 0, x: 540, y: 960, z: 1.0 },
    { t: A.buy - 0.3, x: 540, y: 960, z: 1.0 },
    { t: A.buy + 0.7, x: 520, y: 1000, z: 1.2 },
    { t: A.half + 0.4, x: 520, y: 1000, z: 1.2 },
    { t: A.rate + 0.2, x: 520, y: 960, z: 1.12 },
    { t: A.v57 + 0.5, x: 520, y: 960, z: 1.12 },
    { t: A.still, x: 540, y: 960, z: 1.0 },
    { t: endT, x: 540, y: 960, z: 1.0 },
  ], { w: W, h: H });

  const rawCam = cam; const camC = (t) => { const c = rawCam(t); const hw = W / (2 * c.z), hh = H / (2 * c.z); return { x: Math.max(hw, Math.min(W - hw, c.x)), y: Math.max(hh, Math.min(H - hh, c.y)), z: c.z }; };
  const chunks = chunkWords(words);

  // value the nominal stack shows over time (mirrors the narration)
  const stackAValue = (t) => {
    if (t < A.fund) return 50000 * tw(t, 0.2, 1.4, ease.outCubic) * 1;
    if (t < A.buy) return countTo(t, A.shrinking, A.buy - A.shrinking, 50000, 47800, ease.inOutCubic);
    if (t < A.y20) return countTo(t, A.y10, (A.v37 - A.y10) + 0.5, t < A.y10 ? 47800 : 47800, V.real10, ease.inOutCubic);
    return countTo(t, A.y20, (A.v27 - A.y20) + 0.5, V.real10, V.real20, ease.inOutCubic);
  };
  // when each $1,000 bill leaves the stack (so the loss is SEEN leaving, not just counted down)
  const leave = []; { let prev = stackAValue(0.9); for (let tt = 1.0; tt < A.rate; tt += 1 / 60) { const v = stackAValue(tt); if (v < prev - 1e-6) for (let k = Math.ceil(v / 1000); k < Math.ceil(prev / 1000); k++) leave[k] = tt; prev = Math.min(v, prev) === v ? v : prev; } }
  const stackAAlpha = (t) => (t < A.rate - 0.6 ? 1 : 1 - tw(t, A.rate - 0.6, 0.5, ease.inCubic));

  const out0 = (t) => tw(t, A.rate - 0.6, 0.5, ease.inCubic);
  function drawWorld(g, t) {
    const set = pr.studioSet(g, { w: W, h: H, t, floor: FLOOR, window: false });
    // ── host (behind the desk): pose changes follow the argument; poses cross-fade ─────────────
    const timeline = [{ t: 0, pose: 'point' }, { t: A.infl - 0.5, pose: 'card' }, { t: A.half - 0.3, pose: 'think' }, { t: A.rate - 0.4, pose: 'compare' }, { t: A.still, pose: 'react' }];
    let idx = 0; timeline.forEach((k, i) => { if (t >= k.t) idx = i; });
    const cur = timeline[idx], prev = null; const xf = 1; const swap = tw(t, cur.t, 0.28, ease.outBack); // clean cut + small settle (no ghosting)
    const enter = tw(t, 0.05, 0.9, ease.outBack); const bob = Math.sin(t * 1.9) * 3;
    const SC = charH / 1024;                                  // one scale for every pose (identity/proportion consistency)
    const drawPose = (name, alpha) => {
      const sp = assets.pose(name); if (!sp) return; const cw = sp.w * SC, ch = sp.h * SC;
      g.save(); g.globalAlpha *= alpha; g.translate(X.char + (1 - enter) * 420, charBottom + bob + (idx > 0 ? (1 - swap) * 18 : 0)); g.drawImage(sp.canvas, -cw / 2, -ch, cw, ch);
      if (name === 'card' && sp.rect) { // evidence written ON the card the host is holding
        const [rx, ry, rw, rh] = sp.rect; const cx = -cw / 2 + (rx + rw / 2) * SC, cy = -ch + (ry + rh / 2) * SC;
        const ph = t < A.y10 ? 0 : t < A.y20 ? 1 : 2; const labs = ['3%', '10', '20']; const subs = ['PRICE RISE A YEAR', 'YEARS LATER', 'YEARS LATER'];
        text(g, labs[ph], cx, cy + 16, { weight: 900, size: 132, color: P.goldDark, align: 'center' }); text(g, subs[ph], cx, cy + 84, { weight: 800, size: 30, color: P.inkSoft, align: 'center', spacing: 1 });
      }
      g.restore();
    };
    if (prev && xf < 1) drawPose(prev.pose, 1 - xf); drawPose(cur.pose, prev ? xf : 1);
    pr.desk(g, { x0: -300, x1: W + 300, topY: DESK_TOP, bottom: H + 40 });
    // ── nominal stack (the emergency fund) ─────────────────────────────────────
    const vA = stackAValue(t); const aA = stackAAlpha(t);
    if (aA > 0.01 && vA > 0) {
      g.save(); g.globalAlpha = aA;
      // ghost of the original height once it starts to shrink (what was lost)
      if (t > A.y10) { const gh = tw(t, A.y10 - 0.2, 0.5, ease.outCubic); g.save(); g.setLineDash([16, 12]); g.strokeStyle = `rgba(176,65,62,${0.7 * gh})`; g.lineWidth = 5; rr(g, X.stackA - 130, baseY - 50 * PX_PER_K - 20, 260, 50 * PX_PER_K, 10); g.stroke(); g.restore(); }
      const r = pr.billStack(g, X.stackA, baseY, { n: vA / 1000, w: 230, th: PX_PER_K });
      leave.forEach((tl, k) => { const p = (t - tl) / 1.5; if (tl == null || p <= 0 || p >= 1) return; g.save(); g.globalAlpha = aA * (1 - ease.inCubic(p)); pr.bill(g, X.stackA + p * (50 + (k % 4) * 22), baseY - PX_PER_K * k - 20 - ease.outCubic(p) * 190, 230, 100, { rot: p * 0.7 * (k % 2 ? 1 : -1) }); g.restore(); });
      const tagIn = tw(t, A.fund - 0.05, 0.45, ease.outBack);
      if (tagIn > 0.01) { g.save(); const sc = 0.6 + 0.4 * tagIn; g.translate(X.stackA, r.top - 34); g.scale(sc, sc); pr.tag(g, 0, 0, fmtMoney(vA), { size: 62, sub: t < A.y10 ? 'EMERGENCY FUND' : t < A.y20 ? 'BUYS THIS MUCH TODAY' : 'BUYS THIS MUCH TODAY', alpha: tagIn }); g.restore(); }
      g.restore();
    }
    // ── grocery basket: what the money can buy ─────────────────────────────────
    const bIn = tw(t, A.buy - 0.1, 0.6, ease.outBack);
    if (bIn > 0.01 && out0(t) < 0.999) {
      const fill = t < A.y10 ? 1 : t < A.y20 ? lerp(1, 0.72, tw(t, A.y10, A.v37 - A.y10 + 0.4, ease.inOutCubic)) : lerp(0.72, 0.55, tw(t, A.y20, A.v27 - A.y20 + 0.4, ease.inOutCubic));
      const out = tw(t, A.rate - 0.6, 0.5, ease.inCubic);
      g.save(); g.globalAlpha = bIn * (1 - out); g.translate(out * 260, 0); g.translate(X.basket, baseY + 14 + (1 - bIn) * -70);
      pr.basket(g, 0, 0, { w: 250, fill });
      g.restore();
    }
    // ── savings: nominal (gold coins) vs real (bills) at 10 years ──────────────
    const sIn = tw(t, A.rate + 0.1, 0.6, ease.outCubic);
    if (sIn > 0.01) {
      const nomV = t < A.grows ? 50000 : countTo(t, A.grows, A.v77 - A.grows + 0.3, 50000, V.nominal10, ease.inOutCubic);
      const realVis = tw(t, A.adjust - 0.1, 0.5, ease.outCubic);
      g.save(); g.globalAlpha = sIn;
      // reference line: where the money started
      const lineY = baseY - 50 * PX_PER_K; g.save(); g.globalAlpha *= 1 - tw(t, A.cash - 0.2, 0.4, ease.linear); g.setLineDash([18, 12]); g.strokeStyle = 'rgba(26,39,68,0.55)'; g.lineWidth = 4; g.beginPath(); g.moveTo(40, lineY); g.lineTo(560, lineY); g.stroke(); g.restore();
      g.save(); g.globalAlpha *= 1 - tw(t, A.cash - 0.2, 0.4, ease.linear); pr.pill(g, 640, lineY - 30, '$50,000 TODAY', { size: 24, fill: P.navy, align: 'center' }); g.restore();
      const rc = pr.coinStack(g, X.coin, baseY, { n: nomV / 2000, w: 165, th: COIN_TH });
      const topN = baseY - (nomV / 2000) * COIN_TH - 30;
      g.save(); g.globalAlpha *= 1 - tw(t, A.cash - 0.2, 0.4, ease.linear); pr.tag(g, X.coin, topN - 12, fmtMoney(nomV), { size: 46, sub: 'IN 10 YEARS', pad: 22 }); g.restore();
      if (realVis > 0.01) {
        const realV = countTo(t, A.adjust, A.v57 - A.adjust + 0.3, V.nominal10, V.realOfNominal10, ease.inOutCubic);
        g.save(); g.globalAlpha = realVis; const rb = pr.billStack(g, X.real, baseY, { n: realV / 1000, w: 210, th: PX_PER_K });
        g.save(); g.globalAlpha *= 1 - tw(t, A.cash - 0.2, 0.4, ease.linear); pr.tag(g, X.real, rb.top - 30, fmtMoney(realV), { size: 46, sub: "IN TODAY'S DOLLARS", pad: 22 }); g.restore(); g.restore();
      }
      g.restore();
    }
  }

  function drawOverlay(g, t) {
    // ── wall timeline board (time as a visible axis, not a caption) ─────────────
    const bx = 70, by = 215, bw = 640, bh = 140;
    const nodes = [{ x: bx + 120, lab: 'NOW' }, { x: bx + bw / 2, lab: '10 YEARS' }, { x: bx + bw - 120, lab: '20 YEARS' }];
    const prog = t < A.y10 ? 0 : t < A.y20 ? tw(t, A.y10, A.v37 - A.y10 + 0.4, ease.inOutCubic) * 0.5 : 0.5 + tw(t, A.y20, A.v27 - A.y20 + 0.4, ease.inOutCubic) * 0.5;
    const boardOut = tw(t, A.cash - 0.4, 0.5, ease.inCubic); const boardIn = tw(t, A.infl - 0.2, 0.5, ease.outBack) * (1 - boardOut);
    if (boardIn > 0.01) { g.save(); g.globalAlpha = boardIn; g.translate(0, (1 - boardIn) * -30);
    g.strokeStyle = P.canvasDeep; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(nodes[0].x, by + 62); g.lineTo(nodes[2].x, by + 62); g.stroke();
    g.strokeStyle = P.gold; g.beginPath(); g.moveTo(nodes[0].x, by + 62); g.lineTo(lerp(nodes[0].x, nodes[2].x, prog), by + 62); g.stroke();
    nodes.forEach((n, i) => { const on = prog >= i * 0.5 - 1e-6; g.fillStyle = on ? P.gold : P.canvasDeep; g.beginPath(); g.arc(n.x, by + 62, 16, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke(); text(g, n.lab, n.x, by + 122, { weight: 800, size: 30, color: on ? P.ink : P.inkMute, align: 'center' }); });
    text(g, 'PRICES RISE 3% A YEAR', bx + bw / 2, by + 34, { weight: 800, size: 26, color: P.inkMute, align: 'center', spacing: 2 });
    g.restore(); }

    // ── closing typography (two-face system): the takeaway on the wall ──────────
    const cIn = tw(t, A.cash, 0.5, ease.outCubic), wIn = tw(t, A.work, 0.5, ease.outBack);
    if (cIn > 0.01) { g.save(); g.globalAlpha = cIn; g.translate(0, (1 - cIn) * 30); text(g, "Cash isn't safe", 70, 320, { kind: 'display', weight: 800, size: 84, color: P.ink }); text(g, 'from time.', 70, 414, { kind: 'display', weight: 800, size: 84, color: P.ink }); g.restore(); }
    if (wIn > 0.01) { g.save(); g.globalAlpha = wIn; g.translate(0, (1 - wIn) * 24); text(g, 'Put it to work.', 70, 512, { kind: 'display', weight: 800, size: 84, color: P.goldDark }); g.fillStyle = P.gold; g.fillRect(70, 540, 200 * wIn, 8); g.restore(); }
  }
  function draw(g, t) {
    g.save(); const d = drift(t, 5, 8); const c = camC(t); applyCamera(g, { x: c.x + d.dx, y: c.y + d.dy, z: c.z }, { w: W, h: H }); drawWorld(g, t); g.restore();
    // screen-space overlay: explanatory board + typography (always inside the safe area), captions, brand mark
    drawOverlay(g, t);
    drawCaptions(g, chunks, t, format);
    text(g, 'NEXTWAVE', 64, 132, { weight: 900, size: 34, color: P.ink, spacing: 3, alpha: 0.9 }); g.fillStyle = P.gold; g.fillRect(64, 148, 70, 5);
  }
  return { draw, duration: endT, anchors: A, verified: V };
}
