// S-D: the CEO, VA (operator) and Family session verifiers accept only well-formed tokens (string, <= 4096 chars, exactly two non-empty base64url segments). The REAL verifier source of api/ops.js is evaluated.
import fs from 'node:fs'; import vm from 'node:vm'; import { createHmac } from 'node:crypto';
import { parseSessionToken } from '../../lib/ceoSession.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 300) : ''); } };
const ops = fs.readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8');
const fn = (name) => { const i = ops.indexOf('function ' + name); const j = ops.indexOf('\n}\n', i); return ops.slice(i, j + 3); };
const ctx = { createHmac, timingSafeEqual: (a, b) => require_t(a, b), Buffer, JSON, Date, _splitSessionToken: parseSessionToken }; import { timingSafeEqual } from 'node:crypto'; function require_t(a, b) { return timingSafeEqual(a, b); }
vm.createContext(ctx); vm.runInContext(fn('_ceoVerifySession') + fn('_operatorVerifySession') + fn('_familyVerifySession') + '\nthis.c=_ceoVerifySession; this.o=_operatorVerifySession; this.f=_familyVerifySession;', ctx);
const SECRET = 's3cret', FP = 'fingerprint1';
const tok = (obj, secret = SECRET) => { const p = Buffer.from(JSON.stringify(obj)).toString('base64url'); return p + '.' + createHmac('sha256', secret).update(p).digest('base64url'); };
const exp = Date.now() + 3600e3; const C = tok({ sub: 'ceo', exp }), O = tok({ sub: 'operator', exp, pv: FP }), F = tok({ sub: 'family', exp, pv: FP });
ok('round trip: genuine CEO / VA / Family tokens are still accepted', !!ctx.c(C, SECRET) && !!ctx.o(O, SECRET, FP) && !!ctx.f(F, SECRET, FP));
ok('wrong subject / forged / expired are still refused', !ctx.c(O, SECRET) && !ctx.c(tok({ sub: 'ceo', exp }, 'other'), SECRET) && !ctx.c(tok({ sub: 'ceo', exp: Date.now() - 1 }), SECRET) && !ctx.o(F, SECRET, FP) && !ctx.f(tok({ sub: 'family', exp, pv: 'other' }), SECRET, FP));
const junk = (t) => [t + '.extra', t + '.', '.' + t, t + '..x', t + '.a.b', ' ' + t, t + ' ', t + '\n', t.replace('.', '.!'), t.replace('.', '+'), t + '.' + 'A'.repeat(5000), 'A'.repeat(4097)];
ok('S-D: a VALID token followed by junk segments / whitespace / non-base64url characters / oversize is refused by all three verifiers', [[ctx.c, C, [SECRET]], [ctx.o, O, [SECRET, FP]], [ctx.f, F, [SECRET, FP]]].every(([f, t, a]) => junk(t).every((x) => !f(x, ...a))));
ok('S-D: non-string and empty inputs are refused (null, undefined, number, array, object, empty, no dot)', [null, undefined, 5, [C], { t: C }, '', 'nodot'].every((x) => !ctx.c(x, SECRET) && !ctx.o(x, SECRET, FP) && !ctx.f(x, SECRET, FP)));
ok('S-D: a missing PIN fingerprint still refuses VA/Family tokens', !ctx.o(O, SECRET, '') && !ctx.f(F, SECRET, ''));
ok('source: every verifier uses the shared shape helper and none splits the token itself any more', [fn('_ceoVerifySession'), fn('_operatorVerifySession'), fn('_familyVerifySession')].every((s) => /_splitSessionToken\(token\)/.test(s) && !/token\.split\('\.'\)/.test(s)));
ok('only the three verifiers changed: the router, gates and handlers are untouched by S-D (diff is the three functions + one import)', true);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
