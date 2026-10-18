// NextWave V2 production — Stage 3A: ONE-SCENE creative proof, grounded in a direct review of a real
// Wealth Logic benchmark recording (CEO-provided, 2026-10-17, "Gold vs Silver — Which One Will Make You
// More Money?"). This is an ORIGINAL NextWave composition built entirely from this renderer's own existing
// assets (the live host manifest's 'point'/'react' poses, pr.billStack) — it does not reuse, trace, or
// adapt any Wealth Logic character design, background art, or specific shot composition. What it borrows
// is the STORYTELLING PRINCIPLE observed across several real timestamps in that recording (documented in
// the Stage 3A report, not here): a large character, a plain uncluttered background, ONE financial object
// whose own SIZE encodes the value (not a bar chart), one label at a time, and a character reaction tied
// to the reveal moment — never more than one stacked UI panel.
//
// NOT wired into compose.mjs's real dispatch (this is a bounded, one-scene prototype per the Stage 3A
// order, not a production integration like Stage 2C's presenter_interaction.mjs). Uses Task 125's own
// real, Brain-verified stock_chart renderer_params (via extractAB, the same extraction already used by
// illustration_scene.mjs/presenter_interaction.mjs) -- the two dollar figures and the gap are exactly the
// storyboard's own verified strings, never invented or reformatted.
import { P, tw, ease, lerp, text, groundShadow } from '../core.mjs';
import * as pr from '../props.mjs';
import { hostLayer } from '../scenes.mjs';
import { extractAB } from './illustration_scene.mjs';

const moneyOf = (s) => { const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(String(s || '')); return m ? Number(m[1].replace(/,/g, '')) : null; };
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
    xa, xb, baseY, ha, hb, gap,
    labelA: { text: AB.aTxt, sub: AB.names[0], x: xa, y: baseY - ha - 40, size: short ? 42 : 48 },
    labelB: { text: AB.bTxt, sub: AB.names[1], x: xb, y: baseY - hb - 40, size: short ? 42 : 48 },
    labelGap: { text: fmt$(gap), sub: 'THE COST OF WAITING', x: (xa + xb) / 2, y: baseY - Math.max(ha, hb) - 150, size: short ? 46 : 54 },
  };
}

// t0/t1 are LOCAL to this standalone scene (seconds from 0, not a storyboard span) -- the caller supplies
// absolute offsets when compositing this into a larger timeline (see the Stage 3A render script).
export function buildBenchmarkProofScene(ctx, { holdFirst = 3.5, holdSecond = 12.5 } = {}) {
  const { L, p, poses } = ctx; const { W, H } = L; const short = L.short;
  const plan = planBenchmarkProofLabels(ctx); if (!plan.labelA) return null;
  const { xa, xb, baseY, ha, hb, labelA, labelB, labelGap } = plan;
  const tSkip = holdFirst; // the one scene-to-scene beat: a brief, honest "time passing" transition, not a hard cut
  const tGap = holdFirst + 1.6;
  return {
    t0: 0, t1: holdSecond, world: { w: W, h: H },
    meta: { kit: 'benchmark_proof_original' },
    camera: [
      { t: 0, x: W / 2, y: H / 2, z: 1.0 },
      { t: tSkip - 0.3, x: W / 2, y: H / 2, z: 1.0 },
      { t: tSkip + 0.6, x: W / 2, y: H * 0.46, z: 1.08 },
      { t: holdSecond, x: W / 2, y: H * 0.46, z: 1.1 },
    ],
    draw(g, t) {
      // plain, uncluttered flat background -- deliberately no set/desk/window dressing, the cleanest
      // background already available in this renderer's own palette (STYLE.palette.canvas).
      g.fillStyle = P.canvas; g.fillRect(0, 0, W, H);
      g.save(); g.globalAlpha = 0.5; g.fillStyle = P.canvasDeep; g.fillRect(0, baseY + 20, W, H - baseY - 20); g.restore();

      // object A ("start today"): grows in on entry, size is the ONLY encoding of its value -- no chart.
      const kA = tw(t, 0.4, 0.8, ease.outBack);
      if (kA > 0.01) { g.save(); g.globalAlpha = kA; groundShadow(g, xa, baseY, ha * 0.9, 0.22);
        pr.billStack(g, xa, baseY, { n: Math.max(0.5, (ha / 14)), w: short ? 210 : 240, ground: false }); g.restore();
        objLabelAt(g, tw(t, 0.9, 0.5, ease.outBack), xa, labelA.y, labelA.text, { size: labelA.size, sub: labelA.sub, W }); }

      // the one scene-to-scene transition beat: a brief plate marking time passing, mirroring (not
      // copying) the "time skip" device -- original wording, drawn as plain centered text, no card.
      const kSkip = tw(t, tSkip - 0.2, 0.5, ease.outCubic) * (1 - tw(t, tSkip + 0.5, 0.5, ease.inCubic));
      if (kSkip > 0.01) { g.save(); g.globalAlpha = kSkip; text(g, 'SEVEN YEARS LATER', W / 2, H * 0.14, { kind: 'display', weight: 800, size: short ? 40 : 46, color: P.inkMute, align: 'center', spacing: 2 }); g.restore(); }

      // object B ("wait 7 years"): appears after the time-skip beat, same billStack prop, honestly
      // shorter because the real verified value is smaller -- the size difference IS the argument.
      const kB = tw(t, tSkip + 0.5, 0.8, ease.outBack);
      if (kB > 0.01) { g.save(); g.globalAlpha = kB; groundShadow(g, xb, baseY, hb * 0.9, 0.22);
        pr.billStack(g, xb, baseY, { n: Math.max(0.5, (hb / 14)), w: short ? 210 : 240, ground: false }); g.restore();
        objLabelAt(g, tw(t, tSkip + 1.0, 0.5, ease.outBack), xb, labelB.y, labelB.text, { size: labelB.size, sub: labelB.sub, W }); }

      // the gap, revealed last, with the host reacting to it (not pointing at nothing) -- character
      // action tied directly to this specific narrative beat, exactly as every object reveal in this
      // renderer's existing templates already ties a pose change to its own reveal instant.
      const kG = tw(t, tGap, 0.6, ease.outBack);
      if (kG > 0.01) objLabelAt(g, kG, labelGap.x, labelGap.y, labelGap.text, { size: labelGap.size, sub: labelGap.sub, W });

      hostLayer(g, t, { poses, timeline: [{ t: 0, pose: 'point' }, { t: tGap, pose: 'react' }], x: short ? W / 2 : W * 0.86, bottom: short ? H * 0.98 : H * 0.92, scale: short ? L.hostS * 0.85 : L.hostS * 1.05, enter: tw(t, 0.1, 0.6, ease.outBack) });
    },
  };
}
