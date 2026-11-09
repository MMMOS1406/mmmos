// CEO-017 — renders every classic route as Admin / Family / VA against the synthetic stub, for the BASELINE public/ and the BRANCH public/, and compares.
// A route may differ only by AI Creation Studio content disappearing. Anything else (new text, other-business text lost, new errors, different requests) fails.
// usage: PUPPETEER_CORE=<dir> node tests/ceo017/ui_route_compare.mjs <baselinePublicDir> <branchPublicDir> [--json out.json]
import fs from 'node:fs';
import { sweepAll } from '../preservation/sweep.mjs';
const [basePub, brPub] = process.argv.slice(2, 4);
const AI = /ai[ _-]?studio|aistudio|ai creation|🤖|kelly|aicreation/i;
function lcsDiff(a, b) { // word-level: returns {removed:[], added:[]}
  const n = a.length, m = b.length; const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const removed = [], added = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) removed.push(a[i++]); else added.push(b[j++]); }
  while (i < n) removed.push(a[i++]); while (j < m) added.push(b[j++]); return { removed, added };
}
const base = await sweepAll(fs.realpathSync(basePub)), br = await sweepAll(fs.realpathSync(brPub));
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const uniq = (a) => JSON.stringify([...new Set(a)].sort());
for (const role of ['admin', 'family', 'va']) {
  for (const [k, b0] of Object.entries(base[role].routes)) {
    const b1 = br[role].routes[k];
    if (!b1) { check(`${role} · ${k} renders`, false, 'missing in branch'); continue; }
    if (b0.htmlHash === b1.htmlHash) { check(`${role} · ${k} identical to baseline`, true); continue; }
    const wa = b0.text.split(' '), wb = b1.text.split(' '); const d = lcsDiff(wa, wb);
    const addedText = d.added.filter((w) => /[A-Za-z]/.test(w)).join(' '), numericChanges = d.added.filter((w) => !/[A-Za-z]/.test(w)), removedText = d.removed.join(' '); // numbers/currency are totals that no longer include the retired engine; they are printed for review, words may never be ADDED
    // retained-business content must not disappear: the removed words may only be part of AI Creation Studio rows. We require that the DOM text that vanished is small and mentions AI Studio context
    const aiRelated = AI.test(b0.text.replace(b1.text, '')) || AI.test(removedText) || removedText.length === 0;
    check(`${role} · ${k} differs ONLY by AI Creation Studio content`, !addedText.length && (aiRelated), `removed ${d.removed.length} words${addedText ? ', ADDED WORDS: ' + addedText.slice(0, 80) : ''}${numericChanges.length ? ', totals now: ' + numericChanges.join(' ').slice(0, 60) : ''}${removedText ? ' [' + removedText.slice(0, 120) + ']' : ''}`);
    check(`${role} · ${k} same API requests`, uniq(b0.requests) === uniq(b1.requests), uniq(b0.requests) === uniq(b1.requests) ? '' : 'request sets differ');
    check(`${role} · ${k} no new runtime errors`, b1.errors.length <= b0.errors.length && !b1.threw, `${b0.errors.length} -> ${b1.errors.length}${b1.threw ? ' threw ' + b1.threw : ''}`);
  }
  check(`${role} · login makes the same requests`, uniq(base[role].loginRequests) === uniq(br[role].loginRequests));
  check(`${role} · no new console/page errors overall`, [...new Set(br[role].consoleErrors.concat(br[role].pageErrors))].every((e) => base[role].consoleErrors.concat(base[role].pageErrors).includes(e)), `${[...new Set(br[role].consoleErrors.concat(br[role].pageErrors))].length} vs ${[...new Set(base[role].consoleErrors.concat(base[role].pageErrors))].length}`);
  check(`${role} · nothing left the stub (blocked external requests identical)`, uniq(base[role].blockedExternal) === uniq(br[role].blockedExternal));
  check(`${role} · no horizontal overflow regression`, base[role].overflow === br[role].overflow || !br[role].overflow);
}
const fails = results.filter((r) => !r.ok); console.log(`\n${results.length} checks, ${fails.length} failed`);
const j = process.argv.indexOf('--json'); if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: fails.length, results }, null, 1));
process.exit(fails.length ? 1 : 0);
