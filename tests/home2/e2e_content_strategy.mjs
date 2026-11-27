// FINAL CEO homepage (2026-11-27): one compact, mobile-first card per YouTube business — browser test against the local stub with SYNTHETIC data. PUPPETEER_CORE=<dir> node tests/home2/e2e_content_strategy.mjs [screenshotDir]
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
fx.api.growth_report = async (json) => { calls.push(json); if (mode === 'fail') return { __status: 500, ok: false, error: 'growth_report_failed' }; const c = mkCards(); for (const [b, v] of Object.entries(c)) v.view = buildCardView({ card: v, strategy: null, business: b, nowMs: NOW }); return { ok: true, role: 'ceo', reports: Object.entries(c).map(([b, v]) => ({ business: b, home_card: v })) }; };
const stub = await startStub({ publicDir: fs.realpathSync(new URL('../../public', import.meta.url).pathname), fixture: fx }); const browser = await launch();
const txt = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.innerText.replace(/\s+/g, ' ')), sel);
const vid = (n) => 'V' + String(n).padStart(10, '0'); const W = { from: '2026-10-22', to: '2026-11-18' };
function strat(business, longOnly) {
  const feats = {}, catalog = [], rows = [];
  for (let i = 1; i <= 14; i++) { feats[vid(i)] = { pkg: i, role: 'main', f: { ...CS.featuresOf({ d: {}, role: 'main', video: null }), format: 'long', vocal: i % 2 ? 'female' : 'male', mood: 'emotional' } }; catalog.push({ video_id: vid(i), title: 'Song ' + i, published_at: '2026-10-05T15:00:00Z', view_count: 100 }); rows.push({ id: vid(i), views: 60 + i * 7, pct: 38 + (i % 4), paid_views: 0 }); }
  const fd = { v: 1, business, at: new Date(NOW).toISOString(), report: { linked: 14, catalog_videos: 60, linked_pct: 23.3, conflicts: [] }, videos: feats };
  return (card) => CS.buildStrategy({ business, name: business, featureDoc: fd, catalog, videoRows: rows, window: W, advertising: 0, longOnly, card, nowMs: NOW });
}
const withView = () => { const c = mkCards(); for (const [b, f] of [['silk_road_voices', strat('silk_road_voices', false)], ['srv_studio', strat('srv_studio', true)]]) { c[b].strategy = f(c[b]); c[b].view = CS.buildCardView({ card: c[b], strategy: c[b].strategy, business: b, nowMs: NOW }); } return c; };
const api = []; fx.api.growth_report = async (json) => { calls.push(json); const c = withView(); return { ok: true, role: 'ceo', reports: Object.entries(c).map(([b, v]) => ({ business: b, home_card: v })) }; };
fx.api.growth_improvement_start = async (json) => { api.push(['start', json]); return { ok: true, item: { id: 'imp_test_1' }, rev: 1 }; };
fx.api.growth_improvement_update = async (json) => { api.push(['update', json]); return { ok: true }; };
const tagCalls = []; fx.api.growth_tags_set = async (json) => { tagCalls.push(json); return { ok: true, video_id: json.video_id, tags: json.tags, rev: 1 }; };
const VOCAB = ['Working', 'Needs improvement', 'Not working', 'Needs testing', 'Not enough data'];
try {
  for (const [w, h] of [[1440, 900], [430, 932], [390, 844], [375, 812]]) {
    const o = await openPage(browser, stub.origin, { viewport: { width: w, height: h }, realClock: true }); await login(o.page, stub.origin, 'admin'); await settle(o.page, stub.origin, 1200);
    await o.page.evaluate(() => renderTab('home')); await settle(o.page, stub.origin, 1500);
    const g = await o.page.evaluate(() => { const cs = [...document.querySelectorAll('section.h2f')].map((s) => s.getBoundingClientRect()); return { n: cs.length, ov: document.documentElement.scrollWidth > window.innerWidth + 1, tops: cs.map((r) => Math.round(r.top)), lefts: cs.map((r) => Math.round(r.left)), widths: cs.map((r) => Math.round(r.width)), vw: window.innerWidth, inner: [...document.querySelectorAll('section.h2f *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length }; });
    check(`${w}px: exactly two cards and no horizontal scrolling (page or any element)`, g.n === 2 && !g.ov && g.inner === 0, JSON.stringify(g));
    check(w >= 900 ? `${w}px (desktop): the two cards sit side by side` : `${w}px (phone): the cards are stacked vertically, full width`, w >= 900 ? Math.abs(g.tops[0] - g.tops[1]) <= 2 && g.lefts[0] < g.lefts[1] : g.tops[0] < g.tops[1] && Math.abs(g.lefts[0] - g.lefts[1]) <= 1 && g.widths.every((x) => x >= g.vw - 40), JSON.stringify(g));
    { const kv = await o.page.evaluate(() => [...document.querySelectorAll('section.h2f .h2f-v')].map((e) => ({ ws: getComputedStyle(e).whiteSpace, unit: getComputedStyle(e.querySelector('small')).display, h: Math.round(e.getBoundingClientRect().height) })));
      check(`${w}px: indicator numbers never wrap (a wide display font made "3,952" break on a real phone): nowrap, unit on its own line`, kv.length >= 6 && kv.every((x) => x.ws === 'nowrap' && x.unit === 'block'), JSON.stringify(kv[0])); }
    if (w <= 430) { const t = await o.page.evaluate(() => [...document.querySelectorAll('section.h2f button, section.h2f a[data-h2]')].map((e) => Math.round(e.getBoundingClientRect().height))); check(`${w}px: touch targets are at least 44px tall`, t.length >= 2 && t.every((x) => x >= 44), JSON.stringify(t));
      const fs = await o.page.evaluate(() => [...document.querySelectorAll('section.h2f li, section.h2f .h2f-r')].map((e) => parseFloat(getComputedStyle(e).fontSize))); check(`${w}px: body text is at least 13px`, fs.length && fs.every((x) => x >= 13), JSON.stringify([Math.min(...fs)])); }
    if (w === 1440) {
      const T = await txt(o.page, 'section.h2f');
      check('each card: name + status, the three indicators with their 28-day period, working / not working / content strategy / what needs to change / CEO decision / data freshness / one Analytics link', T.length === 2 && T.every((t) => /(GROWING|DECLINING|STABLE|TOO EARLY TO JUDGE)/i.test(t) && /Organic growth/i.test(t) && /Subscriber growth/i.test(t) && /Organic watch time/i.test(t) && /Last 28 days/i.test(t) && /What is working/i.test(t) && /What is not working/i.test(t) && /Content strategy/i.test(t) && /What needs to change/i.test(t) && (/No decision needed\./.test(t) || /Approve/.test(t)) && /(Data through|No data yet)/.test(t) && /Detailed analytics/.test(t)), T[0].slice(0, 200));
      const comps = await o.page.evaluate(() => [...document.querySelectorAll('section.h2f')].map((s) => [...s.querySelectorAll('.h2f-r')].map((r) => ({ l: r.children[0].innerText, c: r.children[1].innerText }))));
      const labels = ['Music', 'Vocals and lyrics', 'Visualizations', 'Thumbnails and titles', 'Publishing strategy'];
      check('content strategy: exactly the five requested areas, each with one of the five allowed labels', comps.every((c) => c.length === 5 && c.every((x, i) => x.l === labels[i] && VOCAB.includes(x.c))), JSON.stringify(comps[0]));
      const chg = await o.page.evaluate(() => [...document.querySelectorAll('section.h2f')].map((s) => [...s.querySelectorAll('.h2f-ol li')].map((li) => li.innerText.replace(/\s+/g, ' '))));
      check('what needs to change: at most two items, each starting with the action (Test / Fix / Continue / Improve / Replace)', chg.every((l) => l.length >= 1 && l.length <= 2 && l.every((t) => /^(Test|Fix|Continue|Improve|Replace):/.test(t))), JSON.stringify(chg[0]));
      const words = T.map((t) => t.split(/\s+/).filter(Boolean).length);
      check('each card is short enough to take in within 15–30 seconds (under 230 words)', words.every((n) => n < 230), JSON.stringify(words));
      const tech = ['ROOT CAUSE', 'Evidence rule', 'confidence', 'hypothesis', 'collection plan', 'API', 'p50', 'coverage', 'reconciliation', 'Insufficient evidence', 'median', 'sample', 'cohort', 'baseline'];
      check('no technical terminology on the homepage', T.every((t) => tech.every((x) => !new RegExp(x, 'i').test(t))), JSON.stringify(tech.filter((x) => T.some((t) => new RegExp(x, 'i').test(t)))));
      check('no tables, headings repeated or extra buttons: the only controls are Approve (when a decision is needed) and the Analytics link', await o.page.evaluate(() => !document.querySelector('section.h2f table') && [...document.querySelectorAll('section.h2f button')].every((b) => /Approve/.test(b.innerText)) && [...document.querySelectorAll('section.h2f')].every((s) => s.querySelectorAll('[data-h2]').length === 1)));
      check('SRV Studio card: Long-only policy line, no mention of Shorts', T[1].includes('Long videos only') && !/Shorts?/i.test(T[1]));
      check('Silk Road Voices card keeps Creative V2 unchanged', /Creative V2/.test(T[0]));
      check('the old long scorecard and diagnosis are NOT on the homepage', await o.page.evaluate(() => !document.querySelector('section.h2d, section.h2dx, details')));
      // CEO decision: approval → start + approve through the existing improvement API; message shown
      const decs = await o.page.evaluate(() => [...document.querySelectorAll('section.h2f .h2f-b')].length); check('a genuine decision (a creative experiment) shows one Approve button; the engineering correction does not', decs >= 1 && decs <= 2, decs);
      await o.page.evaluate(() => document.querySelector('section.h2f[data-biz="silk_road_voices"] .h2f-b').click()); await settle(o.page, stub.origin, 900);
      check('Approve starts the test and approves it (existing improvement API, CEO session) and says so', api.length === 2 && api[0][0] === 'start' && /^packaging_test:silk_road_voices$/.test(api[0][1].key) && api[1][0] === 'update' && api[1][1].patch.approval.status === 'approved' && api[1][1].id === 'imp_test_1', JSON.stringify(api).slice(0, 300));
      if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await o.page.evaluate(() => renderTab('home')); await settle(o.page, stub.origin, 800); await o.page.screenshot({ path: path.join(shotDir, 'home-desktop.png') }); }
      await o.page.evaluate(() => document.querySelector('section.h2f[data-biz="srv_studio"] [data-h2]').click()); await settle(o.page, stub.origin, 1200);
      check('the Detailed analytics link opens the business Analytics tab, which carries the full detail (diagnosis, summary, evidence)', await o.page.evaluate(() => !!document.getElementById('h2AnPanel') && !!document.querySelector('#h2AnPanel section.h2dx') && /Main problem/.test(document.getElementById('h2AnPanel').textContent)));
    }
    if (w === 1440) {
      await o.page.evaluate(() => { const d = document.querySelector('#h2AnPanel details.h2s-tg'); d.open = true; const b = d.querySelector('.h2s-tgb'); b.querySelector('[data-tg="opening_visual"]').value = 'avatar_close'; b.querySelector('[data-tg="thumb_variant"]').value = 'A'; });
      const vopts = await o.page.evaluate(() => [...document.querySelectorAll('#h2AnPanel [data-tg="video_id"] option')].map((x) => x.value));
      await o.page.evaluate(() => document.querySelector('#h2AnPanel [data-tag-save]').click()); await settle(o.page, stub.origin, 600);
      check('Analytics → "Record production details": lists the business\'s recent linked Longs and saves the chosen tags through the CEO-session action (the capture path for opening, motion, thumbnail, genre, vocal style)', vopts.length >= 1 && tagCalls.length === 1 && tagCalls[0].business === 'srv_studio' && tagCalls[0].video_id === vopts[0] && tagCalls[0].tags.opening_visual === 'avatar_close' && tagCalls[0].tags.thumb_variant === 'A' && /Saved/.test(await o.page.evaluate(() => document.querySelector('#h2AnPanel .h2s-tgm').textContent)), JSON.stringify([vopts.length, tagCalls]));
      check('saving with nothing chosen is refused in the form (no request is sent)', await o.page.evaluate(async () => { const b = document.querySelector('#h2AnPanel .h2s-tgb'); b.querySelector('[data-tg="opening_visual"]').value = ''; b.querySelector('[data-tg="thumb_variant"]').value = ''; document.querySelector('#h2AnPanel [data-tag-save]').click(); return /at least one detail/.test(b.querySelector('.h2s-tgm').textContent); }) && tagCalls.length === 1);
    }
    if (shotDir && w === 390) { await o.page.evaluate(() => renderTab('home')); await settle(o.page, stub.origin, 800); await o.page.screenshot({ path: path.join(shotDir, 'home-mobile-390.png'), fullPage: true }); }
    check(`${w}px: no page errors`, (o.pageErrors || []).length === 0, JSON.stringify(o.pageErrors || []));
    await o.page.close();
  }
} finally { await browser.close(); await stub.close(); }
const p = R.filter(Boolean).length; console.log(`\n${p}/${R.length} passed`); process.exit(p === R.length ? 0 : 1);
