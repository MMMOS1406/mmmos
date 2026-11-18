// Analytics accuracy (R-A): window integrity, weighting, periods, isolation, labels — on 100% SYNTHETIC data with an independent oracle. node tests/growth/test_growth_analytics.mjs
import fs from 'node:fs';
import * as G from '../../lib/growthAnalytics.mjs';
import { F, S, PULL, synthRowsF, synthRowsS, synthCounters } from './synthetic.mjs';
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const dbF = synthRowsF(), dbS = synthRowsS();
const fRows = dbF.map(G.normaliseRow), sRows = dbS.map(G.normaliseRow);
const wf = G.buildWorkspace(fRows, { business: F, channel: { subscribers: 200, totalViews: 90000, updatedAt: PULL } });
const ws = G.buildWorkspace(sRows, { business: S, channel: { subscribers: 30, totalViews: 7000, updatedAt: PULL } });
const round1 = (x) => Math.round(x * 10) / 10;

// independent oracle: written from the definitions, not from the library
const oracle = (db) => { const real = db.filter((r) => !/^\[test\]/i.test(r.title)); const win = real.filter((r) => r.analytics_synced_at === PULL), old = real.filter((r) => r.analytics_synced_at !== PULL);
  const views = win.reduce((a, r) => a + r.views, 0), min = win.reduce((a, r) => a + r.watch_time_min, 0);
  const rr = win.filter((r) => r.views > 0); const wret = rr.reduce((a, r) => a + r.retention_pct * r.views, 0) / rr.reduce((a, r) => a + r.views, 0);
  const all = real; const unweighted = all.reduce((a, r) => a + r.retention_pct, 0) / all.length;
  return { views, hours: round1(min / 60), wret: round1(wret), avd: Math.round((min * 60) / views), staleViews: old.reduce((a, r) => a + r.views, 0), staleRows: old.length, legacyViews: real.reduce((a, r) => a + r.views, 0), unweighted, subs: win.reduce((a, r) => a + r.subs_gained, 0) }; };
const of = oracle(dbF), os = oracle(dbS);

// ── 1. corrected window totals equal the independent oracle; the legacy sum was inflated by older windows ──
ok('channel A: window views and watch hours equal the oracle', wf.metrics.views_window.value === of.views && wf.metrics.watch_hours_window.value === of.hours, [wf.metrics.views_window.value, of.views]);
ok('channel B: window views and watch hours equal the oracle', ws.metrics.views_window.value === os.views && ws.metrics.watch_hours_window.value === os.hours, [ws.metrics.views_window.value, os.views]);
ok('the legacy method summed old-window rows: it overstates both channels, and the overstatement equals the stale views', wf.legacy.views === of.legacyViews && wf.legacy.views - wf.metrics.views_window.value === of.staleViews && of.staleViews > 0 && ws.legacy.views - ws.metrics.views_window.value === os.staleViews && os.staleViews > 0, [wf.legacy.views, of]);
ok('stale values are reported, never summed', wf.excluded.staleViewsNotSummed === of.staleViews && wf.excluded.staleRows === of.staleRows && ws.excluded.staleViewsNotSummed === os.staleViews, wf.excluded);
ok('subscribers attributed to videos equal the oracle and are labeled "partial" (not the channel-level figure)', wf.metrics.subs_attributed_window.value === of.subs && wf.metrics.subs_attributed_window.status === 'partial');

// ── 2. weighting ──
ok('channel A retention is view-weighted (equals the oracle) and differs from the legacy unweighted mean, which the 2400% outlier inflates', wf.metrics.avg_view_pct_weighted.value === of.wret && Math.abs(wf.legacy.retentionUnweighted - of.unweighted) < 1e-9 && wf.legacy.retentionUnweighted > wf.metrics.avg_view_pct_weighted.value + 5, [wf.metrics.avg_view_pct_weighted.value, of.wret, wf.legacy.retentionUnweighted]);
ok('channel B retention equals the oracle; average view duration = watch time ÷ views', ws.metrics.avg_view_pct_weighted.value === os.wret && ws.metrics.avg_view_duration.value === os.avd && wf.metrics.avg_view_duration.value === of.avd, [ws.metrics.avg_view_duration.value, os.avd]);
{ const mk = (id, views, ret, min) => G.normaliseRow({ channel_id: S.channelId, video_id: id, views, retention_pct: ret, watch_time_min: min, analytics_synced_at: PULL, synced_at: PULL, title: 'x' });
  const w = G.buildWorkspace([mk('a', 1000, 50, 100), mk('b', 1, 100, 1), mk('c', 9, 2492.9, 5)], { business: S });
  ok('hand-computed: (1000×50 + 1×100 + 9×2492.9) ÷ 1010 = 71.8 and the >100% rows are disclosed, not capped', w.metrics.avg_view_pct_weighted.value === 71.8 && /more than 100%/.test(w.metrics.avg_view_pct_weighted.note), w.metrics.avg_view_pct_weighted);
  ok('hand-computed average view duration: 106 min × 60 ÷ 1010 views = 6 s', w.metrics.avg_view_duration.value === 6, w.metrics.avg_view_duration.value); }

// ── 3. stale-window protection, removed/unverified videos ──
{ const stale = G.normaliseRow({ channel_id: S.channelId, video_id: 'OLDVIDEO001', views: 999999, watch_time_min: 99999, subs_gained: 999, analytics_synced_at: '2029-01-01', synced_at: '2029-01-01', title: 'old' });
  const w2 = G.buildWorkspace([...sRows, stale], { business: S });
  ok('an old-window row with huge values changes NO window total', w2.metrics.views_window.value === ws.metrics.views_window.value && w2.metrics.watch_hours_window.value === ws.metrics.watch_hours_window.value && w2.excluded.staleRows === ws.excluded.staleRows + 1);
  ok('…it is flagged as unverified on the channel (a removed video is kept as history, excluded from totals)', w2.rows.unverifiedOnChannel === ws.rows.unverifiedOnChannel + 1); }
ok('[TEST] uploads are excluded from every total but counted', ws.rows.test === 2 && wf.rows.test === 3 && wf.metrics.views_window.value === of.views);

// ── 4. isolation ──
{ let threw = null; try { G.buildWorkspace([...sRows, fRows[0]], { business: S }); } catch (e) { threw = e.message; }
  ok('a foreign-channel row inside a workspace is refused (channel isolation violation)', /isolation violation/.test(threw || ''), threw);
  threw = null; try { G.buildWorkspace(fRows, { business: S }); } catch (e) { threw = e.message; }
  ok('a whole data set of the other business is refused', /isolation violation/.test(threw || ''), threw); }
ok('each workspace names only its own videos', wf.top.every((t) => fRows.some((r) => r.videoId === t.videoId)) && ws.top.every((t) => sRows.some((r) => r.videoId === t.videoId)) && !wf.top.some((t) => /^S/.test(t.videoId)) && !ws.top.some((t) => /^F/.test(t.videoId)));
ok('independent paths: the two window totals add up to the combined total (nothing lost, nothing shared)', wf.metrics.views_window.value + ws.metrics.views_window.value === of.views + os.views);
ok('the dominant video leads channel A and is reported with its real share of the period', wf.top[0].views === 9000 && Math.round((9000 / of.views) * 100) > 50, wf.top[0]);

// ── 5. labels: source, period, last sync, coverage, status on every metric; unavailable ≠ 0 ──
for (const [name, w] of [['channel A', wf], ['channel B', ws]]) {
  const bad = Object.values(w.metrics).filter((x) => !x.source || !x.period || !('lastSync' in x) || !('coverage' in x) || !x.status);
  ok(`${name}: every metric carries source, period, last sync, coverage and status`, !bad.length, bad.map((b) => b.key));
  ok(`${name}: window metrics name the dates; lifetime metrics say "lifetime"`, w.metrics.views_window.period.kind === 'window' && w.metrics.views_window.period.to === PULL && w.metrics.views_lifetime_channel.period.kind === 'lifetime' && w.metrics.views_lifetime_tracked.period.kind === 'lifetime');
  ok(`${name}: unavailable metrics are null with a reason and a plan — never 0`, w.unavailable.length === 8 && w.unavailable.every((u) => u.value === null && u.status === 'unavailable' && u.reason && u.plan));
}
ok('lifetime coverage is disclosed: tracked counters are not presented as the channel total', wf.metrics.views_lifetime_tracked.coverage.pct < 100 && wf.metrics.views_lifetime_tracked.status === 'partial', wf.metrics.views_lifetime_tracked.coverage);
{ const none = G.buildWorkspace([], { business: S }); ok('no analytics yet: metrics are unavailable (null), never zero', none.metrics.views_window.value === null && none.metrics.views_window.status === 'unavailable' && none.period === null); }
{ const old = G.buildWorkspace(sRows, { business: S, channel: { subscribers: 30, totalViews: 7000, updatedAt: '2030-03-10' } }); ok('a channel counter older than 2 days is marked stale', old.metrics.subscribers_total.status === 'stale' && ws.metrics.subscribers_total.status === 'ok'); }

// ── 6. reporting periods: lifetime / analytics window / 7-day / 28-day / custom are SEPARATE rows ──
{ const keys = (w) => w.periods.map((p) => p.key).join(',');
  ok('without counter history the period table has lifetime, analytics window, last 7, last 28 and custom — the last three are explicitly unavailable (not 0)', keys(wf) === 'lifetime,analytics_window,last_7,last_28,custom' && wf.periods.filter((p) => /^(last_7|last_28|custom)$/.test(p.key)).every((p) => p.status === 'unavailable' && p.views === null && /data-proxy|server-side/.test(p.note)), wf.periods);
  ok('lifetime is the channel counter and is a different row from the Analytics window (different numbers, never blended)', wf.periods[0].views === 90000 && wf.periods[1].views === of.views && wf.periods[0].views !== wf.periods[1].views);
  const cx = synthCounters('x'); const wc = G.buildWorkspace(fRows, { business: F, channel: { subscribers: 200, totalViews: 90000, updatedAt: PULL }, counterSeries: cx });
  const last = cx[cx.length - 1], at = (d) => cx.find((x) => x.date === d);
  const addD = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const o7 = last.totalViews - at(addD(last.date, -7)).totalViews, o28 = last.totalViews - at(addD(last.date, -28)).totalViews;
  const p7 = wc.periods.find((p) => p.key === 'last_7'), p28 = wc.periods.find((p) => p.key === 'last_28');
  ok('with counter history, last 7 and last 28 days equal the oracle (differences of the counter) and are separate from each other', p7.views === o7 && p28.views === o28 && p7.views !== p28.views && p7.status === 'ok' && p28.status === 'ok', [p7, p28, o7, o28]);
  ok('subscribers net change per period equals the oracle', p28.subscribers === last.subscribers - at(addD(last.date, -28)).subscribers);
  const cr = G.counterRange(cx, '2030-02-15', '2030-02-28'); ok('a custom range is computed from the same counters', cr.status === 'ok' && cr.views === at('2030-02-28').totalViews - at('2030-02-15').totalViews, cr);
  ok('a period longer than the counter history is "unavailable", not zero', G.counterRange(cx, '2029-06-01', '2030-02-28').status === 'unavailable' && G.counterRange(cx, '2029-06-01', '2030-02-28').views === null);
  const burst = G.dailyViews(cx).filter((d) => d.date >= '2030-02-20' && d.date <= '2030-02-25').reduce((a, d) => a + d.views, 0);
  ok('the daily series exposes a burst (campaign-like spike) without hiding it', burst >= 6 * 1500 - 100, burst);
  // historical counter reset / removed videos
  const dr = synthCounters('drop');
  const across = G.counterRange(dr, '2030-01-20', '2030-02-20');
  ok('a period that spans a counter DROP (removed videos) is "unreliable" for views — never reported as growth or as a negative number — while subscribers stay valid', across.status === 'unreliable' && across.views === null && typeof across.subscribersNet === 'number', across);
  const after = G.counterRange(dr, '2030-02-15', '2030-03-10'); ok('a period entirely after the drop is reliable', after.status === 'ok' && after.views > 0, after);
  ok('daily series marks the drop day as null (never a negative day)', G.dailyViews(dr).filter((d) => d.views === null).length === 1);
  ok('an empty counter series: no lifetime, no periods, no throw', G.counterPeriods([], '2030-01-01').lifetime === null);
  ok('lifetime / 7 / 28 / 90-day periods from counters: the 90-day period is unavailable when history is only 80 days', G.counterPeriods(cx, null, [7, 28, 90]).periods.find((p) => p.days === 90).status === 'unavailable'); }

// ── 7. Studio reconciliation mechanism (figures typed in by a person from the Studio reporting period; synthetic here) ──
{ const near = G.compareToStudio(wf, { views: Math.round(of.views * 1.004), watchHours: of.hours * 0.996, subsChannel: of.subs + 3 });
  ok('compareToStudio: figures within 1% reconcile; video-attributed subscribers below the channel-level figure are accepted as partial', near.views.ok && Math.abs(near.views.diffPct) <= 1 && near.watchHours.ok && near.subs.ok, near);
  const far = G.compareToStudio(wf, { views: Math.round(of.views * 1.3) }); ok('compareToStudio: a 30% difference is NOT ok (the check can fail)', far.views.ok === false, far);
  ok('the legacy overstatement is reported as a percentage', typeof near.legacyOverstatementPct === 'number' && near.legacyOverstatementPct > 0, near.legacyOverstatementPct); }

// ── 8. repository hygiene: no real data in tests, page copy identical, library does no I/O ──
ok('public page copy is byte-identical to the library', fs.readFileSync(new URL('../../lib/growthAnalytics.mjs', import.meta.url), 'utf8') === fs.readFileSync(new URL('../../public/growth/growthAnalytics.mjs', import.meta.url), 'utf8'));
{ const dir = new URL('./', import.meta.url); const files = fs.readdirSync(dir); ok('tests/growth contains no data files (psv/csv/json/export) — only code', files.every((f) => /\.(mjs|js)$/.test(f)), files);
  const src = fs.readFileSync(new URL('../../lib/growthAnalytics.mjs', import.meta.url), 'utf8'); ok('the library performs no network or file I/O', !/\bfetch\(|require\(|from 'node:(fs|http|https|net)'|XMLHttpRequest/.test(src)); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
