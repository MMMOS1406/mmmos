// NextWave V2 production — Scene Spec: a derived, non-authoritative description of what a major beat should SHOW,
// computed downstream of the frozen Brain's own verified output. Nothing here can invent a financial fact: every
// `evidence` entry is copied from storyboard.values (already verified/provenanced by the Brain); `topic`/`relationship`
// are read from the narration text and the treatment the Brain already chose. This is the intermediate layer the
// PMO order asked for between "frozen Brain" and "visual generation" — it is consumed by illustration.mjs.
import { topicOf } from './narrative.mjs';

const moneyOf = (s) => { const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(String(s || '')); return m ? Number(m[1].replace(/,/g, '')) : null; };

// relationship: the SHAPE of the financial argument in this beat, independent of which Brain treatment rendered it.
function relationshipOf(p, topic) {
  if (p.treatment === 'stock_chart' && p.markerIndex > 0) return 'delay';
  if (p.treatment === 'stock_chart') return 'accumulation';
  if (p.treatment === 'share_compare' && p.displayMode === 'chips') return 'purchasing_power';
  if (p.treatment === 'share_compare') return topic === 'loan' ? 'loan_cost' : topic === 'savings' ? 'savings_split' : topic === 'invest' ? 'fee_drag' : 'outcome_gap';
  return null; // avatar_panel / calc_card / day_cards / money_flow: not a comparison shape
}
const VISUAL_OBJECTIVE = {
  delay: 'show two lives of the same financial choice diverging because of when it started',
  accumulation: 'show money visibly growing over time toward its two different verified outcomes',
  purchasing_power: 'show the same money buying visibly less than it used to',
  loan_cost: 'show two versions of the same home financing decision costing different totals',
  savings_split: 'show two savings paths visibly diverging at different rates',
  fee_drag: 'show a fee visibly eating into the same investment story growth over time',
  outcome_gap: 'show two verified outcomes of one choice, side by side, with a visible gap between them',
  hook: 'establish the video\'s financial idea before any numbers are shown',
  close: 'land the video\'s takeaway with the strongest verified number already proven earlier',
};
const REQUIRED_SUBJECTS = { delay: 'two versions of one traveler/journey', accumulation: 'a single subject whose scale visibly grows', purchasing_power: 'the same goods/basket at two different sizes', loan_cost: 'a home and its financing', savings_split: 'two savings vessels/paths', fee_drag: 'growth being visibly reduced by a fee', outcome_gap: 'two outcomes, clearly attributable to their own label', hook: 'the video\'s topic, no numbers yet', close: 'a satisfying visual landing point' };
const ENV_HINT = { loan_cost: 'neighbourhood/home-financing', savings_split: 'financial district / bank', fee_drag: 'financial district', purchasing_power: 'everyday household', delay: 'a journey/road across time', accumulation: 'a place money grows', hook: 'establishing', close: 'establishing' };

// last sentence of the beat's narration — the closest thing to a one-line "takeaway" that is still verbatim script.
const lastSentence = (s) => { const parts = String(s).match(/[^.!?]+[.!?]+/g); return (parts ? parts[parts.length - 1] : String(s)).trim(); };

export function deriveSceneSpec({ scene, index, allScenes, format, valuesById }) {
  const p = scene.renderer_params || {}; const own = scene.narration.text; const topic = topicOf(own) || (index > 0 ? topicOf(allScenes[index - 1].narration.text) : null);
  const isFirst = index === 0, isLast = index === allScenes.length - 1;
  const rel = isFirst && p.treatment === 'avatar_panel' && /hook/.test(scene.intent) ? 'hook' : isLast && p.treatment === 'avatar_panel' ? 'close' : relationshipOf(p, topic);
  const evidence = (scene.reveal_steps || []).map((r) => valuesById.get(r.entity_id)).filter(Boolean).map((v) => ({ entity_id: v.id, display: v.display, value: v.value, kind: v.kind, role: v.role }));
  // two-outcome comparisons: name each side from the Brain's own labels only (never invented)
  let names = null;
  if (p.series && p.series.length === 2) names = [p.series[0].label, p.series[1].label];
  else if (p.beforeLabel && p.afterLabel) names = [p.beforeLabel, p.afterLabel];
  return {
    id: scene.scene_id, format, topic, relationship: rel,
    takeaway: lastSentence(own),
    evidence, names,
    visual_objective: VISUAL_OBJECTIVE[rel] || 'illustrate this beat\'s financial idea without contradicting any verified number',
    required_subjects: REQUIRED_SUBJECTS[rel] || null,
    environment_hint: ENV_HINT[rel] || topic || 'studio',
    composition: format === 'short' ? 'vertical-dominant' : (rel === 'hook' || rel === 'close' ? 'wide-establishing' : 'wide-progressive'),
    camera_intent: rel === 'hook' ? ['establish', 'slow-push'] : rel === 'close' ? ['hold', 'settle'] : ['establish', 'reveal-first', 'reveal-second', 'reveal-gap', 'widen'],
    overlays: evidence.map((e) => e.display).concat(names ? [`gap: ${names.join(' vs ')}`] : []),
    treatment: p.treatment, intent: scene.intent, is_hook: rel === 'hook', is_close: rel === 'close',
  };
}
