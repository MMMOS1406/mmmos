// Finance V2 phase 3A in the REAL page (real Chrome) with the REAL fin_import_* handlers (extracted from api/ops.js) behind the preservation stub and a fake database. SYNTHETIC data only, generated at run time.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/finance/e2e_fin_import.mjs [publicDir=public] [outDir]
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createHash } from 'node:crypto';
import * as I from '../../lib/finImport.mjs';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle, sleep } from '../preservation/driver.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public'); const outDir = process.argv[3] ? path.resolve(process.argv[3]) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + String(JSON.stringify(x)).slice(0, 500))); };
// ── real handler + fake database
const ops = fs.readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8'); const SRC = ops.slice(ops.indexOf('// ── fin-import:begin'), ops.indexOf('// ── fin-import:end'));
const dbRows = new Map(), dbWrites = []; let stamp = 0;
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const fetchStub = async (url, init = {}) => { const u = String(url), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null; dbWrites.push({ method, url: u, body });
  if (method === 'POST') { if (dbRows.has(body.key)) return json(409, {}); const r = { value: body.value, updated_at: `2031-06-15T12:00:${String(++stamp).padStart(2, '0')}+00:00` }; dbRows.set(body.key, r); return json(201, [r]); }
  if (method === 'PATCH') { const key = /key=eq\.([^&]+)/.exec(u)[1]; const m = /updated_at=eq\.([^&]*)/.exec(u); const r = dbRows.get(key); if (!r || (m && r.updated_at !== decodeURIComponent(m[1]))) return json(200, []); r.value = body.value; r.updated_at = `2031-06-15T12:00:${String(++stamp).padStart(2, '0')}+00:00`; return json(200, [r]); }
  return json(404, {}); };
const stubs = { _finImp: { ...I, ADAPTERS: { ...I.ADAPTERS, fixture_csv: I.FIXTURE_ADAPTER } }, sbGet: async (p) => { const r = dbRows.get(/key=eq\.([^&]+)/.exec(p)[1]); return r ? [{ value: r.value, updated_at: r.updated_at }] : []; }, fetch: fetchStub, requireCeoSession: async (req) => !!(req.body && req.body.ceo_session_token), SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_KEY: 'svc-' + Math.random().toString(16).slice(2), createHash, console: { log() {}, warn() {}, error() {} }, _safeDbError: (t, o, s) => `db ${t} ${o} ${s}` };
const names = Object.keys(stubs); const { finImport } = new Function(...names, SRC + '\nreturn { finImport };')(...names.map((k) => stubs[k]));
const viaHandler = (op) => async (j) => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(x) { res.body = x; return res; }, setHeader() {} }; await finImport({ method: 'POST', body: j || {}, query: {}, headers: {} }, res, op); return res.code === 200 ? res.body : { __status: res.code, ...res.body }; };
// ── synthetic files (unique merchant strings that must never reach storage)
const M1 = 'Zorblax Synthetic Mart', M2 = 'Quuxville Fuel Depot', M3 = 'Plugh Payroll Unit';
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); const H = 'Date,Description,Category,Amount,Account,Pending';
const rows = [`${day(20)},${M1},Groceries,-40.25,Chk,false`, `${day(19)},${M2},Gas,-30.00,Chk,false`, `${day(18)},${M3},Paycheck,2500.00,Chk,false`, `${day(17)},Move out,Transfer,-400.00,Chk,false`, `${day(17)},Move in,Transfer,400.00,Sav,false`, `${day(16)},Mystery,,-12.00,Chk,false`, `${day(15)},=HYPERLINK("http://x"),Groceries,-5.00,Chk,false`];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finimp-')); const f1 = path.join(tmp, 'export-1.csv'), f2 = path.join(tmp, 'bad.csv'), f3 = path.join(tmp, 'overlap.csv');
fs.writeFileSync(f1, [H, ...rows].join('\n') + '\n'); fs.writeFileSync(f2, '<html><body>not a csv</body></html>'); fs.writeFileSync(f3, [H, ...rows, `${day(8)},${M1},Groceries,-9.00,Chk,false`].join('\n') + '\n');
const leaks = (s) => [M1, M2, M3, 'Zorblax', 'Quuxville', 'Plugh', 'Move out', 'HYPERLINK'].filter((x) => s.includes(x));
const fixture = makeFixture(); fixture.api.fin_import_status = viaHandler('status'); fixture.api.fin_import_preview = viaHandler('preview'); fixture.api.fin_import_commit = viaHandler('commit'); fixture.api.fin_import_verify = viaHandler('verify');
const stub = await startStub({ publicDir: pub, fixture, quiet: true }); const browser = await launch();
const getAll = async () => await (await fetch(stub.origin + '/__stub/log')).json();
const waitText = async (page, rx, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await page.evaluate(() => (document.getElementById('finImpBody') || {}).innerText || ''); if (rx.test(t)) return t.replace(/\s+/g, ' '); await sleep(120); } return (await page.evaluate(() => (document.getElementById('finImpBody') || {}).innerText || '')).replace(/\s+/g, ' '); };
try {
  const { page, pageErrors } = await openPage(browser, stub.origin, { realClock: true }); await login(page, stub.origin, 'admin'); await settle(page, stub.origin, 1500);
  await page.setViewport({ width: 1100, height: 1000 });
  const stateHash = () => page.evaluate(() => JSON.stringify({ a: D.finGoals, b: D.investmentEngine, c: D.availableCash, d: D.debts, e: D.income, f: D.expenses, g: D.fsnapshots, h: D.portfolio, i: D.plaidConnected }));
  const before = await stateHash(); const settingsBefore = await (await fetch(stub.origin + '/__stub/state?key=mmm_finance_v118')).text();
  await page.evaluate(() => { currentTab = 'finance'; renderTab('finance'); }); await sleep(600);
  let t = await waitText(page, /No import yet/);
  ok('ENTRY POINT: the admin Finance screen has an "Imports — financial apps" section, read-only, saying no import yet and that values are unavailable (not zero)', /Imports — financial apps/i.test(await page.evaluate(() => document.getElementById('mainContent').innerText)) && /No import yet/.test(t) && /unavailable/.test(t) && /Read-only/.test(t), t);
  ok('the source list shows the registered Rocket Money adapter next to the synthetic fixture source', /Rocket Money \(transactions CSV export\)/.test(await page.evaluate(() => document.getElementById('finImpAdapter').innerText)) && !/format not verified yet/.test(await page.evaluate(() => document.getElementById('finImpAdapter').innerText)));
  // ── Rocket Money registered mapping vs a wrong-format file
  await page.select('#finImpAdapter', 'rocket_money'); const inp = await page.$('#finImpFile'); await inp.uploadFile(f1); await waitText(page, /Selected: export-1/); await page.click('#finImpCheck'); t = await waitText(page, /cannot be imported/);
  ok('Rocket Money selected with a file that is NOT in the verified Rocket Money format: the file is NOT read; the screen says the columns differ from the verified export; the import button is disabled', /File cannot be imported/.test(t) && /columns differ from the export this mapping was verified against/.test(t) && await page.evaluate(() => document.getElementById('finImpCommit').disabled === true), t);
  // ── malformed file
  await page.select('#finImpAdapter', 'fixture_csv'); await (await page.$('#finImpFile')).uploadFile(f2); await waitText(page, /Selected: bad/); await page.click('#finImpCheck'); t = await waitText(page, /cannot be imported/);
  ok('a malformed (HTML) file is refused with a plain message and cannot be committed', /not a CSV file/.test(t) && await page.evaluate(() => document.getElementById('finImpCommit').disabled === true), t);
  // ── valid file: validation BEFORE commit
  await (await page.$('#finImpFile')).uploadFile(f1); await waitText(page, /Selected: export-1/); await page.click('#finImpCheck'); t = await waitText(page, /ready to import/);
  ok('VALIDATION BEFORE COMMIT: source, reporting period, fingerprint, row counts (7 read / 7 accepted), monthly totals with transfers and unclassified shown as EXCLUDED, formula cell warning', /ready to import/.test(t) && /Source: Synthetic fixture CSV/.test(t) && new RegExp(`period ${day(20)} to ${day(15)}`).test(t) && /file fingerprint [0-9a-f]{12}/.test(t) && /Rows: 7 read · 7 accepted · 0 rejected/.test(t) && /Transfers \(excluded\)/.test(t) && /Unclassified \(excluded\)/.test(t) && /\$800\.00/.test(t) && /spreadsheet formulas/.test(t), t);
  ok('NOTHING IS SAVED BY CHECKING: the fake database has had no write, and the previewed screen contains no merchant name', dbWrites.length === 0 && leaks(t).length === 0, leaks(t));
  if (outDir) { const el = await page.$('#finImpBody'); await el.screenshot({ path: path.join(outDir, 'finance-imports-preview.png') }); }
  await page.click('#finImpCommit'); t = await waitText(page, /Last successful import/);
  ok('COMMIT: success message (original file not kept), "Last successful import" shows source, period and date; imported months listed as VERIFICATION PENDING and "not used in Finance figures"', /Imported 7 new rows/.test(t) && /original file was not kept/.test(t) && /Last successful import · fixture_csv · period/.test(t) && /Imported months/.test(t) && /VERIFICATION PENDING/.test(t) && /Pending months are not used in Finance figures/.test(t) && /Months not listed have no imported data \(unavailable, not zero\)/.test(t), t);
  const stored = [...dbRows.values()].map((r) => r.value).join('');
  ok('STORAGE: exactly one write, the row fin_import_household; no merchant, account name or raw line stored; formula-like text did not survive', dbWrites.filter((w) => w.method !== 'GET').length === 1 && dbRows.size === 1 && dbRows.has('fin_import_household') && leaks(stored).length === 0 && !/HYPERLINK/.test(stored), leaks(stored));
  if (outDir) { const el = await page.$('#finImpBody'); await el.screenshot({ path: path.join(outDir, 'finance-imports-after-commit.png') }); }
  // ── CEO comparison + confirmation (phase 3B correction): pending until confirmed; a confirmed month can supply household figures
  const mths = await page.evaluate(() => _finImp.status.months.map((m) => ({ month: m.month, income: m.income, expense: m.expense, net: m.net }))); const last = mths[mths.length - 1]; const sel = (p, m) => `[id="${p}_${m}"]`; const fmt = (c) => (c / 100).toFixed(2); const usdT = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const finHH = async () => { await page.evaluate(() => { currentTab = 'finance'; renderTab('finance'); }); await sleep(1400); return await page.evaluate(() => { const t = (k) => { const e = document.querySelector('.fin-metric[data-key="' + k + '"]'); return e ? e.innerText.replace(/\s+/g, ' ') : ''; }; return { income: t('income'), expenses: t('expenses'), cashflow: t('cashflow'), cash: t('availableCash'), debts: t('debts'), reason: (document.querySelector('.fin-metric[data-key="income"] .fin-nv-why') || {}).innerText || '' }; }); };
  const hh0 = await finHH();
  ok('PENDING IMPORT IS NOT A FIGURE: before confirmation household income / spending / net still say "No verified data" and the reason names the pending month', /No verified data/.test(hh0.income + hh0.expenses + hh0.cashflow) && !/\$\d/.test(hh0.income + hh0.expenses + hh0.cashflow) && new RegExp('An import for ' + last.month + ' exists but is pending your comparison and confirmation').test(hh0.reason), hh0);
  await page.evaluate(() => { document.querySelectorAll('.collapse-body').forEach((b) => { b.style.maxHeight = 'none'; b.setAttribute('data-expanded', 'true'); }); });
  await page.type(sel('finImpVI', last.month), fmt(last.income + 5000)); await page.type(sel('finImpVE', last.month), fmt(last.expense)); await page.click(sel('finImpVC', last.month)); await page.click(sel('finImpVB', last.month)); await sleep(900);
  let mt = await page.evaluate(() => document.getElementById('finImpMonths').innerText.replace(/\s+/g, ' '));
  ok('MISMATCH: figures that differ from the import by more than $1.00 are not verified; the screen shows the difference and the month stays PENDING', /Not verified: your figures differ from the import \(income by \$50\.00/.test(mt) && await page.evaluate((m) => document.querySelector('.finImpMonth[data-month="' + m + '"]').getAttribute('data-verification') === 'pending', last.month), mt.slice(0, 400));
  await page.evaluate((m) => { document.getElementById('finImpVC_' + m).click(); }, last.month); await sleep(200);   // un-tick the confirmation
  await page.evaluate((m) => { const i = document.getElementById('finImpVI_' + m); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); }, last.month); await page.type(sel('finImpVI', last.month), fmt(last.income)); await page.click(sel('finImpVB', last.month)); await sleep(700);
  mt = await page.evaluate(() => document.getElementById('finImpMonths').innerText.replace(/\s+/g, ' '));
  ok('CONFIRMATION IS EXPLICIT: correct figures without ticking "I compared these…" are refused on the page and nothing is sent', /Tick the box to confirm that you compared/.test(mt) && dbWrites.filter((w) => w.method !== 'GET').length === 1);
  await page.click(sel('finImpVC', last.month)); await page.click(sel('finImpVB', last.month)); await sleep(1800);
  const hh1 = await page.evaluate(() => { const t = (k) => { const e = document.querySelector('.fin-metric[data-key="' + k + '"]'); return e ? e.innerText.replace(/\s+/g, ' ') : ''; }; return { income: t('income'), expenses: t('expenses'), cashflow: t('cashflow'), cash: t('availableCash'), debts: t('debts'), nw: t('netWorth') }; });
  ok('VERIFIED: after the CEO compares and confirms, household income / spending / net show the month\'s own totals with VERIFIED, source, reporting period, confirmation date, import date and FRESH', hh1.income.includes(usdT(last.income)) && hh1.expenses.includes(usdT(last.expense)) && hh1.cashflow.includes(usdT(last.net)) && new RegExp('VERIFIED · Synthetic|VERIFIED · Imported export \\(fixture_csv\\) · period ' + last.month + ' · confirmed by CEO \\d{4}-\\d{2}-\\d{2} · imported \\d{4}-\\d{2}-\\d{2} · FRESH').test(hh1.income), hh1);
  ok('ONLY WHAT THE EXPORT CAN SUPPORT IS VERIFIED: cash, debt and net worth still say "No verified data"', /No verified data/.test(hh1.cash) && /No verified data/.test(hh1.debts) && /No verified data/.test(hh1.nw));
  ok('the verification is stored in the same one summary row (no other write), with the CEO as verifier and the compared and imported figures', dbWrites.filter((w) => w.method !== 'GET').length === 2 && dbRows.size === 1 && (() => { const d = JSON.parse(dbRows.get('fin_import_household').value); const v = d.verified[last.month]; return v && v.by === 'ceo' && v.compared.income === last.income && v.imported.income === last.income && v.import_ids.length === 1; })());
  ok('provenance and freshness are preserved: the month list shows VERIFIED by CEO with the date, the source, the import date and FRESH', await page.evaluate((m) => { const e = document.querySelector('.finImpMonth[data-month="' + m + '"]'); return !!e && e.getAttribute('data-verification') === 'verified' && /VERIFIED by CEO \d{4}-\d{2}-\d{2}/.test(e.innerText) && /fixture_csv · imported \d{4}-\d{2}-\d{2} · FRESH/.test(e.innerText); }, last.month));
  await page.evaluate(() => { currentTab = 'home'; renderTab('home'); }); await sleep(1500);
  const homeV = await page.evaluate(() => document.querySelector('#mainContent').innerText.replace(/\s+/g, ' '));
  ok('HOME: the household income tile shows the verified month with its VERIFIED line (and nothing else became verified)', homeV.includes(usdT(last.income)) && /VERIFIED · Imported export \(fixture_csv\) · period/.test(homeV) && /Current: No verified data/.test(homeV));
  await page.evaluate(() => { currentTab = 'finance'; renderTab('finance'); }); await sleep(1500);   // back to Finance for the remaining checks
  if (outDir) { await page.evaluate(() => { document.querySelectorAll('.collapse-body').forEach((b) => { b.style.maxHeight = 'none'; b.setAttribute('data-expanded', 'true'); }); }); await page.screenshot({ path: path.join(outDir, 'finance-verified-month.png'), fullPage: true }); }
  // ── duplicate export
  await (await page.$('#finImpFile')).uploadFile(f1); await waitText(page, /Selected: export-1/); await page.click('#finImpCheck'); t = await waitText(page, /cannot be imported/);
  ok('DUPLICATE EXPORT: the same file again is blocked ("already been imported") and cannot be committed', /already been imported/.test(t) && await page.evaluate(() => document.getElementById('finImpCommit').disabled === true), t);
  // ── overlapping period
  await (await page.$('#finImpFile')).uploadFile(f3); await waitText(page, /Selected: overlap/); await page.click('#finImpCheck'); t = await waitText(page, /ready to import/);
  ok('OVERLAPPING PERIOD: warns that the period overlaps, shows 1 new / 7 already imported, and will add only the new row', /overlaps a period you already imported/.test(t) && /1 new · 7 already imported/.test(t), t);
  await page.click('#finImpCommit'); t = await waitText(page, /Imported 1 new row/);
  ok('after the overlapping import: 1 new row added, 7 not counted again; the last-import line moved to the new file; two imports are on record', /Imported 1 new row \(7 already imported were not counted again\)/.test(t) && JSON.parse([...dbRows.values()][0].value).imports.length === 2, t);
  const afterOverlap = await page.evaluate(() => _finImp.status.months.map((m) => [m.month, m.verification]));
  const ovMonth = day(8).slice(0, 7), expectReset = ovMonth === last.month; const hhAfter = await finHH();
  ok('A LATER OVERLAPPING IMPORT: a month that receives a new row goes back to PENDING (household figures return to "No verified data"); a month it does not touch stays verified', expectReset ? (afterOverlap.find(([m]) => m === last.month)[1] === 'pending' && /No verified data/.test(hhAfter.income)) : (afterOverlap.find(([m]) => m === last.month)[1] === 'verified' && hhAfter.income.includes(usdT(last.income))), { afterOverlap, ovMonth, last: last.month });
  // ── existing finance unchanged
  const after = await stateHash(); const settingsAfter = await (await fetch(stub.origin + '/__stub/state?key=mmm_finance_v118')).text();
  ok('PRESERVATION: no existing Finance figure changed (in-page state byte-identical) and the production finance document mmm_finance_v118 was never written', before === after && settingsBefore === settingsAfter);
  const L = await getAll(); ok('the browser sent imports only through the three fin_import_* actions (no other write to the app was caused by this section)', L.log.filter((e) => e.write && !/fin_import_|db_proxy/.test(e.action || '') ).every((e) => !/fin_import/.test(e.path)) );
  // ── non-admin never sees it
  const nonAdmin = await page.evaluate(() => { const saved = currentUser; try { currentUser = Object.assign({}, saved, { id: 'family' }); const h = renderFinance(); return /Imports — financial apps|finImpBody|_finImp/.test(h); } finally { currentUser = saved; } });
  ok('FAMILY/VA render of Finance contains no import section or hook', nonAdmin === false);
  ok('no page errors', pageErrors.length === 0, pageErrors);
} finally { await browser.close(); await stub.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
