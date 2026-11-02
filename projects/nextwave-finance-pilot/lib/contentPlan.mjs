// NextWave Finance Pilot — L3 content planning (Order 051). Pure logic: no network, no AI, no media,
// no publishing. Plans are deterministic templates the CEO edits; nothing here generates or uploads anything.
//
// Storage (server only): ONE app_settings row, PLANS_KEY, under the pilot prefix that the applied write-lock
// (migration 20261102034457) already protects from the public key. Saving is refused unless the separate
// mmm_platform_flags row PLAN_WRITES_FLAG is on (missing = OFF). Drafting and quality evaluation store nothing.

export const PILOT_KEY = 'nextwave_finance_pilot';
export const PLANS_KEY = 'nextwave_finance_pilot_content_plans';
export const PLAN_WRITES_FLAG = 'nwfp_plan_writes';
export const SCHEMA_VERSION = 1;
export const MAX_PLANS = 50;

// Proposed brand profile (stand-in until Creative Quality signs it off). Plain, calm, educational.
export const BRAND = Object.freeze({
  name: 'NextWave Finance Pilot',
  voice: 'calm, plain-language, educational; no hype, no promises',
  audience_default: 'adults getting their everyday money organized',
  palette: ['deep navy', 'teal', 'warm white'],
  motifs: ['labelled jars and envelopes', 'calendar and pay-day timelines', 'simple step diagrams', 'before/after budget sheets'],
});

export const TOPIC_CATEGORIES = Object.freeze({
  budgeting: 'Budgeting', saving: 'Saving', emergency_fund: 'Emergency fund', debt: 'Debt payoff', credit: 'Credit scores and reports',
  investing_basics: 'Investing basics', retirement: 'Retirement accounts', taxes: 'Taxes', insurance: 'Insurance', inflation: 'Inflation', banking: 'Banking and fees',
});
export const AUDIENCE_LEVELS = Object.freeze(['beginner', 'intermediate']);
export const REVIEW_STATUSES = Object.freeze(['draft', 'ready_for_review', 'changes_requested', 'accepted_for_planning']);
const TRANSITIONS = { draft: ['ready_for_review'], ready_for_review: ['changes_requested', 'accepted_for_planning'], changes_requested: ['ready_for_review'], accepted_for_planning: [] };
export const SCRIPT_PARTS = Object.freeze(['hook', 'context', 'core_idea', 'worked_example', 'common_mistakes', 'action_steps', 'recap', 'disclaimer']);

// Responsible-framing rules (Creative Quality + compliance). Any match fails the plan.
export const PROHIBITED_CLAIMS = Object.freeze([
  [/guarantee[ds]?\s+(returns?|profits?|income|gains?)/i, 'promises guaranteed returns'],
  [/risk[\s-]?free/i, 'calls something risk-free'],
  [/get\s+rich\s+quick|rich\s+overnight|millionaire\s+overnight/i, 'get-rich-quick framing'],
  [/can'?t\s+lose|never\s+lose\s+money/i, 'claims you cannot lose'],
  [/double\s+your\s+money/i, 'promises to double money'],
  [/you\s+should\s+(buy|sell|invest\s+in)\b/i, 'personal buy/sell instruction'],
  [/\$[A-Z]{1,5}\b/, 'names a ticker'],
  [/secret\s+(trick|hack)|banks\s+don'?t\s+want\s+you/i, 'clickbait secret-trick framing'],
  [/\b(insane|crazy|shocking)\b/i, 'hype wording off-brand'],
]);
// Generic AI/tech content is a different business; the pilot must stay finance education.
const AI_TECH = /\b(ai|a\.i\.|artificial intelligence|chatgpt|gpt|llm|robots?|gadgets?|smartphones?|tech news|crypto mining|nft)\b/i;

const ALLOWED_FIELDS = new Set(['id', 'title', 'topic_category', 'audience', 'learning_objective', 'long_form', 'short_form', 'script_structure', 'visual_direction', 'compliance', 'originality', 'review_status', 'created_at', 'updated_at', 'revision']);
const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const strList = (a, min, max, len) => Array.isArray(a) && a.length >= min && a.length <= max && a.every(x => str(x, 1, len));

// A deterministic starting skeleton. Every text field is meant to be rewritten by the CEO/creative team.
export function draftPlan({ title, topic_category, audience_level = 'beginner' } = {}, { now, idSeed } = {}) {
  const cat = TOPIC_CATEGORIES[topic_category] ? topic_category : 'budgeting';
  const label = TOPIC_CATEGORIES[cat];
  const t = str(title, 4, 120) ? title.trim() : `${label}: a plain-language guide`;
  return {
    id: `plan_${String(idSeed || Date.now()).replace(/[^0-9a-z]/gi, '').slice(-12)}`,
    title: t, topic_category: cat,
    audience: { segment: BRAND.audience_default, level: AUDIENCE_LEVELS.includes(audience_level) ? audience_level : 'beginner' },
    learning_objective: `After watching, the viewer can explain ${label.toLowerCase()} in their own words and take one concrete first step.`,
    long_form: {
      target_minutes: 10,
      outline: [
        { section: 'Hook', key_points: [`A relatable moment where ${label.toLowerCase()} matters`] },
        { section: 'Why it matters', key_points: ['What goes wrong without it', 'Who this is for'] },
        { section: 'Core idea', key_points: ['The one idea to remember', 'A simple rule of thumb, stated as a guideline'] },
        { section: 'Worked example', key_points: ['Round, illustrative numbers (not a recommendation)'] },
        { section: 'Common mistakes', key_points: ['Two mistakes and how to avoid them'] },
        { section: 'Action steps', key_points: ['Step 1', 'Step 2', 'Step 3'] },
        { section: 'Recap', key_points: ['Three-sentence summary'] },
      ],
    },
    short_form: { concept: `One takeaway from "${t}" in under a minute`, hook: 'A single question the viewer recognises', duration_s: 45, links_to_long: true },
    script_structure: SCRIPT_PARTS.map(part => ({ part, notes: part === 'disclaimer' ? 'Educational only, not personal financial advice.' : 'To be written' })),
    visual_direction: { style: 'clean, calm motion graphics', palette: [...BRAND.palette], motifs: BRAND.motifs.slice(0, 2), data_visuals: ['one simple chart of the worked example'] },
    compliance: { educational_disclaimer: true, sources: [], claims_checked: false },
    originality: { original_concept: false, notes: '' },
    review_status: 'draft',
    created_at: now || new Date().toISOString(), updated_at: now || new Date().toISOString(), revision: 0,
  };
}

// Structure check. Never accepts generation, publishing or foreign fields.
export function validatePlan(p) {
  const e = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, errors: ['plan must be an object'] };
  for (const k of Object.keys(p)) if (!ALLOWED_FIELDS.has(k)) e.push(`field not allowed: ${k}`);
  if (!/^plan_[0-9a-z]{1,12}$/i.test(String(p.id || ''))) e.push('id must look like plan_<letters/digits>');
  if (!str(p.title, 4, 120)) e.push('title: 4-120 characters');
  if (!TOPIC_CATEGORIES[p.topic_category]) e.push('topic_category must be one of ' + Object.keys(TOPIC_CATEGORIES).join(', '));
  if (!p.audience || !str(p.audience.segment, 3, 200) || !AUDIENCE_LEVELS.includes(p.audience.level)) e.push('audience: segment and level (beginner|intermediate)');
  if (!str(p.learning_objective, 10, 400)) e.push('learning_objective: 10-400 characters');
  const lf = p.long_form;
  if (!lf || !Number.isInteger(lf.target_minutes) || lf.target_minutes < 6 || lf.target_minutes > 20 || !Array.isArray(lf.outline) || lf.outline.length < 3 || lf.outline.length > 12 ||
    lf.outline.some(s => !s || !str(s.section, 2, 80) || !strList(s.key_points, 1, 8, 300))) e.push('long_form: 6-20 minutes and 3-12 outline sections with key points');
  const sf = p.short_form;
  if (!sf || !str(sf.concept, 10, 300) || !str(sf.hook, 5, 200) || !Number.isInteger(sf.duration_s) || sf.duration_s < 15 || sf.duration_s > 60 || typeof sf.links_to_long !== 'boolean') e.push('short_form: concept, hook, 15-60 s, links_to_long');
  if (!Array.isArray(p.script_structure) || p.script_structure.length < 4 || p.script_structure.some(x => !x || !SCRIPT_PARTS.includes(x.part) || !str(x.notes, 1, 600))) e.push('script_structure: parts from ' + SCRIPT_PARTS.join(', '));
  const v = p.visual_direction;
  if (!v || !str(v.style, 3, 200) || !strList(v.palette, 1, 6, 40) || !strList(v.motifs, 0, 8, 120) || !strList(v.data_visuals, 0, 6, 200)) e.push('visual_direction: style, palette, motifs, data_visuals');
  const c = p.compliance;
  if (!c || typeof c.educational_disclaimer !== 'boolean' || !strList(c.sources, 0, 10, 300) || typeof c.claims_checked !== 'boolean') e.push('compliance: educational_disclaimer, sources, claims_checked');
  if (!p.originality || typeof p.originality.original_concept !== 'boolean' || typeof (p.originality.notes ?? '') !== 'string' || String(p.originality.notes || '').length > 500) e.push('originality: original_concept, notes');
  if (!REVIEW_STATUSES.includes(p.review_status)) e.push('review_status must be one of ' + REVIEW_STATUSES.join(', '));
  return { ok: e.length === 0, errors: e };
}

const allText = (p) => [p.title, p.learning_objective, ...(p.long_form?.outline || []).flatMap(s => [s.section, ...(s.key_points || [])]),
  p.short_form?.concept, p.short_form?.hook, ...(p.script_structure || []).map(x => x.notes)].filter(Boolean).join('\n');
const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z]{5,}/g) || []);

// Creative Quality checklist. Deterministic; every item explains itself. ready = all pass.
export function evaluateQuality(p) {
  const v = validatePlan(p);
  const text = allText(p || {});
  const claims = PROHIBITED_CLAIMS.filter(([re]) => re.test(text)).map(([, why]) => why);
  const steps = (p?.long_form?.outline || []).find(s => /action/i.test(s.section))?.key_points || [];
  const objWords = words(`${p?.title} ${p?.learning_objective}`), shortWords = words(`${p?.short_form?.concept} ${p?.short_form?.hook}`);
  const shared = [...shortWords].filter(w => objWords.has(w));
  const items = [
    ['structure', 'Plan structure is complete and valid', v.ok, v.errors.join('; ')],
    ['topic_relevance', 'Topic is a finance-education category', !!TOPIC_CATEGORIES[p?.topic_category], p?.topic_category || 'missing'],
    ['responsible_framing', 'No prohibited claims (guarantees, risk-free, tickers, buy/sell instructions, hype)', claims.length === 0, claims.join(', ')],
    ['financial_accuracy', 'Educational disclaimer on, at least one source, claims checked by a person', !!(p?.compliance?.educational_disclaimer && (p.compliance.sources || []).length >= 1 && p.compliance.claims_checked), `sources ${(p?.compliance?.sources || []).length}, claims_checked ${!!p?.compliance?.claims_checked}`],
    ['audience_usefulness', 'Clear audience and objective, at least 3 concrete action steps', !!(p?.audience?.segment && str(p?.learning_objective, 10, 400) && steps.filter(s => !/^step \d$/i.test(s.trim())).length >= 3), `${steps.length} action steps`],
    ['originality', 'Original concept confirmed by the author (no copied scripts, visuals or branding)', !!(p?.originality?.original_concept && str(p.originality.notes, 10, 500)), p?.originality?.original_concept ? '' : 'not confirmed'],
    ['long_short_relationship', 'Short links to the long video and shares its key idea', !!(p?.short_form?.links_to_long && shared.length >= 1), `shared words: ${shared.slice(0, 5).join(', ') || 'none'}`],
    ['visual_storytelling', 'At least 2 visual motifs and 1 data visual', (p?.visual_direction?.motifs || []).length >= 2 && (p?.visual_direction?.data_visuals || []).length >= 1, ''],
    ['brand_consistency', 'Uses the brand palette and has a disclaimer part in the script', (p?.visual_direction?.palette || []).some(c => BRAND.palette.includes(c)) && (p?.script_structure || []).some(x => x.part === 'disclaimer'), ''],
    ['distinct_from_ai_tech', 'Not generic AI/tech content', !AI_TECH.test(`${p?.title} ${p?.learning_objective} ${p?.short_form?.concept}`), ''],
  ].map(([id, label, pass, detail]) => ({ id, label, pass: !!pass, detail: pass ? '' : String(detail || '') }));
  return { ready: items.every(i => i.pass), items };
}

// Review status changes. Moving to ready_for_review requires every checklist item to pass.
// accepted_for_planning only records the decision; it never triggers generation, media or publishing.
export function applyReview(plan, to) {
  if (!REVIEW_STATUSES.includes(to)) return { ok: false, error: 'invalid_status' };
  const from = plan.review_status;
  if (!(TRANSITIONS[from] || []).includes(to)) return { ok: false, error: 'transition_not_allowed', from, to };
  if (to === 'ready_for_review' && !evaluateQuality(plan).ready) return { ok: false, error: 'quality_checklist_incomplete' };
  return { ok: true, plan: { ...plan, review_status: to } };
}

// The stored list (one row). Foreign or malformed data is never adopted.
export function parseStore(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return { plans: [], revision: 0, valid: false }; } }
  if (!v || typeof v !== 'object' || v.business_key !== PILOT_KEY || v.schema !== SCHEMA_VERSION || !Array.isArray(v.plans)) return { plans: [], revision: 0, valid: v == null };
  return { plans: v.plans.filter(p => validatePlan(p).ok).slice(0, MAX_PLANS), revision: Number.isInteger(v.revision) ? v.revision : 0, valid: true };
}
export function storeValue(plans, revision) {
  return { schema: SCHEMA_VERSION, business_key: PILOT_KEY, plans, revision };
}
// Inserts or replaces one plan (by id). New/edited plans always go back to draft unless only the review changes.
export function upsertPlan(store, plan, { now, expectedRevision } = {}) {
  if (expectedRevision !== undefined && expectedRevision !== store.revision) return { ok: false, error: 'revision_conflict', revision: store.revision };
  const v = validatePlan(plan);
  if (!v.ok) return { ok: false, error: 'invalid_plan', errors: v.errors };
  const i = store.plans.findIndex(x => x.id === plan.id);
  if (i < 0 && store.plans.length >= MAX_PLANS) return { ok: false, error: 'too_many_plans' };
  const prev = i >= 0 ? store.plans[i] : null;
  const saved = { ...plan, review_status: 'draft', created_at: prev ? prev.created_at : (now || plan.created_at), updated_at: now || new Date().toISOString(), revision: (prev ? prev.revision : -1) + 1 };
  const plans = i >= 0 ? store.plans.map((x, j) => (j === i ? saved : x)) : [...store.plans, saved];
  return { ok: true, plan: saved, value: storeValue(plans, store.revision + 1) };
}
