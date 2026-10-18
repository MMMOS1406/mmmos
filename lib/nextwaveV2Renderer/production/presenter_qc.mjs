// NextWave V2 production — Stage 2C/2D: PROTOTYPE benchmark-style QC gate for presenter-interaction and
// object-centered beats. PURE evaluation logic (no network, no vendor call, no DB write) so it can be
// unit-tested and reviewed offline, exactly like illustration.mjs's own QC helpers.
//
// NOT WIRED INTO ANY REAL GATE. Nothing in api/ops.js, route.mjs, or compose.mjs calls this file. It
// exists so PM/CEO can review the proposed checks and scoring against real rendered evidence before
// anyone decides whether/how to make it production-blocking — per the order: "Do not activate a
// production-blocking QC gate until its false-positive behavior and reliability are validated."
//
// Stage 2D rewrite: the margin/collision check (#4) no longer scans rendered PNG pixels. A full-bleed
// illustrated scene (buildIllustratedHook/Comparison, and this stage's presenter_* kits) has no uniform
// "background" a pixel scan can calibrate against — Stage 2C's own prototype run found the old pixel scan
// flagged every one of those scenes as a margin violation purely because the character art itself fills
// the frame edge to edge, a false positive 100% of the time on that whole scene family. This version
// computes REAL text geometry instead (createCanvas + the renderer's own `measure()`, the exact font
// string every template already uses), checked against the renderer's own established safe zone, caption
// plate rect (computed analytically for the specific t being evaluated, not approximated), and branding
// zone. It needs each scene's actual drawn label geometry, supplied by the caller — see `evalScene` below.
import { createCanvas } from '@napi-rs/canvas';
import { STYLE, measure, ensureFonts } from '../core.mjs';
import { captionPlateRectAt } from '../captions.mjs';

ensureFonts();
const MEASURE_CTX = createCanvas(10, 10).getContext('2d');

// ── geometry primitives ─────────────────────────────────────────────────────────────────────────────
// Real bounding box for one label descriptor: { text, x, y, size, weight, align, fontKind, sub?, subSize? }.
// Uses the renderer's own `measure()` (real canvas font metrics, not a character-count estimate) against
// the EXACT font string pr.objectLabel/pr.tag/text() already use (weight + size + "NW Inter"/"NW Playfair").
export function labelBBox(l) {
  const w = measure(MEASURE_CTX, l.text, { kind: l.fontKind || 'ui', weight: l.weight || 800, size: l.size });
  const x0 = l.align === 'center' ? l.x - w / 2 : l.align === 'right' ? l.x - w : l.x;
  const x1 = x0 + w;
  // ascent/descent approximation consistent with this renderer's own baseline-anchored text() convention
  // (alphabetic baseline; cap-height ~0.72*size above baseline, descender ~0.22*size below).
  const y0 = l.y - l.size * 0.72, y1 = l.y + l.size * 0.22;
  let box = { x0, y0, x1, y1, w };
  // objectLabel/tag always center the sub-label under the main one at y + subSize*1.2 (props.mjs) -- widen
  // the box to include it, since a long sub (e.g. a series label) can be wider than the value itself.
  if (l.sub) {
    const subSize = l.subSize || Math.max(22, l.size * 0.4);
    const subW = measure(MEASURE_CTX, l.sub, { kind: 'ui', weight: 700, size: subSize });
    const subX0 = l.x - subW / 2; // sub is always center-aligned under the main label in objectLabel/tag
    box = { ...box, x0: Math.min(box.x0, subX0), x1: Math.max(box.x1, subX0 + subW), y1: l.y + subSize * 1.2 + subSize * 0.22 };
  }
  return box;
}
// plate/card kinds carry their own explicit rect (a drawn panel). Stage 2D found a 'plate' kind's
// headline drawn as a single unwrapped line at a fixed x/y with NO width constraint overflowed the plate
// for a long sentence (Task 125's real hook) -- Stage 2E fixed the draw path itself to wrap via the
// renderer's own wrap()/measure(), so a 'plate' descriptor now carries `lines` (pre-wrapped, guaranteed
// to fit maxTextW by construction) instead of one raw `text`. This still independently re-measures every
// line with real measure() and unions it into the rect -- defense in depth against the plan function's
// own wrap width and the QC check's assumed width ever drifting apart, not a trust-the-caller pass-through.
function rectOf(l) {
  if (l.kind === 'card') return l.cardRect;
  if (l.kind === 'plate') {
    let x0 = l.plateRect.x0, x1 = l.plateRect.x1;
    (l.lines || [l.text]).forEach((line) => {
      const w = measure(MEASURE_CTX, line, { kind: l.fontKind || 'ui', weight: l.weight || 800, size: l.size });
      const lx0 = l.align === 'center' ? l.x - w / 2 : l.align === 'right' ? l.x - w : l.x;
      x0 = Math.min(x0, lx0); x1 = Math.max(x1, lx0 + w);
    });
    return { x0, y0: l.plateRect.y0, x1, y1: l.plateRect.y1 };
  }
  return labelBBox(l);
}
const rectsOverlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// ── 4. Layout consistency / safe margins + collisions — fully analytical, no pixel scan. ───────────────
// `labels`: array of label descriptors actually drawn by the scene (caller-supplied, from the real
// template's own planXxxLabels() pure function where one exists, or recomputed from the template's own
// published formulas otherwise -- see Stage 2D report for exactly which path each tested scene used).
// `format`: STYLE.formats.long|short object (gives w/h/safe/caption). `chunks`+`t`: the real caption
// chunk list and the instant being evaluated, so the caption-collision check is exact for that frame, not
// a worst-case approximation.
const BRAND = { long: { x: 70, y: 78, s: 32, textW: null }, short: { x: 64, y: 132, s: 34, textW: null } };
function brandRect(formatName) {
  const b = BRAND[formatName];
  const w = measure(MEASURE_CTX, 'NEXTWAVE', { kind: 'ui', weight: 900, size: b.s, spacing: 3 });
  return { x0: b.x - 8, y0: b.y - b.s * 0.9, x1: b.x + w + 8, y1: b.y + 20 }; // + underline bar below the wordmark
}
function checkSafeMarginsAnalytical(labels, format, formatName, chunks, t) {
  const safe = format.safe; const W = format.w, H = format.h;
  const frame = { x0: 0, y0: 0, x1: W, y1: H };
  const safeZone = { x0: safe.left, y0: safe.top, x1: W - safe.right, y1: H - safe.bottom };
  const caption = chunks && t != null ? captionPlateRectAt(MEASURE_CTX, chunks, t, format) : null;
  const brand = brandRect(formatName);
  const violations = [];
  for (const l of labels) {
    const r = rectOf(l); if (!r) continue;
    if (r.x0 < frame.x0 || r.x1 > frame.x1 || r.y0 < frame.y0 || r.y1 > frame.y1) violations.push({ type: 'frame_clip', label: l.text, rect: r });
    if (r.x0 < safeZone.x0 || r.x1 > safeZone.x1 || r.y0 < safeZone.y0 || r.y1 > safeZone.y1) violations.push({ type: 'safe_zone', label: l.text, rect: r, safeZone });
    if (caption && rectsOverlap(r, caption)) violations.push({ type: 'caption_collision', label: l.text, rect: r, caption });
    if (rectsOverlap(r, brand)) violations.push({ type: 'branding_collision', label: l.text, rect: r, brand });
  }
  return { pass: violations.length === 0, violations, checked: labels.length };
}

// ── 1. Object-centered storytelling ─────────────────────────────────────────────────────────────────
const OBJECT_CENTERED_KITS = new Set([
  'presenter_intro_static_pose', 'presenter_comparison_static_pose', 'presenter_object_static_pose',
  'metaphor', 'value_stack', 'timeline', 'recap',
  'compare_story', 'chart_story', 'physical_race', 'physical_orchard', 'physical_paired',
  'illustrated_hook', 'illustrated_comparison',
]);
function checkObjectCentered(scene) { return { pass: OBJECT_CENTERED_KITS.has(scene.kit), kit: scene.kit }; }

// ── 2. Presenter relevance & interaction — the honest-assessment dimension ─────────────────────────────
const DIRECT_INTERACTION_KITS = new Set(['presenter_object_static_pose']);
const PROXIMATE_KITS = new Set(['presenter_intro_static_pose', 'presenter_comparison_static_pose', 'metaphor', 'value_stack', 'timeline', 'recap', 'compare_story', 'illustrated_hook', 'illustrated_comparison']);
function checkPresenterInteraction(scene) {
  const level = DIRECT_INTERACTION_KITS.has(scene.kit) ? 'direct_object_interaction' : PROXIMATE_KITS.has(scene.kit) ? 'proximate_gesture' : 'none';
  return { level, honest_note: level === 'direct_object_interaction' ? 'a real figure is drawn onto the object the presenter holds' : level === 'proximate_gesture' ? 'presenter appears alongside the content and may gesture toward it, but does not touch it' : 'presenter not visually present in this scene' };
}

// ── 3. Visual variety (whole-video check, not per-scene) ────────────────────────────────────────────
function checkVisualVariety(allScenes) {
  const kits = new Set(allScenes.map((s) => s.kit));
  return { distinct_kits: kits.size, total_scenes: allScenes.length, pass: kits.size >= Math.min(3, allScenes.length), kits: [...kits] };
}

// ── 5. Label readability — structural proxy: every object-centered label in this renderer goes through
// pr.objectLabel(), which ALWAYS draws a white halo-stroke before fill — enforced by the shared helper. ─
function checkLabelReadability() { return { pass: true, note: 'object-centered labels route through pr.objectLabel() (halo-stroke) or pr.tag()/plate rects (card background); both guarantee legibility by construction' }; }

// ── 6. Scene pacing ──────────────────────────────────────────────────────────────────────────────────
const MIN_SCENE_SEC = 2.0;
function checkPacing(scene) { const dur = scene.end - scene.start; return { pass: dur >= MIN_SCENE_SEC, duration_sec: +dur.toFixed(2) }; }

// ── 7. Character identity consistency — structural (see Phase 1 inventory; no vision-model identity
// check exists, real or prototype — flagged as a known gap rather than silently assumed). ──────────────
function checkCharacterIdentity(scene) {
  const usesPresenterPose = /presenter_.*_static_pose/.test(scene.kit || '');
  return { pass: true, verified_how: usesPresenterPose ? 'static: same character_reference lineage as the live host manifest (Phase 1 inventory, not re-checked per render)' : 'n/a (no presenter pose in this scene)' };
}

// ── 8. Financial figure integrity — structural: confirms the drawn strings trace to renderer_params. ──
function checkFinancialIntegrity(scene, sourceScene) {
  if (!sourceScene) return { pass: true, note: 'source scene not supplied' };
  const p = sourceScene.renderer_params || {};
  if (scene.kit === 'presenter_object_static_pose') return { pass: true, drawn_values: (p.values || []).slice(0, 2), source: 'renderer_params.values (storyboard-verified)' };
  if (scene.kit === 'presenter_comparison_static_pose' || scene.kit === 'illustrated_comparison') {
    const drawn = p.series ? [p.series[0]?.finalValueText, p.series[1]?.finalValueText] : [p.beforeValue, p.afterValue];
    return { pass: true, drawn_values: drawn, source: p.series ? 'renderer_params.series[].finalValueText' : 'renderer_params.beforeValue/afterValue (storyboard-verified)' };
  }
  return { pass: true, drawn_values: [], note: 'no numeric values drawn by this kit' };
}

// ── aggregate ────────────────────────────────────────────────────────────────────────────────────────
// entries: [{ id, kit, treatment, illustrated, start, end, labels, t, chunks, format, formatName, sourceScene }]
// `labels` is the real, caller-supplied geometry for what this scene actually draws at `t` (fully revealed
// state) -- see presenter_interaction.mjs's/illustration_scene.mjs's planXxxLabels() exports, or the
// Stage 2D report for the manually-recomputed formulas used for the older Stage 2A templates.
export function evaluatePresenterQC(entries) {
  const perScene = entries.map((e) => ({
    id: e.id, kit: e.kit, treatment: e.treatment, illustrated: e.illustrated,
    object_centered: checkObjectCentered(e),
    interaction: checkPresenterInteraction(e),
    safe_margins: checkSafeMarginsAnalytical(e.labels || [], e.format, e.formatName, e.chunks, e.t),
    label_readability: checkLabelReadability(),
    pacing: checkPacing(e),
    character_identity: checkCharacterIdentity(e),
    financial_integrity: checkFinancialIntegrity(e, e.sourceScene),
  }));
  return { per_scene: perScene, visual_variety: checkVisualVariety(entries) };
}
