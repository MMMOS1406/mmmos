// Order 053 — self-test of the Finance Pilot scope guard. Proves it catches changes outside pilot-owned code
// (including the cases the previous text-search rule missed) and accepts legitimate pilot changes.
// Run: node tests/projects/nextwave-finance-pilot/test_nwfp_scope_guard_053.mjs
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedFileViolations, functionSpans, parseHunks } from './_scopeGuard.mjs';
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Builds a -U0 diff between two texts with git (no repository needed).
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const diffOf = (a, b) => {
  const d = mkdtempSync(join(tmpdir(), 'nwfp-guard-'));
  writeFileSync(join(d, 'a'), a); writeFileSync(join(d, 'b'), b);
  let out = '';
  try { execSync(`git diff --no-index -U0 a b`, { cwd: d, encoding: 'utf8' }); } catch (e) { out = e.stdout || ''; }
  rmSync(d, { recursive: true, force: true });
  return out;
};
const v = (a, b) => sharedFileViolations(a, b, diffOf(a, b));

const BASE = [
  "import x from './x.mjs';",
  '',
  'function _nwfpCardHtml(st){',
  "  return '<div>' + st + '</div>';",
  '}',
  'function _engFmtBytes(n){n=Number(n)||0;return n+" B";}',
  'async function _engArtifactsLoad(){',
  '  const el = 1;',
  '  return el;',
  '}',
  'async function handler(req, res) {',
  "    if (action === 'list_tasks')                return await listTasks(req, res);",
  '}',
  '',
].join('\n');
const edit = (from, to) => { if (!BASE.includes(from)) throw new Error('fixture: ' + from); return BASE.replace(from, to); };

ok('function spans are found by declaration and end at the next top-level line', JSON.stringify(functionSpans(BASE).map(s => [s.name, s.start, s.end])) === JSON.stringify([['_nwfpCardHtml', 3, 5], ['_engFmtBytes', 6, 6], ['_engArtifactsLoad', 7, 10], ['handler', 11, 13]]));
ok('hunk parsing gives exact old/new line numbers', (() => { const h = parseHunks(diffOf(BASE, edit('  const el = 1;', '  const el = 2;'))); return h.removed[0].n === 8 && h.added[0].n === 8; })());
ok('an edit inside a pilot-owned function is allowed', v(BASE, edit("  return '<div>' + st + '</div>';", "  return '<p>' + st + '</p>';")).length === 0);
ok('an edit to a non-pilot function directly below pilot code is caught (missed by the earlier rule)', v(BASE, edit('n=Number(n)||0;', 'n=Number(n)||1;')).length >= 1);
ok('an added line inside a non-pilot function is caught (missed by the earlier rule)', v(BASE, edit('  const el = 1;\n', '  const el = 1;\n  window.x = 1;\n')).length >= 1);
ok('a removed line inside a non-pilot function is caught', v(BASE, edit('  return el;\n', '')).length >= 1);
ok('a new top-level non-pilot function is caught', v(BASE, BASE + 'function srvThing(){ return 1; }\n').length >= 1);
ok('a new pilot function with a comment above it is allowed', v(BASE, BASE + '// 053 — pilot helper\nfunction _nwfpNew(){\n  return 1;\n}\n').length === 0);
ok('a known router hook line for an nwfp_ action is allowed inside the shared handler',
  v(BASE, edit("    if (action === 'list_tasks')                return await listTasks(req, res);\n", "    if (action === 'list_tasks')                return await listTasks(req, res);\n    if (action === 'nwfp_new')                  return await nwfpNew(req, res); // 053 — pilot\n")).length === 0);
ok('a router line for a NON-pilot action is caught', v(BASE, edit("    if (action === 'list_tasks')                return await listTasks(req, res);\n", "    if (action === 'list_tasks')                return await listTasks(req, res);\n    if (action === 'srv_new')                   return await srvNew(req, res); // x\n")).length >= 1);
ok('the pilot module import hook is allowed; any other import is caught',
  v(BASE, edit("import x from './x.mjs';", "import x from './x.mjs';\nimport * as NWFP_X from '../projects/nextwave-finance-pilot/lib/x.mjs'; // 053 — pilot")).length === 0 &&
  v(BASE, edit("import x from './x.mjs';", "import x from './x.mjs';\nimport y from '../lib/srvFarsi/y.mjs';")).length >= 1);
ok('a comment-only addition in non-pilot code is caught', v(BASE, edit('  const el = 1;\n', '  // note\n  const el = 1;\n')).length >= 1);

// Real history: legitimate pilot releases pass; a non-pilot release is flagged.
const sh = (c) => execSync(c, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
let history = null;
try {
  history = Object.fromEntries([['77', '315e4ae', '9efd0df'], ['78', '9efd0df', 'fe13167'], ['79', 'fe13167', 'a75e6d9'], ['76', '92281cf', '315e4ae']].map(([pr, a, b]) => {
    let n = 0;
    for (const f of ['api/ops.js', 'public/index.html']) { const d = sh(`git diff -U0 ${a} ${b} -- ${f}`); if (d.trim()) n += sharedFileViolations(sh(`git show ${a}:${f}`), sh(`git show ${b}:${f}`), d).length; }
    return [pr, n];
  }));
} catch { console.log('NOTE history check skipped: commits not available'); }
if (history) {
  ok('released pilot PRs #77, #78, #79 pass the guard', history['77'] === 0 && history['78'] === 0 && history['79'] === 0, JSON.stringify(history));
  ok('a non-pilot release (PR #76, auth) is flagged by the guard', history['76'] > 0, JSON.stringify(history));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
