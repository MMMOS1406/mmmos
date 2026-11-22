// CEO homepage business dashboard — browser test against the local stub with SYNTHETIC analytics. PUPPETEER_CORE=<dir> node tests/home2/e2e_ceo_dashboard.mjs [screenshotDir]
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
import { buildHomeCard } from '../../lib/homeInsights.mjs';
const shotDir = process.argv[2]; const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const NOW = Date.now();
const win = (o) => ({ views: 3000, non_ad_views: 3000, paid_views: 0, paid_share_pct: 0, watch_hours: 40, net_subs: 9, from: '2026-10-21', to: '2026-11-17', status: 'complete', ...o });
const dash = (o) => ({ collected: true, freshness: { last_day: new Date(NOW - 5 * 864e5).toISOString().slice(0, 10), collected_at: new Date(NOW - 3 * 864e5).toISOString() },
  windows: { d28: win({}), d28_prev: win({ views: 2000, non_ad_views: 2000 }), d7: win({ views: 700, non_ad_views: 700 }), d7_prev: win({ views: 600, non_ad_views: 600 }) }, conversion: { per_1000_non_ad: 3, prev_per_1000_non_ad: 2 }, avd: { d28_sec: 70, prev28_sec: 60, d28_pct: 30 },
  trend: [], formats: { rows: [] }, videos: { top: [], total_views: 3000 }, retention: { curves: [] }, recommendations: [], ...o });
const ALPHA = dash({ channel_id: 'UC_A', videos: { top: [{ id: 'a1', title: 'ALPHA SONG ONE', views: 1500 }], total_views: 3000 }, recommendations: [{ id: 'paid_dependence', finding: 'ALPHA FINDING', priority: 'High', outcome: 'TEST', evidence: { metric: 'm', value: 'v', volume_ok: true }, diagnosis: { kind: 'confirmed', text: 't' }, action: 'ALPHA ACTION', success: 's' }] });
const BETA = dash({ channel_id: 'UC_B', windows: { d28: win({ views: 8000, non_ad_views: 2000, paid_views: 6000, paid_share_pct: 75 }), d28_prev: win({ views: 2000, non_ad_views: 2000 }), d7: win({}), d7_prev: win({}) }, videos: { top: [{ id: 'b1', title: 'BETA SONG ONE', views: 900 }], total_views: 8000 } });
const mkCards = () => ({ silk_road_voices: buildHomeCard({ business: 'silk_road_voices', name: 'Silk Road Voices', dash: ALPHA, rows: [], counters: { subscribers: 40, history: [] }, pipeline: { last_ok_at: new Date(NOW - 36e5).toISOString(), last_status: 'healthy', steps_ok: '3/3' }, collection: { scheduled: false }, nowMs: NOW }),
  srv_studio: buildHomeCard({ business: 'srv_studio', name: 'SRV Studio', dash: BETA, rows: [], counters: { subscribers: 9, history: [] }, pipeline: null, nowMs: NOW }) });
let calls = []; let mode = 'ok';
const fx = makeFixture(); fx.restFilter = true;
fx.api.growth_report = async (json) => { calls.push(json); if (mode === 'fail') return { __status: 500, ok: false, error: 'growth_report_failed' }; const c = mkCards(); return { ok: true, role: 'ceo', reports: Object.entries(c).map(([b, v]) => ({ business: b, home_card: v })) }; };
const stub = await startStub({ publicDir: fs.realpathSync(new URL('../../public', import.meta.url).pathname), fixture: fx }); const browser = await launch();
const txt = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.innerText.replace(/\s+/g, ' ')), sel);
try {
  const o = await openPage(browser, stub.origin, { viewport: { width: 1440, height: 900 }, realClock: true }); await login(o.page, stub.origin, 'admin'); await settle(o.page, stub.origin, 1200);
  await o.page.evaluate(() => renderTab('home')); await settle(o.page, stub.origin, 1500);
  const cards = await txt(o.page, 'section.h2d');
  check('two business dashboard cards rendered, in order Silk Road Voices then SRV Studio', cards.length === 2 && /^Silk Road Voices/.test(cards[0]) && /^SRV Studio/.test(cards[1]));
  check('growth_report requested with home:true (one request for both businesses)', calls.length >= 1 && calls[0] && calls[0].home === true);
  check('each card shows data-through date and last successful sync', cards.every((t) => /Data through/.test(t) && /Last successful sync/.test(t)));
  check('status pill and one-line reason are visible', cards.every((t) => /(GROWING|DECLINING|FLAT|NEW CATALOG|CAN.T TELL|TOO SMALL|NO DATA)/.test(t)));
  check('card A: only A content (isolation)', /ALPHA SONG ONE/.test(cards[0]) && !/BETA/.test(cards[0]) && /ALPHA ACTION/.test(cards[0]));
  check('card B: only B content (isolation)', /BETA SONG ONE/.test(cards[1]) && !/ALPHA/.test(cards[1]));
  check('card B shows the paid/organic split and labels total views as "incl. paid" (never organic)', /75% paid/.test(cards[1]) && /2,000 organic/.test(cards[1]) && /All views incl\. paid · 28 d 8,000/i.test(cards[1]));
  check('revenue and expenses read "Not available" with a reason and the work needed', cards.every((t) => /Revenue: Not available/.test(t) && /Expenses: Not available/.test(t) && /Needed:/.test(t)) && !cards.some((t) => /\$\s?\d/.test(t)));
  check('"Likes, comments, shares: not available" states the missing metric', cards.every((t) => /Likes, comments, shares: not available/.test(t)));
  check('stale banner shown (data 5 days old)', cards.every((t) => /Detailed analytics end on/.test(t)));
  const lab = await txt(o.page, 'section.h2d .h2d-l'); check('no tile label calls total views organic', !lab.some((l) => /organic/i.test(l) && /all views|total/i.test(l)));
  const rec = await txt(o.page, 'section.h2d[data-biz="silk_road_voices"] li.h2d-rec'); check('recommendations rendered as ≤3 items with "Do next"', rec.length >= 1 && rec.length <= 3 && rec.every((r) => /Do next:/.test(r)));
  check('production detail stays on the business pages (links only; no task list on Home)', await o.page.evaluate(() => !!document.querySelector('section.h2d [data-h2="ws:SRV Farsi:production"]') && !document.querySelector('section.h2d .h2-kv')));
  check('Investment and SRV Circle cards still on Home; finance row still on Home', await o.page.evaluate(() => !!document.getElementById('h2Invest') && !!document.getElementById('h2Circle') && !!document.querySelector('.h2-grid.c4')));
  await o.page.evaluate(() => document.querySelector('section.h2d[data-biz="srv_studio"] [data-h2="ws:SRV English:analytics"]').click()); await settle(o.page, stub.origin, 800);
  check('"Detailed analytics" opens that business\'s analytics tab', await o.page.evaluate(() => /SRV English|SRV Studio/.test(document.getElementById('mainContent').innerText)));
  if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await o.page.evaluate(() => renderTab('home')); await settle(o.page, stub.origin, 800); await o.page.screenshot({ path: path.join(shotDir, 'synthetic-home.png') }); }
  check('no page errors', (o.pageErrors || []).length === 0, JSON.stringify(o.pageErrors || []));
  await o.page.close();
  // report failure → cards say so, the rest of Home still works
  mode = 'fail'; const o2 = await openPage(browser, stub.origin, { viewport: { width: 1440, height: 900 }, realClock: true }); await login(o2.page, stub.origin, 'admin'); await settle(o2.page, stub.origin, 1200);
  await o2.page.evaluate(() => renderTab('home')); await settle(o2.page, stub.origin, 1500);
  const c2 = await txt(o2.page, 'section.h2d'); check('report failure: both cards state the report could not be loaded (no invented numbers)', c2.length === 2 && c2.every((t) => /could not be loaded/.test(t) && !/\d{3,}/.test(t.replace(/\(.*?\)/g, ''))));
  check('report failure: Investment and finance sections still render', await o2.page.evaluate(() => !!document.getElementById('h2Invest') && !!document.querySelector('.h2-grid.c4')));
  await o2.page.close();
  // non-admin sessions: homepage is not active and growth_report is never requested
  mode = 'ok'; calls = []; const ids = await (async () => { const p = await browser.newPage(); await p.goto(stub.origin + '/'); await p.waitForFunction(() => typeof USERS !== 'undefined'); const r = await p.evaluate(() => USERS.map((u) => u.id).filter((i) => i !== 'admin')); await p.close(); return r; })();
  for (const id of ids.slice(0, 3)) { const o3 = await openPage(browser, stub.origin, { viewport: { width: 1280, height: 800 }, realClock: true }); try { await login(o3.page, stub.origin, id); await settle(o3.page, stub.origin, 1000); } catch { /* sign-in variants */ } const n = await o3.page.evaluate(() => document.querySelectorAll('section.h2d').length); check(`session "${id}": no CEO dashboard, no growth_report home request`, n === 0 && !calls.some((c) => c && c.home)); await o3.page.close(); }
} finally { await browser.close(); await stub.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`); process.exit(R.every(Boolean) ? 0 : 1);
