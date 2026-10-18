// NextWave V2 production — Stage 3A/3B/3C: ONE-SCENE creative proof, grounded in a direct review of a
// real Wealth Logic benchmark recording (CEO-provided, 2026-10-17, "Gold vs Silver — Which One Will Make
// You More Money?"). Original NextWave composition built entirely from this renderer's own existing
// assets (the live host manifest's 'point'/'think'/'react' poses, pr.billStack) — no Wealth Logic
// character design, background art, or specific composition is reused or adapted.
//
// Stage 3C correction (creative quality not yet accepted after 3B's engineering pass):
// 1. PRESENTER CLIPPING FIX -- Stage 3B's host sat too close to the right edge (x=W*0.86, scale
//    L.hostS*1.05) AND used hostLayer's default 420px slide-in entrance; combined with camera zoom
//    reaching z=1.14, the LAST frame had the head/torso partially off-canvas, and frames during the
//    entrance window (t~0.1-0.5s) showed almost NOTHING but a floating hand -- a real bug, only found by
//    checking frames the Stage 3B report never showed, not something a few sampled screenshots caught.
//    Fixed by: a fully STATIC camera (z=1.0 throughout -- also directly satisfies Phase 3's "avoid
//    unnecessary camera movement"), host repositioned to x=W*0.78/scale=L.hostS (verified analytically,
//    see verifyHostNeverClips() below, to stay within the frame at every sampled t of the real timeline,
//    not just spot-checked), and enter fixed at 1 (no slide-in distance to clip through).
// 2. DELAY STORYTELLING FIX -- the dashed-outline "dormant placeholder" for the second stack was
//    ambiguous (an empty box with no obvious meaning on first viewing). Replaced with an explicit
//    animated TIMELINE device: a line from "TODAY" to "7 YEARS" with a marker that visibly travels
//    across it during the real delay-narration window -- an understandable visual device per the order,
//    not a dashboard (one line, two labels, one moving dot).
// 3. REAL AUDIO -- Task 125's own already-generated, already-approved ElevenLabs narration (the same
//    audio file the real published video uses) is reused for the portion of the real scene this proof
//    covers, trimmed to the real narration window and played back at a single uniform speed factor (see
//    the Stage 3C report for the exact factor and why) so every visual beat below still lands on the
//    exact real spoken word it corresponds to -- not a new paid narration generation, not silent.
import { P, tw, ease, lerp, text, groundShadow, STYLE } from '../core.mjs';
import * as pr from '../props.mjs';
import { hostLayer } from '../scenes.mjs';
import { extractAB, valueTime } from './illustration_scene.mjs';
import { eventTime } from './timing.mjs';

const fmt$ = (v) => '$' + Math.round(v).toLocaleString('en-US');

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
  const xa = short ? W * 0.30 : W * 0.26, xb = short ? W * 0.62 : W * 0.54;
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

// Real narration-synced beat schedule. `windowStartAbs`/`speed` describe the REAL audio excerpt this
// scene is built to match exactly (see the Stage 3C report): absolute eventTime()/valueTime() instants,
// minus the excerpt's own start, divided by the SAME uniform speed factor the audio was sped up by --
// not an independent compression ratio chosen for the visuals alone.
function realBeatSchedule(ctx, AB, gapText, windowStartAbs, speed) {
  const toLocal = (abs) => (abs - windowStartAbs) / speed;
  const tA = valueTime(ctx, AB.aTxt, ctx.span.start + 4);
  const tB = valueTime(ctx, AB.bTxt, ctx.span.start + 20);
  const tDelay = eventTime(ctx.words, ctx.span, '7\\s*years?', ctx.span.start + 14).t;
  const tGap = valueTime(ctx, gapText, ctx.span.start + 27);
  return { aReveal: toLocal(tA), delayMark: toLocal(tDelay), bReveal: toLocal(tB), gapReveal: toLocal(tGap) };
}

// Host placement + static camera verified (see verifyHostNeverClips) to keep the full character on-canvas
// at every sampled t -- not asserted by eyeballing a handful of screenshots.
const HOST_X_FRAC = { short: 0.5, long: 0.78 };
const HOST_SCALE_FACTOR = 1.0; // multiplies L.hostS directly -- Stage 3B's extra *1.05 is what pushed the character past the edge once the (now-removed) camera zoom was added on top

export function buildBenchmarkProofScene(ctx, { totalDur = 17.0, windowStartAbs = 16.0, speed = 25.0 / 17.0 } = {}) {
  const { L, poses } = ctx; const { W, H } = L; const short = L.short;
  const plan = planBenchmarkProofLabels(ctx); if (!plan.labelA) return null;
  const { xa, xb, baseY, ha, hb, labelA, labelB, labelGap, AB } = plan;
  const beats = realBeatSchedule(ctx, AB, labelGap.text, windowStartAbs, speed);
  const growDur = 2.7;
  const aGrowStart = Math.max(0.1, beats.aReveal - growDur);
  const bGrowStart = Math.max(beats.delayMark + 0.3, beats.bReveal - growDur);
  const hostX = short ? W * HOST_X_FRAC.short : W * HOST_X_FRAC.long;
  const hostBottom = short ? H * 0.98 : H * 0.90;
  const hostScale = (short ? L.hostS * 0.85 : L.hostS) * HOST_SCALE_FACTOR;

  // ── timeline/calendar device: a simple line "TODAY" -> "7 YEARS" with a marker that travels across
  // it during the real delay-narration window -- the "understandable visual device" the order asks for,
  // replacing the Stage 3B dashed-placeholder ambiguity. One line, two labels, one dot: not a dashboard. ─
  const tlX0 = W * (short ? 0.30 : 0.26), tlX1 = W * (short ? 0.62 : 0.54);
  // y=0.20 sits clear of both the "SEVEN YEARS LATER" plate above it (0.12) and stack A's own label
  // below it (baseY-ha-40, which can sit as high as ~0.26 for a tall stack) -- found by rendering a real
  // frame where the first version (0.30) visibly overlapped "START TODAY", not assumed.
  const tlY = H * 0.20;
  const tlStart = beats.delayMark - 0.35, tlEnd = bGrowStart - 0.05;

  return {
    t0: 0, t1: totalDur, world: { w: W, h: H },
    meta: { kit: 'benchmark_proof_original_v3' },
    // static camera throughout -- Phase 3 asks to avoid unnecessary camera movement, and a static camera
    // also removes the zoom-driven clipping risk entirely rather than just tuning it smaller.
    camera: [{ t: 0, x: W / 2, y: H / 2, z: 1.0 }, { t: totalDur, x: W / 2, y: H / 2, z: 1.0 }],
    draw(g, t) {
      g.fillStyle = P.canvas; g.fillRect(0, 0, W, H);
      g.save(); g.globalAlpha = 0.5; g.fillStyle = P.canvasDeep; g.fillRect(0, baseY + 20, W, H - baseY - 20); g.restore();

      // ── object A ("start today"): grows continuously, ending exactly at its real narration instant. ──
      const growA = tw(t, aGrowStart, growDur, ease.outCubic);
      if (growA > 0.01) { const curH = ha * growA; g.save(); groundShadow(g, xa, baseY, curH * 0.9, 0.22);
        pr.billStack(g, xa, baseY, { n: Math.max(0.02, (curH / 14)), w: short ? 190 : 220, ground: false }); g.restore();
        if (growA >= 0.98) objLabelAt(g, tw(t, aGrowStart + growDur, 0.5, ease.outBack), xa, labelA.y, labelA.text, { size: labelA.size, sub: labelA.sub, W }); }

      // ── "SEVEN YEARS LATER" plate, timed to the real "7 years" narration instant. ─────────────────────
      const kSkip = tw(t, beats.delayMark - 0.2, 0.4, ease.outCubic) * (1 - tw(t, tlEnd - 0.1, 0.4, ease.inCubic));
      if (kSkip > 0.01) { g.save(); g.globalAlpha = kSkip; text(g, 'SEVEN YEARS LATER', W / 2, H * 0.12, { kind: 'display', weight: 800, size: short ? 38 : 44, color: P.inkMute, align: 'center', spacing: 2 }); g.restore(); }

      // ── animated timeline: line + two endpoint labels + a marker that travels left to right across
      // the delay window -- replaces the ambiguous dashed box with an explicit, legible device. ─────────
      const kTl = tw(t, beats.delayMark - 0.3, 0.3, ease.outCubic) * (1 - tw(t, tlEnd + 0.3, 0.4, ease.inCubic));
      if (kTl > 0.01) {
        g.save(); g.globalAlpha = kTl;
        g.strokeStyle = P.inkMute; g.lineWidth = 4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(tlX0, tlY); g.lineTo(tlX1, tlY); g.stroke();
        [tlX0, tlX1].forEach((x) => { g.beginPath(); g.arc(x, tlY, 7, 0, Math.PI * 2); g.fillStyle = P.inkMute; g.fill(); });
        text(g, 'TODAY', tlX0, tlY - 26, { weight: 700, size: short ? 24 : 26, color: P.inkMute, align: 'center' });
        text(g, '7 YEARS', tlX1, tlY - 26, { weight: 700, size: short ? 24 : 26, color: P.inkMute, align: 'center' });
        const travel = tw(t, tlStart, Math.max(0.3, tlEnd - tlStart), ease.inOutCubic);
        const mx = lerp(tlX0, tlX1, travel);
        g.beginPath(); g.arc(mx, tlY, 13, 0, Math.PI * 2); g.fillStyle = P.gold; g.fill();
        g.lineWidth = 3; g.strokeStyle = P.paper; g.stroke();
        g.restore();
      }

      // ── object B ("wait 7 years"): grows only after the timeline marker finishes its travel. ──────────
      const growB = tw(t, bGrowStart, growDur, ease.outCubic);
      if (growB > 0.01) { const curH = hb * growB; g.save(); groundShadow(g, xb, baseY, curH * 0.9, 0.22);
        pr.billStack(g, xb, baseY, { n: Math.max(0.02, (curH / 14)), w: short ? 190 : 220, ground: false }); g.restore();
        if (growB >= 0.98) objLabelAt(g, tw(t, bGrowStart + growDur, 0.5, ease.outBack), xb, labelB.y, labelB.text, { size: labelB.size, sub: labelB.sub, W }); }

      // ── the gap, revealed last, host reacting to it. ───────────────────────────────────────────────────
      const kG = tw(t, beats.gapReveal, 0.6, ease.outBack);
      if (kG > 0.01) objLabelAt(g, kG, labelGap.x, labelGap.y, labelGap.text, { size: labelGap.size, sub: labelGap.sub, W });

      // ── host: 4 pose beats tied to real narrative instants; enter fixed at 1 (no slide-in distance to
      // clip through -- the Stage 3B bug). ───────────────────────────────────────────────────────────────
      hostLayer(g, t, {
        poses,
        timeline: [
          { t: 0, pose: 'point' },
          { t: beats.delayMark - 0.1, pose: 'think' },
          { t: bGrowStart, pose: 'point' },
          { t: beats.gapReveal, pose: 'react' },
        ],
        x: hostX, bottom: hostBottom, scale: hostScale, enter: 1,
      });
    },
    _debug: { beats, aGrowStart, bGrowStart, hostX, hostBottom, hostScale },
  };
}

// ── Stage 3C Phase 1 requirement: "verify all frames, not only screenshots". Computes the host
// character's on-screen bounding box analytically (the exact math hostLayer itself uses to position and
// scale the sprite) at every sampled t across the scene's full duration, for every pose the timeline
// actually uses, and asserts it stays within the frame. Pure geometry, no rendering -- can run against
// every frame cheaply instead of spot-checking a handful of exported PNGs. ─────────────────────────────
export function verifyHostNeverClips(scene, poseSizes, fps = 30) {
  const { _debug } = scene; const { hostX, hostBottom, hostScale } = _debug;
  const violations = [];
  const timeline = [
    { t: 0, pose: 'point' },
    { t: _debug.beats.delayMark - 0.1, pose: 'think' },
    { t: _debug.bGrowStart, pose: 'point' },
    { t: _debug.beats.gapReveal, pose: 'react' },
  ];
  const n = Math.round(fps * scene.t1);
  for (let i = 0; i <= n; i++) {
    const t = i / fps;
    let idx = 0; timeline.forEach((k, j) => { if (t >= k.t) idx = j; });
    const pose = timeline[idx].pose; const size = poseSizes[pose]; if (!size) continue;
    const cw = size.w * hostScale, ch = size.h * hostScale;
    const x0 = hostX - cw / 2, x1 = hostX + cw / 2, y0 = hostBottom - ch, y1 = hostBottom;
    if (x0 < 0 || x1 > scene.world.w || y0 < 0 || y1 > scene.world.h) violations.push({ t: +t.toFixed(3), pose, x0, x1, y0, y1 });
  }
  return { pass: violations.length === 0, checkedFrames: n + 1, violations };
}
