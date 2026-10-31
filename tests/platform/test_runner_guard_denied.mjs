// The local runner guard must deny at least everything the server denies (ENG_DENIED_PATHS in api/ops.js),
// so a forbidden file is stopped before commit/push, not only when MMMOS checks the PR.
// Run: node tests/platform/test_runner_guard_denied.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const list = (src, name) => { const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(src); return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null; };
const server = list(readFileSync(join(root, 'api', 'ops.js'), 'utf8'), 'ENG_DENIED_PATHS');
const guard = list(readFileSync(join(root, 'tools', 'engineering-runner', 'runner-guard.mjs'), 'utf8'), 'DENIED');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
ok('server ENG_DENIED_PATHS found', Array.isArray(server) && server.length > 5);
ok('runner guard DENIED found', Array.isArray(guard) && guard.length > 5);
const missing = (server || []).filter(p => !(guard || []).includes(p));
ok('the runner guard denies every path the server denies', missing.length === 0, missing.join(', '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
