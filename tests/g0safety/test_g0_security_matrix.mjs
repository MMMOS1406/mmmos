// G0 / C5 — security matrix for the three mutating optimization actions: every HTTP method × every token location × forged / malformed / wrong-subject / expired / unsigned tokens.
// A request is "accepted" only when it reaches the handler (anything other than 401 ceo_authorization_required). A refused request must perform NO database write and NO optimization-table read.
// The REAL api/ops.js of this branch runs against a fake world (no network, nothing written). SYNTHETIC secret. node tests/g0safety/test_g0_security_matrix.mjs
import { createHmac } from 'node:crypto';
import { world, resetWorld, loadPair, cleanup, reporter, mkRes, SECRET, signCeo } from './world.mjs';
const { check, done } = reporter();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const sign = (payload, secret = SECRET) => `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
const now = Date.now();
const TOKENS = {
  valid: signCeo(),
  'operator-subject signed with the CEO secret': sign(b64({ sub: 'operator', exp: now + 3600e3 })),
  'family-subject signed with the CEO secret': sign(b64({ sub: 'family', exp: now + 3600e3 })),
  'no subject': sign(b64({ exp: now + 3600e3 })),
  'no expiry': sign(b64({ sub: 'ceo' })),
  'expired (correctly signed)': sign(b64({ sub: 'ceo', exp: now - 1000 })),
  'signed with another secret': sign(b64({ sub: 'ceo', exp: now + 3600e3 }), 'some-other-secret'),
  'payload tampered after signing (expiry extended)': (() => { const [, s] = sign(b64({ sub: 'ceo', exp: now + 1000 })).split('.'); return b64({ sub: 'ceo', exp: now + 9e12 }) + '.' + s; })(),
  'empty signature': b64({ sub: 'ceo', exp: now + 3600e3 }) + '.',
  'empty payload': '.' + 'abc',
  'three segments': signCeo() + '.extra',
  'unsigned "none" style': b64({ alg: 'none' }) + '.' + b64({ sub: 'ceo', exp: now + 3600e3 }) + '.',
  'arbitrary string': 'let-me-in',
  'empty string': '',
  'very long string': 'a'.repeat(100000) + '.' + 'b'.repeat(100000),
  'number': 12345, 'boolean': true, 'array of the valid token': [signCeo()], 'object': { sub: 'ceo' },
};
const ACTIONS = ['optimization_apply_recs', 'optimization_toggle_auto', 'strategy_recompute'];
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
try {
  const { cur } = await loadPair('ops.js');
  const raw = async ({ action, method, tokenIn, token, extraQuery = {} }) => {
    resetWorld(); const res = mkRes(); const headers = { origin: 'https://mmm-static.vercel.app' }; const query = { action, engine: 'SRV Farsi', enabled: 'false', ...extraQuery }; let body = null;
    if (tokenIn === 'header') headers['x-mmm-ceo-session'] = token; if (tokenIn === 'query') query.ceo_session_token = token; if (tokenIn === 'body') body = { ceo_session_token: token }; if (method === 'POST' && body === null) body = {};
    try { await cur.default({ method, query, headers, body }, res); } catch (e) { return { code: 'THROW:' + e.message, body: null, writes: world.writes.length, optReads: world.reads.filter((x) => /^optimization_|^channel_strategy/.test(x)).length }; }
    return { code: res.code, body: res.body, writes: world.writes.length, optReads: world.reads.filter((x) => /^optimization_|^channel_strategy/.test(x)).length };
  };
  const refused = (r) => r.code === 401 && r.body && r.body.error === 'ceo_authorization_required' && r.writes === 0 && r.optReads === 0;
  let combos = 0, bad = [];
  for (const action of ACTIONS) for (const method of METHODS) for (const tokenIn of ['header', 'body', 'query']) for (const [name, token] of Object.entries(TOKENS)) {
    if (name === 'valid') continue; combos++; const r = await raw({ action, method, tokenIn, token }); if (!refused(r)) bad.push(`${action} ${method} ${tokenIn} "${name}" → ${JSON.stringify(r.code)}`);
  }
  check(`every invalid token (${Object.keys(TOKENS).length - 1} kinds) × 3 locations × 6 methods × 3 actions = ${combos} requests is refused 401 with NO write and NO optimization read`, bad.length === 0, bad.slice(0, 4).join(' ; '));
  /* no token at all */
  { let b2 = []; for (const action of ACTIONS) for (const method of METHODS) { const r = await raw({ action, method, tokenIn: 'none' }); if (!refused(r)) b2.push(`${action} ${method}`); } check('no token at all: refused for every method and action (18 requests)', b2.length === 0, b2.join(',')); }
  /* the valid token is honoured only where the server reads it */
  { const ok = [], notOk = [];
    for (const action of ACTIONS) for (const method of METHODS) {
      const readsBody = method === 'POST';   // requireCeoSession reads the body for POST and the query otherwise; the header works for every method
      for (const tokenIn of ['header', 'body', 'query']) { const r = await raw({ action, method, tokenIn, token: TOKENS.valid }); const accepted = !(r.code === 401); const expected = tokenIn === 'header' || (tokenIn === 'body' && readsBody) || (tokenIn === 'query' && !readsBody);
        (accepted === expected ? ok : notOk).push(`${action} ${method} ${tokenIn} accepted=${accepted} expected=${expected} code=${r.code}`); } }
    check('a valid session is accepted via the header for every method, via the body only for POST and via the query only for non-POST — and never anywhere else (54 requests)', notOk.length === 0, notOk.slice(0, 3).join(' ; ')); }
  /* a refused request has a safe, uniform answer (no hint about why) */
  { const a = await raw({ action: ACTIONS[0], method: 'GET', tokenIn: 'header', token: TOKENS['signed with another secret'] }), b = await raw({ action: ACTIONS[0], method: 'GET', tokenIn: 'none' });
    check('the refusal text is identical for a forged token and for no token (no oracle)', JSON.stringify(a.body) === JSON.stringify(b.body)); }
  /* OPTIONS (CORS preflight) does nothing */
  { for (const action of ACTIONS) { const r = await raw({ action, method: 'OPTIONS', tokenIn: 'none' }); check(`OPTIONS ${action}: answers the preflight and performs no write/read`, r.code === 200 && r.writes === 0 && r.optReads === 0); } }
  /* action-name tricks cannot reach a handler */
  { const tricks = [['array', ['optimization_toggle_auto', 'x']], ['upper-case', 'OPTIMIZATION_TOGGLE_AUTO'], ['trailing space', 'optimization_toggle_auto '], ['leading space', ' optimization_toggle_auto'], ['encoded slash', 'optimization_toggle_auto/'], ['null byte', 'optimization_toggle_auto\u0000'], ['array of the real name', ['optimization_toggle_auto']]];
    for (const [n, action] of tricks) { resetWorld(); const res = mkRes(); try { await cur.default({ method: 'GET', query: { action, engine: 'SRV Farsi', enabled: 'true' }, headers: {}, body: null }, res); } catch (_) {}
      check(`action spelled as ${n}: no handler runs — no database write, auto_apply unchanged`, world.writes.length === 0 && world.settings.every((s) => s.auto_apply === false)); } }
  /* session secret is read from the server configuration, never from the request */
  { const r = await raw({ action: ACTIONS[1], method: 'GET', tokenIn: 'header', token: TOKENS.valid, extraQuery: { sessionSecret: 'x', secret: SECRET, ceo_session_secret_production: SECRET } });
    check('a valid token still works and a secret passed in the query is not used to verify anything', r.code === 200); }
  { resetWorld(); const res = mkRes(); await cur.default({ method: 'GET', query: { action: ACTIONS[1], engine: 'SRV Farsi', enabled: 'true', ceo_session_token: sign(b64({ sub: 'ceo', exp: now + 3600e3 }), 'query-supplied-secret'), ceo_session_secret_production: 'query-supplied-secret' }, headers: {}, body: null }, res);
    check('a token signed with a secret supplied BY THE CALLER is refused (verification uses the server-held secret)', res.code === 401 && world.writes.length === 0); }
  /* CORS: the refusal does not widen anything */
  check('the gate runs before routing, so no mutating handler is reachable without a verified session (static: gate precedes the first handler dispatch)', (await import('node:fs')).readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8').indexOf('CEO_ONLY_MUTATING_ACTIONS.has(action)') < (await import('node:fs')).readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8').indexOf("if (action === 'optimization_apply_recs')"));
} finally { cleanup(); }
process.exit(done() ? 1 : 0);
