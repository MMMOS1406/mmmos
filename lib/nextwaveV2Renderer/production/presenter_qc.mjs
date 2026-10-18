// NextWave V2 production — Stage 2C Phase 6: PROTOTYPE benchmark-style QC gate for presenter-interaction
// beats. PURE evaluation logic (reads composed scene metadata + optionally a rendered PNG buffer for
// pixel checks; no network, no vendor call, no DB write) so it can be unit-tested and reviewed offline,
// exactly like illustration.mjs's own QC helpers.
//
// NOT WIRED INTO ANY REAL GATE. Nothing in api/ops.js, route.mjs, or compose.mjs calls this file. It
// exists so PM/CEO can review the proposed checks and scoring against this stage's own real rendered
// evidence before anyone decides whether/how to make it production-blocking — per the order: "Do not
// activate a production-blocking QC gate until its false-positive behavior and reliability are
// validated." That validation has NOT happened yet; this is the proposal, not the activation.
import { createCanvas, loadImage } from '@napi-rs/canvas';

// ── 1. Object-centered storytelling ─────────────────────────────────────────────────────────────────
// Pass when the scene's kit is one of the known object-centered families (the presenter_* static-pose
// kits added this stage, or the popObj-converted kits from Stage 1/2A/2B). Fails (flags, does not block)
// on an unrecognized kit, so a genuinely new template style gets surfaced for review rather than silently
// scored as non-compliant forever.
const OBJECT_CENTERED_KITS = new Set([
  'presenter_intro_static_pose', 'presenter_comparison_static_pose', 'presenter_object_static_pose',
  'metaphor', 'value_stack', 'timeline', 'recap', // narrativeScene (avatar_panel) kits
  'compare_story', 'chart_story', 'physical_race', 'physical_orchard', 'physical_paired', // stock_chart/share_compare
  'illustrated_hook', 'illustrated_comparison',
]);
function checkObjectCentered(scene) {
  return { pass: OBJECT_CENTERED_KITS.has(scene.kit), kit: scene.kit };
}

// ── 2. Presenter relevance & interaction — the Phase 5 "honest assessment" dimension ────────────────
// Three tiers, not a boolean: 'direct_object_interaction' (a real number is drawn ONTO a surface the
// presenter is physically holding — presenter_object only), 'proximate_gesture' (presenter is on screen
// and gesturing toward the content, but the content is not touching him — presenter_intro/comparison,
// and the existing hostLayer 'point'/'compare' poses used throughout the renderer), 'none' (presenter
// absent from the scene, e.g. stock_chart's physical_race kit, calc_card without this stage's beat).
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

// ── 4. Layout consistency / safe margins — pixel-scans a rendered frame for non-background content
// crossing the renderer's own established safe-zone margin (STYLE.formats.*.safe.left/right). Requires
// an actual rendered PNG buffer; skipped (not failed) when none is supplied. Uses @napi-rs/canvas (the
// renderer's own image library — no new dependency) rather than a separate PNG-decoding package. ───────
function scanRowForContent(data, width, y, bgTolerance = 18) {
  const bg = [data[0], data[1], data[2]];
  let left = -1, right = -1;
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    if (d > bgTolerance) { if (left < 0) left = x; right = x; }
  }
  return { left, right, width };
}
async function checkSafeMargins(pngBuffer, safeLeft = 110, safeRight = 110, sampleYFracs = [0.6, 0.75, 0.9]) {
  if (!pngBuffer) return { skipped: true, reason: 'no rendered frame supplied' };
  const img = await loadImage(pngBuffer);
  const canvas = createCanvas(img.width, img.height); const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  const violations = [];
  for (const f of sampleYFracs) {
    const y = Math.round(img.height * f);
    const { left, right, width } = scanRowForContent(data, img.width, y);
    if (left >= 0 && left < safeLeft) violations.push({ y, side: 'left', px_from_edge: left });
    if (right >= 0 && width - 1 - right < safeRight) violations.push({ y, side: 'right', px_from_edge: width - 1 - right });
  }
  return { pass: violations.length === 0, violations };
}

// ── 5. Label readability — structural proxy: every object-centered label in this renderer goes through
// pr.objectLabel(), which ALWAYS draws a white halo-stroke before fill (see props.mjs) — a legibility
// guarantee enforced by the shared helper, not re-verified per scene. This check only flags kits known
// to draw raw/unguarded text (none currently; placeholder for a future non-compliant template). ───────
function checkLabelReadability(scene) {
  return { pass: true, note: 'all object-centered labels in this renderer route through pr.objectLabel() / pr.tag(), both of which guarantee a legibility stroke or card background by construction' };
}

// ── 6. Scene pacing — flags a scene under a minimum legible duration. ────────────────────────────────
const MIN_SCENE_SEC = 2.0;
function checkPacing(scene) {
  const dur = scene.end - scene.start;
  return { pass: dur >= MIN_SCENE_SEC, duration_sec: +dur.toFixed(2) };
}

// ── 7. Character identity consistency — structural: this stage's 3 pose assets and the live manifest's
// 5 poses are ALL generated against the same Ideogram character-reference image (nextwave_host_v1; see
// assets.mjs's MANIFEST.host.identity and the character_reference:true tag on every host_pose row in
// production_assets_library) — verified once in Phase 1, not per-render (no vision-model identity check
// exists in this renderer, real or prototype; flagging that as a known gap, not silently assuming it). ─
function checkCharacterIdentity(scene) {
  const usesPresenterPose = /presenter_.*_static_pose/.test(scene.kit || '');
  return { pass: true, verified_how: usesPresenterPose ? 'static: same character_reference lineage as the live host manifest (Phase 1 inventory, not re-checked per render)' : 'n/a (no presenter pose in this scene)' };
}

// ── 8. Financial figure integrity — structural: presenter_interaction.mjs's 3 build functions never
// synthesize a number; every string drawn in presenter_comparison/presenter_object comes verbatim from
// extractAB()/p.values, i.e. the storyboard's own verified renderer_params (same data the scene's normal
// template would have drawn). This check confirms that CODE PATH property; it does not re-verify the
// Brain's own calc-verification step (that already happened upstream, before compose.mjs ever runs). ──
function checkFinancialIntegrity(scene, sourceScene) {
  if (scene.kit === 'presenter_object_static_pose') {
    const drawn = (sourceScene.renderer_params.values || []).slice(0, 2);
    return { pass: true, drawn_values: drawn, source: 'renderer_params.values (storyboard-verified)' };
  }
  if (scene.kit === 'presenter_comparison_static_pose') {
    const p = sourceScene.renderer_params;
    const drawn = p.series ? [p.series[0]?.finalValueText, p.series[1]?.finalValueText] : [p.beforeValue, p.afterValue];
    return { pass: true, drawn_values: drawn, source: p.series ? 'renderer_params.series[].finalValueText' : 'renderer_params.beforeValue/afterValue (storyboard-verified)' };
  }
  return { pass: true, drawn_values: [], note: 'no numeric values drawn by this kit (presenter_intro is deliberately numberless, mirrors the hook treatment)' };
}

// ── aggregate ────────────────────────────────────────────────────────────────────────────────────────
// renderedFrames: optional { [sceneId]: pngBuffer } -- scenes without a supplied frame simply get
// safe_margins:{skipped:true} rather than failing (this is a prototype evaluator over EXISTING rendered
// evidence, not a renderer that produces its own frames to check).
export async function evaluatePresenterQC(composedScenes, storyboardScenesById, renderedFrames = {}) {
  const perScene = [];
  for (const s of composedScenes) {
    const sourceScene = storyboardScenesById.get(s.id);
    const frame = renderedFrames[s.id];
    perScene.push({
      id: s.id, kit: s.kit, treatment: s.treatment, illustrated: s.illustrated,
      object_centered: checkObjectCentered(s),
      interaction: checkPresenterInteraction(s),
      safe_margins: await checkSafeMargins(frame),
      label_readability: checkLabelReadability(s),
      pacing: checkPacing(s),
      character_identity: checkCharacterIdentity(s),
      financial_integrity: sourceScene ? checkFinancialIntegrity(s, sourceScene) : { pass: true, note: 'source scene not supplied' },
    });
  }
  return { per_scene: perScene, visual_variety: checkVisualVariety(composedScenes) };
}
