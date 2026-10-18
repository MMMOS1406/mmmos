// NextWave V2 production — Stage 3A-3D: ONE-SCENE creative proof, grounded in a direct review of a real
// Wealth Logic benchmark recording (CEO-provided, 2026-10-17, "Gold vs Silver — Which One Will Make You
// More Money?"). Original NextWave composition built entirely from this renderer's own existing assets
// (the live host manifest's 'point'/'think'/'react' poses, pr.billStack) — no Wealth Logic character
// design, background art, or specific composition is reused or adapted.
//
// Stage 3D redesign (Phase 1 objective: "through recognizable character actions and physical objects,
// rather than relying on numerical labels and infographic-style animation"):
//
// ASSET REALITY (Phase 2 inventory, documented not worked around): NextWave has exactly ONE approved
// character identity -- 8 pose images total (5 live-manifest + 3 Stage 2C full-frame), all the same
// person. There is no second character design. Rather than fake one or substitute arbitrary pose cuts
// (explicitly prohibited), this scene uses a technique directly inspired by a device actually observed in
// the benchmark (background characters shown desaturated vs. foreground characters in full color):
// drawPersonSprite() below tints the SAME existing pose sprite toward neutral gray via a clipped
// source-atop composite (canvas-native, zero new assets, zero vendor cost) to stage "Person A" (active,
// full color throughout) and "Person B" (gray/idle until the real moment they start investing, then
// transitions to full color at that exact instant) as two simultaneously visible, narratively distinct
// roles -- not two different character designs. The real cost of a genuine second character design is
// quantified in the Stage 3D report, not implemented here without authorization.
//
// Each character's pose is tied to a specific real narrative action (point = actively investing /
// gesturing at their own growing stack; think = waiting, not yet started; react = reacting to the
// revealed consequence) -- never an arbitrary cut. Each bill stack grows only while its own character is
// in the "active" (full-color) state, so the object's growth and the character's state change together,
// not as two independent animations.
//
// Audio: Task 125's own real, already-approved ElevenLabs narration, trimmed to the real window this
// scene covers and played at NORMAL (1.0x) speed -- no speed change this time (see the Stage 3D report
// for why the real beat spacing fit the 15-25s window without one).
import { P, tw, ease, lerp, text, groundShadow } from '../core.mjs';
import * as pr from '../props.mjs';
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

// Draws one of the renderer's existing pose sprites at an explicit position/scale (not hostLayer's bob
// animation -- two independent simultaneous characters make that unnecessary complexity), optionally
// tinted toward neutral gray in proportion to `gray` (0 = full color, 1 = fully desaturated). The tint is
// a source-atop composite clipped to the sprite's own alpha, so it never bleeds past the character's
// silhouette (verified visually -- see the Stage 3D report).
function drawPersonSprite(g, poseObj, x, bottom, scale, gray = 0) {
  if (!poseObj) return null;
  const cw = poseObj.w * scale, ch = poseObj.h * scale;
  g.save(); g.translate(x, bottom); g.drawImage(poseObj.canvas, -cw / 2, -ch, cw, ch);
  if (gray > 0.01) { g.globalCompositeOperation = 'source-atop'; g.globalAlpha = Math.min(1, gray) * 0.78; g.fillStyle = '#9AA3AD'; g.fillRect(-cw / 2, -ch, cw, ch); g.globalCompositeOperation = 'source-over'; }
  g.restore();
  return { x0: x - cw / 2, x1: x + cw / 2, y0: bottom - ch, y1: bottom };
}

export function planBenchmarkProofLabels(ctx) {
  const { L, p } = ctx; const { W, H } = L; const short = L.short;
  const AB = extractAB(p); if (!AB) return [];
  const gap = Math.abs(AB.a - AB.b);
  const xa = short ? W * 0.20 : W * 0.17, xb = short ? W * 0.56 : W * 0.60;
  const baseY = short ? H * 0.78 : H * 0.74;
  const maxV = Math.max(AB.a, AB.b); const maxH = short ? H * 0.30 : H * 0.34;
  const ha = (AB.a / maxV) * maxH, hb = (AB.b / maxV) * maxH;
  return {
    xa, xb, baseY, ha, hb, gap, AB,
    labelA: { text: AB.aTxt, x: xa, y: baseY - ha - 36, size: short ? 38 : 44 },
    labelB: { text: AB.bTxt, x: xb, y: baseY - hb - 36, size: short ? 38 : 44 },
    labelGap: { text: fmt$(gap), sub: 'THE COST OF WAITING', x: (xa + xb) / 2, y: baseY - Math.max(ha, hb) - 140, size: short ? 46 : 54 },
  };
}

// Real narration-synced beat schedule, 1:1 wall-clock (no speed factor this time -- the real spacing
// between "A begins" and "gap revealed" fits the 15-25s requirement at normal speed).
function realBeatSchedule(ctx, AB, gapText, windowStartAbs) {
  const toLocal = (abs) => abs - windowStartAbs;
  const tA = valueTime(ctx, AB.aTxt, ctx.span.start + 4);
  const tB = valueTime(ctx, AB.bTxt, ctx.span.start + 20);
  const tDelay = eventTime(ctx.words, ctx.span, '7\\s*years?', ctx.span.start + 14).t;
  const tGap = valueTime(ctx, gapText, ctx.span.start + 27);
  return { aReveal: toLocal(tA), delayMark: toLocal(tDelay), bReveal: toLocal(tB), gapReveal: toLocal(tGap) };
}

export function buildBenchmarkProofScene(ctx, { totalDur = 24.74, windowStartAbs = 16.0 } = {}) {
  const { L, poses } = ctx; const { W, H } = L; const short = L.short;
  const plan = planBenchmarkProofLabels(ctx); if (!plan.labelA) return null;
  const { xa, xb, baseY, ha, hb, labelA, labelB, labelGap, AB } = plan;
  const beats = realBeatSchedule(ctx, AB, labelGap.text, windowStartAbs);
  const growDur = 2.7;
  const aGrowStart = Math.max(0.1, beats.aReveal - growDur);
  const bGrowStart = Math.max(beats.delayMark + 0.3, beats.bReveal - growDur);

  // Person positions: each stands just beside their OWN stack, both roughly half the scale of the prior
  // single-host compositions -- two co-equal figures, not one dominant narrator with floating numbers.
  const stackW = short ? 170 : 200;
  const personScale = (short ? L.hostS * 0.5 : L.hostS * 0.55);
  const personAx = xa + (short ? 190 : 230), personAbottom = baseY + (short ? 40 : 30);
  const personBx = xb + (short ? 190 : 230), personBbottom = baseY + (short ? 40 : 30);

  const tlX0 = W * (short ? 0.30 : 0.33), tlX1 = W * (short ? 0.62 : 0.60);
  const tlY = H * 0.16;
  const tlStart = beats.delayMark - 0.35, tlEnd = bGrowStart - 0.05;

  return {
    t0: 0, t1: totalDur, world: { w: W, h: H },
    meta: { kit: 'benchmark_proof_character_driven_v4' },
    camera: [{ t: 0, x: W / 2, y: H / 2, z: 1.0 }, { t: totalDur, x: W / 2, y: H / 2, z: 1.0 }], // static -- no camera-driven clipping risk, no unnecessary movement
    draw(g, t) {
      g.fillStyle = P.canvas; g.fillRect(0, 0, W, H);
      g.save(); g.globalAlpha = 0.5; g.fillStyle = P.canvasDeep; g.fillRect(0, baseY + 20, W, H - baseY - 20); g.restore();

      // ── Person A: full color from the start, 'point' while actively investing (gesturing at their
      // own growing stack -- the action IS the explanation), 'react' once the consequence is revealed. ──
      const aPoseName = t < beats.gapReveal - 0.1 ? 'point' : 'react';
      drawPersonSprite(g, poses[aPoseName], personAx, personAbottom, personScale, 0);

      // ── object A: grows only while Person A is actively investing. ──────────────────────────────────
      const growA = tw(t, aGrowStart, growDur, ease.outCubic);
      if (growA > 0.01) { const curH = ha * growA; g.save(); groundShadow(g, xa, baseY, curH * 0.9, 0.22);
        pr.billStack(g, xa, baseY, { n: Math.max(0.02, (curH / 14)), w: stackW, ground: false }); g.restore();
        if (growA >= 0.98) objLabelAt(g, tw(t, aGrowStart + growDur, 0.5, ease.outBack), xa, labelA.y, labelA.text, { size: labelA.size, W }); }

      // ── Person B: gray and in 'think' (waiting, not yet invested) until the real delay-narration
      // instant, then transitions to full color AND 'point' at the SAME moment they begin -- the color
      // change and the pose change together ARE the "time passed, now they start" action, not a label. ──
      const bActive = tw(t, bGrowStart - 0.4, 0.5, ease.outCubic); // 0 before, 1 once truly active
      const bGray = 1 - bActive;
      const bPoseName = bActive > 0.5 ? (t < beats.gapReveal - 0.1 ? 'point' : 'react') : 'think';
      drawPersonSprite(g, poses[bPoseName], personBx, personBbottom, personScale, bGray);

      // ── "SEVEN YEARS LATER" + animated timeline (line + two labels + a travelling marker) -- the
      // understandable visual device for time passing, kept from Stage 3C's accepted engineering fix. ──
      const kSkip = tw(t, beats.delayMark - 0.2, 0.4, ease.outCubic) * (1 - tw(t, tlEnd - 0.1, 0.4, ease.inCubic));
      // y=0.10 (not the first-tried 0.06) -- found by the analytical text-geometry check that 0.06 put
      // this plate's own top 31px inside the declared safe.top boundary (70px, long format); 0.10 clears it.
      if (kSkip > 0.01) { g.save(); g.globalAlpha = kSkip; text(g, 'SEVEN YEARS LATER', W / 2, H * 0.10, { kind: 'display', weight: 800, size: short ? 32 : 36, color: P.inkMute, align: 'center', spacing: 2 }); g.restore(); }
      const kTl = tw(t, beats.delayMark - 0.3, 0.3, ease.outCubic) * (1 - tw(t, tlEnd + 0.3, 0.4, ease.inCubic));
      if (kTl > 0.01) {
        g.save(); g.globalAlpha = kTl;
        g.strokeStyle = P.inkMute; g.lineWidth = 4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(tlX0, tlY); g.lineTo(tlX1, tlY); g.stroke();
        [tlX0, tlX1].forEach((x) => { g.beginPath(); g.arc(x, tlY, 7, 0, Math.PI * 2); g.fillStyle = P.inkMute; g.fill(); });
        text(g, 'TODAY', tlX0, tlY - 22, { weight: 700, size: short ? 20 : 22, color: P.inkMute, align: 'center' });
        text(g, '7 YEARS', tlX1, tlY - 22, { weight: 700, size: short ? 20 : 22, color: P.inkMute, align: 'center' });
        const travel = tw(t, tlStart, Math.max(0.3, tlEnd - tlStart), ease.inOutCubic);
        const mx = lerp(tlX0, tlX1, travel);
        g.beginPath(); g.arc(mx, tlY, 11, 0, Math.PI * 2); g.fillStyle = P.gold; g.fill();
        g.lineWidth = 3; g.strokeStyle = P.paper; g.stroke();
        g.restore();
      }

      // ── object B: grows only once Person B is active. ────────────────────────────────────────────────
      const growB = tw(t, bGrowStart, growDur, ease.outCubic);
      if (growB > 0.01) { const curH = hb * growB; g.save(); groundShadow(g, xb, baseY, curH * 0.9, 0.22);
        pr.billStack(g, xb, baseY, { n: Math.max(0.02, (curH / 14)), w: stackW, ground: false }); g.restore();
        if (growB >= 0.98) objLabelAt(g, tw(t, bGrowStart + growDur, 0.5, ease.outBack), xb, labelB.y, labelB.text, { size: labelB.size, W }); }

      // ── the gap, revealed last. ─────────────────────────────────────────────────────────────────────
      const kG = tw(t, beats.gapReveal, 0.6, ease.outBack);
      if (kG > 0.01) objLabelAt(g, kG, labelGap.x, labelGap.y, labelGap.text, { size: labelGap.size, sub: labelGap.sub, W });
    },
    _debug: { beats, aGrowStart, bGrowStart, personAx, personAbottom, personBx, personBbottom, personScale },
  };
}

// ── Stage 3C/3D requirement: "verify all frames, not only screenshots" / "no unintended clipping".
// Computes BOTH characters' on-screen bounding boxes analytically at every sampled t, for every pose
// either one actually uses, and asserts both stay within the frame -- pure geometry, no rendering. ─────
export function verifyHostNeverClips(scene, poseSizes, fps = 30) {
  const { _debug } = scene; const { personAx, personAbottom, personBx, personBbottom, personScale, beats, bGrowStart } = _debug;
  const violations = [];
  const n = Math.round(fps * scene.t1);
  for (let i = 0; i <= n; i++) {
    const t = i / fps;
    const aPose = t < beats.gapReveal - 0.1 ? 'point' : 'react';
    const bActiveNow = tw(t, bGrowStart - 0.4, 0.5, ease.outCubic) > 0.5;
    const bPose = bActiveNow ? (t < beats.gapReveal - 0.1 ? 'point' : 'react') : 'think';
    for (const [name, x, bottom] of [['A:' + aPose, personAx, personAbottom], ['B:' + bPose, personBx, personBbottom]]) {
      const poseKey = name.split(':')[1]; const size = poseSizes[poseKey]; if (!size) continue;
      const cw = size.w * personScale, ch = size.h * personScale;
      const x0 = x - cw / 2, x1 = x + cw / 2, y0 = bottom - ch, y1 = bottom;
      if (x0 < 0 || x1 > scene.world.w || y0 < 0 || y1 > scene.world.h) violations.push({ t: +t.toFixed(3), who: name, x0, x1, y0, y1 });
    }
  }
  return { pass: violations.length === 0, checkedFrames: n + 1, violations };
}
