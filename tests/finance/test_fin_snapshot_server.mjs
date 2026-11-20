// Finance V2 phase 3C — the REAL fin_snapshot_* handlers (extracted from api/ops.js) with a fake database: CEO-only, validation, one-row write, preservation of other Finance rows, compare-and-set, no figures in logs. SYNTHETIC data only.
//   node tests/finance/test_fin_snapshot_server.mjs
import fs from 'node:fs'; import { createHash } from 'node:crypto';
import * as S from '../../lib/finSnapshot.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 400) : ''); } };
const ops = fs.readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8');
const a0 = ops.indexOf('// ── fin-snapshot:begin'), a1 = ops.indexOf('// ── fin-snapshot:end'); if (a0 < 0 || a1 < 0) { console.log('FAIL markers'); process.exit(1); }
const SRC = ops.slice(a0, a1); const CODE = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); const C = S.SNAP_CONFIRMATION;
const MAGIC = 987654321;   // a unique typed figure that must never reach a log
const def = { assets_include_investments: 'yes_manual', liabilities_include_credit_cards: 'no' };
const body = (o = {}) => ({ as_of: day(1), figures: { net_worth: -50000, assets: 300000, liabilities: 350000, cash: 120000, savings: 10000, debt: 360000 }, definition: def, confirmation: C, ...o });
const world = (over = {}) => {
  const w = { db: new Map(over.seed || []), reads: [], writes: [], urls: [], logs: [], ceo: true, race: false, writeFail: false };
  const sbGet = async (path) => { w.reads.push(path); const key = /key=eq\.([^&]+)/.exec(path)[1]; const r = w.db.get(key); return r ? [{ value: r.value, updated_at: r.updated_at }] : []; };
  const json = (status, b) => ({ ok: status >= 200 && status < 300, status, json: async () => b, text: async () => JSON.stringify(b) });
  let tick = 0; const stamp = () => `2031-06-15T12:00:${String(++tick).padStart(2, '0')}.000000+00:00`;
  const fetchStub = async (url, init = {}) => { const u = String(url), method = init.method || 'GET', b = init.body ? JSON.parse(init.body) : null; w.urls.push(method + ' ' + u); w.writes.push({ method, url: u, body: b });
    if (w.writeFail) return json(500, { message: 'boom', details: b && b.value });
    if (method === 'POST') { if (w.db.has(b.key)) return json(409, {}); const row = { value: b.value, updated_at: stamp() }; w.db.set(b.key, row); return json(201, [row]); }
    if (method === 'PATCH') { const key = /key=eq\.([^&]+)/.exec(u)[1]; const row = w.db.get(key); if (w.race) { row.updated_at = stamp(); w.race = false; } const m = /updated_at=(eq\.|is\.)([^&]*)/.exec(u); const want = m && m[1] === 'eq.' ? decodeURIComponent(m[2]) : null; if (!row || (m && m[1] === 'eq.' && row.updated_at !== want)) return json(200, []); row.value = b.value; row.updated_at = stamp(); return json(200, [row]); }
    return json(404, {}); };
  const stubs = { _finSnap: S, sbGet, fetch: fetchStub, requireCeoSession: async () => w.ceo, SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_KEY: 'svc-test', createHash, console: { log() {}, warn: (...a) => w.logs.push(a.join(' ')), error: (...a) => w.logs.push(a.join(' ')) }, _safeDbError: (t, op, st) => `db ${t} ${op} ${st}` };
  const names = Object.keys(stubs); const f = new Function(...names, (over.src || SRC) + '\nreturn { finSnapshot };')(...names.map((k) => stubs[k]));
  const call = (op) => async (reqOver = {}) => { const res = { code: 200, body: null, headers: {}, status(c) { res.code = c; return res; }, json(x) { res.body = x; return res; }, setHeader(k, v) { res.headers[k] = v; } }; await f.finSnapshot({ method: 'POST', body: {}, query: {}, headers: {}, ...reqOver }, res, op); return res; };
  w.status = call('status'); w.commit = call('commit'); return w;
};
const everything = (w) => JSON.stringify([w.writes, w.logs, w.urls]);
// 1. authentication, before any database access
for (const op of ['status', 'commit']) { const w = world(); w.ceo = false; const r = await w[op]({ body: body() }); ok(`${op}: no CEO session → 401 and NO database read or write`, r.code === 401 && w.reads.length === 0 && w.writes.length === 0); }
{ const w = world(); const r = await w.status({ method: 'GET' }); ok('GET is refused (405) with no database access', r.code === 405 && w.reads.length === 0); }
// 2. status with nothing stored
{ const w = world(); const r = await w.status(); ok('status with no snapshot: has_data false, rules published (35 / 120 days), no-store, nothing invented', r.code === 200 && r.body.has_data === false && r.body.latest === null && r.body.rules.fresh_days === 35 && r.body.rules.expire_days === 120 && r.headers['Cache-Control'] === 'no-store'); }
// 3. commit
{ const other = { value: '{"keep":"me"}', updated_at: '2031-01-01T00:00:00+00:00' }; const w = world({ seed: [['mmm_finance_v118', other], ['fin_import_household', { ...other }]] });
  const r = await w.commit({ body: body() });
  ok('a valid attested snapshot is committed (200) with an id and the status of the new latest snapshot', r.code === 200 && r.body.committed === true && /^snap_[0-9a-f]{10}$/.test(r.body.id) && r.body.status.latest.id === r.body.id && r.body.status.latest.label === 'Rocket Money — CEO-attested' && r.body.status.latest.live === false && r.body.status.latest.provider_verified === false && r.body.status.latest.state === 'fresh');
  ok('exactly ONE database write, to app_settings key fin_rm_snapshots; no other table or key is touched', w.writes.length === 1 && w.writes[0].body.key === 'fin_rm_snapshots' && w.urls.every((u) => u.includes('/rest/v1/app_settings')));
  ok('PRESERVATION: the existing Finance document (mmm_finance_v118) and the import summary (fin_import_household) are byte-identical afterwards', w.db.get('mmm_finance_v118').value === other.value && w.db.get('mmm_finance_v118').updated_at === other.updated_at && w.db.get('fin_import_household').value === other.value);
  const st = JSON.parse(w.db.get('fin_rm_snapshots').value); ok('the stored document is household-bound and holds only the typed figures, definition, as-of, source and attestation (no free text, no extra fields)', st.entity === 'household' && st.snapshots.length === 1 && Object.keys(st.snapshots[0]).sort().join() === 'as_of,attested,by,definition,entered_at,figures,id,source' && st.snapshots[0].figures.cash === 120000);
  const r2 = await w.commit({ body: body({ as_of: day(0), figures: { cash: 130000, net_worth: null } }) }); ok('a second snapshot is added with a compare-and-set update; the first is preserved as history and the LATEST as-of is the one displayed', r2.code === 200 && JSON.parse(w.db.get('fin_rm_snapshots').value).snapshots.length === 2 && r2.body.status.latest.as_of === day(0) && r2.body.status.history.length === 2 && w.writes[1].method === 'PATCH');
  const s2 = await w.status(); ok('status returns the same latest snapshot and the freshness rule', s2.body.latest.id === r2.body.id && s2.body.latest.age_days === 0 && s2.body.latest.figures.net_worth === null); }
// 4. validation (nothing written)
{ const w = world(); const cases = [['no confirmation', { confirmation: null }, 'confirmation_required'], ['wrong confirmation', { confirmation: 'yes' }, 'confirmation_required'], ['future as-of', { as_of: '2099-01-01' }, 'future_as_of'], ['bad as-of', { as_of: 'yesterday' }, 'bad_as_of'], ['investment figure', { figures: { investments: 5000, cash: 1 } }, 'unknown_figure'], ['fractional cents', { figures: { cash: 1.5 } }, 'bad_figure'], ['string figure', { figures: { cash: '100' } }, 'bad_figure'], ['negative assets', { figures: { assets: -1 } }, 'negative_figure'], ['no figures', { figures: {} }, 'no_figures'], ['missing definition', { definition: {} }, 'bad_definition'], ['net worth typo', { figures: { net_worth: 999, assets: 300000, liabilities: 350000 } }, 'net_worth_mismatch'], ['cash+savings > assets', { figures: { assets: 100, cash: 99999 } }, 'cash_savings_exceed_assets']];
  for (const [name, o, code] of cases) { const r = await w.commit({ body: body(o) }); ok(`invalid snapshot (${name}) → 422 ${code}, nothing written`, r.code === 422 && r.body.errors.some((e) => e.code === code) && w.writes.length === 0, r.body); }
  const dump = await w.commit({ body: 'not an object' }); ok('a non-object body is refused (422), nothing written', dump.code === 422 && w.writes.length === 0); }
// 5. protections
{ const w = world(); await w.commit({ body: body() }); w.writes.length = 0; w.race = true; const r = await w.commit({ body: body({ as_of: day(0) }) }); ok('COMPARE-AND-SET: a concurrent change makes this commit lose cleanly (409) and the stored history is intact', r.code === 409 && r.body.error === 'concurrent_snapshot_retry' && JSON.parse(w.db.get('fin_rm_snapshots').value).snapshots.length === 1); }
{ const w = world({ seed: [['fin_rm_snapshots', { value: '{"entity":"srv_farsi","snapshots":[]}', updated_at: 't' }]] }); const r = await w.commit({ body: body() }); ok('an unreadable / foreign-entity stored document is NEVER overwritten (500)', r.code === 500 && r.body.error === 'stored_snapshots_unreadable' && w.writes.length === 0); }
{ const w = world(); w.writeFail = true; const r = await w.commit({ body: body({ figures: { cash: MAGIC } }) }); const leak = (w.logs.join(' ') + JSON.stringify(r.body)); ok('a database failure → 500; the typed figures and the database error body reach neither the logs nor the response', r.code === 500 && r.body.error === 'fin_snapshot_failed' && !leak.includes(String(MAGIC)) && !leak.includes('boom'), leak); }
// 6. isolation
ok('the handler source touches only app_settings.fin_rm_snapshots (no fin_import_household, mmm_finance_v118, growth_data_*, plaid_items, investment or YouTube tables)', !/growth_data|mmm_finance_v118|fin_import_household|plaid_items|youtube_|finance_snapshots|investment/i.test(CODE) && (CODE.match(/rest\/v1\/[a-z_]+/g) || []).every((x) => x === 'rest/v1/app_settings'));
ok('the CEO check precedes every database access', SRC.indexOf('requireCeoSession') < SRC.indexOf('_finSnapLoad()', SRC.indexOf('async function finSnapshot')));
ok('the dispatch registers exactly the two actions through finSnapshot', ['status', 'commit'].every((o) => ops.includes(`if (action === 'fin_snapshot_${o}')`) && ops.includes(`finSnapshot(req, res, '${o}')`)));
// 7. MUTATION CHECKS
const mut = async (name, from, to, probe) => { const m = SRC.replace(from, to); if (m === SRC) { ok('mutation anchor present: ' + name, false); return; } let w; try { w = world({ src: m }); } catch (e) { ok('mutation loads: ' + name, false, String(e)); return; } ok('MUTATION caught — ' + name, !(await probe(w))); };
await mut('CEO check removed', "if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });", '', async (w) => { w.ceo = false; return (await w.commit({ body: body() })).code === 401; });
await mut('validation skipped', "if (!v.ok) return res.status(422)", "if (false) return res.status(422)", async (w) => { const r = await w.commit({ body: body({ confirmation: 'no' }) }); return r.code === 422 && w.writes.length === 0; });
await mut('write goes to another key', "key: _FIN_SNAP_KEY, value", "key: 'mmm_finance_v118', value", async (w) => { await w.commit({ body: body() }); return w.writes.every((x) => !x.body || x.body.key === 'fin_rm_snapshots'); });
await mut('compare-and-set removed', "&updated_at=${row.updated_at ? 'eq.' + encodeURIComponent(row.updated_at) : 'is.null'}", '', async (w) => { await w.commit({ body: body() }); w.race = true; return (await w.commit({ body: body({ as_of: day(0) }) })).code === 409; });
await mut('unreadable-document guard removed', "if (row && !doc) return res.status(500)", "if (false) return res.status(500)", async (w) => { w.db.set('fin_rm_snapshots', { value: '{"entity":"srv_farsi","snapshots":[]}', updated_at: 't' }); await w.commit({ body: body() }); return w.writes.length === 0; });
await mut('typed figures logged', "console.warn('[fin_snapshot] ' + op + ' failed: ' + String((e && e.message) || e).slice(0, 80));", "console.warn('[fin_snapshot] ' + JSON.stringify(body));", async (w) => { w.writeFail = true; await w.commit({ body: body({ figures: { cash: MAGIC } }) }); return !w.logs.join(' ').includes(String(MAGIC)); });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
