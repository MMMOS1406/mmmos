// BENCHMARK CANDIDATE — SHORT v2 (9:16): five environments, one argument.
//   studio (the claim) -> kitchen (what money BUYS) -> road (time, the same basket over 10 and 20 years)
//   -> city / savings (nominal vs real) -> studio (the takeaway, a tree growing).
// Every figure comes from the deterministic calculators (verifiedNumbers); heights share one scale.
import { P, STYLE, tw, ease, lerp, countTo, fmtMoney, text, rr, shadowed, groundShadow } from '../core.mjs';
import * as pr from '../props.mjs';
import * as p2 from '../props2.mjs';
import * as st from '../sets.mjs';
import { anchorTimes } from '../motion.mjs';
import { drawCaptions, chunkWords } from '../captions.mjs';
import { makeSequence, hostLayer } from '../scenes.mjs';
import { SCRIPT, ANCHORS, verifiedNumbers } from './short_inflation.mjs';
export { SCRIPT };

const PX = 8;            // px per $1,000 (bills 1 per $1K, coins 1 per $2K): ONE scale for the whole video
const COIN = PX * 2;

export function buildShortV2({ format, words, assets }) {
  const { w: W, h: H } = format; const V = verifiedNumbers(); const A = anchorTimes(words, ANCHORS); const endT = words[words.length - 1].end + 1.3;
  const chunks = chunkWords(words); const poses = assets.poses;
  const B1 = A.buy - 0.15, B2 = A.y10 - 0.55, B3 = A.rate - 0.95, B4 = A.still - 0.35;   // scene starts (transition ends here)
  const HOST = 0.94;

  // ── shared value helpers ──────────────────────────────────────────────────────
  const vStack = (t) => (t < 0.3 ? 0 : t < B1 ? Math.min(50000, 50000 * tw(t, 0.3, 1.3, ease.outCubic)) : 50000);
  const stackTag = (g, x, top, val, sub, k = 1, size = 60) => { if (k < 0.02) return; g.save(); g.translate(x, top - 34); const sc = 0.6 + 0.4 * k; g.scale(sc, sc); pr.tag(g, 0, 0, fmtMoney(val), { size, sub, alpha: k, pad: 26 }); g.restore(); };
  const leaving = (g, t, x, y, times, ta, tb, w) => times.forEach((tl, k) => { const p = (t - tl) / 1.5; if (p <= 0 || p >= 1) return; g.save(); g.globalAlpha *= 1 - ease.inCubic(p); pr.bill(g, x + p * (50 + (k % 4) * 22), y - PX * k - 20 - ease.outCubic(p) * 190, w, 100, { rot: p * 0.7 * (k % 2 ? 1 : -1) }); g.restore(); });

  // ── S1 STUDIO: the claim ──────────────────────────────────────────────────────
  const DESK = 1235;
  const s1 = {
    t0: 0, t1: B1, world: { w: W, h: H }, camera: [{ t: 0, x: 540, y: 960, z: 1.0 }, { t: B1, x: 540, y: 960, z: 1.04 }],
    draw(g, t) {
      pr.studioSet(g, { w: W, h: H, t, floor: 0.51, window: false });
      const enter = tw(t, 0.05, 0.9, ease.outBack);
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'point' }], x: 720, bottom: DESK + 90, scale: HOST * 0.94, enter });
      pr.desk(g, { x0: -300, x1: W + 300, topY: DESK, bottom: H + 40 });
      const v = vStack(t) - (t > A.shrinking ? 2200 * tw(t, A.shrinking, B1 - A.shrinking, ease.inOutCubic) : 0);
      const r = pr.billStack(g, 235, DESK + 18, { n: v / 1000, w: 250, th: PX });
      stackTag(g, 235, r.top, v, 'EMERGENCY FUND', tw(t, A.fund - 0.05, 0.45, ease.outBack));
    },
  };

  // ── S2 KITCHEN: what the money buys ───────────────────────────────────────────
  const S2 = { items: [['bread', 380], ['milk', 520], ['apple', 640], ['cheese', 790], ['carrot', 940]] };
  const s2 = {
    t0: B1, t1: B2, world: { w: W, h: H }, camera: [{ t: B1, x: 540, y: 1000, z: 1.0 }, { t: B2, x: 560, y: 1040, z: 1.12 }],
    draw(g, t) {
      const set = st.kitchenSet(g, { w: W, h: H, counterY: 1235 }); const y = set.surfaceY;
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'compare' }], x: 860, bottom: y + 160, scale: HOST * 0.8, flip: false });
      st.counterFront(g, { w: W, y: y + 26, h: H + 40 });
      const kIn = tw(t, B1 - 0.3, 0.5, ease.outCubic);
      const v = 50000 - 2200; const r = pr.billStack(g, 185, y + 18, { n: v / 1000, w: 230, th: PX });
      stackTag(g, 185, r.top, v, 'BUYS THIS MUCH', kIn);
      S2.items.forEach(([k, x], i) => { const a = tw(t, A.buy + i * 0.12, 0.45, ease.outBack); if (a < 0.01) return; g.save(); g.globalAlpha = a; p2.grocery(g, k, x, y + 30 - (1 - a) * 60, 1.25); g.restore();
        const pIn = tw(t, A.infl + i * 0.18, 0.4, ease.outBack); if (pIn > 0.01) pr.pill(g, x, y - 290 - (1 - pIn) * -30, '+3%', { size: 34, fill: P.red }); });
      text(g, 'PRICES RISE 3% A YEAR', 540, 420, { weight: 900, size: 40, color: P.ink, align: 'center', spacing: 3, alpha: tw(t, A.infl - 0.1, 0.5, ease.outCubic) });
    },
  };

  // ── S3 ROAD: the same basket, years apart ─────────────────────────────────────
  const POSTS = [330, 1330, 2330]; const RW = 3000; const ROAD = 1160;
  const times = { real10: V.real10, real20: V.real20 };
  const s3 = {
    t0: B2, t1: B3, world: { w: RW, h: H },
    camera: [{ t: B2, x: 540, y: 1010, z: 1.16 }, { t: A.y10 - 0.4, x: 540, y: 1010, z: 1.16 }, { t: A.y10 + 0.8, x: 1330, y: 1010, z: 1.16 }, { t: A.y20 - 0.5, x: 1330, y: 1010, z: 1.16 }, { t: A.y20 + 0.8, x: 2330, y: 1010, z: 1.16 }, { t: B3, x: 2330, y: 1010, z: 1.16 }],
    draw(g, t) {
      const set = st.roadSet(g, { w: RW, h: H, roadY: ROAD, posts: POSTS }); const y = set.surfaceY + 5;
      // host at the NOW post, facing the road ahead
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'card' }, { t: A.y10, pose: 'point' }], x: 130, bottom: y + 30, scale: HOST * 0.85, flip: true });
      st.counterFront(g, { w: 700, y: y - 30, h: H + 40, kind: 'hedge' });
      const post = (i, label, val, tIn, sub) => {
        const x = POSTS[i]; const k = tw(t, tIn, 0.5, ease.outBack); if (k < 0.01) return;
        p2.signboard(g, x - 5, ROAD + 30, label, { h: 560, alpha: k });
        g.save(); g.globalAlpha = k;
        const n = val / 1000; const r = pr.billStack(g, x - 150, y + 80, { n, w: 200, th: PX });
        // ghost of the original height + basket that buys less
        if (i > 0) { g.save(); g.setLineDash([14, 10]); g.strokeStyle = 'rgba(176,65,62,0.75)'; g.lineWidth = 5; rr(g, x - 150 - 110, y + 80 - 50 * PX - 8, 220, 50 * PX, 8); g.stroke(); g.restore(); }
        stackTag(g, x - 150, r.top, val, sub, k, 52);
        const items = ['bread', 'milk', 'apple', 'cheese', 'carrot']; const cnt = Math.max(1, Math.round((val / 50000) * 5)); const sc = 0.55 + 0.45 * (val / 50000);
        p2.basket ? null : null; pr.basket(g, x + 150, y + 96, { w: 250, fill: 0 });
        items.slice(0, cnt).forEach((it, j) => p2.grocery(g, it, x + 60 + j * 55, y + 58 - (j % 2) * 4, 0.55 * sc));
        g.restore();
      };
      post(0, 'NOW', 50000 - 2200 + 2200, B2 - 0.2, 'TODAY');
      post(1, '10 YEARS', V.real10, A.y10 + 0.1, 'BUYS THIS MUCH');
      post(2, '20 YEARS', V.real20, A.y20 + 0.1, 'BUYS THIS MUCH');
      // "nearly half of its power, gone": bracket at the last post
      const hb = tw(t, A.half, 0.7, ease.outCubic); if (hb > 0.01) { const x = POSTS[2] - 150 + 150, top50 = y + 80 - 50 * PX, top27 = y + 80 - (V.real20 / 1000) * PX; g.save(); g.globalAlpha = hb; g.strokeStyle = P.red; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, top50); g.lineTo(x, top50 + (top27 - top50) * hb); g.moveTo(x - 14, top50); g.lineTo(x + 14, top50); g.stroke(); pr.pill(g, x + 100, (top50 + top27) / 2, 'NEARLY HALF GONE', { size: 26, fill: P.red }); g.restore(); }
    },
  };

  // ── S4 CITY: savings, nominal vs real ─────────────────────────────────────────
  const s4 = {
    t0: B3, t1: B4, world: { w: W, h: H }, camera: [{ t: B3, x: 540, y: 960, z: 1.0 }, { t: A.grows - 0.5, x: 500, y: 930, z: 1.08 }, { t: B4, x: 520, y: 930, z: 1.08 }],
    draw(g, t) {
      const set = st.citySet(g, { w: W, h: H, deskY: 1235 }); const y = set.surfaceY;
      const react = t > A.v57 + 1.5;
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'compare' }, { t: A.adjust, pose: 'think' }, { t: A.v57 + 0.8, pose: 'react' }], x: 900, bottom: y + 90, scale: HOST * 0.86 });
      pr.desk(g, { x0: -300, x1: W + 300, topY: y, bottom: H + 40 });
      const base = y + 18;
      // savings account = piggy bank; a coin drops in on every beat of the growth
      const pIn = tw(t, A.rate - 0.6, 0.6, ease.outBack);
      if (pIn > 0.01) { g.save(); g.globalAlpha = pIn; const cyc = ((t - A.rate) % 1.2) / 1.2; p2.piggy(g, 170, base, { w: 290, coin: t > A.rate && t < A.v77 + 0.6 ? cyc : -1, blink: Math.sin(t * 2) > 0.97 }); g.restore(); }
      const nomV = t < A.grows ? 50000 : countTo(t, A.grows, Math.max(0.8, A.v77 - A.grows - 0.3), 50000, V.nominal10, ease.inOutCubic);
      const cIn = tw(t, A.rate + 0.8, 0.7, ease.outCubic);
      if (cIn > 0.01) {
        g.save(); g.globalAlpha = cIn; const lineY = base - 50 * PX; g.setLineDash([18, 12]); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 4; g.beginPath(); g.moveTo(30, lineY); g.lineTo(560, lineY); g.stroke(); g.setLineDash([]);
        pr.pill(g, 150, lineY - 28, '$50,000 TODAY', { size: 24, fill: P.navy });
        pr.coinStack(g, 420, base, { n: nomV / 2000, w: 180, th: COIN });
        stackTag(g, 420, base - (nomV / 2000) * COIN - 30, nomV, 'IN 10 YEARS', 1, 46);
        g.restore();
      }
      const rIn = tw(t, A.adjust - 0.1, 0.6, ease.outCubic);
      if (rIn > 0.01) { const rv = countTo(t, A.adjust, Math.max(0.8, A.v57 - A.adjust - 0.3), V.nominal10, V.realOfNominal10, ease.inOutCubic); g.save(); g.globalAlpha = rIn; const rb = pr.billStack(g, 600, base, { n: rv / 1000, w: 200, th: PX }); stackTag(g, 600, rb.top, rv, "IN TODAY'S DOLLARS", 1, 46); g.restore(); }
    },
  };

  // ── S5 STUDIO: the takeaway, a tree that grows ────────────────────────────────
  const s5 = {
    t0: B4, t1: endT + 1, world: { w: W, h: H }, camera: [{ t: B4, x: 540, y: 960, z: 1.0 }, { t: endT, x: 540, y: 960, z: 1.05 }],
    draw(g, t) {
      pr.studioSet(g, { w: W, h: H, t, floor: 0.51, window: false });
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'react' }], x: 810, bottom: DESK + 90, scale: HOST * 0.94 });
      pr.desk(g, { x0: -300, x1: W + 300, topY: DESK, bottom: H + 40 });
      const grow = 0.3 + 0.7 * tw(t, A.work - 0.2, 2.0, ease.inOutCubic); p2.tree(g, 175, DESK + 30, { h: 640, grow, coins: Math.round(9 * tw(t, A.work, 2.0, ease.outCubic)) });
      const cIn = tw(t, A.cash, 0.5, ease.outCubic), wIn = tw(t, A.work, 0.5, ease.outBack);
      if (cIn > 0.01) { g.save(); g.globalAlpha = cIn; g.translate(0, (1 - cIn) * 30); text(g, "Cash isn't safe", 70, 300, { kind: 'display', weight: 800, size: 96, color: P.ink }); text(g, 'from time.', 70, 396, { kind: 'display', weight: 800, size: 96, color: P.ink }); g.restore(); }
      if (wIn > 0.01) { g.save(); g.globalAlpha = wIn; g.translate(0, (1 - wIn) * 24); text(g, 'Put it to work.', 70, 500, { kind: 'display', weight: 800, size: 96, color: P.goldDark }); g.fillStyle = P.gold; g.fillRect(70, 530, 240 * wIn, 9); g.restore(); }
    },
  };

  const seq = makeSequence({ format, scenes: [s1, s2, s3, s4, s5], transition: 0.6 });
  function draw(g, t) {
    seq(g, t);
    // one persistent timeline board across scenes 2-4 (screen space, inside the safe area)
    const bIn = tw(t, A.infl - 0.2, 0.5, ease.outBack) * (1 - tw(t, B4 - 0.2, 0.5, ease.inCubic));
    if (bIn > 0.01 && t > B2 - 0.7 && t < B4) { const bx = 70, by = 215, bw = 640, bh = 140; g.save(); g.globalAlpha = bIn; g.translate(0, (1 - bIn) * -30);
      shadowed(g, () => { rr(g, bx, by, bw, bh, 22); g.fillStyle = P.paper; g.fill(); }, { blur: 26, dy: 10 });
      const nodes = [bx + 120, bx + bw / 2, bx + bw - 120]; const prog = t < A.y10 ? 0 : t < A.y20 ? tw(t, A.y10, A.v37 - A.y10 + 0.4, ease.inOutCubic) * 0.5 : 0.5 + tw(t, A.y20, A.v27 - A.y20 + 0.4, ease.inOutCubic) * 0.5;
      g.strokeStyle = P.canvasDeep; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(nodes[0], by + 62); g.lineTo(nodes[2], by + 62); g.stroke(); g.strokeStyle = P.gold; g.beginPath(); g.moveTo(nodes[0], by + 62); g.lineTo(lerp(nodes[0], nodes[2], prog), by + 62); g.stroke();
      ['NOW', '10 YEARS', '20 YEARS'].forEach((lab, i) => { const on = prog >= i * 0.5 - 1e-6; g.fillStyle = on ? P.gold : P.canvasDeep; g.beginPath(); g.arc(nodes[i], by + 62, 16, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke(); text(g, lab, nodes[i], by + 122, { weight: 800, size: 30, color: on ? P.ink : P.inkMute, align: 'center' }); });
      text(g, 'PRICES RISE 3% A YEAR', bx + bw / 2, by + 34, { weight: 800, size: 26, color: P.inkMute, align: 'center', spacing: 2 }); g.restore(); }
    drawCaptions(g, chunks, t, format);
    text(g, 'NEXTWAVE', 64, 132, { weight: 900, size: 34, color: P.ink, spacing: 3, alpha: 0.9 }); g.fillStyle = P.gold; g.fillRect(64, 148, 70, 5);
  }
  return { draw, duration: endT, anchors: A, verified: V, scenes: [['studio', 0, B1], ['kitchen', B1, B2], ['road', B2, B3], ['city', B3, B4], ['studio', B4, endT]] };
}
