// FRESH hold-out set (round 2) — written AFTER the generalization corrections
// (metric identity / recurring-frequency semantics / renderer quality) were
// implemented and frozen by SHA-256 (freeze_fresh.json) BEFORE its first run.
// The scorer refuses to run if this file's hash changes. The first hold-out
// (F1-F9) was spent and is now development data; nothing here reuses its
// scripts. Nothing in the Brain, prompt or renderer may be changed in response
// to how this set behaves without declaring that this set is no longer
// untouched.
//
// Format: see dev_set.mjs. Extra optional field on a mention:
//   basis: the time basis of the figure as an independent human would label
//          it ('per_month' | 'per_year' | 'lifetime' | 'at_horizon' | 'amount'),
//          used ONLY by the scorer's independent visual-semantic check.
// status: 'PASS' normal script (should proceed unattended)
//         'needs_review' deliberately ambiguous/contradictory (must stop safely)
//         'SAFE' unsupported structure (safe = needs_review/blocked, OR clean
//                with no misbinding and no silent drop)
const fvLump = (p, r, y) => p * Math.pow(1 + r, y);
const fvPer = (pmt, annual, per, years) => { const r = annual / per, n = years * per; return pmt * ((Math.pow(1 + r, n) - 1) / r); };
const loanPmt = (P, annual, years) => { const r = annual / 12, n = years * 12; return (P * r) / (1 - Math.pow(1 + r, -n)); };
const nper = (P, annual, pmt) => { const r = annual / 12; return -Math.log(1 - (r * P) / pmt) / Math.log(1 + r); };

export const FRESH = [
  // ── normal NextWave-domain scripts ────────────────────────────────────────
  {
    id: 'N01_fees_retirement_plan',
    script: "Here's something most people never check. Say you have $40,000 in a retirement account that you'll leave alone for 25 years, earning 6 percent before fees. If your plan skims 0.25 percent off every year, you'll end up with roughly $161,834. But if it takes 1.25 percent, you're left with about $127,618.",
    mentions: [
      { raw: '$40,000', roles: ['principal'] }, { raw: '25 years', roles: ['horizon'] }, { raw: '6 percent', roles: ['rate'] },
      { raw: '0.25 percent', roles: ['fee_rate'] }, { raw: '$161,834', roles: ['outcome'] },
      { raw: '1.25 percent', roles: ['fee_rate'] }, { raw: '$127,618', roles: ['outcome'] },
    ],
    calcs: [
      { target: '$161,834', expected: () => fvLump(40000, 0.0575, 25) },
      { target: '$127,618', expected: () => fvLump(40000, 0.0475, 25) },
    ],
    together: [['$161,834', '$127,618']], status: 'PASS',
  },
  {
    id: 'N02_mortgage_payment_interest',
    script: "Thirty years, $320,000, 6.5 percent. That works out to a payment of about $2,023 a month, and roughly $408,142 in interest by the time it's paid off.",
    mentions: [
      { raw: 'Thirty years', roles: ['horizon'] }, { raw: '$320,000', roles: ['principal'] }, { raw: '6.5 percent', roles: ['rate'] },
      { raw: '$2,023', roles: ['outcome', 'recurring_amount'], basis: 'per_month' }, { raw: '$408,142', roles: ['outcome'], basis: 'lifetime' },
    ],
    calcs: [
      { target: '$2,023', expected: () => loanPmt(320000, 0.065, 30) },
      { target: '$408,142', expected: () => loanPmt(320000, 0.065, 30) * 360 - 320000 },
    ],
    together: [], status: 'PASS',
  },
  {
    id: 'N03_card_payoff_two_payments',
    script: "Credit cards get expensive fast. You owe $6,000 on a card charging 21 percent. Paying $250 a month clears it in about 31 months; bump the payment to $400 and you're free in roughly 18 months.",
    mentions: [
      { raw: '$6,000', roles: ['principal'] }, { raw: '21 percent', roles: ['rate'] }, { raw: '$250', roles: ['recurring_amount'] },
      { raw: '31 months', roles: ['result_duration'] }, { raw: '$400', roles: ['recurring_amount'] }, { raw: '18 months', roles: ['result_duration'] },
    ],
    calcs: [
      { target: '31 months', expected: () => nper(6000, 0.21, 250) },
      { target: '18 months', expected: () => nper(6000, 0.21, 400) },
    ],
    together: [['$250', '31 months'], ['$400', '18 months']], status: 'PASS',
  },
  {
    id: 'N04_salary_inflation',
    script: "Say you earn $90,000 today. With inflation running at 3.5 percent, in twenty years you'd need about $179,081 just to keep the same buying power.",
    mentions: [
      { raw: '$90,000', roles: ['baseline_amount', 'principal', 'income_amount'] }, { raw: '3.5 percent', roles: ['inflation_rate'] },
      { raw: 'twenty years', roles: ['horizon'] }, { raw: '$179,081', roles: ['outcome'] },
    ],
    calcs: [{ target: '$179,081', expected: () => fvLump(90000, 0.035, 20) }],
    together: [['$90,000', '$179,081']], status: 'PASS',
  },
  {
    id: 'N05_withdrawal_tax_roth',
    script: "Pull $50,000 out of a traditional retirement account in the 24 percent bracket and $12,000 goes to taxes, leaving you $38,000. Take the same amount from a Roth and you keep every dollar.",
    mentions: [
      { raw: '$50,000', roles: ['transfer_amount', 'principal', 'baseline_amount'] }, { raw: '24 percent', roles: ['tax_rate'] },
      { raw: '$12,000', roles: ['outcome', 'gap'] }, { raw: '$38,000', roles: ['outcome'] },
    ],
    calcs: [
      { target: '$12,000', expected: () => 50000 * 0.24 },
      { target: '$38,000', expected: () => 50000 * (1 - 0.24) },
    ],
    together: [['$12,000', '$38,000']], status: 'PASS',
  },
  {
    id: 'N06_match_multistep',
    script: "Earn $80,000, put in 6 percent, and with a 50 percent employer match you contribute $4,800 while they add $2,400, for $7,200 a year.",
    mentions: [
      { raw: '$80,000', roles: ['income_amount'] }, { raw: '6 percent', roles: ['savings_rate'] }, { raw: '50 percent', roles: ['match_rate'] },
      { raw: '$4,800', roles: ['outcome', 'recurring_amount', 'transfer_amount', 'gap'] }, { raw: '$2,400', roles: ['outcome', 'recurring_amount', 'transfer_amount', 'gap'] },
      { raw: '$7,200', roles: ['outcome', 'recurring_amount', 'transfer_amount', 'gap'] },
    ],
    calcs: [
      { target: '$4,800', expected: () => 80000 * 0.06 },
      { target: '$2,400', expected: () => 80000 * 0.06 * 0.5 },
      { target: '$7,200', expected: () => 80000 * 0.06 * 1.5 },
    ],
    together: [['$4,800', '$2,400']], status: 'PASS',
  },
  {
    id: 'N07_solar_breakeven_years',
    script: "Solar panels cost $12,000 up front and trim your power bill by $100 a month, so they pay for themselves in ten years.",
    mentions: [
      { raw: '$12,000', roles: ['upfront_cost'] }, { raw: '$100', roles: ['recurring_amount', 'gap'] }, { raw: 'ten years', roles: ['result_duration'] },
    ],
    calcs: [{ target: 'ten years', expected: () => 12000 / 100 / 12, brainExpected: () => 12000 / 100 }],
    together: [['$12,000', 'ten years']], status: 'PASS',
  },
  {
    id: 'N08_multi_horizon_growth',
    script: "Invest $10,000 at 7 percent and see what time does. After 10 years you have about $19,672, after 20 years about $38,697, and after 30 years about $76,123. Time is the ingredient you can't buy back.",
    mentions: [
      { raw: '$10,000', roles: ['principal'] }, { raw: '7 percent', roles: ['rate'] },
      { raw: '10 years', roles: ['horizon'] }, { raw: '$19,672', roles: ['outcome'] },
      { raw: '20 years', roles: ['horizon'] }, { raw: '$38,697', roles: ['outcome'] },
      { raw: '30 years', roles: ['horizon'] }, { raw: '$76,123', roles: ['outcome'] },
    ],
    calcs: [
      { target: '$19,672', expected: () => fvLump(10000, 0.07, 10) },
      { target: '$38,697', expected: () => fvLump(10000, 0.07, 20) },
      { target: '$76,123', expected: () => fvLump(10000, 0.07, 30) },
    ],
    together: [['$19,672', '$38,697'], ['$38,697', '$76,123']], status: 'PASS',
  },
  {
    id: 'N09_rent_increase_annualized',
    script: "Your rent goes from $1,800 to $2,160 a month, a 20 percent increase, which works out to $4,320 more per year.",
    mentions: [
      { raw: '$1,800', roles: ['recurring_amount'], basis: 'per_month' }, { raw: '$2,160', roles: ['recurring_amount', 'outcome'], basis: 'per_month' },
      { raw: '20 percent', roles: ['change_pct'] }, { raw: '$4,320', roles: ['gap', 'outcome'], basis: 'per_year' },
    ],
    calcs: [
      { target: '$2,160', expected: () => 1800 * 1.2 },
      { target: '$4,320', expected: () => (2160 - 1800) * 12 },
    ],
    together: [['$1,800', '$2,160']], status: 'PASS',
  },
  {
    id: 'N10_nominal_vs_real',
    script: "Take $30,000 in savings earning 4.5 percent while inflation runs at 3 percent. After 10 years the balance is about $46,589, but in today's money that's only worth roughly $34,667.",
    mentions: [
      { raw: '$30,000', roles: ['principal'] }, { raw: '4.5 percent', roles: ['rate'] }, { raw: '3 percent', roles: ['inflation_rate'] },
      { raw: '10 years', roles: ['horizon'] }, { raw: '$46,589', roles: ['outcome'] }, { raw: '$34,667', roles: ['outcome'] },
    ],
    calcs: [
      { target: '$46,589', expected: () => fvLump(30000, 0.045, 10) },
      { target: '$34,667', expected: () => fvLump(30000, 0.045, 10) / Math.pow(1.03, 10) },
    ],
    together: [['$46,589', '$34,667']], status: 'PASS',
  },
  {
    id: 'N11_gym_totals',
    script: "Your gym charges $45 a month. That's $540 a year, and over five years you'll spend $2,700.",
    mentions: [
      { raw: '$45', roles: ['recurring_amount'], basis: 'per_month' }, { raw: '$540', roles: ['outcome', 'gap', 'recurring_amount'], basis: 'per_year' },
      { raw: 'five years', roles: ['horizon'] }, { raw: '$2,700', roles: ['outcome', 'gap'], basis: 'lifetime' },
    ],
    calcs: [
      { target: '$540', expected: () => 45 * 12 },
      { target: '$2,700', expected: () => 45 * 12 * 5 },
    ],
    together: [], status: 'PASS',
  },
  {
    id: 'N12_combined_401k_contribution',
    script: "You put $500 a month into your 401(k) and your employer adds another $250. With both earning 7 percent for 30 years, the combined account grows to about $914,978. Free money is real.",
    mentions: [
      { raw: '$500', roles: ['recurring_amount'] }, { raw: '$250', roles: ['recurring_amount'] }, { raw: '7 percent', roles: ['rate'] },
      { raw: '30 years', roles: ['horizon'] }, { raw: '$914,978', roles: ['outcome'] },
    ],
    calcs: [{ target: '$914,978', expected: () => fvPer(750, 0.07, 12, 30) }],
    together: [['$250', '$914,978']], status: 'PASS',
  },
  {
    id: 'N13_gas_price_drop',
    script: "Gas prices fell 8 percent, so filling your tank now costs $46 instead of $50.",
    mentions: [
      { raw: '8 percent', roles: ['change_pct'] }, { raw: '$46', roles: ['outcome'] }, { raw: '$50', roles: ['baseline_amount', 'principal', 'outcome'] },
    ],
    calcs: [{ target: '$46', expected: () => 50 * (1 - 0.08) }],
    together: [['$46', '$50']], status: 'PASS',
  },
  {
    id: 'N14_car_loan_question_form',
    script: "Wondering what a $15,000 car loan really costs? At 8 percent over four years, you'll pay $366 a month, which is $17,577 in total.",
    mentions: [
      { raw: '$15,000', roles: ['principal'] }, { raw: '8 percent', roles: ['rate'] }, { raw: 'four years', roles: ['horizon'] },
      { raw: '$366', roles: ['outcome', 'recurring_amount'], basis: 'per_month' }, { raw: '$17,577', roles: ['outcome'], basis: 'lifetime' },
    ],
    calcs: [
      { target: '$366', expected: () => loanPmt(15000, 0.08, 4) },
      { target: '$17,577', expected: () => loanPmt(15000, 0.08, 4) * 48 },
    ],
    together: [], status: 'PASS',
  },

  // ── deliberately ambiguous / contradictory / unsupported (must stop safely) ─
  {
    id: 'S1_direction_unknown',
    script: "Analysts say the market could move 15 percent by year end, but nobody agrees which way. Whatever happens, plan to hold for at least 3 years.",
    mentions: [{ raw: '15 percent', roles: ['change_pct'] }, { raw: '3 years', roles: ['horizon'] }],
    calcs: [], together: [], status: 'needs_review',
  },
  {
    id: 'S2_contradicted_result',
    script: "Put $8,000 into a fund earning 5 percent and after 10 years you'll have about $24,000.",
    // the arithmetic gives ~$13,031: the stated figure is wrong and must not be charted as fact
    mentions: [{ raw: '$8,000', roles: ['principal'] }, { raw: '5 percent', roles: ['rate'] }, { raw: '10 years', roles: ['horizon'] }, { raw: '$24,000', roles: ['outcome'] }],
    calcs: [], together: [], status: 'needs_review',
  },
  {
    id: 'S3_unclear_quantities',
    script: "It might cost $500, or $1,200 if you add the rider, and it could be 12 percent or 8 depending on who you ask, over 5 or maybe 10 years.",
    mentions: [
      { raw: '$500', roles: ['none', 'upfront_cost', 'baseline_amount', 'principal', 'outcome', 'transfer_amount', 'recurring_amount'] },
      { raw: '$1,200', roles: ['none', 'upfront_cost', 'baseline_amount', 'principal', 'outcome', 'transfer_amount', 'recurring_amount'] },
      { raw: '12 percent', roles: ['none', 'rate', 'fee_rate', 'tax_rate', 'change_pct'] }, { raw: '8', roles: ['none', 'rate', 'fee_rate', 'tax_rate', 'change_pct'] },
      { raw: '5 or maybe 10 years', roles: ['none', 'horizon'] },
    ],
    calcs: [], together: [], status: 'needs_review',
  },
  {
    id: 'S4_allocation_weights_unsupported',
    script: "Your portfolio is 60 percent stocks and 40 percent bonds. Stocks earned 9 percent and bonds earned 3 percent, so the blended return was 6.6 percent.",
    mentions: [
      { raw: '60 percent', roles: ['none'] }, { raw: '40 percent', roles: ['none'] }, { raw: '9 percent', roles: ['rate', 'none'] }, { raw: '3 percent', roles: ['rate', 'none'] }, { raw: '6.6 percent', roles: ['rate', 'none'] },
    ],
    calcs: [], together: [], status: 'SAFE',
  },
];
