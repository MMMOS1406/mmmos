// Finance V2 phase 3A — the REAL fin_import_* handlers (extracted from api/ops.js) executed with a fake database: CEO-only access, preview writes nothing, commit writes ONE household summary row,
// the raw file / merchant names never reach the database, logs or responses, fingerprint and compare-and-set protections, production registry (Rocket Money unmapped). SYNTHETIC data generated at run time.
//   node tests/finance/test_fin_import_server.mjs
import fs from 'node:fs'; import { createHash } from 'node:crypto';
import * as I from '../../lib/finImport.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 400) : ''); } };
const ops = fs.readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8');
const a0 = ops.indexOf('// ── fin-import:begin'), a1 = ops.indexOf('// ── fin-import:end');
if (a0 < 0 || a1 < 0) { console.log('FAIL markers'); process.exit(1); }
const SRC = ops.slice(a0, a1);
const M1 = 'Zorblax Synthetic Mart', M2 = 'Quuxville Fuel Depot', M3 = 'Plugh Payroll Unit';
const H = 'Date,Description,Category,Amount,Account,Pending';
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const rows = [`${day(20)},${M1},Groceries,-40.25,Chk,false`, `${day(19)},${M2},Gas,-30.00,Chk,false`, `${day(18)},${M3},Paycheck,2500.00,Chk,false`, `${day(17)},Move out,Transfer,-400.00,Chk,false`, `${day(17)},Move in,Transfer,400.00,Sav,false`];
const csv = (r) => [H, ...r].join('\n') + '\n';
const world = (over = {}) => {
  const w = { db: new Map(), reads: [], writes: [], urls: [], logs: [], ceo: true, race: false, writeFail: false, ...over };
  const sbGet = async (path) => { w.reads.push(path); const key = /key=eq\.([^&]+)/.exec(path)[1]; const r = w.db.get(key); return r ? [{ value: r.value, updated_at: r.updated_at }] : []; };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  let tick = 0; const stamp = () => `2031-06-15T12:00:${String(++tick).padStart(2, '0')}.000000+00:00`;
  const fetchStub = async (url, init = {}) => { const u = String(url), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null; w.urls.push(method + ' ' + u); w.writes.push({ method, url: u, body });
    if (w.writeFail) return json(500, { message: 'boom', details: body && body.value });
    if (method === 'POST') { if (w.db.has(body.key)) return json(409, {}); const row = { value: body.value, updated_at: stamp() }; w.db.set(body.key, row); return json(201, [row]); }
    if (method === 'PATCH') { const key = /key=eq\.([^&]+)/.exec(u)[1]; const row = w.db.get(key); if (w.race) { row.updated_at = stamp(); w.race = false; }
      const m = /updated_at=(eq\.|is\.)([^&]*)/.exec(u); const want = m && m[1] === 'eq.' ? decodeURIComponent(m[2]) : null; if (!row || (m && m[1] === 'eq.' && row.updated_at !== want)) return json(200, []);
      row.value = body.value; row.updated_at = stamp(); return json(200, [row]); }
    return json(404, {}); };
  const lib = { ...I, ADAPTERS: over.production ? I.ADAPTERS : { ...I.ADAPTERS, fixture_csv: I.FIXTURE_ADAPTER } };
  const stubs = { _finImp: lib, sbGet, fetch: fetchStub, requireCeoSession: async () => w.ceo, SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_KEY: 'svc-test-' + Math.random().toString(16).slice(2), createHash, console: { log() {}, warn: (...a) => w.logs.push(a.join(' ')), error: (...a) => w.logs.push(a.join(' ')) }, _safeDbError: (t, op, st) => `db ${t} ${op} ${st}` };
  const names = Object.keys(stubs);
  const f = new Function(...names, (over.src || SRC) + '\nreturn { finImport };')(...names.map((k) => stubs[k]));
  const call = (op) => async (reqOver = {}) => { const res = { code: 200, body: null, headers: {}, status(c) { res.code = c; return res; }, json(x) { res.body = x; return res; }, setHeader(k, v) { res.headers[k] = v; } }; await f.finImport({ method: 'POST', body: {}, query: {}, headers: {}, ...reqOver }, res, op); return res; };
  w.status = call('status'); w.preview = call('preview'); w.commit = call('commit'); return w;
};
const everything = (w) => JSON.stringify([w.writes, w.logs, w.urls]);
const leaks = (s) => [M1, M2, M3, 'Zorblax', 'Quuxville', 'Plugh', 'Move out', 'Chk,false'].filter((x) => s.includes(x));

// 1. authentication — before any database access
for (const op of ['status', 'preview', 'commit']) { const w = world({ ceo: false }); const r = await w[op]({ body: { adapter: 'fixture_csv', content: csv(rows) } });
  ok(`${op}: no CEO session → 401, and NO database read or write happened`, r.code === 401 && w.reads.length === 0 && w.writes.length === 0); }
{ const w = world(); const r = await w.status({ method: 'GET' }); ok('GET is refused (405) with no database access', r.code === 405 && w.reads.length === 0); }

// 2. production registry
{ const w = world({ production: true }); const s = await w.status(); ok('production registry lists ONLY Rocket Money, marked unmapped (no fixture adapter)', s.body.adapters.length === 1 && s.body.adapters[0].id === 'rocket_money' && s.body.adapters[0].status === 'unmapped');
  const p = await w.preview({ body: { adapter: 'rocket_money', content: csv(rows) } }); ok('previewing with Rocket Money is refused as unmapped: nothing parsed, nothing written', p.body.commit_ready === false && p.body.result.blocking[0].code === 'adapter_unmapped' && p.body.result.counts.data_rows === 0 && w.writes.length === 0);
  const c = await w.commit({ body: { adapter: 'rocket_money', content: csv(rows), expected_rows_fingerprint: 'x' } }); ok('committing with Rocket Money is refused (422) and writes nothing', c.code === 422 && w.writes.length === 0);
  const f = await w.preview({ body: { adapter: 'fixture_csv', content: csv(rows) } }); ok('the synthetic fixture adapter does NOT exist in production', f.body.commit_ready === false && f.body.result.blocking[0].code === 'unknown_adapter'); }

// 3. preview writes nothing; commit writes one household row
{ const w = world(); const s0 = await w.status(); ok('status with no data: has_data false, raw files not retained, nothing invented', s0.body.ok && s0.body.has_data === false && s0.body.months.length === 0 && s0.body.raw_files_retained === false && s0.headers['Cache-Control'] === 'no-store');
  const p = await w.preview({ body: { adapter: 'fixture_csv', content: csv(rows) } });
  ok('preview validates and classifies but WRITES NOTHING', p.code === 200 && p.body.commit_ready === true && w.writes.length === 0 && p.body.result.counts.accepted === 5 && p.body.expected_rows_fingerprint === p.body.result.rows_fingerprint);
  ok('the preview response carries no merchant name, account name or raw line', leaks(JSON.stringify(p.body)).length === 0, leaks(JSON.stringify(p.body)));
  const c = await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows), expected_rows_fingerprint: p.body.expected_rows_fingerprint } });
  ok('commit succeeds and returns the import id, counts and period', c.code === 200 && c.body.committed === true && /^imp_[0-9a-f]{10}$/.test(c.body.import_id) && c.body.rows_new === 5, c.body);
  const posts = w.writes.filter((x) => x.method !== 'GET');
  ok('commit performs exactly ONE database write, to app_settings key fin_import_household only', posts.length === 1 && posts[0].url === 'https://db.test/rest/v1/app_settings' && posts[0].body.key === 'fin_import_household' && w.urls.every((u) => u.includes('/rest/v1/app_settings')));
  ok('the original file and merchant/account names reach NOWHERE: not the database write, not the logs, not the response', leaks(everything(w) + JSON.stringify(c.body)).length === 0, leaks(everything(w)));
  const stored = JSON.parse(w.db.get('fin_import_household').value);
  ok('stored document is the household summary: entity household, month totals, 12-hex row hashes, provenance', stored.entity === 'household' && stored.imports.length === 1 && stored.months[Object.keys(stored.months)[0]] && Object.values(stored.rows).flat().every((h) => /^[0-9a-f]{12}$/.test(h)));
  const s1 = await w.status(); ok('status after commit: last import, period, month totals; transfers shown separately and excluded from net', s1.body.has_data && s1.body.last_import.id === c.body.import_id && s1.body.months.reduce((a, m) => a + m.net, 0) === 250000 - 7025 && s1.body.months.reduce((a, m) => a + m.transfer_excluded, 0) === 80000);
  const dup = await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows), expected_rows_fingerprint: p.body.expected_rows_fingerprint } });
  ok('committing the SAME file again is blocked (422) and writes nothing more', dup.code === 422 && dup.body.blocking.includes('same_file_already_imported') && w.writes.filter((x) => x.method !== 'GET').length === 1);
  const more = [...rows, `${day(10)},${M1},Groceries,-12.00,Chk,false`]; const p2 = await w.preview({ body: { adapter: 'fixture_csv', content: csv(more) } });
  ok('an overlapping later export previews as partial_overlap with only the new row counted', p2.body.commit_ready && p2.body.result.overlap.kind === 'partial_overlap' && p2.body.result.counts.new_rows === 1 && p2.body.result.counts.already_imported === 5);
  const c2 = await w.commit({ body: { adapter: 'fixture_csv', content: csv(more), expected_rows_fingerprint: p2.body.expected_rows_fingerprint } });
  const s2 = await w.status(); ok('after the overlapping import the totals are the union counted once (expense +12.00 only)', c2.code === 200 && s2.body.months.reduce((a, m) => a + m.expense, 0) === 7025 + 1200 && s2.body.imports.length === 2); }

// 4. protections
{ const w = world(); const p = await w.preview({ body: { adapter: 'fixture_csv', content: csv(rows) } });
  const noFp = await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows) } }); ok('commit without the preview fingerprint is refused (409), nothing written', noFp.code === 409 && w.writes.length === 0);
  const bad = await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows), expected_rows_fingerprint: 'deadbeef' } }); ok('commit with a fingerprint that does not match the re-parsed file is refused (409)', bad.code === 409 && bad.body.error === 'preview_mismatch' && w.writes.length === 0);
  const edited = await w.commit({ body: { adapter: 'fixture_csv', content: csv([...rows, `${day(5)},X,Cat,-1.00,Chk,false`]), expected_rows_fingerprint: p.body.expected_rows_fingerprint } }); ok('a file edited after the preview cannot ride on the earlier preview (409)', edited.code === 409 && w.writes.length === 0);
  const mal = await w.commit({ body: { adapter: 'fixture_csv', content: 'not,a\nvalid', expected_rows_fingerprint: p.body.expected_rows_fingerprint } }); ok('a malformed file cannot be committed (422)', mal.code === 422 && w.writes.length === 0);
  const nc = await w.preview({ body: { adapter: 'fixture_csv' } }); ok('missing content → 400', nc.code === 400);
  const big = await w.preview({ body: { adapter: 'fixture_csv', content: 'x'.repeat(I.LIMITS.maxBytes + 10000) } }); ok('oversize content → 413 before parsing', big.code === 413 && w.writes.length === 0); }
{ const w = world(); const p = await w.preview({ body: { adapter: 'fixture_csv', content: csv(rows) } }); w.race = false;
  await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows), expected_rows_fingerprint: p.body.expected_rows_fingerprint } });
  const more = [...rows, `${day(9)},${M1},Groceries,-3.00,Chk,false`]; const p2 = await w.preview({ body: { adapter: 'fixture_csv', content: csv(more) } }); w.race = true;
  const r = await w.commit({ body: { adapter: 'fixture_csv', content: csv(more), expected_rows_fingerprint: p2.body.expected_rows_fingerprint } });
  ok('COMPARE-AND-SET: if another import changed the row in between, this commit loses cleanly (409 concurrent_import_retry) instead of overwriting', r.code === 409 && r.body.error === 'concurrent_import_retry' && JSON.parse(w.db.get('fin_import_household').value).imports.length === 1); }
{ const w = world(); w.db.set('fin_import_household', { value: '{"entity":"srv_farsi","salt":"x"}', updated_at: '2031-01-01T00:00:00+00:00' });
  const p = await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows), expected_rows_fingerprint: 'x' } }); ok('an unreadable / foreign-entity stored summary is NEVER overwritten (500 stored_summary_unreadable)', p.code === 500 && p.body.error === 'stored_summary_unreadable' && w.writes.length === 0); }
{ const w = world({ writeFail: true }); const p = await w.preview({ body: { adapter: 'fixture_csv', content: csv(rows) } });
  const c = await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows), expected_rows_fingerprint: p.body.expected_rows_fingerprint } });
  ok('a database failure → 500 fin_import_failed; the error and logs contain no file content and no database response body', c.code === 500 && c.body.error === 'fin_import_failed' && leaks(everything(w) + JSON.stringify(c.body)).length === 0 && !w.logs.join(' ').includes('boom')); }

// 5. isolation: only the one key, no other tables, no business documents
const CODE = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok('the handler source touches only app_settings.fin_import_household (no growth_data_*, mmm_finance_v118, plaid_items, youtube tables)', !/growth_data|mmm_finance_v118|plaid_items|youtube_|finance_snapshots/.test(CODE) && (CODE.match(/rest\/v1\/[a-z_]+/g) || []).every((x) => x === 'rest/v1/app_settings'));
ok('the CEO check precedes every database access in the source', SRC.indexOf('requireCeoSession') < SRC.indexOf('_finImportLoad()', SRC.indexOf('async function finImport')));
ok('the dispatch registers exactly the three actions, all routed through finImport', ['status', 'preview', 'commit'].every((o) => ops.includes(`if (action === 'fin_import_${o}')`) && ops.includes(`finImport(req, res, '${o}')`)));

// 6. MUTATION CHECKS — each must be caught
const mut = async (name, from, to, probe) => { const m = SRC.replace(from, to); if (m === SRC) { ok('mutation anchor present: ' + name, false); return; } const w = world({ src: m }); const caught = !(await probe(w)); ok('MUTATION caught — ' + name, caught); };
const good = async (w) => { const p = await w.preview({ body: { adapter: 'fixture_csv', content: csv(rows) } }); return { w, p }; };
await mut('CEO check removed', "if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });", '', async (w) => { w.ceo = false; const r = await w.preview({ body: { adapter: 'fixture_csv', content: csv(rows) } }); return r.code === 401; });
await mut('fingerprint check removed', "body.expected_rows_fingerprint !== r.rows_fingerprint", 'false', async (w) => { const r = await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows), expected_rows_fingerprint: 'nope' } }); return r.code === 409; });
// (the blocking-error gate in the handler is a second line of defence behind mergeImport, which independently refuses a blocked analysis — covered in test_fin_import.mjs)
await mut('write to a different key', "key: _FIN_IMPORT_KEY, value", "key: 'mmm_finance_v118', value", async (w) => { const { p } = await good(w); await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows), expected_rows_fingerprint: p.body.expected_rows_fingerprint } }); return w.writes.every((x) => !x.body || x.body.key === 'fin_import_household'); });
await mut('compare-and-set removed', "&updated_at=${row.updated_at ? 'eq.' + encodeURIComponent(row.updated_at) : 'is.null'}", '', async (w) => { const { p } = await good(w); await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows), expected_rows_fingerprint: p.body.expected_rows_fingerprint } }); const more = [...rows, `${day(9)},${M1},Groceries,-3.00,Chk,false`]; const p2 = await w.preview({ body: { adapter: 'fixture_csv', content: csv(more) } }); w.race = true; const r = await w.commit({ body: { adapter: 'fixture_csv', content: csv(more), expected_rows_fingerprint: p2.body.expected_rows_fingerprint } }); return r.code === 409; });
await mut('unreadable-summary guard removed', "if (row && !doc) return res.status(500)", 'if (false) return res.status(500)', async (w) => { w.db.set('fin_import_household', { value: '{"entity":"srv_farsi","salt":"x"}', updated_at: 't' }); const { p } = await good(w); await w.commit({ body: { adapter: 'fixture_csv', content: csv(rows), expected_rows_fingerprint: p.body.expected_rows_fingerprint } }); return w.writes.length === 0; });
await mut('preview made to write', "if (op === 'preview') return res.status(200)", "if (op === 'preview') { await _finImportWrite(row, _finImp.emptyDoc('x')); } if (op === 'preview') return res.status(200)", async (w) => { await w.preview({ body: { adapter: 'fixture_csv', content: csv(rows) } }); return w.writes.length === 0; });

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
