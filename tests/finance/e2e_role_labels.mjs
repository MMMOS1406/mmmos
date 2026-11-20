// Finance V2 phase 3B correction — FAMILY and VA financial views in the REAL page (real Chrome, stub server, SYNTHETIC state): manual / default / unverified values are labelled, never presented as verified,
// and NOTHING else changes (values, stored records, permissions). VA has no financial view at all. Admin is unaffected by the Family labels.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/finance/e2e_role_labels.mjs [publicDir=public]
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle, sleep } from '../preservation/driver.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public');
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + String(JSON.stringify(x)).slice(0, 500))); };
const fixture = makeFixture(); const stub = await startStub({ publicDir: pub, fixture, quiet: true }); const browser = await launch();
const seed = () => {
  const old = new Date(Date.now() - 40 * 86400000).toISOString(); const ym = old.slice(0, 7);
  D.plaidConnected = false; D.plaidItems = []; D.plaidInvestments = 0; D.plaidLiabilities = []; D.efSourceAccountId = null;
  D.finGoals = { emergencyFundTarget: 12000, emergencyFundCurrent: 1800, portfolioGoal: 100000, debtFreedomGoal: 13500, machineIncomeGoal: 10000, runwayGoal: 6 };
  D.portfolio = { holdings: [{ id: 'h1', symbol: 'SYNTH', shares: 3, price: 18517.33, value: 55551.99, lastEditedAt: old }] };
  D.investmentEngine = { monthly: { [ym]: { value: 40123, gainLoss: 777, contribution: 100, recordedAt: old } } };
  D.engineRevenue = { 'SRV Farsi': { [ym]: 1357 } }; D.availableCash = 3333; D.debts = [{ name: 'Card', balance: 90210, originalAmount: 99000, apr: 20 }]; D.income = [{ label: 'Salary', amount: 7321 }]; D.expenses = [{ label: 'Rent', amount: 4189 }];
  D.fsnapshots = [{ date: '2019-01-01', net: 123456, source: 'backfill', plaidActive: false }, { date: '2026-09-01', net: 200, source: 'live', plaidActive: false }];
};
const norm = (t) => t.replace(/\s+/g, ' ').trim();
const showTab = (page, tab) => page.evaluate(async (t) => { currentTab = t; renderTab(t); await new Promise((r) => setTimeout(r, 1100)); return true; }, tab);
const plain = (page) => page.evaluate(() => document.getElementById('mainContent').innerText.replace(/\s+/g, ' ').trim());
const flat = (page) => page.evaluate(() => document.getElementById('mainContent').textContent.replace(/\s+/g, '').toLowerCase());
const stripped = (page) => page.evaluate(() => { const c = document.getElementById('mainContent').cloneNode(true); c.querySelectorAll('.fin-src,.fin-role-banner,.fin-label').forEach((e) => e.remove()); return c.textContent.replace(/\s+/g, '').toLowerCase(); });
const hashState = (page) => page.evaluate(() => JSON.stringify({ a: D.finGoals, b: D.investmentEngine, c: D.engineRevenue, d: D.availableCash, e: D.debts, f: D.income, g: D.expenses, h: D.fsnapshots, i: D.portfolio, j: D.plaidConnected }));
try {
  // ── FAMILY
  const fam = await openPage(browser, stub.origin, { realClock: true }); await login(fam.page, stub.origin, 'family'); await settle(fam.page, stub.origin, 1500); const f = fam.page; await f.setViewport({ width: 1200, height: 1100 });
  await f.evaluate(seed); const before = await hashState(f);
  const access = await f.evaluate(() => (USERS.find((u) => u.id === currentUser.id) || {}).access);
  ok('FAMILY PERMISSIONS UNCHANGED: Family still has exactly Home, Finance and Engines; no admin sidebar, no import section, no verification hook', JSON.stringify(access) === JSON.stringify(['home', 'finance', 'engines']) && await f.evaluate(() => !document.getElementById('h2Side') && !/Imports — financial apps|_finImpSection|FinVerified|finVerifiedBanner/.test(renderFinance())));
  const labelled = {}, plainOff = {};
  for (const tab of ['home', 'finance', 'engines']) {
    await f.evaluate(() => { window.__finNoRoleLabels = false; }); await showTab(f, tab); labelled[tab] = { text: await plain(f), stripped: await stripped(f), banner: await f.evaluate(() => !!document.querySelector('.fin-role-banner')), chips: await f.evaluate(() => [...document.querySelectorAll('.fin-src')].map((e) => e.innerText.trim())) };
    await f.evaluate(() => { window.__finNoRoleLabels = true; }); await showTab(f, tab); plainOff[tab] = await flat(f);
  }
  await f.evaluate(() => { window.__finNoRoleLabels = false; });
  for (const tab of ['home', 'finance', 'engines']) ok(`FAMILY ${tab}: an explicit "FIGURES NOT VERIFIED" banner is shown and every figure carries a source label`, labelled[tab].banner && /FIGURES NOT VERIFIED/.test(labelled[tab].text) && labelled[tab].chips.length >= 2, labelled[tab].chips);
  for (const tab of ['home', 'finance', 'engines']) ok(`FAMILY ${tab}: VALUES ARE UNCHANGED — the screen with labels removed is identical to the screen rendered without any labels (labels never change a number, text or order)`, labelled[tab].stripped === plainOff[tab], { a: labelled[tab].stripped.slice(0, 160), b: plainOff[tab].slice(0, 160) });
  const all = Object.values(labelled).map((x) => x.text).join(' | '); const chips = Object.values(labelled).flatMap((x) => x.chips);
  ok('FAMILY: nothing is presented as VERIFIED or CONNECTED (no verified line, no CONNECTED label) while no source is connected', !/VERIFIED ·/.test(all) && !/(?<!NOT )VERIFIED/.test(all.replace(/None has been verified/g, '')) && !chips.some((c) => /(?<!NOT )CONNECTED/.test(c)) && !(await f.evaluate(() => !!document.querySelector('.fin-vsrc'))), { verified: all.match(/.{0,40}VERIFIED.{0,25}/g), chips: chips.filter((c) => /CONNECTED/.test(c)) });
  ok('FAMILY: the default emergency fund (1,800) is labelled DEFAULT VALUE — NOT VERIFIED and all four default targets DEFAULT TARGET — NOT CONFIRMED (Home goals and Finance goals)', /Emergency Fund[^$]{0,120}DEFAULT VALUE — NOT VERIFIED[^$]{0,60}DEFAULT TARGET — NOT CONFIRMED/.test(labelled.home.text) && (labelled.home.text.match(/DEFAULT TARGET — NOT CONFIRMED/g) || []).length >= 4 && /DEFAULT VALUE — NOT VERIFIED/.test(labelled.finance.text) && (labelled.finance.text.match(/DEFAULT TARGET — NOT CONFIRMED/g) || []).length >= 4, labelled.home.chips);
  ok('FAMILY: typed-in figures are labelled MANUAL / CALCULATED FROM MANUAL ENTRIES, market gain is labelled "NOT INCOME", machine income "INCLUDES MARKET GAIN"; reconstructed history is labelled', chips.some((c) => /^MANUAL ENTRY/.test(c)) && chips.some((c) => /CALCULATED FROM MANUAL ENTRIES/.test(c)) && chips.some((c) => /MARKET GAIN \/ LOSS — NOT INCOME/.test(c)) && chips.some((c) => /MIXED — INCLUDES MARKET GAIN/.test(c)) && /RECONSTRUCTED — NOT CONNECTED/.test(labelled.finance.text), chips);
  ok('FAMILY: the engine financial cards (Uber, Investment) are labelled too', /Uber Engine\s*MANUAL ENTRY/.test(labelled.engines.text) && /Investment Engine\s*MANUAL ENTRY/.test(labelled.engines.text), labelled.engines.text.match(/Uber Engine[^]{0,80}/));
  ok('FAMILY: every stored record is byte-identical after all renders (nothing deleted or changed)', before === await hashState(f));
  // connected bank: labels follow the source, banner wording changes
  await f.evaluate(() => { D.plaidConnected = true; D.plaidItems = [{ item_id: 'x', accounts: [] }]; D.plaidLastSync = new Date().toISOString(); D.plaidMonthlyIncome = 4321; D.plaidMonthlyBurn = 3210; }); await showTab(f, 'finance');
  const cn = await f.evaluate(() => ({ t: document.getElementById('mainContent').innerText.replace(/\s+/g, ' '), chips: [...document.querySelectorAll('.fin-src')].map((e) => e.innerText.trim()), banner: (document.querySelector('.fin-role-banner') || {}).innerText || '' }));
  ok('FAMILY with a connected bank: the banner becomes "SOURCE LABELS" and income is labelled CONNECTED with a sync date', /SOURCE LABELS/.test(cn.banner) && cn.chips.some((c) => /^CONNECTED · synced \d{4}-\d{2}-\d{2}/.test(c)), cn.chips);
  const reqs = (await (await fetch(stub.origin + '/__stub/log')).json()).log.filter((e) => /fin_import/.test(e.action || ''));
  ok('FAMILY made no import / verification request', reqs.length === 0, reqs);
  ok('no page errors (Family)', fam.pageErrors.length === 0, fam.pageErrors); await f.close();
  // ── VA: no financial view at all
  const va = await openPage(browser, stub.origin, { realClock: true }); await login(va.page, stub.origin, 'va'); await settle(va.page, stub.origin, 1500); const v = va.page; await v.evaluate(seed);
  const vaAccess = await v.evaluate(() => (USERS.find((u) => u.id === currentUser.id) || {}).access);
  ok('VA PERMISSIONS UNCHANGED: Tasks and Technology only', JSON.stringify(vaAccess) === JSON.stringify(['tasks', 'system']));
  const vaTexts = []; for (const [t, sub] of [['tasks', null], ['system', 'engineering'], ['system', 'settings'], ['system', 'integrations'], ['system', 'factory'], ['system', 'continuity']]) vaTexts.push(await v.evaluate(async (tab, s) => { currentTab = tab; renderTab(tab); if (s && typeof setSystemSub === 'function') setSystemSub(s); await new Promise((r) => setTimeout(r, 800)); return document.getElementById('mainContent').innerText.replace(/\s+/g, ' '); }, t, sub));
  const MAGIC = ['7,321', '4,189', '90,210', '40,123', '55,551', '1,357', '3,333', '12,000', '100,000', '13,500', '10,000', '1,800'];
  ok('VA: no financial amount (seeded, default or typed-in) appears on any VA-accessible screen, and no financial label or banner is needed', vaTexts.every((t) => !/\$\s?\d/.test(t) && !MAGIC.some((m) => t.includes(m)) && !/FIGURES NOT VERIFIED/.test(t)), vaTexts.map((t) => (t.match(/\$\s?\d[\d,.k]*/g) || []).slice(0, 3)));
  ok('no page errors (VA)', va.pageErrors.length === 0, va.pageErrors); await v.close();
  // ── ADMIN: Family labels do not leak into the CEO views
  const ad = await openPage(browser, stub.origin, { realClock: true }); await login(ad.page, stub.origin, 'admin'); await settle(ad.page, stub.origin, 1500); await ad.page.evaluate(seed);
  await showTab(ad.page, 'finance'); ok('ADMIN: no Family banner on the CEO Finance view (it has its own verified-only view)', await ad.page.evaluate(() => !document.querySelector('.fin-role-banner') && !!document.getElementById('finVerifiedBanner'))); await ad.page.close();
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
