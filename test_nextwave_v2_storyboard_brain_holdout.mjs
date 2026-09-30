// DIAGNOSTIC hold-out probe for the Autonomous Storyboard Brain (non-gating).
//
// The three gating scripts (test_nextwave_v2_storyboard_brain.mjs) are the
// order's validation set. Because the author designed the Brain's cue
// vocabulary while writing Test 3, a pass there proves the test is
// satisfiable — not that the Brain generalizes. These scripts are written in
// deliberately different phrasing, with expectations fixed BEFORE the run.
//
// Two tiers per script:
//   FULL      : the Brain understood the script completely.
//   FAIL-SAFE : whatever it did NOT understand was surfaced (unbound /
//               uncovered), and nothing was bound confidently to a WRONG role.
// For a finance-publishing system FAIL-SAFE is the property that must hold
// even when FULL does not.
import { nextwaveV2BuildStoryboard } from './lib/nextwaveV2StoryboardBrain.mjs';
import { deps } from './test_nextwave_v2_storyboard_brain.mjs';

export const HOLDOUT = {
  H1_paraphrase_of_B: {
    script: "Every month you put $300 into an index fund that earns 7% a year on average. Begin now, and you will have about $51,925 after 10 years. Hold off for 5 years and then contribute the same $300 monthly for the last 5 years, and you will only have about $21,478. That head start is worth $30,448. Do not put it off.",
    // raw mention text -> acceptable roles. A bound role outside the set = MISBOUND.
    acceptable: { '$300': ['recurring_amount'], '7%': ['rate'], '$51,925': ['outcome'], '10 years': ['horizon'], '5 years': ['delay_period', 'remaining_period'], '$21,478': ['outcome'], '$30,448': ['gap'] },
    full: (o, ents) => [
      ['recurring $300 monthly', ents('recurring_amount').some((e) => e.value === 300 && e.cadence === 'month')],
      ['7% is a rate (not a change)', ents('rate').some((e) => e.value === 7)],
      ['10-year horizon', ents('horizon').some((e) => e.value === 10)],
      ['5-year delay', ents('delay_period').some((e) => e.value === 5)],
      ['"the last 5 years" bound as remaining period', ents('remaining_period').some((e) => e.value === 5)],
      ['both outcomes in ONE comparison scene, delayed one flagged', (() => { const a = ents('outcome').find((e) => e.value === 51925), b = ents('outcome').find((e) => e.value === 21478); return !!a && !!b && o.scenes.some((s) => s.entity_ids.includes(a.id) && s.entity_ids.includes(b.id)) && b.scenario_has_delay === true; })()],
      ['gap $30,448 bound as gap', ents('gap').some((e) => e.value === 30448)],
      ['comparison rendered as a derived multi-series chart', o.scenes.some((s) => s.treatment === 'stock_chart' && (s.renderer_params.series || []).length === 2)],
    ],
  },
  H2_fee_drag: {
    script: "You invest $10,000 in a fund that charges a 1% annual fee. Over 20 years at 7% growth, $10,000 becomes $38,697 with no fee, but only $32,071 with the fee. That fee costs you $6,626. Watch your fees.",
    acceptable: { '$10,000': ['principal', 'outcome_base'], '1%': ['fee_rate'], '20 years': ['horizon'], '7%': ['rate'], '$38,697': ['outcome'], '$32,071': ['outcome'], '$6,626': ['gap'] },
    full: (o, ents) => [
      ['$10,000 bound as principal', ents('principal').some((e) => e.value === 10000)],
      ['1% bound as a FEE (not a return)', ents('fee_rate').some((e) => e.value === 1)],
      ['7% bound as the growth rate', ents('rate').some((e) => e.value === 7)],
      ['20-year horizon', ents('horizon').some((e) => e.value === 20)],
      ['with-fee / no-fee outcomes grouped in ONE comparison scene with a real differentiator', (() => { const a = ents('outcome').find((e) => e.value === 38697), b = ents('outcome').find((e) => e.value === 32071); const sc = a && b && o.scenes.find((s) => s.entity_ids.includes(a.id) && s.entity_ids.includes(b.id)); return !!sc && !!sc.comparison && !!sc.comparison.differentiator; })()],
      ['gap $6,626 bound as gap', ents('gap').some((e) => e.value === 6626)],
      ['comparison uses share_compare bar; no time-series chart', o.scenes.some((s) => s.treatment === 'share_compare' && s.renderer_params.displayMode === 'bar') && !o.scenes.some((s) => s.treatment === 'stock_chart')],
    ],
  },
  H3_inflation: {
    script: "Inflation quietly erodes your cash. If prices rise 3% a year, something that costs $100 today will cost about $134 in 10 years. That is why holding cash has a hidden price.",
    acceptable: { '3%': ['rate', 'change_pct'], '$100': ['principal'], '$134': ['outcome'], '10 years': ['horizon'] },
    full: (o, ents) => [
      ['3% bound (rate or change)', ents('rate').concat(ents('change_pct')).some((e) => e.value === 3)],
      ['$100 bound to a starting-amount role', ents('principal').some((e) => e.value === 100)],
      ['$134 bound as an outcome', ents('outcome').some((e) => e.value === 134)],
      ['10 years bound as horizon', ents('horizon').some((e) => e.value === 10)],
    ],
  },
  H4_process_paraphrase: {
    script: "Your fund paid out $1,500 in dividends. It takes 3 business days to reinvest that money. Meanwhile the share price can climb 1.5%. So the same $1,500 buys fewer shares. Reinvest promptly.",
    acceptable: { '$1,500': ['transfer_amount', 'same_as'], '3 business days': ['process_window'], '1.5%': ['change_pct'] },
    full: (o, ents) => [
      ['$1,500 bound as transfer', ents('transfer_amount').some((e) => e.value === 1500)],
      ['"3 business days" captured as a process window', ents('process_window').some((e) => upperBoundV(e.value) === 3)],
      ['1.5% bound as an upward change', ents('change_pct').some((e) => e.value === 1.5 && e.direction === 'up')],
      ['units_after derived = 99 (100/1.015)', ents('units_after').some((e) => e.value === 99)],
    ],
  },
};
const upperBoundV = (v) => (Array.isArray(v) ? v[1] : v);

function failSafe(key, cfg, o) {
  const ents = (r) => o.values.filter((e) => e.role === r);
  const digitTokens = [...cfg.script.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)].map((m) => m[0]);
  const spans = o.values.filter((e) => e.provenance.kind === 'script').flatMap((e) => [e.provenance.span_text, ...(e.provenance.also_stated_in || []).map((a) => a.span_text)]);
  // A quantity the Brain explicitly REPORTS as uncovered counts as surfaced, not silent.
  const unboundRaw = (o.unbound_mentions || []).map((m) => m.raw).concat((o.uncovered_numeric_tokens || []).map((t) => t.token));
  const uncovered = digitTokens.filter((t) => ![...spans, ...unboundRaw].some((sp) => sp && sp.includes(t.replace(/[$%]/g, '').replace(/,$/, ''))));
  const misbound = [];
  o.values.filter((e) => e.provenance.kind === 'script').forEach((e) => {
    const allowed = Object.entries(cfg.acceptable).find(([raw]) => e.provenance.span_text.replace(/\s+/g, ' ').includes(raw) || raw.includes(e.provenance.span_text));
    if (allowed && !allowed[1].includes(e.role) && !['cadence'].includes(e.role)) misbound.push(`${e.provenance.span_text} -> ${e.role} (expected ${allowed[1].join('|')})`);
  });
  return { uncovered, misbound, unbound: o.unbound_mentions || [] };
}

const results = {};
for (const [key, cfg] of Object.entries(HOLDOUT)) {
  const o = nextwaveV2BuildStoryboard(cfg.script, deps);
  const ents = (r) => o.values.filter((e) => e.role === r);
  const full = cfg.full(o, ents);
  const fs = failSafe(key, cfg, o);
  results[key] = { o, full, fs };
  console.log(`\n=== ${key} ===`);
  console.log('scenes: ' + o.scenes.map((s) => `${s.unit_ids.join('+')}:${s.treatment}`).join('  '));
  full.forEach(([n, ok]) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n));
  console.log(`FAIL-SAFE  misbound=${fs.misbound.length}${fs.misbound.length ? ' ' + JSON.stringify(fs.misbound) : ''}  unbound-reported=${fs.unbound.length}${fs.unbound.length ? ' ' + JSON.stringify(fs.unbound.map((u) => u.raw + ' [' + u.reason + ']')) : ''}  silently-uncovered=${fs.uncovered.length}${fs.uncovered.length ? ' ' + JSON.stringify(fs.uncovered) : ''}`);
  console.log(`integrity status: ${o.integrity.status}   Brain-reported uncovered tokens: ${JSON.stringify((o.uncovered_numeric_tokens || []).map((t) => t.token + ' in \"' + t.context + '\"'))}`);
}
const fullPass = Object.values(results).filter((r) => r.full.every(([, ok]) => ok)).length;
const failSafePass = Object.values(results).filter((r) => r.fs.misbound.length === 0 && r.fs.uncovered.length === 0).length;
console.log(`\nHOLD-OUT SUMMARY: FULL ${fullPass}/${Object.keys(results).length}   FAIL-SAFE ${failSafePass}/${Object.keys(results).length}`);
