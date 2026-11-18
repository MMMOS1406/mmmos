// R-B trigger card in the real page (real Chrome, stub data proxy). The server action is MOCKED here (fetch override): nothing reaches Google; mock output is labeled as not real.
//   PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/growth/e2e_growth_probe_card.mjs [publicDir=public]
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public');
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + String(JSON.stringify(x)).slice(0, 300))); };
const stub = await startStub({ publicDir: pub, fixture: (() => { const f = makeFixture(); f.restFilter = true; return f; })(), quiet: true }); const browser = await launch();
try {
  const { page } = await openPage(browser, stub.origin, { realClock: true });
  await page.reload({ waitUntil: 'domcontentloaded' }); await login(page, stub.origin, 'admin'); await settle(page, stub.origin, 1500);
  const out = await page.evaluate(async () => {
    const calls = []; const realFetch = window.fetch;
    const mockResult = { ok: true, business: 'x', provenance: { real: false, note: 'mock' }, results: [], summary: { steps: 23, ok: 20, okEmpty: 0, unsupportedAsDocumented: 4, unexpectedlySupported: 0, badRequest: 0, forbidden: 0, quotaExceeded: 0, failed: 0, skipped: 0, latencyMs: { total: 2300, p50: 100, max: 100 }, quotaUnits: { data: 1, analytics: 20, reporting: 2 } }, capabilities: [{ cap: 'traffic_sources', documented: 'supported', verdict: 'retrievable' }, { cap: 'thumbnail_impressions_via_analytics_api', documented: 'unsupported', verdict: 'not_supported_confirmed' }], reach: { typesListed: ['channel_reach_basic_a1'], jobsExisting: [] }, reconcile: { totalViews: { api: 1000, studio: 1005, diffPct: -0.5, within1pct: true } } };
    window.fetch = async (u, i) => { const url = String(u && u.url || u); if (/action=growth_probe/.test(url)) { const b = JSON.parse(i.body); calls.push({ body: b, hdr: Object.keys(i.headers || {}).join(), method: i.method }); return new Response(JSON.stringify(b.dryRun ? { ok: true, dryRun: true, business: b.business, plan: new Array(23).fill({}), capabilities: [{ label: 'Traffic sources', documented: 'supported', live: 'NOT RUN' }] } : mockResult), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return realFetch(u, i); };
    const card = _growthProbeCardHtml(); const host = document.createElement('div'); host.id = 'gp-host'; host.innerHTML = card; document.body.appendChild(host);
    await growthProbeRun('srv_studio', 'plan'); const plan = document.getElementById('growth-probe-out').innerText;
    window.confirm = () => false; await growthProbeRun('srv_studio', 'live'); const declined = calls.length;
    window.confirm = () => true; document.getElementById('gp-views').value = '1005'; document.getElementById('gp-hrs').value = ''; await growthProbeRun('silk_road_voices', 'live'); const live = document.getElementById('growth-probe-out').innerText;
    const sess = typeof _ceoGetSessionToken === 'function' && !!_ceoGetSessionToken();
    window.fetch = realFetch; return { cardHasButtons: /Show plan/.test(card) && /Run live/.test(card), sess, plan, declined, calls, live, integ: (() => { try { return renderIntegrations().includes('YOUTUBE ANALYTICS PROBE'); } catch (e) { return String(e); } })() };
  });
  ok('the CEO page shows the probe card (two businesses, "Show plan" and "Run live") and it is part of the Integrations screen', out.sess && out.cardHasButtons && out.integ === true, out);
  ok('Show plan: dryRun request only (no confirmation field, no reference), CEO session header, POST, and the screen says PLAN ONLY — nothing was sent to Google', out.calls[0].body.dryRun === true && !out.calls[0].body.confirm && !out.calls[0].body.reference && /x-mmm-ceo-session/i.test(out.calls[0].hdr) && out.calls[0].method === 'POST' && /PLAN ONLY/.test(out.plan) && /nothing was sent to Google/.test(out.plan), out.calls[0]);
  ok('Run live: declining the confirmation sends NOTHING', out.declined === 1, out.declined);
  ok('Run live (confirmed): request carries the explicit confirmation string and the typed Studio figure as a number; business is the one clicked', out.calls.length === 2 && out.calls[1].body.confirm === 'RUN-LIVE-READ-ONLY-PROBE' && out.calls[1].body.business === 'silk_road_voices' && out.calls[1].body.reference.totalViews === 1005 && !('watchHours' in out.calls[1].body.reference), out.calls[1]);
  ok('the result is labeled NOT real YouTube data when provenance is not real, and shows summary, capability verdicts, Reach status and reconciliation', /NOT real YouTube data/.test(out.live) && /23 requests/.test(out.live) && /retrievable/.test(out.live) && /not_supported_confirmed/.test(out.live) && /channel_reach_basic_a1/.test(out.live) && /totalViews API 1000 vs Studio 1005/.test(out.live), out.live);
  const va = await (async () => { const o2 = await openPage(browser, stub.origin, { realClock: true }); await o2.page.reload({ waitUntil: 'domcontentloaded' }); await login(o2.page, stub.origin, 'va'); await settle(o2.page, stub.origin, 1200); return o2.page.evaluate(() => ({ html: _growthProbeCardHtml(), sess: !!_ceoGetSessionToken() })); })();
  ok('a VA session gets NO probe card (CEO session only)', va.html === '' && va.sess === false, va);
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
