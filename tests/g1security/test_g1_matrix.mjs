// G1 / S-A — security matrix for the actions closed by G1: youtube_analytics_pull and youtube_snapshot_now (CEO session only) and analytics_auto_run (cron signature OR CEO session).
// Every HTTP method × every credential location × forged / malformed / wrong-subject / expired / unsigned credentials. A refused request must perform NO Google call and NO database write.
// The REAL api/ops.js of this branch runs against a fake world (no network, nothing written). SYNTHETIC keys. node tests/g1security/test_g1_matrix.mjs
import { createHmac } from 'node:crypto';
import { world, resetWorld, loadPair, cleanup, reporter, mkRes, SECRET, signCeo } from '../g0safety/world.mjs';
import { cronSignature } from '../../lib/cronAuth.mjs';
const { check, done } = reporter(); const KEY = 'svc-test';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const sign = (payload, secret = SECRET) => `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`; const now = Date.now();
const TOKENS = {
  'operator-subject signed with the CEO secret': sign(b64({ sub: 'operator', exp: now + 3600e3 })), 'family-subject signed with the CEO secret': sign(b64({ sub: 'family', exp: now + 3600e3 })), 'no subject': sign(b64({ exp: now + 3600e3 })), 'no expiry': sign(b64({ sub: 'ceo' })),
  'expired (correctly signed)': sign(b64({ sub: 'ceo', exp: now - 1000 })), 'signed with another secret': sign(b64({ sub: 'ceo', exp: now + 3600e3 }), 'some-other-secret'),
  'payload tampered after signing': (() => { const [, s] = sign(b64({ sub: 'ceo', exp: now + 1000 })).split('.'); return b64({ sub: 'ceo', exp: now + 9e12 }) + '.' + s; })(), 'empty signature': b64({ sub: 'ceo', exp: now + 3600e3 }) + '.', 'three segments': signCeo() + '.extra',
  'arbitrary string': 'let-me-in', 'empty string': '', 'very long string': 'a'.repeat(100000) + '.' + 'b'.repeat(100000), number: 12345, boolean: true, 'array holding the valid token': [signCeo()], object: { sub: 'ceo' },
  'the cron signature (wrong credential type)': cronSignature('analytics_auto_run', KEY),
};
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
try {
  const { cur } = await loadPair('ops.js', '7d3f81a');
  const raw = async ({ action, method, where, value, extraQuery = {} }) => {
    resetWorld(); world.connections = [{ channel_id: 'UC_A', refresh_token: 'RT_A', scope: 'yt-analytics.readonly', status: 'connected' }];
    const res = mkRes(); const headers = { origin: 'https://mmm-static.vercel.app' }; const query = { action, ...extraQuery }; let body = null;
    if (where === 'ceo-header') headers['x-mmm-ceo-session'] = value; if (where === 'cron-header') headers['x-mmm-cron'] = value; if (where === 'query') query.ceo_session_token = value; if (where === 'body') body = { ceo_session_token: value }; if (method === 'POST' && body === null) body = {};
    try { await cur.default({ method, query, headers, body }, res); } catch (e) { return { code: 'THROW:' + e.message, writes: world.writes.length, google: world.google.length }; }
    return { code: res.code, body: res.body, writes: world.writes.length, google: world.google.length };
  };
  const refused = (r, err) => r.code === 401 && r.body && r.body.error === err && r.writes === 0 && r.google === 0;
  /* CEO-only twins */
  for (const action of ['youtube_analytics_pull', 'youtube_snapshot_now']) {
    let n = 0; const bad = [];
    for (const method of METHODS) for (const where of ['ceo-header', 'body', 'query']) for (const [name, value] of Object.entries(TOKENS)) { n++; const r = await raw({ action, method, where, value }); if (!refused(r, 'ceo_authorization_required')) bad.push(`${method} ${where} "${name}" → ${r.code}`); }
    for (const method of METHODS) { n++; const r = await raw({ action, method, where: 'none' }); if (!refused(r, 'ceo_authorization_required')) bad.push(`${method} no credential → ${r.code}`); }
    for (const method of METHODS) { n++; const r = await raw({ action, method, where: 'cron-header', value: cronSignature('analytics_auto_run', KEY) }); if (!refused(r, 'ceo_authorization_required')) bad.push(`${method} cron signature → ${r.code}`); }
    check(`${action}: ${n} invalid requests (${Object.keys(TOKENS).length} credential kinds × 3 locations × 6 methods + none + cron signature) all refused 401, ZERO Google calls, ZERO writes`, bad.length === 0, bad.slice(0, 3).join(' ; '));
    let ok = 0, wrong = [];
    for (const method of METHODS) for (const where of ['ceo-header', 'body', 'query']) { const r = await raw({ action, method, where, value: signCeo() }); const accepted = r.code !== 401; const expected = where === 'ceo-header' || (where === 'body' && method === 'POST') || (where === 'query' && method !== 'POST'); if (accepted === expected) ok++; else wrong.push(`${method} ${where} accepted=${accepted}`); }
    check(`${action}: a valid session is accepted via the header for every method, via the body only for POST and via the query only for the other methods (18 requests)`, wrong.length === 0, wrong.join(' ; ')); }
  /* analytics_auto_run: signature OR CEO session */
  { let n = 0; const bad = []; const sigGood = cronSignature('analytics_auto_run', KEY);
    const SIGS = { 'wrong scope': cronSignature('sync', KEY), forged: 'f'.repeat(64), truncated: sigGood.slice(0, 63), extended: sigGood + 'a', 'upper-case': sigGood.toUpperCase(), empty: '', number: 7, 'array': [sigGood, sigGood], 'service key itself': KEY, 'plain hash of the key': 'e'.repeat(64) };
    for (const method of METHODS) for (const [name, value] of Object.entries(SIGS)) { n++; const r = await raw({ action: 'analytics_auto_run', method, where: 'cron-header', value }); if (!refused(r, 'cron_signature_required')) bad.push(`${method} signature ${name} → ${r.code}`); }
    for (const method of METHODS) for (const where of ['ceo-header', 'body', 'query']) for (const [name, value] of Object.entries(TOKENS)) { if (name.startsWith('the cron signature')) continue; n++; const r = await raw({ action: 'analytics_auto_run', method, where, value }); if (!refused(r, 'cron_signature_required')) bad.push(`${method} ${where} "${name}" → ${r.code}`); }
    for (const method of METHODS) { n++; const r = await raw({ action: 'analytics_auto_run', method, where: 'none' }); if (!refused(r, 'cron_signature_required')) bad.push(`${method} no credential → ${r.code}`); }
    check(`analytics_auto_run: ${n} invalid requests all refused 401, ZERO Google calls, ZERO writes`, bad.length === 0, bad.slice(0, 3).join(' ; '));
    const accepted = []; for (const method of METHODS) { const r = await raw({ action: 'analytics_auto_run', method, where: 'cron-header', value: sigGood }); accepted.push(r.code !== 401); }
    check('analytics_auto_run: the correct signature is accepted for every method (the cron uses GET)', accepted.every(Boolean));
    const ceoAcc = []; for (const method of METHODS) { const r = await raw({ action: 'analytics_auto_run', method, where: 'ceo-header', value: signCeo() }); ceoAcc.push(r.code !== 401); }
    check('analytics_auto_run: a valid CEO session in the header is accepted for every method', ceoAcc.every(Boolean)); }
  /* the cron signature uses the SERVICE KEY: with the key unset on the server nothing is accepted */
  { resetWorld(); const saved = process.env.SUPABASE_SERVICE_KEY; const { cur: c2 } = await loadPair('ops.js', '7d3f81a'); /* module already holds the key; verify the pure function instead */
    const { verifyCronSignature } = await import('../../lib/cronAuth.mjs'); check('with no service key configured the signature check refuses everything (fails closed)', verifyCronSignature({ 'x-mmm-cron': cronSignature('analytics_auto_run', KEY) }, 'analytics_auto_run', '') === false); process.env.SUPABASE_SERVICE_KEY = saved; }
} finally { cleanup(); }
process.exit(done() ? 1 : 0);
