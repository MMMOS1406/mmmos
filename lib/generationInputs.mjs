// Generation-input safety switch (G0 / C4).
// Legacy "learning" inputs — decision-engine directives, auto-created optimization rules, the stored channel-strategy block and the
// retention-ranked "winning pattern" list — are ADVISORY analytics. They must never silently steer music generation.
// One constant controls it; the SERVER strips these entries from every generation request (so an old browser tab cannot re-introduce them).
// Anti-repetition memory (titles, concepts, hooks, moods, published titles, parent-theme and heat-map data) is NOT a learning input and is kept untouched.
// PURE: no network, no database, no clock.
export const LEARNING_INPUTS_TO_GENERATION = false;
// Client memory entries use `type` (ops.js generate_package) or `source` (api/generate.js recentPackages); both spellings are covered.
export const LEARNING_ENTRY_KINDS = Object.freeze(['winning_pattern', 'optimization_directive', 'active_rule', 'channel_strategy']);
const KINDS = new Set(LEARNING_ENTRY_KINDS);
// An entry is a learning input when its type or its source names one of the kinds.
export const isLearningEntry = (e) => !!e && typeof e === 'object' && (KINDS.has(e.type) || KINDS.has(e.source));
// Only the two retained music businesses are governed here; every other engine id/name is returned untouched (business isolation).
export const GOVERNED_ENGINES = Object.freeze(['srv_farsi', 'srv_english', 'SRV Farsi', 'SRV English']);
// Arrays are filtered; anything else (a string, undefined) is returned unchanged so existing callers keep their behaviour.
// enabled=false (the default and the only shipped setting): every learning entry is removed.
// enabled=true (a future, separately authorized change): learning entries pass, EXCEPT an expired optimization rule (G0/C2 — expiry is always effective).
export function stripLearningInputs(memory, engine, enabled = LEARNING_INPUTS_TO_GENERATION, now = Date.now()) {
  if (!Array.isArray(memory) || !GOVERNED_ENGINES.includes(engine)) return memory;
  if (!enabled) return memory.filter((e) => !isLearningEntry(e));
  return memory.filter((e) => !(e && (e.type === 'active_rule' || e.source === 'active_rule') && e.expiresAt && Date.parse(e.expiresAt) <= now));
}
