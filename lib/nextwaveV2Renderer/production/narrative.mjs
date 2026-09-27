// NextWave V2 production — RICH NARRATIVE TREATMENT for Brain `avatar_panel` scenes.
// A narrative scene is never "host + window + small tag": it is composed from what the storyboard already knows.
//   environment  <- topic of the scene (and its neighbours): delay/time -> road, loan/rate -> city, monthly/invest/fee -> office,
//                   prices/goods -> kitchen, otherwise the studio. Changes only when the argument changes topic.
//   focal object <- the scene's own verified values: money -> value-encoded stack (ONE scale for the whole video),
//                   duration -> timeline with the span filled as it is spoken, percent -> badge on the thing it prices,
//                   no value -> a large topical metaphor (house / hourglass / jar / calendar / tree).
//   closing      <- a recap of every verified comparison in the script as physical stacks (each gap next to its topic).
// Every string drawn is a storyboard value display or a label taken from the storyboard's own renderer_params. The host stands behind
// the surface at the side and supports the explanation.
import { P, tw, ease, lerp, text, rr, lin, shadowed, groundShadow, wrap } from '../core.mjs';
import * as pr from '../props.mjs';
import * as p2 from '../props2.mjs';
import * as p3 from '../props3.mjs';
import * as st from '../sets.mjs';
import { hostLayer } from '../scenes.mjs';
import { eventTime } from './timing.mjs';

const fmt$ = (v) => '$' + Math.round(v).toLocaleString('en-US');
const moneyOf = (s) => { const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(String(s || '')); return m ? Number(m[1].replace(/,/g, '')) : null; };
// Topic evidence with PRECEDENCE. A bare "rate"/"interest"/"account" is ambiguous (mortgage rate, savings rate, investment rate) and never decides alone.
//   loan evidence    : mortgage, loan, borrow/borrowed/borrowing, debt, lender, refinance, APR, home/house
//   savings evidence : savings, deposit, APY, yield, certificate of deposit, savings/deposit/bank account, high-yield
//   both present     : the strong loan words (mortgage/loan/borrow/debt/lender/refinance/APR) win; otherwise the more frequent evidence wins, loan on a tie
//   neither          : investing/fees/returns -> invest; then prices; then time
const LOAN_STRONG = /\b(mortgage|loan|loans|borrow|borrowed|borrowing|debt|lender|refinance|refinancing|apr)\b/gi;
const LOAN_WEAK = /\b(home|house)\b/gi;
const SAVINGS = /\b(savings|deposit|deposits|apy|yield|yields|certificate of deposit|cd|bank account|high-yield)\b/gi;
const RX = { time: /\b(wait|waiting|delay|start|starts|started|early|late|time|when)\b/i, invest: /\b(invest|monthly|month|paycheck|contribut|fund|fee|fees|portfolio|return|returns)\b/i, price: /\b(price|prices|grocer|inflation|buys?|afford|cost of living)\b/i };
const count = (re, str) => (String(str).match(re) || []).length;
export const topicOf = (s) => { const strong = count(LOAN_STRONG, s), weak = count(LOAN_WEAK, s), sav = count(SAVINGS, s); const loan = strong + weak;
  if (strong > 0 && (sav === 0 || strong >= sav)) return 'loan'; if (sav > 0 && (loan === 0 || sav > loan)) return 'savings'; if (loan > 0) return 'loan';
  return /\b(fees?|charging|expense)\b/i.test(s) ? 'invest' : RX.price.test(s) ? 'price' : RX.time.test(s) ? 'time' : RX.invest.test(s) ? 'invest' : null; };
const ENV_OF = { loan: 'neighbourhood', savings: 'finance', time: 'road', invest: 'finance', price: 'kitchen' };

export function comparisons(scenes) { // every verified comparison in the script: { label, gap, a, b }
  const out = [];
  (scenes || []).forEach((s) => { const p = s.renderer_params || {};
    if ((p.series || []).length === 2) { const a = moneyOf(p.series[0].finalValueText), b = moneyOf(p.series[1].finalValueText); if (a != null && b != null) out.push({ label: p.subLabel || p.label || '', a, b, gap: Math.abs(a - b), tone: 'red', names: [p.series[0].label, p.series[1].label], topic: topicOf(s.narration.text + ' ' + (p.series[1].label || '')) }); }
    else if (p.displayMode === 'bar') { const a = moneyOf(p.beforeValue), b = moneyOf(p.afterValue); if (a != null && b != null) out.push({ label: p.anchorText || p.headerLabel || '', a, b, gap: Math.abs(a - b), tone: 'red', names: [p.beforeLabel, p.afterLabel], topic: topicOf(s.narration.text + ' ' + (p.afterLabel || '') + ' ' + (p.anchorText || '')) }); } });
  return out;
}
export function globalMoneyMax(storyboard) { let m = 0; (storyboard.values || []).forEach((v) => { if (v.kind === 'money' && typeof v.value === 'number') m = Math.max(m, v.value); }); return m || 1; }

export function pickEnv(ctx) {
  const { sceneInfo, allScenes, index } = ctx; const own = sceneInfo.narration.text; const isFirst = index === 0, isLast = index === allScenes.length - 1;
  let t = topicOf(own);
  if (!t) { // no topical words: continue the previous topic; if none, look ahead one scene
    for (let i = index - 1; i >= 0 && !t; i--) t = topicOf(allScenes[i].narration.text);
    if (!t && allScenes[index + 1]) t = topicOf(allScenes[index + 1].narration.text);
  }
  if (isFirst && !isLast) return { env: 'studio', topic: t }; // the hook opens in the studio; the argument moves out from there
  if (isLast) return { env: 'studio', topic: t };
  return { env: ENV_OF[t] || 'studio', topic: t };
}

export function surface(g, ctx, env, t) {
  const { L, BN, span } = ctx; const { W, H, base } = L;
  if (env === 'studio') { pr.studioSet(g, { w: W, h: H, t, floor: L.floor, window: !L.short }); return { y: base + 14, front: (host) => pr.desk(g, { x0: -300, x1: W + 300, topY: base, bottom: H + 40 }) }; }
  if (env === 'office') { st.officeSet(g, { w: W, h: H, t, deskY: base }); return { y: base + 14, front: () => pr.desk(g, { x0: -200, x1: W + 200, topY: base, bottom: H + 40 }) }; }
  if (env === 'city') { st.citySet(g, { w: W, h: H, deskY: base }); return { y: base + 14, front: () => pr.desk(g, { x0: -200, x1: W + 200, topY: base, bottom: H + 40 }) }; }
  if (env === 'neighbourhood' || env === 'finance') { const key = env === 'finance' ? (L.short ? 'finTall' : 'finWide') : (L.short ? 'hoodTall' : 'hoodWide'); p3.coverImage(g, BN.bg[key], W, H, { ay: 0.5 }); return { y: base + 14, front: () => pr.desk(g, { x0: -200, x1: W + 200, topY: base, bottom: H + 40 }) }; }
  if (env === 'kitchen') { p3.coverImage(g, L.short ? BN.bg.kitchenTall : BN.bg.kitchenWide, W, H, { ay: L.short ? 0.2 : 0.3 }); g.fillStyle = lin(g, 0, base - 40, 0, H, [[0, '#D9B98C'], [1, '#B58F63']]); g.fillRect(0, base - 40, W, H); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(0, base - 40, W, 6); return { y: base + 6, front: () => st.counterFront(g, { w: W, y: base + 26, h: H + 40 }) }; }
  // road
  p3.coverImage(g, BN.bg.roadWide, W, H, { ay: 0.7 }); g.fillStyle = 'rgba(247,244,238,0.08)'; g.fillRect(0, 0, W, H); p3.pathRibbon(g, 0, W, base - 30, { h: 96, alpha: 0.9 });
  return { y: base + 30, front: () => st.counterFront(g, { w: W, y: base + 120, h: base + 250, kind: 'hedge' }) };
}

const TONE_RED = /\b(cost|costs|lose|lost|extra|gap|difference|never got|only)\b/i;
export function narrativeScene(ctx) {
  const { L, p, span, words, poses, sceneInfo, valuesById, allScenes, G, index } = ctx; const { W, H, base } = L; const short = L.short;
  const isLast = index === allScenes.length - 1; const isFirst = index === 0; const { env, topic } = pickEnv(ctx);
  const own = sceneInfo.narration.text; const intent = ctx.intent || '';
  // the scene's own verified values, each with the time it is spoken
  const vals = (sceneInfo.reveal_steps || []).map((r) => ({ v: valuesById.get(r.entity_id), t: eventTime(words, span, r.meaning_event_pattern, 0.5).t })).filter((x) => x.v && /money|percent|duration/.test(x.v.kind));
  const money = vals.filter((x) => x.v.kind === 'money' && typeof x.v.value === 'number'); const dur = vals.find((x) => x.v.kind === 'duration'); const pct = vals.find((x) => x.v.kind === 'percent');
  const recap = isLast && comparisons(allScenes).length > 0; const cmps = comparisons(allScenes);
  // scale: the tallest value IN THIS SCENE fills the focal zone (a solo object must command the frame); values in the same scene share the scale, so any comparison stays honest
  const sceneMax = money.length ? Math.max(...money.map((m) => m.v.value)) : G.maxMoney; const pxPerK = (short ? 640 : 520) / (sceneMax / 1000); const unitK = Math.max(1, Math.ceil(sceneMax / 1000 / 60));
  const zone = short ? { x0: 60, x1: 720 } : { x0: 220, x1: 1200 }; const hostX = short ? 860 : 1610;
  const pose = isLast ? 'react' : /hook/.test(intent) ? 'point' : /explanation/.test(intent) ? 'compare' : 'think';
  const kind = kindFor(own, topic, !!dur, !!money.length, !!pct);
  const cam = [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.start + (span.end - span.start) * 0.6, x: W / 2 - (short ? 0 : 40), y: H / 2 - 12, z: 1.05 }, { t: span.end, x: W / 2 - (short ? 0 : 60), y: H / 2 - 20, z: 1.08 }];
  return {
    t0: span.start, t1: span.end, world: { w: W, h: H }, camera: cam, meta: { kit: recap ? 'recap' : money.length ? 'value_stack' : dur ? 'timeline' : 'metaphor', env, topic },
    draw(g, t) {
      const sf = surface(g, ctx, env, t); const y = sf.y;
      const pop = (k, x, yy, str, o) => { if (k <= 0.01) return; g.save(); g.translate(x, yy); g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k); pr.tag(g, 0, 0, str, { ...o, alpha: Math.min(1, k * 1.4) }); g.restore(); };
      const pill = (k, x, yy, str, o) => { if (k <= 0.01) return; g.save(); g.globalAlpha *= Math.min(1, k * 1.5); g.translate(x, yy + (1 - k) * 16); pr.pill(g, 0, 0, str, o); g.restore(); };
      const enter = tw(t, span.start + 0.15, 0.7, ease.outBack); let recapPost = [];
      if (recap) recapPost = drawRecap(g, t, { ctx, cmps, y, zone, pxPerK, unitK, pop, pill, short, W, H, span });
      else {
        // ── focal composition ──
        const cx0 = zone.x0, cx1 = zone.x1; const nM = money.length;
        if (dur) { // timeline of the span: filled as it is spoken; ticks are the span's own unit
          const yrs = Math.max(1, Math.round(dur.v.value)); const ty = y - (short ? 640 : 600); const x0 = cx0 + 40, x1 = cx1 - 40; const k = tw(t, span.start + 0.2, 0.6, ease.outCubic);
          if (k > 0.01) { g.save(); g.globalAlpha = k; shadowed(g, () => { rr(g, x0 - 50, ty - 70, x1 - x0 + 100, 150, 28); g.fillStyle = 'rgba(255,255,255,0.93)'; g.fill(); }, { blur: 22, dy: 10 });
            g.strokeStyle = P.canvasDeep; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, ty); g.lineTo(x1, ty); g.stroke(); const fill = tw(t, dur.t - 0.2, 1.6, ease.inOutCubic); g.strokeStyle = P.gold; g.beginPath(); g.moveTo(x0, ty); g.lineTo(lerp(x0, x1, fill), ty); g.stroke();
            for (let i = 0; i <= Math.min(yrs, 12); i++) { const xx = lerp(x0, x1, i / Math.min(yrs, 12)); g.fillStyle = xx <= lerp(x0, x1, fill) + 1 ? P.gold : P.canvasDeep; g.beginPath(); g.arc(xx, ty, 11, 0, 7); g.fill(); }
            text(g, 'NOW', x0, ty + 58, { weight: 800, size: 26, color: P.inkMute, align: 'center' }); text(g, `${dur.v.value} ${String(dur.v.unit || 'years').toUpperCase()}`.replace(/YEARS?S$/, 'YEARS'), x1, ty + 58, { weight: 800, size: 26, color: P.ink, align: 'center' }); g.restore(); }
          pill(tw(t, dur.t, 0.5, ease.outBack), (x0 + x1) / 2, ty - 100, dur.v.display, { size: short ? 40 : 38, fill: P.navy, pad: 30 });
        }
        if (nM) {
          const xs = money.map((_, i) => (nM === 1 ? (cx0 + cx1) / 2 : lerp(cx0 + 120, cx1 - 120, i / (nM - 1))));
          money.forEach((m, i) => { const grow = 0.14 + 0.86 * tw(t, span.start + 0.3, Math.max(1.4, m.t + 0.4 - span.start - 0.3), ease.inOutCubic); const red = TONE_RED.test(own) && /gap|difference|extra|cost/i.test(own); const x = xs[i]; groundShadow(g, x, y, 300, 0.24);
            const n = Math.max(0.01, (m.v.value / 1000 / unitK) * grow); const r = pr.billStack(g, x, y, { n, w: short ? 260 : 250, th: pxPerK * unitK, ground: false }); const topY = y - (m.v.value / 1000) * pxPerK * grow;
            pop(tw(t, m.t + 0.1, 0.5, ease.outBack), x, topY - 50, m.v.display, { size: short ? 62 : 60, sub: red ? 'THE COST' : (topic === 'loan' ? 'TOTAL' : ''), pad: 24, pointer: 'down', fill: red ? P.redSoft : P.paper, ink: red ? P.red : P.ink }); });
        } else if (!dur) { // large topical metaphor
          const k = enter; g.save(); g.globalAlpha = Math.min(1, k * 1.3); const fx = (cx0 + cx1) / 2; groundShadow(g, fx, y, 420, 0.22);
          if (kind === 'house' || kind === 'piggy') drawMetaphor(g, kind, fx, y, { short, BN: ctx.BN });
          else if (kind === 'hourglass') pr.hourglass(g, fx, y, { h: short ? 620 : 560, sand: 1 - tw(t, span.start + 0.5, span.end - span.start, ease.linear) * 0.7, ground: false });
          else if (kind === 'jar') pr.jar(g, fx, y, { w: short ? 380 : 340, level: 0.15 + 0.5 * tw(t, span.start + 0.3, span.end - span.start, ease.inOutCubic), ground: false });
          else if (kind === 'tree') p2.tree(g, fx, y, { h: short ? 700 : 620, grow: 0.3 + 0.7 * tw(t, span.start + 0.3, span.end - span.start, ease.inOutCubic), coins: 8, ground: false });
          else pr.coinStack(g, fx, y, { n: 12, w: 260, th: 18, ground: false }); g.restore();
        }
        if (pct) { // the rate, as a badge attached to what it prices (house for loans, jar/coins otherwise)
          const bx = short ? 500 : 900, by = y - (short ? 470 : 420), k = tw(t, pct.t, 0.5, ease.outBack); if (k > 0.01) { g.save(); g.translate(bx, by); g.scale(0.5 + 0.5 * k, 0.5 + 0.5 * k); g.globalAlpha = Math.min(1, k * 1.4); shadowed(g, () => { g.fillStyle = P.gold; g.beginPath(); g.arc(0, 0, 118, 0, 7); g.fill(); }, { blur: 22, dy: 10 }); g.strokeStyle = '#fff'; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, 104, 0, 7); g.stroke(); text(g, pct.v.display, 0, 20, { weight: 900, size: 62, color: '#fff', align: 'center' }); g.restore(); }
        }
      }
      // host: supports the explanation from the side, behind the surface
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose }, { t: span.start + (span.end - span.start) * 0.55, pose: isLast ? 'react' : 'point' }], x: hostX, bottom: L.hostBottom + (env === 'road' ? 90 : 0), scale: L.hostS * (short ? 0.7 : 0.9), enter: tw(t, span.start + 0.05, 0.8, ease.outBack) });
      sf.front(); recapPost.forEach((f) => f());
      if (isLast) { const a = tw(t, span.start + 0.6, 0.7, ease.outCubic); const line = String(p.text || own).match(/[^.!?]+[.!?]+/g); const last = (line ? line[line.length - 1] : own).trim(); const size = short ? 70 : 54; const lines = wrap(g, last, short ? 620 : 940, { kind: 'display', weight: 800, size });
        if (a > 0.01 && lines.length <= 4) { g.save(); g.globalAlpha = 0.93 * a; g.fillStyle = P.canvas; rr(g, short ? 40 : 310, short ? 250 : 60, short ? 700 : 1000, 40 + lines.length * (size + 8), 26); g.fill(); g.globalAlpha = a; lines.forEach((ln, i) => text(g, ln, short ? 70 : 340, (short ? 330 : 120) + i * (size + 8), { kind: 'display', weight: 800, size, color: i === lines.length - 1 ? P.goldDark : P.ink })); g.restore(); } }
    },
  };
}

export function kindFor(own, topic, hasDur, hasMoney, hasPct) {
  if (/\b(savings?|deposit|account|bank)\b/i.test(own)) return 'piggy';
  if (/\b(home loan|mortgage|house|home|borrow)\b/i.test(own) || topic === 'loan') return 'house';
  if (/\b(start|wait|when|delay|time)\b/i.test(own) || topic === 'time') return 'hourglass';
  if (/\b(compound|grow|growth|earn)/i.test(own)) return 'tree';
  if (/\b(month|paycheck|invest|fund|fee)\b/i.test(own) || topic === 'invest') return 'jar';
  return 'coins';
}

// closing: every verified comparison as a pedestal object — the prop of its topic (hourglass / house / coins) carrying its own verified gap.
// (Gaps of very different size are NOT drawn to one scale here: the recap is a "what each choice cost" scoreboard; the sized stacks were shown in each scene.)
function drawRecap(g, t, { ctx, cmps, y, zone, pop, pill, short, W, H, span }) {
  const post = []; const n = Math.min(cmps.length, 4); const rz = short ? { x0: 120, x1: 680 } : { x0: 240, x1: 1250 }; const propW = short ? (n > 2 ? 190 : 260) : 250;
  cmps.slice(0, n).forEach((c, i) => { const x = n === 1 ? (rz.x0 + rz.x1) / 2 : lerp(rz.x0 + propW / 2, rz.x1 - propW / 2, i / (n - 1)); const at = span.start + 0.4 + i * 1.0; const k = tw(t, at, 0.7, ease.outBack); if (k < 0.01) return;
    g.save(); g.globalAlpha = Math.min(1, k * 1.3); groundShadow(g, x, y, propW * 1.3, 0.24);
    if (c.topic === 'loan') pr.house(g, x, y, { w: propW * 1.35, ground: false }); else if (c.topic === 'savings' && ctx.BN && ctx.BN.prop.piggy) p3.sprite(g, ctx.BN.prop.piggy, x, y + 6, propW * 1.25); else if (c.topic === 'time') pr.hourglass(g, x, y, { h: propW * 1.25, sand: 0.35, ground: false }); else pr.coinStack(g, x, y, { n: 10, w: propW * 0.8, th: propW * 0.07, ground: false }); g.restore();
    const propH = c.topic === 'loan' ? propW * 1.0 : c.topic === 'savings' ? propW * 0.95 : c.topic === 'time' ? propW * 1.25 : propW * 0.8;
    pop(tw(t, at + 0.45, 0.5, ease.outBack), x, y - propH - 60, fmt$(c.gap), { size: short ? (n > 2 ? 44 : 56) : 54, sub: 'THE COST', pad: 20, pointer: 'down', fill: P.redSoft, ink: P.red });
    const nm = String((c.names && c.names[1]) || c.label || '').slice(0, 24); if (nm) pill(tw(t, at + 0.7, 0.5, ease.outBack), x, y - propH - 205, nm, { size: short ? 18 : 22, fill: P.navy, pad: 14 }); });
  return post;
}

// a metaphor prop by kind (shared by narrative scenes and by bridge scenes merged into the next evidence scene)
export function drawMetaphor(g, kind, fx, y, { short, t = 0, t0 = 0, dur = 4, w = 1, BN = null } = {}) {
  groundShadow(g, fx, y, 420 * w, 0.22);
  if (kind === 'house' && BN && BN.prop.house) p3.sprite(g, BN.prop.house, fx, y + 6, (short ? 620 : 600) * w);
  else if (kind === 'piggy' && BN && BN.prop.piggy) p3.sprite(g, BN.prop.piggy, fx, y + 6, (short ? 470 : 430) * w);
  else if (kind === 'house') pr.house(g, fx, y, { w: (short ? 560 : 520) * w, ground: false });
  else if (kind === 'hourglass') pr.hourglass(g, fx, y, { h: (short ? 620 : 560) * w, sand: 1 - tw(t, t0 + 0.4, dur, ease.linear) * 0.7, ground: false });
  else if (kind === 'jar') pr.jar(g, fx, y, { w: (short ? 380 : 340) * w, level: 0.15 + 0.5 * tw(t, t0 + 0.3, dur, ease.inOutCubic), ground: false });
  else if (kind === 'tree') p2.tree(g, fx, y, { h: (short ? 700 : 620) * w, grow: 0.3 + 0.7 * tw(t, t0 + 0.3, dur, ease.inOutCubic), coins: 8, ground: false });
  else pr.coinStack(g, fx, y, { n: 12, w: 260 * w, th: 18 * w, ground: false });
}
export function bridgeInfo(ctx) { const { sceneInfo, allScenes, index } = ctx; const own = sceneInfo.narration.text; const topic = topicOf(own) || topicOf((allScenes[index + 1] || {}).narration && allScenes[index + 1].narration.text || ''); return { kind: kindFor(own, topic, false, false, false), topic, text: own }; }
