// THIRD hold-out set (round 3) — written AFTER the final semantic corrections
// (validator coverage for every factual treatment, milestone growth, message-aware
// evidence selection, percent+dollar change visuals, card quality, money-input role
// reconciliation) and frozen by SHA-256 (freeze_third.json) BEFORE its first run.
// F1-F9 and the second set (N01-N14/S1-S4) are SPENT development data; nothing
// here reuses their scripts. If the Brain, prompts or renderer change in response
// to this set's results, this set is no longer untouched.
//
// Format: see fresh_holdout.mjs / dev_set.mjs.
const fvLump = (p, r, y) => p * Math.pow(1 + r, y);
const fvPer = (pmt, annual, per, years) => { const r = annual / per, n = years * per; return pmt * ((Math.pow(1 + r, n) - 1) / r); };
const loanPmt = (P, annual, years) => { const r = annual / 12, n = years * 12; return (P * r) / (1 - Math.pow(1 + r, -n)); };
const nper = (P, annual, pmt) => { const r = annual / 12; return -Math.log(1 - (r * P) / pmt) / Math.log(1 + r); };

export const THIRD = [
  // ── normal NextWave-domain scripts ────────────────────────────────────────
  {
    id: 'T01_flow_single_amount',
    script: "Every payday, $400 goes straight from your checking account into your brokerage account.",
    mentions: [{ raw: '$400', roles: ['recurring_amount', 'transfer_amount'] }],
    calcs: [], together: [], status: 'PASS',
  },
  {
    id: 'T02_flow_roth_growth',
    script: "You send $300 a month into a Roth IRA earning 6 percent, and after 25 years it grows to about $207,898.",
    mentions: [{ raw: '$300', roles: ['recurring_amount'] }, { raw: '6 percent', roles: ['rate'] }, { raw: '25 years', roles: ['horizon'] }, { raw: '$207,898', roles: ['outcome'] }],
    calcs: [{ target: '$207,898', expected: () => fvPer(300, 0.06, 12, 25) }],
    together: [['$300', '$207,898']], status: 'PASS',
  },
  {
    id: 'T03_milestones_recurring',
    script: "Save $250 a month at 6 percent. After 10 years you'll have about $40,970, after 20 years about $115,510, and after 30 years about $251,129.",
    mentions: [
      { raw: '$250', roles: ['recurring_amount'] }, { raw: '6 percent', roles: ['rate'] },
      { raw: '10 years', roles: ['horizon'] }, { raw: '$40,970', roles: ['outcome'] },
      { raw: '20 years', roles: ['horizon'] }, { raw: '$115,510', roles: ['outcome'] },
      { raw: '30 years', roles: ['horizon'] }, { raw: '$251,129', roles: ['outcome'] },
    ],
    calcs: [
      { target: '$40,970', expected: () => fvPer(250, 0.06, 12, 10) },
      { target: '$115,510', expected: () => fvPer(250, 0.06, 12, 20) },
      { target: '$251,129', expected: () => fvPer(250, 0.06, 12, 30) },
    ],
    together: [['$40,970', '$115,510'], ['$115,510', '$251,129']], status: 'PASS',
  },
  {
    id: 'T04_nominal_vs_real_nest_egg',
    script: "Your $200,000 nest egg grows 5 percent a year for 20 years to about $530,660, but with 3 percent inflation that only buys what about $293,813 buys today.",
    mentions: [
      { raw: '$200,000', roles: ['principal'] }, { raw: '5 percent', roles: ['rate'] }, { raw: '20 years', roles: ['horizon'] },
      { raw: '$530,660', roles: ['outcome'] }, { raw: '3 percent', roles: ['inflation_rate'] }, { raw: '$293,813', roles: ['outcome'] },
    ],
    calcs: [
      { target: '$530,660', expected: () => fvLump(200000, 0.05, 20) },
      { target: '$293,813', expected: () => fvLump(200000, 0.05, 20) / Math.pow(1.03, 20) },
    ],
    together: [['$530,660', '$293,813']], status: 'PASS',
  },
  {
    id: 'T05_gross_vs_net_gain',
    script: "You sell shares for a $25,000 gain. At a 15 percent long-term rate you owe $3,750 and keep $21,250.",
    mentions: [
      { raw: '$25,000', roles: ['transfer_amount', 'principal', 'baseline_amount'] }, { raw: '15 percent', roles: ['tax_rate'] },
      { raw: '$3,750', roles: ['outcome', 'gap'] }, { raw: '$21,250', roles: ['outcome'] },
    ],
    calcs: [{ target: '$3,750', expected: () => 25000 * 0.15 }, { target: '$21,250', expected: () => 25000 * 0.85 }],
    together: [['$3,750', '$21,250']], status: 'PASS',
  },
  {
    id: 'T06_insurance_pct_and_dollars',
    script: "Your car insurance jumped 12 percent, from $150 to $168 a month, which adds $216 a year.",
    mentions: [
      { raw: '12 percent', roles: ['change_pct'] }, { raw: '$150', roles: ['recurring_amount'], basis: 'per_month' },
      { raw: '$168', roles: ['recurring_amount', 'outcome'], basis: 'per_month' }, { raw: '$216', roles: ['gap', 'outcome'], basis: 'per_year' },
    ],
    calcs: [{ target: '$168', expected: () => 150 * 1.12 }, { target: '$216', expected: () => (168 - 150) * 12 }],
    together: [['$150', '$168']], status: 'PASS',
  },
  {
    id: 'T07_refinance_pct_decrease',
    script: "Refinancing cut your payment by 25 percent, from $2,400 to $1,800 a month.",
    mentions: [
      { raw: '25 percent', roles: ['change_pct'] }, { raw: '$2,400', roles: ['recurring_amount'], basis: 'per_month' }, { raw: '$1,800', roles: ['recurring_amount', 'outcome'], basis: 'per_month' },
    ],
    calcs: [{ target: '$1,800', expected: () => 2400 * 0.75 }],
    together: [['$2,400', '$1,800']], status: 'PASS',
  },
  {
    id: 'T08_refi_rate_a_vs_b',
    script: "A $20,000 loan at 9 percent over five years costs $415 a month. Refinance at 6 percent and it drops to $387 a month.",
    mentions: [
      { raw: '$20,000', roles: ['principal'] }, { raw: '9 percent', roles: ['rate'] }, { raw: 'five years', roles: ['horizon'] },
      { raw: '$415', roles: ['outcome', 'recurring_amount'], basis: 'per_month' }, { raw: '6 percent', roles: ['rate'] }, { raw: '$387', roles: ['outcome', 'recurring_amount'], basis: 'per_month' },
    ],
    calcs: [{ target: '$415', expected: () => loanPmt(20000, 0.09, 5) }, { target: '$387', expected: () => loanPmt(20000, 0.06, 5) }],
    together: [['$415', '$387']], status: 'PASS',
  },
  {
    id: 'T09_fee_vs_no_fee',
    script: "On $60,000 invested for 20 years at 7 percent, a no-fee fund grows to $232,181, while a fund charging 1.5 percent a year ends near $175,065.",
    mentions: [
      { raw: '$60,000', roles: ['principal'] }, { raw: '20 years', roles: ['horizon'] }, { raw: '7 percent', roles: ['rate'] },
      { raw: '$232,181', roles: ['outcome'] }, { raw: '1.5 percent', roles: ['fee_rate'] }, { raw: '$175,065', roles: ['outcome'] },
    ],
    calcs: [{ target: '$232,181', expected: () => fvLump(60000, 0.07, 20) }, { target: '$175,065', expected: () => fvLump(60000, 0.055, 20) }],
    together: [['$232,181', '$175,065']], status: 'PASS',
  },
  {
    id: 'T10_interest_income_tax',
    script: "Earn $5,000 in interest in the 32 percent bracket and $1,600 goes to tax, so you keep $3,400.",
    mentions: [
      { raw: '$5,000', roles: ['transfer_amount', 'principal', 'baseline_amount'] }, { raw: '32 percent', roles: ['tax_rate'] },
      { raw: '$1,600', roles: ['outcome', 'gap'] }, { raw: '$3,400', roles: ['outcome'] },
    ],
    calcs: [{ target: '$1,600', expected: () => 5000 * 0.32 }, { target: '$3,400', expected: () => 5000 * 0.68 }],
    together: [['$1,600', '$3,400']], status: 'PASS',
  },
  {
    id: 'T11_weekly_savings',
    script: "Set aside $150 a week for 3 years at 4 percent and you'll have about $24,852.",
    mentions: [{ raw: '$150', roles: ['recurring_amount'] }, { raw: '3 years', roles: ['horizon'] }, { raw: '4 percent', roles: ['rate'] }, { raw: '$24,852', roles: ['outcome'] }],
    calcs: [{ target: '$24,852', expected: () => fvPer(150, 0.04, 52, 3) }],
    together: [['$150', '$24,852']], status: 'PASS',
  },
  {
    id: 'T12_start_now_vs_later',
    script: "Start now and invest $300 a month at 7 percent for 40 years and you'll have about $787,444. Start ten years later and invest for 30 years, and you'll end with $365,991.",
    mentions: [
      { raw: '$300', roles: ['recurring_amount'] }, { raw: '7 percent', roles: ['rate'] }, { raw: '40 years', roles: ['horizon'] }, { raw: '$787,444', roles: ['outcome'] },
      { raw: 'ten years', roles: ['delay_period'] }, { raw: '30 years', roles: ['horizon'] }, { raw: '$365,991', roles: ['outcome'] },
    ],
    calcs: [{ target: '$787,444', expected: () => fvPer(300, 0.07, 12, 40) }, { target: '$365,991', expected: () => fvPer(300, 0.07, 12, 30) }],
    together: [['$787,444', '$365,991']], status: 'PASS',
  },
  {
    id: 'T13_coffee_inflation',
    script: "A $5 coffee today will cost about $6.72 in ten years if inflation runs at 3 percent.",
    mentions: [{ raw: '$5', roles: ['baseline_amount', 'principal'] }, { raw: '$6.72', roles: ['outcome'] }, { raw: 'ten years', roles: ['horizon'] }, { raw: '3 percent', roles: ['inflation_rate'] }],
    calcs: [{ target: '$6.72', expected: () => fvLump(5, 0.03, 10) }],
    together: [['$5', '$6.72']], status: 'PASS',
  },
  {
    id: 'T14_runway_months',
    script: "With $18,000 saved and expenses of $2,500 a month, you can cover about 7 months.",
    mentions: [{ raw: '$18,000', roles: ['principal'] }, { raw: '$2,500', roles: ['recurring_amount'] }, { raw: '7 months', roles: ['result_duration'] }],
    calcs: [{ target: '7 months', expected: () => 18000 / 2500 }],
    together: [['$18,000', '7 months']], status: 'PASS',
  },
  {
    id: 'T15_card_payoff_time',
    script: "Paying $300 a month on $9,000 at 18 percent takes about 40 months to clear.",
    mentions: [{ raw: '$300', roles: ['recurring_amount'] }, { raw: '$9,000', roles: ['principal'] }, { raw: '18 percent', roles: ['rate'] }, { raw: '40 months', roles: ['result_duration'] }],
    calcs: [{ target: '40 months', expected: () => nper(9000, 0.18, 300) }],
    together: [['$300', '40 months']], status: 'PASS',
  },
  {
    id: 'T16_milestones_lump_sum',
    script: "A $15,000 lump sum at 8 percent is worth about $32,384 after 10 years and $69,914 after 20 years.",
    mentions: [
      { raw: '$15,000', roles: ['principal'] }, { raw: '8 percent', roles: ['rate'] },
      { raw: '$32,384', roles: ['outcome'] }, { raw: '10 years', roles: ['horizon'] }, { raw: '$69,914', roles: ['outcome'] }, { raw: '20 years', roles: ['horizon'] },
    ],
    calcs: [{ target: '$32,384', expected: () => fvLump(15000, 0.08, 10) }, { target: '$69,914', expected: () => fvLump(15000, 0.08, 20) }],
    together: [['$32,384', '$69,914']], status: 'PASS',
  },
  {
    id: 'T17_periodic_vs_lifetime',
    script: "A $12 monthly subscription costs $144 a year and $1,440 over ten years.",
    mentions: [
      { raw: '$12', roles: ['recurring_amount'], basis: 'per_month' }, { raw: '$144', roles: ['outcome', 'gap', 'recurring_amount'], basis: 'per_year' },
      { raw: '$1,440', roles: ['outcome', 'gap'], basis: 'lifetime' }, { raw: 'ten years', roles: ['horizon'] },
    ],
    calcs: [{ target: '$144', expected: () => 12 * 12 }, { target: '$1,440', expected: () => 12 * 12 * 10 }],
    together: [], status: 'PASS',
  },
  {
    id: 'T18_return_scenarios_contributions',
    script: "Invest $500 a month for 25 years: at 5 percent you'd have about $297,755, at 8 percent about $475,513.",
    mentions: [
      { raw: '$500', roles: ['recurring_amount'] }, { raw: '25 years', roles: ['horizon'] }, { raw: '5 percent', roles: ['rate'] },
      { raw: '$297,755', roles: ['outcome'] }, { raw: '8 percent', roles: ['rate'] }, { raw: '$475,513', roles: ['outcome'] },
    ],
    calcs: [{ target: '$297,755', expected: () => fvPer(500, 0.05, 12, 25) }, { target: '$475,513', expected: () => fvPer(500, 0.08, 12, 25) }],
    together: [['$297,755', '$475,513']], status: 'PASS',
  },
  {
    id: 'T19_flow_parts_and_total',
    script: "Your employer sends $250 a month and you send $500 a month into the plan, for $750 a month in total.",
    mentions: [
      { raw: '$250', roles: ['recurring_amount'], basis: 'per_month' }, { raw: '$500', roles: ['recurring_amount'], basis: 'per_month' },
      { raw: '$750', roles: ['recurring_amount', 'outcome'], basis: 'per_month' },
    ],
    calcs: [{ target: '$750', expected: () => 250 + 500 }],
    together: [['$250', '$500']], status: 'PASS',
  },

  // ── deliberately ambiguous / contradictory / unsupported (must stop safely) ─
  {
    id: 'U1_direction_unknown',
    script: "Prices might change by 5 percent, up or down, over the next few years, and nobody really knows which.",
    mentions: [{ raw: '5 percent', roles: ['change_pct'] }],
    calcs: [], together: [], status: 'needs_review',
  },
  {
    id: 'U2_contradicted_result',
    script: "Paying $500 a month at 6 percent for 20 years builds about $500,000.",
    // the arithmetic gives ~$231,020: the stated figure is wrong and must not be charted as fact
    mentions: [{ raw: '$500', roles: ['recurring_amount'] }, { raw: '6 percent', roles: ['rate'] }, { raw: '20 years', roles: ['horizon'] }, { raw: '$500,000', roles: ['outcome'] }],
    calcs: [], together: [], status: 'needs_review',
  },
  {
    id: 'U3_unclear_options',
    script: "Depending on the plan it could cost $50 or $500 or maybe nothing, plus 3 percent or 12 percent, sometime later.",
    mentions: [
      { raw: '$50', roles: ['none', 'upfront_cost', 'baseline_amount', 'principal', 'outcome', 'transfer_amount', 'recurring_amount', 'fee_rate'] },
      { raw: '$500', roles: ['none', 'upfront_cost', 'baseline_amount', 'principal', 'outcome', 'transfer_amount', 'recurring_amount'] },
      { raw: '3 percent', roles: ['none', 'rate', 'fee_rate', 'tax_rate', 'change_pct'] }, { raw: '12 percent', roles: ['none', 'rate', 'fee_rate', 'tax_rate', 'change_pct'] },
    ],
    calcs: [], together: [], status: 'needs_review',
  },
  {
    id: 'U4_ages_unsupported',
    script: "At 30 you save 10 percent, at 40 you save 15 percent, and you retire at 67 with about $1 million.",
    mentions: [
      { raw: '10 percent', roles: ['none', 'savings_rate'] }, { raw: '15 percent', roles: ['none', 'savings_rate'] }, { raw: '$1 million', roles: ['none', 'outcome'] },
    ],
    calcs: [], together: [], status: 'SAFE',
  },
];
