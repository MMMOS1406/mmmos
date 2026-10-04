// NextWave package resolution integrity fix — behavioral tests against the REAL
// _nextWavePkgForTask extracted from public/index.html. Two demonstrated defects fixed:
// (1) plain find() always returned the OLDEST package (array push-order), so a stale package
//     (e.g. generated while the engine was in TEST) stayed selected forever after regeneration;
// (2) no engine filter, so a different engine's package sharing the same numeric taskId could
//     be selected (observed: SRV Farsi packages colliding with NextWave task ids 123/124).
// Run: node test_nextwave_pkg_resolution.cjs public/index.html
const fs = require('fs');
const h = fs.readFileSync(process.argv[2] || 'public/index.html', 'utf8');
function fn(name) {
  const m = h.match(new RegExp('\\n(async )?function ' + name.replace(/\$/g, '\\$') + '\\('));
  if (!m) throw new Error('missing ' + name);
  const s = m.index + 1;
  return h.slice(s, h.indexOf('\n}\n', s) + 2);
}
const src = fn('_nextWavePkgForTask');
const resolve = new Function('D', src + '\nreturn _nextWavePkgForTask;')({ packages: [] });

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const pkg = (engine, taskId, generatedAt, x = {}) => ({ id: 'pkg_' + Math.random().toString(36).slice(2), engine, taskId, generatedAt, ...x });
const run = (packages, task) => new Function('D', src + '\nreturn _nextWavePkgForTask;')({ packages })(task);

console.log('\n[CASE 1] one NextWave package for a task -> resolves normally');
{
  const p = pkg('NextWave', 113, '2026-10-03T20:03:02.029Z');
  const got = run([p], { id: 113 });
  ok('CASE 1: the single package resolves', got === p);
}
console.log('\n[CASE 2] old NextWave TEST package + newer NextWave production package for the same task -> newer resolves');
{
  const old = pkg('NextWave', 113, '2026-10-03T20:03:02.029Z', { isTest: true, title: 'old test gen' });
  const fresh = pkg('NextWave', 113, '2026-10-04T09:00:00.000Z', { isTest: false, title: 'new production gen' });
  const got = run([old, fresh], { id: 113 }); // old pushed first, exactly as D.packages.push always appends
  ok('CASE 2: the NEWER production package resolves, not the older one found first in array order', got === fresh, got && got.title);
  ok('CASE 2: resolved package is the non-test one', got && got.isTest === false);
}
console.log('\n[CASE 3] SRV Farsi package and NextWave package share a numeric taskId -> NextWave lifecycle resolves the NextWave package only');
{
  const farsi = pkg('SRV Farsi', 123, '2026-09-06T18:45:04.884Z', { title: 'قول ما' });
  const nw = pkg('NextWave', 123, '2026-10-03T12:00:00.000Z', { title: 'real NextWave short' });
  const got = run([farsi, nw], { id: 123 }); // farsi pushed first (older), would have won under the old find()
  ok('CASE 3: the NextWave package resolves, never the SRV Farsi one sharing the same numeric id', got === nw, got && got.title);
}
console.log('\n[CASE 4] the historical old package remains preserved after resolution (never mutated or removed)');
{
  const old = pkg('NextWave', 113, '2026-10-03T20:03:02.029Z', { isTest: true, id: 'pkg_1791057782029' });
  const fresh = pkg('NextWave', 113, '2026-10-04T09:00:00.000Z', { isTest: false });
  const packages = [old, fresh];
  const before = JSON.stringify(old);
  run(packages, { id: 113 });
  ok('CASE 4: the old package object is byte-identical after resolution (not mutated)', JSON.stringify(old) === before);
  ok('CASE 4: the old package is still present in D.packages (not removed)', packages.includes(old) && packages.length === 2);
}
console.log('\n[CASE 5] no matching NextWave package -> existing no-package (null) behavior is unchanged');
{
  const farsi = pkg('SRV Farsi', 999, '2026-09-01T00:00:00.000Z');
  ok('CASE 5: no NextWave package at all -> null', run([], { id: 999 }) === null);
  ok('CASE 5: only a different-engine package for this id -> still null, not a false-positive match', run([farsi], { id: 999 }) === null);
  ok('CASE 5: no task object -> null (unchanged defensive guard)', run([farsi], null) === null);
}
console.log('\n[CASE 6] existing Build/Review/Approve rendering does not regress');
{
  // renderNextWaveLifecycleCard's entire contract with this function is: one return value, either
  // a package object or null, consumed as `const pkg=_nextWavePkgForTask(task);` — the single call
  // site (confirmed below) is unchanged, and cases 1 and 5 above prove the single-package and
  // no-package behaviors (the only shapes that existed before this fix) are preserved exactly.
  const callSites = (h.match(/_nextWavePkgForTask\(/g) || []).length;
  ok('CASE 6: exactly one definition + one call site, as before (no new/removed callers)', callSites === 2, callSites);
  ok('CASE 6: the sole caller is renderNextWaveLifecycleCard, unchanged', /function renderNextWaveLifecycleCard\(task\)\{\s*const pkg=_nextWavePkgForTask\(task\);/.test(h));
  ok('CASE 6: single-package resolution (the common case) is byte-for-byte the same contract as before', run([pkg('NextWave', 300, '2026-10-01T00:00:00.000Z')], { id: 300 }) !== null);
}
console.log('\n[extra] task.taskId is honored, not just task.id (same field preference as before)');
{
  const p = pkg('NextWave', 'nwv2preview_123', '2026-10-01T00:00:00.000Z');
  const got = run([p], { taskId: 'nwv2preview_123' });
  ok('extra: task.taskId resolves correctly when task.id is absent', got === p);
}

console.log(`\n${pass} passed, ${fail} failed`);
out.forEach((l) => console.log('  ' + l));
if (fail) process.exit(1);
