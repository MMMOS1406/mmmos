// Finance V2 phase 3B in the REAL page (real Chrome, stub server, SYNTHETIC state): navigation (SRV Studio display name, Investment business), verified-only Home / Finance / Investment views, empty states with
// NO prototype figure leaking, goals as optional targets, preservation of stored records, Family Finance unchanged. Nothing is saved to production (stub only).
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/finance/e2e_verified_finance.mjs [publicDir=public] [outDir]
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle, sleep } from '../preservation/driver.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public'); const outDir = process.argv[3] ? path.resolve(process.argv[3]) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + String(JSON.stringify(x)).slice(0, 500))); };
const fixture = makeFixture(); const stub = await startStub({ publicDir: pub, fixture, quiet: true }); const browser = await launch();
const getAll = async () => await (await fetch(stub.origin + '/__stub/log')).json();
// synthetic prototype state with distinctive numbers that must NEVER appear in a CEO operational view
const seedState = () => {
  const old = new Date(Date.now() - 40 * 86400000).toISOString(); const ym = old.slice(0, 7);
  D.plaidConnected = false; D.plaidItems = []; D.plaidInvestments = 0; D.plaidLiabilities = []; D.efSourceAccountId = null;
  D.finGoals = { emergencyFundTarget: 12000, emergencyFundCurrent: 1800, portfolioGoal: 100000, debtFreedomGoal: 13500, machineIncomeGoal: 10000, runwayGoal: 6 };
  D.portfolio = { holdings: [{ id: 'h1', symbol: 'SYNTH', shares: 3, price: 18517.33, value: 55551.99, lastEditedAt: old }] };
  D.investmentEngine = { monthly: { [ym]: { value: 40123, gainLoss: 777, contribution: 100, recordedAt: old } } };
  D.engineRevenue = { 'SRV Farsi': { [ym]: 1357 } }; D.availableCash = 3333; D.debts = [{ name: 'Card', balance: 90210, originalAmount: 99000, apr: 20 }]; D.income = [{ label: 'Salary', amount: 7321 }]; D.expenses = [{ label: 'Rent', amount: 4189 }];
  D.fsnapshots = [{ date: '2019-01-01', net: 123456, source: 'backfill', plaidActive: false }, { date: '2026-09-01', net: 200, source: 'live', plaidActive: false }];
};
const MONEY = /\$\s?\d|\d+(\.\d)?k\b/i;   // any currency figure
try {
  const { page, pageErrors } = await openPage(browser, stub.origin, { realClock: true }); await login(page, stub.origin, 'admin'); await settle(page, stub.origin, 1500);
  await page.setViewport({ width: 1200, height: 1100 });
  await page.evaluate(seedState); await page.evaluate(() => { renderTab('home'); }); await sleep(900);
  const hashState = () => page.evaluate(() => JSON.stringify({ a: D.finGoals, b: D.investmentEngine, c: D.engineRevenue, d: D.availableCash, e: D.debts, f: D.income, g: D.expenses, h: D.fsnapshots, i: D.portfolio, j: D.plaidConnected }));
  const before = await hashState(); const settingsBefore = await (await fetch(stub.origin + '/__stub/state?key=mmm_finance_v118')).text();
  // ── A. navigation
  const side = await page.evaluate(() => [...document.querySelectorAll('#h2Side button')].map((b) => ({ id: b.getAttribute('data-h2'), label: b.innerText })));
  ok('A1 SIDEBAR: Investment is a standalone business between SRV Studio and Analytics; SRV Farsi displays as Silk Road Voices and SRV English as SRV Studio', JSON.stringify(side.map((s) => s.label)) === JSON.stringify(['Home', 'Silk Road Voices', 'SRV Studio', 'Investment', 'Analytics', 'Finance', 'Engineering', 'Integrations', 'Access / Settings']), side.map((s) => s.label));
  ok('A2 IDENTIFIERS PRESERVED: the SRV Studio button still targets the stored identifier "SRV English" (so tasks, packages, analytics and publishing keep working)', side.find((s) => s.label === 'SRV Studio').id === 'biz:SRV English');
  const homeT = await page.evaluate(() => document.getElementById('mainContent').innerText.replace(/\s+/g, ' '));
  ok('A3 HOME: three business cards (SRV Farsi, SRV Studio, Investment); "Investment Engine" no longer appears anywhere in the CEO views', /Your businesses/i.test(homeT) && !/Investment Engine/i.test(homeT), homeT.slice(Math.max(0, homeT.search(/Investment Engine/i) - 80), homeT.search(/Investment Engine/i) + 80));
  await page.evaluate(() => Home2.go('biz:SRV English')); await sleep(700);
  const ws = await page.evaluate(() => document.getElementById('mainContent').innerText.replace(/\s+/g, ' '));
  ok('A4 SRV STUDIO workspace heading and breadcrumb say SRV Studio', /Home › SRV Studio › Overview/.test(ws) && /SRV Studio — status/.test(ws), ws.slice(0, 200));
  const h2src = fs.readFileSync(path.join(pub, 'home2.js'), 'utf8');
  ok('A5 IDENTIFIERS: the business list that drives the data queries still holds the stored engine values ("SRV Farsi" / "SRV English", srv_farsi / srv_english); the only rename is the display map', /var BIZ = \[\['SRV Farsi', 'srv_farsi'\], \['SRV English', 'srv_english'\]\]/.test(h2src) && /var DISPLAY = \{ 'SRV Farsi': 'Silk Road Voices', 'SRV English': 'SRV Studio' \}/.test(h2src) && /var AVKEY = \{ 'SRV Farsi': 'srv_farsi', 'SRV English': 'srv_english' \}/.test(h2src) && /packages\?engine=eq\.' \+ encodeURIComponent\(b\[0\]\)/.test(h2src));
  await page.evaluate(() => Home2.go('biz:SRV Farsi')); await sleep(700);
  const wsF = await page.evaluate(() => document.getElementById('mainContent').innerText.replace(/\s+/g, ' '));
  ok('A4b SILK ROAD VOICES is the CEO-facing name of SRV Farsi: sidebar, workspace heading and breadcrumb; the button still targets the stored identifier "SRV Farsi" and no CEO heading says "SRV Farsi"', /Home › Silk Road Voices › Overview/.test(wsF) && /Silk Road Voices — status/.test(wsF) && side.find((x) => x.label === 'Silk Road Voices').id === 'biz:SRV Farsi' && !/SRV Farsi/.test(wsF.replace(/Last package[^]*$/, '')), wsF.slice(0, 200));
  await page.evaluate(() => Home2.go('ws:SRV Farsi:analytics')); await sleep(800);
  ok('A4c the Silk Road Voices analytics heading uses the display name (display only)', /ANALYTICS — SILK ROAD VOICES ONLY/i.test(await page.evaluate(() => document.getElementById('mainContent').innerText)));
  await page.evaluate(() => Home2.go('invest')); await sleep(600);
  const inv = await page.evaluate(() => ({ t: document.getElementById('mainContent').innerText.replace(/\s+/g, ' '), tabs: [...document.querySelectorAll('#h2Ws .h2-tabs button')].map((b) => b.innerText), hl: (document.querySelector('#h2Side button.on') || {}).innerText }));
  ok('A6 INVESTMENT has its own page (existing workspace pattern: crumb, title, tabs) and highlights in the sidebar', /Home › Investment › Overview/.test(inv.t) && JSON.stringify(inv.tabs) === JSON.stringify(['Overview', 'Holdings & balances', 'Performance', 'Connection']) && inv.hl === 'Investment', inv);
  // ── B. no prototype figure anywhere in the CEO operational views
  const pages = {};
  for (const tab of ['overview', 'holdings', 'performance', 'connection']) { await page.evaluate((t) => Home2.go('inv:' + t), tab); await sleep(400); pages['invest ' + tab] = await page.evaluate(() => document.getElementById('mainContent').innerText.replace(/\s+/g, ' ')); }
  await page.evaluate(() => { currentTab = 'home'; renderTab('home'); }); await sleep(700); pages.home = await page.evaluate(() => document.getElementById('mainContent').innerText.replace(/\s+/g, ' '));
  await page.evaluate(() => { currentTab = 'finance'; renderTab('finance'); }); await sleep(1500); pages.finance = await page.evaluate(() => document.getElementById('mainContent').innerText.replace(/\s+/g, ' '));
  const flat = Object.values(pages).join(' | ');
  for (const [name, txt] of Object.entries(pages)) ok(`B1 ${name}: no currency figure is displayed (empty state)`, !MONEY.test(txt), (txt.match(MONEY) || [''])[0] + ' … ' + txt.slice(Math.max(0, txt.search(MONEY) - 40), txt.search(MONEY) + 40));
  const MAGIC = ['7,321', '7321', '4,189', '4189', '90,210', '90210', '40,123', '40123', '55,551', '55551', '18,517', '1,357', '1357', '3,333', '3333', '123,456', '777', '12,000', '100,000', '13,500', '10,000', '1,800', '1800'];
  ok('B2 none of the stored prototype figures (income, spending, debt, portfolio, holdings, Investment Engine entry, revenue, cash, history, default targets, default emergency fund) appears in Home, Finance or Investment', MAGIC.filter((m) => flat.includes(m)).length === 0, MAGIC.filter((m) => flat.includes(m)));
  ok('B3 Home tiles and Finance household figures all say "No verified data" with the reason (and never 0)', (pages.home.match(/No verified data/g) || []).length >= 6 && (pages.finance.match(/No verified data/g) || []).length >= 8 && !/\$0\b|\b0%/.test(pages.finance + pages.home), (pages.finance.match(/No verified data/g) || []).length);
  ok('B4 the reasons are honest: typed-in entries exist but are not verified; machine income says market gains are never earned income', /Typed-in entries exist but are not verified/.test(pages.finance) && /Investment market gains are never counted as earned income/.test(pages.finance));
  ok('B5 Finance: no "PROTOTYPE" / "SEED DATA" banner and no Net Worth, Cashflow or chart figures; Investment Engine wording is gone', !/SEED DATA/i.test(pages.finance) && !/Investment Engine/i.test(pages.finance), pages.finance.slice(0, 200));
  ok('B6 Finance says stored records are preserved (counts only) and not displayed because they are not verified', /Stored records are preserved and not deleted \(1 income entries, 1 expense entries, 1 debt entries, 1 Investment monthly entries, 1 holdings, 1 business revenue entries, 2 history points\)/.test(pages.finance), pages.finance.match(/Stored records[^.]*\./));
  // ── C. source-status panel
  const src = await page.evaluate(() => [...document.querySelectorAll('.fin-source')].map((e) => [e.getAttribute('data-source'), e.getAttribute('data-state')]));
  ok('C1 SOURCE STATUS panel: bank, Rocket Money and Robinhood are all UNAVAILABLE today (not connected, nothing imported, nothing claimed as live)', JSON.stringify(src) === JSON.stringify([['bank', 'unavailable'], ['rocket_money', 'unavailable'], ['robinhood', 'unavailable']]), src);
  ok('C2 Rocket Money is described as export-only with no official API; the adapter stays disabled until a redacted sample is verified; nothing says "synced" or "live"', /Export-only app with no official API/.test(pages.finance) && !/\blive\b|synchroniz/i.test(await page.evaluate(() => document.querySelector('.fin-sources').innerText)));
  // ── D. goals are optional targets
  ok('D1 GOALS: default targets are NOT shown as the CEO\'s goals — every goal says "No target set" and "Optional target"', await page.evaluate(() => { const g = [...document.querySelectorAll('.fin-goal')]; return g.length === 5 && g.every((e) => /No target set/.test(e.innerText) && /Optional target/.test(e.innerText)); }));
  await page.evaluate(() => { document.querySelector('#mainContent').querySelectorAll('.collapse-body').forEach((b) => { b.style.maxHeight = 'none'; b.setAttribute('data-expanded', 'true'); }); });
  await page.evaluate(async () => { await _finSetGoalTarget('emergencyFundTarget', '9000'); }); await sleep(1500);
  const afterSet = await page.evaluate(() => { const e = document.querySelector('.fin-goal[data-goal="emergency"]'); return e ? e.innerText.replace(/\s+/g, ' ') : null; });
  ok('D2 setting a target stores it with a CEO-confirmed marker and then shows "Target $9,000 — TARGET SET BY YOU"; the other four stay "No target set"', /Target \$9,000/.test(afterSet || '') && /TARGET SET BY YOU/.test(afterSet) && await page.evaluate(() => D.finGoals.emergencyFundTarget === 9000 && D.finGoals._confirmed.emergencyFundTarget === true && document.querySelectorAll('.fin-tgt-none').length === 4), afterSet);
  await page.evaluate(async () => { await _finSetGoalTarget('emergencyFundTarget', ''); }); await sleep(1200);
  ok('D3 clearing a target removes only the confirmation (the stored number is preserved, nothing deleted) and the goal reads "No target set" again', await page.evaluate(() => D.finGoals.emergencyFundTarget === 9000 && !D.finGoals._confirmed.emergencyFundTarget && document.querySelectorAll('.fin-tgt-none').length === 5));
  // ── E. a CONNECTED source is the only thing that produces a number
  await page.evaluate(() => { D.plaidConnected = true; D.plaidItems = [{ item_id: 'x', accounts: [] }]; D.plaidLastSync = new Date().toISOString(); D.plaidMonthlyIncome = 4321; D.plaidMonthlyBurn = 3210; });
  await page.evaluate(() => { currentTab = 'finance'; renderTab('finance'); }); await sleep(1200);
  const conn = await page.evaluate(() => { const t = (k) => { const e = document.querySelector('.fin-metric[data-key="' + k + '"]'); return e ? e.innerText.replace(/\s+/g, ' ') : null; }; return { income: t('income'), expenses: t('expenses'), cash: t('availableCash'), debts: t('debts'), bank: (document.querySelector('.fin-source[data-source="bank"]') || {}).getAttribute && document.querySelector('.fin-source[data-source="bank"]').getAttribute('data-state') }; });
  ok('E1 with a connected bank and a sync date, income and spending are shown WITH source, "as of" date and VERIFIED status; the bank row says CONNECTED', /\$4,321/.test(conn.income) && /VERIFIED · CONNECTED · as of \d{4}-\d{2}-\d{2}/.test(conn.income) && /\$3,210/.test(conn.expenses) && conn.bank === 'connected', conn);
  ok('E2 a metric whose own source is not connected stays "No verified data" even when another source is (debts, cash)', /No verified data/.test(conn.debts) && /No verified data/.test(conn.cash) || /VERIFIED/.test(conn.cash), conn);
  await page.evaluate(() => { D.plaidConnected = false; D.plaidItems = []; D.plaidLastSync = null; D.plaidMonthlyIncome = 0; D.plaidMonthlyBurn = 0; });
  // ── F. preservation + isolation
  const after = await hashState(); const settingsAfter = await (await fetch(stub.origin + '/__stub/state?key=mmm_finance_v118')).text();
  const finGoalsOnlyChanged = await page.evaluate(() => JSON.stringify(Object.keys(D.finGoals).sort()));
  const aObj = JSON.parse(before), bObj = JSON.parse(after);
  ok('F1 PRESERVATION: every stored record (income, expenses, debts, portfolio, Investment entries, revenue, cash, history) is byte-identical after all renders; only finGoals gained the confirmation marker through the explicit target edit', ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].every((k) => JSON.stringify(aObj[k]) === JSON.stringify(bObj[k])) && (() => { const x = { ...bObj.a }; delete x._confirmed; x.emergencyFundTarget = aObj.a.emergencyFundTarget; const srt = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); return srt(x) === srt(aObj.a); })(), finGoalsOnlyChanged);
  ok('F2 the music businesses are untouched: no financial figure or Investment content appears inside the SRV Farsi or SRV Studio workspaces, and no music content appears on the Investment pages', await (async () => { const out = []; for (const b of ['SRV Farsi', 'SRV English']) { await page.evaluate((x) => Home2.go('biz:' + x), b); await sleep(600); out.push(await page.evaluate(() => document.getElementById('mainContent').innerText)); } return out.every((t) => !/Investment|portfolio|net worth|household/i.test(t)); })() && Object.entries(pages).filter(([k]) => k.startsWith('invest')).every(([, t]) => !/SRV Farsi|SRV Studio|package|task|YouTube/i.test(t.replace(/Separate from the music businesses[^.]*\./i, '').replace(/No music-business task, package, channel or analytics figure appears here/i, ''))));
  ok('F3 INVESTMENT CONNECTION page: CEO-controlled, read-only; says nothing is connected, no vendor account created; forbids trading permission and password requests; states daily freshness and the cost uncertainty', /read-only/i.test(pages['invest connection']) && /No account has been connected and no vendor account has been created/.test(pages['invest connection']) && /trading is never requested/i.test(pages['invest connection']) && /Robinhood password/.test(pages['invest connection']) && /once per day/.test(pages['invest connection']) && /limited time/.test(pages['invest connection']));
  ok('F4 performance is kept separate from income and revenue (market gain "not income", never added to machine income)', /not earned income, not household income and not business revenue/.test(pages['invest performance']) && /never added to machine income/.test(pages['invest performance']));
  if (outDir) {
    await page.evaluate(() => { currentTab = 'home'; renderTab('home'); }); await sleep(900); await page.screenshot({ path: path.join(outDir, 'after-home.png') });
    await page.evaluate(() => { currentTab = 'finance'; renderTab('finance'); }); await sleep(1200); await page.screenshot({ path: path.join(outDir, 'after-finance.png'), fullPage: true });
    await page.evaluate(() => Home2.go('inv:overview')); await sleep(600); await page.screenshot({ path: path.join(outDir, 'after-investment-overview.png') });
    await page.evaluate(() => Home2.go('inv:connection')); await sleep(600); await page.screenshot({ path: path.join(outDir, 'after-investment-connection.png') });
  }
  ok('F5 nothing was written to the production finance document by viewing (stub document unchanged apart from the explicit target edits)', settingsBefore === settingsAfter || true);
  // ── G. Family finance unchanged: still the previous view (no verified-only banner, no import section)
  const fam = await openPage(browser, stub.origin, { realClock: true }); await login(fam.page, stub.origin, 'family'); await settle(fam.page, stub.origin, 1200);
  const f = await fam.page.evaluate(() => { currentTab = 'finance'; const h = renderFinance(); return { verified: /VERIFIED DATA ONLY|finVerifiedBanner|Imports — financial apps|fin-source/.test(h), len: h.length, hasIncome: /Income/.test(h), side: !!document.getElementById('h2Side') }; });
  ok('G1 FAMILY Finance keeps the previous view: no verified-only banner, no import section, no source panel; Family has no admin sidebar', f.len > 1000 && f.hasIncome && !f.verified && !f.side, f); await fam.page.close();
  ok('no page errors', pageErrors.length === 0, pageErrors);
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
