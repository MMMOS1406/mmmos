// NextWave V2 production — object/concept-first thumbnails derived from the VERIFIED storyboard.
// The strongest concept of the video (a gap between two verified outcomes, the same money buying fewer units, or one
// verified figure) becomes the picture; every string is programmatic (package title + storyboard values).
import { makeCanvas, P, text, rr, lin, drawMoney, wrap, measure } from '../core.mjs';
import * as pr from '../props.mjs';
import * as p3 from '../props3.mjs';

const moneyOf = (s) => { const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(String(s || '')); return m ? Number(m[1].replace(/,/g, '')) : null; };
const fmt$ = (v) => '$' + Math.round(v).toLocaleString('en-US');

export function thumbData(storyboard) {
  const scenes = storyboard.scenes || [];
  const chart = scenes.find((s) => s.renderer_params && s.renderer_params.treatment === 'stock_chart' && (s.renderer_params.series || []).length === 2);
  if (chart) { const q = chart.renderer_params.series; const a = moneyOf(q[0].finalValueText), b = moneyOf(q[1].finalValueText); if (a != null && b != null) return { kind: 'compare', a: { label: q[0].label, value: a }, b: { label: q[1].label, value: b }, gap: Math.abs(a - b), gapText: fmt$(Math.abs(a - b)), anchor: chart.renderer_params.subLabel || '' }; }
  const bar = scenes.find((s) => s.renderer_params && s.renderer_params.treatment === 'share_compare' && s.renderer_params.displayMode === 'bar');
  if (bar) { const p = bar.renderer_params; const a = moneyOf(p.beforeValue), b = moneyOf(p.afterValue); if (a != null && b != null) return { kind: 'compare', a: { label: p.beforeLabel, value: a }, b: { label: p.afterLabel, value: b }, gap: Math.abs(a - b), gapText: p.deltaTextOverride || fmt$(Math.abs(a - b)), anchor: p.anchorText || '' }; }
  const chips = scenes.find((s) => s.renderer_params && s.renderer_params.displayMode === 'chips');
  if (chips) { const p = chips.renderer_params; return { kind: 'chips', beforeText: p.beforeValue, afterText: p.afterValue, before: Number(p.beforeCount), after: Number(p.afterCount), anchor: p.anchorText || '' }; }
  const v = (storyboard.values || []).find((x) => x.kind === 'money'); if (v) return { kind: 'single', value: v.value, valueText: v.display, label: v.label || '' };
  return null;
}

export function renderThumbnail({ storyboard, format, title, bench }) {
  const D = thumbData(storyboard); if (!D) throw new Error('thumbnail: no verified concept found in storyboard');
  const short = format === 'short'; const W = short ? 1080 : 1280, H = short ? 1920 : 720; const { c, g } = makeCanvas(W, H); const head = String(title || '').toUpperCase();
  if (short) return shortThumb({ g, c, D, head, bench, W, H });
  return longThumb({ g, c, D, head, bench, W, H });
}

function heap(g, bench, x, y, val, top, w, name, col) { // wagon + value-encoded gold heap (height = value / top)
  const s = p3.sprite(g, bench.prop.wagon, x, y + 22, w); const rim = y + 22 - s.h * 0.44; p3.coinHeap(g, x + 8, rim + 4, w * 0.66, (val / top) * (w * 0.63), 5);
  g.save(); g.beginPath(); g.rect(x - w * 0.55, rim + 8, w * 1.1, s.h); g.clip(); p3.sprite(g, bench.prop.wagon, x, y + 22, w); g.restore(); if (name) pr.pill(g, x, y + 68, name, { size: 24, fill: col });
}

function longThumb({ g, c, D, head, bench, W, H }) {
  p3.coverImage(g, D.kind === 'chips' ? bench.bg.kitchenWide : bench.bg.roadWide, W, H, { ay: 0.65 }); g.fillStyle = lin(g, 0, 0, W, 0, [[0, 'rgba(251,248,241,0.96)'], [0.55, 'rgba(251,248,241,0.88)'], [1, 'rgba(251,248,241,0)']]); g.fillRect(0, 0, W, H);
  const lines = wrap(g, head, 620, { weight: 900, size: 40, spacing: 2 }).slice(0, 2); lines.forEach((ln, i) => text(g, ln, 70, 140 + i * 50, { weight: 900, size: 40, color: P.inkMute, spacing: 2 }));
  const big = D.kind === 'compare' ? D.gapText : D.kind === 'chips' ? D.afterText : D.valueText; const startY = 140 + lines.length * 50 + 150;
  let size = 170; while (size > 70 && measure(g, big, { weight: 800, size }) > 640) size -= 8; drawMoney(g, big, 62, startY, { size, color: D.kind === 'chips' ? P.ink : P.red });
  const sub = D.kind === 'compare' ? [D.a.label, `vs ${D.b.label}`] : D.kind === 'chips' ? [D.beforeText, D.anchor] : [D.label || '']; sub.filter(Boolean).slice(0, 2).forEach((ln, i) => text(g, ln, 70, startY + 76 + i * 62, { kind: 'display', weight: 700, size: 46, color: P.ink }));
  if (D.kind === 'compare') { const top = Math.max(D.a.value, D.b.value); heap(g, bench, 1040, 340, D.a.value, top * 1.15, 270, D.a.label, P.goldDark); heap(g, bench, 1040, 610, D.b.value, top * 1.15, 270, D.b.label, P.navy); }
  else if (D.kind === 'chips') { const f = D.before ? D.after / D.before : 1; p3.sprite(g, bench.prop.bag, 930, 600, 230); p3.sprite(g, bench.prop.bag, 1170, 600, 230 * Math.max(0.35, f)); }
  else pr.billStack(g, 1050, 620, { n: Math.min(40, D.value / 1000), w: 250, th: 9 });
  text(g, 'NEXTWAVE', 70, 690, { weight: 900, size: 30, color: P.ink, spacing: 3 }); return c.toBuffer('image/png');
}

function shortThumb({ g, c, D, head, bench, W, H }) {
  const Y = 1600; p3.coverImage(g, D.kind === 'chips' ? bench.bg.kitchenTall : bench.bg.roadWide, W, H, { ay: 0.3 }); pr.desk(g, { x0: -100, x1: W + 100, topY: Y, bottom: H + 20 });
  g.save(); g.globalAlpha = 0.92; g.fillStyle = P.canvas; rr(g, 50, 210, 980, 520, 34); g.fill(); g.restore();
  let size = 130, lines; for (;;) { lines = wrap(g, head, 860, { kind: 'display', weight: 800, size }); if (lines.length <= 3 || size < 70) break; size -= 8; }
  lines.slice(0, 3).forEach((ln, i) => text(g, ln, 90, 340 + i * (size + 26), { kind: 'display', weight: 800, size, color: i === Math.min(2, lines.length - 1) ? P.red : P.ink }));
  if (D.kind === 'compare') { const top = Math.max(D.a.value, D.b.value); const per = 600 / (top / 1000); const st = (x, v, col) => { const un = Math.max(1, Math.ceil(top / 1000 / 40)); pr.coinStack(g, x, Y + 16, { n: v / 2000 / un, w: 260, th: per * un * 2 }); return Y + 16 - (v / 1000) * per; }; const ta = st(300, D.a.value), tb = st(740, D.b.value);
    pr.tag(g, 300, ta - 30, fmt$(D.a.value), { size: 56, sub: D.a.label, pad: 22 }); pr.tag(g, 740, tb - 30, fmt$(D.b.value), { size: 56, sub: D.b.label, pad: 22 });
    g.save(); g.setLineDash([16, 12]); g.strokeStyle = P.red; g.lineWidth = 6; g.beginPath(); g.moveTo(300, tb); g.lineTo(900, tb); g.stroke(); g.restore(); pr.tag(g, 540, Math.max(ta - 200, 830), D.gapText, { size: 84, sub: 'THE DIFFERENCE', pad: 30, fill: P.redSoft, ink: P.red, pointer: 'none' }); }
  else if (D.kind === 'chips') { const f = D.before ? D.after / D.before : 1; const bw = 360; const ha = bw * bench.prop.bag.h / bench.prop.bag.w; g.save(); g.setLineDash([16, 12]); g.strokeStyle = P.red; g.lineWidth = 6; rr(g, 300 - bw / 2 - 8, Y + 26 - ha - 8, bw + 16, ha + 8, 16); g.stroke(); g.restore(); p3.sprite(g, bench.prop.bag, 300, Y + 26, bw); p3.sprite(g, bench.prop.bag, 760, Y + 26, bw * Math.max(0.35, f)); pr.tag(g, 300, Y - ha - 50, D.beforeText, { size: 60, pad: 24 }); pr.tag(g, 760, Y - ha - 50, D.afterText, { size: 60, pad: 24 }); }
  else { pr.billStack(g, 540, Y + 16, { n: Math.min(45, D.value / 1000), w: 320, th: 14 }); pr.tag(g, 540, Y - 700, D.valueText, { size: 90, pad: 30 }); }
  text(g, 'NEXTWAVE', 70, 150, { weight: 900, size: 44, color: P.ink, spacing: 4 }); g.fillStyle = P.gold; g.fillRect(70, 168, 96, 7); return c.toBuffer('image/png');
}
