// Finance V2 phase 1 in the REAL page (real Chrome, stub server, SYNTHETIC state): Home cards + source labels, Finance screen labels, and proof that nothing is written or changed.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/finance/e2e_home_finance_transparency.mjs [publicDir=public] [outDir]
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public'); const outDir = process.argv[3] ? path.resolve(process.argv[3]) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + String(JSON.stringify(x)).slice(0, 400))); };
const fixture = makeFixture(); const stub = await startStub({ publicDir: pub, fixture, quiet: true }); const browser = await launch();
const getAll = async () => await (await fetch(stub.origin + '/__stub/log')).json(); const getLog = async () => (await getAll()).log;
try {
  const { page, pageErrors } = await openPage(browser, stub.origin, { realClock: true }); await login(page, stub.origin, 'admin'); await settle(page, stub.origin, 1500);
  // synthetic scenario (in the page's memory only; never saved): seeded emergency fund + default targets, one manual Investment Engine entry 40 days old, history with reconstructed + computed points
  await page.evaluate(() => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString(); const ym = old.slice(0, 7);
    D.plaidConnected = false; D.plaidItems = []; D.plaidInvestments = 0; D.efSourceAccountId = null;
    D.finGoals = { emergencyFundTarget: 12000, emergencyFundCurrent: 1800, portfolioGoal: 100000, debtFreedomGoal: 13500, machineIncomeGoal: 10000, runwayGoal: 6 };
    D.portfolio = { holdings: [] }; D.investmentEngine = { monthly: { [ym]: { value: 5000, gainLoss: 400, contribution: 100, recordedAt: old } } };
    D.engineRevenue = {}; D.availableCash = 3000; D.debts = [{ name: 'Card', balance: 2000, originalAmount: 4000, apr: 20 }]; D.income = [{ label: 'Salary', amount: 3000 }]; D.expenses = [{ label: 'Rent', amount: 1500 }];
    D.fsnapshots = [{ date: '2019-01-01', net: 100, source: 'backfill', plaidActive: false }, { date: '2019-02-01', net: 110, source: 'backfill', plaidActive: false }, { date: '2026-09-01', net: 200, source: 'live', plaidActive: false }, { date: '2026-09-02', net: 210, source: 'live', plaidActive: false }];
  });
  const hashState = () => page.evaluate(() => JSON.stringify({ a: D.finGoals, b: D.investmentEngine, c: D.engineRevenue, d: D.availableCash, e: D.debts, f: D.income, g: D.expenses, h: D.fsnapshots, i: D.snapshots, j: D.portfolio, k: D.plaidConnected, l: D.plaidItems }));
  const before = await hashState(); const _l0 = await getAll(); const logBefore = _l0.log.length, proxBefore = _l0.proxied.length;
  const homeTxt = await page.evaluate(() => { renderTab('home'); const el = document.getElementById('mainContent'); return { text: el.innerText.replace(/\s+/g, ' '), html: el.innerHTML }; });
  const T = homeTxt.text;
  // ── Home: cards
  ok('HOME: "Your two businesses" still holds exactly the SRV Farsi and SRV English cards (preserved); a separate section holds the Investment Engine card and the SRV Circle Advisors placeholder', /your two businesses/i.test(T) && /ventures not yet configured/i.test(T) && /SRV Farsi/.test(T) && /SRV English/.test(T) && /Investment Engine/.test(T) && /SRV Circle Advisors/.test(T) && (await page.evaluate(() => document.querySelectorAll('#mainContent .h2-grid.c2 .h2-card').length)) === 2 && (homeTxt.html.match(/class="h2-card[^"]*"/g) || []).length >= 8, [T.slice(0, 300), (homeTxt.html.match(/class="h2-card[^"]*"/g) || []).length]);
  const circle = await page.evaluate(() => document.getElementById('h2Circle').innerText.replace(/\s+/g, ' '));
  ok('SRV CIRCLE ADVISORS is clearly UNCONFIGURED: no status, revenue, activity, link or number — and never the word "active"', /Unconfigured/.test(circle) && /identity is not confirmed/.test(circle) && !/active|\$|revenue:|views|subscribers/i.test(circle.replace('No status, revenue or activity is shown', '')) && !(await page.evaluate(() => document.getElementById('h2Circle').hasAttribute('data-h2'))), circle);
  const ie = await page.evaluate(() => document.getElementById('h2IE').innerText.replace(/\s+/g, ' '));
  ok('INVESTMENT ENGINE card is separate, evidence-based: overdue status (last entry 40 days ago), value, market gain labelled "not income", manual-entry chip with the entry date, and "not connected to a brokerage"', /Monthly update overdue/.test(ie) && /last entry 40 days ago/.test(ie) && /\$5,000/.test(ie) && /not income/.test(ie) && /MANUAL ENTRY/.test(ie) && /updated 20\d\d-\d\d-\d\d/.test(ie) && /not connected to a brokerage/.test(ie), ie);
  const goals = await page.evaluate(() => document.getElementById('h2Goals').innerText.replace(/\s+/g, ' '));
  ok('STRATEGIC GOALS card is on Home with Emergency Fund, Investment Engine Goal, Debt Freedom, Machine Income — and a link to Finance', /Strategic goals/.test(T) && ['Emergency Fund', 'Investment Engine Goal', 'Debt Freedom', 'Machine Income'].every((x) => goals.includes(x)) && await page.evaluate(() => document.getElementById('h2Goals').dataset.h2 === 'finance'));
  ok('the emergency fund (equal to the shipped 1,800) is labelled DEFAULT VALUE — NOT VERIFIED; all four targets are DEFAULT TARGET — NOT CONFIRMED', /DEFAULT VALUE — NOT VERIFIED/.test(goals) && (goals.match(/DEFAULT TARGET — NOT CONFIRMED/g) || []).length === 4, goals);
  ok('MACHINE INCOME is split on screen: business revenue "none entered" + investment market gain (monthly average) "a market gain, not earned income"; chip says MIXED — INCLUDES MARKET GAIN', /business revenue — \(none entered\)/.test(goals) && /market gain, not earned income/.test(goals) && /MIXED — INCLUDES MARKET GAIN/.test(goals), goals);
  ok('the finance strip tiles (income / spend / net) each carry a MANUAL ENTRY chip with "last update not recorded"', (T.match(/MANUAL ENTRY · last update not recorded/g) || []).length >= 3 && !/Source: entries in Finance/.test(T));
  // numbers unchanged: the displayed numbers are exactly computeFinanceState()
  const nums = await page.evaluate(() => { const F = computeFinanceState(); return { inc: F.incomeTotal, exp: F.expenseTotal }; });
  ok('no "undefined" / NaN anywhere on Home, and Emergency Fund shows the app\'s own months-covered figure (was "undefined months covered" on the Finance goals line)', !/undefined|NaN/.test(T) && /\d+(\.\d)? months covered/.test(goals) && !/undefined|NaN/.test((await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = renderGoalsSection(computeFinanceState(), true); return d.innerText; }))), goals);
  ok('NO SILENT RECALCULATION: the displayed income and spend equal computeFinanceState() exactly', T.includes('$' + Math.round(nums.inc).toLocaleString('en-US')) && T.includes('$' + Math.round(nums.exp).toLocaleString('en-US')), nums);
  if (outDir) { await page.setViewport({ width: 1100, height: 900 }); const el = await page.$('#mainContent'); await el.screenshot({ path: path.join(outDir, 'home-finance-v2-phase1.png') }); }
  // ── Finance screen
  const fin = await page.evaluate(() => { const h = renderFinance(); const d = document.createElement('div'); d.innerHTML = h; return { text: d.innerText.replace(/\s+/g, ' '), html: h }; });
  ok('FINANCE: Emergency Fund, Net Worth, Debt and the Investment Engine panel carry source chips; goals show current/target chips', /Emergency Fund[\s\S]{0,400}DEFAULT VALUE — NOT VERIFIED/.test(fin.text) && /Net Worth\s*CALCULATED FROM MANUAL ENTRIES/.test(fin.text) && fin.html.includes('data-key="debts"') && /WHERE THESE NUMBERS COME FROM/.test(fin.text) && (fin.html.match(/data-key="target:/g) || []).length >= 4, fin.text.slice(0, 300));
  ok('FINANCE: the Investment Engine panel flags the overdue entry and says a market gain is "not earned income and is not business revenue"', /last entry 40 days ago — update due/.test(fin.text) && /not earned income and is not business revenue/.test(fin.text));
  ok('FINANCE: the chart history note counts the 2 RECONSTRUCTED points ("not connected") separately from the 2 computed from manual entries and says no point is a verified balance', /RECONSTRUCTED — NOT CONNECTED/.test(fin.text) && /2 reconstructed points up to 2019-02-01/.test(fin.text) && /2 points computed from manual entries/.test(fin.text) && /No point is a verified balance/.test(fin.text), fin.text.match(/Chart history[^.]*\./));
  if (outDir) { await page.evaluate(() => { currentTab = 'finance'; renderTab('finance'); }); await new Promise((r) => setTimeout(r, 1200)); await page.evaluate(() => { ['goalsBody', 'portBody', 'analyticsBody'].forEach((id) => { const e = document.getElementById(id); if (e && e.getAttribute('data-expanded') !== 'true') { try { toggleSection(id); } catch (x) {} } }); }); await new Promise((r) => setTimeout(r, 900));
    for (const [id, name] of [['goalsBody', 'finance-goals.png'], ['portBody', 'finance-investment-engine.png'], ['analyticsBody', 'finance-chart-history-note.png']]) { const h = await page.evaluateHandle((x) => { const e = document.getElementById(x); return e ? e.closest('.card') : null; }, id); const el = h.asElement(); if (el) { await el.evaluate((e) => e.scrollIntoView()); await el.screenshot({ path: path.join(outDir, name) }); } } }
  // ── safety: nothing changed, nothing written
  await page.evaluate(() => { renderTab('finance'); renderTab('home'); }); await settle(page, stub.origin, 600);
  const after = await hashState(); const L1 = await getAll(); const logAfter = L1.log;
  ok('NO FINANCIAL RECORD WAS MODIFIED: every Finance field in memory is byte-identical after rendering Home and Finance', before === after);
  const newLog = logAfter.slice(logBefore), newProx = L1.proxied.slice(proxBefore);
  const dbWrites = newProx.filter((p) => !['GET', 'HEAD'].includes(String(p.method).toUpperCase()));
  const apiWrites = newLog.filter((l) => l.cls === 'write' || (l.write === true && l.action !== 'db_proxy'));
  ok('NO WRITE of any kind while rendering: no database write through the data proxy (reads only), no write-class API action, no Plaid / Google / state-save request', dbWrites.length === 0 && apiWrites.length === 0 && !newLog.some((l) => /plaid|youtube|state_save|mmm_state/i.test(String(l.path) + String(l.action))) && !newProx.some((p) => /plaid|state_save/i.test(p.path)), { dbWrites, apiWrites, reads: newProx.map((p) => p.method + ' ' + p.path) });
  // ── scenario B: values the CEO changed / a connected source → labels change accordingly, numbers still identical to the app's own calculation
  await page.evaluate(() => { D.finGoals.emergencyFundCurrent = 2750; D.finGoals.portfolioGoal = 150000; D.engineRevenue = { 'AI Studio': { [currentYM()]: 40 } }; });
  const B = await page.evaluate(() => { renderTab('home'); return document.getElementById('h2Goals').innerText.replace(/\s+/g, ' '); });
  ok('a CHANGED emergency fund is MANUAL ENTRY (not "default"), a changed target is TARGET SET BY YOU, and entered business revenue replaces "none entered"', /MANUAL ENTRY/.test(B) && /TARGET SET BY YOU/.test(B) && (B.match(/DEFAULT TARGET — NOT CONFIRMED/g) || []).length === 3 && /business revenue \$40 \(typed-in\)/.test(B), B);
  // Family: the labels are for the CEO only — Family's Finance screen is byte-for-byte what it was
  { const fam = await openPage(browser, stub.origin, { realClock: true }); await login(fam.page, stub.origin, 'family'); await settle(fam.page, stub.origin, 1200);
    const f = await fam.page.evaluate(() => { currentTab = 'finance'; const h = typeof renderFinance === 'function' ? renderFinance() : ''; return { len: h.length, chips: (h.match(/fin-src/g) || []).length, ie: /WHERE THESE NUMBERS COME FROM/.test(h), hist: /Chart history:/.test(h) }; });
    ok('FAMILY: the source labels are not added to the Family Finance view (no chips, no panels, no history note)', f.len > 1000 && f.chips === 0 && !f.ie && !f.hist, f); await fam.page.close(); }
  ok('no page errors', pageErrors.length === 0, pageErrors);
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
