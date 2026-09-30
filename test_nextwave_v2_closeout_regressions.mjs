// Targeted regression tests for the six closeout defect classes. No live model: a STUB model
// returns fixed proposals so each deterministic rule is exercised directly and repeatably.
import { deps as baseDeps } from './test_nextwave_v2_storyboard_brain.mjs';
import { analyzeUnit } from './lib/nextwaveV2StoryboardBrain.mjs';
import { nextwaveV2BuildStoryboardSemantic, gateLabel, cadenceWordsIn } from './lib/nextwaveV2SemanticStoryboard.mjs';

let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : (fail++, console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '')); };

// spec: { roles: { raw: [roleA, roleB?] }, labels: { raw: label }, intent, calcs: [{ model, inputs:{param: raw|{calc}|{literal}}, output, target: raw }] }
function stub(spec) {
  return async (system, user) => {
    const isA = /semantic interpreter/.test(system);
    const ids = new Map(); for (const m of user.matchAll(/«([^»]+)»\{([^}]+)\}/g)) if (!ids.has(m[1])) ids.set(m[1], m[2]);
    const id = (raw) => { const v = ids.get(raw); if (!v) throw new Error('stub: no mention for ' + raw); return v; };
    const unitIds = [...user.matchAll(/^\[(u\d+)\]/gm)].map((m) => m[1]);
    const mentions = [...ids.entries()].map(([raw, mid]) => { const rr = spec.roles[raw] || ['none']; return { id: mid, role: isA ? rr[0] : (rr[1] || rr[0]), confidence: 0.95, evidence: raw, scenario: null, direction: null, cadence: (spec.cadence || {})[raw] || null, metric: (spec.metric || {})[raw] || null, label: (spec.labels || {})[raw] || null }; });
    const conv = (v) => (typeof v === 'string' ? (ids.has(v) ? id(v) : v) : v.calc ? { calc: v.calc, output: v.output || 'value' } : { literal: v.literal });
    const calcs = (spec.calcs || []).map((c, i) => ({ id: `c${i + 1}`, model: c.model, inputs: Object.fromEntries(Object.entries(c.inputs).map(([k, v]) => [k, conv(v)])), output: c.output, target: c.target ? id(c.target) : null }));
    const body = { mentions, scenarios: [], scenes: [{ unit_ids: unitIds, intent: spec.intent || 'single_figure', purpose: spec.purpose || null, from_label: null, to_label: null }], calculations: calcs };
    return { text: `<json>${JSON.stringify(body)}</json>`, usage: { input_tokens: 0, output_tokens: 0 } };
  };
}
const run = (script, spec) => nextwaveV2BuildStoryboardSemantic(script, { ...baseDeps, callModel: stub(spec) });
const disp = (o, raw) => (o.values.find((v) => v.provenance && v.provenance.span_text === raw) || {}).display;
const ent = (o, raw) => o.values.find((v) => v.provenance && v.provenance.span_text === raw);

// ── 6. extraction: coordinated percent ────────────────────────────────────────
{
  const units = baseDeps.segmentMeaningUnits('Refinancing from 6.8 to 5.2 percent drops the payment.').map((u) => analyzeUnit(u, baseDeps));
  const ms = units.flatMap((u) => u.mentions);
  t('extraction: "6.8" is a percent mention', ms.some((m) => m.raw === '6.8' && m.kind === 'percent' && m.value === 6.8), ms.map((m) => m.raw));
  t('extraction: "5.2 percent" kept', ms.some((m) => m.raw === '5.2 percent' && m.kind === 'percent'));
  const u2 = baseDeps.segmentMeaningUnits('Rates were 4 or 9 percent.').map((u) => analyzeUnit(u, baseDeps)).flatMap((u) => u.mentions);
  t('extraction: "4 or 9 percent" -> two percents', u2.filter((m) => m.kind === 'percent').length === 2, u2.map((m) => m.raw));
  const u3 = baseDeps.segmentMeaningUnits('You have 3 apples and 5 percent luck.').map((u) => analyzeUnit(u, baseDeps)).flatMap((u) => u.mentions);
  t('extraction: unconnected bare number is NOT given a percent unit', !u3.some((m) => m.raw === '3' && m.kind === 'percent'), u3.map((m) => m.raw));
}

// ── 3. scale words ────────────────────────────────────────────────────────────
{
  const o = await run('You retire with $1.2 million and a second fund of $2.5 billion.', { roles: { '$1.2 million': ['outcome'], '$2.5 billion': ['outcome'] } });
  t('scale: $1.2 million', disp(o, '$1.2 million') === '$1,200,000', disp(o, '$1.2 million'));
  t('scale: $2.5 billion', disp(o, '$2.5 billion') === '$2,500,000,000', disp(o, '$2.5 billion'));
  const o2 = await run('The latte costs $6.72 and the lunch costs $12.', { roles: { '$6.72': ['baseline_amount'], '$12': ['baseline_amount'] } });
  t('precision: $6.72 stays $6.72', disp(o2, '$6.72') === '$6.72', disp(o2, '$6.72'));
  t('precision: whole dollars stay whole', disp(o2, '$12') === '$12');
}

// ── 5. model-label factual gate ───────────────────────────────────────────────
{
  t('gate: MONTHLY removed without evidence', gateLabel('MONTHLY PAYCHECK', []) === 'PAYCHECK');
  t('gate: MONTHLY kept with month evidence', gateLabel('MONTHLY PAYCHECK', ['month']) === 'MONTHLY PAYCHECK');
  t('gate: ANNUAL RETURN exempt', gateLabel('ANNUAL RETURN', []) === 'ANNUAL RETURN');
  t('gate: ANNUAL COST needs year evidence', gateLabel('ANNUAL COST', []) === 'COST' && gateLabel('ANNUAL COST', ['year']) === 'ANNUAL COST');
  t('gate: label that is only a cadence word is dropped', gateLabel('MONTHLY', []) === null);
  t('gate: cadenceWordsIn', JSON.stringify(cadenceWordsIn('WEEKLY SAVING')) === '["week"]');
  const o = await run('Your paycheck is $3,000 and your rent is $1,000.', { roles: { '$3,000': ['income_amount'], '$1,000': ['recurring_amount'] }, labels: { '$3,000': 'MONTHLY PAYCHECK', '$1,000': 'RENT' } });
  t('gate: unsupported MONTHLY stripped from entity label', ent(o, '$3,000').label === 'PAYCHECK', ent(o, '$3,000').label);
  const o2 = await run('Your paycheck is $3,000 a month and your rent is $1,000.', { roles: { '$3,000': ['income_amount'], '$1,000': ['recurring_amount'] }, labels: { '$3,000': 'MONTHLY PAYCHECK', '$1,000': 'RENT' } });
  t('gate: supported MONTHLY kept', ent(o2, '$3,000').label === 'MONTHLY PAYCHECK', ent(o2, '$3,000').label);
  const strs = JSON.stringify(o.scenes.map((s) => s.renderer_params));
  t('gate: no MONTHLY on any rendered string without evidence', !/MONTHLY|\/MO/.test(strs), strs.slice(0, 200));
}

// ── 1. delay role reconciliation ──────────────────────────────────────────────
{
  const S = 'Save $200 a month for 30 years at 6 percent. Wait five years and save for 25 years.';
  const roles = { '$200': ['recurring_amount'], '30 years': ['horizon'], '6 percent': ['rate'], 'five years': ['delay_period'], '25 years': ['horizon', 'remaining_period'] };
  const o = await run(S, { roles });
  const d = o.decisions.find((x) => o.quantities.find((q) => q.id === x.id && q.raw === '25 years'));
  t('delay: 30 - 5 = 25 reconciles remaining_period/horizon', d && d.role === 'remaining_period' && d.delay_reconciled, d);
  t('delay: no unbound review for the reconciled period', !o.integrity.issues.some((i) => i.kind === 'unbound_value' && i.raw === '25 years'), o.integrity.issues);
  const o2 = await run('Save $200 a month for 30 years at 6 percent. Wait four years and save for 25 years.', { roles: { ...roles, 'four years': ['delay_period'] } });
  const d2 = o2.decisions.find((x) => o2.quantities.find((q) => q.id === x.id && q.raw === '25 years'));
  t('delay: 30 - 4 != 25 keeps the ambiguity', d2 && !d2.role && d2.status === 'disagree', d2);
  const o3 = await run('Save $200 a month for 30 years at 6 percent.', { roles: { '$200': ['recurring_amount'], '30 years': ['horizon', 'remaining_period'], '6 percent': ['rate'] } });
  const d3 = o3.decisions.find((x) => o3.quantities.find((q) => q.id === x.id && q.raw === '30 years'));
  t('delay: with no stated delay, horizon/remaining_period stays ambiguous', d3 && !d3.role, d3);
}

// ── 2. gain / tax relationship ────────────────────────────────────────────────
{
  const S = "Selling $40,000 of stock bought for $25,000 leaves a $15,000 gain, and at 15 percent that's $2,250 in tax.";
  const o = await run(S, {
    intent: 'start_to_result',
    roles: { '$40,000': ['transfer_amount'], '$25,000': ['principal'], '$15,000': ['baseline_amount'], '15 percent': ['tax_rate'], '$2,250': ['outcome'] },
    calcs: [{ model: 'arithmetic', inputs: { op: { literal: 'difference' }, a: '$40,000', b: '$25,000' }, output: 'value', target: '$15,000' },
            { model: 'arithmetic', inputs: { op: { literal: 'share_of' }, a: '$15,000', b: '15 percent' }, output: 'value', target: '$2,250' }],
  });
  const bars = o.scenes.filter((s) => s.treatment === 'share_compare');
  t('gain/tax: never drawn as a before->after comparison', bars.length === 0, o.scenes.map((s) => [s.treatment, s.intent]));
  t('gain/tax: shown as a card with the tax as a liability line', o.scenes.some((s) => s.treatment === 'calc_card' && s.renderer_params.values.some((v) => /TAX|\$2,250/.test(v))), o.scenes.map((s) => s.renderer_params.values));
  // explicit after-tax figure: gross -> after-tax is a legitimate restatement
  const o2 = await run('A $15,000 gain taxed at 15 percent leaves $12,750.', {
    intent: 'start_to_result', roles: { '$15,000': ['baseline_amount'], '15 percent': ['tax_rate'], '$12,750': ['outcome'] },
    calcs: [{ model: 'after_tax', inputs: { amount: '$15,000', tax_rate: '15 percent' }, output: 'after_tax_proceeds', target: '$12,750' }],
  });
  t('gain/tax: gross -> explicit after-tax gain IS a valid comparison', o2.scenes.some((s) => s.treatment === 'share_compare') && o2.integrity.status === 'clean', [o2.scenes.map((s) => s.treatment), o2.integrity.issues]);
}

// ── 4. time-basis suffix consistency ──────────────────────────────────────────
{
  const o = await run('Your bill is $100 a month and taxes add $20, for $120 a month in total.', {
    roles: { '$100': ['recurring_amount'], '$20': ['gap'], '$120': ['outcome'] },
    calcs: [{ model: 'arithmetic', inputs: { op: { literal: 'sum' }, a: '$100', b: '$20' }, output: 'value', target: '$120' }],
  });
  const card = o.scenes.find((s) => s.treatment === 'calc_card');
  t('suffix: every amount of a verified sum shares the supported basis', card && card.renderer_params.values.every((v) => /\/MO/.test(v)), card && card.renderer_params.values);
  t('suffix: propagated cadence is marked as calc-propagated', ent(o, '$20').cadence_evidence === 'calc_propagated', ent(o, '$20'));
  // a stock amount is NOT made periodic by a per-year share of it
  const o2 = await run('A $50,000 portfolio yielding 3 percent pays about $1,500 a year.', {
    roles: { '$50,000': ['principal'], '3 percent': ['rate'], '$1,500': ['outcome'] },
    calcs: [{ model: 'arithmetic', inputs: { op: { literal: 'share_of' }, a: '$50,000', b: '3 percent' }, output: 'value', target: '$1,500' }],
  });
  const c2 = o2.scenes.find((s) => s.treatment === 'calc_card');
  t('suffix: a portfolio is not per-year because its yield is', c2 && !c2.renderer_params.values.some((v) => /^\$50,000\/YR/.test(v)) && c2.renderer_params.values.some((v) => /^\$1,500\/YR/.test(v)), c2 && c2.renderer_params.values);
  // an ending balance is not periodic because a contribution in the clause is
  const o3 = await run("Save $200 a month for 30 years at 6 percent and you'll have $200,903.", {
    roles: { '$200': ['recurring_amount'], '30 years': ['horizon'], '6 percent': ['rate'], '$200,903': ['outcome'] },
    calcs: [{ model: 'compound_growth', inputs: { recurring: '$200', cadence: { literal: 'month' }, rate: '6 percent', years: '30 years' }, output: 'end_value', target: '$200,903' }],
  });
  const c3 = o3.scenes.find((s) => s.treatment === 'calc_card');
  t('suffix: an ending balance never gets a per-period suffix', c3 && c3.renderer_params.values.some((v) => /^\$200,903 /.test(v)) && !c3.renderer_params.values.some((v) => /^\$200,903\//.test(v)), c3 && c3.renderer_params.values);
}

console.log(`closeout regression tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
