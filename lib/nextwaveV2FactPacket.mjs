// NextWave V2 Production Hardening — Phase 2: deterministic financial-math fact packets.
//
// "THE LLM WRITES THE STORY. THE SYSTEM OWNS THE MATH." Every authoritative number a NextWave
// script states (principal, rate, horizon, outcomes, gap) is generated and computed HERE,
// deterministically, before the LLM ever sees the scenario — reusing the SAME canonical
// calculator (compute(), from nextwaveV2FinanceCalculators.mjs) the Storyboard Brain already
// uses to independently verify stated figures ("avoid duplicate financial formulas").
//
// Numbers are sampled from scenario-aware realistic bands (a car loan gets car-loan-sized
// numbers, a mortgage gets mortgage-sized numbers) rather than one generic range per angle, and
// rotation avoids mechanically repeating the same angle/scenario combination recent packages
// already used. The LLM receives the finished packet as authoritative fact — it narrates,
// frames and tells the story around it, but never invents or recalculates the numbers.
import { compute } from './nextwaveV2FinanceCalculators.mjs';

export const ANGLES = ['GROW', 'AVOID', 'SAVE', 'DECIDE'];

// CEO/PM creative review (2026-10-05, task 113): "the system must identify the primary
// physical/topic object... car loan -> car; mortgage -> house." THE SYSTEM OWNS THE OBJECT,
// same as it owns the math — a deterministic lookup, not a per-generation LLM guess, so every
// script for a given scenario_type names the same concrete subject every time.
const SCENARIO_OBJECT = {
  retirement_account: 'the retirement account', index_fund: 'the index fund', side_hustle_investing: 'the side hustle income',
  index_fund_fee: 'the index fund', actively_managed_fund: 'the fund',
  high_yield_savings: 'the savings account', cd_account: 'the CD',
  car_loan: 'the car', mortgage: 'the house', personal_loan: 'the loan', student_loan: 'the student loan',
};

// scenario catalogs: [min, max, step] bands per parameter, realistic for that real-world scenario.
const SCENARIOS = {
  GROW: [
    { scenario_type: 'retirement_account', principal: [200, 800, 50], rate: [6, 9, 0.5], years: [20, 35, 1], delay: [3, 10, 1] },
    { scenario_type: 'index_fund', principal: [100, 500, 25], rate: [6, 10, 0.5], years: [15, 30, 1], delay: [2, 8, 1] },
    { scenario_type: 'side_hustle_investing', principal: [50, 300, 25], rate: [6, 8, 0.5], years: [10, 25, 1], delay: [2, 5, 1] },
  ],
  AVOID: [
    { scenario_type: 'index_fund_fee', principal: [10000, 100000, 5000], rate: [6, 8, 0.5], years: [20, 30, 1], fee_low: [0.03, 0.1, 0.01], fee_high: [0.5, 1.2, 0.05] },
    { scenario_type: 'actively_managed_fund', principal: [20000, 150000, 5000], rate: [6, 9, 0.5], years: [15, 30, 1], fee_low: [0.1, 0.3, 0.05], fee_high: [0.8, 1.5, 0.05] },
  ],
  SAVE: [
    { scenario_type: 'high_yield_savings', principal: [5000, 50000, 1000], rate_low: [0.3, 1, 0.1], rate_high: [3.5, 5, 0.1], years: [3, 10, 1] },
    { scenario_type: 'cd_account', principal: [10000, 75000, 1000], rate_low: [0.5, 1.5, 0.1], rate_high: [4, 5.5, 0.1], years: [1, 5, 1] },
  ],
  DECIDE: [
    { scenario_type: 'car_loan', principal: [15000, 45000, 1000], rate_low: [3, 5, 0.25], rate_high: [7, 10, 0.25], years: [3, 7, 1] },
    { scenario_type: 'mortgage', principal: [200000, 500000, 10000], rate_low: [3, 4.5, 0.125], rate_high: [6, 8, 0.125], years: [15, 30, 5] },
    { scenario_type: 'personal_loan', principal: [5000, 25000, 500], rate_low: [6, 9, 0.25], rate_high: [15, 25, 0.5], years: [2, 5, 1] },
    { scenario_type: 'student_loan', principal: [20000, 80000, 1000], rate_low: [3, 5, 0.25], rate_high: [7, 9, 0.25], years: [10, 20, 1] },
  ],
};

const rand = (rng, [lo, hi, step]) => Math.round(Math.round((lo + rng() * (hi - lo)) / step) * step * 1000) / 1000;
const money = (n) => Math.round(n);
const lastUsedIndex = (recentPackages, pred) => { for (let i = (recentPackages || []).length - 1; i >= 0; i--) if (pred(recentPackages[i])) return i; return -1; };

// the angle used LEAST recently (or never) — for a Short, which uses exactly one angle.
export function pickAngleForShort(recentPackages) {
  return ANGLES.reduce((best, a) => (lastUsedIndex(recentPackages, (p) => p && String(p.angle || '').split('+').includes(a)) < lastUsedIndex(recentPackages, (p) => p && String(p.angle || '').split('+').includes(best)) ? a : best), ANGLES[0]);
}
// A Long's package stores its combined angle as e.g. "GROW+SAVE+DECIDE" (one package per Long,
// three decisions). The angle absent from that set is the one THAT Long omitted.
function omittedAngleOf(pkg) {
  if (!pkg || !pkg.angle) return null;
  const used = String(pkg.angle).split('+').map((s) => s.trim());
  const missing = ANGLES.filter((a) => !used.includes(a));
  return missing.length === 1 ? missing[0] : null;
}
// the angle OMITTED least recently (or never) — every angle gets a turn being omitted, tracked
// directly from omission history rather than inclusion history (inclusion alone doesn't
// distinguish "just included" from "always included").
export function pickAngleToOmit(recentPackages) {
  return ANGLES.reduce((best, a) => (lastUsedIndex(recentPackages, (p) => omittedAngleOf(p) === a) < lastUsedIndex(recentPackages, (p) => omittedAngleOf(p) === best) ? a : best), ANGLES[0]);
}
function pickScenario(angle, recentPackages, rng) {
  const list = SCENARIOS[angle];
  const leastRecentIdx = Math.min(...list.map((s) => lastUsedIndex(recentPackages, (p) => p && p.angle === angle && p.scenario_type === s.scenario_type)));
  const candidates = list.filter((s) => lastUsedIndex(recentPackages, (p) => p && p.angle === angle && p.scenario_type === s.scenario_type) === leastRecentIdx);
  return candidates[Math.floor(rng() * candidates.length)];
}

// Build one decision's fact packet: real scenario-appropriate inputs, real computed outcomes
// (via the SAME canonical calculator the Brain uses to verify), rounded once for display —
// the LLM may round further only per `rounding`, never recompute.
export function generateFactPacket(angle, recentPackages, rng = Math.random) {
  const scen = pickScenario(angle, recentPackages, rng);
  const packet = { angle, scenario_type: scen.scenario_type, primary_object: SCENARIO_OBJECT[scen.scenario_type] || null, units: 'USD', time_basis: 'annual', provenance: 'system_generated', rounding: 'nearest_dollar' };
  if (angle === 'GROW') {
    const monthly = rand(rng, scen.principal), rate = rand(rng, scen.rate), years = rand(rng, scen.years), delay = Math.min(rand(rng, scen.delay), years - 1);
    const today = compute('compound_growth', { recurring: monthly, cadence: 'month', rate, years }, 'end_value')[0];
    const delayed = compute('compound_growth', { recurring: monthly, cadence: 'month', rate, years, delay }, 'end_value')[0];
    Object.assign(packet, {
      recurring_amount: monthly, rate, horizon: years, delay,
      outcome_a: money(today.value), outcome_b: money(delayed.value), gap: money(Math.abs(today.value - delayed.value)),
      calculation_method: 'compound_growth.end_value (monthly annuity, ' + today.convention + ')',
    });
  } else if (angle === 'AVOID') {
    const principal = rand(rng, scen.principal), rate = rand(rng, scen.rate), years = rand(rng, scen.years), feeLow = rand(rng, scen.fee_low), feeHigh = rand(rng, scen.fee_high);
    const lowEnd = compute('compound_growth', { principal, rate, fee: feeLow, years }, 'end_value').find((c) => c.convention === 'annual_compounding');
    const highEnd = compute('compound_growth', { principal, rate, fee: feeHigh, years }, 'end_value').find((c) => c.convention === 'annual_compounding');
    Object.assign(packet, {
      principal, rate, fee: feeLow, comparison_fee: feeHigh, horizon: years,
      outcome_a: money(lowEnd.value), outcome_b: money(highEnd.value), gap: money(Math.abs(lowEnd.value - highEnd.value)),
      calculation_method: 'compound_growth.end_value (annual_compounding, net of fee)',
    });
  } else if (angle === 'SAVE') {
    const principal = rand(rng, scen.principal), rateLow = rand(rng, scen.rate_low), rateHigh = rand(rng, scen.rate_high), years = rand(rng, scen.years);
    const lowEnd = compute('compound_growth', { principal, rate: rateLow, years }, 'end_value').find((c) => c.convention === 'annual_compounding');
    const highEnd = compute('compound_growth', { principal, rate: rateHigh, years }, 'end_value').find((c) => c.convention === 'annual_compounding');
    Object.assign(packet, {
      principal, rate: rateLow, comparison_rate: rateHigh, horizon: years,
      outcome_a: money(lowEnd.value), outcome_b: money(highEnd.value), gap: money(Math.abs(highEnd.value - lowEnd.value)),
      calculation_method: 'compound_growth.end_value (annual_compounding)',
    });
  } else if (angle === 'DECIDE') {
    const principal = rand(rng, scen.principal), rateLow = rand(rng, scen.rate_low), rateHigh = rand(rng, scen.rate_high), years = rand(rng, scen.years);
    const totalLow = compute('loan_payment', { principal, rate: rateLow, years }, 'total_paid')[0];
    const totalHigh = compute('loan_payment', { principal, rate: rateHigh, years }, 'total_paid')[0];
    Object.assign(packet, {
      principal, rate: rateLow, comparison_rate: rateHigh, horizon: years,
      outcome_a: money(totalLow.value), outcome_b: money(totalHigh.value), gap: money(Math.abs(totalHigh.value - totalLow.value)),
      calculation_method: 'loan_payment.total_paid (monthly_amortization)',
    });
  }
  return packet;
}

// A Short uses one angle; a Long uses three of the four, rotating which one is omitted.
export function generateFactPackets(contentFormat, recentPackages, rng = Math.random) {
  if (contentFormat !== 'long') return [generateFactPacket(pickAngleForShort(recentPackages), recentPackages, rng)];
  const omit = pickAngleToOmit(recentPackages);
  const included = ANGLES.filter((a) => a !== omit);
  const history = [...(recentPackages || [])];
  return included.map((a) => { const pk = generateFactPacket(a, history, rng); history.push({ angle: pk.angle, scenario_type: pk.scenario_type }); return pk; });
}

// Renders a fact packet as the fixed-format block the LLM prompt embeds verbatim.
export function factPacketToPromptBlock(packet) {
  const lines = [`ANGLE: ${packet.angle}`, `SCENARIO: ${packet.scenario_type}`];
  if (packet.primary_object) lines.push(`PRIMARY_OBJECT: ${packet.primary_object}`);
  const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, ''));
  if (packet.principal != null) lines.push(`PRINCIPAL: $${fmt(packet.principal)}`);
  if (packet.recurring_amount != null) lines.push(`MONTHLY_AMOUNT: $${fmt(packet.recurring_amount)}`);
  if (packet.rate != null) lines.push(`RATE: ${fmt(packet.rate)}%`);
  if (packet.comparison_rate != null) lines.push(`COMPARISON_RATE: ${fmt(packet.comparison_rate)}%`);
  if (packet.fee != null) lines.push(`FEE: ${fmt(packet.fee)}%`);
  if (packet.comparison_fee != null) lines.push(`COMPARISON_FEE: ${fmt(packet.comparison_fee)}%`);
  if (packet.horizon != null) lines.push(`HORIZON_YEARS: ${packet.horizon}`);
  if (packet.delay != null) lines.push(`DELAY_YEARS: ${packet.delay}`);
  lines.push(`OUTCOME_A: $${fmt(packet.outcome_a)}`, `OUTCOME_B: $${fmt(packet.outcome_b)}`, `GAP: $${fmt(packet.gap)}`);
  return lines.join('\n');
}
