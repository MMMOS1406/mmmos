// NextWave V2 — Autonomous Storyboard Brain validation gate.
//
// Runs the Brain (lib/nextwaveV2StoryboardBrain.mjs) against three scripts
// and scores each Brain output against a SEMANTIC rubric that was written
// BEFORE the Brain existed (grouping, financial roles, comparisons,
// time/cause relationships, treatment family, renderer values) — never
// scene counts. Zero vendor calls: everything here is deterministic local
// code. The Brain's dependencies (segmenter, number regex, words-to-number
// parser, treatment classifier) are lifted verbatim out of api/ops.js so the
// test exercises the REAL production functions, not copies.
//
// Usage: node test_nextwave_v2_storyboard_brain.mjs [--dump <dir>]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { nextwaveV2BuildStoryboard } from './lib/nextwaveV2StoryboardBrain.mjs';

// ── dependency lift from api/ops.js ────────────────────────────────────────
const src = readFileSync(new URL('./api/ops.js', import.meta.url), 'utf8');
function extractFn(name) {
  const startIdx = src.indexOf('function ' + name + '(');
  if (startIdx < 0) throw new Error('function not found: ' + name);
  const parenStart = src.indexOf('(', startIdx);
  let pd = 1, k = parenStart + 1;
  while (pd > 0) { if (src[k] === '(') pd++; else if (src[k] === ')') pd--; k++; }
  let i = src.indexOf('{', k), depth = 1, j = i + 1;
  while (depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
  return src.slice(startIdx, j);
}
function extractConst(name) {
  const idx = src.indexOf('const ' + name + ' =');
  if (idx < 0) throw new Error('const not found: ' + name);
  // A const may span lines and contain ';' inside strings/regex; find the
  // terminating ';' at end of line.
  const semi = src.indexOf(';\n', idx);
  return src.slice(idx, semi + 1);
}
const liftSrc = [
  'NEXTWAVE_V2_META_MARKER_RE', 'NEXTWAVE_V2_NUMBER_WORDS', 'NEXTWAVE_V2_DYNAMIC_NUMBER_RE',
  'NEXTWAVE_V2_ONES', 'NEXTWAVE_V2_TENS', 'NEXTWAVE_V2_SCALES',
  'NWV2_LONG_RECURRING_CUES', 'NWV2_LONG_GROWTH_CUES', 'NWV2_LONG_COMPARE_CUES',
].map(extractConst).join('\n') + '\n' + [
  'nextwaveSegmentMeaningUnits', '_nextwaveWordsToNumber', 'nextwaveHasDynamicNumbers', 'nwv2ClassifyLongTreatment',
].map(extractFn).join('\n') +
  '\nreturn { segmentMeaningUnits: nextwaveSegmentMeaningUnits, wordsToNumber: _nextwaveWordsToNumber, numberRegexSource: NEXTWAVE_V2_DYNAMIC_NUMBER_RE.source, classifyLongTreatment: nwv2ClassifyLongTreatment };';
export const deps = new Function(liftSrc)();

// ── the three scripts (UNMARKED — no [SECTION] hints, so scene boundaries
// must come from the Brain's own semantic grouping) ────────────────────────
export const SCRIPTS = {
  // Proof A. The spoken text is reconstructed from the accepted beats' text
  // fields (the original narration source string was not retained).
  A: "Your dividend is sitting there — but so is a hidden cost. Your portfolio just paid you $3,000 in dividends. But brokerages take 2 to 3 days to process the reinvestment. During that wait, the stock can rise 2%. Now the same $3,000 buys fewer shares. That's the real cost of the delay.",
  B: "Waiting five years to start investing can cost you more than you think. Say you invest five hundred dollars every month, assuming an average eight percent annual return. If you start today, that portfolio grows to about ninety one thousand, four hundred seventy three dollars after ten years. But if you wait five years before you start, contributing the same five hundred dollars a month for the remaining five years, you end up with only about thirty six thousand, seven hundred thirty eight dollars. That five year head start is worth a fifty four thousand, seven hundred thirty five dollar difference. The market did not create that gap. Time did.",
  // Synthetic structural test: different domain (loans), digits + words mixed,
  // comparison differentiated by RATE (not delay), no recurring contribution,
  // no time series — should require a different combination of primitives.
  C: "Choosing a mortgage rate is one of the biggest money decisions you will make. Say you borrow $300,000 for thirty years. At a 6% rate, you will pay back about $647,515 in total. At a 7% rate, you will pay back about $718,527 in total. That one point of interest costs you an extra $71,012. Shop around before you sign.",
};

// ── rubric helpers ─────────────────────────────────────────────────────────
const ents = (o, role) => (o.values || []).filter((e) => e.role === role);
const scenesWith = (o, pred) => (o.scenes || []).filter(pred);
const sceneOf = (o, entId) => (o.scenes || []).find((s) => (s.entity_ids || []).includes(entId));
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
const hasProv = (e) => e.provenance && ['script', 'derived', 'assumed_illustrative'].includes(e.provenance.kind);

// Checks that apply to every script.
function universalChecks(o) {
  const covered = (o.scenes || []).flatMap((s) => s.unit_ids);
  const allUnits = (o.units || []).map((u) => u.unit);
  return [
    ['every meaning unit covered exactly once, in order', JSON.stringify(covered) === JSON.stringify(allUnits)],
    ['every bound value carries evidence provenance', (o.values || []).every(hasProv)],
    ['no numeric mention in the script left silently unbound', (o.unbound_mentions || []).length === 0],
    // Added AFTER the hold-out probe exposed a silent-drop hole (see hold-out file).
    ['no quantity in the script silently uncovered by any extracted mention', (o.uncovered_numeric_tokens || []).length === 0],
    ['integrity status is clean (nothing needs human review)', o.integrity && o.integrity.status === 'clean'],
    ['no blocking integrity issue', !(o.integrity && (o.integrity.issues || []).some((i) => i.severity === 'blocking'))],
    ['first and last scenes are presenter scenes (avatar_panel)', o.scenes.length >= 2 && o.scenes[0].treatment === 'avatar_panel' && o.scenes[o.scenes.length - 1].treatment === 'avatar_panel'],
  ];
}

export const RUBRIC = {
  A: (o) => {
    const transfer = ents(o, 'transfer_amount')[0];
    const proc = ents(o, 'process_window')[0];
    const chg = ents(o, 'change_pct')[0];
    const tSc = transfer && sceneOf(o, transfer.id);
    const pSc = proc && sceneOf(o, proc.id);
    const cSc = chg && sceneOf(o, chg.id);
    const after = ents(o, 'units_after')[0];
    const before = ents(o, 'units_before')[0];
    const sameRel = (o.scenes || []).flatMap((s) => s.relationships || []).find((r) => r.type === 'same_as');
    const shareSc = scenesWith(o, (s) => s.treatment === 'share_compare')[0];
    return [
      ...universalChecks(o),
      ['$3,000 bound as a one-time transfer (script evidence)', !!transfer && transfer.value === 3000 && transfer.provenance.kind === 'script'],
      ['transfer scene uses money_flow', !!tSc && tSc.treatment === 'money_flow'],
      ['"2 to 3 days" bound as a process window range (script evidence)', !!proc && Array.isArray(proc.value) && proc.value[0] === 2 && proc.value[1] === 3 && proc.unit === 'day'],
      ['process window scene uses day_cards', !!pSc && pSc.treatment === 'day_cards'],
      ['"rise 2%" bound as an upward percentage change (script evidence)', !!chg && chg.value === 2 && chg.direction === 'up' && chg.provenance.kind === 'script'],
      ['price-change scene uses stock_chart', !!cSc && cSc.treatment === 'stock_chart'],
      ['transfer and process window are NOT lumped into one scene (concepts that do not belong together)', !!tSc && !!pSc && tSc.scene_id !== pSc.scene_id],
      ['"During that wait" relationship identified (price change happens inside the process window)', (o.scenes || []).flatMap((s) => s.relationships || []).some((r) => r.type === 'during')],
      ['"the same $3,000" identified as a reference back to the transfer amount', !!sameRel],
      ['fewer-shares consequence uses share_compare', !!shareSc],
      ['units-after is DERIVED from the stated +2% (not invented) and equals 98', !!after && after.provenance.kind === 'derived' && after.value === 98],
      ['the 100-unit base is explicitly flagged as assumed/illustrative (not presented as script fact)', !!before && before.provenance.kind === 'assumed_illustrative'],
      ['renderer: money_flow amountText === "$3,000"', !!tSc && tSc.renderer_params.amountText === '$3,000'],
      ['renderer: day_cards heroText === "2-3 DAYS"', !!pSc && pSc.renderer_params.heroText === '2-3 DAYS'],
      ['renderer: price chart axis window comes from the bound process window (DAY 3)', !!cSc && cSc.renderer_params.axisEndLabel === 'DAY 3'],
      ['renderer: share_compare anchor reads "SAME $3,000"', !!shareSc && shareSc.renderer_params.anchorText === 'SAME $3,000'],
      // Added after renderer-acceptance found a flat 2%-on-a-zero-axis chart:
      ['renderer: a +2% move is plotted as change-from-start (0 -> 2), so the rise is visible', !!cSc && (cSc.renderer_params.series[0].points || []).join(',') === '0,2'],
    ];
  },
  B: (o) => {
    const rec = ents(o, 'recurring_amount')[0];
    const rate = ents(o, 'rate')[0];
    const horizon = ents(o, 'horizon')[0];
    const delay = ents(o, 'delay_period')[0];
    const rem = ents(o, 'remaining_period')[0];
    const outs = ents(o, 'outcome');
    const o1 = outs.find((e) => near(e.value, 91473, 1));
    const o2 = outs.find((e) => near(e.value, 36738, 1));
    const gap = ents(o, 'gap')[0];
    const recSc = rec && sceneOf(o, rec.id);
    const cmpSc = o1 && sceneOf(o, o1.id);
    const gapSc = gap && sceneOf(o, gap.id);
    const last = o.scenes[o.scenes.length - 1];
    const verifs = (o.integrity && o.integrity.verifications) || [];
    return [
      ...universalChecks(o),
      ['$500 bound as recurring contribution amount with monthly cadence', !!rec && rec.value === 500 && rec.cadence === 'month'],
      ['8% bound as the assumed annual rate (not as a change)', !!rate && rate.value === 8],
      ['10 years bound as the horizon; 5 years bound as the delayed start', !!horizon && horizon.value === 10 && !!delay && delay.value === 5],
      ['contribution amount + cadence + rate grouped in ONE scene using money_flow', !!recSc && recSc.treatment === 'money_flow' && (recSc.entity_ids || []).includes(rate && rate.id)],
      ['start-now and wait-five-years outcomes grouped into ONE comparison scene', !!o1 && !!o2 && sceneOf(o, o2.id) === cmpSc],
      ['$91,473 belongs to the no-delay scenario; $36,738 to the delayed scenario', !!o1 && !!o2 && !o1.scenario_has_delay && o2.scenario_has_delay === true],
      ['"the remaining five years" bound as remaining period and cross-checked = horizon - delay', !!rem && rem.value === 5 && verifs.some((v) => v.check === 'remaining_period' && v.ok)],
      ['gap $54,735 bound as gap (script evidence) and verified against outcome difference', !!gap && near(gap.value, 54735, 1) && verifs.some((v) => v.check === 'gap' && v.ok)],
      ['stated outcomes independently verified by recurring-contribution growth calculation', verifs.filter((v) => v.check === 'outcome' && v.ok).length >= 2],
      ['comparison scene uses a real multi-series stock_chart (2 series, derived trajectories)', !!cmpSc && cmpSc.treatment === 'stock_chart' && ((cmpSc.renderer_params.series || []).length === 2)],
      ['gap consequence scene uses share_compare in bar mode', !!gapSc && gapSc.treatment === 'share_compare' && gapSc.renderer_params.displayMode === 'bar'],
      ['closing two sentences merged into ONE presenter scene', last.unit_ids.length === 2],
      ['renderer: series final labels $91,473 and $36,738', !!cmpSc && (cmpSc.renderer_params.series || []).map((s) => s.finalValueText).join('|') === '$91,473|$36,738'],
      ['renderer: head-start marker at year 5, axis YEAR 0..YEAR 10', !!cmpSc && cmpSc.renderer_params.markerIndex === 5 && cmpSc.renderer_params.axisStartLabel === 'YEAR 0' && cmpSc.renderer_params.axisEndLabel === 'YEAR 10'],
      ['renderer: bar comparison anchor "$500/MO AT 8% FOR 10 YEARS", delta "-$54,735"', !!gapSc && gapSc.renderer_params.anchorText === '$500/MO AT 8% FOR 10 YEARS' && gapSc.renderer_params.deltaTextOverride === '-$54,735'],
      // Added after renderer-acceptance found header/hero contradiction in bar mode:
      ['renderer: bar header is neutral (FINAL VALUE), never a scenario label that contradicts the swapped hero value', !!gapSc && gapSc.renderer_params.headerLabel === 'FINAL VALUE'],
    ];
  },
  C: (o) => {
    const prin = ents(o, 'principal')[0];
    const horizon = ents(o, 'horizon')[0];
    const rates = ents(o, 'rate');
    const outs = ents(o, 'outcome');
    const o6 = outs.find((e) => near(e.value, 647515, 1));
    const o7 = outs.find((e) => near(e.value, 718527, 1));
    const gap = ents(o, 'gap')[0];
    const prSc = prin && sceneOf(o, prin.id);
    const cmpSc = o6 && sceneOf(o, o6.id);
    const verifs = (o.integrity && o.integrity.verifications) || [];
    const dataScenes = (o.scenes || []).filter((s) => s.treatment !== 'avatar_panel');
    return [
      ...universalChecks(o),
      ['$300,000 bound as principal and 30 years as horizon/term (mixed digit + word forms)', !!prin && prin.value === 300000 && !!horizon && horizon.value === 30],
      ['principal scene uses money_flow (loan flow, not a dividend/contribution)', !!prSc && prSc.treatment === 'money_flow'],
      ['6% and 7% both bound as rates (not as changes)', rates.length === 2 && rates.some((e) => e.value === 6) && rates.some((e) => e.value === 7)],
      ['the two loan totals grouped into ONE comparison scene', !!o6 && !!o7 && sceneOf(o, o7.id) === cmpSc],
      ['comparison differentiated by RATE (6% vs 7%), not by delay', !!cmpSc && cmpSc.comparison && cmpSc.comparison.differentiator === 'rate'],
      ['gap $71,012 bound as gap and merged into the same evolving comparison scene (cause + consequence)', !!gap && near(gap.value, 71012, 1) && sceneOf(o, gap.id) === cmpSc],
      ['exactly two data scenes (loan flow, comparison) — no repeated treatment', dataScenes.length === 2],
      ['comparison uses share_compare bar mode; NO stock_chart (no time-series inputs exist)', !!cmpSc && cmpSc.treatment === 'share_compare' && cmpSc.renderer_params.displayMode === 'bar' && !(o.scenes || []).some((s) => s.treatment === 'stock_chart')],
      ['both totals independently verified by loan-payment calculation', verifs.filter((v) => v.check === 'outcome' && v.ok).length >= 2],
      ['gap verified against outcome difference', verifs.some((v) => v.check === 'gap' && v.ok)],
      ['renderer: larger total is the bar reference ($718,527 before, $647,515 after)', !!cmpSc && cmpSc.renderer_params.beforeValue === '$718,527' && cmpSc.renderer_params.afterValue === '$647,515'],
      ['renderer: anchor carries principal and term', !!cmpSc && /\$300,000/.test(cmpSc.renderer_params.anchorText || '') && /30 YEARS/.test(cmpSc.renderer_params.anchorText || '')],
      ['renderer: bar header is neutral (TOTAL PAID), never a scenario label', !!cmpSc && cmpSc.renderer_params.headerLabel === 'TOTAL PAID'],
    ];
  },
};

// ── runner ─────────────────────────────────────────────────────────────────
export function runAll() {
  const results = {};
  for (const key of Object.keys(SCRIPTS)) {
    const out = nextwaveV2BuildStoryboard(SCRIPTS[key], deps);
    const checks = out.ok ? RUBRIC[key](out) : [['brain returned ok', false]];
    results[key] = { out, checks };
  }
  return results;
}

if (process.argv[1] && process.argv[1].endsWith('test_nextwave_v2_storyboard_brain.mjs')) {
  const results = runAll();
  const dumpIdx = process.argv.indexOf('--dump');
  if (dumpIdx > -1) {
    const dir = process.argv[dumpIdx + 1];
    mkdirSync(dir, { recursive: true });
    for (const k of Object.keys(results)) writeFileSync(`${dir}/storyboard_${k}.json`, JSON.stringify(results[k].out, null, 2));
  }
  let pass = 0, total = 0;
  for (const k of Object.keys(results)) {
    const names = { A: 'PROOF A', B: 'PROOF B', C: 'TEST 3 (synthetic loans)' };
    console.log(`\n=== ${names[k]} ===`);
    results[k].checks.forEach(([name, ok]) => { total++; if (ok) pass++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name); });
    const p = results[k].checks.filter(([, ok]) => ok).length;
    console.log(`--- ${p}/${results[k].checks.length}`);
  }
  console.log(`\nSTORYBOARD BRAIN: ${pass}/${total} checks passed`);
  process.exit(pass === total ? 0 : 1);
}
