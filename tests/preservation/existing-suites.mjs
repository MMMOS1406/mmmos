// CEO-008 Phase 0 — run the repo's EXISTING test suites and record each one's exit code and summary lines.
//   node tests/preservation/existing-suites.mjs record   -> writes golden/existing-suites.json (run on unmodified code)
//   node tests/preservation/existing-suites.mjs compare  -> re-runs and fails if any suite regressed vs. the recorded baseline
// All of these suites are local-only (fake hosts, PGlite, pure-function tests); none touches production.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const OUT = path.join(here, 'golden', 'existing-suites.json');
const SUITES = [
  'test_p0_state_guard.cjs', 'test_srv_farsi_p1_safety.cjs', 'test_srv_farsi_va_artist_format.cjs', 'test_nextwave_preview_close.cjs',
  'test_automatic_git_commit_capture_fix.cjs', 'test_ceo_production_release_ui_fix.cjs', 'test_governed_production_execution.js',
  'test_nextwave_v2_closeout_regressions.mjs', 'test_nextwave_v2_evidence_integrity.mjs', 'test_nextwave_v2_production_route.mjs',
  'test_nextwave_v2_route_ops_e2e.mjs', 'test_nextwave_v2_semantic_validators.mjs',
  'tests/platform/test_state_isolation.mjs', 'tests/platform/test_client_isolation_e2e.mjs', 'tests/platform/test_release_isolation.mjs',
  'tests/srv/test_srv_farsi_analytics_view.mjs',
];
function run(file) {
  const t = Date.now();
  const r = spawnSync('node', [file], { cwd: repo, encoding: 'utf8', timeout: 240000, env: { ...process.env, CI: '1' } });
  const text = (r.stdout || '') + (r.stderr || '');
  const lines = text.split('\n').filter(Boolean);
  const pass = (text.match(/\bPASS\b/g) || []).length, fail = (text.match(/\bFAIL\b/g) || []).length;
  return { file, exit: r.status === null ? 'timeout' : r.status, pass, fail, secs: Math.round((Date.now() - t) / 1000), tail: lines.slice(-3).map((l) => l.slice(0, 160)) };
}
const mode = process.argv[2];
const results = SUITES.filter((f) => fs.existsSync(path.join(repo, f))).map((f) => { const r = run(f); console.log(`${String(r.exit).padEnd(7)} pass=${String(r.pass).padStart(3)} fail=${String(r.fail).padStart(3)}  ${r.secs}s  ${f}`); return r; });
if (mode === 'record') { fs.writeFileSync(OUT, JSON.stringify({ recordedFrom: 'unmodified origin/main', results }, null, 1)); console.log('recorded ->', OUT); }
else if (mode === 'compare') {
  const base = JSON.parse(fs.readFileSync(OUT, 'utf8')).results; let bad = 0;
  for (const r of results) { const b = base.find((x) => x.file === r.file); if (!b) continue; const regress = r.exit !== b.exit || r.fail > b.fail || r.pass < b.pass; if (regress) { bad++; console.log('REGRESSION', r.file, 'was', b.exit, b.pass, b.fail, 'now', r.exit, r.pass, r.fail); } }
  console.log(bad ? `${bad} suite(s) regressed` : 'no existing suite regressed'); process.exit(bad ? 1 : 0);
}
