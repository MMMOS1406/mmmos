// NextWave V2 — SEMANTIC PROPOSER (the "model proposes meaning" half).
//
// The model reads the script with its quantities already extracted and
// marked, and PROPOSES: a role for each quantity, scenario membership, scene
// grouping + visual intent, and which deterministic calculation explains the
// numbers. It may not output a number. Everything it returns is validated
// here against hard gates before the deterministic layer sees it:
//   * ids must exist; roles/intents/models must be in the closed vocabularies
//   * a role must be kind-compatible with the quantity it labels
//   * every role must carry VERBATIM evidence from the same sentence
//   * no digit may appear in any free-text field unless it is verbatim from
//     the script (the model cannot smuggle in an invented figure)
//   * scenes must be a contiguous, complete, ordered partition of the units
// Anything failing a gate is REJECTED and recorded, never repaired.
//
// The model call is injected (`callModel`) so the same code runs live, from a
// recorded transcript (deterministic replay), or in a test with a stub.
import { createHash } from 'node:crypto';
import { CALC_MODELS, ARITH_OPS, CADENCES } from './nextwaveV2FinanceCalculators.mjs';

// ── closed vocabularies ─────────────────────────────────────────────────────
// role -> { kinds: allowed mention kinds, def: definition shown to the model }
export const ROLE_ONTOLOGY = {
  principal: { kinds: ['money'], def: 'A starting lump sum that exists at the beginning of the story: money invested, deposited, saved, borrowed, owed or held (an account balance, a loan balance, an amount left alone to grow).' },
  recurring_amount: { kinds: ['money'], def: 'A fixed amount paid, saved, invested or spent again and again each period (per day/week/month/year): a regular contribution, a payment, a monthly bill or expense, or a habitual purchase. ANY amount stated together with a frequency ("$5 daily", "$20 a week", "$300 monthly", "$1,200 every quarter") is a recurring_amount, whatever it is spent on and however the sentence is worded; set its cadence. (Income or salary is NOT this: use income_amount. A price with no frequency is baseline_amount.)' },
  transfer_amount: { kinds: ['money'], def: 'A one-time payment or receipt: a bonus, payout, dividend, sale proceeds, a profit realised.' },
  baseline_amount: { kinds: ['money'], def: 'The price or cost of an item or basket TODAY, used as the reference point for how it changes over time.' },
  upfront_cost: { kinds: ['money'], def: 'A one-time cost paid at the start that must be earned back (closing costs, an up-front fee, the price of an upgrade).' },
  income_amount: { kinds: ['money'], def: 'Income or salary (per year or per period) that other quantities are computed as a share of.' },
  outcome: { kinds: ['money'], def: 'A RESULTING figure of a scenario or computation: an ending balance, a total paid, a new payment amount, an after-tax amount, an inflated price, a purchasing-power equivalent, an interest cost, or a contribution amount computed from other quantities.' },
  gap: { kinds: ['money'], def: 'The difference or benefit between two scenarios or outcomes: how much more or less, savings, the cost of waiting, the cost of a fee.' },
  rate: { kinds: ['percent'], def: 'An annual growth, return or interest rate (including a loan APR).' },
  fee_rate: { kinds: ['percent'], def: 'An annual fee, expense ratio or advisory charge, as a percentage.' },
  tax_rate: { kinds: ['percent'], def: 'A tax rate.' },
  inflation_rate: { kinds: ['percent'], def: 'The rate at which prices rise.' },
  match_rate: { kinds: ['percent'], def: 'An employer match or subsidy percentage.' },
  savings_rate: { kinds: ['percent'], def: 'The share of income that is saved or contributed.' },
  change_pct: { kinds: ['percent'], def: 'A percentage change in a price or value over a short window (a rise or a fall). Set `direction` to up, down, or either if the script does not say.' },
  horizon: { kinds: ['duration'], def: 'The length of time a scenario runs, or a loan term (after 10 years, over 30 years).' },
  delay_period: { kinds: ['duration'], def: 'How long a start is postponed.' },
  remaining_period: { kinds: ['duration'], def: 'The time left after a delay during which contributions continue.' },
  process_window: { kinds: ['duration'], def: 'How long a process or settlement takes.' },
  result_duration: { kinds: ['duration'], def: 'A duration that is the RESULT of a computation, even if the script presents it as an outcome or answer: how long money lasts, time to pay off a debt, time to break even. (Use this — not "outcome" — for any result that is a length of time.)' },
  none: { kinds: ['money', 'percent', 'duration', 'multiplier', 'count'], def: 'The quantity plays no financial role in the storyboard (incidental).' },
};
export const INTENTS = {
  presenter_hook: 'The presenter opens the video with a claim; no data scene.',
  presenter_conclusion: 'The presenter closes the video; no data scene.',
  explanation: 'Presenter-style connective sentence with no quantities to visualise.',
  flow: 'Money moving from a source to a destination (a payment, a contribution, a loan being received).',
  process_timeline: 'A process that takes a stated window of time.',
  change_over_window: 'A percentage change in a price or value over a window.',
  trajectory_comparison: 'One or more scenarios drawn as values over time on a shared axis, shown together so they can be compared.',
  outcome_comparison: 'Two or more scenarios compared by their end results, optionally with the gap between them.',
  consequence_units: 'The same money now buys fewer or more units after a price change.',
  start_to_result: 'One quantity is followed from a starting figure to a resulting figure over time or after a change (e.g. an amount today and what it becomes).',
  single_figure: 'A single computed result presented with the quantities that produce it (e.g. how long a fund lasts).',
  breakeven: 'A one-time cost being paid back by a recurring saving until the two cross.',
};
export const METRICS = ['end_value', 'total_paid', 'periodic_payment', 'after_tax_proceeds', 'purchasing_power', 'future_price', 'interest_paid', 'tax_owed', 'contribution', 'other'];
const DIRECTIONS = ['up', 'down', 'either'];

// ── prompt construction ─────────────────────────────────────────────────────
function annotate(units) {
  return units.map((u) => {
    let t = u.text, out = '', cursor = 0;
    const ms = [...u.mentions].sort((a, b) => a.start - b.start);
    for (const m of ms) { out += t.slice(cursor, m.start) + `«${t.slice(m.start, m.end)}»{${m.id}}`; cursor = m.end; }
    out += t.slice(cursor);
    return `[${u.unit}] ${out}`;
  }).join('\n');
}
const roleDocs = (reverse) => {
  const entries = Object.entries(ROLE_ONTOLOGY);
  return (reverse ? entries.reverse() : entries).map(([r, o]) => `- ${r} (${o.kinds.join('|')}): ${o.def}`).join('\n');
};
const calcDocs = () => Object.entries(CALC_MODELS).map(([n, m]) => `- ${n}: inputs {${m.params.join(', ')}} -> outputs {${m.outputs.join(', ')}}. ${m.doc}`).join('\n');

const FORMAT = `Return ONLY one JSON object inside <json></json> tags with this shape:
{
 "mentions": [ { "id": "<mention id>", "role": "<role>", "confidence": <0..1>, "evidence": "<the exact words from the same sentence that justify the role, copied verbatim, at most 12 words>", "scenario": "<scenario id or null>", "direction": "<up|down|either|null>", "cadence": "<day|week|month|quarter|year|null>", "metric": "<metric or null>", "label": "<2-3 word UPPERCASE label built from the script's own words, no digits, or null>" } ],
 "scenarios": [ { "id": "S1", "label": "<short UPPERCASE label from the script's own words, no digits unless copied verbatim>" } ],
 "scenes": [ { "unit_ids": ["u00"], "intent": "<intent>", "purpose": "<short phrase>", "from_label": "<UPPERCASE source, only for flow, else null>", "to_label": "<UPPERCASE destination, only for flow, else null>" } ],
 "calculations": [ { "id": "c1", "model": "<model>", "inputs": { "<param>": <input> }, "output": "<output name>", "target": "<mention id of the stated result, or null>" } ]
}
An <input> is one of: a mention id string (e.g. "u02.m1"), {"calc":"c1","output":"<output name>"} to reuse an earlier calculation, or {"literal":"<cadence>"} for cadence/op parameters only.`;

const RULES = `Hard rules:
1. You classify quantities that were ALREADY extracted from the script. Never write a number, amount, percentage or duration of your own anywhere in your answer.
2. Every mention listed must appear in "mentions". If a quantity's role is genuinely unclear, use role "none" with low confidence rather than guessing.
3. "evidence" must be copied word-for-word from the sentence containing the quantity. Do NOT include the « » marker characters or the {id} tags in your quote — they are annotations, not part of the script.
4. Scenario membership: whenever two or more sentences describe the SAME kind of result under DIFFERENT conditions (two people, two options, before/after, with/without something, one payment amount versus another), you MUST define a scenario for each condition and assign to it EVERY quantity that belongs only to that condition — including the condition's own parameter (e.g. the payment amount or rate that differs) and all of its results. Quantities shared by every condition get scenario null.
5. "scenes" must cover EVERY unit exactly once, in order, as contiguous groups. Group adjacent sentences that serve one explanatory purpose (a comparison and the gap it produces can be one scene). Do not maximise the number of scenes. A presenter hook/conclusion contains no data.
6. "calculations": only propose a calculation when the script's own quantities plausibly produce a stated result; set "target" to the stated result's mention id so it can be checked. If you are unsure of a calculation, omit it — never force one.
7. Use the smallest set of scenes and calculations that is faithful to the script.
8. Time basis matters. A per-period amount (a monthly payment, a weekly saving) and a lifetime or annual total are DIFFERENT measures: never map a total to the difference of two per-period amounts or vice versa. Set "metric" on every outcome accurately (periodic_payment for a per-period payment; total_paid or interest_paid for cumulative totals; end_value for a balance at a date), and set "cadence" on every per-period amount.`;

export function buildProposerPrompt(units, variant = 'A') {
  const rev = variant === 'B';
  const system = variant === 'A'
    ? `You are the semantic interpreter for a finance-education video pipeline. You will be given a script whose quantities have been extracted and marked like «$500»{u01.m0}. Decide what each quantity MEANS in the story, how the sentences group into scenes, and which standard calculation (if any) explains the stated results.\n\nQuantity roles:\n${roleDocs(false)}\n\nScene intents:\n${Object.entries(INTENTS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\nAvailable deterministic calculations:\n${calcDocs()}\nmetrics for an outcome: ${METRICS.join(', ')}. arithmetic ops: ${ARITH_OPS.join(', ')}.\n\n${RULES}\n\n${FORMAT}`
    : `Act as an independent second reviewer of a finance script. Quantities are already extracted and tagged like «$500»{u01.m0}; you have seen no other analysis. For each tagged quantity choose the single best-fitting meaning, decide the scene structure, and identify any standard calculation that reproduces the stated results.\n\n${RULES}\n\nAvailable deterministic calculations:\n${calcDocs()}\nmetrics for an outcome: ${METRICS.join(', ')}. arithmetic ops: ${ARITH_OPS.join(', ')}.\n\nScene intents:\n${Object.entries(INTENTS).reverse().map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\nQuantity roles (choose exactly one per quantity):\n${roleDocs(true)}\n\n${FORMAT}`;
  const user = `Script (units in order, quantities marked):\n${annotate(units)}\n\nRespond with the JSON object only.`;
  return { system, user };
}

// ── parsing + validation ────────────────────────────────────────────────────
export function parseProposal(text) {
  const m = String(text || '').match(/<json>([\s\S]*?)<\/json>/i);
  const raw = m ? m[1] : (String(text || '').match(/\{[\s\S]*\}/) || [])[0];
  if (!raw) return { ok: false, error: 'no JSON found' };
  try { return { ok: true, value: JSON.parse(raw.trim()) }; } catch (e) { return { ok: false, error: 'invalid JSON: ' + e.message }; }
}
const norm = (s) => String(s || '').toLowerCase().replace(/[\s ]+/g, ' ').replace(/[“”"’']/g, '').trim();
const hasDigit = (s) => /\d/.test(String(s || ''));
const digitsVerbatim = (s, scriptNorm) => !hasDigit(s) || scriptNorm.includes(norm(s));

// Validate one raw proposal. Returns { proposal: cleaned, rejections: [...] }.
export function validateProposal(raw, ctx) {
  const rej = [];
  const { units, mentions } = ctx;
  const byId = new Map(mentions.map((m) => [m.id, m]));
  const unitText = new Map(units.map((u) => [u.unit, norm(u.text)]));
  const scriptNorm = norm(units.map((u) => u.text).join(' '));
  const out = { mentions: {}, scenarios: [], scenes: [], calculations: [] };
  const reject = (where, why) => rej.push({ where, why });

  // any numeric leakage anywhere outside ids?
  const scanFree = (label, s) => { if (s != null && !digitsVerbatim(s, scriptNorm)) { reject(label, `contains a number not present in the script: "${s}"`); return false; } return true; };

  (Array.isArray(raw.mentions) ? raw.mentions : []).forEach((pm, i) => {
    const where = `mentions[${i}]${pm && pm.id ? ' ' + pm.id : ''}`;
    if (!pm || !byId.has(pm.id)) return reject(where, 'unknown mention id');
    const m = byId.get(pm.id);
    if (out.mentions[pm.id]) return reject(where, 'duplicate mention id');
    const onto = ROLE_ONTOLOGY[pm.role];
    if (!onto) return reject(where, `role "${pm.role}" is not in the ontology`);
    if (!onto.kinds.includes(m.kind)) return reject(where, `role ${pm.role} cannot label a ${m.kind} quantity`);
    const conf = Number(pm.confidence);
    if (!(conf >= 0 && conf <= 1)) return reject(where, 'confidence not in [0,1]');
    if (pm.role !== 'none') {
      // Strip OUR annotation syntax («...»{id}) if the model copied it; it is
      // not script content. Everything else must still be verbatim.
      const ev = norm(String(pm.evidence || '').replace(/[«»]/g, '').replace(/\{u\d+\.m\d+\}/g, ''));
      if (!ev || ev.split(' ').length > 14) return reject(where, 'missing/too-long evidence quote');
      if (!(unitText.get(m.unit_id) || '').includes(ev)) return reject(where, `evidence is not verbatim from ${m.unit_id}: "${pm.evidence}"`);
    }
    if (pm.direction != null && !DIRECTIONS.includes(pm.direction)) return reject(where, 'bad direction');
    if (pm.cadence != null && !CADENCES.includes(pm.cadence)) return reject(where, 'bad cadence');
    if (pm.metric != null && !METRICS.includes(pm.metric)) return reject(where, 'bad metric');
    if (!scanFree(where + '.label', pm.label)) return;
    out.mentions[pm.id] = { role: pm.role, confidence: conf, evidence: pm.evidence || null, scenario: pm.scenario || null, direction: pm.direction || null, cadence: pm.cadence || null, metric: pm.metric || null, label: pm.label || null };
  });

  (Array.isArray(raw.scenarios) ? raw.scenarios : []).forEach((s, i) => {
    if (!s || !s.id) return reject(`scenarios[${i}]`, 'missing id');
    if (!scanFree(`scenarios[${i}].label`, s.label)) return;
    out.scenarios.push({ id: String(s.id), label: s.label || null });
  });
  const scIds = new Set(out.scenarios.map((s) => s.id));
  Object.values(out.mentions).forEach((pm) => { if (pm.scenario && !scIds.has(pm.scenario)) { rej.push({ where: 'mention.scenario', why: `unknown scenario ${pm.scenario}` }); pm.scenario = null; } });

  // scenes: complete, ordered, contiguous partition
  const order = units.map((u) => u.unit);
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  const flat = scenes.flatMap((s) => (Array.isArray(s.unit_ids) ? s.unit_ids : []));
  if (JSON.stringify(flat) !== JSON.stringify(order)) reject('scenes', 'not a complete, ordered, contiguous partition of the units');
  else scenes.forEach((s, i) => {
    if (!INTENTS[s.intent]) return reject(`scenes[${i}]`, `unknown intent "${s.intent}"`);
    if (!scanFree(`scenes[${i}].purpose`, s.purpose) || !scanFree(`scenes[${i}].from_label`, s.from_label) || !scanFree(`scenes[${i}].to_label`, s.to_label)) return;
    out.scenes.push({ unit_ids: s.unit_ids, intent: s.intent, purpose: s.purpose || null, from_label: s.from_label || null, to_label: s.to_label || null });
  });
  if (out.scenes.length !== scenes.length) out.scenes = []; // a bad scene invalidates the partition wholesale

  // calculations
  const calcIds = new Set();
  (Array.isArray(raw.calculations) ? raw.calculations : []).forEach((c, i) => {
    const where = `calculations[${i}]`;
    const model = CALC_MODELS[c && c.model];
    if (!model) return reject(where, `unknown model "${c && c.model}"`);
    if (!c.id || calcIds.has(c.id)) return reject(where, 'missing/duplicate id');
    if (!model.outputs.includes(c.output)) return reject(where, `output "${c.output}" not valid for ${c.model}`);
    if (c.target != null && !byId.has(c.target)) return reject(where, 'unknown target mention');
    const inputs = {};
    for (const [param, v] of Object.entries(c.inputs || {})) {
      if (!model.params.includes(param)) return reject(where, `param "${param}" not valid for ${c.model}`);
      if (typeof v === 'string') { if (!byId.has(v)) return reject(where, `input ${param}: unknown mention "${v}"`); inputs[param] = { mention: v }; }
      else if (v && typeof v === 'object' && v.calc) { if (!calcIds.has(v.calc)) return reject(where, `input ${param}: unknown earlier calc "${v.calc}"`); inputs[param] = { calc: v.calc, output: v.output }; }
      else if (v && typeof v === 'object' && typeof v.literal === 'string') {
        if (!(param === 'cadence' || param === 'op')) return reject(where, `literal only allowed for cadence/op, not ${param}`);
        if (!(CADENCES.includes(v.literal) || ARITH_OPS.includes(v.literal))) return reject(where, `bad literal "${v.literal}"`);
        inputs[param] = { literal: v.literal };
      } else return reject(where, `input ${param}: must be a mention id, {calc}, or {literal} — numbers are not allowed`);
    }
    calcIds.add(c.id);
    out.calculations.push({ id: c.id, model: c.model, inputs, output: c.output, target: c.target || null });
  });
  return { proposal: out, rejections: rej };
}

// ── model access ────────────────────────────────────────────────────────────
export const MODEL_ID = 'claude-sonnet-4-5';
export const PRICE_PER_MTOK = { input: 3, output: 15 }; // USD, claude-sonnet-4-5 list price

export function costOf(usage) {
  const i = (usage && usage.input_tokens) || 0, o = (usage && usage.output_tokens) || 0;
  return (i * PRICE_PER_MTOK.input + o * PRICE_PER_MTOK.output) / 1e6;
}

// Live caller — same shape as the existing NextWave Claude calls (direct
// fetch, x-api-key, anthropic-version header). temperature 0 for repeatability.
export function makeLiveCaller(apiKey, fetchImpl = fetch) {
  return async function callModel(system, user) {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL_ID, max_tokens: 6000, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
    return { text: (j.content || []).map((b) => b.text || '').join(''), usage: j.usage || {}, model: j.model || MODEL_ID };
  };
}

// Record/replay wrapper: identical prompts replay from disk (no model call, no
// cost, deterministic regression); new prompts call the live caller and are
// recorded. Every call — live or replayed — is tallied so cost is measurable.
export function makeRecordingCaller({ live, store, tally }) {
  return async function callModel(system, user) {
    const key = createHash('sha256').update(MODEL_ID + '\n' + system + '\n' + user).digest('hex');
    const hit = store.get(key);
    if (hit) { tally.replayed++; return hit; }
    if (!live) throw new Error('recording missing and no live caller (offline replay): ' + key.slice(0, 12));
    const r = await live(system, user);
    tally.live_calls++; tally.input_tokens += r.usage.input_tokens || 0; tally.output_tokens += r.usage.output_tokens || 0; tally.cost_usd += costOf(r.usage);
    store.set(key, r);
    return r;
  };
}

// Two independent passes, each validated. Returns raw text + cleaned proposal.
export async function proposeSemantics({ units, callModel }) {
  const ctxMentions = units.flatMap((u) => u.mentions);
  const passes = [];
  for (const variant of ['A', 'B']) {
    const { system, user } = buildProposerPrompt(units, variant);
    let resp, err = null;
    try { resp = await callModel(system, user); } catch (e) { err = e.message; }
    if (err) { passes.push({ variant, ok: false, error: err, proposal: null, rejections: [] }); continue; }
    const parsed = parseProposal(resp.text);
    if (!parsed.ok) { passes.push({ variant, ok: false, error: parsed.error, proposal: null, rejections: [], raw: resp.text }); continue; }
    const { proposal, rejections } = validateProposal(parsed.value, { units, mentions: ctxMentions });
    passes.push({ variant, ok: true, proposal, rejections, usage: resp.usage });
  }
  return passes;
}
