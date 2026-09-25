// NextWave V2 — deterministic finance calculators (zero dependencies).
//
// These are the AUTHORITATIVE arithmetic for the storyboard Brain. The
// semantic model may only NAME a model and map script quantities onto its
// parameters; it never supplies a number. Each model returns candidate
// results under the conventions real scripts use (e.g. annual vs monthly
// compounding for a lump sum) so a verifier can report which convention
// reproduced a stated figure — and a stated figure that NO convention
// reproduces is surfaced, never silently accepted.

const PERIODS_PER_YEAR = { day: 365, week: 52, month: 12, quarter: 4, year: 1 };
export const periodsPerYear = (cadence) => PERIODS_PER_YEAR[cadence] || 12;

// name -> { params, outputs, doc }. `doc` is shown to the semantic proposer.
export const CALC_MODELS = {
  compound_growth: {
    params: ['principal', 'recurring', 'cadence', 'rate', 'fee', 'years', 'delay'],
    outputs: ['end_value'],
    doc: 'Value after `years` of growth at annual `rate` percent (minus annual `fee` percent, if any), from an optional starting `principal` and/or a `recurring` contribution each `cadence` period; `delay` (years) postpones the start of the recurring contributions. Also models a fee/tax-drag or a lump sum with no contributions.',
  },
  real_value: {
    params: ['amount', 'inflation_rate', 'years'],
    outputs: ['future_price', 'purchasing_power'],
    doc: 'future_price = what something costing `amount` today costs after `years` of `inflation_rate` percent price growth; purchasing_power = what `amount` today is worth in today\'s money after that time.',
  },
  loan_payment: {
    params: ['principal', 'rate', 'years'],
    outputs: ['periodic_payment', 'total_paid', 'interest_paid'],
    doc: 'Level monthly payment, total paid, and total interest for a loan of `principal` at annual `rate` percent over `years`.',
  },
  loan_payoff: {
    params: ['principal', 'rate', 'payment'],
    outputs: ['payoff_periods', 'total_paid', 'interest_paid'],
    doc: 'Months to pay off `principal` at annual `rate` percent paying `payment` each month, with total paid and interest.',
  },
  runway: {
    params: ['fund', 'expense'],
    outputs: ['periods'],
    doc: 'How many periods a `fund` lasts spending `expense` per period (fund / expense).',
  },
  after_tax: {
    params: ['amount', 'tax_rate'],
    outputs: ['after_tax_proceeds', 'tax_owed'],
    doc: 'What remains of `amount` after tax at `tax_rate` percent, and the tax owed.',
  },
  breakeven: {
    params: ['upfront_cost', 'periodic_saving'],
    outputs: ['periods'],
    doc: 'Periods needed for a per-period saving to repay a one-time upfront cost (upfront_cost / periodic_saving).',
  },
  arithmetic: {
    params: ['op', 'a', 'b', 'cadence'],
    outputs: ['value'],
    doc: 'Plain arithmetic on quantities/calculations. op is one of: sum (a+b), difference (|a-b|), ratio (a/b), share_of (a * b percent), per_period (a spread over the periods in a year at `cadence`).',
  },
};
export const ARITH_OPS = ['sum', 'difference', 'ratio', 'share_of', 'per_period'];
export const CADENCES = ['day', 'week', 'month', 'quarter', 'year'];

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Every function returns [{ value, convention }] (possibly several).
export function compute(model, p, output) {
  switch (model) {
    case 'compound_growth': {
      const P = num(p.principal), pmt = num(p.recurring);
      const m = periodsPerYear(p.cadence || 'month');
      const net = (num(p.rate) - num(p.fee)) / 100;
      const Y = num(p.years), d = num(p.delay);
      if (!(Y > 0)) return [];
      const N = Math.max(0, (Y - d)) * m;
      const i = net / m;
      const annuity = pmt > 0 ? (i === 0 ? pmt * N : pmt * ((Math.pow(1 + i, N) - 1) / i)) : 0;
      const out = [];
      if (P > 0) {
        out.push({ value: P * Math.pow(1 + net, Y) + annuity, convention: 'annual_compounding' });
        out.push({ value: P * Math.pow(1 + net / 12, 12 * Y) + annuity, convention: 'monthly_compounding' });
      } else out.push({ value: annuity, convention: `${p.cadence || 'month'}ly_annuity` });
      return out;
    }
    case 'real_value': {
      const g = Math.pow(1 + num(p.inflation_rate) / 100, num(p.years));
      const A = num(p.amount);
      if (output === 'future_price') return [{ value: A * g, convention: 'annual_compounding' }];
      if (output === 'purchasing_power') return [{ value: A / g, convention: 'annual_compounding' }];
      return [];
    }
    case 'loan_payment': {
      const r = num(p.rate) / 1200, n = num(p.years) * 12, P = num(p.principal);
      if (!(n > 0 && P > 0)) return [];
      const pay = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n));
      if (output === 'periodic_payment') return [{ value: pay, convention: 'monthly_amortization' }];
      if (output === 'total_paid') return [{ value: pay * n, convention: 'monthly_amortization' }];
      if (output === 'interest_paid') return [{ value: pay * n - P, convention: 'monthly_amortization' }];
      return [];
    }
    case 'loan_payoff': {
      const r = num(p.rate) / 1200, P = num(p.principal), pmt = num(p.payment);
      if (!(P > 0 && pmt > 0) || r * P >= pmt) return [];
      const n = r === 0 ? P / pmt : -Math.log(1 - (r * P) / pmt) / Math.log(1 + r);
      if (output === 'payoff_periods') return [{ value: n, convention: 'monthly_amortization' }];
      if (output === 'total_paid') return [{ value: pmt * n, convention: 'monthly_amortization' }];
      if (output === 'interest_paid') return [{ value: pmt * n - P, convention: 'monthly_amortization' }];
      return [];
    }
    case 'runway':
      return num(p.expense) > 0 ? [{ value: num(p.fund) / num(p.expense), convention: 'simple_division' }] : [];
    case 'after_tax': {
      const A = num(p.amount), t = num(p.tax_rate) / 100;
      if (output === 'after_tax_proceeds') return [{ value: A * (1 - t), convention: 'flat_rate' }];
      if (output === 'tax_owed') return [{ value: A * t, convention: 'flat_rate' }];
      return [];
    }
    case 'breakeven':
      return num(p.periodic_saving) > 0 ? [{ value: num(p.upfront_cost) / num(p.periodic_saving), convention: 'simple_division' }] : [];
    case 'arithmetic': {
      const a = num(p.a), b = num(p.b);
      const v = { sum: a + b, difference: Math.abs(a - b), ratio: b !== 0 ? a / b : NaN, share_of: (a * b) / 100, per_period: a / periodsPerYear(p.cadence || 'month') }[p.op];
      return Number.isFinite(v) ? [{ value: v, convention: p.op }] : [];
    }
    default:
      return [];
  }
}

// Does a stated figure match a computed one at the precision scripts state it?
// kind: 'money' | 'percent' | 'duration' | 'count'
export function statedMatches(stated, computed, kind) {
  if (!Number.isFinite(stated) || !Number.isFinite(computed)) return false;
  const diff = Math.abs(stated - computed);
  if (kind === 'money') return diff <= Math.max(1, 0.0005 * Math.abs(computed));
  if (kind === 'percent') return diff <= 0.05;
  if (kind === 'duration' || kind === 'count') return Number.isInteger(stated) ? diff <= 0.5 + 1e-9 : diff <= 0.05;
  return diff <= 1e-6 * Math.max(1, Math.abs(computed));
}

// Year-by-year (or period-by-period) trajectory for a compound_growth model,
// used to draw a real chart from verified inputs. Returns integer-rounded
// points for years 0..Y (null before a delayed start).
export function growthSeries(p, convention) {
  const Y = Math.round(num(p.years));
  const pts = [];
  for (let y = 0; y <= Y; y++) {
    const d = num(p.delay);
    if (y < d && !(num(p.principal) > 0)) { pts.push(null); continue; }
    const r = compute('compound_growth', { ...p, years: y, delay: Math.min(num(p.delay), y) }, 'end_value');
    const pick = r.find((c) => c.convention === convention) || r[0];
    pts.push(pick ? Math.round(pick.value) : null);
  }
  return pts;
}
