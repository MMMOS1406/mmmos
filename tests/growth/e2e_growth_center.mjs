// Growth Decision Center in the REAL page (real Chrome, stub server, SYNTHETIC data): mounted in Engines → Analytics, both businesses, business scoping, states, collection button.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/growth/e2e_growth_center.mjs [publicDir=public] [outDir]
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
import * as C from '../../lib/growthCollect.mjs'; import * as D from '../../lib/growthDecisions.mjs'; import * as Y from '../../lib/yppCard.mjs';
import { makeWorld, addDays } from './collect_fixtures.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public'); const outDir = process.argv[3] ? path.resolve(process.argv[3]) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const END = '2030-03-14', NOW = Date.parse('2030-03-15T18:00:00Z');
const titles = { vidAAAAAAA1: 'Evening Persian Mix (synthetic)', vidAAAAAAA2: 'Single song A (synthetic)', vidAAAAAAA3: 'Single song B (synthetic)' };
const rep = async (b, over, collection, doc0 = true) => { const w = makeWorld(b, over); const run = await C.runCollection({ business: b, steps: C.collectSteps({ to: END }), fetchJson: w.fetchJson, now: () => NOW }); const doc = doc0 ? C.mergeCollection(null, run, { business: b, from: addDays(END, -27), to: END, nowIso: new Date(NOW).toISOString() }) : null; const d = D.buildDashboard({ business: b, doc, nowMs: NOW, titles, ypp: Y.buildYppModel({ business: b, records: [], nowMs: NOW }), fallback: doc ? null : { period: { from: '2030-02-01', to: '2030-02-28' }, metrics: { views_window: { label: 'Views (period)', value: 1200, unit: 'views', status: 'ok' }, subs_attributed_window: { label: 'Subscribers attributed', value: null, unit: 'subs', status: 'unavailable' } } } }); d.collection = collection; return d; };
const repA = await rep('silk_road_voices', { paidFrom: addDays(END, -12), paidTo: addDays(END, -4), paidPerDay: 400 }, { manual_authorized: true, manual_until: '2030-03-15T19:00:00Z', manual_reason: null, scheduled: false, last: { at: '2030-03-15T17:00:00Z', steps: { channel_totals: 'ok' }, requests: { analytics: 19 }, aborted: null } });
const repB = await rep('srv_studio', { seed: 5, basePerDay: 18 }, { manual_authorized: false, manual_until: null, manual_reason: 'collection_not_authorized', scheduled: false, last: null }, false);
let current = { ok: true, role: 'ceo', reports: [repA, repB] }, bodies = [], collectBodies = [];
const fixture = makeFixture(); fixture.api.growth_report = (json) => { bodies.push(json); return current; }; fixture.api.growth_collect = (json) => { collectBodies.push(json); return { ok: true, business: json.business, days_stored: 90, reconciliation: true, steps: {} }; };
const stub = await startStub({ publicDir: pub, fixture, quiet: true }); const browser = await launch();
try {
  const { page } = await openPage(browser, stub.origin, { realClock: true });
  await page.evaluateOnNewDocument(() => { window.__dialogs = []; window.confirm = (m) => { window.__dialogs.push(['confirm', String(m)]); return true; }; window.alert = (m) => { window.__dialogs.push(['alert', String(m)]); }; const f = window.fetch; window.__gr = []; window.fetch = function (u, i) { try { if (String(u && u.url || u).indexOf('growth_report') >= 0) window.__gr.push(JSON.stringify((i && i.headers) || {})); } catch (e) {} return f.apply(this, arguments); }; });
  await page.reload({ waitUntil: 'domcontentloaded' }); await login(page, stub.origin, 'admin'); await settle(page, stub.origin, 1200);
  const show = async (scope) => page.evaluate(async (sc) => { window._analyticsScope = sc || ''; D.gdc = null; await loadGrowthCenter(); const host = document.getElementById('gdc-test-host') || Object.assign(document.createElement('div'), { id: 'gdc-test-host' }); host.style.cssText = 'position:absolute;left:0;top:0;width:1000px;z-index:99999;background:#0b0b10;color:#ddd;padding:12px'; host.innerHTML = _renderGrowthCenterSection(); document.body.appendChild(host); return { text: host.innerText, html: host.innerHTML, headers: window.__gr.slice() }; }, scope);
  let r = await show('');
  ok('BOTH businesses render, each as its own card', (r.html.match(/class="gdc-card"/g) || []).length === 2 && /Silk Road Voices/.test(r.text) && /SRV Studio/.test(r.text));
  ok('Silk Road Voices (collected): performance, paid share, traffic with PAID, formats, videos, retention, conversion, trend, reconciliation, decisions', ['PERFORMANCE', 'Paid share', '(PAID)', 'LONG / SHORT / MIX', 'TOP / BOTTOM VIDEOS', 'RETENTION', 'SUBSCRIBER CONVERSION', 'WEEKLY TREND', 'RECONCILIATION', 'GROWTH DECISIONS'].every((x) => r.text.toUpperCase().includes(x.toUpperCase())));
  ok('SRV Studio (not collected): "database snapshot only", the snapshot values with "—" for unknown, and a High WAIT FOR DATA decision', /SOURCE: DATABASE SNAPSHOT ONLY/i.test(r.text) && /Views \(period\)\s+1,200/.test(r.text) && /Subscribers attributed\s+—/.test(r.text) && /WAIT FOR DATA/.test(r.text));
  ok('the request carries the CEO session in a header; the response role drives the "Collect now" button (CEO + authorized only, and only on the authorized business)', /X-MMM-CEO-Session/.test(r.headers[0]) && (r.html.match(/Collect now/g) || []).length === 1 && /growthCollectNow\('silk_road_voices'\)/.test(r.html));
  ok('no undefined / NaN / null / Infinity on the screen', !/undefined|NaN|\bnull\b|Infinity/.test(r.text.replace(/\s+/g, ' ')));
  if (outDir) { await page.setViewport({ width: 1100, height: 900 }); const el = await page.$('#gdc-test-host'); await el.screenshot({ path: path.join(outDir, 'growth-center-both.png') }); }
  const far = await show('SRV Farsi'), eng = await show('SRV English');
  ok('SCOPE ISOLATION: the Silk Road Voices workspace shows only its card; the SRV Studio workspace only its card', (far.html.match(/class="gdc-card"/g) || []).length === 1 && /Silk Road Voices/.test(far.text) && !/SRV Studio/.test(far.text.replace(/SRV Farsi/g, '')) && (eng.html.match(/class="gdc-card"/g) || []).length === 1 && /SRV Studio/.test(eng.text) && !/Silk Road Voices/.test(eng.text));
  // collect now
  await page.evaluate(() => { window._analyticsScope = ''; }); await show('');
  await page.evaluate(() => growthCollectNow('silk_road_voices')); await new Promise((x) => setTimeout(x, 600));
  const dlg = await page.evaluate(() => window.__dialogs);
  ok('"Collect now" asks for confirmation (read-only, ~20 requests), then posts the typed confirmation for THAT business only, and reports the result', dlg[0][0] === 'confirm' && /read-only/i.test(dlg[0][1]) && collectBodies.length === 1 && collectBodies[0].business === 'silk_road_voices' && collectBodies[0].confirm === 'COLLECT-ANALYTICS-READ-ONLY' && dlg.some((d) => d[0] === 'alert' && /Collection finished/.test(d[1])), { dlg, collectBodies });
  // VA role
  current = { ok: true, role: 'operator', reports: [{ ...repA, collection: null }, { ...repB, collection: null }] }; r = await show('');
  ok('VA role: same analytics but no collection state and NO "Collect now" button', !/Collect now/.test(r.html) && !/Collection: manual/.test(r.text) && /Silk Road Voices/.test(r.text));
  // errors
  current = { __status: 401, ok: false, error: 'session_required' }; r = await show(''); ok('an auth error is shown as an error, not as empty analytics or zeros', /Could not read: session_required/.test(r.text) && !/Views/.test(r.text));
  // mounted
  current = { ok: true, role: 'ceo', reports: [repA, repB] };
  const m = await page.evaluate(async () => { currentTab = 'engines'; D.gdc = null; D.ypp = null; setEnginesSub('analytics'); await new Promise((x) => setTimeout(x, 1800)); const g = document.getElementById('growth-center'), y = document.getElementById('yt-revenue-output'); return { g: !!g, y: !!y, gt: g ? g.innerText.slice(0, 200) : '', order: g && y ? (g.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? 'growth-before-revenue' : 'other') : null, cards: g ? g.querySelectorAll('.gdc-card').length : 0 }; });
  ok('mounted in Engines → Analytics (above the Revenue / YPP card), loads on entry', m.g && m.y && m.order === 'growth-before-revenue' && m.cards === 2, m);
  const errs = await page.evaluate(() => window.__errs || []); ok('no page errors recorded', errs.length === 0, errs);
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
