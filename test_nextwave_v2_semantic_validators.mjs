// Unit tests for the deterministic validator helpers (no model calls).
import { hasDuplicateWords, semanticTokens } from './lib/nextwaveV2SemanticStoryboard.mjs';
let pass = 0, fail = 0;
const t = (name, ok) => { ok ? pass++ : (fail++, console.log('FAIL', name)); };
// numeric formatting must never read as repeated words
for (const n of ['$1,000', '$10,000', '$100,000', '$1,000,000', '$10,000,000', '$1,000,000,000', '$100,000,000']) {
  t(`no dup: ${n} RETIREMENT BALANCE`, !hasDuplicateWords(`${n} RETIREMENT BALANCE`));
  t(`no dup: ${n}/MO PAYMENT`, !hasDuplicateWords(`${n}/MO PAYMENT`));
  t(`one numeric token: ${n}`, semanticTokens(n).length === 1);
}
t('no dup: $1,000 and $1,000 apart', !hasDuplicateWords('$1,000 SAVED $1,000 SPENT'));
t('no dup: 10% ... 10%', !hasDuplicateWords('10% RATE 10% FEE'));
// genuine repeated-text defects
t('dup: 5 YEARS FIVE YEARS', hasDuplicateWords('5 YEARS FIVE YEARS'));
t('dup: BALANCE BALANCE', hasDuplicateWords('$500 BALANCE BALANCE'));
t('dup: TOTAL COST TOTAL COST', hasDuplicateWords('$500 TOTAL COST TOTAL COST'));
t('dup: ten years 10 years', hasDuplicateWords('OVER TEN YEARS 10 YEARS'));
console.log(`validator helper tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
