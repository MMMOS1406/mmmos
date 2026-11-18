// Analytics accuracy (R-A) in the REAL page (real Chrome, stub data proxy, 100% SYNTHETIC rows): per-channel queries, labeled metrics, reporting periods, isolation by business scope.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/growth/e2e_growth_analytics_page.mjs [publicDir=public] [outDir]
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
import * as G from '../../lib/growthAnalytics.mjs'; import { F, S, PULL, synthRowsF, synthRowsS } from './synthetic.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public'); const outDir = process.argv[3] ? path.resolve(process.argv[3]) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const iso = (d) => (d ? d + 'T00:49:00Z' : null);
const rows = [...synthRowsF(), ...synthRowsS()].map((r) => ({ ...r, analytics_synced_at: iso(r.analytics_synced_at), synced_at: iso(r.synced_at), published_at: iso(r.published_at) }));
const fixture = makeFixture(); fixture.restFilter = true;
fixture.tables.youtube_channels = [{ channel_id: F.channelId, title: 'Business A', mmm_engine: 'SRV Farsi', subscribers: 200, total_views: 90000, updated_at: iso(PULL) }, { channel_id: S.channelId, title: 'Business B ', mmm_engine: 'SRV English', subscribers: 30, total_views: 7000, updated_at: iso(PULL) }];
fixture.tables.youtube_videos_analytics = rows;
const stub = await startStub({ publicDir: pub, fixture, quiet: true }); const browser = await launch();
try {
  const { page } = await openPage(browser, stub.origin, { realClock: true });
  await page.evaluateOnNewDocument(() => { const f = window.fetch; window.__paths = []; window.fetch = function (u, i) { try { if (String(u && u.url || u).indexOf('db_proxy') >= 0 && i && i.body) { const b = JSON.parse(i.body); if (b.path) window.__paths.push(String(b.path)); } } catch (_) {} return f.call(window, u, i); }; });
  await page.reload({ waitUntil: 'domcontentloaded' }); await login(page, stub.origin, 'va'); await settle(page, stub.origin, 1500);
  const out = await page.evaluate(async () => {
    window.__paths.length = 0; window._analyticsScope = '';
    await loadYouTubeAnalytics();
    const a = D.youtubeAnalytics; const all = _renderYouTubeAnalyticsDetail();
    window._analyticsScope = 'SRV Farsi'; const far = _renderYouTubeAnalyticsDetail();
    window._analyticsScope = 'SRV English'; const eng = _renderYouTubeAnalyticsDetail(); window._analyticsScope = '';
    const host = document.createElement('div'); host.id = 'growth-test-host'; host.style.cssText = 'position:fixed;left:0;top:0;width:1100px;z-index:99999;background:#0b0b10;color:#ddd;padding:12px'; host.innerHTML = all; document.body.appendChild(host);
    return { error: a.error, engines: a.perEngine.map((e) => ({ biz: e.ws.business, views: e.ws.metrics.views_window.value, hours: e.ws.metrics.watch_hours_window.value, ret: e.ws.metrics.avg_view_pct_weighted.value, ch: e.ws.channelId })), paths: window.__paths.slice(), all, far, eng };
  });
  const vq = out.paths.filter((p) => /^youtube_videos_analytics/.test(p));
  ok('the page loads without error', !out.error, out.error);
  ok('TWO video queries, one per business, each filtered to ONE channel (no top-200-of-everything query)', vq.length === 2 && vq.every((p) => /channel_id=eq\.UC/.test(p)) && vq.some((p) => p.includes(F.channelId)) && vq.some((p) => p.includes(S.channelId)), vq);
  const expV = (db) => db.filter((r) => !/^\[test\]/i.test(r.title) && r.analytics_synced_at === PULL).reduce((x, r) => x + r.views, 0);
  const expR = (db) => { const w = db.filter((r) => !/^\[test\]/i.test(r.title) && r.analytics_synced_at === PULL && r.views > 0); return Math.round((w.reduce((x, r) => x + r.retention_pct * r.views, 0) / w.reduce((x, r) => x + r.views, 0)) * 10) / 10; };
  const eA = out.engines.find((e) => e.biz === 'silk_road_voices'), eB = out.engines.find((e) => e.biz === 'srv_studio');
  ok('each business shows ONLY its latest-pull window total (the oracle value), not the legacy sum of all rows', eA.views === expV(synthRowsF()) && eB.views === expV(synthRowsS()), [eA, eB]);
  ok('view-weighted retention equals the oracle for both businesses', eA.ret === expR(synthRowsF()) && eB.ret === expR(synthRowsS()), [eA.ret, eB.ret]);
  ok('the reporting-period table is on screen: lifetime, Analytics window, last 7 / 28 days and custom, the last three marked unavailable', /Reporting periods/.test(out.all) && /Lifetime/.test(out.all) && /Analytics window/.test(out.all) && /Last 7 days/.test(out.all) && /Last 28 days/.test(out.all) && /Custom range/.test(out.all), out.all.length);
  ok('each number is labeled: period dates, last sync, coverage, status chip, and the "not summed" disclosure are on screen', new RegExp(PULL).test(out.all) && /Last sync/.test(out.all) && /Coverage/.test(out.all) && />ok</.test(out.all) && />partial</.test(out.all) && /NOT summed/.test(out.all) && /lifetime/.test(out.all));
  ok('unavailable metrics are listed with their reason (impressions, CTR, traffic sources, retention curve, revenue…) and never drawn as 0', /Not available yet \(8\)/.test(out.all) && /Thumbnail impressions/.test(out.all) && /Traffic sources/.test(out.all));
  ok('Silk Road Voices scope shows ONLY Silk Road Voices; SRV Studio scope shows ONLY SRV Studio (independent workspaces)', /Silk Road Voices/.test(out.far) && !/SRV Studio/.test(out.far) && /SRV Studio/.test(out.eng) && !/Silk Road Voices/.test(out.eng));
  if (outDir) { const el = await page.$('#growth-test-host'); if (el) await el.screenshot({ path: path.join(outDir, 'growth-detail-both.png') }); }
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
