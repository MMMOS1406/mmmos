// Phase 5.2 Step 3 — evidence-integrity test matrix for
// nextwaveV2BindEvidenceDeterministically (lib/nextwaveV2EvidenceBinding.mjs).
//
// Each case builds a synthetic `plan` (real unit text + real candidate
// values, exactly the shape the live pipeline produces) and an
// ADVERSARIAL `slots` array that mimics a real storyboard-model pairing
// error (wrong unit_index, wrong primary_value, or both) — then asserts
// the binder produces the CORRECT (label -> unit -> value) pairing
// regardless of what the adversarial input said. No network call, no
// paid render — pure function in, pure data out.
//
// Run: node test_nextwave_v2_evidence_integrity.mjs

import { nextwaveV2BindEvidenceDeterministically, nextwaveV2RecoverComparisonSecondSide } from './lib/nextwaveV2EvidenceBinding.mjs';

let passCount = 0;
let failCount = 0;
const failures = [];

function unit(idx, text, candidateValues) {
  return { __idx: idx, text, __candidateValues: candidateValues };
}

function run(name, { plan, validIdxs, slots, expected }) {
  const planByIdx = {};
  plan.forEach((u) => { planByIdx[u.__idx] = u; });
  const result = nextwaveV2BindEvidenceDeterministically(slots, planByIdx, validIdxs);
  const actual = result.map((sl) => ({ label: sl.label, unit_index: sl.unit_index, primary_value: sl.primary_value }));
  const expectedNorm = expected.map((e) => ({ label: e.label, unit_index: e.unit_index, primary_value: e.primary_value }));
  const ok = JSON.stringify(actual) === JSON.stringify(expectedNorm);
  if (ok) {
    passCount++;
    console.log(`PASS  ${name}`);
  } else {
    failCount++;
    failures.push({ name, actual, expected: expectedNorm });
    console.log(`FAIL  ${name}`);
    console.log('      actual:  ', JSON.stringify(actual));
    console.log('      expected:', JSON.stringify(expectedNorm));
  }
}

// ── 1. TIME SERIES — the exact reported bug: model cross-wires unit_index
// between YEAR 1 and YEAR 5. ────────────────────────────────────────────
run('1. time series (reported bug — Year 1/5/10 cross-wired unit_index)', {
  plan: [
    unit(4, 'By year 1 your balance is $10,000.', ['$10,000']),
    unit(5, 'By year 5 it grows to $25,000.', ['$25,000']),
    unit(6, 'By year 10 it reaches $60,000.', ['$60,000']),
  ],
  validIdxs: [4, 5, 6],
  slots: [
    { unit_index: 5, label: 'YEAR 1', primary_value: '$25,000', secondary_value: null }, // wrong unit_index
    { unit_index: 4, label: 'YEAR 5', primary_value: '$10,000', secondary_value: null }, // wrong unit_index
    { unit_index: 6, label: 'YEAR 10', primary_value: '$60,000', secondary_value: null }, // already correct
  ],
  expected: [
    { label: 'YEAR 1', unit_index: 4, primary_value: '$10,000' },
    { label: 'YEAR 5', unit_index: 5, primary_value: '$25,000' },
    { label: 'YEAR 10', unit_index: 6, primary_value: '$60,000' },
  ],
});

// ── 2. TWO-WAY COMPARISON — same unit, two values, model swaps which
// value goes with which label (no digit anchor, word-based). ───────────
run('2. two-way comparison (interest/principal split, swapped values)', {
  plan: [
    unit(3, 'Sixty percent of your payment goes to interest, and forty percent goes to principal.', ['60%', '40%']),
  ],
  validIdxs: [3],
  slots: [
    { unit_index: 3, label: 'INTEREST', primary_value: '40%', secondary_value: null }, // swapped
    { unit_index: 3, label: 'PRINCIPAL', primary_value: '60%', secondary_value: null }, // swapped
  ],
  expected: [
    { label: 'INTEREST', unit_index: 3, primary_value: '60%' },
    { label: 'PRINCIPAL', unit_index: 3, primary_value: '40%' },
  ],
});

// ── 3. THREE-VALUE BUILDUP — three separate units, model swaps two of
// the three unit_index assignments. ─────────────────────────────────────
run('3. three-value buildup (rent/utilities/insurance, swapped unit_index)', {
  plan: [
    unit(0, 'Rent costs $1,200 a month.', ['$1,200']),
    unit(1, 'Utilities add $300.', ['$300']),
    unit(2, 'Insurance adds $150.', ['$150']),
  ],
  validIdxs: [0, 1, 2],
  slots: [
    { unit_index: 1, label: 'RENT', primary_value: '$300', secondary_value: null }, // wrong
    { unit_index: 0, label: 'UTILITIES', primary_value: '$1,200', secondary_value: null }, // wrong
    { unit_index: 2, label: 'INSURANCE', primary_value: '$150', secondary_value: null }, // already correct
  ],
  // Step 1's word-anchor fallback (used when a label has no digit) finds
  // "rent" only in unit 0's own text, "utilities" only in unit 1's, so
  // both mis-wired slots self-correct back to their true unit.
  expected: [
    { label: 'RENT', unit_index: 0, primary_value: '$1,200' },
    { label: 'UTILITIES', unit_index: 1, primary_value: '$300' },
    { label: 'INSURANCE', unit_index: 2, primary_value: '$150' },
  ],
});

// ── 4. PERCENTAGE / DONUT ALLOCATION — same unit, generic OPTION A/B
// labels (no keyword overlap with text at all). Documents the honest
// limit: with zero anchor signal, the pre-existing hallucination guard
// (verbatim-only) is the only protection -- the binder must not crash or
// invent, but also cannot guess correctly with zero signal. ────────────
run('4. percentage/donut allocation (generic labels, no anchor — documents limit)', {
  plan: [
    unit(7, 'Sixty percent goes toward growth investments and forty percent goes toward bonds.', ['60%', '40%']),
  ],
  validIdxs: [7],
  slots: [
    { unit_index: 7, label: 'OPTION A', primary_value: '60%', secondary_value: null },
    { unit_index: 7, label: 'OPTION B', primary_value: '40%', secondary_value: null },
  ],
  // No anchor resolvable (labels share no word with the text) -> Step 3
  // leaves values untouched (already hallucination-guarded real values).
  expected: [
    { label: 'OPTION A', unit_index: 7, primary_value: '60%' },
    { label: 'OPTION B', unit_index: 7, primary_value: '40%' },
  ],
});

// ── 5. BEFORE/AFTER — same unit, word-anchored labels, swapped values. ──
run('5. before/after (starting/final amount, swapped values)', {
  plan: [
    unit(8, 'The balance is $10,000 at the starting point and reaches $40,000 at the final point.', ['$10,000', '$40,000']),
  ],
  validIdxs: [8],
  slots: [
    { unit_index: 8, label: 'STARTING AMOUNT', primary_value: '$40,000', secondary_value: null }, // swapped
    { unit_index: 8, label: 'FINAL AMOUNT', primary_value: '$10,000', secondary_value: null }, // swapped
  ],
  expected: [
    { label: 'STARTING AMOUNT', unit_index: 8, primary_value: '$10,000' },
    { label: 'FINAL AMOUNT', unit_index: 8, primary_value: '$40,000' },
  ],
});

// ── 6. MONEY-FLOW — single unit, single value, trivial (Step 2). ────────
run('6. money-flow (single unit, single value)', {
  plan: [
    unit(9, 'Steady contributions can grow into a $250,000 nest egg.', ['$250,000']),
  ],
  validIdxs: [9],
  slots: [
    { unit_index: 9, label: 'NEST EGG', primary_value: '$99,999', secondary_value: null }, // wrong value entirely
  ],
  expected: [
    { label: 'NEST EGG', unit_index: 9, primary_value: '$250,000' },
  ],
});

// ── 7. SAME UNIT, THREE VALUES — stress the clause-matching with N=3
// (a single sentence splitting a budget three ways, all shuffled). ─────
run('7. same-unit three-value split (three-way budget allocation, shuffled)', {
  plan: [
    unit(10, 'Forty percent goes to housing, thirty five percent goes to savings, and twenty five percent goes to discretionary spending.', ['40%', '35%', '25%']),
  ],
  validIdxs: [10],
  slots: [
    { unit_index: 10, label: 'HOUSING', primary_value: '25%', secondary_value: null }, // wrong
    { unit_index: 10, label: 'SAVINGS', primary_value: '40%', secondary_value: null }, // wrong
    { unit_index: 10, label: 'DISCRETIONARY SPENDING', primary_value: '35%', secondary_value: null }, // wrong
  ],
  expected: [
    { label: 'HOUSING', unit_index: 10, primary_value: '40%' },
    { label: 'SAVINGS', unit_index: 10, primary_value: '35%' },
    { label: 'DISCRETIONARY SPENDING', unit_index: 10, primary_value: '25%' },
  ],
});

// ── 7b. SAME UNIT, DURATION-ANCHORED LABEL SHARING A CLAUSE WITH A
// DOLLAR VALUE — the real "$291K over 30 years vs $135K over 15 years"
// pattern (both a duration AND a dollar value are real candidates in the
// SAME clause). This is deliberately left to the pre-existing Phase 4.5D
// proximity-pairing pass (which already runs immediately after this
// binder in nextwaveV2GenerateStoryboard) rather than Step 3: a clause
// with 2+ real candidates is genuinely ambiguous for a pure clause-match
// (which value in the clause?), so Step 3 correctly declines to guess and
// leaves it for the more specific existing "money-like value adjacent to
// the matched duration" heuristic. Documents the intentional division of
// responsibility rather than duplicating that logic here.
run('7b. same-unit duration+dollar pair per clause (documents division of responsibility)', {
  plan: [
    unit(15, 'Over 30 years you pay $291,000 in interest, and over 15 years you pay $135,000 in interest.', ['30 YEARS', '$291,000', '15 YEARS', '$135,000']),
  ],
  validIdxs: [15],
  slots: [
    { unit_index: 15, label: '30-YEAR INTEREST', primary_value: '30 YEARS', secondary_value: null },
    { unit_index: 15, label: '15-YEAR INTEREST', primary_value: '15 YEARS', secondary_value: null },
  ],
  // Step 3 declines (2 real candidates share each clause -> ambiguous for
  // a pure clause match), so these pass through unchanged from this
  // binder -- the existing downstream proximity-pairing pass is what
  // actually resolves this specific pattern in the real pipeline.
  expected: [
    { label: '30-YEAR INTEREST', unit_index: 15, primary_value: '30 YEARS' },
    { label: '15-YEAR INTEREST', unit_index: 15, primary_value: '15 YEARS' },
  ],
});

// ── 8. REPEATED/DUPLICATE VALUES — two slots, textually identical real
// values. Correctness is inherently undefined here; the requirement is
// no crash and both slots still carry a REAL (hallucination-guarded)
// value, never null/invented. ───────────────────────────────────────────
run('8. repeated/duplicate values (no crash, stays real)', {
  plan: [
    unit(11, 'Both plans cost $500 a month, whichever you pick.', ['$500']),
  ],
  validIdxs: [11],
  slots: [
    { unit_index: 11, label: 'PLAN A', primary_value: '$500', secondary_value: null },
    { unit_index: 11, label: 'PLAN B', primary_value: '$500', secondary_value: null },
  ],
  expected: [
    { label: 'PLAN A', unit_index: 11, primary_value: '$500' },
    { label: 'PLAN B', unit_index: 11, primary_value: '$500' },
  ],
});

// ── 9. VALUE-FORMAT COVERAGE — $, %, K/M/B, commas, durations, all in
// one buildup, one swapped. ─────────────────────────────────────────────
run('9. value-format coverage ($, %, K/M/B-style, commas, durations)', {
  plan: [
    unit(12, 'The fund charges a 1.5% fee.', ['1.5%']),
    unit(13, 'It has returned $1,200,000 over its life.', ['$1,200,000']),
    unit(14, 'That took 18 months to compound.', ['18 MONTHS']),
  ],
  validIdxs: [12, 13, 14],
  slots: [
    { unit_index: 13, label: 'FEE', primary_value: '$1,200,000', secondary_value: null }, // wrong unit + wrong value
    { unit_index: 12, label: 'TOTAL RETURN', primary_value: '1.5%', secondary_value: null }, // wrong unit + wrong value
    { unit_index: 14, label: 'TIME TO COMPOUND', primary_value: '18 MONTHS', secondary_value: null }, // correct
  ],
  // Word-anchor fallback: "fee" is found only in unit 12's text, "return"
  // is found (as a substring of "returned") only in unit 13's text, so
  // both self-correct to their true unit and its own single real value.
  expected: [
    { label: 'FEE', unit_index: 12, primary_value: '1.5%' },
    { label: 'TOTAL RETURN', unit_index: 13, primary_value: '$1,200,000' },
    { label: 'TIME TO COMPOUND', unit_index: 14, primary_value: '18 MONTHS' },
  ],
});

// ── 10-12. ONE-SLOT COMPARISON RECOVERY (Phase 5.2A) ─────────────────────
function runRecovery(name, { plan, scene, screenType, slots, expectedLen, expectedScreenType }) {
  const planByIdx = {};
  plan.forEach((u) => { planByIdx[u.__idx] = u; });
  const result = nextwaveV2RecoverComparisonSecondSide(slots, screenType, scene, planByIdx);
  let effectiveScreenType = screenType;
  if ((effectiveScreenType === 'comparison' || effectiveScreenType === 'before_after') && result.length < 2) {
    effectiveScreenType = 'single';
  }
  const ok = result.length === expectedLen && effectiveScreenType === expectedScreenType;
  if (ok) {
    passCount++;
    console.log(`PASS  ${name}`);
  } else {
    failCount++;
    failures.push({ name, actual: { len: result.length, screenType: effectiveScreenType, slots: result }, expected: { len: expectedLen, screenType: expectedScreenType } });
    console.log(`FAIL  ${name}`);
    console.log('      actual:  ', JSON.stringify({ len: result.length, screenType: effectiveScreenType, slots: result }));
    console.log('      expected:', JSON.stringify({ len: expectedLen, screenType: expectedScreenType }));
  }
}

// 10. Recovery A — a different real unit in the same scene has its own
// real value the model never turned into a second slot.
runRecovery('10. one-slot comparison recovery A (different unit in scene)', {
  plan: [
    unit(4, 'That payoff time drops to about four years.', ['4 YEARS']),
    unit(5, 'You would save five thousand dollars in interest.', ['$5,000']),
  ],
  scene: { units: [{ __idx: 4 }, { __idx: 5 }] },
  screenType: 'comparison',
  slots: [{ unit_index: 4, label: 'NEW PAYOFF TIME', primary_value: '4 YEARS', secondary_value: null }],
  expectedLen: 2,
  expectedScreenType: 'comparison',
});

// 11. Recovery B — the SAME unit already carries a second real value the
// model collapsed into one slot.
runRecovery('11. one-slot comparison recovery B (second value, same unit)', {
  plan: [
    unit(4, 'That payoff time drops to about four years, saving five thousand dollars in interest.', ['4 YEARS', '$5,000']),
  ],
  scene: { units: [{ __idx: 4 }] },
  screenType: 'comparison',
  slots: [{ unit_index: 4, label: 'NEW PAYOFF TIME', primary_value: '4 YEARS', secondary_value: null }],
  expectedLen: 2,
  expectedScreenType: 'comparison',
});

// 12. No recoverable second value anywhere -> downgrade to 'single'
// (never a forced two-sided layout, never a bare card).
runRecovery("12. one-slot comparison with no recoverable second value -> downgrades to 'single'", {
  plan: [
    unit(4, 'That payoff time drops to about four years.', ['4 YEARS']),
  ],
  scene: { units: [{ __idx: 4 }] },
  screenType: 'comparison',
  slots: [{ unit_index: 4, label: 'NEW PAYOFF TIME', primary_value: '4 YEARS', secondary_value: null }],
  expectedLen: 1,
  expectedScreenType: 'single',
});

console.log('');
console.log(`${passCount} PASS / ${failCount} FAIL / ${passCount + failCount} TOTAL`);
if (failCount > 0) {
  console.log('');
  console.log('FAILURES:');
  failures.forEach((f) => console.log(' -', f.name));
  process.exit(1);
} else {
  console.log('EVIDENCE-INTEGRITY MATRIX: 100% PASS');
  process.exit(0);
}
