// NextWave V2 production — storyboard -> frame function. The accepted V2 renderer entry point.
import { STYLE, P, text } from '../core.mjs';
import { drawCaptions, chunkWords } from '../captions.mjs';
import { makeSequence } from '../scenes.mjs';
import { placeScenes } from './timing.mjs';
import { globalMoneyMax, bridgeInfo } from './narrative.mjs';
import { TEMPLATES, layoutFor } from './templates.mjs';
import { deriveSceneSpec } from './scenespec.mjs';
import { buildIllustratedHook, buildIllustratedComparison } from './illustration_scene.mjs';
// Stage 2C (2026-10-17, experimental prototype branch, NOT wired into real production builds yet --
// route.mjs/api/ops.js never populate these 3 modes) -- presenter-interaction beats, same "static image +
// programmatic overlay" family as the hook/comparison illustration above, built from already-approved
// zero-cost host-pose assets instead of per-scene generated art. See presenter_interaction.mjs.
import { buildPresenterIntro, buildPresenterComparison, buildPresenterObject } from './presenter_interaction.mjs';

export const SUPPORTED_TREATMENTS = ['avatar_panel', 'money_flow', 'day_cards', 'stock_chart', 'share_compare', 'calc_card'];

// storyboard: Storyboard Brain output (must be integrity.status === 'clean'; the route enforces this, compose re-checks)
// `illustration`: optional map { [sceneIndex]: { mode: 'hook'|'comparison'|'presenter_intro'|'presenter_comparison'|
// 'presenter_object', image: loadedSprite } } for the topic-specific illustration layer (production/illustration.mjs
// decides hook/comparison; production/presenter_interaction.mjs's choosePresenterInteractionBeats decides the 3
// presenter_* modes) — this only draws what it is given; a scene whose image failed QC/generation, or whose index
// was never assigned a mode, simply falls through to its normal renderer-2.1/2.3 template unchanged.
export function composeStoryboard({ storyboard, words, assets, format, illustration = {} }) {
  if (!storyboard || !storyboard.ok) throw new Error('compose: storyboard not ok');
  if (!storyboard.integrity || storyboard.integrity.status !== 'clean') throw new Error(`compose: refuses storyboard with integrity.status=${storyboard.integrity && storyboard.integrity.status}`);
  const L = layoutFor(format); const scenes = storyboard.scenes; const spans = placeScenes(scenes, words);
  const valuesById = new Map((storyboard.values || []).map((v) => [v.id, v])); const G = { maxMoney: globalMoneyMax(storyboard) }; const derived = []; const derive = (display, formula) => derived.push({ display, formula });
  // BRIDGE PACING: a 1-3 s narrative bridge is not a scene of its own; its metaphor becomes the establishing shot of the evidence scene that follows
  const BRIDGE_MAX = 3.6; const bridges = new Map(); const skip = new Set();
  scenes.forEach((sc, i) => { const p0 = sc.renderer_params || {}; const nxt = scenes[i + 1]; if (i > 0 && i < scenes.length - 1 && p0.treatment === 'avatar_panel' && spans[i].end - spans[i].start < BRIDGE_MAX && nxt && nxt.renderer_params && nxt.renderer_params.treatment !== 'avatar_panel') { skip.add(i); bridges.set(i + 1, { index: i, start: spans[i].start, end: spans[i].end, ...bridgeInfo({ sceneInfo: sc, allScenes: scenes, index: i }) }); } });
  const built = scenes.map((sc, i) => {
    if (skip.has(i)) return null;
    const p = sc.renderer_params || {}; const tname = TEMPLATES[p.treatment] ? p.treatment : 'calc_card';
    const ctx = { L, p, span: spans[i], words, poses: assets.poses, BN: assets.bench, pattern: p.meaning_event_pattern, intent: sc.intent, sceneInfo: sc, derive, valuesById, allScenes: scenes, G, index: i, bridge: bridges.get(i) || null };
    const ill = illustration[i];
    const spec = deriveSceneSpec({ scene: sc, index: i, allScenes: scenes, format: format.h > format.w ? 'short' : 'long', valuesById });
    let scene = null; if (ill && ill.mode === 'hook') scene = buildIllustratedHook(ctx, ill.image); else if (ill && ill.mode === 'comparison') scene = buildIllustratedComparison(ctx, ill.image);
    else if (ill && ill.mode === 'presenter_intro') scene = buildPresenterIntro(ctx, ill.image);
    else if (ill && ill.mode === 'presenter_comparison') scene = buildPresenterComparison(ctx, ill.image);
    else if (ill && ill.mode === 'presenter_object') scene = buildPresenterObject(ctx, ill.image);
    const usedIllustration = !!scene; const built = scene || TEMPLATES[tname](ctx); built.t0 = i === 0 ? 0 : (ctx.bridge ? ctx.bridge.start : spans[i].start); built.t1 = spans[i].end;
    built.meta = { id: sc.scene_id, treatment: tname, intent: sc.intent, located: spans[i].located, bridged: ctx.bridge ? ctx.bridge.index : null, scene_spec: { relationship: spec.relationship, topic: spec.topic, visual_objective: spec.visual_objective }, illustrated: usedIllustration ? ill.mode : null, ...(built.meta || {}) };
    return built;
  }).filter(Boolean);
  const duration = built[built.length - 1].t1; const chunks = chunkWords(words); const seq = makeSequence({ format, scenes: built, transition: 0.6 });
  const brand = format.h > format.w ? { x: 64, y: 132, s: 34 } : { x: 70, y: 78, s: 32 };
  function draw(g, t) { seq(g, t); drawCaptions(g, chunks, t, format); text(g, 'NEXTWAVE', brand.x, brand.y, { weight: 900, size: brand.s, color: P.ink, spacing: 3, alpha: 0.9 }); g.fillStyle = P.gold; g.fillRect(brand.x, brand.y + 14, 66, 5); }
  return { draw, duration, scenes: built.map((s) => ({ ...s.meta, start: +s.t0.toFixed(2), end: +s.t1.toFixed(2) })), derived, layout: L };
}
