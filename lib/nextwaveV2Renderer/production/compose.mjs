// NextWave V2 production — storyboard -> frame function. The accepted V2 renderer entry point.
import { STYLE, P, text } from '../core.mjs';
import { drawCaptions, chunkWords } from '../captions.mjs';
import { makeSequence } from '../scenes.mjs';
import { placeScenes } from './timing.mjs';
import { globalMoneyMax } from './narrative.mjs';
import { TEMPLATES, layoutFor } from './templates.mjs';

export const SUPPORTED_TREATMENTS = ['avatar_panel', 'money_flow', 'day_cards', 'stock_chart', 'share_compare', 'calc_card'];

// storyboard: Storyboard Brain output (must be integrity.status === 'clean'; the route enforces this, compose re-checks)
export function composeStoryboard({ storyboard, words, assets, format }) {
  if (!storyboard || !storyboard.ok) throw new Error('compose: storyboard not ok');
  if (!storyboard.integrity || storyboard.integrity.status !== 'clean') throw new Error(`compose: refuses storyboard with integrity.status=${storyboard.integrity && storyboard.integrity.status}`);
  const L = layoutFor(format); const scenes = storyboard.scenes; const spans = placeScenes(scenes, words);
  const valuesById = new Map((storyboard.values || []).map((v) => [v.id, v])); const G = { maxMoney: globalMoneyMax(storyboard) }; const derived = []; const derive = (display, formula) => derived.push({ display, formula });
  const built = scenes.map((sc, i) => {
    const p = sc.renderer_params || {}; const tname = TEMPLATES[p.treatment] ? p.treatment : 'calc_card';
    const ctx = { L, p, span: spans[i], words, poses: assets.poses, BN: assets.bench, pattern: p.meaning_event_pattern, intent: sc.intent, sceneInfo: sc, derive, valuesById, allScenes: scenes, G, index: i };
    const scene = TEMPLATES[tname](ctx); scene.t0 = i === 0 ? 0 : spans[i].start; scene.t1 = spans[i].end; scene.meta = { id: sc.scene_id, treatment: tname, intent: sc.intent, located: spans[i].located, ...(scene.meta || {}) };
    return scene;
  });
  const duration = built[built.length - 1].t1; const chunks = chunkWords(words); const seq = makeSequence({ format, scenes: built, transition: 0.6 });
  const brand = format.h > format.w ? { x: 64, y: 132, s: 34 } : { x: 70, y: 78, s: 32 };
  function draw(g, t) { seq(g, t); drawCaptions(g, chunks, t, format); text(g, 'NEXTWAVE', brand.x, brand.y, { weight: 900, size: brand.s, color: P.ink, spacing: 3, alpha: 0.9 }); g.fillStyle = P.gold; g.fillRect(brand.x, brand.y + 14, 66, 5); }
  return { draw, duration, scenes: built.map((s) => ({ ...s.meta, start: +s.t0.toFixed(2), end: +s.t1.toFixed(2) })), derived, layout: L };
}
