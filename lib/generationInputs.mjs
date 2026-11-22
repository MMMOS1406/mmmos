// Generation-input safety switch (G0 / C4).
// Legacy "learning" inputs — decision-engine directives, auto-created optimization rules, the stored channel-strategy block and the
// retention-ranked "winning pattern" list — are ADVISORY analytics. They must never silently steer music generation.
// One constant controls it; the SERVER strips these entries from every generation request (so an old browser tab cannot re-introduce them).
// Anti-repetition memory (titles, concepts, hooks, moods, published titles, parent-theme and heat-map data) is NOT a learning input and is kept untouched.
// The check is deliberately tolerant of spelling: engine identifiers and entry labels are normalised, and entries are also recognised by their
// field SHAPE, so a different casing, a camelCase label, a `kind`/`category` key or a missing label cannot bring a learning entry back.
// PURE: no network, no database, no clock (the caller may pass `now`).
export const LEARNING_INPUTS_TO_GENERATION = false;
export const LEARNING_ENTRY_KINDS = Object.freeze(['winning_pattern', 'optimization_directive', 'active_rule', 'channel_strategy']);

// ── entry labels ──
// camelCase / kebab / spaces / upper-case → snake_case ("activeRule", "Winning-Pattern", "P C Directive" → active_rule, winning_pattern, p_c_directive)
const snake = (v) => String(v == null ? '' : v).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const LABELS = new Set(['winning_pattern', 'winning_patterns', 'winner', 'winners', 'top_performer', 'top_performers',
  'optimization_directive', 'optimization_directives', 'tuning_directive', 'tuning_directives', 'directive', 'directives',
  'active_rule', 'active_rules', 'optimization_rule', 'optimization_rules', 'applied_rule', 'applied_rules', 'rule', 'rules',
  'channel_strategy', 'strategy',
  'p_c', 'p_c_directive', 'p_i', 'p_s']);                                   // legacy client source tags (Sprint P_C / P_I / P_S)
const LABEL_KEYS = ['type', 'source', 'kind', 'entryType', 'entry_type', 'memoryType', 'memory_type'];
const has = (e, k) => Object.prototype.hasOwnProperty.call(e, k) && e[k] !== undefined && e[k] !== null;
const hasAny = (e, ks) => ks.some((k) => has(e, k));
const ACTIONS = new Set(['INCREASE', 'DECREASE', 'REDUCE', 'CONTINUE', 'PAUSE', 'SCALE', 'MAINTAIN']);
// Field shapes that only learning entries carry (anti-repetition entries never have them).
const isRuleShape = (e) => hasAny(e, ['ruleType', 'rule_type', 'ruleData', 'rule_data', 'ruleId', 'rule_id']);
const isStrategyShape = (e) => hasAny(e, ['modeWeights', 'mode_weights', 'cadencePerWeek', 'cadence_per_week', 'cadence_target_min', 'promoted_categories', 'reduced_categories', 'statusReason', 'status_reason']);
const isDirectiveShape = (e) => typeof e.action === 'string' && ACTIONS.has(e.action.toUpperCase()) && hasAny(e, ['detail', 'value']) && hasAny(e, ['priority']);
const isWinnerShape = (e) => hasAny(e, ['retention', 'retention_pct']) && hasAny(e, ['views']) && !hasAny(e, ['concept', 'hook']);
// An entry is a learning input when any label names a learning kind or its field shape is a learning shape.
export const isLearningEntry = (e) => !!e && typeof e === 'object' && !Array.isArray(e)
  && (LABEL_KEYS.some((k) => has(e, k) && LABELS.has(snake(e[k]))) || isRuleShape(e) || isStrategyShape(e) || isDirectiveShape(e) || isWinnerShape(e));
const isRuleEntry = (e) => !!e && typeof e === 'object' && (LABEL_KEYS.some((k) => has(e, k) && ['active_rule', 'active_rules', 'optimization_rule', 'optimization_rules', 'applied_rule', 'applied_rules', 'rule', 'rules', 'p_i'].includes(snake(e[k])))) || (!!e && typeof e === 'object' && isRuleShape(e));

// ── engines ──
// Only the retained music businesses are governed here; every other engine id/name is returned untouched (business isolation).
// Matching is on the normalised name, so "SRV Farsi", "srv_farsi", "SRV-FARSI " and "Srv Farsi" are the same engine (the generators' generic fallback accepts any identifier).
export const GOVERNED_ENGINES = Object.freeze(['srv_farsi', 'srv_english', 'SRV Farsi', 'SRV English']);
const GOVERNED_NORMALISED = new Set(['srvfarsi', 'srvenglish', 'srvstudio', 'silkroadvoices']);
export const isGovernedEngine = (engine) => typeof engine === 'string' && GOVERNED_NORMALISED.has(engine.toLowerCase().replace(/[^a-z0-9]/g, ''));

// Arrays are filtered; anything else (a string, undefined) is returned unchanged so existing callers keep their behaviour.
// enabled=false (the default and the only shipped setting): every learning entry is removed.
// enabled=true (a future, separately authorized change): learning entries pass, EXCEPT an expired optimization rule (G0/C2 — expiry is always effective).
export function stripLearningInputs(memory, engine, enabled = LEARNING_INPUTS_TO_GENERATION, now = Date.now()) {
  if (!Array.isArray(memory) || !isGovernedEngine(engine)) return memory;
  if (!enabled) return memory.filter((e) => !isLearningEntry(e));
  return memory.filter((e) => !(isRuleEntry(e) && e.expiresAt && Date.parse(e.expiresAt) <= now));
}
