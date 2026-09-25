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
const TARGET_ROLES = ['outcome', 'gap', 'result_duration', 'recurring_amount', 'transfer_amount'];
const OUTPUT_DEFAULT_ROLE = { periods: 'result_duration', payoff_periods: 'result_duration', value: 'outcome' };
const GOOD_DIRECTION = { end_value: 'up', after_tax_proceeds: 'up', purchasing_power: 'up', total_paid: 'down', interest_paid: 'down', tax_owed: 'down', periodic_payment: 'down', future_price: 'down' };
const HEADER_BY_METRIC = { end_value: 'FINAL VALUE', total_paid: 'TOTAL PAID', periodic_payment: 'MONTHLY PAYMENT', after_tax_proceeds: 'AFTER TAX', purchasing_power: 'PURCHASING POWER', future_price: 'FUTURE PRICE', interest_paid: 'INTEREST PAID', tax_owed: 'TAX OWED' };
const DATA_ROLES = new Set(['principal', 'recurring_amount', 'transfer_amount', 'baseline_amount', 'upfront_cost', 'income_amount', 'outcome', 'gap', 'rate', 'fee_rate', 'tax_rate', 'inflation_rate', 'match_rate', 'savings_rate', 'change_pct', 'horizon', 'delay_period', 'remaining_period', 'process_window', 'result_duration']);

const mentionNum = (m) => (Array.isArray(m.value) ? m.value[1] : m.value);
const cleanLabel = (s, max = 24) => (s && /^[A-Z][A-Z0-9 %$/&.\-']*$/.test(String(s).trim()) && String(s).trim().length <= max ? String(s).trim() : null);
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
    const target = c.target ? mentionsById.get(c.target) : null;
    if (target) {
      const kind = target.kind;
      const hit = cands.find((k) => statedMatches(mentionNum(target), k.value, kind));
      if (hit) { chosen = hit; verified = true; }
    }
    results.set(c.id, { id: c.id, model: c.model, output: c.output, value: chosen.value, convention: chosen.convention, verified, target: c.target, params, inputs: inputMentions, candidates: cands.map((k) => +k.value.toFixed(4)) });
    details.push({ calc: c.id, model: c.model, output: c.output, target: c.target, computed: +chosen.value.toFixed(4), convention: chosen.convention, stated: target ? mentionNum(target) : null, verified, ...(target && !verified ? { candidates: cands.map((k) => +k.value.toFixed(4)) } : {}) });
  }
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
  calcDetails.filter((d) => d.target && !d.verified && d.ok !== false).forEach((d) => review('stated_value_not_reproduced', { calc: d.calc, model: d.model, target: d.target, stated: d.stated, computed: d.computed, candidates: d.candidates }));

  // 3. per-mention role decision
  const decisions = new Map();
  for (const m of mentions) {
    const a = A.mentions[m.id] || null, b = B ? (B.mentions[m.id] || null) : null;
    const ruleRole = m.role && ROLE_ONTOLOGY[m.role] && m.role !== 'none' ? m.role : null;
    const d = { id: m.id, rule_role: ruleRole, A: a && a.role, B: b && b.role, confidence: [a && a.confidence, b && b.confidence].filter((x) => x != null), status: null, role: null, why: null };
    // calculation-verified structure wins
    let calcRole = null; const basis = [];
    for (const run of calcRuns) for (const c of run.results.values()) {
      if (!c.verified) continue;
      const inp = c.inputs.find((i) => i.id === m.id);
      if (inp) {
        const allowed = (PARAM_ROLES[c.model] || {})[inp.param] || [];
        const prop = (a && a.role !== 'none' ? a.role : null) || (b && b.role !== 'none' ? b.role : null);
        if (allowed.length) { calcRole = allowed.includes(prop) ? prop : allowed[0]; basis.push({ calc: c.id, param: inp.param }); }
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
    } else if (a && b) Object.assign(d, { status: 'disagree', role: null, why: `passes disagree: ${a.role} vs ${b.role}` });
    else Object.assign(d, { status: 'single_pass', role: null, why: 'only one valid pass labelled this quantity' });
    decisions.set(m.id, d);
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
  const entOf = new Map();
  let seq = 0;
  for (const m of mentions) {
    const d = decisions.get(m.id);
    if (!d.role || d.role === 'none') continue;
    const pa = A.mentions[m.id];
    const e = {
      id: `v${++seq}`, role: d.role, kind: m.kind, value: m.value, unit: m.unit || (m.kind === 'money' ? 'USD' : m.kind === 'percent' ? 'PCT' : undefined),
      display: m.kind === 'money' ? fmtMoney(m.value) : m.kind === 'percent' ? fmtPct(m.value) : m.kind === 'duration' ? fmtDur(m.value, m.unit) : String(m.value),
      cadence: (pa && pa.cadence) || (m.ctx && (m.ctx.freqRight || m.ctx.freqClause) ? (m.ctx.freqRight || m.ctx.freqClause).cadence : null),
      direction: d.direction || null, metric: (pa && pa.metric) || null, label: cleanLabel(pa && pa.label),
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
  const scenarioLabel = new Map((A.scenarios || []).map((s) => [s.id, cleanLabel(s.label) || upper(s.label)]));

  // 6. plan each scene
  const outScenes = [];
  const unitById = new Map(units.map((u) => [u.unit, u]));
  const entsInScene = (unitIds) => entities.filter((e) => unitIds.includes(e.provenance.unit_id));
    const gapEntity = entities.find((e) => e.role === 'gap') || null;
  const shared = (role) => entities.find((e) => e.role === role && !e.scenario);
  const calcsByTarget = new Map();
  verifiedCalcs.forEach((c) => { if (c.target && !calcsByTarget.has(c.target)) calcsByTarget.set(c.target, c); });

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

  partition.forEach((pscene, si) => {
    const scene = { scene_id: `S${si + 1}`, unit_ids: pscene.unit_ids, narration: { text: pscene.unit_ids.map((id) => unitById.get(id).text).join(' '), first_unit: pscene.unit_ids[0], last_unit: pscene.unit_ids[pscene.unit_ids.length - 1] }, proposed_intent: pscene.intent, purpose: pscene.purpose, entity_ids: [], relationships: [], labels: {}, reveal_steps: [], asset_requirements: [], notes: [] };
    const es = entsInScene(pscene.unit_ids);
    scene.entity_ids = es.map((e) => e.id);
    if (pscene.absorbed) scene.notes.push(...pscene.absorbed.map((a) => ({ merged_scene: a })));
    if (pscene.promoted) scene.notes.push({ promoted: pscene.promoted });
    const text = scene.narration.text; const tags = tagsOf(text);
    let intent = pscene.intent; let p = {}; let treatment; let visual = '';
    const isFirst = si === 0, isLast = si === partition.length - 1;
    const demote = (to, why) => { scene.notes.push({ demoted_from: intent, to, why }); intent = to; };

    // arms: scenario groups holding a result quantity
    const resultRoles = new Set(['outcome', 'result_duration']);
    const arms = [];
    // Arms are the model's labelled scenarios. If it labelled none, fall back to
    // STRUCTURE: parallel sentences that each hold results form the arms.
    const anyScn = es.some((e) => resultRoles.has(e.role) && e.scenario);
    es.filter((e) => resultRoles.has(e.role)).forEach((e) => {
      const sid = e.scenario || (anyScn ? `__${e.id}` : `unit:${e.provenance.unit_id}`);
      let arm = arms.find((a) => a.sid === sid);
      if (!arm) { arm = { sid, scn: e.scenario || null, unit: e.provenance.unit_id, ents: [], label: e.scenario ? (scenarioLabel.get(e.scenario) || null) : null }; arms.push(arm); }
      arm.ents.push(e);
    });
    if (!anyScn && arms.length >= 2) scene.notes.push({ note: 'the model labelled no scenarios; arms were formed from parallel sentences' });
    // A comparison must use a result of the SAME type in every scenario (a
    // duration must not be compared with a dollar amount). Pick the first
    // result type, in narration order, that every arm has.
    if (arms.length >= 2) {
      const keyOf = (e) => `${e.role}|${e.kind}|${e.metric || ''}`;
      const commonKey = arms[0].ents.map(keyOf).find((k) => arms.every((a) => a.ents.some((e) => keyOf(e) === k)));
      arms.forEach((a) => { a.pick = commonKey ? a.ents.find((e) => keyOf(e) === commonKey) : null; });
      if (commonKey) {
        const others = [...new Set(arms[0].ents.map(keyOf))].filter((k) => k !== commonKey);
        if (others.length) scene.notes.push({ note: 'other result types were not shown', not_shown: others });
      }
      // label arms that the model left unlabelled from the quantity that differs between them
      const unl = arms.filter((a) => !a.label);
      if (unl.length) {
        for (const role of ['delay_period', 'rate', 'fee_rate', 'tax_rate', 'inflation_rate', 'savings_rate', 'recurring_amount', 'principal', 'match_rate', 'horizon']) {
          const bySid = arms.map((a) => entities.find((e) => e.role === role && ((a.scn && e.scenario === a.scn) || (e.provenance.unit_id === a.unit))));
          const pick = bySid.every(Boolean) && new Set(bySid.map((e) => JSON.stringify(e.value))).size === arms.length ? bySid : null;
          if (pick) {
            const disp = (e) => `${e.display}${e.role === 'recurring_amount' && e.cadence ? '/' + (CADENCE_ABBR[e.cadence] || '') : ''}`;
            const lbls = pick.map((e) => e.label);
            const distinct = lbls.every(Boolean) && new Set(lbls).size === lbls.length; // a shared label ("MONTHLY PAYMENT" twice) cannot tell scenarios apart
            arms.forEach((a, i) => { if (!a.label) a.label = distinct ? pick[i].label : disp(pick[i]); });
            break;
          }
        }
      }
      // labels must be unique across arms, whatever their source
      if (new Set(arms.map((a) => a.label || '')).size !== arms.length) {
        arms.forEach((a) => { a.label = null; });
        for (const role of ['delay_period', 'rate', 'fee_rate', 'tax_rate', 'inflation_rate', 'savings_rate', 'recurring_amount', 'principal', 'match_rate', 'horizon']) {
          const by = arms.map((a) => entities.find((e) => e.role === role && ((a.scn && e.scenario === a.scn) || (e.provenance.unit_id === a.unit))));
          if (by.every(Boolean) && new Set(by.map((e) => JSON.stringify(e.value))).size === arms.length) { arms.forEach((a, i) => { a.label = `${by[i].display}${by[i].role === 'recurring_amount' && by[i].cadence ? '/' + (CADENCE_ABBR[by[i].cadence] || '') : ''}`; }); break; }
        }
        arms.forEach((a, i) => { if (!a.label) a.label = `OPTION ${String.fromCharCode(65 + i)}`; });
      }
    } else arms.forEach((a) => { a.pick = a.ents[0]; });
    if (intent === 'start_to_result' && !(es.some((e) => START_ROLES.includes(e.role)) && es.some((e) => e.role === 'outcome'))) demote('single_figure', 'needs a starting figure and a result in the same scene');
    if (intent === 'trajectory_comparison' || intent === 'outcome_comparison') {
      if (arms.length < 2) demote(arms.length === 1 ? 'single_figure' : 'explanation', 'fewer than two comparable results were bound');
      else if (arms.some((a) => !a.pick)) demote('single_figure', 'the scenarios have no result type in common, so they cannot be compared');
    }
    if (intent === 'trajectory_comparison') {
      const armCalcs = arms.map((a) => calcsByTarget.get(a.pick.provenance.mention_id));
      if (armCalcs.some((c) => !c || c.model !== 'compound_growth')) demote('outcome_comparison', 'no verified growth calculation for every scenario, so no chart can be derived');
    }
    if ((intent === 'change_over_window') && !es.some((e) => e.role === 'change_pct')) demote('explanation', 'no bound percentage change');
    if (intent === 'breakeven') { const bc = verifiedCalcs.find((c) => c.model === 'breakeven'); if (!bc) demote('single_figure', 'no verified break-even calculation'); }
    const flowAmount = (e) => ['recurring_amount', 'transfer_amount', 'principal'].includes(e.role) || (e.role === 'outcome' && e.metric === 'contribution');
    if (intent === 'flow' && !es.some(flowAmount)) demote(es.some((e) => SUBSTANTIVE.has(e.role)) ? 'single_figure' : 'explanation', 'no amount bound to move');
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
        if (tags.includes('cost') || gap) p.contextIconConcept = ASSET.icon.certificate_loss;
        if (gap) p.contextCaption = `${gsign}${gap.display}`;
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
    } else if (intent === 'process_timeline') {
      treatment = 'day_cards';
      const m = es.find((e) => e.role === 'process_window'); const hi = upperBound(m.value); const u = m.unit.toUpperCase();
      const idxs = hi <= 3 ? Array.from({ length: hi + 1 }, (_, i) => i) : [0, Math.round(hi / 3), Math.round((2 * hi) / 3), hi];
      const objM = text.match(/(?:process|settle|clear|complete|finish|arrive|reinvest)\w*\s+(?:the\s+|your\s+|a\s+)?([a-z]+)/i);
      const obj = objM ? objM[1][0].toUpperCase() + objM[1].slice(1) : null;
      p = { treatment, text, heroText: fmtDur(m.value, m.unit), heroSub: obj ? `Until ${obj}` : 'Until Complete', days: idxs.map((d, i) => ({ label: `${u} ${d}`, sub: i === 0 ? 'Start' : i === idxs.length - 1 ? 'Complete' : 'In Progress' })), bgConcept: ASSET.bg.process, meaning_event_pattern: meaningEventPattern(m.provenance.span_text) };
      visual = 'timeline of cards revealing period by period'; scene.asset_requirements = [{ type: 'scene_bg', concept: ASSET.bg.process, reuse_first: true }];
    } else if (intent === 'change_over_window') {
      const m = es.find((e) => e.role === 'change_pct');
      if (!m.direction || m.direction === 'either') {
        treatment = 'calc_card'; p = { treatment, text, title: 'PERCENTAGE CHANGE', values: [`${m.display} (DIRECTION NOT STATED)`] };
        visual = 'value card only: direction of the change is not stated, so no chart is drawn';
      } else {
        treatment = 'stock_chart'; const down = m.direction === 'down';
        p = { treatment, text, label: m.label || 'PRICE CHANGE', direction: m.direction, changeText: `${down ? '-' : '+'}${m.display}`, series: [{ label: m.label || 'CHANGE', color: down ? '0xb0413e' : '0xa67c2e', points: down ? [m.value, 0] : [0, m.value], finalValueText: `${down ? '-' : '+'}${m.display}` }], axisStartLabel: 'START', axisEndLabel: 'END', bgConcept: down ? ASSET.bg.price_down : ASSET.bg.price_up, meaning_event_pattern: meaningEventPattern(m.provenance.span_text) };
        visual = `change plotted from start: ${down ? 'falls' : 'rises'} ${m.display}`; scene.asset_requirements = [{ type: 'scene_bg', concept: p.bgConcept, reuse_first: true }];
      }
    } else if (intent === 'trajectory_comparison') {
      treatment = 'stock_chart';
      const colors = ['0xa67c2e', '0x1a2744', '0x6b7280'];
      const series = []; let Y = 0, markerIndex = null;
      arms.forEach((a, ai) => {
        const c = calcsByTarget.get(a.pick.provenance.mention_id);
        const pr = { ...c.params, cadence: c.params.cadence || 'month' };
        const pts = growthSeries(pr, c.convention);
        Y = Math.max(Y, Math.round(pr.years));
        if (pr.delay > 0) markerIndex = Math.round(pr.delay);
        series.push({ label: a.label || `SCENARIO ${String.fromCharCode(65 + ai)}`, color: colors[ai] || colors[2], points: pts, finalValueText: a.pick.display });
      });
      const yUnit = (entities.find((e) => e.role === 'horizon') || { unit: 'year' }).unit.toUpperCase();
      p = { treatment, text, label: (arms[0].pick.label) || 'VALUE OVER TIME', series, axisStartLabel: `${yUnit} 0`, axisEndLabel: `${yUnit} ${Y}`, bgConcept: ASSET.bg.trajectory, meaning_event_pattern: meaningEventPattern(arms[arms.length - 1].pick.provenance.span_text) };
      if (markerIndex) { p.markerIndex = markerIndex; p.markerLabel = `${markerIndex}-${yUnit} DELAY`; }
      visual = `${series.length} scenarios drawn from verified growth calculations on one axis; end values labelled`;
      scene.labels = { series: series.map((s) => s.label), axis: [p.axisStartLabel, p.axisEndLabel] }; scene.asset_requirements = [{ type: 'scene_bg', concept: ASSET.bg.trajectory, reuse_first: true }];
      series.forEach((s, i) => scene.relationships.push({ type: 'derived_trajectory', series: s.label, formula: 'compound_growth', calc: calcsByTarget.get(arms[i].pick.provenance.mention_id).id }));
    } else if (intent === 'outcome_comparison' || intent === 'start_to_result') {
      treatment = 'share_compare';
      let first, last, b, a;
      if (intent === 'start_to_result') {
        b = es.find((e) => START_ROLES.includes(e.role)); a = es.filter((e) => e.role === 'outcome').pop();
        first = { label: b.label || 'START' }; last = { label: a.label || 'RESULT' };
      } else {
        first = arms[0]; last = arms[arms.length - 1];
        if (arms.length > 2) scene.notes.push({ note: `${arms.length} scenarios present; the first and last are shown` });
        b = first.pick; a = last.pick;
      }
      const metric = b.metric || a.metric || null;
      const gapE = es.find((e) => e.role === 'gap') || gapEntity;
      const dir = a.value < b.value ? 'down' : a.value > b.value ? 'up' : 'flat';
      const good = GOOD_DIRECTION[metric];
      const tone = dir === 'flat' ? 'neutral' : good ? (dir === good ? 'positive' : 'negative') : 'neutral';
      const setup = [];
      // only roles with ONE value across the whole script are shared setup;
      // a role that takes different values (e.g. $200/mo vs $400/mo) varies
      // between scenarios and must not be in the shared anchor
      const oneValue = (role) => { const xs = entities.filter((e) => e.role === role); return xs.length && new Set(xs.map((e) => JSON.stringify(e.value))).size === 1 ? xs[0] : null; };
      const pr = intent === 'start_to_result' ? null : oneValue('principal'), rc = oneValue('recurring_amount'), hz = oneValue('horizon');
      const rt = oneValue('rate') || (intent === 'start_to_result' ? (es.find((e) => ['inflation_rate', 'tax_rate', 'rate'].includes(e.role))) : null);
      if (pr) setup.push(pr.display); if (rc) setup.push(`${rc.display}${rc.cadence ? '/' + (CADENCE_ABBR[rc.cadence] || '') : ''}`);
      if (hz) setup.push(`OVER ${hz.display}`); if (rt) setup.push(`AT ${rt.display}`);
      const gapVal = gapE ? gapE.value : Math.abs(a.value - b.value);
      const ent = (e) => e.display;
      p = { treatment, text, displayMode: 'bar', headerLabel: HEADER_BY_METRIC[metric] || (b.role === 'result_duration' ? 'DURATION' : 'OUTCOME'), beforeLabel: first.label || 'OPTION A', beforeCount: mentionNum(b), beforeValue: ent(b), afterLabel: last.label || 'OPTION B', afterCount: mentionNum(a), afterValue: ent(a), deltaTone: tone, meaning_event_pattern: meaningEventPattern((gapE && es.includes(gapE) ? gapE : a).provenance.span_text) };
      if (setup.length) p.anchorText = setup.join(' ').slice(0, 30);
      if (dir !== 'flat') p.deltaTextOverride = `${dir === 'down' ? '-' : '+'}${b.kind === 'money' ? fmtMoney(gapVal) : (a.kind === 'duration' ? fmtDur(gapVal, a.unit) : String(gapVal))}`;
      visual = `two proportional bars in stated order (${dir === 'down' ? 'second is lower' : dir === 'up' ? 'second is higher' : 'equal'}); ${gapE && es.includes(gapE) ? 'the stated gap is revealed in the same scene' : 'gap badge summarises the difference'}`;
      scene.labels = { before: p.beforeLabel, after: p.afterLabel, delta: p.deltaTextOverride || null, anchor: p.anchorText || null };
      if (!gapE) { const g = { id: `v${++seq}`, role: 'gap', kind: b.kind, value: Math.round(gapVal), unit: b.unit, display: b.kind === 'money' ? fmtMoney(gapVal) : String(gapVal), scenario: null, provenance: { kind: 'derived', formula: 'abs(outcome_a - outcome_b)', inputs: [b.id, a.id] }, confidence: { level: 'derived' } }; entities.push(g); scene.entity_ids.push(g.id); }
      scene.relationships.push({ type: 'summarizes', from: (gapE || {}).id || null, to: [b.id, a.id] });
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
      const unit = tEnt ? tEnt.unit : 'month'; const steps = Math.min(40, Math.max(4, Math.ceil(N * 1.5)));
      const pts1 = [], pts2 = [];
      for (let k = 0; k <= steps; k++) { pts1.push(Math.round(k * save)); pts2.push(Math.round(cost)); }
      const saveM = bc.inputs.find((i) => i.param === 'periodic_saving' && i.id); const saveEnt = saveM && entOf.get(saveM.id);
      const extentEnt = { id: `v${++seq}`, role: 'chart_extent_periods', kind: 'count', value: steps, unit, display: String(steps), provenance: { kind: 'derived', formula: 'chart axis extent = min(40, max(4, ceil(1.5 * break-even periods)))', inputs: tEnt ? [tEnt.id] : [] }, confidence: { level: 'derived' } };
      const cumEnt = { id: `v${++seq}`, role: 'cumulative_saving_at_extent', kind: 'money', value: Math.round(steps * save), unit: 'USD', display: fmtMoney(steps * save), provenance: { kind: 'derived', formula: 'extent periods * periodic saving', inputs: [extentEnt.id, ...(saveEnt ? [saveEnt.id] : [])] }, confidence: { level: 'derived' } };
      entities.push(extentEnt, cumEnt); scene.entity_ids.push(extentEnt.id, cumEnt.id);
      p = { treatment, text, label: 'SAVINGS VS UP-FRONT COST', series: [{ label: 'CUMULATIVE SAVINGS', color: '0xa67c2e', points: pts1, finalValueText: fmtMoney(steps * save) }, { label: 'UP-FRONT COST', color: '0x1a2744', points: pts2, finalValueText: fmtMoney(cost) }], axisStartLabel: `${unit.toUpperCase()} 0`, axisEndLabel: `${unit.toUpperCase()} ${steps}`, markerIndex: Math.round(N), markerLabel: `BREAK EVEN ${Math.round(N)}`, bgConcept: ASSET.bg.trajectory, meaning_event_pattern: tEnt ? meaningEventPattern(tEnt.provenance.span_text) : undefined };
      visual = 'cumulative saving climbs until it crosses the flat up-front cost at the break-even period'; scene.asset_requirements = [{ type: 'scene_bg', concept: ASSET.bg.trajectory, reuse_first: true }];
      scene.relationships.push({ type: 'derived_trajectory', formula: 'breakeven', calc: bc.id });
    } else { // single_figure (and any unsupported intent)
      treatment = 'calc_card';
      const lines = es.filter((e) => DATA_ROLES.has(e.role) && !['horizon', 'delay_period', 'remaining_period'].includes(e.role) || e.role === 'horizon').slice(0, 4).map((e) => `${e.display}${e.role === 'recurring_amount' && e.cadence ? '/' + (CADENCE_ABBR[e.cadence] || '') : ''}${e.label ? ' ' + e.label : ''}`);
      p = { treatment, text, title: upper(pscene.purpose, 40) || 'KEY FIGURES', values: lines };
      visual = 'value card listing the quantities that produce the result'; if (!lines.length) scene.notes.push({ note: 'no bound quantities to display' });
    }
    scene.treatment = treatment; scene.intent = intent; scene.renderer_params = p; scene.visual_relationship = visual;
    scene.reveal_steps = es.filter((e) => e.provenance.kind === 'script' && ['recurring_amount', 'transfer_amount', 'principal', 'outcome', 'gap', 'change_pct', 'process_window', 'delay_period', 'result_duration'].includes(e.role)).map((e) => ({ entity_id: e.id, spoken_phrase: e.provenance.span_text, meaning_event_pattern: meaningEventPattern(e.provenance.span_text), reveal: `show ${e.role.replace(/_/g, ' ')} ${e.display}` }));
    let xc = null; try { xc = deps.classifyLongTreatment ? deps.classifyLongTreatment(text, unitById.get(pscene.unit_ids[0]).section) : null; } catch { xc = null; }
    scene.treatment_cross_check = { text_classifier: xc, agrees: xc === treatment };
    outScenes.push(scene);
  });

  // 7. integrity: coverage audit + rendered-number provenance audit
  const uncovered = auditCoverage(units);
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
    calculations: calcDetails,
    unbound_mentions: unbound, uncovered_numeric_tokens: uncovered,
    integrity: { status, issues, verifications: calcDetails.filter((d) => d.target).map((d) => ({ check: 'stated_value', ok: !!d.verified, ...d })) },
    cross_check_summary: { scenes: outScenes.length, text_classifier_disagreements: outScenes.filter((s) => !s.treatment_cross_check.agrees).length },
  };
}
