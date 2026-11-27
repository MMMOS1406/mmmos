// Content-strategy scorecards on the CEO homepage — browser test against the local stub with SYNTHETIC data. PUPPETEER_CORE=<dir> node tests/home2/e2e_content_strategy.mjs [screenshotDir]
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
import { buildHomeCard } from '../../lib/homeInsights.mjs'; import * as CS from '../../lib/contentStrategy.mjs';
const shotDir = process.argv[2]; const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const NOW = Date.now();
const win = (o) => ({ views: 3000, non_ad_views: 3000, paid_views: 0, paid_share_pct: 0, watch_hours: 40, net_subs: 9, from: '2026-10-21', to: '2026-11-17', status: 'complete', ...o });
const dash = (o) => ({ collected: true, freshness: { last_day: new Date(NOW - 5 * 864e5).toISOString().slice(0, 10), collected_at: new Date(NOW - 3 * 864e5).toISOString() },
  windows: { d28: win({}), d28_prev: win({ views: 2000, non_ad_views: 2000 }), d7: win({ views: 700, non_ad_views: 700 }), d7_prev: win({ views: 600, non_ad_views: 600 }) }, conversion: { per_1000_non_ad: 3, prev_per_1000_non_ad: 2 }, avd: { d28_sec: 70, prev28_sec: 60, d28_pct: 30 },
  trend: [], formats: { rows: [] }, videos: { top: [], total_views: 3000 }, retention: { curves: [] }, recommendations: [], ...o });
const ALPHA = dash({ channel_id: 'UC_A', videos: { top: [{ id: 'a1', title: 'ALPHA SONG ONE', views: 1500 }], total_views: 3000 }, recommendations: [{ id: 'paid_dependence', finding: 'ALPHA FINDING', priority: 'High', outcome: 'TEST', evidence: { metric: 'm', value: 'v', volume_ok: true }, diagnosis: { kind: 'confirmed', text: 't' }, action: 'ALPHA ACTION', success: 's' }] });
const BETA = dash({ channel_id: 'UC_B', windows: { d28: win({ views: 8000, non_ad_views: 2000, paid_views: 6000, paid_share_pct: 75 }), d28_prev: win({ views: 2000, non_ad_views: 2000 }), d7: win({}), d7_prev: win({}) }, videos: { top: [{ id: 'b1', title: 'BETA SONG ONE', views: 900 }], total_views: 8000 },
  formats: { window: { from: '2026-10-22', to: '2026-11-18' }, rows: [{ type: 'long', views: 400, watch_hours: 5, avg_view_duration_sec: 90, views_share_pct: 5 }, { type: 'short', views: 7600, watch_hours: 7, avg_view_duration_sec: 18, views_share_pct: 95 }] },
  recommendations: [{ id: 'more_shorts', finding: 'SHORTS WIN', priority: 'High', outcome: 'TEST', evidence: { metric: 'm', value: 'v', volume_ok: true }, diagnosis: { kind: 'hypothesis', text: 't' }, action: 'Produce three more Shorts this week.', success: 's' }] });
const mkCards = () => ({ silk_road_voices: buildHomeCard({ business: 'silk_road_voices', name: 'Silk Road Voices', dash: ALPHA, rows: [], counters: { subscribers: 40, history: [] }, pipeline: { last_ok_at: new Date(NOW - 36e5).toISOString(), last_status: 'healthy', steps_ok: '3/3' }, collection: { scheduled: false }, nowMs: NOW }),
  srv_studio: buildHomeCard({ business: 'srv_studio', name: 'SRV Studio', dash: BETA, rows: [], counters: { subscribers: 9, history: [] }, pipeline: null, nowMs: NOW }) });
let calls = []; let mode = 'ok';
const fx = makeFixture(); fx.restFilter = true;
fx.api.growth_report = async (json) => { calls.push(json); if (mode === 'fail') return { __status: 500, ok: false, error: 'growth_report_failed' }; const c = mkCards(); return { ok: true, role: 'ceo', reports: Object.entries(c).map(([b, v]) => ({ business: b, home_card: v })) }; };
const stub = await startStub({ publicDir: fs.realpathSync(new URL('../../public', import.meta.url).pathname), fixture: fx }); const browser = await launch();
const txt = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.innerText.replace(/\s+/g, ' ')), sel);
// ---- synthetic strategy objects (real library, synthetic inputs) ----
const vid = (n) => 'V' + String(n).padStart(10, '0'); const W = { from: '2026-10-22', to: '2026-11-18' };
function strat(business, longOnly) {
  const feats = {}, catalog = [], rows = [];
  for (let i = 1; i <= 14; i++) { feats[vid(i)] = { pkg: i, role: 'main', f: { ...CS.featuresOf({ d: {}, role: 'main', video: null }), format: 'long', vocal: i % 2 ? 'female' : 'male', mood: 'emotional' } }; catalog.push({ video_id: vid(i), title: 'Song ' + i, published_at: '2026-10-05T15:00:00Z', view_count: 100 }); rows.push({ id: vid(i), views: 60 + i * 7, pct: 38 + (i % 4), paid_views: 0 }); }
  const fd = { v: 1, business, at: new Date(NOW).toISOString(), report: { linked: 14, catalog_videos: 60, linked_pct: 23.3, conflicts: [] }, videos: feats };
  return (card) => CS.buildStrategy({ business, name: business, featureDoc: fd, catalog, videoRows: rows, window: W, advertising: 0, longOnly, card, nowMs: NOW });
}
const withStrategy = () => { const c = mkCards(); for (const [b, f] of [['silk_road_voices', strat('silk_road_voices', false)], ['srv_studio', strat('srv_studio', true)]]) c[b].strategy = f(c[b]); return c; };
fx.api.growth_report = async (json) => { calls.push(json); const c = withStrategy(); return { ok: true, role: 'ceo', reports: Object.entries(c).map(([b, v]) => ({ business: b, home_card: v })) }; };
try {
  const o = await openPage(browser, stub.origin, { viewport: { width: 1440, height: 900 }, realClock: true }); await login(o.page, stub.origin, 'admin'); await settle(o.page, stub.origin, 1200);
  await o.page.evaluate(() => renderTab('home')); await settle(o.page, stub.origin, 1500);
  const first = await txt(o.page, 'section.h2d');
  const heads = ['What is working', 'What is not working', 'Content strategy', 'What needs to change', 'Results of previous improvements'];
  check('each business scorecard has the six required sections in the CEO view', first.length === 2 && first.every((t) => heads.every((h) => t.toLowerCase().includes(h.toLowerCase())) && /(GROWING|DECLINING|FLAT|STABLE|INSUFFICIENT|UNPROVEN|CAN.T TELL|TOO SMALL)/.test(t)));
  const comps = await o.page.evaluate(() => [...document.querySelectorAll('section.h2d')].map((s) => [...s.querySelectorAll('.h2s-row')].map((r) => ({ label: r.querySelector('b').innerText, chip: r.querySelector('.h2s-chip').innerText }))));
  const labels = ['Music', 'Vocals', 'Lyrics', 'Visualizations', 'Opening and hook', 'Thumbnails', 'Titles', 'Publishing']; const vocab = ['Working', 'Needs improvement', 'Not working', 'Needs testing', 'Insufficient evidence'];
  check('the content strategy lists exactly the eight components, each with one of the five allowed status words', comps.every((c) => c.length === 8 && c.every((x, i) => x.label === labels[i] && vocab.includes(x.chip))), JSON.stringify(comps[0]));
  const chg = await o.page.evaluate(() => [...document.querySelectorAll('section.h2d')].map((s) => [...s.querySelectorAll('.h2s-chg li')].map((li) => li.innerText.replace(/\s+/g, ' '))));
  check('at most three recommended changes per business; each shows kind, why, baseline, target, owner and review date', chg.every((l) => l.length >= 1 && l.length <= 3 && l.every((t) => /(Proposed experiment|Confirmed correction)/i.test(t) && /Why:/.test(t) && /Baseline/.test(t) && /Target/.test(t) && /Owner/.test(t) && /Review/.test(t))), JSON.stringify(chg[0]).slice(0, 300));
  check('experiments are labelled as experiments and the only correction is the recording change', chg.every((l) => l.filter((t) => /Confirmed correction/i.test(t)).every((t) => /Start recording/.test(t))));
  check('SRV Studio scorecard never proposes or mentions producing Shorts (Long-only)', !/produce (three )?more Shorts|resume Shorts|Shorts? (video|upload)s? ?should/i.test(first[1]) && !/against about \d+ for the historical Shorts/.test(first[1]));
  if (process.env.DUMP) console.log('DUMP0:', first[0]);
  const words = first.map((t) => t.split(/\s+/).filter(Boolean).length);
  check('the CEO view stays short enough to read in about 30 seconds (under 450 words per business)', words.every((n) => n < 450), JSON.stringify(words));
  const fold = await o.page.evaluate(() => { const s = document.querySelector('section.h2d'); const h = [...s.querySelectorAll('.h2s-sec')].find((e) => /not working/i.test(e.innerText)); const r = s.querySelector('.h2s-top').getBoundingClientRect(); return { pillTop: Math.round(s.getBoundingClientRect().top), notWorkingBottom: h ? Math.round(h.getBoundingClientRect().bottom) : null, vh: window.innerHeight }; });
  check('first screen (1440×900): the first business shows its status, essential indicators, what is working and what is not working without scrolling', fold.notWorkingBottom !== null && fold.notWorkingBottom <= fold.vh, JSON.stringify(fold));
  const tech = ['ROOT CAUSE', 'Evidence rule', 'confidence', 'hypothesis', 'collection plan', 'Reporting API', 'p50', 'traffic-source coverage', 'reconciliation'];
  check('engineering terms are not in the CEO view (they live in Detailed analytics)', first.every((t) => tech.every((w) => !new RegExp(w, 'i').test(t))), JSON.stringify(tech.filter((w) => first.some((t) => new RegExp(w, 'i').test(t)))));
  const det = await o.page.evaluate(() => [...document.querySelectorAll('section.h2d')].map((s) => { const d = s.querySelector(':scope > details.h2s-det'); return { exists: !!d, open: d && d.open, text: d ? d.textContent : '' }; }));
  check('one Detailed analytics area per business, closed by default, holding the diagnosis, the old summary and how the content assessment was made', det.every((d) => d.exists && !d.open && /ROOT CAUSE|Evidence rule|diagnosis/i.test(d.text) && /Main problem/.test(d.text) && /How the content assessment was made/.test(d.text) && /linked to a production package/.test(d.text)));
  check('the separate Diagnosis section is no longer on the homepage (it moved into Detailed analytics)', await o.page.evaluate(() => ![...document.querySelectorAll('.h2-lab')].some((l) => /^Diagnosis/.test(l.innerText))));
  await o.page.evaluate(() => document.querySelector('section.h2d[data-biz="silk_road_voices"] details.h2s-det > summary').click()); await settle(o.page, stub.origin, 300);
  check('opening Detailed analytics shows the diagnosis and survives a repaint', await o.page.evaluate(() => { renderTab('home'); return document.querySelector('section.h2d[data-biz="silk_road_voices"] details.h2s-det').open === true; }));
  await o.page.evaluate(() => renderTab('home')); await settle(o.page, stub.origin, 600);
  const ov = await o.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('no horizontal overflow on desktop; no page errors', !ov && (o.pageErrors || []).length === 0, JSON.stringify(o.pageErrors || []));
  if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await o.page.evaluate(() => { renderTab('home'); }); await settle(o.page, stub.origin, 600); await o.page.screenshot({ path: path.join(shotDir, 'scorecards-desktop.png'), fullPage: false }); }
  await o.page.close();
  { const om = await openPage(browser, stub.origin, { viewport: { width: 390, height: 844 }, realClock: true }); await login(om.page, stub.origin, 'admin'); await settle(om.page, stub.origin, 1200); await om.page.evaluate(() => renderTab('home')); await settle(om.page, stub.origin, 1500);
    const g = await om.page.evaluate(() => ({ ov: document.documentElement.scrollWidth > window.innerWidth + 1, rows: [...document.querySelectorAll('.h2s-row')].every((r) => r.getBoundingClientRect().width <= window.innerWidth) }));
    check('mobile 390px: scorecards stack, nothing overflows horizontally', !g.ov && g.rows, JSON.stringify(g)); if (shotDir) await om.page.screenshot({ path: path.join(shotDir, 'scorecards-mobile.png') }); await om.page.close(); }
} finally { await browser.close(); await stub.close(); }
const p = R.filter(Boolean).length; console.log(`\n${p}/${R.length} passed`); process.exit(p === R.length ? 0 : 1);
