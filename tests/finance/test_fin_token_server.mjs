// Finance V2 phase 2A — the REAL Plaid handlers (exchange, remove, pull-for-item) executed with a fake Plaid and a fake database: encryption wiring, default-off behaviour, authentication,
// no token leakage (database writes, logs, responses, error messages), fail-closed configuration, safe disconnection, rotation. SYNTHETIC keys and tokens generated at run time. No network, no credentials.
//   node tests/finance/test_fin_token_server.mjs
import fs from 'node:fs'; import { randomBytes } from 'node:crypto';
import * as V from '../../lib/finCrypto.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 400) : ''); } };
const ops = fs.readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8');
const a0 = ops.indexOf('const _PLAID_ENV'), a1 = ops.indexOf('async function plaidPull(req, res) {');
const src = ops.slice(a0, a1).replace(/\/\/ ── fin-import:begin[\s\S]*?\/\/ ── fin-import:end[^\n]*\n/, '');   // the phase-3A import handlers sit inside this range; they are tested in test_fin_import_server.mjs
const key = () => randomBytes(32).toString('base64'); const K1 = key(), K2 = key();
const fakeToken = () => ['access', 'sandbox', randomBytes(10).toString('hex')].join('-');
const world = (env = {}, over = {}) => {
  const w = { db: new Map(), plaidCalls: [], dbCalls: [], logs: [], ceo: true, plaid: { exchange: null, remove: { status: 200, body: {} }, removeThrows: false, upsertStatus: null, ...over.plaid }, tokenFor: {} };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchStub = async (url, init = {}) => {
    const u = String(url), body = init.body ? JSON.parse(init.body) : null, method = init.method || 'GET';
    if (u.startsWith('https://sandbox.plaid.com')) { w.plaidCalls.push({ path: u.replace('https://sandbox.plaid.com', ''), body });
      if (u.endsWith('/item/public_token/exchange')) return json(200, w.plaid.exchange || { access_token: w.nextToken, item_id: w.nextItem });
      if (u.endsWith('/item/get')) return json(200, { item: { institution_id: 'ins_1', available_products: ['transactions'], billed_products: ['transactions'] } });
      if (u.endsWith('/institutions/get_by_id')) return json(200, { institution: { name: 'Test Bank' } });
      if (u.endsWith('/item/remove')) { if (w.plaid.removeThrows) throw new Error('network down'); return json(w.plaid.remove.status, w.plaid.remove.body); }
      return json(400, { error_code: 'NOT_SIMULATED' }); }
    if (u.startsWith('https://db.test/rest/v1/plaid_items')) { w.dbCalls.push({ method, url: u.replace('https://db.test', ''), body });
      if (method === 'POST') { if (w.plaid.upsertStatus) return json(w.plaid.upsertStatus, { code: '23505', message: 'duplicate key', details: `Failing row contains (${body.access_token}, ${body.item_id})` }); w.db.set(body.item_id, { ...body }); return json(201, [body]); }
      if (method === 'DELETE') { const id = decodeURIComponent(/item_id=eq\.([^&]+)/.exec(u)[1]); w.db.delete(id); return json(204, null); }
      if (method === 'GET') { const id = decodeURIComponent(/item_id=eq\.([^&]+)/.exec(u)?.[1] || ''); const row = w.db.get(id); return json(200, row ? [row] : []); }
      return json(200, []); }
    return json(404, {}); };
  const stubs = { fetch: fetchStub, requireCeoSession: async () => w.ceo, process: { env: { PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'cid-test', PLAID_SECRET_SANDBOX: 'sec-test', ...env } }, SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_KEY: 'svc-test',
    console: { log() {}, warn: (...a) => w.logs.push(a.join(' ')), error: (...a) => w.logs.push(a.join(' ')) }, _finVaultFromEnv: V.vaultFromEnv, _plaidAad: V.plaidAad, _planDisconnect: V.planDisconnect, _safeDbError: V.safeDbError };
  const names = Object.keys(stubs);
  const f = new Function(...names, src + '\nreturn { plaidExchange, plaidRemoveItem, plaidPullForItem, getVault: () => ({ _finVault, _finVaultErr }) };')(...names.map((k) => stubs[k]));
  const call = (fn) => async (reqOver = {}) => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(x) { res.body = x; return res; } }; let threw = null; try { await fn({ method: 'POST', body: {}, query: {}, headers: {}, ...reqOver }, res); } catch (e) { threw = e; } return { res, threw }; };
  w.exchange = call(f.plaidExchange); w.remove = call(f.plaidRemoveItem); w.pull = (item) => f.plaidPullForItem(item); w.f = f;
  return w;
};
const connect = async (w, itemId = 'item-A') => { w.nextToken = fakeToken(); w.nextItem = itemId; const r = await w.exchange({ body: { public_token: 'public-sandbox-xyz', metadata: {} } }); return { token: w.nextToken, r }; };
const everything = (w) => JSON.stringify([w.db.get('item-A'), w.dbCalls, w.logs]);

// 1. DEFAULT OFF — production today: no keys configured → behaviour unchanged
{ const w = world(); const { token, r } = await connect(w);
  ok('DEFAULT OFF (no keys): the stored credential is exactly what it was before this change (plaintext column), the response carries no token, and encryption is reported "not configured"', r.res.code === 200 && w.db.get('item-A').access_token === token && !JSON.stringify(r.res.body).includes(token) && w.f.getVault()._finVault.configured === false);
  const rr = await w.pull({ ...w.db.get('item-A') });
  ok('DEFAULT OFF: pulling an item sends the stored token to Plaid exactly as before', w.plaidCalls.some((c) => c.path === '/accounts/balance/get' && c.body.access_token === token) && rr.item_id === 'item-A'); }

// 2. ENCRYPTION ON
{ const w = world({ FIN_TOKEN_KEYS: `k1:${K1}` }); const { token, r } = await connect(w);
  const stored = w.db.get('item-A').access_token;
  ok('ENCRYPTION ON: the database receives a SEALED value (enc:v1:k1:…), never the plaintext token', r.res.code === 200 && stored.startsWith('enc:v1:k1:') && !stored.includes(token));
  ok('NO LEAK: the token appears nowhere in database writes, logs or the response (checked across every database call, log line and the exchange response)', !everything(w).includes(token) && !JSON.stringify(r.res.body).includes(token), { response: r.res.body });
  const sawPlaid = w.plaidCalls.filter((c) => c.body && c.body.access_token).every((c) => c.body.access_token === token);
  ok('the plaintext token goes ONLY to the provider (Plaid calls during the exchange carry the real token)', sawPlaid && w.plaidCalls.some((c) => c.path === '/item/get'));
  w.plaidCalls.length = 0; const pr = await w.pull({ ...w.db.get('item-A') });
  ok('PULL opens the sealed credential inside the server and calls Plaid with the real token; the pull result carries no token', w.plaidCalls.some((c) => c.path === '/accounts/balance/get' && c.body.access_token === token) && !JSON.stringify(pr).includes(token) && !JSON.stringify(pr).includes('enc:v1'));
  // record binding: swap sealed credentials between two items
  const { token: tokenB } = await connect(w, 'item-B'); const rowA = { ...w.db.get('item-A') }, rowB = { ...w.db.get('item-B') };
  w.plaidCalls.length = 0; const swapped = await w.pull({ ...rowA, access_token: rowB.access_token });
  ok('RECORD BINDING: item A\'s row holding item B\'s ciphertext cannot be opened (token_unreadable: auth_failed), and NO provider call is made with a wrong token', /token_unreadable: auth_failed/.test(swapped.error) && w.plaidCalls.length === 0 && !JSON.stringify(swapped).includes(tokenB)); }

// 3. FAIL CLOSED configuration
{ const w = world({ FIN_REQUIRE_ENCRYPTION: '1' }); w.nextToken = fakeToken(); w.nextItem = 'item-A'; const { res } = await w.exchange({ body: { public_token: 'p' } });
  ok('REQUIRE-ENCRYPTION without keys: the exchange is refused with token_encryption_not_configured BEFORE any Plaid call (no orphan item) and nothing is stored', res.code === 500 && res.body.error === 'token_encryption_not_configured' && w.plaidCalls.length === 0 && w.db.size === 0); }
{ const w = world({ FIN_TOKEN_KEYS: 'k1:not-a-valid-key' }); w.nextToken = fakeToken(); w.nextItem = 'item-A'; const { res } = await w.exchange({ body: { public_token: 'p' } });
  ok('a MISCONFIGURED key fails closed: token_encryption_misconfigured, no Plaid call, nothing stored', res.code === 500 && res.body.error === 'token_encryption_misconfigured' && w.plaidCalls.length === 0 && w.db.size === 0); }
{ const w = world({ FIN_TOKEN_KEYS: `k1:${K1}`, FIN_REQUIRE_ENCRYPTION: '1' }); const row = { item_id: 'item-A', institution_name: 'x', access_token: fakeToken() }; const rr = await w.pull(row);
  ok('REQUIRE-ENCRYPTION also refuses to USE a legacy plaintext credential (token_unreadable: plaintext_refused) and calls no provider', /plaintext_refused/.test(rr.error) && w.plaidCalls.length === 0); }

// 4. AUTHENTICATION
{ const w = world({ FIN_TOKEN_KEYS: `k1:${K1}` }); w.ceo = false; w.nextToken = fakeToken(); w.nextItem = 'item-A';
  const a = await w.exchange({ body: { public_token: 'p' } }), b = await w.remove({ body: { item_id: 'item-A' } });
  ok('AUTH: exchange and remove without a CEO session return 401 and make NO provider or database call', a.res.code === 401 && b.res.code === 401 && w.plaidCalls.length === 0 && w.dbCalls.length === 0); }

// 5. error echo
{ const w = world({ FIN_TOKEN_KEYS: `k1:${K1}` }, { plaid: { upsertStatus: 409 } }); const { token, threw } = await (async () => { w.nextToken = fakeToken(); w.nextItem = 'item-A'; const t = w.nextToken; const out = await w.exchange({ body: { public_token: 'p' } }); return { token: t, threw: out.threw }; })();
  ok('A DATABASE ERROR that echoes the failing row cannot leak the credential: the thrown message holds only status and code', threw && /plaid_items upsert failed \(HTTP 409, 23505\)/.test(threw.message) && !threw.message.includes(token) && !threw.message.includes('enc:v1') && !everything(w).includes(token), threw && threw.message); }

// 6. SAFE DISCONNECTION
{ const mk = async (over, env = { FIN_TOKEN_KEYS: `k1:${K1}` }) => { const w = world(env, over); const { token } = await connect(w); w.plaidCalls.length = 0; w.dbCalls.length = 0; return { w, token }; };
  { const { w, token } = await mk({}); const { res } = await w.remove({ body: { item_id: 'item-A' } });
    ok('DISCONNECT (provider confirms): Plaid /item/remove is called with the real token FIRST, then the row is deleted', res.body.removed === true && res.body.status === 'revoked' && w.plaidCalls[0].path === '/item/remove' && w.plaidCalls[0].body.access_token === token && w.dbCalls.some((c) => c.method === 'DELETE') && w.db.size === 0); }
  { const { w } = await mk({ plaid: { remove: { status: 503, body: { error_code: 'INTERNAL_SERVER_ERROR' } } } }); const { res } = await w.remove({ body: { item_id: 'item-A' } });
    ok('DISCONNECT (provider 5xx): the row is KEPT (revoke_pending, HTTP 502) — a live token is never orphaned — and nothing is deleted', res.code === 502 && res.body.removed === false && res.body.status === 'revoke_pending' && w.db.size === 1 && !w.dbCalls.some((c) => c.method === 'DELETE')); }
  { const { w } = await mk({ plaid: { removeThrows: true } }); const { res } = await w.remove({ body: { item_id: 'item-A' } });
    ok('DISCONNECT (network error): the row is kept (revoke_pending)', res.code === 502 && res.body.status === 'revoke_pending' && w.db.size === 1); }
  { const { w } = await mk({ plaid: { remove: { status: 400, body: { error_code: 'INVALID_ACCESS_TOKEN' } } } }); const { res } = await w.remove({ body: { item_id: 'item-A' } });
    ok('DISCONNECT (token already dead at the provider, e.g. a stale sandbox token): the row is deleted (already_inactive) — the old "stale token row" case still clears', res.body.removed === true && res.body.status === 'already_inactive' && w.db.size === 0); }
  { const { w } = await mk({}); const row = w.db.get('item-A'); w.db.set('item-A', { ...row, access_token: row.access_token.slice(0, -6) + 'AAAAAA' }); const { res } = await w.remove({ body: { item_id: 'item-A' } });
    ok('DISCONNECT (credential unreadable = decryption failure): HTTP 409 needs_manual_revoke, NO provider call, row kept (never silently deleted)', res.code === 409 && res.body.status === 'needs_manual_revoke' && w.plaidCalls.length === 0 && w.db.size === 1);
    w.plaidCalls.length = 0; const f = await w.remove({ body: { item_id: 'item-A', force: true } });
    ok('…and only an explicit force deletes it, with a warning to revoke at the provider', f.res.body.removed === true && f.res.body.status === 'deleted_unrevoked' && /revoke it in the provider dashboard/.test(f.res.body.warn) && w.db.size === 0); }
  { const w = world({}); const { res } = await w.remove({ body: { item_id: 'nope' } });
    ok('DISCONNECT of an item that is not stored just succeeds (nothing to revoke)', res.body.removed === true); }
  { const { w, token } = await mk({}, {}); const { res } = await w.remove({ body: { item_id: 'item-A' } });
    ok('DISCONNECT with encryption OFF (legacy plaintext) still revokes with the stored token and deletes', res.body.removed === true && w.plaidCalls[0].body.access_token === token); } }

// 7. ROTATION through the real handlers
{ const w1 = world({ FIN_TOKEN_KEYS: `k1:${K1}` }); const { token } = await connect(w1); const sealedK1 = w1.db.get('item-A').access_token;
  const w2 = world({ FIN_TOKEN_KEYS: `k2:${K2},k1:${K1}` }); const r2 = await w2.pull({ item_id: 'item-A', institution_name: 'x', access_token: sealedK1 });
  ok('ROTATION: after a new current key is added (old key kept) the existing sealed credential still works in the server', w2.plaidCalls.some((c) => c.path === '/accounts/balance/get' && c.body.access_token === token) && !r2.error?.includes('token_unreadable'));
  const re = w2.f.getVault()._finVault.rewrap(sealedK1, V.plaidAad('item-A'));
  const w3 = world({ FIN_TOKEN_KEYS: `k2:${K2}` }); const okPull = await w3.pull({ item_id: 'item-A', institution_name: 'x', access_token: re }); const oldPull = await w3.pull({ item_id: 'item-A', institution_name: 'x', access_token: sealedK1 });
  ok('after the old key is RETIRED the rewrapped credential works and the old one reports token_unreadable: unknown_key (decryption failure is explicit and leaks nothing)', w3.plaidCalls.some((c) => c.body && c.body.access_token === token) && /token_unreadable: unknown_key/.test(oldPull.error) && !JSON.stringify(oldPull).includes(token)); }

// 8. static review
ok('no real credential, key or token is embedded in the changed code or tests (keys and tokens are generated at run time; the library reads keys only from the environment string passed in)', !/access-(production|sandbox|development)-[0-9a-f]{12,}/.test(ops) && !/FIN_TOKEN_KEYS\s*=\s*['"][^'"]{20,}/.test(ops));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
