// NextWave V2 production — Stage 2C experimental integration: presenter-interaction beats built from
// already-approved, zero-marginal-cost host-pose assets (production_assets_library, asset_type=host_pose,
// role in {presenting_pointing, holding_calculation, reaction_outro}, generated 2026-09-17, $0.30 total
// historical spend, re-verified reusable 2026-10-17 — no new Ideogram call made or needed to ship this).
//
// Same technique as illustration_scene.mjs's hook/comparison beats: one static image, a Ken-Burns camera
// pan/zoom, and every number/label drawn programmatically on top from the scene's own verified storyboard
// data. This is NOT character animation — the presenter does not move, gesture, or blink in real time;
// only the camera moves over a single still frame. Do not describe or market it as animation.
//
// NOT a cutout/sprite composite into the bottom-anchored hostLayer system either: Stage 2B attempted a
// flood-fill alpha matte on these exact 3 pose PNGs and it failed — their generated navy background is too
// close in color to the character's own navy blazer, so background removal strips the blazer along with
// the backdrop. A clean cutout would need either new paid AI background removal or regenerating the poses
// on a different backdrop; both are out of scope for this bounded prototype. Full-frame is the only
// currently-supported way to use these assets without faking the interaction.
import { P, tw, ease, text, rr } from '../core.mjs';
import * as pr from '../props.mjs';
import { loadSprite } from '../core.mjs';
import { join } from 'node:path';
import { drawCover, camAt, extractAB, valueTime } from './illustration_scene.mjs';
import { eventTime } from './timing.mjs';

const PRESENTER_FILES = {
  presenting_pointing: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'presenter', 'presenting_pointing.png'),
  holding_calculation: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'presenter', 'holding_calculation.png'),
  reaction_outro: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'presenter', 'reaction_outro.png'),
};

// Safe-fallback loader: a missing/corrupt bundled file degrades only THAT role to unavailable (the
// selector below then skips the matching mode entirely) rather than throwing and failing the render.
export async function loadPresenterPoseAssets() {
  const out = {};
  for (const [role, path] of Object.entries(PRESENTER_FILES)) {
    try { out[role] = await loadSprite(path); } catch { out[role] = null; }
  }
  return out;
}

// ── selection ────────────────────────────────────────────────────────────────────────────────────────
// Picks at most one scene per mode. Deliberately composes WITH the existing, PMO-bounded illustrated-beat
// system (illustration.mjs's chooseIllustratedBeats caps a video at 2 generated beats) instead of
// competing with it: `reserved` is the set of scene indices that system already claimed (hook/dominant
// comparison), and this selector never reuses one of them. A mode is only chosen when its pose asset
// actually loaded (`available`) and a scene with the right shape of real data exists — otherwise that
// mode is left at -1 and its scene falls through to its normal existing renderer-2.1/2.3 template
// unchanged. This is the full "safe fallback" behavior the order requires, not a partial version of it.
//
// `spans` (from timing.mjs's placeScenes(scenes, words), the SAME call compose.mjs itself makes) is
// required to pick a safe avatar_panel candidate for 'presenter_intro': compose.mjs silently folds any
// avatar_panel scene under 3.6s between two non-avatar_panel neighbours into the FOLLOWING scene's
// establishing shot (BRIDGE_MAX bridge-pacing) and never calls its own illustration dispatch at all --
// confirmed empirically in Stage 2C's end-to-end validation, where an index chosen without this check
// silently vanished from compose.mjs's output. Replicates that exact eligibility rule rather than
// guessing a safe margin, so this selector never again picks a scene compose.mjs is going to skip.
const BRIDGE_MAX = 3.6;
function isBridgeEligible(scenes, spans, i) {
  const p0 = scenes[i].renderer_params || {}; const nxt = scenes[i + 1];
  return i > 0 && i < scenes.length - 1 && p0.treatment === 'avatar_panel'
    && spans[i].end - spans[i].start < BRIDGE_MAX && nxt && nxt.renderer_params && nxt.renderer_params.treatment !== 'avatar_panel';
}
export function choosePresenterInteractionBeats(scenes, spans, reserved, available) {
  const out = { introIdx: -1, comparisonIdx: -1, objectIdx: -1 };
  if (!scenes || !scenes.length) return out;
  const free = (i) => i > 0 && i < scenes.length - 1 && !reserved.has(i);
  if (available.presenting_pointing) {
    const idx = scenes.findIndex((s, i) => free(i) && s.renderer_params?.treatment === 'avatar_panel' && !isBridgeEligible(scenes, spans, i));
    if (idx >= 0) out.introIdx = idx;
  }
  if (available.presenting_pointing) {
    const idx = scenes.findIndex((s, i) => free(i) && i !== out.introIdx
      && ['stock_chart', 'share_compare'].includes(s.renderer_params?.treatment)
      && extractAB(s.renderer_params || {}));
    if (idx >= 0) out.comparisonIdx = idx;
  }
  if (available.holding_calculation) {
    const idx = scenes.findIndex((s, i) => free(i) && i !== out.introIdx && i !== out.comparisonIdx
      && s.renderer_params?.treatment === 'calc_card'
      && (s.renderer_params.values || []).length > 0);
    if (idx >= 0) out.objectIdx = idx;
  }
  return out;
}

// clamp an object-centered label's x so its estimated box never crosses the safe-zone margin -- same
// 110px convention as templates.mjs's popObj (Stage 2B Phase 3 fix), so these new beats inherit the same
// readability guarantee rather than a second, possibly-inconsistent one.
const estW = (str, size) => String(str).length * size * 0.62;
function labelAt(g, k, x, y, str, { size = 50, sub = '', W } = {}) {
  if (k <= 0.01) return;
  if (W) { const half = estW(str, size) / 2 + 110; x = Math.max(half, Math.min(W - half, x)); }
  g.save(); g.globalAlpha = Math.min(1, k * 1.4); g.translate(x, y + (1 - k) * 14); g.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
  pr.objectLabel(g, 0, 0, str, { size, sub });
  g.restore();
}

// ── label geometry (pure, no drawing) -- Stage 2D: single source of truth shared by draw() below AND
// presenter_qc.mjs's analytical safe-margin/collision checker. Top-positioned, matching
// buildIllustratedHook's own plate convention exactly -- compose.mjs draws live captions on every scene
// centered at STYLE.formats.*.caption.y (long: 900, short: 1350); a bottom plate collided with them
// (found + fixed in Stage 2C's own e2e validation render). Top is the renderer's established safe zone.
export function planPresenterIntroLabels(ctx) {
  const { L, p } = ctx; const short = L.short;
  const lines = String(p.text || '').match(/[^.!?]+[.!?]+/g) || [p.text || '']; const first = lines[0].trim();
  // x0=110 (long) matches STYLE.formats.long.safe.left exactly -- same fix as planHookLabels, found by
  // Stage 2D's new analytical safe-margin check (the old pixel-scan approach never caught this).
  const plateW = short ? 900 : 1000, x0 = short ? 90 : 110, y0 = short ? 200 : 170, ph = short ? 190 : 150;
  return [{ kind: 'plate', text: first, x: x0 + 30, y: y0 + ph * 0.56, size: short ? 40 : 44, weight: 800, align: 'left', fontKind: 'display', plateRect: { x0, y0, x1: x0 + plateW, y1: y0 + ph } }];
}

// ── 1. presenter introducing a concept: presenting_pointing, headline plate (no numbers -- mirrors the
// existing hook treatment's own "no numbers yet" rule), text taken from the scene's own narration ──────
export function buildPresenterIntro(ctx, img) {
  const { L, span } = ctx; const { W, H } = L;
  const camKeys = [{ t: span.start, x: 0.5, y: 0.38, z: 1.0 }, { t: span.end, x: 0.5, y: 0.3, z: 1.06 }];
  const [plan] = planPresenterIntroLabels(ctx);
  return {
    t0: span.start, t1: span.end, world: { w: W, h: H },
    meta: { kit: 'presenter_intro_static_pose', env: 'generated' },
    camera: [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2, y: H / 2, z: 1.0 }],
    draw(g, t) {
      const c = camAt(camKeys, t); drawCover(g, img, W, H, c);
      g.fillStyle = 'rgba(20,16,10,0.12)'; g.fillRect(0, 0, W, H);
      const k = tw(t, span.start + 0.25, 0.7); if (k > 0.01) {
        const { x0, y0, x1, y1 } = plan.plateRect;
        g.save(); g.globalAlpha = k; g.fillStyle = 'rgba(255,253,248,0.94)'; rr(g, x0, y0, x1 - x0, y1 - y0, 24); g.fill();
        text(g, plan.text, plan.x, plan.y, { kind: plan.fontKind, weight: plan.weight, size: plan.size, color: P.ink });
        g.restore();
      }
    },
  };
}

// ── label geometry (pure, no drawing) -- Stage 2D. Anchors measured directly off the presenting_pointing
// art (where the pointing hand already sits), unchanged from Stage 2C. ───────────────────────────────────
const PRESENTER_COMPARISON_ANCHORS = { short: { a: [0.52, 0.30], b: [0.52, 0.46] }, long: { a: [0.77, 0.306], b: [0.77, 0.574] } };
export function planPresenterComparisonLabels(ctx) {
  const { L, p } = ctx; const { W, H } = L; const short = L.short;
  const AB = extractAB(p); if (!AB) return [];
  const anchors = short ? PRESENTER_COMPARISON_ANCHORS.short : PRESENTER_COMPARISON_ANCHORS.long;
  return [
    { kind: 'objectLabel', text: AB.aTxt, sub: AB.names[0], x: anchors.a[0] * W, y: anchors.a[1] * H, size: short ? 44 : 50, weight: 800, align: 'center', fontKind: 'ui' },
    { kind: 'objectLabel', text: AB.bTxt, sub: AB.names[1], x: anchors.b[0] * W, y: anchors.b[1] * H, size: short ? 44 : 50, weight: 800, align: 'center', fontKind: 'ui' },
  ];
}

// ── 2. presenter pointing at a comparison: presenting_pointing, two real object-centered values anchored
// where the hand already points in the source art (measured directly off the asset, not guessed) ──────
export function buildPresenterComparison(ctx, img) {
  const { L, p, span, words } = ctx; const { W, H } = L; const short = L.short;
  const AB = extractAB(p); if (!AB) return null;
  const tAr = valueTime(ctx, AB.aTxt, span.start + 1.6); const tBr = valueTime(ctx, AB.bTxt, span.start + 2.8);
  const anchors = short ? PRESENTER_COMPARISON_ANCHORS.short : PRESENTER_COMPARISON_ANCHORS.long;
  const camKeys = [{ t: span.start, x: 0.5, y: 0.45, z: 1.0 }, { t: Math.min(tAr, tBr) - 0.3, x: anchors.a[0] - 0.08, y: 0.42, z: 1.04 }, { t: span.end, x: 0.55, y: 0.45, z: 1.05 }].filter((k2, i, a) => !i || k2.t > a[i - 1].t + 0.05);
  const plan = planPresenterComparisonLabels(ctx);
  return {
    t0: span.start, t1: span.end, world: { w: W, h: H },
    meta: { kit: 'presenter_comparison_static_pose', env: 'generated' },
    camera: [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2, y: H / 2, z: 1.0 }],
    draw(g, t) {
      const c = camAt(camKeys, t); drawCover(g, img, W, H, c);
      g.fillStyle = 'rgba(20,16,10,0.12)'; g.fillRect(0, 0, W, H);
      labelAt(g, tw(t, tAr, 0.5, ease.outBack), plan[0].x, plan[0].y, plan[0].text, { size: plan[0].size, sub: plan[0].sub, W });
      labelAt(g, tw(t, tBr, 0.5, ease.outBack), plan[1].x, plan[1].y, plan[1].text, { size: plan[1].size, sub: plan[1].sub, W });
    },
  };
}

// ── label geometry (pure, no drawing) -- Stage 2D. Reproduces the exact static-camera notepad transform
// (x=0.5,y=0.5,z=1.0, fixed -- see buildPresenterObject) so the reported positions are the TRUE rendered
// ones, not an approximation. notepad rect measured off the 1024x1024 source via connected-component
// color match: (362,509)-(686,897). ─────────────────────────────────────────────────────────────────────
export function planPresenterObjectLabels(ctx, img) {
  const { L, p } = ctx; const { W, H } = L; const short = L.short;
  const vals = (p.values || []).slice(0, 2); if (!vals.length) return [];
  const iw = img.width, ih = img.height;
  const scale = Math.max(W / iw, H / ih) * 1.0; const dw = iw * scale, dh = ih * scale;
  const ox = W / 2 - 0.5 * dw, oy = H / 2 - 0.5 * dh;
  const toFrame = (x, y) => [ox + x * scale, oy + y * scale];
  const [nx0, ny0] = toFrame(362, 509); const [nx1] = toFrame(686, 897);
  const cx = (nx0 + nx1) / 2;
  const out = [{ kind: 'text', text: vals.length > 1 ? 'THE EVIDENCE' : 'THE NUMBER', x: cx, y: ny0 + 64, size: short ? 26 : 30, weight: 800, align: 'center', fontKind: 'ui' }];
  let yy = ny0 + 64 + (short ? 66 : 84);
  for (const v of vals) { out.push({ kind: 'text', text: v, x: cx, y: yy, size: short ? 42 : 46, weight: 800, align: 'center', fontKind: 'display' }); yy += short ? 58 : 66; }
  return out;
}

// ── 3. presenter interacting with an object: holding_calculation, the scene's own real value(s) written
// directly onto the blank notepad already in his hands -- the genuine, non-faked interaction case ──────
export function buildPresenterObject(ctx, img) {
  const { L, p, span } = ctx; const { W, H } = L;
  const vals = (p.values || []).slice(0, 2); if (!vals.length) return null;
  // Static, centered framing (no zoom/pan drift) -- an earlier animated version cropped the top of the
  // presenter's head (found in this stage's own real end-to-end render, not guessed). At y=0.5/z=1.0 the
  // notepad's text region (computed below) sits well above STYLE.formats.long.caption.y=900, the live
  // caption overlay compose.mjs draws on every scene -- verified by rendering, not assumed.
  const camKeys = [{ t: span.start, x: 0.5, y: 0.5, z: 1.0 }, { t: span.end, x: 0.5, y: 0.5, z: 1.0 }];
  const plan = planPresenterObjectLabels(ctx, img);
  return {
    t0: span.start, t1: span.end, world: { w: W, h: H },
    meta: { kit: 'presenter_object_static_pose', env: 'generated' },
    camera: [{ t: span.start, x: W / 2, y: H / 2, z: 1.0 }, { t: span.end, x: W / 2, y: H / 2, z: 1.0 }],
    draw(g, t) {
      const c = camAt(camKeys, t); drawCover(g, img, W, H, c);
      g.fillStyle = 'rgba(20,16,10,0.10)'; g.fillRect(0, 0, W, H);
      const ev = eventTime(ctx.words, span, ctx.pattern, 0.3).t; const k = tw(t, ev - 0.2, 0.7, ease.outCubic);
      if (k > 0.01) {
        g.save(); g.globalAlpha = k;
        for (const l of plan) text(g, l.text, l.x, l.y, { kind: l.fontKind, weight: l.weight, size: l.size, color: l.fontKind === 'display' ? P.ink : P.inkMute, align: l.align });
        g.restore();
      }
    },
  };
}
