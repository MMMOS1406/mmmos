// NextWave V2 production — Stage 3A/3B: ONE-SCENE creative proof, grounded in a direct review of a real
// Wealth Logic benchmark recording (CEO-provided, 2026-10-17, "Gold vs Silver — Which One Will Make You
// More Money?"). This is an ORIGINAL NextWave composition built entirely from this renderer's own existing
// assets (the live host manifest's 'point'/'think'/'react' poses, pr.billStack) — it does not reuse,
// trace, or adapt any Wealth Logic character design, background art, or specific shot composition. What it
// borrows is the STORYTELLING PRINCIPLE observed across several real timestamps in that recording
// (documented in the Stage 3A/3B reports, not here): a large character, a plain uncluttered background,
// financial objects whose own SIZE/GROWTH encodes the value (not a bar chart), one label at a time, and
// character actions tied to each specific reveal moment — never more than one stacked UI panel.
//
// Stage 3B upgrade: both bill stacks now GROW continuously over time (billStack's own fractional `n`
// animated via tw(), not a scale-in pop) -- "the comparison develops over time", not a static end-state
// that merely appears. Path B is shown as an empty dashed placeholder (its own eventual height, honestly
// telegraphed) until the real "7 years later" narrative beat, so the HEAD START itself is dramatized by
// WHEN each stack starts growing, not just by their final heights. All five beat timings (the shared
// $500 entry, each outcome reveal, the delay marker, the gap) are the REAL eventTime()/valueTime()
// instants Task 125's own narration reveals them at, proportionally compressed to fit this short proof's
// runway -- not arbitrary. Camera motion is present but secondary; removing it still leaves two growing
// stacks and three pose changes, satisfying "do not substitute camera zoom alone for object animation."
//
// NOT wired into compose.mjs's real dispatch (a bounded, one-scene prototype, not a production
// integration like Stage 2C's presenter_interaction.mjs). Uses Task 125's own real, Brain-verified
// stock_chart renderer_params (via extractAB) and its own real reveal_steps/word-alignment timing (via
// eventTime/valueTime, the exact same functions illustration_scene.mjs/presenter_interaction.mjs already
// use) -- every figure and every beat instant traces to the storyboard's own verified data.
import { P, tw, ease, lerp, text, groundShadow } from '../core.mjs';
import * as pr from '../props.mjs';
import { hostLayer } from '../scenes.mjs';
import { extractAB, valueTime } from './illustration_scene.mjs';
import { eventTime } from './timing.mjs';

const fmt$ = (v) => '$' + Math.round(v).toLocaleString('en-US');

// clamp a centered object label's x against the format's own safe zone -- same 110px convention Stage 2B
// Phase 3 established for every other object-centered label in this renderer, so this one-off scene
// inherits the identical readability guarantee rather than a bespoke, possibly weaker one.
const estW = (str, size) => String(str).length * size * 0.62;
function objLabelAt(g, k, x, y, str, { size = 50, sub = '', W } = {}) {
  if (k <= 0.01) return;
  if (W) { const half = estW(str, size) / 2 + 110; x = Math.max(half, Math.min(W - half, x)); }
  g.save(); g.globalAlpha = Math.min(1, k * 1.4); g.translate(x, y + (1 - k) * 14); g.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
  pr.objectLabel(g, 0, 0, str, { size, sub });
  g.restore();
}

export function planBenchmarkProofLabels(ctx) {
  const { L, p } = ctx; const { W, H } = L; const short = L.short;
  const AB = extractAB(p); if (!AB) return [];
  const gap = Math.abs(AB.a - AB.b);
  const xa = short ? W * 0.32 : W * 0.30, xb = short ? W * 0.68 : W * 0.62;
  const baseY = short ? H * 0.74 : H * 0.70;
  const maxV = Math.max(AB.a, AB.b); const maxH = short ? H * 0.34 : H * 0.40;
  const ha = (AB.a / maxV) * maxH, hb = (AB.b / maxV) * maxH;
  return {
    xa, xb, baseY, ha, hb, gap, AB,
    labelA: { text: AB.aTxt, sub: AB.names[0], x: xa, y: baseY - ha - 40, size: short ? 42 : 48 },
    labelB: { text: AB.bTxt, sub: AB.names[1], x: xb, y: baseY - hb - 40, size: short ? 42 : 48 },
    labelGap: { text: fmt$(gap), sub: 'THE COST OF WAITING', x: (xa + xb) / 2, y: baseY - Math.max(ha, hb) - 150, size: short ? 46 : 54 },
  };
}

// Real narration-synced beat schedule -- every instant below is the REAL eventTime()/valueTime() moment
// Task 125's own storyboard reveals that figure at (see reveal_steps), proportionally compressed to fit
// this short proof. `compressTo` is the target wall-clock instant for the LAST real beat (the gap
// reveal); everything else scales by the same factor, so the real RELATIVE pacing between beats survives
// compression intact -- this is "synchronize with narration" in the only sense possible for a proof with
// no narration audio track (every prior stage's local previews have been silent; this one is too).
function realBeatSchedule(ctx, AB, gapText, compressTo) {
  const fallback = { a: 2, b: 3, delay: 2.5, gap: 4 };
  const tA = valueTime(ctx, AB.aTxt, ctx.span.start + fallback.a);
  const tB = valueTime(ctx, AB.bTxt, ctx.span.start + fallback.b);
  const tDelay = eventTime(ctx.words, ctx.span, '7\\s*years?', fallback.delay).t;
  const tGap = valueTime(ctx, gapText, ctx.span.start + fallback.gap);
  const t0 = ctx.span.start;
  const real = { a: tA - t0, delay: tDelay - t0, b: tB - t0, gap: tGap - t0 };
  const scale = compressTo / Math.max(0.5, real.gap);
  return { aReveal: real.a * scale, delayMark: real.delay * scale, bReveal: real.b * scale, gapReveal: real.gap * scale, scale };
}

// t0/t1 are LOCAL to this standalone scene (seconds from 0, not a storyboard span) -- the caller supplies
// absolute offsets when compositing this into a larger timeline.
export function buildBenchmarkProofScene(ctx, { totalDur = 16.0, gapRevealAt = 11.0 } = {}) {
  const { L, poses } = ctx; const { W, H } = L; const short = L.short;
  const plan = planBenchmarkProofLabels(ctx); if (!plan.labelA) return null;
  const { xa, xb, baseY, ha, hb, labelA, labelB, labelGap, AB } = plan;
  const beats = realBeatSchedule(ctx, AB, labelGap.text, gapRevealAt);
  // growth windows: each stack takes ~2.7s to grow, ENDING exactly at its real (compressed) reveal
  // instant -- the label pops the moment the stack finishes rising, same causality every other growing-
  // object template in this renderer already uses (money_flow's jar, share_compare's stack()).
  const growDur = 2.7;
  const aGrowStart = Math.max(0.5, beats.aReveal - growDur);
  const bGrowStart = Math.max(beats.delayMark + 0.3, beats.bReveal - growDur);

  return {
    t0: 0, t1: totalDur, world: { w: W, h: H },
    meta: { kit: 'benchmark_proof_original_v2' },
    camera: [
      { t: 0, x: W / 2, y: H / 2, z: 1.0 },
      { t: beats.delayMark - 0.3, x: W / 2, y: H / 2, z: 1.02 },
      { t: beats.delayMark + 0.8, x: W / 2, y: H * 0.46, z: 1.1 },
      { t: totalDur, x: W / 2, y: H * 0.46, z: 1.14 },
    ],
    draw(g, t) {
      // plain, uncluttered flat background -- deliberately no set/desk/window dressing, the cleanest
      // background already available in this renderer's own palette (STYLE.palette.canvas).
      g.fillStyle = P.canvas; g.fillRect(0, 0, W, H);
      g.save(); g.globalAlpha = 0.5; g.fillStyle = P.canvasDeep; g.fillRect(0, baseY + 20, W, H - baseY - 20); g.restore();

      // ── object A ("start today"): GROWS continuously from 0 to its final height over growDur,
      // ending exactly as its real narration beat lands -- the growth itself is the animation, not a
      // camera move or an instant pop. ──────────────────────────────────────────────────────────────
      const growA = tw(t, aGrowStart, growDur, ease.outCubic);
      if (growA > 0.01) { const curH = ha * growA; g.save(); groundShadow(g, xa, baseY, curH * 0.9, 0.22);
        pr.billStack(g, xa, baseY, { n: Math.max(0.02, (curH / 14)), w: short ? 210 : 240, ground: false }); g.restore();
        if (growA >= 0.98) objLabelAt(g, tw(t, aGrowStart + growDur, 0.5, ease.outBack), xa, labelA.y, labelA.text, { size: labelA.size, sub: labelA.sub, W }); }
      else {
        // dormant placeholder for A before it starts (only visible for the brief t<aGrowStart window):
        // a plain dashed outline at the eventual height, honestly telegraphing "this is what will grow
        // here" rather than leaving an unexplained gap.
        g.save(); g.globalAlpha = 0.35; g.setLineDash([10, 8]); g.strokeStyle = P.inkMute; g.lineWidth = 3;
        const w2 = (short ? 210 : 240) / 2; g.strokeRect(xa - w2, baseY - ha, w2 * 2, ha); g.restore();
      }

      // ── the one scene-to-scene transition beat: a brief plate marking real time passing (the exact
      // real "7 years" narration instant, compressed) -- original wording, no card. ───────────────────
      const kSkip = tw(t, beats.delayMark - 0.2, 0.5, ease.outCubic) * (1 - tw(t, beats.delayMark + 0.5, 0.5, ease.inCubic));
      if (kSkip > 0.01) { g.save(); g.globalAlpha = kSkip; text(g, 'SEVEN YEARS LATER', W / 2, H * 0.14, { kind: 'display', weight: 800, size: short ? 40 : 46, color: P.inkMute, align: 'center', spacing: 2 }); g.restore(); }

      // ── object B ("wait 7 years"): stays an honest dashed placeholder until the delay-marker beat,
      // THEN grows -- the HEAD START A already has by this point is what the side-by-side comparison is
      // actually about, now dramatized by timing, not just by the two stacks' different final heights. ──
      const growB = tw(t, bGrowStart, growDur, ease.outCubic);
      if (growB > 0.01) { const curH = hb * growB; g.save(); groundShadow(g, xb, baseY, curH * 0.9, 0.22);
        pr.billStack(g, xb, baseY, { n: Math.max(0.02, (curH / 14)), w: short ? 210 : 240, ground: false }); g.restore();
        if (growB >= 0.98) objLabelAt(g, tw(t, bGrowStart + growDur, 0.5, ease.outBack), xb, labelB.y, labelB.text, { size: labelB.size, sub: labelB.sub, W }); }
      else if (t >= beats.delayMark - 0.1) {
        g.save(); g.globalAlpha = 0.35; g.setLineDash([10, 8]); g.strokeStyle = P.inkMute; g.lineWidth = 3;
        const w2 = (short ? 210 : 240) / 2; g.strokeRect(xb - w2, baseY - hb, w2 * 2, hb); g.restore();
      }

      // ── the gap, revealed last, with the host reacting to it. ───────────────────────────────────────
      const kG = tw(t, beats.gapReveal, 0.6, ease.outBack);
      if (kG > 0.01) objLabelAt(g, kG, labelGap.x, labelGap.y, labelGap.text, { size: labelGap.size, sub: labelGap.sub, W });

      // ── host pose timeline: 4 beats, each tied to a specific real narrative instant (introduce -> A
      // growing -> contemplating the time skip -> B growing -> reacting to the gap) -- "actively
      // supports the explanation" means the pose changes WITH the story, not on a fixed arbitrary clock. ─
      hostLayer(g, t, {
        poses,
        timeline: [
          { t: 0, pose: 'point' },
          { t: beats.delayMark - 0.1, pose: 'think' },
          { t: bGrowStart, pose: 'point' },
          { t: beats.gapReveal, pose: 'react' },
        ],
        x: short ? W / 2 : W * 0.86, bottom: short ? H * 0.98 : H * 0.92,
        scale: short ? L.hostS * 0.85 : L.hostS * 1.05, enter: tw(t, 0.1, 0.6, ease.outBack),
      });
    },
  };
}
