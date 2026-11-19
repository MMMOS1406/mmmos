// R-C1 B in the REAL page (real Chrome, stub server, synthetic data): the Revenue / YPP card in Engines → Analytics.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/ypp/e2e_ypp_card.mjs [publicDir=public] [outDir]
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
import * as Y from '../../lib/yppCard.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public'); const outDir = process.argv[3] ? path.resolve(process.argv[3]) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const F = Y.YPP_BUSINESSES.silk_road_voices.channelId, S = Y.YPP_BUSINESSES.srv_studio.channelId;
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const cap = (over) => ({ captured_at: day(2), data_as_of: day(4), subscribers: 120, public_watch_hours_12m: 500, shorts_views_90d: 40000, shorts_views_rounded: true, uploads_90d: 4, tier_early: { subscribers: 500, uploads: 3, watch_hours: 3000, shorts_views: 3000000 }, tier_full: { subscribers: 1000, watch_hours: 4000, shorts_views: 10000000 }, status_text: 'Not yet eligible. Keep going.', captured_by: 'CEO session', source: 'YouTube Studio > Earn', ...over });
const payload = (store) => { const st = Y.parseCaptureStore(store); return { ok: true, perChannel: [{ channelId: F, engine: 'SRV Farsi', subscribers: 150, uploads30d: 2, uploads7d: 1 }, { channelId: S, engine: 'SRV English', subscribers: 20, uploads30d: 1, uploads7d: 0 }],
  ypp: { storeKey: Y.YPP_STORE_KEY, storePresent: st.present, storeErrors: st.errors, freshDays: 7, cards: Object.keys(Y.YPP_BUSINESSES).map((k) => Y.buildYppModel({ business: k, records: st.byChannel[Y.YPP_BUSINESSES[k].channelId] || [], nowMs: Date.now(), appCounters: { subscribers: k === 'srv_studio' ? 20 : 150 } })) } }; };
const fixture = makeFixture(); fixture.tables.youtube_channels = [{ channel_id: F, title: 'Business A', mmm_engine: 'SRV Farsi', subscribers: 150, total_views: 90000 }, { channel_id: S, title: 'Business B', mmm_engine: 'SRV English', subscribers: 20, total_views: 4000 }];
let current = payload(null), seenHeaders = []; fixture.api.revenue_dashboard = () => current;
const stub = await startStub({ publicDir: pub, fixture, quiet: true }); const browser = await launch();
try {
  const { page } = await openPage(browser, stub.origin, { realClock: true });
  await page.evaluateOnNewDocument(() => { const f = window.fetch; window.__revHeaders = []; window.fetch = function (u, i) { try { if (String(u && u.url || u).indexOf('revenue_dashboard') >= 0) window.__revHeaders.push(JSON.stringify((i && i.headers) || {})); } catch (e) {} return f.apply(this, arguments); }; });
  await page.reload({ waitUntil: 'domcontentloaded' }); await login(page, stub.origin, 'admin'); await settle(page, stub.origin, 1200);
  const show = async (scope) => page.evaluate(async (sc) => { window._analyticsScope = sc || ''; D.ypp = null; await loadYppCards(); const host = document.getElementById('ypp-test-host') || Object.assign(document.createElement('div'), { id: 'ypp-test-host' }); host.style.cssText = 'position:fixed;left:0;top:0;width:900px;z-index:99999;background:#0b0b10;color:#ddd;padding:12px'; host.innerHTML = _renderYppSection(); document.body.appendChild(host); return { html: host.innerHTML, text: host.innerText, headers: window.__revHeaders.slice() }; }, scope);
  // 1. nothing captured
  let r = await show('');
  ok('NOTHING CAPTURED: both businesses say "NOT CAPTURED" and eligibility "Unknown"; no figures, no zero', (r.text.match(/NOT CAPTURED/g) || []).length === 2 && (r.text.match(/Unknown — no official Studio Earn capture/g) || []).length === 2 && !/YPP-READY|\bready\b/i.test(r.text) && !/\b0\b/.test(r.text.replace(/\(\d+\)/g, '')), r.text.slice(0, 400));
  ok('the request carries the CEO session header (never in the URL)', r.headers.length >= 1 && /X-MMM-CEO-Session/.test(r.headers[0]));
  if (outDir) { const el = await page.$('#ypp-test-host'); await el.screenshot({ path: path.join(outDir, 'ypp-not-captured.png') }); }
  // 2. fresh capture for Business A only; stale for B
  current = payload({ [F]: [cap()], [S]: [cap({ captured_at: day(20), data_as_of: day(22), subscribers: 17, public_watch_hours_12m: 6, shorts_views_90d: 1200, status_text: 'Not yet eligible' })] });
  r = await show('');
  ok('FRESH capture for Silk Road Voices: "Not yet eligible", official figures, capture + data dates, Studio wording verbatim', /Not yet eligible — Studio's figures are below/.test(r.text) && /Qualified public watch hours|Qualified watch hours/.test(r.text) && /Keep going\./.test(r.text) && new RegExp(day(2)).test(r.text) && new RegExp(day(4)).test(r.text), r.text.slice(0, 500));
  ok('STALE capture for SRV Studio is labelled STALE with its age and eligibility unknown', /STALE — captured 20 days ago/.test(r.text) && /Unknown — the last Studio capture is 20 days old/.test(r.text), r.text.slice(0, 900));
  ok('the app subscriber counter is labelled as not an Earn figure', /app counter from the YouTube Data API — not an Earn figure/.test(r.text));
  if (outDir) { const el = await page.$('#ypp-test-host'); await el.screenshot({ path: path.join(outDir, 'ypp-fresh-and-stale.png') }); }
  // 3. scope isolation
  const far = await show('SRV Farsi'), eng = await show('SRV English');
  ok('ISOLATION by business scope: each workspace shows only its own card', /Silk Road Voices/.test(far.text) && !/SRV Studio/.test(far.text.replace(/SRV Farsi/g, '')) && /SRV Studio/.test(eng.text) && !/Silk Road Voices/.test(eng.text), [far.text.slice(0, 120), eng.text.slice(0, 120)]);
  // 4. VA / no CEO data
  current = { ok: true, perChannel: [], ypp: null }; r = await show('');
  ok('without a CEO session the card says official figures are CEO-only and shows nothing else', /CEO session only/.test(r.text) && !/Subscribers/.test(r.text));
  // 5. server error
  current = { __status: 500, ok: false, error: 'revenue_dashboard_failed', message: 'boom' }; r = await show('');
  ok('a server error is shown as an error — never as zeros or "ready"', /Could not read: boom/.test(r.text));
  // 6. mounted in Engines → Analytics
  current = payload({ [F]: [cap()] });
  const mounted = await page.evaluate(async () => { currentTab = 'engines'; D.ypp = null; setEnginesSub('analytics'); await new Promise((r) => setTimeout(r, 1500)); return { has: !!document.getElementById('yt-revenue-output'), txt: (document.getElementById('yt-revenue-output') || {}).innerText || '' }; });
  ok('the card is mounted inside Engines → Analytics and loads on entry', mounted.has && /REVENUE \/ YPP/.test(mounted.txt) && /Silk Road Voices/.test(mounted.txt), mounted.txt.slice(0, 200));
  const errs = await page.evaluate(() => window.__errs || []); ok('no page errors recorded', errs.length === 0, errs);
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
