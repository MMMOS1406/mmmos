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

// ── DEVELOPMENT set 2: cases written to engineer the generalization
// corrections (metric/time-basis identity, recurring-frequency semantics).
// Different wording and topics from the frozen finals. Development only.
const loanPmt2 = (P, annual, years) => { const r = annual / 12, n = years * 12; return (P * r) / (1 - Math.pow(1 + r, -n)); };
const fvPer = (pmt, annual, per, years) => { const r = annual / per, n = years * per; return pmt * ((Math.pow(1 + r, n) - 1) / r); };
export const DEV2 = [
  {
    id: 'D7_auto_loan_monthly_vs_total',
    script: "Your auto loan is $18,000 at 9 percent over 5 years. Refinance to 5 percent and the monthly payment falls from $374 to $340. Add it all up across the term and you keep an extra $2,038.",
    mentions: [
      { raw: '$18,000', roles: ['principal'], basis: 'amount' }, { raw: '9 percent', roles: ['rate'] }, { raw: '5 years', roles: ['horizon'] }, { raw: '5 percent', roles: ['rate'] },
      { raw: '$374', roles: ['outcome', 'recurring_amount'], basis: 'per_month' }, { raw: '$340', roles: ['outcome', 'recurring_amount'], basis: 'per_month' },
      { raw: '$2,038', roles: ['gap'], basis: 'lifetime' },
    ],
    calcs: [
      { target: '$374', expected: () => loanPmt2(18000, 0.09, 5) }, { target: '$340', expected: () => loanPmt2(18000, 0.05, 5) },
      { target: '$2,038', expected: () => (loanPmt2(18000, 0.09, 5) - loanPmt2(18000, 0.05, 5)) * 60 },
    ],
    together: [['$374', '$340']], status: 'PASS',
  },
  {
    id: 'D8_phone_plan_periods',
    script: "Cutting your phone plan from $90 to $60 a month frees up $30 every month. Over a full year, that is $360 back in your pocket.",
    mentions: [
      { raw: '$90', roles: ['recurring_amount'], basis: 'per_month' }, { raw: '$60', roles: ['recurring_amount'], basis: 'per_month' },
      { raw: '$30', roles: ['gap', 'recurring_amount'], basis: 'per_month' }, { raw: '$360', roles: ['gap', 'outcome'], basis: 'per_year' },
    ],
    calcs: [{ target: '$30', expected: () => 90 - 60 }, { target: '$360', expected: () => (90 - 60) * 12 }],
    together: [], status: 'PASS',
  },
  {
    id: 'D9_weekly_lunch_invested',
    script: "Skip a $20 lunch delivery every week and invest that money at 8 percent for 20 years, and it grows to roughly $51,310.",
    mentions: [
      { raw: '$20', roles: ['recurring_amount'] }, { raw: '8 percent', roles: ['rate'] }, { raw: '20 years', roles: ['horizon'] }, { raw: '$51,310', roles: ['outcome'] },
    ],
    calcs: [{ target: '$51,310', expected: () => fvPer(20, 0.08, 52, 20) }], together: [['$20', '$51,310']], status: 'PASS',
  },
  {
    id: 'D10_quarterly_contribution',
    script: "Setting aside $1,500 each quarter for 12 years at a 6 percent return gets you to about $104,348.",
    mentions: [
      { raw: '$1,500', roles: ['recurring_amount'] }, { raw: '12 years', roles: ['horizon'] }, { raw: '6 percent', roles: ['rate'] }, { raw: '$104,348', roles: ['outcome'] },
    ],
    calcs: [{ target: '$104,348', expected: () => fvPer(1500, 0.06, 4, 12) }], together: [['$1,500', '$104,348']], status: 'PASS',
  },
  {
    id: 'D11_rent_increase',
    script: "Your landlord raises the rent from $1,400 to $1,610 a month. That is $210 more every month.",
    mentions: [
      { raw: '$1,400', roles: ['recurring_amount', 'outcome'], basis: 'per_month' }, { raw: '$1,610', roles: ['recurring_amount', 'outcome'], basis: 'per_month' },
      { raw: '$210', roles: ['gap', 'recurring_amount'], basis: 'per_month' },
    ],
    calcs: [{ target: '$210', expected: () => 1610 - 1400 }], together: [['$1,400', '$1,610']], status: 'PASS',
  },
];

// ── DEVELOPMENT set 3: mechanisms added after the first fresh-set design
// (labelled second measure, unit-converted break-even, hyphenated durations,
// account-name digits, contradiction gate). Development only.
export const DEV3 = [
  {
    id: 'D12_streaming_yearly_note',
    script: "Your streaming bundle rises from $30 to $42 a month, which is $144 more per year.",
    mentions: [
      { raw: '$30', roles: ['recurring_amount'], basis: 'per_month' }, { raw: '$42', roles: ['recurring_amount'], basis: 'per_month' },
      { raw: '$144', roles: ['gap', 'outcome'], basis: 'per_year' },
    ],
    calcs: [{ target: '$144', expected: () => (42 - 30) * 12 }], together: [['$30', '$42']], status: 'PASS',
  },
  {
    id: 'D13_water_heater_breakeven_years',
    script: "A $2,400 water-heater upgrade cuts your bills by $40 a month, so it pays for itself in five years.",
    mentions: [
      { raw: '$2,400', roles: ['upfront_cost'] }, { raw: '$40', roles: ['recurring_amount', 'gap'] }, { raw: 'five years', roles: ['result_duration'] },
    ],
    calcs: [{ target: 'five years', expected: () => (2400 / 40) / 12, brainExpected: () => 2400 / 40 }], together: [['$2,400', 'five years']], status: 'PASS',
  },
  {
    id: 'D14_hyphenated_term_401k',
    script: "Say you take out a 15-year loan on $200,000 at 6 percent. Your monthly payment is about $1,688, and you'll pay $303,788 in total, so consider a bigger down payment than your 401(k) suggests.",
    mentions: [
      { raw: '15-year', roles: ['horizon'] }, { raw: '$200,000', roles: ['principal'] }, { raw: '6 percent', roles: ['rate'] },
      { raw: '$1,688', roles: ['outcome', 'recurring_amount'], basis: 'per_month' }, { raw: '$303,788', roles: ['outcome'], basis: 'lifetime' },
    ],
    calcs: [
      { target: '$1,688', expected: () => loanPmt2(200000, 0.06, 15) }, { target: '$303,788', expected: () => loanPmt2(200000, 0.06, 15) * 180 },
    ],
    together: [], status: 'PASS',
  },
  {
    id: 'D15_contradiction_gate',
    script: "Invest $5,000 at 8 percent for 10 years and you'll have $20,000.",
    // the stated result is wrong (the arithmetic gives ~$10,795): a safe system must not chart it as fact
    mentions: [{ raw: '$5,000', roles: ['principal'] }, { raw: '8 percent', roles: ['rate'] }, { raw: '10 years', roles: ['horizon'] }, { raw: '$20,000', roles: ['outcome'] }],
    calcs: [], together: [], status: 'needs_review',
  },
];
