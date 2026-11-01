// Order 046 - proves the preview-secret stage 1 plan against the REAL Plaid selection code in api/ops.js.
// No secret values are used; the variables are dummy markers. Usage: node check-plaid-selection.mjs <path to api/ops.js>
import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[2] || 'api/ops.js', 'utf8');
const a = src.indexOf('const _PLAID_ENV'), b = src.indexOf('process.env.PLAID_SECRET_DEV', a);
const code = src.slice(a, src.indexOf(';', b) + 1);
const run = (env) => new Function('process', code + '; return { base: PLAID_BASE, secret: PLAID_SECRET, mode: _PLAID_ENV };')({ env });
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
const prod = run({ PLAID_ENV: 'production', PLAID_SECRET: 'LIVE', PLAID_SECRET_SANDBOX: 'SBX' });
ok('production (unchanged by stage 1): live secret and production API', prod.secret === 'LIVE' && prod.base === 'https://production.plaid.com');
const prevNow = run({ PLAID_ENV: 'production', PLAID_SECRET: 'LIVE', PLAID_SECRET_SANDBOX: 'SBX' });
ok('preview TODAY gets the live secret (the exposure stage 1 removes)', prevNow.secret === 'LIVE');
const prevAfter = run({ PLAID_ENV: 'sandbox', PLAID_SECRET_SANDBOX: 'SBX' });
ok('preview AFTER stage 1: sandbox secret and sandbox API, no live secret present', prevAfter.secret === 'SBX' && prevAfter.base === 'https://sandbox.plaid.com');
const prevSafe = run({ PLAID_ENV: 'sandbox' });
ok('if the sandbox secret were missing in preview, nothing live is used (secret undefined)', prevSafe.secret === undefined);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
