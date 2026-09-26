// FINAL HOLD-OUT set — written BEFORE the semantic layer was implemented and
// frozen by SHA-256 (see freeze.json). It is run ONCE, after implementation.
// The scorer refuses to run if this file's hash no longer matches freeze.json,
// so it cannot be quietly edited after results are seen. If anything here
// must change after a run, the set is no longer "untouched" and the report
// must say so.
//
// Materially different finance structures and natural phrasing (NOT
// paraphrases of Proof A/B/C): taxes, mortgage refinance, savings-rate
// comparison, opportunity cost, lump sum vs recurring, risk/return,
// purchasing power, a delayed-start structure in new words, and one genuinely
// ambiguous script that SHOULD end in needs_review.
const fvLump = (p, r, y) => p * Math.pow(1 + r, y);
const fvAnnuity = (pmt, annual, months) => { const r = annual / 12; return pmt * ((Math.pow(1 + r, months) - 1) / r); };
const loanPmt = (P, annual, years) => { const r = annual / 12, n = years * 12; return (P * r) / (1 - Math.pow(1 + r, -n)); };

export const FINAL = [
  {
    id: 'F1_taxes_holding_period',
    script: "Say you sell an investment for a $10,000 profit. If you held it less than a year, it is taxed at 32 percent, so you keep $6,800. Hold it for more than a year and the rate drops to 15 percent, leaving you $8,500. Patience is worth $1,700.",
    mentions: [
      { raw: '$10,000', roles: ['transfer_amount', 'principal', 'baseline_amount'] }, { raw: '32 percent', roles: ['tax_rate'] },
      { raw: '$6,800', roles: ['outcome'] }, { raw: '15 percent', roles: ['tax_rate'] }, { raw: '$8,500', roles: ['outcome'] }, { raw: '$1,700', roles: ['gap'] },
    ],
    calcs: [
      { target: '$6,800', expected: () => 10000 * (1 - 0.32) },
      { target: '$8,500', expected: () => 10000 * (1 - 0.15) },
      { target: '$1,700', expected: () => 10000 * 0.85 - 10000 * 0.68 },
    ],
    together: [['$6,800', '$8,500']],
    status: 'PASS',
  },
  {
    id: 'F2_mortgage_refinance',
    script: "You have a $250,000 mortgage at 7 percent with 25 years left. Refinancing to 5.5 percent drops your monthly payment from $1,767 to $1,535. Over the life of the loan, that adds up to about $69,519 in savings.",
    mentions: [
      { raw: '$250,000', roles: ['principal'] }, { raw: '7 percent', roles: ['rate'] }, { raw: '25 years', roles: ['horizon'] },
      { raw: '5.5 percent', roles: ['rate'] }, { raw: '$1,767', roles: ['outcome', 'recurring_amount'] },
      { raw: '$1,535', roles: ['outcome', 'recurring_amount'] }, { raw: '$69,519', roles: ['gap'] },
    ],
    calcs: [
      { target: '$1,767', expected: () => loanPmt(250000, 0.07, 25) },
      { target: '$1,535', expected: () => loanPmt(250000, 0.055, 25) },
      { target: '$69,519', expected: () => (loanPmt(250000, 0.07, 25) - loanPmt(250000, 0.055, 25)) * 300 },
    ],
    together: [['$1,767', '$1,535']],
    status: 'PASS',
  },
  {
    id: 'F3_savings_rate_comparison',
    script: "Two coworkers each earn $60,000 a year. Maya saves 10 percent and Leo saves 20 percent, both investing monthly at a 6 percent return for 20 years. Maya ends up with about $231,020, and Leo about $462,041. Doubling the savings rate doubles the result.",
    mentions: [
      { raw: '$60,000', roles: ['income_amount'] }, { raw: '10 percent', roles: ['savings_rate'] }, { raw: '20 percent', roles: ['savings_rate'] },
      { raw: '6 percent', roles: ['rate'] }, { raw: '20 years', roles: ['horizon'] }, { raw: '$231,020', roles: ['outcome'] }, { raw: '$462,041', roles: ['outcome'] },
    ],
    calcs: [
      { target: '$231,020', expected: () => fvAnnuity(60000 * 0.10 / 12, 0.06, 240) },
      { target: '$462,041', expected: () => fvAnnuity(60000 * 0.20 / 12, 0.06, 240) },
    ],
    together: [['$231,020', '$462,041']],
    status: 'PASS',
  },
  {
    id: 'F4_opportunity_cost_coffee',
    script: "That $5 daily coffee adds up to about $150 a month. Put that money into an index fund earning 7 percent for 30 years instead, and it grows to roughly $182,996.",
    mentions: [
      { raw: '$5', roles: ['recurring_amount'] }, { raw: '$150', roles: ['recurring_amount'] }, { raw: '7 percent', roles: ['rate'] },
      { raw: '30 years', roles: ['horizon'] }, { raw: '$182,996', roles: ['outcome'] },
    ],
    calcs: [{ target: '$182,996', expected: () => fvAnnuity(150, 0.07, 360) }],
    together: [['$150', '$182,996']],
    status: 'PASS',
  },
  {
    id: 'F5_lump_sum_vs_recurring',
    script: "Compare putting $24,000 to work all at once with drip-feeding the same $24,000 at $200 a month for 10 years, both earning 6 percent. The lump sum grows to about $42,980, while the monthly plan reaches about $32,776. Time in the market beats timing.",
    mentions: [
      { raw: '$24,000', roles: ['principal', 'baseline_amount'] }, /* appears twice: the lump sum, and the total the monthly plan drips in */, { raw: '$200', roles: ['recurring_amount'] }, { raw: '10 years', roles: ['horizon'] },
      { raw: '6 percent', roles: ['rate'] }, { raw: '$42,980', roles: ['outcome'] }, { raw: '$32,776', roles: ['outcome'] },
    ],
    calcs: [
      { target: '$42,980', expected: () => fvLump(24000, 0.06, 10) },
      { target: '$32,776', expected: () => fvAnnuity(200, 0.06, 120) },
    ],
    together: [['$42,980', '$32,776']],
    status: 'PASS',
  },
  {
    id: 'F6_risk_return_scenarios',
    script: "Take $10,000 invested for 10 years. In a strong decade averaging 10 percent a year, it grows to about $25,937. In a weak decade averaging 2 percent, it reaches only $12,190. That $13,747 spread is the price of uncertainty.",
    mentions: [
      { raw: '$10,000', roles: ['principal'] }, { raw: '10 years', roles: ['horizon'] }, { raw: '10 percent', roles: ['rate'] },
      { raw: '$25,937', roles: ['outcome'] }, { raw: '2 percent', roles: ['rate'] }, { raw: '$12,190', roles: ['outcome'] }, { raw: '$13,747', roles: ['gap'] },
    ],
    calcs: [
      { target: '$25,937', expected: () => fvLump(10000, 0.10, 10) },
      { target: '$12,190', expected: () => fvLump(10000, 0.02, 10) },
      { target: '$13,747', expected: () => fvLump(10000, 0.10, 10) - fvLump(10000, 0.02, 10) },
    ],
    together: [['$25,937', '$12,190']],
    status: 'PASS',
  },
  {
    id: 'F7_purchasing_power',
    script: "Suppose you stash $20,000 in a drawer. With prices rising 4 percent a year, in 15 years that money buys only what about $11,105 buys today.",
    mentions: [
      { raw: '$20,000', roles: ['principal', 'baseline_amount'] }, { raw: '4 percent', roles: ['inflation_rate'] },
      { raw: '15 years', roles: ['horizon'] }, { raw: '$11,105', roles: ['outcome'] },
    ],
    calcs: [{ target: '$11,105', expected: () => 20000 / Math.pow(1.04, 15) }],
    together: [['$20,000', '$11,105']],
    status: 'PASS',
  },
  {
    id: 'F8_ambiguous_by_design',
    script: "Analysts think the market could move 10 percent either way this year. Some say wait, others say act. Whatever you decide, give it at least 5 years.",
    // Direction is explicitly unknown and the 5 years is advice, not a scenario
    // parameter: a safe system must NOT chart this confidently.
    mentions: [
      { raw: '10 percent', roles: ['change_pct'] }, { raw: '5 years', roles: ['horizon'] },
    ],
    calcs: [],
    together: [],
    status: 'needs_review',
  },
  {
    id: 'F9_delayed_start_new_words',
    script: "Meet two friends. Ava invests $400 a month starting today. Ben puts it off for three years, then invests the same $400 a month. Assuming a 7 percent return, after 15 years Ava has about $126,785 and Ben about $89,878.",
    mentions: [
      { raw: '$400', roles: ['recurring_amount'] }, { raw: 'three years', roles: ['delay_period'] }, { raw: '7 percent', roles: ['rate'] },
      { raw: '15 years', roles: ['horizon'] }, { raw: '$126,785', roles: ['outcome'] }, { raw: '$89,878', roles: ['outcome'] },
    ],
    calcs: [
      { target: '$126,785', expected: () => fvAnnuity(400, 0.07, 180) },
      { target: '$89,878', expected: () => fvAnnuity(400, 0.07, 144) },
    ],
    together: [['$126,785', '$89,878']],
    status: 'PASS',
  },
];
