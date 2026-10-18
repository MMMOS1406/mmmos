// NextWave V2 production — frame builder for a topic-specific ILLUSTRATED beat (hook or dominant comparison).
// The background is one static generated (or reused-approved) image; everything the viewer must trust — every
// number, label, gap — is drawn programmatically on top, exactly as in every other template in this renderer.
// Camera is Ken Burns (pan/zoom over the still image, clamped so the frame never leaves the art) — no per-video
// video-generation vendor, per the PMO order.
import { P, tw, ease, lerp, text, rr, drawMoney, fmtMoney, STYLE, wrap, measure, ensureFonts } from '../core.mjs';
import { createCanvas } from '@napi-rs/canvas';
import * as pr from '../props.mjs';
import { hostLayer } from '../scenes.mjs';
import { eventTime } from './timing.mjs';

// Stage 2E -- text-fit measurement only (no drawing); a throwaway context so planHookLabels/
// planPresenterIntroLabels can wrap/measure real glyph metrics without needing the actual render context.
ensureFonts();
const FIT_CTX = createCanvas(10, 10).getContext('2d');

const moneyOf = (s) => { const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(String(s || '')); return m ? Number(m[1].replace(/,/g, '')) : null; };
// Stage 2C (2026-10-17) -- exported (behavior unchanged) so presenter_interaction.mjs's new full-frame
// static-pose beats can reuse the exact same Ken-Burns/cover-image/AB-extraction logic instead of a
// second copy, since both are the same "static generated image + programmatic overlay" technique.
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const camAt = (cam, t) => { let i = 0; while (i < cam.length - 2 && t > cam[i + 1].t) i++; const a = cam[i], b = cam[i + 1]; const p = ease.inOutCubic(clamp01((t - a.t) / Math.max(0.001, b.t - a.t))); return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), z: lerp(a.z, b.z, p) }; };
export function drawCover(g, img, W, H, c) {
  const iw = img.width, ih = img.height; const scale = Math.max(W / iw, H / ih) * c.z; const dw = iw * scale, dh = ih * scale;
  let cx = c.x * dw, cy = c.y * dh; cx = Math.max(W / 2, Math.min(dw - W / 2, cx)); cy = Math.max(H / 2, Math.min(dh - H / 2, cy));
  g.drawImage(img, W / 2 - cx, H / 2 - cy, dw, dh);
}
const popTag = (g, k, x, y, str, o) => { if (k <= 0.01) return; g.save(); g.translate(x, y); g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k); pr.tag(g, 0, 0, str, { ...o, alpha: Math.min(1, k * 1.4) }); g.restore(); };
// Creative recovery (2026-10-17, isolated experimental branch) — object-centered sibling of popTag: same
// scale-in entrance math, but calls pr.objectLabel instead of pr.tag (no bordered white card), so the value
// reads directly against the generated illustration instead of floating in a UI panel. Additive only; popTag
// itself is untouched so the gap card (drawn separately, not via popTag) keeps its exact current treatment.
const popTagObj = (g, k, x, y, str, o) => { if (k <= 0.01) return; g.save(); g.globalAlpha *= Math.min(1, k * 1.4); g.translate(x, y + (1 - k) * 14); pr.objectLabel(g, 0, 0, str, o); g.restore(); };
export const valueTime = (ctx, display, fb) => { for (const r of (ctx.sceneInfo.reveal_steps || [])) { const v = ctx.valuesById.get(r.entity_id); if (v && v.display === display) return eventTime(ctx.words, ctx.span, r.meaning_event_pattern, 0.5).t; } return fb; };

// ── label geometry (pure, no drawing) -- Stage 2D: single source of truth shared by draw() below AND
// presenter_qc.mjs's analytical safe-margin/collision checker, so the QC check can never drift from what
// is actually rendered. Returns the plate's own rect plus the text's baseline position (fully revealed,
// k=1 -- the entrance animation's small ±14px settle offset is not safety-relevant). ────────────────────
// Stage 2E Phase 1 -- fixes the confirmed headline overflow (Stage 2D found Task 125's real hook scene
// draws its first sentence unwrapped at a fixed position with no width limit, visibly running past the
// plate onto the frame for long sentences). Wraps via the renderer's own wrap()/measure() (real glyph
// metrics, the same primitive captions.mjs uses to fit a caption chunk), shrinking size only if 2 lines
// still doesn't fit (mirrors drawCaptions' own fit algorithm) -- the EXACT approved headline text is never
// truncated or altered, only reflowed and, as a last resort, shown smaller. x0 is derived from the
// format's own declared safe.left (not a hardcoded literal), and plateW is clamped so x1 never crosses
// safe.right either -- this also fixes a 6px short-format overflow (w=900 at x0=90 gave x1=990, past
// short's safe.right boundary at W-96=984) that Stage 2D's long-format-only validation never exercised.
export function planHookLabels(ctx) {
  const { L } = ctx; const short = L.short;
  const lines = String(ctx.p.text || '').match(/[^.!?]+[.!?]+/g) || [ctx.p.text || '']; const first = lines[0].trim();
  const safe = STYLE.formats[short ? 'short' : 'long'].safe;
  const y0 = short ? 200 : 170;
  const x0 = safe.left;
  const plateW = Math.min(short ? 900 : 1000, L.W - safe.left - safe.right);
  const textPad = 30; const maxTextW = plateW - textPad * 2;
  let size = short ? 50 : 46; let wrapped;
  for (;;) { wrapped = wrap(FIT_CTX, first, maxTextW, { kind: 'display', weight: 800, size }); if (wrapped.length <= 2 || size <= 32) break; size = Math.max(32, size - 3); }
  const lineHeight = size * 1.28; const topPad = short ? 46 : 40; const bottomPad = short ? 44 : 38;
  const h = topPad + wrapped.length * lineHeight + bottomPad;
  return [{ kind: 'plate', text: first, lines: wrapped, x: x0 + textPad, y: y0 + topPad, lineHeight, size, weight: 800, align: 'left', fontKind: 'display', plateRect: { x0, y0, x1: x0 + plateW, y1: y0 + h } }];
}

// ── HOOK: establishing shot, no numbers yet — headline plate only ───────────────────────────────────────────────
export function buildIllustratedHook(ctx, img) {
  const { L, span, poses } = ctx; const { W, H } = L; const short = L.short;
  const cam = short ? [{ t: span.start, x: 0.5, y: 0.75, z: 1.0 }, { t: span.end, x: 0.5, y: 0.55, z: 1.12 }] : [{ t: span.start, x: 0.5, y: 0.5, z: 1.0 }, { t: span.end, x: 0.42, y: 0.48, z: 1.1 }];
  const [plan] = planHookLabels(ctx);
  return {
    t0: span.start, t1: span.end, world: { w: W, h: H }, camera: [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2, y: H / 2, z: 1.0 }], meta: { kit: 'illustrated_hook', env: 'generated' },
    draw(g, t) {
      const c = camAt(cam.map((k) => ({ t: k.t, x: k.x, y: k.y, z: k.z })), t); drawCover(g, img, W, H, c);
      g.fillStyle = 'rgba(20,16,10,0.14)'; g.fillRect(0, 0, W, H);
      const k = tw(t, span.start + 0.25, 0.7); if (k > 0.01) {
        const { x0, y0, x1, y1 } = plan.plateRect;
        g.save(); g.globalAlpha = k; g.fillStyle = 'rgba(255,253,248,0.92)'; rr(g, x0, y0, x1 - x0, y1 - y0, 24); g.fill();
        plan.lines.forEach((line, i) => text(g, line, plan.x, plan.y + i * plan.lineHeight, { kind: plan.fontKind, weight: plan.weight, size: plan.size, color: P.ink }));
        g.restore(); }
      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'point' }], x: short ? W - 220 : W - 300, bottom: L.hostBottom, scale: L.hostS * (short ? 0.62 : 0.7), enter: tw(t, span.start + 0.1, 0.7, ease.outBack) });
    },
  };
}

// ── DOMINANT COMPARISON: two verified outcomes over generated art, same collision-safe tag layout family ───────
export function extractAB(p) {
  if (p.series && p.series.length === 2) return { a: moneyOf(p.series[0].finalValueText), b: moneyOf(p.series[1].finalValueText), aTxt: p.series[0].finalValueText, bTxt: p.series[1].finalValueText, names: [p.series[0].label, p.series[1].label] };
  if (p.beforeValue && p.afterValue) return { a: moneyOf(p.beforeValue), b: moneyOf(p.afterValue), aTxt: p.beforeValue, bTxt: p.afterValue, names: [p.beforeLabel, p.afterLabel] };
  return null;
}
// Stage 2B Phase 3 (2026-10-17) -- the long-format 'b' anchor at y=0.42 put the value label's baseline
// right where generated illustrations often place upper-frame artwork (observed: Task 125's real S2
// scene, leaf/plant art behind "$215,361 / WAIT 7 YEARS"). Nudged down to y=0.47, clear of that region in
// every illustrated-comparison render checked; 'a' and the short-format anchors were not implicated.
const COMPARISON_ANCHORS = { short: { a: [0.5, 0.62], b: [0.5, 0.35], gap: [0.5, 0.20] }, long: { a: [0.30, 0.55], b: [0.70, 0.47], gap: [0.5, 0.16] } };
// Stage 2D: pure label-geometry plan (no drawing), shared by draw() and presenter_qc.mjs. The two value
// labels are objectLabel-style (center-anchored, no card); "THE GAP" stays a card (its own rect family,
// distinct from the object-centered labels -- unchanged since Stage 1's original share_compare precedent).
export function planComparisonLabels(ctx) {
  const { L, p } = ctx; const { W, H } = L; const short = L.short; const AB = extractAB(p); if (!AB) return [];
  const anchors = short ? COMPARISON_ANCHORS.short : COMPARISON_ANCHORS.long;
  const gap = Math.abs(AB.a - AB.b);
  const [ax, ay] = [anchors.a[0] * W, anchors.a[1] * H]; const [bx, by] = [anchors.b[0] * W, anchors.b[1] * H]; const [gx, gy] = [anchors.gap[0] * W, anchors.gap[1] * H];
  const cardW = short ? 520 : 480, cardH = 190;
  return [
    { kind: 'objectLabel', text: AB.aTxt, sub: AB.names[0], x: ax, y: ay, size: short ? 50 : 46, weight: 800, align: 'center', fontKind: 'ui' },
    { kind: 'objectLabel', text: AB.bTxt, sub: AB.names[1], x: bx, y: by, size: short ? 50 : 46, weight: 800, align: 'center', fontKind: 'ui' },
    { kind: 'card', text: fmtMoney(gap), x: gx, y: gy, cardRect: { x0: gx - cardW / 2, y0: gy - 90, x1: gx + cardW / 2, y1: gy - 90 + cardH } },
  ];
}
export function buildIllustratedComparison(ctx, img) {
  const { L, p, span, words } = ctx; const { W, H } = L; const short = L.short; const AB = extractAB(p); if (!AB) return null;
  const gap = Math.abs(AB.a - AB.b); ctx.derive(fmtMoney(gap), 'abs(a-b)');
  const ev = eventTime(words, span, ctx.pattern, 0.6).t; const tA = valueTime(ctx, AB.aTxt, span.start + span.end - span.start) ; const dur0 = span.end - span.start;
  const t0 = span.start + Math.min(2.0, 0.15 * dur0); const tAr = valueTime(ctx, AB.aTxt, t0 + dur0 * 0.35); const tBr = valueTime(ctx, AB.bTxt, t0 + dur0 * 0.6); const tGap = Math.max(tAr, tBr) + 0.3;
  const anchors = short ? COMPARISON_ANCHORS.short : COMPARISON_ANCHORS.long;
  const camera = short
    ? [{ t: span.start, x: 0.5, y: 0.7, z: 1.0 }, { t: t0, x: anchors.a[0], y: anchors.a[1] + 0.12, z: 1.1 }, { t: tAr + 0.4, x: anchors.a[0], y: anchors.a[1], z: 1.16 }, { t: tBr - 0.4, x: anchors.b[0], y: anchors.b[1] + 0.1, z: 1.14 }, { t: tBr + 0.4, x: anchors.b[0], y: anchors.b[1], z: 1.18 }, { t: tGap + 0.2, x: 0.5, y: 0.45, z: 1.22 }, { t: Math.max(tGap + 2.2, span.end - 0.6), x: 0.5, y: 0.55, z: 1.04 }]
    : [{ t: span.start, x: 0.5, y: 0.5, z: 1.0 }, { t: t0, x: anchors.a[0] - 0.1, y: anchors.a[1], z: 1.1 }, { t: tAr + 0.4, x: anchors.a[0], y: anchors.a[1], z: 1.18 }, { t: tBr - 0.4, x: anchors.b[0] + 0.1, y: anchors.b[1], z: 1.12 }, { t: tBr + 0.4, x: anchors.b[0], y: anchors.b[1], z: 1.2 }, { t: tGap + 0.2, x: 0.5, y: 0.46, z: 1.24 }, { t: Math.max(tGap + 2.4, span.end - 0.7), x: 0.5, y: 0.5, z: 1.02 }];
  const camKeys = camera.filter((k, i, a) => !i || k.t > a[i - 1].t + 0.05);
  return {
    t0: span.start, t1: span.end, world: { w: W, h: H }, meta: { kit: 'illustrated_comparison', env: 'generated' },
    camera: [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2, y: H / 2, z: 1.0 }], // world-space camera stays put; motion is inside draw() over the still image, matching the proof
    draw(g, t) {
      const c = camAt(camKeys, t); drawCover(g, img, W, H, c); g.fillStyle = 'rgba(20,16,10,0.15)'; g.fillRect(0, 0, W, H);
      const anchorPx = (a) => [a[0] * W, a[1] * H];
      const kHook = tw(t, span.start + 0.2, 0.6) * (1 - tw(t, t0 + 0.5, 0.6)); if (kHook > 0.01 && p.anchorText) { g.save(); g.globalAlpha = kHook; pr.pill(g, W / 2, short ? 260 : 100, p.anchorText, { size: short ? 28 : 28, fill: P.navy, pad: 24 }); g.restore(); }
      const [ax, ay] = anchorPx(anchors.a), [bx, by] = anchorPx(anchors.b), [gx, gy] = anchorPx(anchors.gap);
      popTagObj(g, tw(t, tAr, 0.5, ease.outBack), ax, ay, AB.aTxt, { size: short ? 50 : 46, sub: AB.names[0], pad: 20 });
      popTagObj(g, tw(t, tBr, 0.5, ease.outBack), bx, by, AB.bTxt, { size: short ? 50 : 46, sub: AB.names[1], pad: 20 });
      const kg = tw(t, tGap, 0.7, ease.outCubic); if (kg > 0.01) { g.save(); g.globalAlpha = kg; rr(g, gx - (short ? 260 : 240), gy - 90, short ? 520 : 480, 190, 26); g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill(); drawMoney(g, fmtMoney(gap), gx, gy + 10, { size: short ? 68 : 62, color: P.red, align: 'center' }); text(g, 'THE GAP', gx, gy + 62, { weight: 800, size: 24, color: P.inkMute, align: 'center', spacing: 2 }); g.restore(); }
    },
  };
}
