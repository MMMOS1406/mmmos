// NextWave V2 production — accepted-standard scene templates, one per Storyboard Brain treatment.
// Contract: a template receives the Brain scene's renderer_params (already verified/provenanced) and returns a sequencer
// scene { t0, t1, world, camera, draw }. Templates draw ONLY strings that come from renderer_params / storyboard values
// (or a documented derivation of them, registered through ctx.derive). Ideogram art carries no text.
import { P, tw, ease, lerp, countTo, text, rr, lin, shadowed, groundShadow, wrap } from '../core.mjs';
import * as pr from '../props.mjs';
import * as p2 from '../props2.mjs';
import * as p3 from '../props3.mjs';
import * as st from '../sets.mjs';
import { hostLayer } from '../scenes.mjs';
import { eventTime } from './timing.mjs';
import { narrativeScene } from './narrative.mjs';

export const layoutFor = (format) => (format.h > format.w
  ? { short: true, W: 1080, H: 1920, base: 1235, hostX: 790, hostS: 0.86, hostBottom: 1235 + 130, stageTop: 430, tagSize: 58, floor: 0.51 }
  : { short: false, W: 1920, H: 1080, base: 790, hostX: 1570, hostS: 0.78, hostBottom: 790 + 150, stageTop: 150, tagSize: 52, floor: 0.66 });

const moneyOf = (s) => { const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(String(s || '')); return m ? Number(m[1].replace(/,/g, '')) : null; };
const fmt$ = (v) => '$' + Math.round(v).toLocaleString('en-US');
const estW = (str, size, pad = 30) => String(str).length * size * 0.62 + pad * 2;
const pop = (g, k, x, y, str, o) => { if (k <= 0.01) return; if (o && o.W) { const half = estW(str, o.size || 64, o.pad || 30) / 2 + 40; x = Math.max(half, Math.min(o.W - half, x)); } g.save(); g.translate(x, y); g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k); pr.tag(g, 0, 0, str, { ...o, alpha: Math.min(1, k * 1.4) }); g.restore(); };
const pill = (g, k, x, y, str, o) => { if (k <= 0.01) return; g.save(); g.globalAlpha *= Math.min(1, k * 1.5); g.translate(x, y + (1 - k) * 18); pr.pill(g, 0, 0, str, o); g.restore(); };
// time a specific verified value is SPOKEN (from the Brain's reveal steps): visuals for a number never precede its narration
const valueTime = (ctx, display, fallback) => { for (const r of (ctx.sceneInfo && ctx.sceneInfo.reveal_steps) || []) { const v = ctx.valuesById && ctx.valuesById.get(r.entity_id); if (v && v.display === display) return eventTime(ctx.words, ctx.span, r.meaning_event_pattern, 0.5).t; } return fallback; };
const lastSentence = (s) => { const parts = String(s).match(/[^.!?]+[.!?]+/g); return (parts ? parts[parts.length - 1] : String(s)).trim(); };
const hostPoseFor = (intent, isCta) => (isCta ? 'react' : /hook/.test(intent) ? 'point' : /explanation/.test(intent) ? 'compare' : 'think');

// prop for a Brain icon concept (reuse-first: everything here is programmatic or already in the asset bank)
export function iconKind(concept) {
  const c = String(concept || '').toLowerCase();
  if (/hourglass|time|clock|calendar/.test(c)) return 'hourglass';
  if (/certificate|loss|down/.test(c)) return 'loss';
  if (/house|home|loan|mortgage/.test(c)) return 'house';
  if (/coin|dividend|gold/.test(c)) return 'coins';
  if (/tower|cash|bank|dollar|money|savings/.test(c)) return 'bills';
  return c ? 'bills' : null;
}

export const TEMPLATES = {
  // ── avatar_panel: presenter in the studio; a single supporting prop + caption; closing takeaway typography ───────────
  // Rich narrative treatment (production/narrative.mjs): environment by topic, value-encoded focal objects, recap on close.
  // The pre-1.3 generic host+window+tag composition was retired (it is the defect this revision corrects).
  avatar_panel(ctx) { return narrativeScene(ctx); },

  // ── money_flow: office desk; income -> destination with the amount arriving ────────────────────────────────────────
  money_flow(ctx) {
    const { L, p, span, words, poses } = ctx; const { W, H, base } = L; const ev = eventTime(words, span, ctx.pattern, 0.25).t; const short = L.short;
    const sx = short ? 210 : 560, jx = short ? 560 : 1010; const lender = /lender|bank/i.test(p.fromLabel || '');
    return {
      t0: span.start, t1: span.end, world: { w: W, h: H }, camera: [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2, y: H / 2 - 10, z: 1.06 }],
      draw(g, t) {
        st.officeSet(g, { w: W, h: H, t, deskY: base });
        if (!short) hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'point' }], x: L.hostX, bottom: L.hostBottom, scale: L.hostS, enter: tw(t, span.start, 0.8, ease.outBack) });
        pr.desk(g, { x0: -200, x1: W + 200, topY: base, bottom: H + 40 });
        const inn = tw(t, span.start + 0.3, 0.6, ease.outBack); g.save(); g.globalAlpha = inn; const sy = base + 6, jy = base + 14;
        if (lender) pr.house(g, sx, sy + 14, { w: short ? 260 : 300 }); else { shadowed(g, () => { rr(g, sx - 110, sy - 150, 220, 146, 12); g.fillStyle = '#fff'; g.fill(); }, { blur: 16, dy: 8 }); g.fillStyle = P.canvasDeep; g.fillRect(sx - 88, sy - 120, 120, 12); g.fillRect(sx - 88, sy - 90, 170, 10); g.fillRect(sx - 88, sy - 66, 140, 10); }
        pill(g, inn, sx, sy + 46, p.fromLabel || 'FROM', { size: 28, fill: P.goldDark });
        const level = 0.08 + 0.55 * tw(t, ev - 0.2, span.end - ev, ease.inOutCubic); pr.jar(g, jx, jy, { w: short ? 260 : 230, level });
        pill(g, inn, jx, jy + 46, p.toLabel || 'TO', { size: 28, fill: P.navy });
        for (let k = 0; k < 5; k++) { const q = ((t - ev - k * 0.36) % 1.7) / 1.7; if (t < ev || q < 0 || q > 1) continue; const x = lerp(sx + 60, jx, q), y = lerp(sy - 90, jy - 250, q) - Math.sin(q * Math.PI) * 140; g.save(); g.globalAlpha *= Math.sin(q * Math.PI); pr.bill(g, x, y, 110, 52, { rot: (q - 0.5) * 0.9 }); g.restore(); }
        g.restore();
        pop(g, tw(t, ev + 0.8, 0.5, ease.outBack), (sx + jx) / 2, base - (short ? 430 : 380), p.amountText || '', { size: short ? 78 : 78, pad: 30, pointer: 'none' });
      },
    };
  },

  // ── day_cards: a process window as milestones on a road; the value waits, then arrives ──────────────────────────────
  day_cards(ctx) {
    const { L, p, span, words, BN } = ctx; const { W, H } = L; const days = p.days || []; const short = L.short; const t0 = eventTime(words, span, ctx.pattern, 0.2).t;
    const RW = short ? 3000 : W; const BASE = short ? 1235 : 790; const n = Math.max(2, days.length);
    const xs = days.map((_, i) => (short ? 330 + i * ((RW - 700) / (n - 1)) : 260 + i * ((W - 520) / (n - 1))));
    const cam = short ? days.flatMap((d, i) => [{ t: lerp(t0, span.end - 0.5, i / (n - 1)) - 0.2, x: Math.max(540, Math.min(RW - 540, xs[i])), y: 1010, z: 1.12 }]) : [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2, y: H / 2, z: 1.03 }];
    if (short) cam.unshift({ t: span.start, x: 540, y: 1010, z: 1.12 });
    return {
      t0: span.start, t1: span.end, world: { w: RW, h: H }, camera: cam,
      draw(g, t) {
        p3.coverImage(g, BN.bg.roadWide, RW, H, { ax: 0.2, ay: 0.7 }); g.fillStyle = 'rgba(247,244,238,0.08)'; g.fillRect(0, 0, RW, H);
        p3.pathRibbon(g, 0, RW, BASE - 30, { h: 96, alpha: 0.88 });
        const prog = tw(t, t0, span.end - t0 - 0.6, ease.inOutCubic); const wx = lerp(xs[0], xs[xs.length - 1], prog);
        days.forEach((d, i) => { const at = lerp(t0, span.end - 0.6, i / (n - 1)); const k = tw(t, i === 0 ? span.start + 0.2 : at - 0.4, 0.5, ease.outBack); if (k < 0.01) return;
          p2.signboard(g, xs[i], BASE - 40, d.label, { h: short ? 380 : 330, size: 34, alpha: k });
          if (d.sub) pill(g, k, xs[i], BASE + 84, d.sub, { size: 24, fill: i === n - 1 ? P.green : P.navy }); });
        groundShadow(g, wx, BASE + 26, 300, 0.25); g.save(); const s = p3.sprite(g, BN.prop.wagon, wx, BASE + 26, short ? 320 : 300); const rim = BASE + 26 - s.h * 0.44; pr.pill(g, wx, rim - 40, 'ON ITS WAY', { size: 24, fill: P.inkSoft || P.navy }); g.restore();
        if (!short) { const a = tw(t, t0, 0.6, ease.outBack); if (a > 0.01) { g.save(); g.globalAlpha = a; shadowed(g, () => { rr(g, W / 2 - 300, 200, 600, 190, 26); g.fillStyle = 'rgba(255,255,255,0.94)'; g.fill(); }, { blur: 24, dy: 10 }); text(g, p.heroText || '', W / 2, 310, { kind: 'display', weight: 800, size: 96, color: P.ink, align: 'center' }); text(g, p.heroSub || '', W / 2, 362, { weight: 800, size: 30, color: P.goldDark, align: 'center', spacing: 2 }); g.restore(); } }
      },
      overlay(g, t) { if (!short) return; const a = tw(t, t0, 0.6, ease.outBack); if (a < 0.01) return; g.save(); g.globalAlpha = a; shadowed(g, () => { rr(g, 60, 210, 960, 200, 30); g.fillStyle = 'rgba(255,255,255,0.94)'; g.fill(); }, { blur: 24, dy: 10 }); text(g, p.heroText || '', 540, 330, { kind: 'display', weight: 800, size: 110, color: P.ink, align: 'center' }); text(g, p.heroSub || '', 540, 382, { weight: 800, size: 34, color: P.goldDark, align: 'center', spacing: 2 }); g.restore(); },
    };
  },

  // ── stock_chart: derived series on an easel (trajectory comparison, or a single change over a window) ────────────────
  stock_chart(ctx) {
    const { L, p, span, words, poses } = ctx; const { W, H, base } = L; const short = L.short; const series = p.series || []; const N = Math.max(...series.map((s) => s.points.length)) - 1; const yMax = p.yMax || Math.max(...series.flatMap((s) => s.points.filter((v) => v != null)), 1);
    const B = short ? { x: 50, y: 330, w: 980, h: 880 } : { x: 640, y: 70, w: 1150, h: 640 };
    const CH = short ? { x0: B.x + 150, x1: B.x + B.w - 60, y0: B.y + B.h - 100, y1: B.y + 200 } : { x0: B.x + 130, x1: B.x + B.w - 330, y0: B.y + B.h - 110, y1: B.y + 190 };
    const px = (i) => lerp(CH.x0, CH.x1, i / N), py = (v) => lerp(CH.y0, CH.y1, v / yMax);
    const ev = eventTime(words, span, ctx.pattern, 0.6).t; const tDraw0 = span.start + 0.9;
    // each line is drawn so that it COMPLETES when its final value is spoken; the value tag appears then
    const endsAt = []; series.forEach((sr, i) => { const prev = i ? endsAt[i - 1] : tDraw0; let e = valueTime(ctx, sr.finalValueText, null); if (e == null || e < prev + 1.2) e = Math.max(prev + 1.6, i === series.length - 1 ? ev + 0.8 : prev + 1.6); endsAt.push(Math.min(e, span.end - 0.6)); });
    const starts = series.map((_, i) => (i ? endsAt[i - 1] - 0.2 : tDraw0)); const per = Math.max(1.4, endsAt[0] - tDraw0);
    const ticks = p.yTicks || [];
    const finalNum = series.map((s) => moneyOf(s.finalValueText)); const gap = series.length === 2 && finalNum[0] != null && finalNum[1] != null ? Math.abs(finalNum[0] - finalNum[1]) : null; if (gap != null) ctx.derive(fmt$(gap), 'abs(final_a - final_b)');
    return {
      t0: span.start, t1: span.end, world: { w: W, h: H }, camera: [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2 + (short ? 0 : 30), y: H / 2 - (short ? 0 : 30), z: 1.06 }],
      draw(g, t) {
        pr.studioSet(g, { w: W, h: H, t, floor: L.floor, window: !short });
        if (!short) { g.strokeStyle = '#8F6B45'; g.lineWidth = 16; g.lineCap = 'round'; g.beginPath(); g.moveTo(B.x + 120, B.y + B.h); g.lineTo(B.x + 60, base); g.moveTo(B.x + B.w - 120, B.y + B.h); g.lineTo(B.x + B.w - 60, base); g.stroke(); }
        shadowed(g, () => { rr(g, B.x, B.y, B.w, B.h, 26); g.fillStyle = '#fff'; g.fill(); }, { blur: 40, dy: 16 });
        if (!short) { hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'point' }, { t: ev, pose: 'compare' }], x: 290, bottom: base + 60, scale: L.hostS * 0.92, enter: tw(t, span.start, 0.5) }); pr.desk(g, { x0: -200, x1: W + 200, topY: base, bottom: H + 40 }); }
        const inn = tw(t, span.start + 0.2, 0.6, ease.outCubic); g.save(); g.globalAlpha = inn;
        text(g, p.label || 'VALUE', B.x + 50, B.y + 78, { weight: 900, size: short ? 38 : 40, spacing: 2 }); if (p.subLabel) text(g, p.subLabel, B.x + 50, B.y + 122, { weight: 700, size: 28, color: P.inkMute });
        g.strokeStyle = 'rgba(26,39,68,0.10)'; g.lineWidth = 3; ticks.forEach((tk) => { const yy = lerp(CH.y0, CH.y1, tk.frac); g.beginPath(); g.moveTo(CH.x0, yy); g.lineTo(CH.x1, yy); g.stroke(); text(g, tk.text, CH.x0 - 14, yy + 9, { weight: 700, size: short ? 26 : 28, color: P.inkMute, align: 'right' }); });
        text(g, p.axisStartLabel || '', CH.x0, CH.y0 + 52, { weight: 700, size: 26, color: P.inkMute, align: 'center' }); text(g, p.axisEndLabel || '', CH.x1, CH.y0 + 52, { weight: 700, size: 26, color: P.inkMute, align: 'center' });
        const tips = series.map((s, si) => { const t0 = starts[si], pg = tw(t, t0, per - 0.1, ease.inOutCubic); const col = String(s.color).replace('0x', '#'); const first = s.points.findIndex((v) => v != null); const upto = first + pg * (s.points.length - 1 - first);
          if (first < 0) return null; g.strokeStyle = col; g.lineWidth = short ? 11 : 12; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(px(first), py(s.points[first])); let tip = { x: px(first), y: py(s.points[first]) };
          for (let i = first + 1; i < s.points.length; i++) { if (s.points[i] == null) continue; if (i > upto) { const f = upto - (i - 1); if (f > 0) { tip = { x: lerp(px(i - 1), px(i), f), y: lerp(py(s.points[i - 1]), py(s.points[i]), f) }; g.lineTo(tip.x, tip.y); } break; } tip = { x: px(i), y: py(s.points[i]) }; g.lineTo(tip.x, tip.y); }
          g.stroke(); if (pg > 0.01) { g.fillStyle = col; g.beginPath(); g.arc(tip.x, tip.y, 13, 0, 7); g.fill(); }
          return { tip, done: pg >= 0.999, col }; });
        if (p.markerIndex > 0 && series.length > 1) { const k = tw(t, starts[Math.min(1, series.length - 1)] - 0.2, 0.5, ease.outBack); if (k > 0.01) { g.save(); g.globalAlpha = k; g.strokeStyle = 'rgba(26,39,68,0.35)'; g.lineWidth = 4; g.beginPath(); g.moveTo(px(p.markerIndex), CH.y0); g.lineTo(px(p.markerIndex), CH.y1 + 40); g.stroke(); pr.pill(g, px(p.markerIndex), CH.y0 - 46, p.markerLabel || '', { size: 24, fill: P.navy }); g.restore(); } }
        series.forEach((s, si) => { const tp = tips[si]; if (!tp || !tp.done) return; const k = tw(t, starts[si] + per - 0.1, 0.45, ease.outBack); const right = short ? CH.x1 - 20 : CH.x1 + 165; pop(g, k, right, tp.tip.y + (si ? (short ? 120 : 84) : (short ? -90 : 0)), s.finalValueText, { size: short ? 44 : 44, sub: s.label, pad: 18, pointer: 'none' }); });
        if (gap != null && tips.every((tp) => tp && tp.done)) { const k = tw(t, starts[series.length - 1] + per + 0.1, 0.7, ease.outCubic); if (k > 0.01) { const xg = CH.x1 + (short ? 22 : 20), y0 = tips[0].tip.y, y1 = tips[1].tip.y, ye = y0 + (y1 - y0) * k; g.save(); g.strokeStyle = P.red; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(xg, y0); g.lineTo(xg, ye); g.moveTo(xg - 14, y0); g.lineTo(xg + 14, y0); g.moveTo(xg - 14, ye); g.lineTo(xg + 14, ye); g.stroke(); g.restore(); pop(g, tw(t, starts[series.length - 1] + per + 0.5, 0.45, ease.outBack), short ? CH.x0 + 260 : CH.x0 + 330, CH.y1 + 70, fmt$(gap), { size: short ? 52 : 54, sub: 'THE GAP', pad: 22, fill: P.redSoft, ink: P.red, pointer: 'none' }); } }
        if (p.changeText && series.length === 1) pop(g, tw(t, ev, 0.5, ease.outBack), CH.x0 + (CH.x1 - CH.x0) * 0.35, CH.y1 + 60, p.changeText, { size: short ? 84 : 84, pad: 28, pointer: 'none', fill: p.direction === 'down' ? P.redSoft : P.greenSoft, ink: p.direction === 'down' ? P.red : P.green });
        g.restore();
      },
    };
  },

  // ── share_compare: two outcomes as value-encoded stacks (bar) or the same money buying fewer units (chips) ────────────
  share_compare(ctx) {
    const { L, p, span, words, poses, BN } = ctx; const { W, H, base } = L; const short = L.short; const ev = eventTime(words, span, ctx.pattern, 0.5).t;
    if (p.displayMode === 'chips') return chipsScene(ctx, ev);
    const a = moneyOf(p.beforeValue), b = moneyOf(p.afterValue); const coins = /FINAL|VALUE|BALANCE/i.test(p.headerLabel || ''); const hi = Math.max(a, b); const targetH = short ? 600 : 520;
    const pxPerK = targetH / (hi / 1000); const xa = short ? 210 : 520, xb = short ? 560 : 1000; const y = base + 14;
    const unitK = Math.max(1, Math.ceil(hi / 1000 / 60)); // one bill = $unitK thousand (coin = 2x), so the stack stays legible at any scale
    const stack = (g, x, v, k) => { const n = Math.max(0.01, (v / 1000 / unitK) * k); if (coins) pr.coinStack(g, x, y, { n: n / 2, w: 200, th: pxPerK * unitK * 2 }); else pr.billStack(g, x, y, { n, w: 230, th: pxPerK * unitK }); return y - (v / 1000) * pxPerK * k; };
    const gap = Math.abs(a - b); const dTxt = p.deltaTextOverride || fmt$(gap);
    return {
      t0: span.start, t1: span.end, world: { w: W, h: H }, camera: [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2, y: H / 2, z: 1.05 }],
      draw(g, t) {
        st.citySet(g, { w: W, h: H, deskY: base }); pr.desk(g, { x0: -200, x1: W + 200, topY: base, bottom: H + 40 });
        groundShadow(g, xa, y, 300, 0.24); groundShadow(g, xb, y, 300, 0.24);
        const tA = valueTime(ctx, p.beforeValue, span.start + 1.5), tB = valueTime(ctx, p.afterValue, span.start + 2.5); // each stack rises as its value is spoken
        const ka = tw(t, tA - 1.2, 1.3, ease.outCubic), kb = tw(t, tB - 1.2, 1.3, ease.outCubic);
        const prin = moneyOf(p.anchorText); // the starting amount (from the verified scenario line) is the first thing on the ledger; it gives way to the two outcomes as they are spoken
        if (prin && prin < Math.min(a, b)) { const kp = tw(t, span.start + 0.3, 0.6, ease.outBack) * (1 - tw(t, Math.min(tA, tB) - 0.6, 0.6, ease.inCubic)); if (kp > 0.01) { g.save(); g.globalAlpha = Math.min(1, kp * 1.3); const cx = (xa + xb) / 2; groundShadow(g, cx, y, 260, 0.24); const r0 = pr.billStack(g, cx, y, { n: Math.max(0.01, prin / 1000 / unitK), w: 230, th: pxPerK * unitK, ground: false }); pop(g, kp, cx, r0.top - 44, fmt$(prin), { size: short ? 52 : 52, sub: 'YOU START WITH', pad: 22, pointer: 'down', W }); g.restore(); } }
        const ta = stack(g, xa, a, ka), tb = stack(g, xb, b, kb);
        pop(g, tw(t, tA + 0.1, 0.5, ease.outBack), xa, ta - 46, p.beforeValue, { size: short ? 50 : 52, sub: p.beforeLabel, pad: 20, pointer: 'down', W }); pop(g, tw(t, tB + 0.1, 0.5, ease.outBack), xb, tb - 46, p.afterValue, { size: short ? 50 : 52, sub: p.afterLabel, pad: 20, pointer: 'down', W });
        const kg = tw(t, ev, 0.7, ease.outCubic); if (kg > 0.01) { const lo = Math.min(ta, tb), hiY = Math.max(ta, tb); g.save(); g.globalAlpha = kg; g.setLineDash([12, 9]); g.strokeStyle = P.red; g.lineWidth = 4; g.beginPath(); g.moveTo(Math.min(xa, xb), lo); g.lineTo(Math.max(xa, xb) + 130, lo); g.stroke(); g.setLineDash([]); g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(Math.max(xa, xb) + 130, lo); g.lineTo(Math.max(xa, xb) + 130, lo + (hiY - lo) * kg); g.stroke(); g.restore(); pop(g, tw(t, ev + 0.3, 0.5, ease.outBack), short ? (xa + xb) / 2 : xb + 300, short ? lo - 150 : lo + 40, dTxt, { size: short ? 64 : 60, sub: p.deltaTone === 'negative' ? 'THE DIFFERENCE' : 'THE DIFFERENCE', pad: 24, fill: p.deltaTone === 'negative' ? P.redSoft : P.greenSoft, ink: p.deltaTone === 'negative' ? P.red : P.green, pointer: 'none' }); }
        if (p.anchorText) { const k = tw(t, span.start + 0.2, 0.5, ease.outBack); pill(g, k, W / 2, short ? 250 : 72, p.anchorText, { size: short ? 30 : 30, fill: P.navy, pad: 26 }); }
        hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'compare' }, { t: ev, pose: 'point' }], x: short ? 950 : L.hostX, bottom: L.hostBottom, scale: short ? L.hostS * 0.7 : L.hostS });
      },
    };
  },

  // ── calc_card fallback: evidence desk — the stated values as physical tags on a bill stack ───────────────────────────
  calc_card(ctx) {
    const { L, p, span, words, poses } = ctx; const { W, H, base } = L; const ev = eventTime(words, span, ctx.pattern, 0.3).t; const vals = (p.values || []).slice(0, 3); const m0 = moneyOf(vals[0]);
    return {
      t0: span.start, t1: span.end, world: { w: W, h: H }, camera: [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2, y: H / 2 - 10, z: 1.05 }],
      draw(g, t) {
        pr.studioSet(g, { w: W, h: H, t, floor: L.floor, window: !L.short }); hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'point' }], x: L.hostX, bottom: L.hostBottom, scale: L.hostS, enter: tw(t, span.start, 0.8, ease.outBack) }); pr.desk(g, { x0: -300, x1: W + 300, topY: base, bottom: H + 40 });
        const k = tw(t, ev - 0.3, 1.2, ease.outCubic); const x = L.short ? 245 : 380; const px = L.short ? 6 : 5; let topY = base + 18;
        if (m0) { const r = pr.billStack(g, x, base + 18, { n: Math.max(0.01, Math.min(60, (m0 / 1000)) * k), w: 240, th: px, ground: true }); topY = r.top; }
        vals.forEach((v, i) => pop(g, tw(t, ev + i * 0.5, 0.5, ease.outBack), x + (i ? (L.short ? 60 : 200) : 0), topY - 46 - i * (L.short ? 110 : 96), v, { size: L.short ? 40 : 46, pad: 20, pointer: i ? 'none' : 'down', W }));
        if (p.title) pill(g, tw(t, span.start + 0.2, 0.5, ease.outBack), L.short ? 300 : 500, L.short ? 300 : 150, p.title, { size: 28, fill: P.navy, pad: 24 });
      },
    };
  },
};

function chipsScene(ctx, ev) {
  const { L, p, span, poses, BN } = ctx; const { W, H, base } = L; const short = L.short; const before = Number(p.beforeCount), after = Number(p.afterCount); const f = before ? after / before : 1; const y = base + 40;
  return {
    t0: span.start, t1: span.end, world: { w: W, h: H }, camera: [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2, y: H / 2 - 10, z: 1.06 }],
    draw(g, t) {
      p3.coverImage(g, short ? BN.bg.kitchenTall : BN.bg.kitchenWide, W, H, { ay: short ? 0.2 : 0.3 }); g.fillStyle = lin(g, 0, y - 60, 0, H, [[0, '#D9B98C'], [1, '#B58F63']]); g.fillRect(0, y - 60, W, H); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(0, y - 60, W, 6);
      const bw = short ? 330 : 300, xa = short ? 280 : 620, xb = short ? 700 : 1080; const ha = bw * BN.prop.bag.h / BN.prop.bag.w; const k = tw(t, span.start + 0.3, 0.7, ease.outBack);
      g.save(); g.globalAlpha = Math.min(1, k * 1.3); p3.sprite(g, BN.prop.bag, xa, y, bw); g.restore(); pop(g, tw(t, valueTime(ctx, p.beforeValue, span.start + 0.8) + 0.1, 0.5, ease.outBack), xa, y - ha - 50, p.beforeValue, { size: short ? 52 : 50, sub: p.beforeLabel, pad: 20, pointer: 'down' });
      const sh = tw(t, ev, 1.0, ease.inOutCubic); const s2 = lerp(1, f, sh) * bw; g.save(); g.globalAlpha = 0.6; g.setLineDash([14, 10]); g.strokeStyle = P.red; g.lineWidth = 5; rr(g, xb - bw / 2 - 8, y - ha - 8, bw + 16, ha + 8, 14); g.stroke(); g.restore(); p3.sprite(g, BN.prop.bag, xb, y, Math.max(40, s2));
      const av = tw(t, valueTime(ctx, p.afterValue, ev + 0.6) + 0.1, 0.5, ease.outBack); pop(g, av, xb, y - ha - 50, p.afterValue, { size: short ? 52 : 50, sub: p.afterLabel, pad: 20, pointer: 'down' });
      if (p.anchorText) pill(g, tw(t, span.start + 0.2, 0.5, ease.outBack), W / 2, short ? 300 : 140, p.anchorText, { size: 32, fill: P.navy, pad: 28 });
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'compare' }], x: short ? 940 : L.hostX, bottom: L.hostBottom + (short ? 60 : 0), scale: short ? L.hostS * 0.66 : L.hostS });
      st.counterFront(g, { w: W, y: y + 30, h: H + 40 });
    },
  };
}
