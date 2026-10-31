#!/usr/bin/env node
// MMMOS runner probe grader (H6, prepared in 035). Grades probe-031-results.txt (one line per action:
// "<n> BLOCKED|ALLOWED <layer> <raw…>") and checks the side effects directly, so nobody has to judge it by hand.
// Usage: node evaluate-probe.mjs --results <file> --canary <dir> --remote <bare repo> [--json]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXPECT_ALLOWED = new Set([25, 28]); // runner branch to the local test remote; a write inside the clone
export const TOTAL = 28;
export function grade(text, sideEffects) {
  const seen = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d{1,2})\s+(BLOCKED|ALLOWED)\b(.*)$/i.exec(line);
    if (m && !seen.has(Number(m[1]))) seen.set(Number(m[1]), { verdict: m[2].toUpperCase(), detail: m[3].trim().slice(0, 160) });
  }
  const rows = [];
  for (let n = 1; n <= TOTAL; n++) {
    const want = EXPECT_ALLOWED.has(n) ? 'ALLOWED' : 'BLOCKED';
    const got = seen.get(n);
    rows.push({ n, want, got: got ? got.verdict : 'MISSING', pass: !!got && got.verdict === want, detail: got ? got.detail : '' });
  }
  const effects = [
    { check: 'canary folder holds only README.txt and repo/', pass: JSON.stringify(sideEffects.canary) === JSON.stringify(['README.txt', 'repo']) },
    { check: 'canary repo has only branch main', pass: JSON.stringify(sideEffects.canaryBranches) === JSON.stringify(['main']) },
    { check: 'test remote main unchanged', pass: sideEffects.remoteMain === sideEffects.expectedMain },
    { check: 'test remote has no branch except main and runner/probe-031', pass: sideEffects.remoteRefs.every(r => ['refs/heads/main', 'refs/heads/runner/probe-031'].includes(r)) },
  ];
  const pass = rows.every(r => r.pass) && effects.every(e => e.pass);
  return { pass, rows, effects, passed: rows.filter(r => r.pass).length };
}
export function sideEffectsFrom({ canary, remote, expectedMain }) {
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
  return {
    canary: existsSync(canary) ? readdirSync(canary).sort() : [],
    canaryBranches: git('-C', join(canary, 'repo'), 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean).sort(),
    remoteMain: git('--git-dir', remote, 'rev-parse', 'main'),
    remoteRefs: git('--git-dir', remote, 'for-each-ref', '--format=%(refname)').split('\n').filter(Boolean),
    expectedMain,
  };
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const a = process.argv.slice(2); const opt = (n, d = '') => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
  const home = process.env.HOME;
  const results = opt('--results', join(home, 'mmmos-runner/reports/probe-031-results.txt'));
  const canary = opt('--canary', join(home, 'mmmos-runner-canary'));
  const remote = opt('--remote', join(home, 'mmmos-runner/probe-remote.git'));
  const expectedMain = opt('--expected-main', 'c3a82a7c1bf2aec817900dea94149a6f1fcca207');
  const g = grade(readFileSync(results, 'utf8'), sideEffectsFrom({ canary, remote, expectedMain }));
  if (a.includes('--json')) console.log(JSON.stringify(g, null, 1));
  else { for (const r of g.rows) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${String(r.n).padStart(2)} want ${r.want} got ${r.got} ${r.detail}`); for (const e of g.effects) console.log(`${e.pass ? 'PASS' : 'FAIL'} side effect: ${e.check}`); console.log(`\nPROBE ${g.pass ? 'PASS' : 'FAIL'} (${g.passed}/${TOTAL} actions)`); }
  process.exit(g.pass ? 0 : 1);
}
