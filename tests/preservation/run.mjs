// CEO-008 preservation harness — command line.
//   node tests/preservation/run.mjs baseline [--public DIR] [--out FILE]   record the golden from UNMODIFIED code
//   node tests/preservation/run.mjs verify   [--public DIR]                run every preservation check
// Needs puppeteer-core (PUPPETEER_CORE=<dir containing node_modules>) and Chrome (CHROME_PATH).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sweepAll } from './sweep.mjs';
import { runShellChecks } from './shell-checks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const GOLDEN = path.join(here, 'golden', 'baseline.json');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const publicDir = path.resolve(opt('--public', path.join(repo, 'public')));

const slim = (r) => ({
  htmlHash: r.htmlHash, htmlLen: r.htmlLen, threw: r.threw || null, requests: r.requests, errors: r.errors, textHead: r.text.slice(0, 240),
});
function toGolden(result, meta) {
  const g = { meta, roles: {} };
  for (const role of ['admin', 'family', 'va']) {
    const o = result[role];
    g.roles[role] = {
      routes: Object.fromEntries(Object.entries(o.routes).map(([k, v]) => [k, slim(v)])),
      loginRequests: o.loginRequests, overflow: o.overflow, finalTaskCount: o.finalTaskCount,
      consoleErrors: [...new Set(o.consoleErrors)], pageErrors: [...new Set(o.pageErrors)], blockedExternal: [...new Set(o.blockedExternal)],
    };
  }
  return g;
}

if (cmd === 'baseline') {
  const out = path.resolve(opt('--out', GOLDEN));
  const result = await sweepAll(publicDir);
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'origin/main']).toString().trim();
  const g = toGolden(result, { sourceCommit: commit, recordedFrom: 'unmodified origin/main public/', fixture: 'synthetic (tests/preservation/fixtures.mjs)', clock: 'frozen 2026-10-05T14:00Z, UTC' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(g, null, 1));
  const n = Object.values(g.roles).reduce((a, r) => a + Object.keys(r.routes).length, 0);
  console.log(`baseline written: ${n} routes across 3 roles -> ${out}`);
} else if (cmd === 'verify') {
  const g = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
  // 1. FLAG OFF: every classic route, every role, must equal the golden recorded from unmodified code.
  const off = await sweepAll(publicDir, { flag: false });
  for (const role of ['admin', 'family', 'va']) {
    for (const [k, base] of Object.entries(g.roles[role].routes)) {
      const cur = off[role].routes[k];
      const same = cur && cur.htmlHash === base.htmlHash && (cur.threw || null) === base.threw && JSON.stringify([...new Set(cur.requests)].sort()) === JSON.stringify([...new Set(base.requests)].sort());
      check(`flag OFF · ${role} · ${k} identical to baseline`, same, same ? '' : `hash ${cur && cur.htmlHash} vs ${base.htmlHash}`);
    }
    const b = g.roles[role];
    const uniq = (a) => JSON.stringify([...new Set(a)].sort());
    check(`flag OFF · ${role} · login makes the same set of requests`, uniq(off[role].loginRequests) === uniq(b.loginRequests));
    check(`flag OFF · ${role} · final task count identical (${b.finalTaskCount})`, off[role].finalTaskCount === b.finalTaskCount);
    check(`flag OFF · ${role} · console/page errors identical`, JSON.stringify([...new Set(off[role].consoleErrors)]) === JSON.stringify(b.consoleErrors) && JSON.stringify([...new Set(off[role].pageErrors)]) === JSON.stringify(b.pageErrors));
  }
  check('flag OFF · shell.js is never requested (all three roles)', ['admin', 'family', 'va'].every((r) => off[r].statics.length > 0 && !off[r].statics.includes('/shell.js')));
  // 2. FLAG ON, Family and VA: unchanged for non-admin roles.
  const on = await sweepAll(publicDir, { flag: true });
  check('flag ON · shell.js is requested for every role (it stays inert for Family and VA)', ['admin', 'family', 'va'].every((r) => on[r].statics.includes('/shell.js')));
  for (const role of ['family', 'va']) {
    for (const [k, base] of Object.entries(g.roles[role].routes)) {
      const cur = on[role].routes[k];
      check(`flag ON · ${role} · ${k} identical to baseline`, cur && cur.htmlHash === base.htmlHash && (cur.threw || null) === base.threw, cur ? '' : 'missing');
    }
  }
  // 3. Shell checks (flag ON, admin).
  const shell = await runShellChecks(publicDir, g);
  shell.forEach((s) => { results.push(s); console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}${s.detail ? '  — ' + s.detail : ''}`); });
  const fails = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(here, 'last-report.json'), JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: fails.length, results }, null, 1));
  console.log(`\n${results.length} checks, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
} else {
  console.log('usage: run.mjs baseline|verify [--public DIR] [--out FILE]'); process.exit(2);
}
