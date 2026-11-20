// Home cards, Marketing & Sales KPIs and the detailed Analytics screen must show the SAME corrected numbers — real Chrome, stub data proxy, 100% SYNTHETIC rows.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/growth/e2e_home_marketing_cards.mjs [publicDir=public]
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
import { F, S, PULL, synthRowsF, synthRowsS } from './synthetic.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public');
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(x).slice(0, 400))); };
const iso = (d) => (d ? d + 'T00:49:00Z' : null);
const dbF = synthRowsF(), dbS = synthRowsS();
const rows = [...dbF, ...dbS].map((r) => ({ ...r, analytics_synced_at: iso(r.analytics_synced_at), synced_at: iso(r.synced_at), published_at: iso(r.published_at) }));
// independent oracle: latest-window, non-test rows only
const win = (db) => db.filter((r) => !/^\[test\]/i.test(r.title) && r.analytics_synced_at === PULL);
const sumV = (db) => win(db).reduce((a, r) => a + r.views, 0), sumS = (db) => win(db).reduce((a, r) => a + r.subs_gained, 0);
const legacyV = (db) => db.filter((r) => !/^\[test\]/i.test(r.title)).reduce((a, r) => a + r.views, 0);
const L = (n) => Number(n).toLocaleString();
ok('premise: the legacy all-rows sum differs from the window total for both businesses (so the test can tell them apart)', legacyV(dbF) > sumV(dbF) && legacyV(dbS) > sumV(dbS), [legacyV(dbF), sumV(dbF), legacyV(dbS), sumV(dbS)]);
const fixture = makeFixture(); fixture.restFilter = true;
fixture.tables.youtube_channels = [{ channel_id: F.channelId, title: 'Business A', mmm_engine: 'SRV Farsi', subscribers: 200, total_views: 90000, updated_at: iso(PULL) }, { channel_id: S.channelId, title: 'Business B ', mmm_engine: 'SRV English', subscribers: 30, total_views: 7000, updated_at: iso(PULL) }];
fixture.tables.youtube_videos_analytics = rows;
const stub = await startStub({ publicDir: pub, fixture, quiet: true }); const browser = await launch();
try {
  const o = await openPage(browser, stub.origin, { realClock: true }); const page = o.page;
  await page.evaluate(() => localStorage.removeItem('mmm_home_v2')); await page.reload({ waitUntil: 'domcontentloaded' });
  await login(page, stub.origin, 'admin'); await settle(page, stub.origin, 1500);
  await page.evaluate(() => renderTab('home')); await settle(page, stub.origin, 1800);
  const home = await page.evaluate(() => ({ cards: [...document.querySelectorAll('#mainContent .h2-grid.c3 .h2-card')].map((c) => ({ name: c.querySelector('h3').innerText.trim(), kv: Object.fromEntries([...c.querySelectorAll('.h2-kv')].map((r) => [r.querySelector('span').innerText.trim(), r.querySelector('b').innerText.trim()])) })), strip: (document.querySelector('#mainContent .h2-grid.c4 .h2-card[data-h2="analytics"]') || {}).innerText || '', all: document.getElementById('mainContent').innerText }));
  const vKey = (kv) => Object.keys(kv).find((k) => /^Views \(/.test(k)), sKey = (kv) => Object.keys(kv).find((k) => /^Subscribers gained/.test(k));
  const cA = home.cards.find((c) => c.name === 'SRV Farsi'), cB = home.cards.find((c) => c.name === 'SRV Studio');
  ok('Home: two business cards, each with a labeled analytics window (no "all synced videos")', !!cA && !!cB && /30-day window to /.test(vKey(cA.kv)) && !/all synced videos/.test(home.all), [cA && Object.keys(cA.kv), home.all.slice(0, 200)]);
  ok('Home: each business shows its CORRECTED window total (oracle), not the legacy all-rows sum', cA.kv[vKey(cA.kv)] === L(sumV(dbF)) && cB.kv[vKey(cB.kv)] === L(sumV(dbS)), [cA.kv, sumV(dbF), sumV(dbS)]);
  ok('Home: the legacy sums appear nowhere on the page', !home.all.includes(L(legacyV(dbF))) && !home.all.includes(L(legacyV(dbS))), [legacyV(dbF), legacyV(dbS)]);
  ok('Home: subscribers gained are the same-window attributed totals (labeled "same window")', cA.kv[sKey(cA.kv)] === '+' + L(sumS(dbF)) && cB.kv[sKey(cB.kv)] === '+' + L(sumS(dbS)) && /same window/.test(sKey(cA.kv)), [cA.kv, sumS(dbF), sumS(dbS)]);
  ok('Home: the analytics strip is labeled as the latest window and carries the same numbers', /latest analytics window/.test(home.strip) && home.strip.includes(L(sumV(dbF))) && home.strip.includes(L(sumV(dbS))) && !/all synced videos/.test(home.strip), home.strip);
  ok('Home: neither card shows zero, a dash or "Could not load" for views', ![cA, cB].some((c) => /^(0|—)$/.test(c.kv[vKey(c.kv)]) || /Could not load/.test(JSON.stringify(c))));
  ok('Home: isolation — business A card never carries business B numbers and vice versa', !JSON.stringify(cA.kv).includes(L(sumV(dbS)) + '"') && !JSON.stringify(cB.kv).includes(L(sumV(dbF)) + '"'));
  // the workspace overview page of one business
  const ov = await page.evaluate(() => { Home2.go('ws:SRV English:overview'); return new Promise((r) => setTimeout(() => r(document.getElementById('mainContent').innerText), 900)); });
  ok('workspace overview (business B): its own window total, labeled, and nothing of business A', ov.includes(L(sumV(dbS))) && /30-day window to /.test(ov) && !ov.includes(L(sumV(dbF))) && !ov.includes(L(legacyV(dbS))), ov.slice(0, 300));
  // Marketing & Sales
  const mk = await page.evaluate(() => { D.youtubeAnalytics = null; D._youtubeAnalyticsLoading = false; const loadingKpi = {}; _deptKPIs('marketing_sales', {}).forEach((k) => { loadingKpi[k.label] = k.value; }); return loadingKpi; });
  ok('Marketing & Sales while analytics is NOT loaded: YT VIEWS and YT SUBS GAINED show "—", never 0', mk['YT VIEWS'] === '—' && mk['YT SUBS GAINED'] === '—', mk);
  await page.evaluate(() => { Home2.go('marketing'); }); await settle(page, stub.origin, 2500);
  const mtxt = await page.evaluate(() => document.getElementById('mainContent').innerText);
  const kv = (label) => { const m = mtxt.match(new RegExp('([^\\n]+)\\s*\\n\\s*' + label)); return m ? m[1].trim() : null; };   // tile = value, then label
  const totV = sumV(dbF) + sumV(dbS), totS = sumS(dbF) + sumS(dbS), fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n));
  ok('Marketing & Sales (rendered tab): YT VIEWS = corrected total of both businesses, never 0', kv('YT VIEWS') === fmtK(totV) && kv('YT VIEWS') !== '0', [kv('YT VIEWS'), fmtK(totV)]);
  ok('Marketing & Sales (rendered tab): YT SUBS GAINED = attributed total, never +0', kv('YT SUBS GAINED') === '+' + totS && kv('YT SUBS GAINED') !== '+0', [kv('YT SUBS GAINED'), '+' + totS]);
  // detailed analytics (same data) — Home, Marketing and Detail must agree
  const det = await page.evaluate(async () => { await loadYouTubeAnalytics(); return D.youtubeAnalytics.perEngine.map((e) => ({ biz: e.ws.business, views: e.ws.metrics.views_window.value, subs: e.ws.metrics.subs_attributed_window.value })); });
  const dA = det.find((d) => d.biz === 'silk_road_voices'), dB = det.find((d) => d.biz === 'srv_studio');
  ok('Home, Marketing & Sales and Detailed Analytics agree: same window totals and subscribers for both businesses', dA.views === sumV(dbF) && dB.views === sumV(dbS) && dA.views + dB.views === totV && dA.subs + dB.subs === totS && cA.kv[vKey(cA.kv)] === L(dA.views) && cB.kv[vKey(cB.kv)] === L(dB.views), det);
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
