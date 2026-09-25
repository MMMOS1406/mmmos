// DEVELOPMENT set — the ONLY cases the semantic layer may be engineered
// against (prompt, ontology, gates). Ground truth is NEVER shown to the
// semantic proposer; it is used only by the scorer.
//
// Format per case:
//   mentions[]: { raw, roles[] }  raw = substring of the mention as written in
//               the script; roles = the acceptable semantic roles (a bound
//               role outside this set is a MISBINDING).
//   calcs[]:    { target(raw), expected() } expected() is an INDEPENDENT
//               recomputation coded here, not imported from the Brain.
//   together[]: mentions that must end up in the same scene.
//   status:     'PASS' (ordinary script, should proceed) | 'needs_review'
//               (genuinely ambiguous/unsupported by design).
const fvLump = (p, r, y) => p * Math.pow(1 + r, y);
const nper = (P, annual, pmt) => { const r = annual / 12; return -Math.log(1 - (r * P) / pmt) / Math.log(1 + r); };

export const DEV = [
  {
    id: 'D1_fees_expense_ratio',
    script: "Imagine you invest $25,000 and leave it alone for 30 years, earning about 7 percent a year before costs. A low-cost index fund that charges 0.10 percent a year would grow to roughly $185,042. A fund charging 1 percent a year would only reach about $143,587. That extra percentage point of fees costs you $41,455.",
    mentions: [
      { raw: '$25,000', roles: ['principal'] }, { raw: '30 years', roles: ['horizon'] }, { raw: '7 percent', roles: ['rate'] },
      { raw: '0.10 percent', roles: ['fee_rate'] }, { raw: '$185,042', roles: ['outcome'] },
      { raw: '1 percent', roles: ['fee_rate'] }, { raw: '$143,587', roles: ['outcome'] }, { raw: '$41,455', roles: ['gap'] },
    ],
    calcs: [
      { target: '$185,042', expected: () => 25000 * Math.pow(1 + 0.07 - 0.001, 30) },
      { target: '$143,587', expected: () => 25000 * Math.pow(1 + 0.07 - 0.01, 30) },
      { target: '$41,455', expected: () => 25000 * Math.pow(1.069, 30) - 25000 * Math.pow(1.06, 30) },
    ],
    together: [['$185,042', '$143,587']],
    status: 'PASS',
  },
  {
    id: 'D2_inflation_price',
    script: "Prices tend to creep up. At 3 percent inflation, a $50 grocery order today will cost about $67 in ten years. Your paycheck has to keep up just to stay even.",
    mentions: [
      { raw: '3 percent', roles: ['inflation_rate'] }, { raw: '$50', roles: ['baseline_amount'] },
      { raw: '$67', roles: ['outcome'] }, { raw: 'ten years', roles: ['horizon'] },
    ],
    calcs: [{ target: '$67', expected: () => fvLump(50, 0.03, 10) }],
    together: [['$50', '$67']],
    status: 'PASS',
  },
  {
    id: 'D3_emergency_runway',
    script: "Your essential bills come to about $3,200 a month. If you have $9,600 saved, that covers three months. Build it up to $19,200 and you can go six months without a paycheck.",
    mentions: [
      { raw: '$3,200', roles: ['recurring_amount'] }, { raw: '$9,600', roles: ['principal'] },
      { raw: 'three months', roles: ['result_duration'] }, { raw: '$19,200', roles: ['principal'] }, { raw: 'six months', roles: ['result_duration'] },
    ],
    calcs: [
      { target: 'three months', expected: () => 9600 / 3200 },
      { target: 'six months', expected: () => 19200 / 3200 },
    ],
    together: [['$9,600', 'three months']],
    status: 'PASS',
  },
  {
    id: 'D4_debt_payoff',
    script: "You owe $8,000 on a credit card charging 18 percent interest. Paying $200 a month, it takes about 62 months and costs roughly $4,309 in interest. Bump the payment to $400 and you are done in about 24 months, paying only $1,582 in interest.",
    mentions: [
      { raw: '$8,000', roles: ['principal'] }, { raw: '18 percent', roles: ['rate'] }, { raw: '$200', roles: ['recurring_amount'] },
      { raw: '62 months', roles: ['result_duration'] }, { raw: '$4,309', roles: ['outcome'] },
      { raw: '$400', roles: ['recurring_amount'] }, { raw: '24 months', roles: ['result_duration'] }, { raw: '$1,582', roles: ['outcome'] },
    ],
    calcs: [
      { target: '62 months', expected: () => nper(8000, 0.18, 200), tol: 0.6 },
      { target: '$4,309', expected: () => 200 * nper(8000, 0.18, 200) - 8000 },
      { target: '24 months', expected: () => nper(8000, 0.18, 400), tol: 0.6 },
      { target: '$1,582', expected: () => 400 * nper(8000, 0.18, 400) - 8000 },
    ],
    together: [['62 months', '24 months']],
    status: 'PASS',
  },
  {
    id: 'D5_retirement_match',
    script: "Say you earn $80,000 a year and contribute 6 percent to your retirement plan. That is $4,800 a year from you. If your employer matches 50 percent of what you put in, they add another $2,400. In total, $7,200 goes into your account every year.",
    mentions: [
      { raw: '$80,000', roles: ['income_amount'] }, { raw: '6 percent', roles: ['savings_rate'] },
      { raw: '$4,800', roles: ['outcome', 'recurring_amount'] }, { raw: '50 percent', roles: ['match_rate'] },
      { raw: '$2,400', roles: ['outcome', 'recurring_amount', 'transfer_amount', 'gap'] }, { raw: '$7,200', roles: ['outcome', 'recurring_amount'] },
    ],
    calcs: [
      { target: '$4,800', expected: () => 80000 * 0.06 },
      { target: '$2,400', expected: () => 80000 * 0.06 * 0.5 },
      { target: '$7,200', expected: () => 80000 * 0.06 * 1.5 },
    ],
    together: [['$4,800', '$2,400']],
    status: 'PASS',
  },
  {
    id: 'D6_breakeven_refinance',
    script: "Refinancing costs $4,800 in closing costs, but it lowers your payment by $200 a month. Divide one by the other and you break even after 24 months. Stay in the house longer than that and every month after is pure savings.",
    mentions: [
      { raw: '$4,800', roles: ['upfront_cost'] }, { raw: '$200', roles: ['recurring_amount', 'gap'] }, { raw: '24 months', roles: ['result_duration'] },
    ],
    calcs: [{ target: '24 months', expected: () => 4800 / 200 }],
    together: [['$4,800', '$200'], ['$200', '24 months']],
    status: 'PASS',
  },
];
