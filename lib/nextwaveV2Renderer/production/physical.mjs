// NextWave V2 production — PHYSICAL EVIDENCE STORYTELLING for Brain `stock_chart` scenes (replaces the white chart card as the primary experience).
// The Brain still says "two series over time"; THIS module decides how to express that verified relationship physically.
//
// TAXONOMY + SELECTION (selectPhysical; deterministic, from the storyboard only):
//   two series WITH a verified delay marker (markerIndex > 0)          -> RACE      time/delay/compounding: one road, two wagons; a wagon's heap of coins is its balance;
//                                                                         the delayed wagon waits behind a closed gate for the verified delay, then travels.
//                                                                         Long: wagons travel along a wide road, camera follows. Short: native vertical: two wagons side by side,
//                                                                         heaps rise, no travel (a portrait frame has no room for a journey).
//   two series, no delay (rates / fees / returns)                      -> ORCHARD   accumulation: two trees whose height is the balance, on the office desk (money that grows);
//                                                                         same layout family, scaled per format.
//   anything else (one series, 3+ series, unparsable finals)            -> null      falls back to the compact chart card (documented limit).
// Repetition control: environment is the topic's (road for time, office for investing), the metaphor follows the relationship (journey vs growth),
// the subject prop follows the number roles (recurring amount -> jar, principal -> bill stack), and format changes the composition, so different
// scripts land on different combinations; one physical family never serves every chart.
// VALUE INTEGRITY: heap height = balance x ONE scale shared by both subjects (px per $). Tree height = balance x one shared scale (canopy top at 1.11 x h,
// so height stays exactly linear in value; canopy width is normalised and NOT value-encoded). No year numbers are invented: progress is a filled ribbon
// between the storyboard's own axis labels; all printed figures are the storyboard's display strings.
import { P, tw, ease, lerp, text, rr, shadowed, groundShadow } from '../core.mjs';
import * as pr from '../props.mjs';
import * as p2 from '../props2.mjs';
import * as p3 from '../props3.mjs';
import { eventTime } from './timing.mjs';
import { topicOf } from './narrative.mjs';

const moneyOf = (s) => { const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(String(s || '')); return m ? Number(m[1].replace(/,/g, '')) : null; };
const fmt$ = (v) => '$' + Math.round(v).toLocaleString('en-US');
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const valueTime = (ctx, display, fb) => { for (const r of (ctx.sceneInfo.reveal_steps || [])) { const v = ctx.valuesById.get(r.entity_id); if (v && v.display === display) return eventTime(ctx.words, ctx.span, r.meaning_event_pattern, 0.5).t; } return fb; };

export function selectPhysical(ctx) {
  const p = ctx.p || {}; const s = p.series || [];
  if (s.length !== 2) return null; const fin = s.map((x) => moneyOf(x.finalValueText)); if (fin.some((v) => v == null || v <= 0)) return null;
  if (s.some((x) => !Array.isArray(x.points) || x.points.length < 3)) return null;
  if (p.markerIndex > 0) return { kind: 'race', reason: 'two series with a verified delay marker: time/delay journey' };
  return { kind: 'orchard', reason: 'two series without delay: parallel accumulation' };
}

function subjectOf(ctx) {
  const vs = (ctx.sceneInfo.entity_ids || []).map((id) => ctx.valuesById.get(id)).filter(Boolean);
  const rec = vs.find((v) => v.role === 'recurring_amount'); const pri = vs.find((v) => v.role === 'principal');
  if (rec) return { kind: 'jar', tag: rec.display, sub: `EVERY ${String(rec.cadence || 'month').toUpperCase()}` };
  if (pri) return { kind: 'stack', value: pri.value, tag: pri.display, sub: 'YOU START WITH' };
  return { kind: null };
}

export function physicalScene(ctx, sel) {
  const { L, p, span, words, poses, BN } = ctx; const { W, H } = L; const short = L.short; const series = p.series; const N = Math.max(...series.map((s) => s.points.length)) - 1;
  const fin = series.map((s) => moneyOf(s.finalValueText)); const maxV = Math.max(...fin); const gapV = Math.abs(fin[0] - fin[1]); ctx.derive(fmt$(gapV), 'abs(final_a - final_b)');
  const ev = eventTime(words, span, ctx.pattern, 0.6).t; const dur0 = span.end - span.start; const tDraw0 = span.start + Math.min(5.0, Math.max(2.4, 0.18 * dur0));
  const endsAt = []; series.forEach((sr, i) => { const prev = i ? endsAt[i - 1] : tDraw0; let e = valueTime(ctx, sr.finalValueText, null); if (e == null || e < prev + 2.0) e = Math.max(prev + 3.0, i === series.length - 1 ? ev + 0.8 : prev + 3.0); endsAt.push(Math.min(e, span.end - 0.9)); });
  const starts = series.map((_, i) => (i ? endsAt[i - 1] + 0.2 : tDraw0)); const tGap = endsAt[1] + 0.1;
  const first = series.map((s) => Math.max(0, s.points.findIndex((v) => v != null)));
  const valAt = (i, yr) => { const pts = series[i].points; const a = Math.floor(yr), b = Math.min(N, a + 1); const va = pts[Math.min(a, pts.length - 1)] ?? 0, vb = pts[Math.min(b, pts.length - 1)] ?? va; return lerp(va, vb, yr - a); };
  const st = (i, t) => { const pg = tw(t, starts[i], Math.max(1.0, endsAt[i] - starts[i]), ease.inOutCubic); const yr = pg * N; const f = first[i]; return { pg, yr, val: Math.min(fin[i], Math.max(0, valAt(i, yr))), u: clamp01((yr - f) / Math.max(1, N - f)), waiting: yr < f && pg > 0, started: t >= starts[i] }; };
  const subj = subjectOf(ctx); const topic = topicOf(ctx.sceneInfo.narration.text); const isRace = sel.kind === 'race';
  const names = series.map((s) => s.label || ''); const cols = [P.goldDark, P.navy];
  // ── geometry (one scale shared by both subjects) ──
  const G = short
    ? { yb: 1100, wagW: 400, hmax: 470, xs: [290, 790], world: W }
    : isRace ? { yb: 770, wagW: 380, hmax: 255, world: 2400, x0: 480, park: [1500, 1900], line: 1400 } : { yb: 790, hmax: 520, xs: [620, 1080], world: W };
  const per = G.hmax / maxV; // px per $ — the ONE scale
  const WW = G.wagW; const wagH = WW * (BN.prop.wagon.h / BN.prop.wagon.w);
  const xOf = (i, u) => (short ? G.xs[i] : isRace ? lerp(G.x0, G.park[i], u) : G.xs[i]);
  // camera choreography follows the argument
  const camKeys = [];
  if (short) { const topY = (i) => G.yb + 26 - wagH * 0.44 - fin[i] * per; camKeys.push({ t: span.start, x: W / 2, y: 980, z: 1.0 }, { t: starts[0], x: G.xs[0] + 90, y: 900, z: 1.1 }, { t: endsAt[0], x: G.xs[0] + 120, y: 800, z: 1.12 }, { t: starts[1], x: G.xs[1] - 60, y: 900, z: 1.1 }, { t: endsAt[1], x: G.xs[1] - 100, y: 800, z: 1.12 }, { t: tGap + 0.3, x: W / 2, y: (topY(0) + topY(1)) / 2 + 200, z: 1.2 }, { t: Math.max(tGap + 2.4, span.end - 0.7), x: W / 2, y: 960, z: 1.04 }); }
  else if (isRace) { const c = (x) => Math.max(960, Math.min(G.world - 960, x)); camKeys.push({ t: span.start, x: c(1000), y: 540, z: 1.0 }, { t: starts[0] - 0.3, x: c(960), y: 540, z: 1.08 }, { t: starts[0] + (endsAt[0] - starts[0]) * 0.5, x: c(lerp(G.x0, G.park[0], 0.5) + 260), y: 540, z: 1.1 }, { t: endsAt[0], x: c(G.park[0] - 40), y: 500, z: 1.12 }, { t: starts[1] - 0.2, x: c(960), y: 540, z: 1.08 }, { t: starts[1] + (endsAt[1] - starts[1]) * 0.55, x: c(lerp(G.x0, G.park[1], 0.6) + 200), y: 540, z: 1.1 }, { t: endsAt[1], x: c(G.park[1] - 200), y: 500, z: 1.1 }, { t: tGap + 0.4, x: c(1650), y: 470, z: 1.32 }, { t: Math.max(tGap + 2.8, span.end - 0.7), x: c(1500), y: 540, z: 1.0 }); }
  else camKeys.push({ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: starts[0], x: 800, y: 500, z: 1.1 }, { t: endsAt[0], x: 760, y: 470, z: 1.14 }, { t: starts[1], x: 900, y: 500, z: 1.1 }, { t: endsAt[1], x: 950, y: 470, z: 1.14 }, { t: tGap + 0.4, x: 800, y: 430, z: 1.26 }, { t: Math.max(tGap + 2.6, span.end - 0.7), x: W / 2, y: H / 2, z: 1.03 });
  const camera = camKeys.filter((k, i, a) => !i || k.t > a[i - 1].t + 0.05);
  const popTag = (g, k, x, y, str, o) => { if (k <= 0.01) return; g.save(); g.translate(x, y); g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k); pr.tag(g, 0, 0, str, { ...o, alpha: Math.min(1, k * 1.4) }); g.restore(); };
  const wagon = (g, x, base, hpx, t, drop) => { const s = p3.sprite(g, BN.prop.wagon, x, base + 26, WW); const rim = base + 26 - s.h * 0.44; p3.coinHeap(g, x + 8, rim + 4, WW * 0.66, hpx, 5); g.save(); g.beginPath(); g.rect(x - WW / 2 - 5, rim + 8, WW + 10, s.h); g.clip(); p3.sprite(g, BN.prop.wagon, x, base + 26, WW); g.restore();
    if (drop && hpx > 4) { const q = (t * 1.5) % 1; g.save(); g.globalAlpha = Math.sin(q * Math.PI); pr.bill(g, x + 10, rim - hpx - 150 + q * 130, 80, 38, { rot: 0.3 }); g.restore(); } return { rim, top: rim - hpx }; };
  const gapMarks = (g, t, topA, topB, xa, xb, side) => { const bx = Math.max(xa, xb) + side; const k = tw(t, tGap, 0.8, ease.outCubic); if (k < 0.01) return; const hi = Math.min(topA, topB), lo = Math.max(topA, topB); g.save(); g.globalAlpha = Math.min(1, k * 1.3); g.setLineDash([12, 9]); g.strokeStyle = P.red; g.lineWidth = 5; g.beginPath(); g.moveTo(Math.min(xa, xb) - 30, hi); g.lineTo(Math.max(xa, xb) + side, hi); g.stroke(); g.setLineDash([]); g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(bx, hi); g.lineTo(bx, hi + (lo - hi) * k); g.moveTo(bx - 16, hi); g.lineTo(bx + 16, hi); g.stroke(); g.restore();
    popTag(g, tw(t, tGap + 0.35, 0.5, ease.outBack), short ? (xa + xb) / 2 : bx + 20, short ? hi - 150 : (hi + lo) / 2 + 20, fmt$(gapV), { size: short ? 64 : 58, sub: 'THE GAP', pad: 24, pointer: 'none', fill: P.redSoft, ink: P.red }); };
  // supporting evidence (screen space): progress ribbon between the storyboard's own axis labels — no invented numbers
  const overlay = (g, t) => { const a0 = st(0, t), a1 = st(1, t); const act = t >= starts[1] ? 1 : 0; const s = st(act, t); const inn = tw(t, tDraw0 - 0.4, 0.6, ease.outCubic) * (1 - tw(t, endsAt[1] - 0.2, 0.5, ease.inCubic)); if (inn < 0.01) return;
    const w = short ? 860 : 760, x0 = (W - w) / 2, y = short ? 262 : 138; g.save(); g.globalAlpha = inn; shadowed(g, () => { rr(g, x0 - 30, y - 46, w + 60, short ? 150 : 112, 24); g.fillStyle = 'rgba(255,255,255,0.93)'; g.fill(); }, { blur: 20, dy: 8 });
    g.strokeStyle = P.canvasDeep; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke(); g.strokeStyle = cols[act]; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w * (s.pg), y); g.stroke();
    if (p.markerIndex > 0 && act === 1) { const mx = x0 + w * (p.markerIndex / N); g.fillStyle = P.red; g.beginPath(); g.arc(mx, y, 13, 0, 7); g.fill(); }
    if (short && p.subLabel) text(g, p.subLabel, x0 + w / 2, y + 96, { weight: 800, size: 26, color: P.ink, align: 'center', spacing: 1 });
    text(g, p.axisStartLabel || '', x0, y + 44, { weight: 800, size: 24, color: P.inkMute }); text(g, p.axisEndLabel || '', x0 + w, y + 44, { weight: 800, size: 24, color: P.ink, align: 'right' });
    if (p.markerIndex > 0 && act === 1 && p.markerLabel) text(g, p.markerLabel, x0 + w * (p.markerIndex / N), y - 20, { weight: 800, size: 22, color: P.red, align: 'center' });
    g.restore(); };
  const subjectDraw = (g, t, x, y, sc) => { if (!subj.kind) return; const k = tw(t, span.start + 0.3, 0.7, ease.outBack); if (k < 0.01) return; g.save(); g.globalAlpha = Math.min(1, k * 1.3); g.translate(x, y); g.scale(sc, sc); g.translate(-x, -y);
    if (subj.kind === 'jar') { groundShadow(g, x, y, 300, 0.22); pr.jar(g, x, y, { w: 320, level: 0.2 + 0.5 * tw(t, tDraw0, endsAt[0] - tDraw0, ease.inOutCubic), ground: false }); } else { groundShadow(g, x, y, 300, 0.22); pr.billStack(g, x, y, { n: 30, w: 240, th: 12, ground: false }); }
    g.restore(); const ty = y - (subj.kind === 'jar' ? 380 : 400) * sc - 20; popTag(g, tw(t, span.start + 0.8, 0.5, ease.outBack), x, ty, subj.tag, { size: 52, sub: subj.sub, pad: 22, pointer: 'down' }); };

  // ─────────────── RACE ───────────────
  if (isRace && !short) return {
    t0: span.start, t1: span.end, world: { w: G.world, h: H }, camera, overlay, meta: { kit: 'physical_race', env: 'road' },
    draw(g, t) {
      p3.coverImage(g, BN.bg.roadWide, G.world, H, { ay: 0.7 }); g.fillStyle = 'rgba(247,244,238,0.08)'; g.fillRect(0, 0, G.world, H); p3.pathRibbon(g, 0, G.world, G.yb - 44, { h: 96, alpha: 0.92 });
      subjectDraw(g, t, 150, G.yb + 30, 0.85 * (1 - 0.3 * tw(t, tDraw0, 1.0)));
      // finish banner: both journeys end at the SAME finish year
      p3.flagPole(g, G.line, G.yb + 44, 320, { color: P.green, wave: t * 4, size: 90 }); pr.pill(g, G.line + 60, G.yb - 290, p.axisEndLabel || 'FINISH', { size: 26, fill: P.green });
      const tops = [];
      series.forEach((sr, i) => { const s = st(i, t); const x = xOf(i, s.started ? s.u : 0); const hpx = s.val * per; const base = G.yb;
        if (i === 1 || s.started) { groundShadow(g, x, base + 22, 300, 0.25); }
        if (i === 0 && !s.started && t < starts[0] - 0.6) { /* wagon A waits at the start while the subject is introduced */ }
        const alpha = i === 0 ? tw(t, span.start + 0.8, 0.6, ease.outBack) : tw(t, starts[1] - 1.4, 0.7, ease.outBack); if (alpha < 0.01) { tops.push(null); return; }
        g.save(); g.globalAlpha = Math.min(1, alpha * 1.3); const w = wagon(g, x, base, hpx, t, s.started && s.pg < 0.999 && !s.waiting); g.restore(); tops.push({ x, top: w.top });
        pr.pill(g, x, base + 74, names[i], { size: 24, fill: cols[i] });
        if (i === 1) { const gopen = tw(t, starts[1] + (endsAt[1] - starts[1]) * (first[1] / N) * 0.9, 0.9, ease.inOutCubic); if (alpha > 0.5) { p3.gate(g, G.x0 + 210, base + 40, { open: gopen }); const wt = (s.waiting ? 1 : 0); if (wt > 0.01) { pr.hourglass(g, G.x0 + 400, base + 30, { h: 130, sand: 1 - s.yr / Math.max(1, first[1]) }); pr.pill(g, G.x0 + 400, base - 140, p.markerLabel || 'WAITING', { size: 24, fill: P.red }); } } }
        popTag(g, tw(t, endsAt[i], 0.5, ease.outBack), x, w.top - 52, sr.finalValueText, { size: 46, sub: names[i], pad: 20, pointer: 'down' }); });
      if (tops[0] && tops[1]) gapMarks(g, t, tops[0].top, tops[1].top, tops[0].x, tops[1].x, 150);
    },
  };
  // ─────────────── PAIRED WAGONS (native vertical) ───────────────
  if (isRace && short) return {
    t0: span.start, t1: span.end, world: { w: W, h: H }, camera, overlay, meta: { kit: 'physical_paired', env: 'road' },
    draw(g, t) {
      p3.coverImage(g, BN.bg.roadWide, W, H, { ay: 0.7 }); g.fillStyle = 'rgba(247,244,238,0.08)'; g.fillRect(0, 0, W, H); p3.pathRibbon(g, 0, W, G.yb - 44, { h: 96, alpha: 0.92 });
      const tops = []; const st0 = st(0, t), st1 = st(1, t);
      series.forEach((sr, i) => { const s = i ? st1 : st0; const alpha = tw(t, span.start + 0.4 + i * 0.3, 0.6, ease.outBack); groundShadow(g, G.xs[i], G.yb + 22, 340, 0.25); g.save(); g.globalAlpha = Math.min(1, alpha * 1.3); const w = wagon(g, G.xs[i], G.yb, s.val * per, t, s.started && s.pg < 0.999 && !s.waiting); g.restore(); tops.push({ x: G.xs[i], top: w.top }); pr.pill(g, G.xs[i], G.yb + 76, names[i], { size: 22, fill: cols[i] });
        if (i === 1) { const gopen = tw(t, starts[1] + (endsAt[1] - starts[1]) * (first[1] / N) * 0.9, 0.9, ease.inOutCubic); p3.gate(g, G.xs[1] - 250, G.yb + 40, { open: gopen, h: 150, w: 150 }); if (s.waiting) { pr.hourglass(g, G.xs[1] + 260, G.yb + 30, { h: 120, sand: 1 - s.yr / Math.max(1, first[1]) }); } }
        popTag(g, tw(t, endsAt[i], 0.5, ease.outBack), G.xs[i], w.top - 56, sr.finalValueText, { size: 54, sub: names[i], pad: 22, pointer: 'down' }); });
      gapMarks(g, t, tops[0].top, tops[1].top, G.xs[0], G.xs[1], 250);
    },
  };
  // ─────────────── ORCHARD (both formats) ───────────────
  const xs = G.xs; const yb = G.yb;
  return {
    t0: span.start, t1: span.end, world: { w: W, h: H }, camera, overlay, meta: { kit: 'physical_orchard', env: 'office' },
    draw(g, t) {
      const { W: w0, H: h0 } = { W, H }; import_office(g, w0, h0, t, yb); const tops = [];
      series.forEach((sr, i) => { const s = st(i, t); const alpha = tw(t, span.start + 0.4 + i * 0.3, 0.6, ease.outBack); const hTree = (s.val * per) / 1.11; groundShadow(g, xs[i], yb + 6, 260, 0.24); g.save(); g.globalAlpha = Math.min(1, alpha * 1.3);
        const r = p2.tree(g, xs[i], yb + 6, { h: Math.max(20, hTree), grow: 1, coins: Math.round(9 * (s.val / fin[i])), ground: false }); g.restore(); tops.push({ x: xs[i], top: yb + 6 - hTree * 1.11 });
        popTag(g, tw(t, endsAt[i], 0.5, ease.outBack), xs[i], yb + 6 - hTree * 1.11 - (short ? 70 : 54), sr.finalValueText, { size: short ? 54 : 46, sub: names[i], pad: 20, pointer: 'down' }); });
      if (!short) subjectDraw(g, t, 250, yb + 10, 0.7);
      gapMarks(g, t, tops[0].top, tops[1].top, xs[0], xs[1], short ? 250 : 200);
      if (!short) hostSupport(g, t, ctx, poses, L, span, tGap);
    },
  };
}
import * as st_ from '../sets.mjs';
import { hostLayer } from '../scenes.mjs';
function import_office(g, W, H, t, yb) { st_.officeSet(g, { w: W, h: H, t, deskY: yb - 14 }); pr.desk(g, { x0: -200, x1: W + 200, topY: yb - 14, bottom: H + 40 }); }
function hostSupport(g, t, ctx, poses, L, span, tGap) { hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'compare' }, { t: tGap - 0.2, pose: 'point' }], x: 1650, bottom: L.hostBottom, scale: L.hostS * 0.85, enter: tw(t, span.start, 0.6) }); pr.desk(g, { x0: 1350, x1: L.W + 200, topY: L.base, bottom: L.H + 40 }); }
