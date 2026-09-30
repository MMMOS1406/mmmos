// NextWave V2 — SEMANTIC STORYBOARD BRAIN (general-language layer).
//
//   SCRIPT -> meaning units -> deterministic quantity extraction
//          -> semantic proposals (2 independent model passes; see proposer)
//          -> DETERMINISTIC verification gates (calculations, corroboration,
//             rule-engine cross-check, evidence, coverage)
//          -> semantic grouping -> intent-driven treatment planning with
//             capability checks -> renderer-ready storyboard + provenance
//
// The model PROPOSES meaning; this layer is AUTHORITATIVE for numbers,
// calculations, contradictions, provenance and coverage. A role is bound only
// when it is (a) VERIFIED by a calculation that reproduces the script's own
// stated figure, or (b) CORROBORATED by two independent passes with valid
// verbatim evidence and no contradiction from the v1 rule engine. Everything
// else stays UNBOUND and surfaces as needs_review — never guessed.
//
// The v1 rule engine is NOT extended here: it is kept unchanged as (1) an
// independent cross-check and (2) the offline fallback if the proposer is
// unavailable.
import {
  analyzeUnit, auditCoverage, fmtMoney, fmtPct, fmtDur, meaningEventPattern, ASSET, tagsOf,
  upperBound, toYears, CADENCE_ABBR, nextwaveV2BuildStoryboard,
} from './nextwaveV2StoryboardBrain.mjs';
import { compute, statedMatches, growthSeries, periodsPerYear } from './nextwaveV2FinanceCalculators.mjs';
import { proposeSemantics, ROLE_ONTOLOGY } from './nextwaveV2SemanticProposer.mjs';

export const SEMANTIC_BRAIN_VERSION = '2.0';

// Which ontology roles are acceptable for each calculation parameter. A
// calculation that reproduces a stated figure verifies these role bindings
// structurally (independent of any wording).
const PARAM_ROLES = {
  compound_growth: { principal: ['principal', 'baseline_amount', 'transfer_amount'], recurring: ['recurring_amount', 'outcome'], rate: ['rate'], fee: ['fee_rate'], years: ['horizon'], delay: ['delay_period'] },
  real_value: { amount: ['baseline_amount', 'principal'], inflation_rate: ['inflation_rate'], years: ['horizon'] },
  loan_payment: { principal: ['principal'], rate: ['rate'], years: ['horizon'] },
  loan_payoff: { principal: ['principal'], rate: ['rate'], payment: ['recurring_amount'] },
  runway: { fund: ['principal'], expense: ['recurring_amount'] },
  after_tax: { amount: ['transfer_amount', 'principal', 'baseline_amount'], tax_rate: ['tax_rate'] },
  breakeven: { upfront_cost: ['upfront_cost'], periodic_saving: ['recurring_amount', 'gap'] },
  arithmetic: {},
};
const MONEY_INPUT_FAMILY = new Set(['principal', 'baseline_amount', 'transfer_amount', 'income_amount', 'upfront_cost']);
const ONE_TIME_AMOUNT = new Set(['principal', 'transfer_amount', 'baseline_amount']);
const TARGET_ROLES = ['outcome', 'gap', 'result_duration', 'recurring_amount', 'transfer_amount'];
const OUTPUT_DEFAULT_ROLE = { periods: 'result_duration', payoff_periods: 'result_duration', value: 'outcome' };
const GOOD_DIRECTION = { end_value: 'up', after_tax_proceeds: 'up', purchasing_power: 'up', total_paid: 'down', interest_paid: 'down', tax_owed: 'down', periodic_payment: 'down', future_price: 'down' };
const HEADER_BY_METRIC = { end_value: 'FINAL VALUE', total_paid: 'TOTAL PAID', periodic_payment: 'MONTHLY PAYMENT', after_tax_proceeds: 'AFTER TAX', purchasing_power: 'PURCHASING POWER', future_price: 'FUTURE PRICE', interest_paid: 'INTEREST PAID', tax_owed: 'TAX OWED' };
const DATA_ROLES = new Set(['principal', 'recurring_amount', 'transfer_amount', 'baseline_amount', 'upfront_cost', 'income_amount', 'outcome', 'gap', 'rate', 'fee_rate', 'tax_rate', 'inflation_rate', 'match_rate', 'savings_rate', 'change_pct', 'horizon', 'delay_period', 'remaining_period', 'process_window', 'result_duration']);


// ── metric identity (what a number MEANS: metric, unit, time basis) ──────────
// A number may only be drawn next to / subtracted from another number of the
// same identity. Identity comes from the deterministic calculation that
// produced/verified a figure where there is one; otherwise from the model's
// proposed metric + cadence. `unspecified` is compatible only with itself
// (parallel sentences describing the same kind of result).
const OUTPUT_BASIS = { periodic_payment: 'per_month', total_paid: 'lifetime', interest_paid: 'lifetime', tax_owed: 'one_time', after_tax_proceeds: 'one_time', end_value: 'at_horizon', purchasing_power: 'at_horizon', future_price: 'at_horizon', payoff_periods: 'duration', periods: 'duration' };
const METRIC_BASIS = { periodic_payment: 'per_month', total_paid: 'lifetime', interest_paid: 'lifetime', tax_owed: 'one_time', after_tax_proceeds: 'one_time', end_value: 'at_horizon', purchasing_power: 'at_horizon', future_price: 'at_horizon' };
const basisWord = (b) => (b && b.startsWith('per_') ? b.slice(4) : null);
const basisSuffix = (b) => { const w = basisWord(b); return w ? '/' + (CADENCE_ABBR[w] || w.slice(0, 2).toUpperCase()) : ''; };
const withBasis = (display, b) => display + basisSuffix(b);

// ── stated numeric precision ────────────────────────────────────────────────
// A stated amount keeps the precision the script gave it ("$6.72" is never "$7");
// a derived figure uses the greater precision of the figures it is derived from.
const decimalsOf = (raw) => { if (/\b(thousand|million|billion|trillion)\b|\d\s?[kmb]\b/i.test(String(raw || ''))) return 0; const m = String(raw || '').match(/\.(\d+)/); return m ? Math.min(2, m[1].length) : 0; };
const displayDecimals = (disp) => { const m = String(disp || '').match(/\.(\d+)/); return m ? m[1].length : 0; };
const fmtMoneyD = (v, d = 0) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
// words vs numbers: "$1,000,000" is ONE numeric token, never repeated "000" words
export const semanticTokens = (t) => (String(t).toLowerCase().match(/\$?\d[\d,]*(?:\.\d+)?%?|[a-z']+/g) || []);
export const hasDuplicateWords = (t) => {
  const NW = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', fifteen: '15', twenty: '20', thirty: '30', forty: '40', fifty: '50' };
  const w = semanticTokens(t).map((x) => (NW[x] || x).replace(/^(\d+)s$/, '$1'));
  for (let i = 0; i + 1 < w.length; i++) { if (w[i] === w[i + 1] && /[a-z]/.test(w[i])) return true; if (i + 3 < w.length && w[i] === w[i + 2] && w[i + 1] === w[i + 3]) return true; }
  // number word and its numeral side by side ("5 YEARS FIVE YEARS")
  const norm = w.map((x) => x.replace(/s$/, ''));
  for (let i = 0; i + 3 < norm.length; i++) if (norm[i] === norm[i + 2] && norm[i + 1] === norm[i + 3]) return true;
  return false;
};
// ── model-label factual gate ────────────────────────────────────────────────
// A model-written label may not assert a cadence the script does not establish
// ("MONTHLY PAYCHECK" when the script never says monthly). Cadence words in a label need
// the same evidence a cadence value needs; an unsupported word is removed. Rate labels
// are annual by definition ("ANNUAL RETURN") and are exempt.
const CAD_LABEL = [
  ['month', /\b(MONTHLY|PER MONTH)\b/g], ['week', /\b(WEEKLY|PER WEEK)\b/g], ['day', /\b(DAILY|PER DAY)\b/g], ['quarter', /\bQUARTERLY\b/g],
  ['year', /\b(YEARLY|ANNUALLY|PER YEAR|ANNUAL(?!\s+(?:RETURN|RATE|FEE|YIELD|INFLATION|GROWTH|INTEREST|PERCENTAGE|EXPENSE)))\b/g],
];
export const cadenceWordsIn = (label) => CAD_LABEL.filter(([, re]) => { re.lastIndex = 0; return re.test(String(label || '').toUpperCase()); }).map(([c]) => c);
export const gateLabel = (label, supported) => {
  if (!label) return label;
  let out = String(label).toUpperCase(); const sup = new Set(supported || []);
  for (const [c, re] of CAD_LABEL) { if (!sup.has(c)) { re.lastIndex = 0; out = out.replace(re, ' '); } }
  out = out.replace(/\s+/g, ' ').trim();
  return out && /[A-Z]{2,}/.test(out) ? out : null;
};
// movement expressions that make a money-flow arrow a real transfer
const MOVE_RE = /\b(send|sends|sent|put|puts|deposit\w*|transfer\w*|contribut\w*|pay|pays|paid|withdr\w+|mov(?:e|es|ed|ing)|invest\w*|goes|go|flows?|rout\w+|wire\w*|add(?:s|ed)?|sav(?:e|es|ed|ing)|set(?:s)? aside|borrow\w*|receiv\w*|deduct\w*|into)\b/i;
// a cadence STRONG enough to label a figure: the frequency word is attached to it, or the calculation
// propagated it, or the figure is itself a recurring amount. A frequency word merely somewhere in the
// clause ("...for 30 years and you'll have $X" next to "$200 a month") never makes an ending balance periodic.
const strongCad = (e) => !!(e && e.cadence && (['attached', 'calc_propagated'].includes(e.cadence_evidence) || e.role === 'recurring_amount'));
const mentionNum = (m) => (Array.isArray(m.value) ? m.value[1] : m.value);
const cleanLabel = (s, max = 24) => (s && /^[A-Z][A-Z0-9 %$/&.\-']*$/.test(String(s).trim()) && String(s).trim().length <= max ? String(s).trim() : null);
// join whole tokens up to a length; never cut a token mid-way
const fitTokens = (list, max) => { let out = ''; for (const t of list) { const n = out ? out + ' ' + t : t; if (n.length > max) break; out = n; } return out; };
const upper = (s, max = 24) => { const t = String(s || '').trim().toUpperCase(); return t && t.length <= max ? t : null; };

// ── calculation verification ────────────────────────────────────────────────
function runCalculations(passProposal, mentionsById) {
  const results = new Map(); // calc id -> { value, convention, verified, target, params, model, output }
  const details = [];
  for (const c of passProposal.calculations) {
    const params = {}; const inputMentions = [];
    let missing = false;
    for (const [param, ref] of Object.entries(c.inputs)) {
      if (ref.mention) { const m = mentionsById.get(ref.mention); params[param] = mentionNum(m); inputMentions.push({ param, id: ref.mention }); }
      else if (ref.calc) { const r = results.get(ref.calc); if (!r) { missing = true; break; } params[param] = r.value; inputMentions.push({ param, calc: ref.calc }); }
      else params[param] = ref.literal;
    }
    if (missing) { details.push({ calc: c.id, model: c.model, ok: false, reason: 'depends on a calculation that did not resolve' }); continue; }
    const cands = compute(c.model, params, c.output);
    if (!cands.length) { details.push({ calc: c.id, model: c.model, ok: false, reason: 'model could not be evaluated with the mapped inputs', inputs: inputMentions }); continue; }
    let chosen = cands[0], verified = false;
    let target = c.target ? mentionsById.get(c.target) : null;
    // A proposed mapping is plausible only if the calculation's OUTPUT TYPE is the target
    // mention's type (a dollar or duration calculation cannot produce a percentage; a
    // percentage mention cannot be the target of a dollar calculation). An implausible
    // target is REJECTED (recorded), never verified and never reported as a script problem.
    const OUT_KIND = { end_value: 'money', future_price: 'money', purchasing_power: 'money', periodic_payment: 'money', total_paid: 'money', interest_paid: 'money', after_tax_proceeds: 'money', tax_owed: 'money', payoff_periods: 'duration', periods: 'duration' };
    let outKind = OUT_KIND[c.output] || null;
    if (c.model === 'arithmetic') {
      const aIn = inputMentions.find((i) => i.param === 'a');
      const aKind = aIn ? (aIn.id ? mentionsById.get(aIn.id).kind : results.get(aIn.calc) && results.get(aIn.calc).outKind) : null;
      outKind = c.model === 'arithmetic' && params.op === 'ratio' ? 'ratio' : aKind;
    }
    let rejectedTarget = null;
    if (target && outKind && (outKind === 'ratio' ? target.kind === 'percent' || target.kind === 'money' || target.kind === 'duration' : target.kind !== outKind)) { rejectedTarget = { target: c.target, target_kind: target.kind, calculation_output_kind: outKind, why: 'the calculation cannot produce a quantity of the target mention\'s type' }; target = null; }
    // A duration result counts PERIODS of the calculation's own cadence (a
    // break-even of 120 monthly savings is "ten years"): compare in the
    // stated unit as well as in periods. The cadence comes from the periodic
    // input's own frequency word, never from the model.
    const cadenceOfParam = (param) => { const inp = inputMentions.find((i) => i.param === param && i.id); const m0 = inp && mentionsById.get(inp.id); const f = m0 && m0.ctx && (m0.ctx.freqRight || m0.ctx.freqClause); return (f && f.cadence) || 'month'; };
    const periodCadence = c.model === 'loan_payoff' ? 'month' : c.model === 'runway' ? cadenceOfParam('expense') : c.model === 'breakeven' ? cadenceOfParam('periodic_saving') : null;
    const UNIT_PPY = { year: 1, month: 12, week: 52, day: 365, quarter: 4 };
    const inTargetUnit = (v) => (periodCadence && target && target.kind === 'duration' && UNIT_PPY[target.unit] ? (v / periodsPerYear(periodCadence)) * UNIT_PPY[target.unit] : v);
    if (target) {
      const kind = target.kind;
      const hit = cands.find((k) => statedMatches(mentionNum(target), k.value, kind) || (kind === 'duration' && periodCadence && statedMatches(mentionNum(target), inTargetUnit(k.value), kind)));
      if (hit) { chosen = hit; verified = true; }
    }
    results.set(c.id, { id: c.id, model: c.model, output: c.output, outKind, value: chosen.value, convention: chosen.convention, verified, target: rejectedTarget ? null : c.target, params, inputs: inputMentions, periodCadence, candidates: cands.map((k) => +k.value.toFixed(4)) });
    details.push({ calc: c.id, model: c.model, output: c.output, target: rejectedTarget ? null : c.target, ...(rejectedTarget ? { rejected_target: rejectedTarget } : {}), computed: +chosen.value.toFixed(4), convention: chosen.convention, stated: target ? mentionNum(target) : null, verified, ...(target && !verified ? { candidates: cands.map((k) => +k.value.toFixed(4)) } : {}) });
  }
  results.forEach((r) => Object.defineProperty(r, '_all', { value: results, enumerable: false }));
  return { results, details };
}

// ── main ─────────────────────────────────────────────────────────────────────
export async function nextwaveV2BuildStoryboardSemantic(script, deps) {
  if (!script || typeof script !== 'string' || !script.trim()) return { ok: false, error: 'script required' };
  const rawUnits = deps.segmentMeaningUnits(script);
  if (!rawUnits.length) return { ok: false, error: 'no meaning units' };
  const units = rawUnits.map((u) => analyzeUnit(u, deps));
  const mentions = units.flatMap((u) => u.mentions);
  const mentionsById = new Map(mentions.map((m) => [m.id, m]));
  const issues = [];
  const review = (kind, detail) => issues.push({ severity: 'review', kind, ...detail });

  // 1. semantic proposals (two independent passes)
  const passes = await proposeSemantics({ units, callModel: deps.callModel });
  const valid = passes.filter((p) => p.ok && p.proposal);
  if (valid.length === 0) {
    // Fail safe: no usable semantic proposal -> the unchanged rule engine, flagged.
    const v1 = nextwaveV2BuildStoryboard(script, deps);
    if (v1.ok) {
      v1.integrity.issues.push({ severity: 'review', kind: 'semantic_proposer_unavailable', detail: passes.map((p) => p.error || 'invalid') });
      v1.integrity.status = v1.integrity.status === 'blocked' ? 'blocked' : 'needs_review';
      v1.semantic = { mode: 'rules_fallback', passes: passes.map((p) => ({ variant: p.variant, ok: p.ok, error: p.error })) };
    }
    return v1;
  }
  const A = valid[0].proposal, B = valid[1] ? valid[1].proposal : null;

  // 2. verify calculations from each pass
  const calcRuns = valid.map((p) => runCalculations(p.proposal, mentionsById));
  const verifiedCalcs = calcRuns.flatMap((r) => [...r.results.values()].filter((c) => c.verified));
  const calcDetails = calcRuns.flatMap((r, i) => r.details.map((d) => ({ pass: valid[i].variant, ...d })));
  // A proposed calculation that fails to reproduce a stated figure is a review
  // item ONLY if no other verified calculation reproduces that same figure: a
  // wrong mapping from one pass, caught by the deterministic check while the
  // other pass's mapping verifies, is recorded as a rejected proposal, not a
  // script problem.
  const verifiedTargets = new Set(verifiedCalcs.map((c) => c.target).filter(Boolean));
  const rejectedProposals = [];
  calcDetails.filter((d) => d.rejected_target).forEach((d) => rejectedProposals.push({ pass: d.pass, calc: d.calc, model: d.model, ...d.rejected_target }));
  calcDetails.filter((d) => d.target && !d.verified && d.ok !== false).forEach((d) => {
    if (verifiedTargets.has(d.target)) rejectedProposals.push({ pass: d.pass, calc: d.calc, model: d.model, target: d.target, computed: d.computed, why: 'did not reproduce the stated figure; another verified calculation does' });
    else if (!issues.some((i) => i.kind === 'stated_value_not_reproduced' && i.target === d.target && i.model === d.model)) review('stated_value_not_reproduced', { calc: d.calc, model: d.model, target: d.target, stated: d.stated, computed: d.computed, candidates: d.candidates });
  });

  const unitById0 = new Map(units.map((u) => [u.unit, u.text]));
  // 3. per-mention role decision
  const decisions = new Map();
  for (const m of mentions) {
    let a = A.mentions[m.id] || null, b = B ? (B.mentions[m.id] || null) : null;
    // Amount + frequency is ONE economic behaviour ("$5 daily", "$20 a week",
    // "$300 monthly"). A money quantity with an adjacent frequency that a pass
    // labelled as a lump-sum-like role is normalised to recurring_amount in
    // BOTH passes, so wording cannot split the meaning between passes. The
    // normalisation is recorded on the decision.
    // "attached" = the frequency word directly follows the amount (a few
    // characters, no other quantity in between): "$5 daily", "$300 per month",
    // "$1,200 every quarter" — NOT "the same $24,000 at $200 a month".
    // Amounts joined by a short connector ("from $90 to $60 a month") share the
    // frequency that follows the last of them.
    const attachedFreq = (x) => {
      const rf = x.kind === 'money' && x.ctx && x.ctx.freqRight ? x.ctx.freqRight : null;
      if (rf && rf.start - x.end <= 12 && !mentions.some((o) => o !== x && o.unit_id === x.unit_id && o.start >= x.end && o.start < rf.start)) return rf;
      const nxt = mentions.filter((o) => o.unit_id === x.unit_id && o.start >= x.end).sort((p, q) => p.start - q.start)[0];
      if (nxt && nxt.kind === 'money' && x.kind === 'money' && /^\s*(?:,|to|and|or|vs\.?|versus|up to|down to|then|into)?\s*$/i.test((unitById0.get(x.unit_id) || '').slice(x.end, nxt.start))) return attachedFreq(nxt);
      return null;
    };
    const freq = attachedFreq(m);
    const LUMPISH = new Set(['baseline_amount', 'principal', 'transfer_amount']);
    let normalized = null;
    if (freq) {
      const fix = (x) => (x && LUMPISH.has(x.role) ? { ...x, role: 'recurring_amount', cadence: x.cadence || freq.cadence } : x);
      let a2 = fix(a), b2 = fix(b);
      // a per-period amount read as "recurring amount" by one pass and as a
      // resulting "outcome" by the other is the same per-period quantity
      if (a2 && b2 && a2.role !== b2.role && [a2.role, b2.role].every((r) => r === 'recurring_amount' || r === 'outcome')) { a2 = { ...a2, role: 'recurring_amount', cadence: a2.cadence || freq.cadence }; b2 = { ...b2, role: 'recurring_amount', cadence: b2.cadence || freq.cadence }; }
      if (a2 !== a || b2 !== b) normalized = { from: { A: a && a.role, B: b && b.role }, to: 'recurring_amount', cadence: freq.cadence, why: 'the amount carries an explicit frequency, so it is a per-period (recurring) amount' };
      a = a2; b = b2;
    }
    const ruleRole = m.role && ROLE_ONTOLOGY[m.role] && m.role !== 'none' ? m.role : null;
    const d = { id: m.id, rule_role: ruleRole, normalized, attached_cadence: freq ? freq.cadence : null, A: a && a.role, B: b && b.role, confidence: [a && a.confidence, b && b.confidence].filter((x) => x != null), status: null, role: null, why: null };
    // calculation-verified structure wins
    let calcRole = null; const basis = [];
    for (const run of calcRuns) for (const c of run.results.values()) {
      if (!c.verified) continue;
      const inp = c.inputs.find((i) => i.id === m.id);
      if (inp) {
        const allowed = (PARAM_ROLES[c.model] || {})[inp.param] || [];
        const prop = (a && a.role !== 'none' ? a.role : null) || (b && b.role !== 'none' ? b.role : null);
        // the calculation verifies a role only when the model's own role for the
        // quantity is one the calculation can take (or it gave none); a role the
        // calculation cannot take is an incoherent proposal, left to the normal
        // corroboration rules rather than overridden
        if (allowed.length && (allowed.includes(prop) || !prop)) { calcRole = prop || allowed[0]; basis.push({ calc: c.id, param: inp.param }); }
        else if (allowed.length && MONEY_INPUT_FAMILY.has(prop) && allowed.some((r) => MONEY_INPUT_FAMILY.has(r))) {
          // Interchangeable money-input roles (an amount "today" may be read as income,
          // a starting sum or a reference price) reconcile to the calculator's role
          // ONLY when the reading is unambiguous: every pass that labelled it names a
          // role in the same family, and no other quantity in the script is a competing
          // candidate for a family role outside this calculation.
          const passRoles = [a && a.role, b && b.role].filter(Boolean);
          const calcMentionIds = new Set(c.inputs.map((i) => i.id).filter(Boolean).concat(c.target ? [c.target] : []));
          const competing = mentions.some((o) => o.id !== m.id && o.kind === 'money' && !calcMentionIds.has(o.id) && [A.mentions[o.id], B && B.mentions[o.id]].some((x) => x && MONEY_INPUT_FAMILY.has(x.role)));
          if (passRoles.every((r) => MONEY_INPUT_FAMILY.has(r)) && !competing) {
            calcRole = allowed.find((r) => passRoles.includes(r)) || allowed.find((r) => MONEY_INPUT_FAMILY.has(r));
            basis.push({ calc: c.id, param: inp.param, reconciled_from: passRoles });
            d.role_reconciled = { proposed: passRoles, to: calcRole, why: 'interchangeable money-input roles; the verified calculation fixes the role and no competing quantity exists' };
          } else d.calc_input_incoherent = { calc: c.id, param: inp.param, proposed: prop, allowed, competing };
        }
        else if (allowed.length) d.calc_input_incoherent = { calc: c.id, param: inp.param, proposed: prop, allowed };
      }
      if (c.target === m.id) {
        const prop = (a && a.role !== 'none' ? a.role : null) || (b && b.role !== 'none' ? b.role : null);
        calcRole = TARGET_ROLES.includes(prop) ? prop : (OUTPUT_DEFAULT_ROLE[c.output] || 'outcome'); basis.push({ calc: c.id, target: true });
      }
    }
    if (calcRole) { Object.assign(d, { status: 'verified', role: calcRole, why: 'reproduced by a deterministic calculation', calc_basis: basis }); decisions.set(m.id, d); continue; }
    const avgConf = d.confidence.length ? d.confidence.reduce((x, y) => x + y, 0) / d.confidence.length : 0;
    if (a && b && a.role === b.role) {
      if (a.role === 'none') { Object.assign(d, { status: 'incidental', role: 'none', why: 'both passes: no financial role' }); }
      else if (avgConf < 0.6) Object.assign(d, { status: 'uncertain', role: null, why: `low confidence (${avgConf.toFixed(2)})` });
      else if (ruleRole && ruleRole !== a.role && avgConf < 0.9) Object.assign(d, { status: 'conflict', role: null, why: `both passes say ${a.role} (confidence ${avgConf.toFixed(2)}) but the independent rule engine says ${ruleRole}` });
      else Object.assign(d, { status: 'corroborated', role: a.role, why: 'two independent passes agree with verbatim evidence' + (!ruleRole ? '' : ruleRole === a.role ? ' and the rule engine agrees' : `; rule engine dissents (${ruleRole}) but both passes are highly confident (${avgConf.toFixed(2)})`), rule_dissent: ruleRole && ruleRole !== a.role ? ruleRole : null });
    } else if (a && b && ONE_TIME_AMOUNT.has(a.role) && ONE_TIME_AMOUNT.has(b.role) && ruleRole && (ruleRole === a.role || ruleRole === b.role) && (a.confidence + b.confidence) / 2 >= 0.85) {
      // the passes differ only WITHIN the one-time-amount family (a payout vs a
      // starting sum vs a reference price) and the independent rule engine
      // sides with one of them: bind that role, and say so
      Object.assign(d, { status: 'corroborated', role: ruleRole, why: `passes named different one-time-amount roles (${a.role} / ${b.role}); the independent rule engine settles it as ${ruleRole}`, family_resolved: true });
    } else if (a && b) Object.assign(d, { status: 'disagree', role: null, why: `passes disagree: ${a.role} vs ${b.role}` });
    else Object.assign(d, { status: 'single_pass', role: null, why: 'only one valid pass labelled this quantity' });
    decisions.set(m.id, d);
  }

  // Delay role reconciliation: when the passes call a duration "horizon" or "remaining_period"
  // and it equals (a corroborated total horizon) - (a corroborated stated delay) EXACTLY, it is
  // the post-delay duration. Any other case keeps the ambiguity (unbound -> review).
  const yrs = (m) => toYears(m.value, m.unit);
  for (const m of mentions) {
    const d = decisions.get(m.id);
    if (d.role || m.kind !== 'duration' || Array.isArray(m.value)) continue;
    const props = [d.A, d.B].filter(Boolean);
    if (!props.length || !props.every((r) => r === 'horizon' || r === 'remaining_period') || !props.includes('remaining_period')) continue;
    const dels = mentions.filter((x) => x.kind === 'duration' && !Array.isArray(x.value) && decisions.get(x.id).role === 'delay_period');
    const tots = mentions.filter((x) => x.id !== m.id && x.kind === 'duration' && !Array.isArray(x.value) && decisions.get(x.id).role === 'horizon');
    if (dels.some((dm) => tots.some((tm) => Math.abs(yrs(tm) - yrs(dm) - yrs(m)) < 1e-9))) Object.assign(d, { status: 'corroborated', role: 'remaining_period', why: 'passes named horizon / remaining_period; the period equals the total horizon minus the stated delay exactly', delay_reconciled: true });
  }

  // change_pct with an unspecified direction cannot be charted
  for (const m of mentions) {
    const d = decisions.get(m.id);
    if (d.role === 'change_pct') {
      const da = A.mentions[m.id] && A.mentions[m.id].direction, db = B && B.mentions[m.id] && B.mentions[m.id].direction;
      const dir = da && (!db || db === da) ? da : null;
      d.direction = dir;
      if (!dir || dir === 'either') review('direction_ambiguous', { mention: m.id, raw: m.raw, reason: 'the script does not say whether the change is up or down' });
    }
  }

  // 4. entity registry from bound roles
  const entities = [];
  const labelGated = [];
  const entOf = new Map();
  let seq = 0;
  for (const m of mentions) {
    const d = decisions.get(m.id);
    if (!d.role || d.role === 'none') continue;
    const pa = A.mentions[m.id];
    // A cadence is FACT only when the script says it (an attached or clause frequency
    // word, or the model's cadence matching a frequency word in the same sentence). The
    // model may propose a cadence; it can never establish one.
    const uTxt = units.find((u) => u.unit === m.unit_id);
    const textCad = d.attached_cadence || (m.ctx && (m.ctx.freqRight || m.ctx.freqClause) ? (m.ctx.freqRight || m.ctx.freqClause).cadence : null);
    const cad0 = textCad ? { cadence: textCad, evidence: d.attached_cadence ? 'attached' : 'clause', rejected: pa && pa.cadence && pa.cadence !== textCad ? pa.cadence : null }
      : pa && pa.cadence && uTxt && (uTxt.freqs || []).some((f) => f.cadence === pa.cadence) ? { cadence: pa.cadence, evidence: 'script_text_same_sentence', rejected: null }
      : { cadence: null, evidence: null, rejected: pa && pa.cadence ? pa.cadence : null };
    const labelOf = (pa2, m2, cad) => {
      const raw = cleanLabel(pa2 && pa2.label); if (!raw) return raw;
      if (['rate', 'fee_rate', 'tax_rate', 'inflation_rate', 'match_rate', 'savings_rate', 'change_pct'].includes(d.role)) return raw;
      const sup = new Set([...(uTxt && uTxt.freqs ? uTxt.freqs.map((f) => f.cadence) : []), ...(cad && cad.cadence ? [cad.cadence] : [])]);
      const g = gateLabel(raw, sup); if (g !== raw) labelGated.push({ mention: m2.id, from: raw, to: g });
      return g;
    };
    const e = {
      id: `v${++seq}`, role: d.role, kind: m.kind, value: m.value, unit: m.unit || (m.kind === 'money' ? 'USD' : m.kind === 'percent' ? 'PCT' : undefined),
      display: m.kind === 'money' ? fmtMoneyD(m.value, decimalsOf(m.raw)) : m.kind === 'percent' ? fmtPct(m.value) : m.kind === 'duration' ? fmtDur(m.value, m.unit) : String(m.value),
      cadence: cad0.cadence, cadence_evidence: cad0.evidence, cadence_proposal_rejected: cad0.rejected,
      direction: d.direction || null, metric: (pa && pa.metric) || null, label: labelOf(pa, m, cad0),
      scenario: (pa && pa.scenario) || null,
      provenance: { kind: 'script', unit_id: m.unit_id, span_text: m.raw, start: m.start, end: m.end, mention_id: m.id },
      confidence: { level: d.status, why: d.why, passes: { A: d.A, B: d.B }, rule_engine: d.rule_role, calc_basis: d.calc_basis || null },
    };
    entities.push(e); entOf.set(m.id, e);
  }
  // numeric quantities the model/rules left unbound are surfaced, never dropped
  const unbound = [];
  for (const m of mentions) {
    const d = decisions.get(m.id);
    if (d.role) continue;
    unbound.push({ unit_id: m.unit_id, mention: m.id, raw: m.raw, kind: m.kind, status: d.status, reason: d.why, proposed: { A: d.A, B: d.B, rule_engine: d.rule_role } });
    review('unbound_value', { mention: m.id, raw: m.raw, status: d.status, reason: d.why });
  }
  mentions.filter((m) => decisions.get(m.id).status === 'incidental' && (m.kind === 'money' || m.kind === 'percent')).forEach((m) => review('unassigned_quantity', { mention: m.id, raw: m.raw, reason: 'both passes judged this money/percent quantity to play no financial role' }));

  // 5. scene partition (pass A, else B) + agreement info
  const partitionOf = (P) => (P && P.scenes.length ? P.scenes : null);
  const scenesRaw = partitionOf(A) || partitionOf(B);
  const groupingAgreement = partitionOf(A) && partitionOf(B) ? JSON.stringify(partitionOf(A).map((s) => s.unit_ids)) === JSON.stringify(partitionOf(B).map((s) => s.unit_ids)) : null;
  if (!scenesRaw) review('scene_partition_unavailable', { reason: 'neither pass produced a valid scene partition' });
  const partition = scenesRaw || units.map((u) => ({ unit_ids: [u.unit], intent: u.dataBearing ? 'single_figure' : 'explanation', purpose: null }));

  // scenario partition agreement between passes (structural, id-agnostic)
  if (A && B) {
    const ids = mentions.map((m) => m.id).filter((id) => A.mentions[id] && B.mentions[id] && A.mentions[id].scenario && B.mentions[id].scenario);
    let bad = 0;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const sa = A.mentions[ids[i]].scenario === A.mentions[ids[j]].scenario, sb = B.mentions[ids[i]].scenario === B.mentions[ids[j]].scenario;
      if (sa !== sb) bad++;
    }
    if (bad) review('scenario_partition_disagreement', { pairs: bad, reason: 'the two passes group quantities into scenarios differently' });
  }
  const scriptCadences = new Set(units.flatMap((u) => (u.freqs || []).map((f) => f.cadence)));
  const scenarioLabel = new Map((A.scenarios || []).map((s) => [s.id, gateLabel(cleanLabel(s.label) || upper(s.label), scriptCadences)]));

  // 6. plan each scene
  const outScenes = [];
  const unitById = new Map(units.map((u) => [u.unit, u]));
  const scriptTags = tagsOf(units.map((u) => u.text).join(' '));
  const entsInScene = (unitIds) => entities.filter((e) => unitIds.includes(e.provenance.unit_id));
    const gapEntity = entities.find((e) => e.role === 'gap') || null;
  const shared = (role) => entities.find((e) => e.role === role && !e.scenario);
  const calcsByTarget = new Map();
  verifiedCalcs.forEach((c) => { if (c.target && !calcsByTarget.has(c.target)) calcsByTarget.set(c.target, c); });

  // A supported time basis PROPAGATES through verified arithmetic: the amounts of a verified sum,
  // difference or percentage-share share one basis (a sum of per-year amounts is per-year). It
  // only fills amounts that lack a cadence, and only when exactly one evidenced cadence exists.
  for (let it = 0; it < 3; it++) for (const c of verifiedCalcs) {
    if (c.model !== 'arithmetic' || !['sum', 'difference', 'share_of'].includes(c.params.op)) continue;
    const ents0 = []; const t0 = c.target && entOf.get(c.target); if (t0) ents0.push(t0);
    // a percentage SHARE of a per-period amount is per-period; but a per-period share of a
    // stock amount (a yield on a portfolio) does not make the portfolio per-period: for
    // share_of the basis flows only from the amount (a) to the result
    if (c.params.op === 'share_of') {
      const ai = c.inputs.find((i) => i.param === 'a' && i.id); const ae = ai && entOf.get(ai.id);
      if (strongCad(ae) && t0 && !strongCad(t0) && t0.kind === 'money') { t0.cadence = ae.cadence; t0.cadence_evidence = 'calc_propagated'; }
      continue;
    }
    for (const i of c.inputs) {
      if (!(i.param === 'a' || i.param === 'b')) continue;
      const sub = i.calc && c._all && c._all.get(i.calc);
      const e0 = i.id ? entOf.get(i.id) : sub && sub.target ? entOf.get(sub.target) : null; if (e0) ents0.push(e0);
    }
    const cads = [...new Set(ents0.filter((e) => strongCad(e)).map((e) => e.cadence))];
    if (cads.length !== 1) continue;
    ents0.filter((e) => !strongCad(e) && e.kind === 'money' && !['end_value', 'purchasing_power', 'future_price', 'total_paid', 'interest_paid'].includes((calcsByTarget.get(e.provenance.mention_id) || {}).output)).forEach((e) => { e.cadence = cads[0]; e.cadence_evidence = 'calc_propagated'; });
  }
  // metric identity of a bound entity: { metric, unit, basis, horizon, source }
  const mentionBasis = (id) => {
    const e = entOf.get(id); if (!e) return 'unspecified';
    if (e.role === 'recurring_amount') return e.cadence ? `per_${e.cadence}` : 'periodic_unspecified';
    if (e.role === 'outcome') return (strongCad(e) && e.metric !== 'total_paid' && e.metric !== 'end_value' ? `per_${e.cadence}` : null) || METRIC_BASIS[e.metric] || (e.metric === 'contribution' && e.cadence ? `per_${e.cadence}` : 'unspecified');
    if (['principal', 'baseline_amount', 'transfer_amount', 'upfront_cost', 'income_amount'].includes(e.role)) return 'amount';
    if (['horizon', 'delay_period', 'remaining_period', 'process_window', 'result_duration'].includes(e.role)) return 'duration';
    return 'unspecified';
  };
  const calcBasis = (c) => {
    if (c.model !== 'arithmetic') return OUTPUT_BASIS[c.output] || 'unspecified';
    const op = c.params.op;
    if (op === 'per_period') return `per_${c.params.cadence || 'month'}`;
    if (op === 'annualize') return 'per_year';
    const bs = c.inputs.filter((i) => i.param === 'a' || i.param === 'b').map((i) => (i.id ? mentionBasis(i.id) : c._all && c._all.get(i.calc) ? calcBasis(c._all.get(i.calc)) : 'unspecified'));
    if (op === 'ratio') return 'ratio';
    if (op === 'multiply') return bs.some((b) => b && b.startsWith('per_')) && bs.includes('duration') ? 'lifetime' : 'mixed';
    if (op === 'share_of') return bs[0] || 'unspecified';
    return bs.length && bs.every((b) => b === bs[0]) ? bs[0] : 'mixed';
  };
  const horizonOf = (e) => {
    const c = e.provenance.mention_id && calcsByTarget.get(e.provenance.mention_id);
    if (c && c.params && Number.isFinite(c.params.years)) return c.params.years;
    const h = entities.find((x) => x.role === 'horizon' && x.scenario && x.scenario === e.scenario) || entities.find((x) => x.role === 'horizon' && !x.scenario) || entities.find((x) => x.role === 'horizon' && x.provenance.unit_id === e.provenance.unit_id);
    return h ? toYears(h.value, h.unit) : null;
  };
  const identityOf = (e) => {
    const c = e.provenance.mention_id && calcsByTarget.get(e.provenance.mention_id);
    if (c) {
      let b0 = calcBasis(c);
      // a transform keeps the basis of the amount it restates (real_value / after_tax of a per-month amount)
      if (TRANSFORM_MODELS.has(c.model)) { const ai = c.inputs.find((i) => i.param === 'amount' && i.id); const ae = ai && entOf.get(ai.id); if (strongCad(ae)) b0 = `per_${ae.cadence}`; }
      // a stated cadence on the figure itself wins over a calculation that gives no period ("$1,500 a year")
      if (strongCad(e) && !b0.startsWith('per_') && ['amount', 'unspecified', 'at_horizon', 'one_time'].includes(b0) && !['end_value', 'purchasing_power', 'future_price', 'total_paid', 'interest_paid'].includes(c.output)) b0 = `per_${e.cadence}`;
      return { metric: c.model === 'arithmetic' ? `${c.params.op}_of_calculations` : c.output, unit: e.kind === 'duration' ? e.unit : e.unit || null, basis: b0, horizon: horizonOf(e), source: 'verified_calculation', calc: c.id };
    }
    const basis = e.provenance.kind === 'script' ? mentionBasis(e.provenance.mention_id) : 'derived';
    return { metric: e.metric || null, unit: e.kind === 'duration' ? e.unit : e.unit || null, basis, horizon: e.role === 'outcome' ? horizonOf(e) : null, source: 'model_proposal', calc: null };
  };
  // Are these values the same kind of thing (so they may share bars / a delta)?
  const compatible = (list, { needHorizon = false } = {}) => {
    const ids = list.map(identityOf);
    const why = [];
    if (new Set(list.map((e) => e.kind)).size > 1) why.push('different kinds of quantity');
    if (new Set(ids.map((i) => i.unit)).size > 1) why.push(`different units (${[...new Set(ids.map((i) => i.unit))].join(' vs ')})`);
    const ms = ids.map((i) => i.metric).filter(Boolean);
    if (new Set(ms).size > 1) why.push(`different metrics (${[...new Set(ms)].join(' vs ')})`);
    const bs = ids.map((i) => i.basis).filter((b) => b !== 'unspecified');
    if (new Set(bs).size > 1) why.push(`different time bases (${[...new Set(bs)].join(' vs ')})`);
    if (needHorizon) { const hs = ids.map((i) => i.horizon).filter((h) => h != null); if (new Set(hs.map((h) => +h.toFixed(3))).size > 1) why.push(`different horizons (${[...new Set(hs)].join(' vs ')} years)`); }
    return { ok: why.length === 0, why, ids };
  };

  // ---- structural planning passes (deterministic capability rules) ---------
  const sceneIdxOfUnit = (uid) => partition.findIndex((ps) => ps.unit_ids.includes(uid));
  const SUBSTANTIVE = new Set(['principal', 'recurring_amount', 'transfer_amount', 'baseline_amount', 'upfront_cost', 'income_amount', 'outcome', 'gap', 'change_pct', 'process_window', 'result_duration']);
  const entsOf = (ps) => entities.filter((e) => ps.unit_ids.includes(e.provenance.unit_id));
  const START_ROLES = ['principal', 'baseline_amount', 'upfront_cost'];
  // (a) A non-visual scene whose quantities are INPUTS of a verified
  // calculation whose RESULT is shown in the next scene belongs with that
  // result: the visual that shows the result also shows its inputs.
  for (let i = 0; i < partition.length - 1;) {
    const cur = partition[i], nxt = partition[i + 1];
    const curPlain = ['explanation', 'single_figure'].includes(cur.intent);
    const consumes = curPlain && verifiedCalcs.some((c) => {
      const tgtUnit = c.target && mentionsById.get(c.target) && mentionsById.get(c.target).unit_id;
      if (!tgtUnit || !nxt.unit_ids.includes(tgtUnit)) return false;
      return c.inputs.some((inp) => inp.id && cur.unit_ids.includes((mentionsById.get(inp.id) || {}).unit_id));
    });
    if (consumes && entsOf(cur).some((e) => SUBSTANTIVE.has(e.role))) {
      partition.splice(i, 2, { ...nxt, unit_ids: [...cur.unit_ids, ...nxt.unit_ids], absorbed: [...(nxt.absorbed || []), { from_intent: cur.intent, units: cur.unit_ids, why: 'its quantities are inputs of a verified calculation whose result is shown in the next scene' }] });
    } else i++;
  }
  // (a2) A stated gap that is NOT the difference of the compared results (for
  // example a lifetime total next to monthly payments) must not be drawn as
  // the delta of those bars. When it lives in its own trailing/leading
  // sentence it becomes its own evidence scene; the bars get a delta derived
  // from the bars themselves.
  for (let i = 0; i < partition.length; i++) {
    const ps = partition[i];
    if (!['outcome_comparison', 'start_to_result'].includes(ps.intent)) continue;
    const es = entsOf(ps), outs = es.filter((e) => e.role === 'outcome' && e.kind === 'money'), gaps = es.filter((e) => e.role === 'gap');
    if (outs.length < 2 || !gaps.length) continue;
    const bad = gaps.filter((g) => !outs.some((x, xi) => outs.some((y, yi) => yi > xi && statedMatches(g.value, Math.abs(x.value - y.value), 'money'))));
    if (!bad.length) continue;
    const outUnits = new Set(outs.map((o) => o.provenance.unit_id));
    const badUnits = [...new Set(bad.map((g) => g.provenance.unit_id))].filter((u) => !outUnits.has(u));
    const keep = ps.unit_ids.filter((u) => !badUnits.includes(u));
    const trailing = badUnits.length && keep.length && ps.unit_ids.slice(-badUnits.length).every((u) => badUnits.includes(u));
    if (!trailing) continue;
    partition.splice(i, 1, { ...ps, unit_ids: keep }, { unit_ids: ps.unit_ids.slice(keep.length), intent: 'single_figure', purpose: null, split: { from_intent: ps.intent, why: 'the stated figure is not the difference of the compared results (different metric / time basis), so it is shown as its own evidence instead of as their delta' } });
  }
  // (b) A scene the model called plain explanation that nonetheless holds
  // bound data must not silently render as a presenter-only scene.
  partition.forEach((ps) => {
    if (ps.intent !== 'explanation') return;
    const es = entsOf(ps);
    if (!es.some((e) => SUBSTANTIVE.has(e.role))) return;
    const has = (r) => es.some((e) => r.includes(e.role));
    const to = has(START_ROLES) && has(['outcome']) ? 'start_to_result'
      : has(['recurring_amount', 'transfer_amount', 'principal']) ? 'flow'
      : has(['process_window']) ? 'process_timeline'
      : es.some((e) => e.role === 'change_pct' && e.direction && e.direction !== 'either') ? 'change_over_window'
      : has(['outcome', 'result_duration', 'gap']) ? 'single_figure' : 'explanation';
    if (to !== 'explanation') { ps.promoted = { from: 'explanation', to, why: 'the scene contains bound data quantities that a presenter-only scene would hide' }; ps.intent = to; }
  });

  // The shared assumptions behind a set of compared results: inputs of every
  // arm's verified calculation that have the SAME value in all arms (what stays
  // constant), in reading order. Falls back to script-wide single-valued roles
  // when the arms are not all calculation-backed.
  const SETUP_ORDER = ['principal', 'baseline_amount', 'transfer_amount', 'recurring_amount', 'rate', 'inflation_rate', 'tax_rate', 'fee_rate', 'horizon'];
  const armEnts = (a) => {
    const c = a.pick && calcsByTarget.get(a.pick.provenance.mention_id); if (!c) return null;
    const out = []; const walk = (calc, depth) => { calc.inputs.forEach((i) => { if (i.id && entOf.get(i.id)) out.push(entOf.get(i.id)); else if (i.calc && depth < 4 && calc._all && calc._all.get(i.calc)) walk(calc._all.get(i.calc), depth + 1); }); };
    walk(c, 0); return out;
  };
  const sharedSetup = (arms2, { skip = [] } = {}) => {
    const per = arms2.map(armEnts);
    const out = [];
    const fmt = (e) => (e.role === 'recurring_amount' ? withBasis(e.display, e.cadence ? `per_${e.cadence}` : null) : ['rate', 'inflation_rate', 'tax_rate', 'fee_rate'].includes(e.role) ? `AT ${e.display}` : e.role === 'horizon' ? `OVER ${e.display}` : e.display);
    if (per.every(Boolean)) {
      for (const role of SETUP_ORDER) {
        if (skip.includes(role)) continue;
        const by = per.map((es2) => es2.find((e) => e.role === role));
        if (by.every(Boolean) && new Set(by.map((e) => JSON.stringify(e.value))).size === 1) out.push(fmt(by[0]));
      }
      return out;
    }
    const one = (role) => { const xs = entities.filter((e) => e.role === role); return xs.length && new Set(xs.map((e) => JSON.stringify(e.value))).size === 1 ? xs[0] : null; };
    for (const role of SETUP_ORDER) { if (skip.includes(role)) continue; const e = one(role); if (e) out.push(fmt(e)); }
    return out;
  };

  // y-axis scale for a chart: 0, half and top, each a DERIVED, registered value
  // (top = the largest plotted point; half = top/2), so the axis is labelled
  // and every number on it has provenance.
  // A COMPONENT is a share of an amount (a tax on a gain, interest, a fee, a match): it is
  // never the "after" of that amount, so it is never drawn as before -> after or as a delta.
  const COMPONENT_RATES = new Set(['tax_rate', 'fee_rate', 'match_rate', 'savings_rate']);
  const isComponent = (e) => {
    const c = e.provenance && e.provenance.mention_id && calcsByTarget.get(e.provenance.mention_id); if (!c) return false;
    if (c.output === 'tax_owed' || c.output === 'interest_paid') return true;
    if (c.model === 'arithmetic' && c.params.op === 'share_of') { const bi = c.inputs.find((i) => i.param === 'b' && i.id); const be = bi && entOf.get(bi.id); return !!be && COMPONENT_RATES.has(be.role); }
    return false;
  };
  // START -> RESULT is only honest when the result RESTATES the start: a verified growth / real-value /
  // after-tax calculation fed by the start, or a stated percentage change that the two dollar
  // figures actually imply. A difference of two amounts (a gain), or a share of one (a tax), is
  // not the "after" of anything.
  const feedsFrom = (c, id, depth = 0) => c.inputs.some((i) => i.id === id || (i.calc && depth < 4 && c._all && c._all.get(i.calc) && feedsFrom(c._all.get(i.calc), id, depth + 1)));
  const restates = (b0, a0, pctE) => {
    if (isComponent(a0)) return false;
    if (pctE && b0.kind === 'money' && b0.value > 0 && Math.abs((Math.abs(a0.value - b0.value) / b0.value) * 100 - pctE.value) <= 0.6 && pctE.direction === (a0.value < b0.value ? 'down' : 'up')) return true;
    const c = a0.provenance && a0.provenance.mention_id && calcsByTarget.get(a0.provenance.mention_id);
    if (!c || !feedsFrom(c, b0.provenance.mention_id)) return false;
    return ['compound_growth', 'real_value', 'after_tax'].includes(c.model) && c.output !== 'tax_owed' && c.output !== 'interest_paid';
  };
  // A TRANSFORM pair: the script restates ONE quantity in another form (nominal ->
  // real buying power; gross -> after tax), i.e. a verified calculation whose input is
  // another stated result. That is the contrast the script is drawing.
  const TRANSFORM_MODELS = new Set(['real_value', 'after_tax']);
  const transformPairOf = (es2) => {
    for (const c2 of verifiedCalcs) {
      if (!TRANSFORM_MODELS.has(c2.model) || c2.output === 'tax_owed') continue;
      const t2 = c2.target && entOf.get(c2.target); if (!t2 || !es2.includes(t2) || t2.kind !== 'money') continue;
      for (const inp of c2.inputs) {
        // the restated quantity is fed either as another calculation's output or as the
        // mention that is itself the verified target of another calculation
        const c1 = inp.calc ? (c2._all && c2._all.get(inp.calc)) : inp.id ? calcsByTarget.get(inp.id) : null;
        if (!c1) continue;
        const t1 = c1.verified && c1.target && entOf.get(c1.target);
        if (t1 && es2.includes(t1) && t1.kind === 'money' && t1 !== t2) return { from: t1, to: t2, c1, c2 };
      }
    }
    return null;
  };
  // ONE scenario evaluated at several horizons: verified growth calculations that differ
  // ONLY in years. Drawn as one trajectory with milestone markers, never as rival series.
  const horizonSeriesOf = (arms2) => {
    if (arms2.length < 2 || !arms2.every((a) => a.pick)) return null;
    const cs = arms2.map((a) => calcsByTarget.get(a.pick.provenance.mention_id));
    if (!cs.every((c) => c && c.model === 'compound_growth')) return null;
    const key = (c) => JSON.stringify({ p: c.params.principal || 0, r: c.params.recurring || 0, cad: c.params.cadence || 'month', rate: c.params.rate || 0, fee: c.params.fee || 0, delay: c.params.delay || 0, conv: c.convention });
    if (new Set(cs.map(key)).size !== 1) return null;
    const ys = cs.map((c) => c.params.years);
    if (new Set(ys).size !== ys.length || ys.some((y) => Math.abs(y - Math.round(y)) > 1e-9)) return null;
    return { calcs: cs, years: ys };
  };
  // wording helpers for cards
  const NUMW = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', fifteen: '15', twenty: '20', thirty: '30', forty: '40', fifty: '50' };
  const toks = (t) => String(t || '').toLowerCase().split(/[^a-z0-9$%.]+/).filter(Boolean).map((w) => NUMW[w] || w).map((w) => w.replace(/^\$?([\d,]+)$/, '$1').replace(/s$/, ''));
  const dedupeLabel = (e, label) => {
    if (!label) return '';
    const have = new Set([...toks(e.provenance && e.provenance.span_text), ...toks(e.display)]);
    return toks(label).every((w) => have.has(w)) ? '' : label;
  };
  const CALC_LINE = { runway: 'OF RUNWAY', breakeven: 'TO BREAK EVEN', loan_payoff: 'TO PAY OFF' };
  const lineOfResult = (e) => { const c = e.provenance && e.provenance.mention_id && calcsByTarget.get(e.provenance.mention_id); return (c && CALC_LINE[c.model]) || null; };
  const CALC_TITLE = { runway: 'HOW LONG IT LASTS', breakeven: 'BREAK-EVEN TIME', loan_payoff: 'PAYOFF TIME' };
  const titleOfResult = (e) => { const c = e.provenance && e.provenance.mention_id && calcsByTarget.get(e.provenance.mention_id); return METRIC_TITLE[identityOf(e).metric] || (c && CALC_TITLE[c.model]) || null; };
  const METRIC_TITLE = { end_value: 'FINAL BALANCE', total_paid: 'TOTAL PAID', periodic_payment: 'MONTHLY PAYMENT', after_tax_proceeds: 'AFTER-TAX AMOUNT', tax_owed: 'TAX OWED', purchasing_power: 'BUYING POWER', future_price: 'FUTURE PRICE', interest_paid: 'INTEREST COST' };
  const ROLE_LINE_NOUN = { transfer_amount: 'AMOUNT', recurring_amount: 'REGULAR AMOUNT', rate: 'ANNUAL RATE', fee_rate: 'ANNUAL FEE', tax_rate: 'TAX RATE', inflation_rate: 'INFLATION', savings_rate: 'SAVED', match_rate: 'EMPLOYER MATCH', principal: 'STARTING AMOUNT', baseline_amount: 'CURRENT AMOUNT', income_amount: 'INCOME', upfront_cost: 'UP-FRONT COST', gap: 'DIFFERENCE', change_pct: 'CHANGE' };
  const STAGE_DIRECTION = /^(show|compare|illustrate|display|explain|highlight|demonstrate|introduce|present|emphasi[sz]e|contrast|visuali[sz]e|list|reveal|explore|walk|depict|convey|set up|setup|open)\b/i;

  const niceMax = (v) => { const k = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * k >= v) return m * k; return 10 * k; };
  const scaleTicks = (series, scene, tag) => {
    let top = 0; series.forEach((se) => se.points.forEach((v) => { if (typeof v === 'number' && v > top) top = v; }));
    if (!(top > 0)) return { ticks: [], yMax: null };
    const yMax = niceMax(top);
    const mk = (role, v, formula) => { const e = { id: `v${++seq}`, role, kind: 'money', value: Math.round(v), unit: 'USD', display: fmtMoney(v), scenario: null, provenance: { kind: 'derived', formula, inputs: [] }, confidence: { level: 'derived' } }; entities.push(e); scene.entity_ids.push(e.id); return e; };
    const t = mk(`${tag}_top`, yMax, 'axis maximum: the next round number above the largest plotted value'), h = mk(`${tag}_half`, yMax / 2, 'axis midpoint = axis maximum / 2');
    return { ticks: [{ frac: 0, text: '$0' }, { frac: 0.5, text: h.display }, { frac: 1, text: t.display }], yMax };
  };

  partition.forEach((pscene, si) => {
    const scene = { scene_id: `S${si + 1}`, unit_ids: pscene.unit_ids, narration: { text: pscene.unit_ids.map((id) => unitById.get(id).text).join(' '), first_unit: pscene.unit_ids[0], last_unit: pscene.unit_ids[pscene.unit_ids.length - 1] }, proposed_intent: pscene.intent, purpose: pscene.purpose, entity_ids: [], relationships: [], labels: {}, reveal_steps: [], asset_requirements: [], notes: [] };
    const es = entsInScene(pscene.unit_ids);
    scene.entity_ids = es.map((e) => e.id);
    if (pscene.absorbed) scene.notes.push(...pscene.absorbed.map((a) => ({ merged_scene: a })));
    if (pscene.promoted) scene.notes.push({ promoted: pscene.promoted });
    if (pscene.split) scene.notes.push({ split: pscene.split });
    const text = scene.narration.text; const tags = tagsOf(text);
    let intent = pscene.intent; let p = {}; let treatment; let visual = '';
    const isFirst = si === 0, isLast = si === partition.length - 1;
    const demote = (to, why) => { scene.notes.push({ demoted_from: intent, to, why }); intent = to; };

    // arms: scenario groups holding a result quantity
    const resultRoles = new Set(['outcome', 'result_duration']);
    // a per-period or one-time amount that is the verified RESULT of a
    // calculation (a computed payment) is a result whatever role wording the
    // model chose for it
    const isResult = (e) => resultRoles.has(e.role) || (['recurring_amount', 'transfer_amount'].includes(e.role) && e.provenance.mention_id && (() => { const c = calcsByTarget.get(e.provenance.mention_id); return c && c.model !== 'arithmetic'; })());
    const arms = [];
    // Arms are the model's labelled scenarios. If it labelled none, fall back to
    // STRUCTURE: parallel sentences that each hold results form the arms.
    const anyScn = es.some((e) => isResult(e) && e.scenario);
    // Without model scenario labels, parallel results are separated by
    // structure: different sentences are different arms, and the same kind of
    // result appearing twice in one sentence ("Maya ends with $X, Leo $Y") is
    // two arms too.
    let fromToArms = false;
    const seenInUnit = new Map();
    es.filter((e) => isResult(e)).forEach((e) => {
      const k0 = `${e.provenance.unit_id}|${e.role}|${e.kind}|${identityOf(e).metric || e.metric || ''}`;
      const nth = seenInUnit.get(k0) || 0; seenInUnit.set(k0, nth + 1);
      const sid = e.scenario || (anyScn ? `__${e.id}` : `unit:${e.provenance.unit_id}${nth ? '#' + nth : ''}`);
      let arm = arms.find((a) => a.sid === sid);
      if (!arm) { arm = { sid, scn: e.scenario || null, unit: e.provenance.unit_id, ents: [], label: e.scenario ? (scenarioLabel.get(e.scenario) || null) : null }; arms.push(arm); }
      arm.ents.push(e);
    });
    if (!anyScn && arms.length >= 2) scene.notes.push({ note: 'the model labelled no scenarios; arms were formed from parallel sentences' });
    // "from $90 to $60 a month" / "raises X from $1,400 to $1,610 a month": one
    // per-period amount before and after a change is a two-value comparison
    // (syntactic from…to construction, same cadence, no calculation behind it)
    if (arms.length < 2 && (['single_figure', 'explanation', 'start_to_result', 'outcome_comparison'].includes(intent) || intent === 'change_over_window')) {
      const rec = es.filter((e) => ['recurring_amount', 'outcome'].includes(e.role) && e.kind === 'money' && e.cadence);
      for (let ri = 0; ri + 1 < rec.length; ri++) {
        const x = rec[ri], y = rec[ri + 1];
        if (x.provenance.unit_id !== y.provenance.unit_id || x.cadence !== y.cadence) continue;
        const ut = unitById0.get(x.provenance.unit_id) || '';
        const between = ut.slice(x.provenance.end, y.provenance.start), before = ut.slice(Math.max(0, x.provenance.start - 30), x.provenance.start);
        if (/^\s*(?:a|per|each|every)?\s*(?:day|week|month|quarter|year)?\s*to\s*$/i.test(between) && /\bfrom\s+(?:about\s+|roughly\s+)?$/i.test(before)) {
          const dl = x.label && y.label && x.label !== y.label ? [x.label, y.label] : ['BEFORE', 'AFTER'];
          arms.length = 0; arms.push({ sid: `from:${x.id}`, scn: null, unit: x.provenance.unit_id, ents: [x], label: dl[0] }, { sid: `to:${y.id}`, scn: null, unit: y.provenance.unit_id, ents: [y], label: dl[1] });
          scene.notes.push({ note: 'a "from A to B" per-period amount was drawn as a before/after comparison' }); fromToArms = true;
          if (intent !== 'outcome_comparison') { scene.notes.push({ promoted: { from: intent, to: 'outcome_comparison', why: 'a from-A-to-B change of one per-period amount' } }); intent = 'outcome_comparison'; }
          break;
        }
      }
    }
    // A comparison must use a result of the SAME type in every scenario (a
    // duration must not be compared with a dollar amount). Pick the first
    // result type, in narration order, that every arm has.
    if (arms.length >= 2) {
      const keyOf = (e) => `${e.role}|${e.kind}|${identityOf(e).metric || e.metric || ''}`;
      let keyFn = keyOf;
      let commonKey = arms[0].ents.map(keyFn).find((k) => arms.every((a) => a.ents.some((e) => keyFn(e) === k)));
      // if the metrics were labelled inconsistently, fall back to role+kind; the
      // metric/time-basis compatibility gate below still decides comparability
      if (!commonKey) { keyFn = (e) => `${e.role}|${e.kind}`; commonKey = arms[0].ents.map(keyFn).find((k) => arms.every((a) => a.ents.some((e) => keyFn(e) === k))); }
      arms.forEach((a) => { a.pick = commonKey ? a.ents.find((e) => keyFn(e) === commonKey) : null; });
      if (fromToArms) arms.forEach((a) => { a.pick = a.ents[0]; });
      if (commonKey) {
        const others = [...new Set(arms[0].ents.map(keyFn))].filter((k) => k !== commonKey);
        if (others.length) scene.notes.push({ note: 'other result types were not shown', not_shown: others });
      }
      // Scenario identity. What differs between the scenarios is found from the
      // DETERMINISTIC calculations behind the drawn results (the parameter whose
      // source quantity differs between arms), falling back to the model's
      // scenario membership. The differing quantity labels arms the model left
      // unlabelled or labelled non-distinctly, and is appended to labels that
      // do not already state it.
      const DIFF_ROLES = ['delay_period', 'rate', 'fee_rate', 'tax_rate', 'inflation_rate', 'savings_rate', 'match_rate', 'recurring_amount', 'principal', 'horizon'];
      const ROLE_NOUN = { rate: 'RATE', fee_rate: 'FEE', tax_rate: 'TAX', inflation_rate: 'INFLATION', savings_rate: 'SAVED', match_rate: 'MATCH', delay_period: 'DELAY', recurring_amount: '', principal: '', horizon: '' };
      const diffByCalc = () => {
        const per = arms.map((a) => armEnts(a));
        if (!per.every(Boolean)) return null;
        // per arm: the input(s) that are NOT the same in every arm (a different
        // value, or present in only some arms), by role priority
        const pickFor = (es2, idx) => {
          for (const role of DIFF_ROLES) {
            const e = es2.find((x) => x.role === role); if (!e) continue;
            const sameEverywhere = per.every((o) => o.some((x) => x.role === role && JSON.stringify(x.value) === JSON.stringify(e.value)));
            if (!sameEverywhere) return e;
          }
          return null;
        };
        const by = per.map(pickFor);
        return by.every(Boolean) && new Set(by.map((e) => `${e.role}|${JSON.stringify(e.value)}`)).size === arms.length ? by : null;
      };
      const diffByScenario = () => {
        for (const role of DIFF_ROLES) {
          const by = arms.map((a) => entities.find((e) => e.role === role && ((a.scn && e.scenario === a.scn) || (e.provenance.unit_id === a.unit))));
          if (by.every(Boolean) && new Set(by.map((e) => JSON.stringify(e.value))).size === arms.length) return by;
        }
        return null;
      };
      // a distinct per-result label from the model ("MAYA ENDING BALANCE") is the
      // scenario name when the arms carry none
      if (arms.some((a) => !a.label)) { const pl = arms.map((a) => a.pick && a.pick.label); if (pl.every(Boolean) && new Set(pl).size === arms.length) arms.forEach((a, i) => { if (!a.label) a.label = pl[i]; }); }
      const diffs = diffByCalc() || diffByScenario();
      const dText = (e) => withBasis(e.display, e.role === 'recurring_amount' && e.cadence ? `per_${e.cadence}` : null);
      const dLabel = (e) => `${dText(e)}${ROLE_NOUN[e.role] ? ' ' + ROLE_NOUN[e.role] : ''}`.trim();
      if (diffs) {
        arms.forEach((a, i) => { a.diffEntity = diffs[i]; });
        const lbls = arms.map((a) => a.label);
        const distinct = lbls.every(Boolean) && new Set(lbls).size === lbls.length;
        arms.forEach((a, i) => {
          const e = diffs[i];
          if (!distinct) { a.label = dLabel(e); return; }
          const lab = String(a.label).toLowerCase();
          const spanTokens = String(e.provenance.span_text || '').toLowerCase().split(/[^a-z0-9$%.,]+/).filter((t) => t.length >= 3 || /\d/.test(t));
          const stated = spanTokens.some((t) => lab.includes(t)) || /\d/.test(lab);
          if (!stated && (a.label + ' ' + dText(e)).length <= 34) a.label = `${a.label} ${dText(e)}`;
        });
      }
      // labels must be unique and present, whatever their source
      if (arms.some((a) => !a.label) || new Set(arms.map((a) => a.label)).size !== arms.length) arms.forEach((a, i) => { a.label = `OPTION ${String.fromCharCode(65 + i)}`; scene.notes.push({ note: 'scenario labels were missing or not distinct; neutral labels used' }); });
    } else arms.forEach((a) => { a.pick = a.ents[0]; });
    if (['single_figure', 'explanation'].includes(intent) && arms.length >= 2 && arms.every((a) => a.pick)) {
      const growth = arms.every((a) => { const c = calcsByTarget.get(a.pick.provenance.mention_id); return c && c.model === 'compound_growth'; });
      const to = growth ? 'trajectory_comparison' : 'outcome_comparison';
      scene.notes.push({ promoted: { from: intent, to, why: 'two or more comparable results in different scenarios are bound; a card listing them would bury the comparison' } }); intent = to;
    }
    // A percentage change that comes WITH the underlying dollar figures is drawn on
    // those figures (before -> after, with the percent kept in the delta), not
    // reduced to a bare "+20%" chart.
    const pctEntity = es.find((e) => e.role === 'change_pct' && e.direction && e.direction !== 'either') || null;
    if (intent === 'change_over_window' && pctEntity && arms.length < 2) {
      const st0 = es.find((e) => START_ROLES.includes(e.role) && e.kind === 'money'), res0 = es.filter((e) => e.role === 'outcome' && e.kind === 'money');
      if (st0 && res0.length) { scene.notes.push({ promoted: { from: intent, to: 'start_to_result', why: 'the script gives the percentage change together with the before and after dollar figures' } }); intent = 'start_to_result'; }
    }
    // message-aware contrast: one quantity restated in another form is THE comparison
    let usePair = null;
    if (['start_to_result', 'single_figure', 'explanation', 'outcome_comparison'].includes(intent)) {
      usePair = transformPairOf(es);
      if (usePair) { if (intent !== 'outcome_comparison') scene.notes.push({ promoted: { from: intent, to: 'outcome_comparison', why: 'the script restates one quantity in another form; that pair (not the starting principal) is the contrast it draws' } }); intent = 'outcome_comparison'; }
    }
    // START NOW vs START LATER: a stated delay is the causal point, never "two milestones".
    // Two verified growth calculations that differ only in how long they run, with a bound
    // delay equal to that difference, are ONE contribution stream started at two times on a
    // common calendar; the shorter run is the later start. Anything else that mentions a
    // delay next to differing horizons is not drawn (fail safe).
    let delayMode = null;
    const delayE = es.find((e) => e.role === 'delay_period' && e.kind === 'duration' && !Array.isArray(e.value));
    if (delayE && arms.length === 2 && arms.every((a) => a.pick) && ['outcome_comparison', 'trajectory_comparison', 'single_figure', 'explanation'].includes(intent)) {
      const cs = arms.map((a) => calcsByTarget.get(a.pick.provenance.mention_id));
      if (cs.every((c) => c && c.model === 'compound_growth')) {
        const strip = (c) => JSON.stringify({ p: c.params.principal || 0, r: c.params.recurring || 0, cad: c.params.cadence || 'month', rate: c.params.rate || 0, fee: c.params.fee || 0 });
        const ys = cs.map((c) => c.params.years), ds = cs.map((c) => c.params.delay || 0);
        const dY = toYears(delayE.value, delayE.unit);
        if (strip(cs[0]) === strip(cs[1]) && ds[0] === 0 && ds[1] === 0 && ys[0] !== ys[1]) {
          const iL = ys[0] > ys[1] ? 0 : 1, iS = 1 - iL;
          const eff = cs.map((c, i) => (i === iS ? { ...c.params, years: ys[iL], delay: dY } : { ...c.params }));
          const okEnd = Math.abs(ys[iL] - ys[iS] - dY) < 1e-9 && eff.every((pr, i) => compute('compound_growth', { ...pr, cadence: pr.cadence || 'month' }, 'end_value').some((k) => k.convention === cs[i].convention && statedMatches(arms[i].pick.value, k.value, 'money')));
          if (okEnd) delayMode = { eff, laterIdx: iS, delayE };
          else { review('delay_relation_unverified', { delay: delayE.id, reason: 'the stated delay is not the difference between the two runs, or the delayed schedule does not reproduce the stated result' }); demote('single_figure', 'a stated delay could not be tied to the two results'); }
        }
      }
    }
    if (delayMode && intent !== 'trajectory_comparison') { scene.notes.push({ promoted: { from: intent, to: 'trajectory_comparison', why: 'a start-now vs start-later contrast on one contribution stream' } }); intent = 'trajectory_comparison'; }
    // one scenario at several horizons: one trajectory with milestones
    let msMode = null;
    if (!usePair && !delayE && ['outcome_comparison', 'trajectory_comparison', 'single_figure', 'explanation'].includes(intent)) {
      msMode = horizonSeriesOf(arms);
      if (msMode) { if (intent !== 'trajectory_comparison') scene.notes.push({ promoted: { from: intent, to: 'trajectory_comparison', why: 'one scenario evaluated at several horizons: a single trajectory with milestone markers' } }); intent = 'trajectory_comparison'; }
    }
    let restatingPairs = [];
    if (intent === 'start_to_result') {
      const starts0 = es.filter((e) => START_ROLES.includes(e.role) && e.kind === 'money'), res0 = es.filter((e) => e.role === 'outcome' && e.kind === 'money' && !isComponent(e));
      starts0.forEach((s0) => res0.forEach((r0) => { if (restates(s0, r0, pctEntity)) restatingPairs.push([s0, r0]); }));
      if (!restatingPairs.length) demote('single_figure', 'no result restates the starting amount (a gain, tax, interest or fee is a component, not the "after"); shown as evidence, not as a before/after');
    }
    if (intent === 'start_to_result' && !(es.some((e) => START_ROLES.includes(e.role)) && es.some((e) => e.role === 'outcome'))) demote('single_figure', 'needs a starting figure and a result in the same scene');
    if ((intent === 'trajectory_comparison' || intent === 'outcome_comparison') && !usePair) {
      if (arms.length < 2) demote(arms.length === 1 ? 'single_figure' : 'explanation', 'fewer than two comparable results were bound');
      else if (arms.some((a) => !a.pick)) demote('single_figure', 'the scenarios have no result type in common, so they cannot be compared');
    }
    if (intent === 'outcome_comparison' && !usePair && arms.length >= 2 && arms.every((a) => a.pick)) {
      const cp = compatible(arms.map((a) => a.pick), { needHorizon: true });
      if (!cp.ok) { scene.notes.push({ comparison_not_drawn: cp.why, identities: cp.ids }); demote('single_figure', `the results are not the same metric / time basis, so they are not drawn as comparable bars: ${cp.why.join('; ')}`); }
    }
    if (intent === 'trajectory_comparison' && !msMode && arms.length >= 2 && arms.every((a) => a.pick)) {
      const cp = compatible(arms.map((a) => a.pick));
      if (!cp.ok) { scene.notes.push({ comparison_not_drawn: cp.why, identities: cp.ids }); demote('single_figure', `the trajectories are not the same metric, so they are not drawn on one chart: ${cp.why.join('; ')}`); }
    }
    // parts of a stated total are not two scenarios: a verified sum whose inputs are the compared
    // results (and whose total is stated in the scene) is a breakdown, shown with its total
    if (['outcome_comparison', 'trajectory_comparison'].includes(intent) && !usePair && !msMode && !delayMode && arms.length >= 2 && arms.every((a) => a.pick)) {
      const pickIds = new Set(arms.map((a) => a.pick.provenance.mention_id));
      const isParts = verifiedCalcs.some((c) => c.model === 'arithmetic' && c.params.op === 'sum' && c.target && es.some((e) => e.provenance.mention_id === c.target) && !pickIds.has(c.target) && [...pickIds].every((pid) => c.inputs.some((i) => (i.id && i.id === pid) || (i.calc && c._all && c._all.get(i.calc) && c._all.get(i.calc).target === pid))));
      if (isParts) { scene.notes.push({ parts_of_total: [...pickIds] }); demote('single_figure', 'the compared amounts are the parts of a stated total (a breakdown), not scenarios'); }
    }
    if (intent === 'trajectory_comparison') {
      const armCalcs = arms.map((a) => calcsByTarget.get(a.pick.provenance.mention_id));
      if (armCalcs.some((c) => !c || c.model !== 'compound_growth')) demote('outcome_comparison', 'no verified growth calculation for every scenario, so no chart can be derived');
    }
    if ((intent === 'change_over_window') && !es.some((e) => e.role === 'change_pct')) demote('explanation', 'no bound percentage change');
    if (intent === 'breakeven') { const bc = verifiedCalcs.find((c) => c.model === 'breakeven'); if (!bc) demote('single_figure', 'no verified break-even calculation'); }
    const flowAmount = (e) => ['recurring_amount', 'transfer_amount', 'principal'].includes(e.role) || (e.role === 'outcome' && e.metric === 'contribution');
    if (intent === 'flow' && !es.some(flowAmount)) demote(es.some((e) => SUBSTANTIVE.has(e.role)) ? 'single_figure' : 'explanation', 'no amount bound to move');
    if (intent === 'flow') {
      // a money-flow arrow is a real TRANSFER: both endpoints proposed and named in the
      // script, a movement expression in the scene's own words, and the destination is
      // not simply the amount's own name (SHARES -> CAPITAL GAIN is a label, not a transfer)
      const sceneTxt = pscene.unit_ids.map((id) => unitById.get(id).text).join(' ');
      const scriptLow = units.map((u) => u.text).join(' ').toLowerCase();
      const fromP = upper(pscene.from_label, 22), toP = upper(pscene.to_label, 22);
      const named = (lab) => !!lab && String(lab).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3).some((w) => scriptLow.includes(w.replace(/s$/, '')));
      const MOVE = MOVE_RE;
      const amtE = es.find(flowAmount);
      const ownName = amtE && amtE.label && [fromP, toP].some((x) => x && cleanLabel(amtE.label) && x === cleanLabel(amtE.label));
      const why = [!fromP || !toP ? 'endpoints not proposed' : null, fromP && toP && fromP === toP ? 'same endpoint' : null, fromP && !named(fromP) ? 'source not named in the script' : null, toP && !named(toP) ? 'destination not named in the script' : null, !MOVE.test(sceneTxt) ? 'no movement expression in the scene' : null, ownName ? 'an endpoint is just the amount\'s own name' : null].filter(Boolean);
      if (why.length) { scene.notes.push({ flow_not_drawn: why }); demote('single_figure', `no supported transfer between a named source and destination: ${why.join('; ')}`); }
    }
    if (intent === 'flow') {
      const movable = [...new Map(es.filter(flowAmount).map((e) => [JSON.stringify(e.value), e])).values()];
      if (movable.length > 1) { scene.notes.push({ flow_not_drawn: movable.map((e) => e.id) }); demote('single_figure', 'more than one distinct amount could be the amount that moves (parts and a total, or several flows); a single flow arrow would attach the wrong amount to the source'); }
    }
    if (intent === 'process_timeline' && !es.some((e) => e.role === 'process_window')) demote('explanation', 'no bound process window');
    if (intent === 'consequence_units' && !(entities.some((e) => e.role === 'change_pct' && e.direction && e.direction !== 'either') && es.some((e) => e.kind === 'money'))) demote('explanation', 'needs a bound directional price change and an amount');
    if (['presenter_hook', 'presenter_conclusion', 'explanation'].includes(intent) && es.some((e) => DATA_ROLES.has(e.role) && !['horizon', 'delay_period', 'rate'].includes(e.role))) {
      if (isFirst || isLast) scene.notes.push({ note: 'presenter scene also contains bound data quantities that are not visualised', roles: es.map((e) => e.role) });
    }

    const sign = (a, b) => (b - a >= 0 ? '+' : '-');
    if (['presenter_hook', 'presenter_conclusion', 'explanation'].includes(intent)) {
      treatment = 'avatar_panel'; p = { treatment, text, isCta: isLast };
      const gap = gapEntity;
      const cmpArms = (() => { const all = entities.filter((e) => e.role === 'outcome' && e.scenario); const ids = [...new Set(all.map((e) => e.scenario))]; return ids.length >= 2 ? [all.find((e) => e.scenario === ids[0]), all.find((e) => e.scenario === ids[ids.length - 1])] : null; })();
      const gsign = cmpArms ? sign(cmpArms[0].value, cmpArms[1].value) : '-';
      if (isFirst && !isLast) {
        const icon = tags.includes('delay') ? ASSET.icon.hourglass : tags.includes('dividend') ? ASSET.icon.coins : tags.includes('loan') ? ASSET.icon.house : null;
        if (icon) p.contextIconConcept = icon;
        if (gap && /\b(cost|lose|miss|hidden|risk|price)\b/i.test(text)) p.contextCaption = `${gap.display} AT STAKE`;
      } else if (isLast) {
        // context icon from what the WHOLE script is about (not from one
        // sentence, and never a topic's icon on another topic's script)
        const st = scriptTags;
        p.contextIconConcept = st.includes('loan') ? ASSET.icon.house : (st.includes('cost') || gap) && (st.includes('dividend') || st.includes('invest')) ? ASSET.icon.certificate_loss : st.includes('delay') ? ASSET.icon.hourglass : undefined;
        if (!p.contextIconConcept) delete p.contextIconConcept;
        // caption: the signed figure AND what it is (a bare "+$71,012" is unlabeled)
        if (gap) { const lab = gap.label && `${gsign}${gap.display} ${gap.label}`.length <= 30 ? ` ${gap.label}` : ''; p.contextCaption = `${gsign}${gap.display}${lab}`; }
      }
      visual = 'presenter scene'; scene.asset_requirements = p.contextIconConcept ? [{ type: 'icon', concept: p.contextIconConcept, reuse_first: true }] : [];
    } else if (intent === 'flow') {
      treatment = 'money_flow';
      const m = es.find(flowAmount);
      const bg = m.role === 'principal' && tags.includes('loan') ? ASSET.bg.flow_loan : m.role === 'transfer_amount' && tags.includes('dividend') ? ASSET.bg.flow_dividend : ASSET.bg.flow_contribution;
      const from = upper(pscene.from_label, 22), to = upper(pscene.to_label, 22);
      if (!from || !to) scene.notes.push({ note: 'flow endpoints were not proposed; neutral defaults used' });
      p = { treatment, text, fromLabel: from || 'YOU', toLabel: to || 'ACCOUNT', amountText: m.role === 'recurring_amount' && m.cadence ? `${m.display}/${CADENCE_ABBR[m.cadence] || 'PD'}` : m.display, fromIconConcept: ASSET.icon.cash, toIconConcept: ASSET.icon.tower, bgConcept: bg, meaning_event_pattern: meaningEventPattern(m.provenance.span_text) };
      visual = `money moves ${p.fromLabel} -> ${p.toLabel}; amount ${p.amountText} pops on arrival`;
      scene.asset_requirements = [{ type: 'icon', concept: p.fromIconConcept, reuse_first: true }, { type: 'icon', concept: p.toIconConcept, reuse_first: true }, { type: 'scene_bg', concept: bg, reuse_first: true }];
      scene.labels = { from: p.fromLabel, to: p.toLabel, amount: p.amountText };
      scene.flow = { movement_cue: true, from_evidence: true, to_evidence: true, amount_entity: m.id, movable_entities: [...new Set(es.filter(flowAmount).map((e) => e.id))], from: p.fromLabel, to: p.toLabel, from_proposed: !!from, to_proposed: !!to };
    } else if (intent === 'process_timeline') {
      treatment = 'day_cards';
      const m = es.find((e) => e.role === 'process_window'); const hi = upperBound(m.value); const u = m.unit.toUpperCase();
      const idxs = hi <= 3 ? Array.from({ length: hi + 1 }, (_, i) => i) : [0, Math.round(hi / 3), Math.round((2 * hi) / 3), hi];
      const objM = text.match(/(?:process|settle|clear|complete|finish|arrive|reinvest)\w*\s+(?:the\s+|your\s+|a\s+)?([a-z]+)/i);
      const obj = objM ? objM[1][0].toUpperCase() + objM[1].slice(1) : null;
      idxs.forEach((d) => { const e = { id: `v${++seq}`, role: 'timeline_position', kind: 'count', value: d, unit: m.unit, display: String(d), scenario: null, provenance: { kind: 'derived', formula: 'evenly spaced positions from 0 to the stated process window', inputs: [m.id] }, confidence: { level: 'derived' } }; entities.push(e); scene.entity_ids.push(e.id); });
      p = { treatment, text, heroText: fmtDur(m.value, m.unit), heroSub: obj ? `Until ${obj}` : 'Until Complete', days: idxs.map((d, i) => ({ label: `${u} ${d}`, sub: i === 0 ? 'Start' : i === idxs.length - 1 ? 'Complete' : 'In Progress' })), bgConcept: ASSET.bg.process, meaning_event_pattern: meaningEventPattern(m.provenance.span_text) };
      visual = 'timeline of cards revealing period by period'; scene.asset_requirements = [{ type: 'scene_bg', concept: ASSET.bg.process, reuse_first: true }];
    } else if (intent === 'change_over_window') {
      const m = es.find((e) => e.role === 'change_pct');
      if (!m.direction || m.direction === 'either') {
        treatment = 'calc_card'; p = { treatment, text, title: 'PERCENTAGE CHANGE', values: [`${m.display} (DIRECTION NOT STATED)`] };
        visual = 'value card only: direction of the change is not stated, so no chart is drawn';
      } else {
        treatment = 'stock_chart'; const down = m.direction === 'down';
        const yT = down ? [{ frac: 1, text: '0%' }, { frac: 0, text: `-${m.display}` }] : [{ frac: 0, text: '0%' }, { frac: 1, text: `+${m.display}` }];
        p = { treatment, text, label: m.label || 'PRICE CHANGE', yTicks: yT, direction: m.direction, changeText: `${down ? '-' : '+'}${m.display}`, series: [{ label: m.label || 'CHANGE', color: down ? '0xb0413e' : '0xa67c2e', points: Array.from({ length: 9 }, (_, i) => +((down ? 8 - i : i) * m.value / 8).toFixed(3)), finalValueText: `${down ? '-' : '+'}${m.display}` }], axisStartLabel: 'START', axisEndLabel: 'END', bgConcept: down ? ASSET.bg.price_down : ASSET.bg.price_up, meaning_event_pattern: meaningEventPattern(m.provenance.span_text) };
        scene.change = { entity_id: m.id, direction: m.direction };
        visual = `change plotted from start: ${down ? 'falls' : 'rises'} ${m.display}`; scene.asset_requirements = [{ type: 'scene_bg', concept: p.bgConcept, reuse_first: true }];
      }
    } else if (intent === 'trajectory_comparison' && msMode) {
      treatment = 'stock_chart';
      const order = arms.map((a, i) => ({ a, i, y: msMode.years[i] })).sort((x, y) => x.y - y.y);
      const cLong = msMode.calcs[order[order.length - 1].i];
      const pr = { ...cLong.params, cadence: cLong.params.cadence || 'month' };
      const pts = growthSeries(pr, cLong.convention);
      const milestones = order.map((o) => { const he = (armEnts(o.a) || []).find((e) => e.role === 'horizon'); return { index: Math.round(o.y), valueText: o.a.pick.display, label: `AFTER ${he ? he.display : Math.round(o.y) + ' YEARS'}`, entity_id: o.a.pick.id }; });
      const yUnit = (entities.find((e) => e.role === 'horizon') || { unit: 'year' }).unit.toUpperCase();
      const series = [{ label: '', color: '0xa67c2e', points: pts, finalValueText: '' }];
      const sc0 = scaleTicks(series, scene, 'chart_scale');
      const setupTxt = fitTokens(sharedSetup(arms, { skip: ['horizon'] }), 56);
      p = { treatment, text, label: 'BALANCE OVER TIME', subLabel: setupTxt || undefined, series, milestones: milestones.map(({ index, valueText, label }) => ({ index, valueText, label })), yTicks: sc0.ticks, yMax: sc0.yMax || undefined, axisStartLabel: `${yUnit} 0`, axisEndLabel: `${yUnit} ${Math.round(pr.years)}`, bgConcept: ASSET.bg.trajectory, meaning_event_pattern: meaningEventPattern(arms[arms.length - 1].pick.provenance.span_text) };
      if (!p.subLabel) delete p.subLabel;
      visual = `ONE trajectory from a verified growth calculation with a milestone marker at each stated horizon (${milestones.map((m) => m.label).join(', ')}); each value sits on its own point in time`;
      scene.labels = { milestones: milestones.map((m) => `${m.label}: ${m.valueText}`), axis: [p.axisStartLabel, p.axisEndLabel], y: sc0.ticks.map((t) => t.text) }; scene.asset_requirements = [{ type: 'scene_bg', concept: ASSET.bg.trajectory, reuse_first: true }];
      scene.comparison = { form: 'milestones', metric: 'end_value', values: order.map((o, k) => ({ entity_id: o.a.pick.id, identity: identityOf(o.a.pick), label: milestones[k].label, shown: o.a.pick.display, index: milestones[k].index })), delta: null, scenario_labels: milestones.map((m) => m.label) };
      order.forEach((o, k) => scene.relationships.push({ type: 'milestone_on_trajectory', at: milestones[k].label, formula: 'compound_growth', calc: msMode.calcs[o.i].id }));
    } else if (intent === 'trajectory_comparison') {
      treatment = 'stock_chart';
      const colors = ['0xa67c2e', '0x1a2744', '0x6b7280'];
      const series = []; let Y = 0, markerIndex = null;
      if (delayMode) {
        // scenario identities that state the delay explicitly
        const dl = arms.map((a, ai) => {
          const later = ai === delayMode.laterIdx, lab = a.label || '';
          const said = later ? /later|delay|wait|late|postpone|behind|off/i.test(lab) : /now|today|start|early|immediate/i.test(lab);
          return said && lab.length <= 34 ? lab : (later ? `START ${delayMode.delayE.display} LATER` : 'START NOW');
        });
        if (new Set(dl).size === 2) arms.forEach((a, ai) => { a.label = dl[ai]; }); else arms.forEach((a, ai) => { a.label = ai === delayMode.laterIdx ? `START ${delayMode.delayE.display} LATER` : 'START NOW'; });
      }
      arms.forEach((a, ai) => {
        const c = calcsByTarget.get(a.pick.provenance.mention_id);
        const pr = { ...(delayMode ? delayMode.eff[ai] : c.params), cadence: c.params.cadence || 'month' };
        const pts = growthSeries(pr, c.convention);
        Y = Math.max(Y, Math.round(pr.years));
        if (pr.delay > 0) markerIndex = Math.round(pr.delay);
        series.push({ label: a.label || `SCENARIO ${String.fromCharCode(65 + ai)}`, color: colors[ai] || colors[2], points: pts, finalValueText: a.pick.display });
      });
      const yUnit = (entities.find((e) => e.role === 'horizon') || { unit: 'year' }).unit.toUpperCase();
      const shareSetup = sharedSetup(arms);
      const sc0 = scaleTicks(series, scene, 'chart_scale'), yTicks = sc0.ticks;
      p = { treatment, text, label: 'BALANCE OVER TIME', subLabel: fitTokens(shareSetup, 56) || undefined, series, yTicks, yMax: sc0.yMax || undefined, axisStartLabel: `${yUnit} 0`, axisEndLabel: `${yUnit} ${Y}`, bgConcept: ASSET.bg.trajectory, meaning_event_pattern: meaningEventPattern(arms[arms.length - 1].pick.provenance.span_text) };
      if (!p.subLabel) delete p.subLabel;
      if (markerIndex) { p.markerIndex = markerIndex; p.markerLabel = delayMode ? `${delayMode.delayE.display} DELAY` : `${markerIndex}-${yUnit} DELAY`; }
      visual = `${series.length} scenarios drawn from verified growth calculations on one axis with a labelled $ scale; end values labelled`;
      scene.labels = { series: series.map((s) => s.label), axis: [p.axisStartLabel, p.axisEndLabel], y: yTicks.map((t) => t.text) }; scene.asset_requirements = [{ type: 'scene_bg', concept: ASSET.bg.trajectory, reuse_first: true }];
      scene.comparison = { form: 'chart', metric: 'end_value', values: arms.map((a) => ({ entity_id: a.pick.id, identity: identityOf(a.pick), label: a.label, shown: a.pick.display })), delta: null, delay: delayMode ? { entity_id: delayMode.delayE.id, years: toYears(delayMode.delayE.value, delayMode.delayE.unit), later_index: delayMode.laterIdx } : null, scenario_labels: series.map((x) => x.label) };
      series.forEach((s, i) => scene.relationships.push({ type: 'derived_trajectory', series: s.label, formula: 'compound_growth', calc: calcsByTarget.get(arms[i].pick.provenance.mention_id).id }));
    } else if (intent === 'outcome_comparison' || intent === 'start_to_result') {
      treatment = 'share_compare';
      let first, last, b, a, relation = null;
      const ENDPOINT_RANK = ['end_value', 'purchasing_power', 'future_price', 'after_tax_proceeds', 'total_paid'];
      if (usePair) {
        b = usePair.from; a = usePair.to;
        const MET_LABEL = { end_value: 'NOMINAL BALANCE', purchasing_power: "TODAY'S BUYING POWER", after_tax_proceeds: 'AFTER TAX', future_price: 'FUTURE PRICE', tax_owed: 'TAX' };
        const lb = cleanLabel(b.label), la = cleanLabel(a.label);
        const ok = lb && la && lb !== la;
        first = { label: ok ? lb : (MET_LABEL[usePair.c1.output] || 'BEFORE') }; last = { label: ok ? la : (MET_LABEL[usePair.c2.output] || 'AFTER') };
        relation = { type: 'transform', from_entity: b.id, to_entity: a.id };
        Object.defineProperty(relation, '_c1', { value: usePair.c1 }); Object.defineProperty(relation, '_c2', { value: usePair.c2 });
      } else if (intent === 'start_to_result') {
        b = restatingPairs.length ? restatingPairs[0][0] : es.find((e) => START_ROLES.includes(e.role));
        // the result that ends the story: an endpoint metric (final balance, buying power,
        // after-tax amount) outranks a component (tax owed, interest); else the last stated
        const outs = restatingPairs.length ? restatingPairs.filter((pr) => pr[0] === b).map((pr) => pr[1]) : es.filter((e) => e.role === 'outcome' && !isComponent(e));
        const rank = (e) => { const m = identityOf(e).metric; const r = ENDPOINT_RANK.indexOf(m); return r < 0 ? 99 : r; };
        a = outs.slice().sort((x, y) => rank(x) - rank(y) || outs.indexOf(y) - outs.indexOf(x))[0];
        first = { label: b.label || 'START' }; last = { label: a.label || 'RESULT' };
      } else {
        first = arms[0]; last = arms[arms.length - 1];
        if (arms.length > 2) scene.notes.push({ note: `${arms.length} scenarios present; the first and last are shown` });
        b = first.pick; a = last.pick;
      }
      const idB = identityOf(b), idA = identityOf(a);
      // a from-A-to-B change of one amount is about that amount, not about whatever result metric the model attached
      const metric = fromToArms ? null : usePair ? (idA.metric || null) : (idB.metric || idA.metric || b.metric || a.metric || null);
      const basis = idB.basis !== 'unspecified' ? idB.basis : idA.basis;
      const gapE = es.find((e) => e.role === 'gap') || null;
      const dAbs = Math.abs(a.value - b.value);
      const dKind = b.kind === 'money' ? 'money' : b.kind === 'duration' ? 'duration' : 'count';
      // A stated gap is attached as the delta only if it IS the difference of
      // the two drawn results; otherwise the delta is derived from the bars.
      const statedOK = !!(gapE && statedMatches(gapE.value, dAbs, dKind));
      // A stated gap that is a different measure (a yearly or lifetime total next
      // to per-period bars) and could not be split into its own scene is shown as
      // an explicitly labelled SECOND line under the delta, never as the delta —
      // and only when a deterministic calculation reproduces it.
      let deltaNote = null, noteEntity = null;
      if (gapE && !statedOK && intent === 'outcome_comparison') {
        const gi = identityOf(gapE);
        if (gi.source === 'verified_calculation' && gi.basis && gi.basis !== 'unspecified' && gi.basis !== 'mixed' && gi.basis !== basis) {
          const hz1 = entities.find((e) => e.role === 'horizon' && !e.scenario);
          const tail = gi.basis.startsWith('per_') ? basisSuffix(gi.basis) : gi.basis === 'lifetime' && hz1 ? ` OVER ${hz1.display}` : ' IN TOTAL';
          deltaNote = `= ${gapE.display}${tail}`; noteEntity = gapE;
        }
      }
      if (gapE && !statedOK && !noteEntity) review('stated_gap_not_shown', { gap: gapE.id, raw: gapE.provenance.span_text, reason: 'the stated gap is not the difference of the compared results (different metric / time basis) and could not be separated into its own scene; the delta shown is derived from the bars' });
      const dir = a.value < b.value ? 'down' : a.value > b.value ? 'up' : 'flat';
      const good = GOOD_DIRECTION[metric];
      const tone = dir === 'flat' ? 'neutral' : good ? (dir === good ? 'positive' : 'negative') : 'neutral';
      const setup = intent === 'start_to_result' || usePair ? [] : fromToArms ? [] : sharedSetup(arms);
      if (intent === 'start_to_result' || usePair) {
        const hz = es.find((e) => e.role === 'horizon') || entities.find((e) => e.role === 'horizon');
        if (hz) setup.push(`OVER ${hz.display}`);
        const RL = { rate: 'AT', inflation_rate: 'INFLATION', tax_rate: 'TAX', fee_rate: 'FEE' };
        es.filter((e) => RL[e.role]).forEach((e) => setup.push(`${RL[e.role]} ${e.display}`));
      }
      const gapVal = statedOK ? gapE.value : dAbs;
      // the stated percentage change, kept in the delta when it is consistent with the dollar figures
      let pctText = '';
      if (pctEntity && b.kind === 'money' && b.value > 0 && !usePair) {
        const expPct = (dAbs / b.value) * 100;
        if (Math.abs(expPct - pctEntity.value) <= 0.6 && pctEntity.direction === (a.value < b.value ? 'down' : 'up')) pctText = ` (${pctEntity.direction === 'down' ? '-' : '+'}${pctEntity.display})`;
        else review('pct_dollar_mismatch', { pct: pctEntity.id, stated: pctEntity.value, implied: +expPct.toFixed(2), reason: 'the stated percentage change is not what the stated dollar figures imply, or its direction differs' });
      }
      const valBasis = intent === 'outcome_comparison' && b.kind === 'money' ? basis : null;
      const shown = (e) => withBasis(e.display, valBasis);
      const START_HEADER = { future_price: 'PRICE', purchasing_power: 'PURCHASING POWER', end_value: 'VALUE', after_tax_proceeds: 'AMOUNT', total_paid: 'AMOUNT' };
      const headerFor = () => (usePair ? 'VALUE' : null) || (intent === 'start_to_result' ? (START_HEADER[metric] || 'AMOUNT') : null) || HEADER_BY_METRIC[metric] || (b.role === 'result_duration' || b.kind === 'duration' ? 'DURATION' : basisWord(basis) ? `${({ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', quarter: 'QUARTERLY', year: 'YEARLY' })[basisWord(basis)] || 'PERIODIC'} AMOUNT` : 'OUTCOME');
      p = { treatment, text, displayMode: 'bar', headerLabel: headerFor(), beforeLabel: first.label || 'OPTION A', beforeCount: mentionNum(b), beforeValue: shown(b), afterLabel: last.label || 'OPTION B', afterCount: mentionNum(a), afterValue: shown(a), deltaTone: tone, meaning_event_pattern: meaningEventPattern((statedOK ? gapE : a).provenance.span_text) };
      if (setup.length) p.anchorText = fitTokens(setup, 52);
      let deltaEntity = statedOK ? gapE : null;
      if (deltaNote) p.deltaNote = deltaNote;
      if (dir !== 'flat') p.deltaTextOverride = `${dir === 'down' ? '-' : '+'}${b.kind === 'money' ? withBasis(fmtMoneyD(gapVal, Math.max(displayDecimals(a.display), displayDecimals(b.display))), valBasis) : (a.kind === 'duration' ? fmtDur(gapVal, a.unit) : String(gapVal))}${pctText}`;
      visual = `two proportional bars in stated order (${dir === 'down' ? 'second is lower' : dir === 'up' ? 'second is higher' : 'equal'}); ${statedOK ? 'the stated gap is the delta' : 'the delta is derived from the two bars'}`;
      scene.labels = { before: p.beforeLabel, after: p.afterLabel, delta: p.deltaTextOverride || null, anchor: p.anchorText || null };
      if (!statedOK && dir !== 'flat') { deltaEntity = { id: `v${++seq}`, role: 'derived_delta', kind: b.kind, value: +gapVal.toFixed(2), unit: b.unit, display: b.kind === 'money' ? fmtMoneyD(gapVal, Math.max(displayDecimals(a.display), displayDecimals(b.display))) : String(gapVal), scenario: null, provenance: { kind: 'derived', formula: 'abs(result_a - result_b)', inputs: [b.id, a.id] }, confidence: { level: 'derived' } }; entities.push(deltaEntity); scene.entity_ids.push(deltaEntity.id); }
      scene.relationships.push({ type: 'summarizes', from: deltaEntity ? deltaEntity.id : null, to: [b.id, a.id] });
      scene.comparison = { form: 'bars', intent, relation, pct: pctText ? { entity_id: pctEntity.id, text: pctText } : null, metric, basis, values: [{ entity_id: b.id, identity: idB, label: p.beforeLabel, shown: p.beforeValue }, { entity_id: a.id, identity: idA, label: p.afterLabel, shown: p.afterValue }], delta_note: noteEntity ? { text: deltaNote, entity_id: noteEntity.id, basis: identityOf(noteEntity).basis } : null, delta: dir === 'flat' ? null : { text: p.deltaTextOverride, value: gapVal, source: statedOK ? 'stated_gap' : 'derived_from_bars', entity_id: deltaEntity ? deltaEntity.id : null, basis: valBasis }, direction: dir, scenario_labels: [first.label || null, last.label || null] };
    } else if (intent === 'consequence_units') {
      treatment = 'share_compare';
      const chg = entities.filter((e) => e.role === 'change_pct' && e.direction && e.direction !== 'either').pop();
      const money = es.find((e) => e.kind === 'money');
      const nounM = text.match(/\b(fewer|less|more)\s+([a-z]+)/i); const noun = nounM ? nounM[2].toUpperCase() : 'UNITS';
      const pct = chg.value * (chg.direction === 'down' ? -1 : 1);
      const unrounded = 100 / (1 + pct / 100);
      const before = { id: `v${++seq}`, role: 'units_before', kind: 'count', value: 100, display: `100 ${noun}`, provenance: { kind: 'assumed_illustrative', reason: 'the script states no unit count; a normalized base of 100 is used only to draw the proportional effect' }, confidence: { level: 'assumed' } };
      const after = { id: `v${++seq}`, role: 'units_after', kind: 'count', value: Math.round(unrounded), display: `${Math.round(unrounded)} ${noun}`, provenance: { kind: 'derived', formula: 'units_before / (1 + change_pct/100)', unrounded: +unrounded.toFixed(4), inputs: [before.id, chg.id] }, confidence: { level: 'derived' } };
      entities.push(before, after); scene.entity_ids.push(before.id, after.id);
      const dir = after.value < before.value ? 'down' : after.value > before.value ? 'up' : 'flat';
      p = { treatment, text, displayMode: 'chips', headerLabel: `YOUR ${noun}`, beforeLabel: `YOUR ${noun}`, beforeCount: before.value, beforeValue: before.display, afterLabel: 'NOW', afterCount: after.value, afterValue: after.display, anchorText: money ? `SAME ${money.display}` : undefined, deltaSuffix: noun, deltaTone: dir === 'down' ? 'negative' : 'neutral', meaning_event_pattern: meaningEventPattern((nounM || [noun])[0]) };
      if (!p.anchorText) delete p.anchorText;
      scene.relationships.push({ type: 'caused_by', from: after.id, to: chg.id });
      visual = 'the same money buys a different number of units after the price change'; scene.labels = { before: p.beforeValue, after: p.afterValue, disclosure: 'unit count is an illustrative base of 100 (script states none)' };
    } else if (intent === 'breakeven') {
      treatment = 'stock_chart';
      const bc = verifiedCalcs.find((c) => c.model === 'breakeven');
      const N = bc.value, cost = bc.params.upfront_cost, save = bc.params.periodic_saving;
      const tEnt = entities.find((e) => e.role === 'result_duration');
      // the chart runs in the calculation's OWN period (months of saving), even
      // when the script states the result in years; long horizons are plotted
      // one point per k periods so the crossing always fits on the axis
      const unit = bc.periodCadence || (tEnt ? tEnt.unit : 'month');
      const perPt = Math.max(1, Math.ceil((N * 1.5) / 40));
      const nPts = Math.min(40, Math.max(4, Math.ceil((N * 1.5) / perPt)));
      const extent = nPts * perPt;
      const pts1 = [], pts2 = [];
      for (let k = 0; k <= nPts; k++) { pts1.push(Math.round(k * perPt * save)); pts2.push(Math.round(cost)); }
      const saveM = bc.inputs.find((i) => i.param === 'periodic_saving' && i.id); const saveEnt = saveM && entOf.get(saveM.id);
      const extentEnt = { id: `v${++seq}`, role: 'chart_extent_periods', kind: 'count', value: extent, unit, display: String(extent), provenance: { kind: 'derived', formula: 'chart axis extent = points * periods-per-point, sized to 1.5x the break-even period count', inputs: tEnt ? [tEnt.id] : [] }, confidence: { level: 'derived' } };
      const cumEnt = { id: `v${++seq}`, role: 'cumulative_saving_at_extent', kind: 'money', value: Math.round(extent * save), unit: 'USD', display: fmtMoney(extent * save), provenance: { kind: 'derived', formula: 'extent periods * periodic saving', inputs: [extentEnt.id, ...(saveEnt ? [saveEnt.id] : [])] }, confidence: { level: 'derived' } };
      entities.push(extentEnt, cumEnt); scene.entity_ids.push(extentEnt.id, cumEnt.id);
      const beSeries = [{ label: 'CUMULATIVE SAVINGS', color: '0xa67c2e', points: pts1, finalValueText: cumEnt.display }, { label: 'UP-FRONT COST', color: '0x1a2744', points: pts2, finalValueText: fmtMoney(cost) }];
      const sc1 = scaleTicks(beSeries, scene, 'chart_scale');
      const beLabel = tEnt ? `BREAK EVEN ${tEnt.display}` : `BREAK EVEN ${Math.round(N)} ${unit.toUpperCase()}S`;
      const markerEnt = { id: `v${++seq}`, role: 'marker_plot_index', kind: 'count', value: Math.round(N / perPt), unit, display: String(Math.round(N / perPt)), provenance: { kind: 'derived', formula: 'break-even periods / periods-per-plotted-point', inputs: tEnt ? [tEnt.id] : [] }, confidence: { level: 'derived' } };
      entities.push(markerEnt); scene.entity_ids.push(markerEnt.id);
      p = { treatment, text, label: 'SAVINGS VS UP-FRONT COST', yTicks: sc1.ticks, yMax: sc1.yMax || undefined, series: beSeries, axisStartLabel: `${unit.toUpperCase()} 0`, axisEndLabel: `${unit.toUpperCase()} ${extent}`, markerIndex: Math.round(N / perPt), markerLabel: beLabel, bgConcept: ASSET.bg.trajectory, meaning_event_pattern: tEnt ? meaningEventPattern(tEnt.provenance.span_text) : undefined };
      visual = 'cumulative saving climbs until it crosses the flat up-front cost at the break-even period'; scene.asset_requirements = [{ type: 'scene_bg', concept: ASSET.bg.trajectory, reuse_first: true }];
      scene.relationships.push({ type: 'derived_trajectory', formula: 'breakeven', calc: bc.id });
    } else { // single_figure (and any unsupported intent)
      treatment = 'calc_card';
      const RESULT_FIRST = ['outcome', 'result_duration', 'gap'];
      const allShown = es.filter((e) => DATA_ROLES.has(e.role) && !['delay_period', 'remaining_period'].includes(e.role));
      // when more than 4 quantities compete for the card, results are kept first
      // (never the ones dropped); the card then reads in narration order
      const keepIdx = new Set(allShown.map((e, i) => ({ e, i })).sort((x, y) => (RESULT_FIRST.includes(x.e.role) ? 0 : 1) - (RESULT_FIRST.includes(y.e.role) ? 0 : 1) || x.i - y.i).slice(0, 4).map((x) => x.i));
      const shownRoles = allShown.filter((e, i) => keepIdx.has(i));
      const omitted = allShown.filter((e, i) => !keepIdx.has(i));
      const cardLines = shownRoles.map((e) => {
        const id0 = identityOf(e), b = id0.basis;
        const bb = e.kind === 'money' ? (basisWord(b) ? b : strongCad(e) ? `per_${e.cadence}` : null) : null;
        const amt = e.kind === 'money' && bb ? withBasis(e.display, bb) : e.display;
        if (e.role === 'horizon') return { entity_id: e.id, text: `OVER ${e.display}` };
        let lab = dedupeLabel(e, e.label);
        if (!lab) lab = ROLE_LINE_NOUN[e.role] || (['outcome', 'result_duration'].includes(e.role) ? (e.role === 'result_duration' ? (lineOfResult(e) || 'TIME TO GOAL') : (titleOfResult(e) || 'RESULT')) : '');
        return { entity_id: e.id, text: `${amt} ${lab}`.trim() };
      });
      // the financial RESULT reads last (it carries the emphasis), inputs and the horizon before it
      const roleOfLine = (l) => (entities.find((x) => x.id === l.entity_id) || {}).role;
      cardLines.map((l, i) => ({ l, i })).sort((x, y) => (RESULT_FIRST.includes(roleOfLine(x.l)) ? 1 : 0) - (RESULT_FIRST.includes(roleOfLine(y.l)) ? 1 : 0) || x.i - y.i).forEach((x, k) => { cardLines[k] = x.l; });
      const lines = cardLines.map((l) => l.text);
      // title: the financial point (what the results are), never a stage direction
      const resNames = [...new Set(shownRoles.filter((e) => RESULT_FIRST.includes(e.role)).map((e) => titleOfResult(e) || cleanLabel(e.label) || null).filter(Boolean))];
      const purposeUp = gateLabel(upper(pscene.purpose, 44), scriptCadences);
      const derivedTitle = resNames.length ? resNames.slice(0, 2).join(' AND ') : null;
      const gapHere = es.find((e) => e.role === 'gap');
      const title = derivedTitle || (purposeUp && !STAGE_DIRECTION.test(purposeUp) ? purposeUp : null) || (gapHere ? (gapHere.label || 'TOTAL DIFFERENCE') : 'THE NUMBERS');
      p = { treatment, text, title, values: lines };
      scene.card = { title, lines: cardLines, results_expected: allShown.filter((e) => RESULT_FIRST.includes(e.role)).map((e) => e.id) };
      if (omitted.length) scene.notes.push({ note: 'card shows 4 quantities (results first); the rest are stated in the narration only', not_shown: omitted.map((e) => e.id) });
      visual = 'value card listing the quantities that produce the result'; if (!lines.length) scene.notes.push({ note: 'no bound quantities to display' });
    }
    scene.treatment = treatment; scene.intent = intent; scene.renderer_params = p; scene.visual_relationship = visual;
    scene.reveal_steps = es.filter((e) => e.provenance.kind === 'script' && ['recurring_amount', 'transfer_amount', 'principal', 'outcome', 'gap', 'change_pct', 'process_window', 'delay_period', 'result_duration'].includes(e.role)).map((e) => ({ entity_id: e.id, spoken_phrase: e.provenance.span_text, meaning_event_pattern: meaningEventPattern(e.provenance.span_text), reveal: `show ${e.role.replace(/_/g, ' ')} ${e.display}` }));
    let xc = null; try { xc = deps.classifyLongTreatment ? deps.classifyLongTreatment(text, unitById.get(pscene.unit_ids[0]).section) : null; } catch { xc = null; }
    scene.treatment_cross_check = { text_classifier: xc, agrees: xc === treatment };
    outScenes.push(scene);
  });

  // 6b. VISUAL SEMANTIC VALIDATION. Independently of how the planner reached
  // a scene, re-check the final renderer parameters against the metric
  // identities and calculations behind them. A mathematically correct number
  // in a semantically wrong visual is BLOCKED, never rendered.
  const LABEL_MAX = { bars: 44, chart: 36 };
  const badScene = (sc, rule, detail) => issues.push({ severity: 'blocking', kind: 'visual_semantic_mismatch', scene: sc.scene_id, rule, ...detail });
  const DUP = hasDuplicateWords;
  outScenes.forEach((sc) => {
    const rp0 = sc.renderer_params;
    // ---- money_flow: the moving amount must be THE amount, unambiguous, with distinct endpoints
    if (sc.flow) {
      const f = sc.flow, e = entities.find((x) => x.id === f.amount_entity);
      if (!e) badScene(sc, 'flow_amount_entity_missing', {});
      else {
        if (f.movable_entities.length > 1 && new Set(f.movable_entities.map((id) => JSON.stringify(entities.find((x) => x.id === id).value))).size > 1) badScene(sc, 'flow_amount_ambiguous', { candidates: f.movable_entities });
        if (!String(rp0.amountText).startsWith(e.display)) badScene(sc, 'flow_amount_text', { shown: rp0.amountText, entity: e.display });
        if (e.role === 'recurring_amount' && e.cadence && !String(rp0.amountText).endsWith(basisSuffix(`per_${e.cadence}`))) badScene(sc, 'flow_time_basis_not_shown', { shown: rp0.amountText });
        if (!f.from || !f.to || f.from === f.to) badScene(sc, 'flow_endpoints', { from: f.from, to: f.to });
        // independent transfer-semantics recheck: named endpoints + a movement expression
        const scriptLow2 = units.map((u) => u.text).join(' ').toLowerCase();
        const named2 = (lab) => !!lab && String(lab).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3).some((w) => scriptLow2.includes(w.replace(/s$/, '')));
        if (!named2(f.from) || !named2(f.to)) badScene(sc, 'flow_endpoint_not_in_script', { from: f.from, to: f.to });
        if (!MOVE_RE.test(sc.unit_ids.map((id) => unitById.get(id).text).join(' '))) badScene(sc, 'flow_without_movement_expression', {});
        if (e.role === 'recurring_amount' && String(rp0.amountText).includes('/') && !e.cadence_evidence) badScene(sc, 'cadence_without_evidence', { shown: rp0.amountText });
        // an endpoint that names two parties is a total; the arrow amount must not be one party's share
        const others = entities.filter((x) => x.provenance.unit_id && sc.unit_ids.includes(x.provenance.unit_id) && x.kind === 'money' && ['outcome', 'recurring_amount', 'transfer_amount', 'gap'].includes(x.role) && x.id !== e.id && x.value > e.value);
        if (others.length && /\b(AND|&|\+)\b/.test(`${f.from} ${f.to}`)) badScene(sc, 'flow_combined_endpoint_with_partial_amount', { shown: rp0.amountText, larger: others.map((x) => x.display) });
      }
    }
    // ---- cards: every line is one entity, labelled, time-basis-correct, no duplicated words
    if (sc.card) {
      const cd = sc.card;
      if (STAGE_DIRECTION.test(cd.title) || cd.title.length > 44 || !cd.title) badScene(sc, 'card_title', { title: cd.title });
      cd.lines.forEach((l) => {
        const e = entities.find((x) => x.id === l.entity_id);
        if (!e) return badScene(sc, 'card_line_entity_missing', { line: l.text });
        if (e.role === 'recurring_amount' && /^\S+\/(MO|WK|YR|DAY|QTR)\b/.test(l.text) && !e.cadence_evidence) badScene(sc, 'cadence_without_evidence', { line: l.text });
        const okStart = l.text.startsWith(e.display) || l.text.startsWith(`OVER ${e.display}`);
        if (!okStart) badScene(sc, 'card_line_value', { line: l.text, entity: e.display });
        if (DUP(l.text)) badScene(sc, 'card_line_duplicated_words', { line: l.text });
        if (!/[A-Za-z]{2,}/.test(l.text.replace(e.display, ''))) badScene(sc, 'card_line_unlabelled', { line: l.text });
        if (e.role === 'recurring_amount' && e.cadence && !l.text.startsWith(withBasis(e.display, `per_${e.cadence}`))) badScene(sc, 'card_time_basis_not_shown', { line: l.text });
        if (e.role === 'outcome' && e.kind === 'money') { const b = identityOf(e).basis; if (basisWord(b) && !l.text.startsWith(withBasis(e.display, b))) badScene(sc, 'card_time_basis_not_shown', { line: l.text }); if (!basisWord(b) && !strongCad(e) && /^\S+\/(MO|WK|YR|DAY|QTR)\b/.test(l.text)) badScene(sc, 'card_time_basis_wrongly_shown', { line: l.text }); }
      });
      // a results-first card may not silently lose a result
      const shownIds = new Set(cd.lines.map((l) => l.entity_id));
      const lost = cd.results_expected.filter((id) => !shownIds.has(id));
      if (lost.length && cd.lines.length < 4) badScene(sc, 'card_omits_result', { lost });
    }
    // ---- change chart: the drawn change is the bound change, same direction
    if (sc.change) {
      const e = entities.find((x) => x.id === sc.change.entity_id); const down = e && e.direction === 'down';
      if (!e || !String(rp0.changeText).startsWith(down ? '-' : '+') || !String(rp0.changeText).includes(e.display)) badScene(sc, 'change_text', { shown: rp0.changeText });
      if (rp0.direction !== e.direction) badScene(sc, 'change_direction', { shown: rp0.direction, entity: e.direction });
      const top = (rp0.yTicks || []).find((t) => t.frac === (down ? 0 : 1)); if (!top || !top.text.includes(e.display)) badScene(sc, 'change_axis_top', { ticks: rp0.yTicks });
    }
    // ---- milestones: each value sits on the trajectory at its own time
    if (sc.comparison && sc.comparison.form === 'milestones') {
      const c0 = sc.comparison; const pts = rp0.series[0].points;
      c0.values.forEach((v) => {
        const e = entities.find((x) => x.id === v.entity_id);
        if (v.index !== Math.round(v.index) || v.index >= pts.length || !(statedMatches(e.value, pts[v.index], 'money') || Math.abs(e.value - pts[v.index]) <= Math.max(2, 0.001 * e.value))) badScene(sc, 'milestone_value_not_on_trajectory', { label: v.label, stated: e.value, plotted: pts[v.index], index: v.index });
        const he = e && (calcsByTarget.get(e.provenance.mention_id) || {}).params; if (he && Math.round(he.years) !== v.index) badScene(sc, 'milestone_horizon', { label: v.label, index: v.index, years: he.years });
      });
      if (rp0.series.length !== 1) badScene(sc, 'milestone_rival_series', { n: rp0.series.length });
    }
  });
  outScenes.forEach((sc) => {
    const c = sc.comparison; if (!c || c.form === 'milestones') return;
    const bad = (rule, detail) => issues.push({ severity: 'blocking', kind: 'visual_semantic_mismatch', scene: sc.scene_id, rule, ...detail });
    const ents = c.values.map((v) => entities.find((e) => e.id === v.entity_id));
    const rp = sc.renderer_params;
    // metric / unit / time-basis compatibility of everything drawn together
    const cp = c.relation ? (() => { const r = c.relation, c1 = r._c1, c2 = r._c2; const ok = c1 && c2 && TRANSFORM_MODELS.has(c2.model) && c2.inputs.some((i) => (i.calc && c2._all && c2._all.get(i.calc) === c1) || (i.id && i.id === c1.target)) && entities.find((x) => x.id === r.from_entity).provenance.mention_id === c1.target && entities.find((x) => x.id === r.to_entity).provenance.mention_id === c2.target; return { ok, why: ['the two figures are not linked by a verified transform calculation'] }; })() : c.intent === 'start_to_result' ? { ok: ents.every((e) => e.kind === ents[0].kind && identityOf(e).unit === identityOf(ents[0]).unit), why: ['start and result are not the same kind of quantity'] } : compatible(ents, { needHorizon: c.form === 'bars' });
    if (!cp.ok) bad('metric_unit_time_basis', { reasons: cp.why });
    // scenario identity: every drawn value has a distinct, non-empty label
    const labs = c.values.map((v) => v.label);
    if (labs.some((l) => !l) || new Set(labs).size !== labs.length) bad('scenario_identity', { labels: labs });
    if (labs.some((l) => String(l || '').length > LABEL_MAX[c.form])) bad('label_too_long_for_renderer', { labels: labs });
    // drawn value texts must be the entities' own displays
    c.values.forEach((v, i) => { if (!String(v.shown).startsWith(ents[i].display)) bad('shown_value_differs_from_entity', { shown: v.shown, entity: ents[i].display }); });
    if (c.form === 'bars') {
      const [b, a] = ents;
      if (!c.relation && isComponent(b) !== isComponent(a)) bad('component_compared_with_whole', { values: [b.display, a.display] });
      // time basis must be visible on the values when the metric is per-period
      if (basisWord(c.basis) && !(c.values.every((v) => v.shown.endsWith(basisSuffix(c.basis))))) bad('time_basis_not_shown', { basis: c.basis });
      // direction: the delta sign must agree with the bars
      const dirNow = a.value < b.value ? 'down' : a.value > b.value ? 'up' : 'flat';
      if (dirNow !== c.direction) bad('direction', { planned: c.direction, actual: dirNow });
      if (c.pct) {
        const pe = entities.find((x) => x.id === c.pct.entity_id); const exp = (Math.abs(a.value - b.value) / b.value) * 100;
        if (!pe || Math.abs(exp - pe.value) > 0.6 || pe.direction !== dirNow) bad('pct_inconsistent_with_dollars', { pct: pe && pe.value, implied: exp });
      }
      if (c.delta_note) {
        const ne = entities.find((e) => e.id === c.delta_note.entity_id);
        if (!ne || identityOf(ne).source !== 'verified_calculation') bad('delta_note_unverified', { note: c.delta_note.text });
        else if (!c.delta_note.text.startsWith(`= ${ne.display}`)) bad('delta_note_text', { note: c.delta_note.text, entity: ne.display });
        if (c.delta_note.basis === c.basis) bad('delta_note_same_basis', { basis: c.basis });
      }
      if (c.delta) {
        if (!c.delta.text.startsWith(dirNow === 'down' ? '-' : '+')) bad('delta_sign', { text: c.delta.text, direction: dirNow });
        const kind = b.kind === 'money' ? 'money' : b.kind === 'duration' ? 'duration' : 'count';
        if (!statedMatches(c.delta.value, Math.abs(a.value - b.value), kind)) bad('delta_is_not_difference_of_bars', { delta: c.delta.value, difference: Math.abs(a.value - b.value) });
        if (!c.delta.entity_id) bad('delta_without_provenance', {});
        if (basisWord(c.basis) && !c.delta.text.replace(/\s*\([^)]*\)\s*$/, '').endsWith(basisSuffix(c.basis))) bad('delta_time_basis', { text: c.delta.text, basis: c.basis });
      }
      if (c.intent !== 'start_to_result' && !c.relation && rp.headerLabel && c.metric && HEADER_BY_METRIC[c.metric] && rp.headerLabel !== HEADER_BY_METRIC[c.metric]) bad('header_vs_metric', { header: rp.headerLabel, metric: c.metric });
    } else {
      // chart: each series ends at exactly the entity value it labels
      (rp.series || []).forEach((se, i) => { if (se.finalValueText !== ents[i].display) bad('series_end_value', { series: se.label, shown: se.finalValueText, entity: ents[i].display }); });
    }
  });

  // 6c. AUTHORITATIVE DISPLAYED VALUES: every money / percent token drawn must be exactly the
  // display of a bound entity (stated precision kept: "$6.72" is never "$7"), and every bound
  // script entity's display must reconcile with its value at the precision it was stated.
  const moneyOK = new Set(entities.filter((e) => e.kind === 'money').map((e) => e.display));
  const pctOK = new Set(['0%'].concat(entities.filter((e) => e.kind === 'percent').map((e) => e.display)));
  const strsOf = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strsOf(x, out)); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (!['text', 'meaning_event_pattern', 'bgConcept', 'fromIconConcept', 'toIconConcept', 'contextIconConcept', 'color', 'treatment', 'points'].includes(k)) strsOf(x, out); }); return out; };
  entities.filter((e) => e.provenance.kind === 'script' && e.kind === 'money').forEach((e) => {
    const parsed = parseFloat(String(e.display).replace(/[$,]/g, ''));
    if (Math.abs(parsed - e.value) > 1e-9 * Math.max(1, e.value)) issues.push({ severity: 'blocking', kind: 'displayed_value_differs_from_stated', entity: e.id, display: e.display, value: e.value });
  });
  // model-label factual gate (defense): a cadence word drawn anywhere must be established by the
  // script (a frequency word in it) or by a verified monthly-amortised payment
  const hasAmortised = verifiedCalcs.some((c) => c.model === 'loan_payment' && c.output === 'periodic_payment');
  outScenes.forEach((sc) => {
    strsOf(sc.renderer_params).forEach((t) => {
      cadenceWordsIn(t).forEach((cw) => { if (!scriptCadences.has(cw) && !(cw === 'month' && hasAmortised)) issues.push({ severity: 'blocking', kind: 'label_asserts_unsupported_cadence', scene: sc.scene_id, cadence: cw, in: t }); });
    });
  });
  outScenes.forEach((sc) => {
    strsOf(sc.renderer_params).forEach((t) => {
      (t.match(/\$[\d,]+(?:\.\d+)?/g) || []).forEach((tok) => { if (!moneyOK.has(tok)) issues.push({ severity: 'blocking', kind: 'displayed_money_not_authoritative', scene: sc.scene_id, token: tok, in: t }); });
      (t.match(/[+-]?\d+(?:\.\d+)?%/g) || []).forEach((tok) => { const bare = tok.replace(/^[+-]/, ''); if (!pctOK.has(bare)) issues.push({ severity: 'blocking', kind: 'displayed_percent_not_authoritative', scene: sc.scene_id, token: tok, in: t }); });
    });
    // trajectory charts: the last plotted point of each labelled series IS the stated value
    const c = sc.comparison;
    if (c && c.form === 'chart') (sc.renderer_params.series || []).forEach((se, i) => {
      const e = entities.find((x) => x.id === c.values[i].entity_id); const last = [...se.points].reverse().find((v) => v != null);
      if (!(Math.abs(last - e.value) <= Math.max(2, 0.001 * e.value))) issues.push({ severity: 'blocking', kind: 'visual_semantic_mismatch', scene: sc.scene_id, rule: 'series_last_point_differs_from_stated', series: se.label, plotted: last, stated: e.value });
    });
    if (c && c.form === 'chart' && c.delay) {
      const later = c.values[c.delay.later_index], other = c.values[1 - c.delay.later_index];
      const mi = sc.renderer_params.markerIndex;
      if (mi !== Math.round(c.delay.years)) issues.push({ severity: 'blocking', kind: 'visual_semantic_mismatch', scene: sc.scene_id, rule: 'delay_marker_differs_from_stated_delay', marker: mi, delay: c.delay.years });
      const sl = sc.renderer_params.series[c.delay.later_index].points, first = sl.findIndex((v) => v != null);
      if (first < Math.floor(c.delay.years)) issues.push({ severity: 'blocking', kind: 'visual_semantic_mismatch', scene: sc.scene_id, rule: 'delayed_series_starts_before_delay', first_point: first, delay: c.delay.years });
      if (!/later|delay|wait|late|postpone|behind|off/i.test(later.label) || !/now|today|start|early|immediate/i.test(other.label)) issues.push({ severity: 'blocking', kind: 'visual_semantic_mismatch', scene: sc.scene_id, rule: 'delay_scenario_identity', labels: [other.label, later.label] });
    }
  });

  // 7. integrity: coverage audit + rendered-number provenance audit
  // numeric IDENTIFIERS are not quantities: account/plan/form names (401(k),
  // 403(b), 529 plan, Form 1099, W-2), quarters (Q1) and calendar years
  const IDENT = /\b(?:40[13]|457)\s?\((?:k|b)\)|\b529(?=\s+(?:plan|account|college|savings))|\bForm\s+\d{3,4}\b|\b1099\b|\bW-?[24]\b|\bQ[1-4]\b|\b(?:19|20)\d{2}\b(?!\s*(?:dollars|%|percent))/gi;
  const isIdentifier = (u, tok) => { const t = unitById0.get(u) || ''; for (const m of t.matchAll(IDENT)) if (m[0].replace(/\D+/g, '').includes(String(tok).replace(/\D+/g, '')) && String(tok).replace(/\D+/g, '')) return true; return false; };
  const uncovered = auditCoverage(units).filter((t) => !isIdentifier(t.unit_id, t.token));
  uncovered.forEach((t) => review('uncovered_numeric_token', { unit_id: t.unit_id, token: t.token, context: t.context }));
  const allowedNums = new Set();
  const addNum = (n) => { if (Number.isFinite(n)) { allowedNums.add(String(n)); allowedNums.add(String(Math.round(n))); allowedNums.add(String(+n.toFixed(2))); } };
  entities.forEach((e) => { (Array.isArray(e.value) ? e.value : [e.value]).forEach(addNum); String(e.display || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g)?.forEach((t) => allowedNums.add(t)); });
  outScenes.forEach((s) => (s.renderer_params.series || []).forEach(() => { /* series points are checked against the verified calculation that produced them */ }));
  const claims = [];
  const scan = (val, path) => {
    if (typeof val === 'string') { for (const t of (val.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || [])) claims.push({ path, token: t }); }
    else if (Array.isArray(val)) val.forEach((v, i) => scan(v, `${path}[${i}]`));
    else if (val && typeof val === 'object') Object.entries(val).forEach(([k, v]) => { if (!['text', 'meaning_event_pattern', 'series', 'points', 'bgConcept', 'fromIconConcept', 'toIconConcept', 'contextIconConcept', 'color', 'treatment'].includes(k)) scan(v, `${path}.${k}`); });
  };
  outScenes.forEach((s) => { scan(s.renderer_params, s.scene_id); (s.renderer_params.series || []).forEach((se) => scan(se.label, s.scene_id + '.series.label')); (s.renderer_params.series || []).forEach((se) => scan(se.finalValueText, s.scene_id + '.series.final')); scan(s.renderer_params.axisStartLabel, s.scene_id + '.axis'); scan(s.renderer_params.axisEndLabel, s.scene_id + '.axis'); });
  // axis/marker numbers derive from bound durations or verified calculation years
  verifiedCalcs.forEach((c) => Object.values(c.params).forEach((v) => addNum(Number(v)))); verifiedCalcs.forEach((c) => addNum(c.value));
  allowedNums.add('0');
  const derivedNums = entities.filter((e) => e.provenance.kind !== 'script');
  derivedNums.forEach((e) => addNum(Number(e.value)));
  outScenes.forEach((s) => { const rp = s.renderer_params; [rp.markerIndex, rp.beforeCount, rp.afterCount].forEach((n) => { if (typeof n === 'number') claims.push({ path: s.scene_id + '.number', token: String(n) }); }); });
  const unprovenanced = claims.filter((c) => !allowedNums.has(c.token) && !allowedNums.has(String(Math.round(Number(c.token)))));
  unprovenanced.forEach((c) => issues.push({ severity: 'blocking', kind: 'unprovenanced_rendered_number', where: c.path, token: c.token }));

  const status = issues.some((i) => i.severity === 'blocking') ? 'blocked' : issues.some((i) => i.severity === 'review') ? 'needs_review' : 'clean';
  return {
    ok: true, version: SEMANTIC_BRAIN_VERSION, mode: 'semantic',
    units: units.map((u) => ({ unit: u.unit, text: u.text })),
    quantities: mentions.map((m) => ({ id: m.id, unit_id: m.unit_id, raw: m.raw, kind: m.kind, value: m.value, rule_engine_role: m.role || null })),
    scenes: outScenes, values: entities,
    proposals: { A: passes[0] && passes[0].ok ? { roles: Object.fromEntries(Object.entries(A.mentions).map(([k, v]) => [k, { role: v.role, confidence: v.confidence, evidence: v.evidence, scenario: v.scenario, direction: v.direction }])), scenes: A.scenes.map((s) => ({ units: s.unit_ids, intent: s.intent })), calculations: A.calculations } : null, B: B ? { roles: Object.fromEntries(Object.entries(B.mentions).map(([k, v]) => [k, { role: v.role, confidence: v.confidence }])), scenes: B.scenes.map((s) => ({ units: s.unit_ids, intent: s.intent })), calculations: B.calculations } : null, rejections: passes.map((p) => ({ variant: p.variant, ok: p.ok, error: p.error || null, rejected: p.rejections })), grouping_agreement: groupingAgreement },
    decisions: [...decisions.values()],
    calculations: calcDetails, rejected_calculation_proposals: rejectedProposals, labels_gated: labelGated,
    unbound_mentions: unbound, uncovered_numeric_tokens: uncovered,
    integrity: { status, issues, verifications: calcDetails.filter((d) => d.target).map((d) => ({ check: 'stated_value', ok: !!d.verified, ...d })) },
    cross_check_summary: { scenes: outScenes.length, text_classifier_disagreements: outScenes.filter((s) => !s.treatment_cross_check.agrees).length },
  };
}
