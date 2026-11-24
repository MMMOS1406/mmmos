// Growth Decision Center — the dashboard model and the recommendation engine for ONE business. PURE: no network, database or clock (the caller passes `nowMs`).
// Input: the business's collected document (lib/growthCollect.mjs) or null, video titles, the R-A database workspace (fallback), the official Studio Earn model (lib/yppCard.mjs) or null.
// Rules enforced in code and tests:
//  - a missing number is null ("—"), never 0; a window with missing days is labelled partial with "n of m days"; paid (advertising) views are never counted as organic growth;
//  - CTR, impressions, ad spend, paid-subscriber attribution and Earn eligibility are never produced here (listed under "not available" with the reason);
//  - every recommendation has Finding, Evidence (exact metric + period), Diagnosis (confirmed | hypothesis), Recommended action, Priority, Success measure and ONE outcome
//    (CONTINUE / IMPROVE / TEST / WAIT FOR DATA); a creative or publishing change is never recommended from low aggregate volume — it becomes WAIT FOR DATA;
//  - nothing here reads or mixes another business's data (the document's channel id must match the business).
import { PROBE_CHANNELS } from './growthProbe.mjs';
import { judgeCheck } from './growthCollect.mjs';

export const OUTCOMES = Object.freeze(['CONTINUE', 'IMPROVE', 'TEST', 'WAIT FOR DATA']);
export const PRIORITIES = Object.freeze(['High', 'Medium', 'Low']);
export const MIN = Object.freeze({ windowNonAdViews: 500, weekNonAdViews: 100, convNonAdViews: 1000, videoViews: 100, staleDays: 3 });
const DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const ptDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
const isDateKey = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const pct = (n) => (n === null || n === undefined ? '—' : r1(n) + '%');

// ── windows over the daily series ──
export function windowOf(days, end, n) {
  const from = addDays(end, -(n - 1)); let present = 0, views = 0, minutes = 0, gained = 0, lost = 0, paid = 0, paidKnown = 0;
  for (let i = 0; i < n; i++) { const d = days[addDays(from, i)]; if (!d || d.views === null || d.views === undefined) continue; present++; views += d.views; minutes += d.minutes || 0; gained += d.subs_gained || 0; lost += d.subs_lost || 0; if (d.paid_views !== null && d.paid_views !== undefined) { paidKnown++; paid += d.paid_views; } }
  if (!present) return { from, to: end, days: n, present: 0, status: 'unavailable', views: null, watch_hours: null, net_subs: null, paid_views: null, non_ad_views: null, paid_share_pct: null };
  const paidAll = paidKnown === present;
  return { from, to: end, days: n, present, status: present === n ? 'complete' : 'partial', views, watch_hours: r1(minutes / 60), net_subs: gained - lost, paid_views: paidAll ? paid : null, non_ad_views: paidAll ? views - paid : null, paid_share_pct: paidAll && views > 0 ? r1((paid / views) * 100) : null, paid_days_known: paidKnown };
}
const delta = (a, b) => (a === null || b === null || b === 0 || a === undefined || b === undefined ? null : r1(((a - b) / b) * 100));

// ── retention analysis for one curve [[ratio, audienceWatchRatio], …] ──
export function analyzeCurve(points) {
  const p = (points || []).filter((x) => Array.isArray(x) && x[0] !== null && x[1] !== null).sort((a, b) => a[0] - b[0]);
  if (p.length < 10) return null;
  const at = (t) => { let best = null; for (const [r, v] of p) { if (r <= t + 1e-9) best = v; else break; } return best; };
  let worst = null; for (let i = 0; i < p.length; i++) { const t0 = p[i][0]; const j = p.findIndex(([r]) => r >= t0 + 0.1 - 1e-9); if (j < 0) break; const d = p[i][1] - p[j][1]; if (!worst || d > worst.drop) worst = { from_pct: Math.round(t0 * 100), to_pct: Math.round(p[j][0] * 100), drop: r2(d) }; }
  return { points: p.length, at10: r2(at(0.1)), at25: r2(at(0.25)), at50: r2(at(0.5)), at75: r2(at(0.75)), end: r2(p[p.length - 1][1]), worst_segment: worst && worst.drop > 0 ? worst : null };
}

const UNAVAILABLE = Object.freeze([
  { key: 'ctr', label: 'Thumbnail impressions and click-through rate', reason: 'Not offered by the YouTube Analytics API (confirmed by a 400 in the live probe); the Reporting API Reach reports are not enabled and no job exists.' },
  { key: 'ad_spend', label: 'Advertising spend, cost per view, cost per subscriber', reason: 'YouTube reports ad VIEWS, never what was paid; spend exists only in Google Ads billing.' },
  { key: 'paid_subs', label: 'Subscribers gained from paid views', reason: 'Not available from the API (subscriber metrics are excluded from traffic-source reports); never inferred.' },
  { key: 'returning', label: 'New / casual / regular viewers', reason: 'No API field confirmed.' },
  { key: 'earn', label: 'Partner Program eligibility and qualified watch hours', reason: 'Only YouTube Studio → Earn states these (see the Revenue / YPP card).' },
]);

// ── dashboard ──
// opts: { business, doc, nowMs, titles:{videoId:title}, fallback:{...R-A summary}|null, ypp:model|null }
export function buildDashboard(opts) {
  const { business, doc, nowMs } = opts; const want = PROBE_CHANNELS[business]; if (!want) throw new Error('unknown business');
  if (doc && doc.channel_id !== want) throw new Error(`channel isolation violation: document of ${doc.channel_id} given to ${business}`);
  const today = ptDate(nowMs); const d = { business, channel_id: want, generated_at: new Date(nowMs).toISOString(), source: doc ? 'collected_youtube_analytics' : 'database_snapshot', collected: !!doc, unavailable: UNAVAILABLE, windows: null, traffic: null, formats: null, videos: null, retention: null, conversion: null, trend: null, avd: null, reconciliation: null, freshness: null, fallback: opts.fallback || null };
  const hasDays = !!(doc && doc.days && Object.keys(doc.days).length);
  if (!doc || (!hasDays && !(doc.periods && doc.periods[0]))) {
    d.collected = false; d.source = 'database_snapshot'; d.sanitized = doc && doc.sanitized ? doc.sanitized : null;
    d.freshness = { status: 'not_collected', last_day: null, age_days: null, collected_at: null, note: 'Detailed collection has not run for this business: only the database snapshot (R-A) is available.' };
    d.reconciliation = { status: 'not_available', note: 'Reconciliation needs a collection run.' };
    d.recommendations = recommend(d, opts); return d;
  }
  d.sanitized = doc.sanitized || null;
  const days = doc.days || {}, keys = Object.keys(days).sort(), last = keys.length ? keys[keys.length - 1] : doc.periods[0].to;
  const age = Math.round((Date.parse(today) - Date.parse(last)) / DAY);
  d.freshness = { status: age <= MIN.staleDays - 1 ? 'fresh' : 'stale', last_day: last, age_days: age, collected_at: doc.updated_at, days_stored: keys.length, first_day: keys.length ? keys[0] : doc.periods[0].from, note: age <= MIN.staleDays - 1 ? 'Latest complete day is ' + last : `Latest stored day is ${last}, ${age} days ago — collection is behind` };
  const w = (n, end = last) => windowOf(days, end, n);
  if (hasDays) d.windows = { day: w(1), d7: w(7), d7_prev: w(7, addDays(last, -7)), d28: w(28), d28_prev: w(28, addDays(last, -28)) };
  else {   // period totals only (the daily series is missing or its step failed): 28-day figures come from the channel totals; everything that needs daily rows is unavailable, never zero
    const pr = doc.periods[0], none = (n, end) => windowOf({}, end, n), fromTotals = (t, from, to, n, paidViews) => (t && t.views !== null && t.views !== undefined ? { from, to, days: n, present: n, status: 'complete', views: t.views, watch_hours: r1(t.minutes / 60), net_subs: t.subs_gained === null || t.subs_lost === null ? null : t.subs_gained - t.subs_lost, paid_views: paidViews, non_ad_views: paidViews === null ? null : t.views - paidViews, paid_share_pct: paidViews === null || !t.views ? null : r1((paidViews / t.views) * 100), paid_days_known: paidViews === null ? 0 : n, from_totals: true } : none(n, to));
    const paid28 = pr.traffic ? pr.traffic.filter((x) => x.paid).reduce((a, x) => a + (x.views || 0), 0) : null;
    d.windows = { day: none(1, last), d7: fromTotals(pr.totals_7d, addDays(last, -6), last, 7, null), d7_prev: none(7, addDays(last, -7)), d28: fromTotals(pr.totals, pr.from, pr.to, 28, paid28), d28_prev: fromTotals(pr.totals_prev, addDays(pr.from, -28), addDays(pr.from, -1), 28, null) };
  }
  d.windows.delta = { views_7d_pct: delta(d.windows.d7.views, d.windows.d7_prev.views), non_ad_views_7d_pct: delta(d.windows.d7.non_ad_views, d.windows.d7_prev.non_ad_views), views_28d_pct: delta(d.windows.d28.views, d.windows.d28_prev.views), non_ad_views_28d_pct: delta(d.windows.d28.non_ad_views, d.windows.d28_prev.non_ad_views) };
  const per = doc.periods && doc.periods[0] ? doc.periods[0] : null;
  if (per) {
    const t = per.totals, t7 = per.totals_7d, tp = per.totals_prev;
    d.avd = { window: { from: per.from, to: per.to }, d28_sec: t ? t.avg_view_duration_sec : null, d28_pct: t ? r1(t.avg_view_pct) : null, d7_sec: t7 ? t7.avg_view_duration_sec : null, prev28_sec: tp ? tp.avg_view_duration_sec : null, note: 'Average view duration includes paid views; it is shown for the whole channel, not organic-only.' };
    d.traffic = per.traffic ? { window: { from: per.from, to: per.to }, rows: per.traffic.map((x) => ({ ...x })).sort((a, b) => b.views - a.views), total_views: per.traffic.reduce((a, x) => a + (x.views || 0), 0), paid_views: per.traffic.filter((x) => x.paid).reduce((a, x) => a + (x.views || 0), 0) } : null;
    if (d.traffic) { d.traffic.paid_share_pct = d.traffic.total_views > 0 ? r1((d.traffic.paid_views / d.traffic.total_views) * 100) : null; d.traffic.non_ad_views = d.traffic.total_views - d.traffic.paid_views; }
    const sub = per.subscribed; const subViews = sub ? sub.reduce((a, x) => a + (x.views || 0), 0) : null; const subd = sub ? sub.find((x) => x.status === 'SUBSCRIBED') : null;
    // subscriber conversion: net subscribers per 1,000 NON-ADVERTISING views (only when paid views are known for the window)
    const nonAd = d.windows.d28.non_ad_views, nonAdPrev = d.windows.d28_prev.non_ad_views;
    const conv = (netSubs, na) => (netSubs === null || na === null || na < MIN.convNonAdViews ? null : r2((netSubs / na) * 1000));
    d.conversion = { window: { from: d.windows.d28.from, to: d.windows.d28.to }, net_subs: d.windows.d28.net_subs, non_ad_views: nonAd, per_1000_non_ad: conv(d.windows.d28.net_subs, nonAd), prev_per_1000_non_ad: conv(d.windows.d28_prev.net_subs, nonAdPrev), subscribed_view_share_pct: subd && subViews ? r1((subd.views / subViews) * 100) : null, note: 'Net subscribers = gained − lost. Subscribers from paid views cannot be separated (not offered by the API); the rate is shown only against non-advertising views.' };
    if (per.formats) {
      const tv = per.formats.reduce((a, x) => a + (x.views || 0), 0), tm = per.formats.reduce((a, x) => a + (x.minutes || 0), 0);
      d.formats = { window: { from: per.from, to: per.to }, rows: per.formats.map((x) => ({ type: x.type, raw: x.raw, views: x.views, watch_hours: r1(x.minutes / 60), avg_view_duration_sec: x.avg_view_duration_sec, views_share_pct: tv ? r1((x.views / tv) * 100) : null, watch_share_pct: tm ? r1((x.minutes / tm) * 100) : null })), mix: null, unrecognized: per.formats.filter((x) => x.type === 'unrecognized').map((x) => x.raw) };
    }
  }
  // videos: top / bottom, with titles joined by the caller; Mix = a LONG video whose title contains "mix" (title-based, labelled)
  if (doc.videos && doc.videos.rows) {
    const titles = opts.titles || {}; const rows = doc.videos.rows.map((v) => ({ id: v.id, title: titles[v.id] || null, views: v.views, watch_hours: r1(v.minutes / 60), avg_view_duration_sec: v.avg_view_duration_sec, avg_view_pct: r1(v.avg_view_pct), subs_gained: v.subs_gained, is_mix: /\bmix\b|میکس/i.test(titles[v.id] || '') }));
    const byViews = [...rows].sort((a, b) => b.views - a.views); const total = rows.reduce((a, v) => a + (v.views || 0), 0);
    d.videos = { window: { from: doc.videos.from, to: doc.videos.to }, count: rows.length, total_views: total, top: byViews.slice(0, 5), bottom: byViews.slice(-5).reverse().map((v) => ({ ...v, low_volume: v.views < MIN.videoViews })), titled: rows.filter((v) => v.title).length, note: 'Bottom videos are the lowest by views in the period; videos under ' + MIN.videoViews + ' views are marked low volume and are not evidence of anything.' };
    if (d.formats) { const mix = rows.filter((v) => v.is_mix); d.formats.mix = { by: 'title contains "mix"', videos: mix.length, views: mix.reduce((a, v) => a + (v.views || 0), 0), watch_hours: r1(mix.reduce((a, v) => a + (v.watch_hours || 0), 0)), titled_coverage_pct: rows.length ? r1((d.videos.titled / rows.length) * 100) : null }; }
  }
  // retention curves
  const ret = [];
  for (const vid of Object.keys(doc.retention || {})) { const c = doc.retention[vid], vrow = doc.videos && doc.videos.rows ? doc.videos.rows.find((v) => v.id === vid) : null; const all = analyzeCurve(c.all), org = analyzeCurve(c.organic); if (!all && !org) continue; ret.push({ video_id: vid, title: (opts.titles || {})[vid] || null, window: { from: c.from, to: c.to }, views: vrow ? vrow.views : null, all, organic: org, all_points: c.all || null, organic_points: c.organic || null }); }
  d.retention = ret.length ? { curves: ret, organic_available: ret.some((x) => x.organic), note: 'Audience retention is per video (one request per video); the organic-only curve excludes paid-ad viewers.' } : null;
  // weekly trend: last 8 complete 7-day buckets
  d.trend = hasDays ? [] : null; if (hasDays) for (let i = 7; i >= 0; i--) { const wk = windowOf(days, addDays(last, -7 * i), 7); d.trend.push({ from: wk.from, to: wk.to, status: wk.status, views: wk.views, non_ad_views: wk.non_ad_views, watch_hours: wk.watch_hours, net_subs: wk.net_subs }); }
  if (doc.reconciliation) {   // re-judged from the stored numbers with the current rule (the stored `ok` may come from an older, stricter rule)
    const r0 = doc.reconciliation; let r = r0;
    if (hasDays && r0.window && isDateKey(r0.window.from) && isDateKey(r0.window.to)) {   // the daily sums are recomputed from the stored daily rows, so a row changed after the collection is caught too
      const inWin = keys.filter((k) => k >= r0.window.from && k <= r0.window.to), sm = (f) => inWin.reduce((a, k) => a + (f(days[k]) || 0), 0);
      const fresh = { views: sm((x) => x.views), watch_minutes: sm((x) => x.minutes), net_subscribers: sm((x) => x.subs_gained) - sm((x) => x.subs_lost) };
      r = { ...r0, days_present: inWin.length, checks: r0.checks.map((c) => (c.metric in fresh ? { ...c, daily_sum: fresh[c.metric] } : c)) };
    }
    const checks = r.checks.map((c) => ({ ...c, ...judgeCheck(c.metric, c.channel_total, c.daily_sum, r.days_present) }));
    d.reconciliation = { ...r, checks, status: checks.every((c) => c.ok !== false) ? (r.days_present === r.days_expected ? 'reconciled' : 'partial_days') : 'MISMATCH', rule: 'Daily watch minutes are whole minutes, so each reporting day may differ by up to 1 minute from the channel total (allowed difference = max(1, 1%) + 1 minute per present day for watch minutes; views and subscribers use max(1, 1%)). Missing days are not excused.', studio: 'No official Studio figure is stored; compare with YouTube Studio manually (the first live reconciliation matched net subscribers exactly and was within 5.1% on views and watch hours).' };
  } else d.reconciliation = { status: 'not_available', note: 'No reconciliation stored.' };
  d.recommendations = recommend(d, opts);
  return d;
}

// ── recommendations ──
const ok6 = (r) => ['finding', 'evidence', 'diagnosis', 'action', 'priority', 'success', 'outcome'].every((k) => r[k] !== undefined && r[k] !== null && r[k] !== '');
// The contract. Returns { ok, errors[] }; never throws.
export function validateDecision(r) {
  const e = []; if (!r || typeof r !== 'object') return { ok: false, errors: ['not an object'] };
  if (!ok6(r)) e.push('missing field');
  if (!OUTCOMES.includes(r.outcome)) e.push('outcome must be one of ' + OUTCOMES.join(' / '));
  if (!PRIORITIES.includes(r.priority)) e.push('priority');
  if (!r.diagnosis || !['confirmed', 'hypothesis'].includes(r.diagnosis.kind) || !r.diagnosis.text) e.push('diagnosis must be confirmed or hypothesis, with text');
  if (!r.evidence || !r.evidence.metric || !r.evidence.period || !r.evidence.period.from || !r.evidence.period.to || r.evidence.value === undefined || r.evidence.value === null) e.push('evidence needs exact metric, period and value');
  if (r.creative === true && r.outcome !== 'WAIT FOR DATA' && !(r.evidence && r.evidence.volume_ok === true)) e.push('a creative/publishing change needs sufficient volume — otherwise WAIT FOR DATA');
  if (r.diagnosis && r.diagnosis.kind === 'hypothesis' && /\b(because|caused by|is why|proves?)\b/i.test(r.diagnosis.text)) e.push('a hypothesis must not use causal certainty');
  return { ok: e.length === 0, errors: e };
}
const mk = (o) => ({ creative: false, ...o });
function recommend(d, opts) {
  const out = []; const biz = opts.business; const win = (w) => ({ from: w.from, to: w.to });
  const wait = (id, finding, evidence, action, success, pr = 'High') => out.push(mk({ id, finding, evidence, diagnosis: { kind: 'confirmed', text: 'This is a state of the data pipeline, not an inference about the audience.' }, action, priority: pr, success, outcome: 'WAIT FOR DATA' }));
  // 1. data readiness / freshness
  if (!d.collected) {
    const fb = d.fallback; wait('collection_off', 'Detailed analytics collection has not run for this business, so daily trends, paid vs organic, retention and format splits are not available.',
      { metric: 'collected analytics document', period: { from: fb && fb.period ? fb.period.from : 'n/a', to: fb && fb.period ? fb.period.to : 'n/a' }, value: 'not collected', volume_ok: false }, 'Authorize collection (one backfill run, then daily). Until then use only the database snapshot figures shown, labelled as such.', 'Daily series covers at least 28 days and the latest day is no more than 2 days old.');
    out.push(...monetization(d, opts)); return finish(out);
  }
  if (d.freshness.status === 'stale') wait('stale', `Collected analytics are ${d.freshness.age_days} days behind (latest stored day ${d.freshness.last_day}).`, { metric: 'latest stored day', period: { from: d.freshness.first_day, to: d.freshness.last_day }, value: d.freshness.last_day, volume_ok: false }, 'Run collection again or check why the scheduled run stopped (quota / permission errors are shown in the collection log). Do not act on these figures until refreshed.', 'Latest stored day is yesterday (Pacific) or the day before.');
  const rc = d.reconciliation; if (rc && rc.status === 'MISMATCH') wait('reconcile', 'Collected daily totals do not match the channel totals for the same window.', { metric: rc.checks.filter((c) => c.ok === false).map((c) => c.metric).join(', ') + ' difference beyond the allowed tolerance' + (rc.days_present < rc.days_expected ? ` (${rc.days_present} of ${rc.days_expected} days present)` : ''), period: rc.window, value: rc.checks.filter((c) => c.ok === false).map((c) => `${c.metric} ${c.diff_pct}% (${c.daily_sum} vs ${c.channel_total}; allowed ±${c.allowed})`).join('; '), volume_ok: false }, 'Investigate before trusting trends: check for missing days or a partial last day.', 'Daily sums equal channel totals within the allowed tolerance.');
  const w28 = d.windows.d28, w7 = d.windows.d7, w7p = d.windows.d7_prev;
  // 2. paid vs organic
  if (w28.paid_share_pct !== null) {
    const share = w28.paid_share_pct, ev = { metric: 'paid (advertising) views ÷ all views', period: win(w28), value: `${fmt(w28.paid_views)} of ${fmt(w28.views)} (${pct(share)}); non-advertising ${fmt(w28.non_ad_views)}`, volume_ok: w28.non_ad_views >= MIN.windowNonAdViews };
    if (share >= 50) out.push(mk({ id: 'paid_dependence', finding: `${pct(share)} of the last 28 days' views came from paid advertising.`, evidence: ev, diagnosis: { kind: 'confirmed', text: 'YouTube traffic-source report: source type ADVERTISING (paid ads). Reported views, watch time and average view duration include these views.' }, action: 'Judge channel growth on non-advertising views only. Before changing any creative, run one comparison period without ads so organic behaviour can be read on its own.', priority: 'High', success: 'Non-advertising views and net subscribers per 1,000 non-advertising views are tracked weekly, separately from paid views.', outcome: 'TEST' }));
    else if (share < 10) out.push(mk({ id: 'organic_led', finding: `Traffic is organic-led: ${pct(share)} of the last 28 days' views were paid.`, evidence: ev, diagnosis: { kind: 'confirmed', text: 'YouTube traffic-source report: source type ADVERTISING.' }, action: 'Keep the current approach; read all figures as organic.', priority: 'Low', success: 'Paid share stays below 10% unless a paid campaign is planned.', outcome: 'CONTINUE' }));
    else out.push(mk({ id: 'mixed_traffic', finding: `${pct(share)} of the last 28 days' views were paid; the rest is non-advertising.`, evidence: ev, diagnosis: { kind: 'confirmed', text: 'YouTube traffic-source report: source type ADVERTISING.' }, action: 'Read growth on the non-advertising figure; keep paid views out of organic conclusions.', priority: 'Medium', success: 'Non-advertising views are reported alongside the total every week.', outcome: 'CONTINUE' }));
  } else out.push(mk({ id: 'paid_unknown', finding: 'Paid vs non-advertising views cannot be separated for the last 28 days.', evidence: { metric: 'days with a paid-views value', period: win(w28), value: `${w28.paid_days_known === undefined ? 0 : w28.paid_days_known} of ${w28.days}`, volume_ok: false }, diagnosis: { kind: 'confirmed', text: 'The daily paid report is missing for part of the window.' }, action: 'Wait for the next collection run to fill the daily paid series; do not treat total views as organic.', priority: 'Medium', success: 'Paid views known for all 28 days.', outcome: 'WAIT FOR DATA' }));
  // 3. week over week, non-advertising
  if (w7.non_ad_views !== null && w7p.non_ad_views !== null) {
    const ch = delta(w7.non_ad_views, w7p.non_ad_views), enough = w7p.non_ad_views >= MIN.weekNonAdViews && w7.non_ad_views >= MIN.weekNonAdViews;
    const ev = { metric: 'non-advertising views, 7 days vs previous 7 days', period: { from: w7p.from, to: w7.to }, value: `${fmt(w7.non_ad_views)} vs ${fmt(w7p.non_ad_views)} (${ch === null ? '—' : (ch > 0 ? '+' : '') + ch + '%'})`, volume_ok: enough };
    if (!enough || ch === null) out.push(mk({ id: 'wow_low_volume', finding: 'Week-over-week change in non-advertising views is too small to read.', evidence: ev, diagnosis: { kind: 'confirmed', text: `Fewer than ${MIN.weekNonAdViews} non-advertising views in at least one week; a percentage on a count this small is noise.` }, action: 'Do not change creative or publishing on this signal. Re-read after another 7 days.', priority: 'Low', success: 'At least 100 non-advertising views per week on both sides of the comparison.', outcome: 'WAIT FOR DATA' }));
    else if (ch >= 25) out.push(mk({ id: 'wow_up', finding: `Non-advertising views rose ${ch}% week over week.`, evidence: ev, diagnosis: { kind: 'confirmed', text: 'Same-length windows from the daily series with paid views removed.' }, action: 'Keep the current cadence; note which uploads fell in the stronger week.', priority: 'Medium', success: 'Non-advertising views stay at or above this week level over the next two weeks.', outcome: 'CONTINUE' }));
    else if (ch <= -25) out.push(mk({ id: 'wow_down', finding: `Non-advertising views fell ${Math.abs(ch)}% week over week.`, evidence: ev, diagnosis: { kind: 'hypothesis', text: 'Possible fewer or later uploads, or a promoted title aging out; not tested.' }, action: 'Compare upload dates and traffic sources of the two weeks before changing anything.', priority: 'Medium', success: 'Cause identified from the two-week comparison, then non-advertising views recover to within 10% of the earlier week.', outcome: 'IMPROVE', creative: false }));
    else out.push(mk({ id: 'wow_flat', finding: `Non-advertising views are stable week over week (${(ch > 0 ? '+' : '') + ch}%).`, evidence: ev, diagnosis: { kind: 'confirmed', text: 'Same-length windows from the daily series with paid views removed.' }, action: 'Keep the current approach.', priority: 'Low', success: 'Within ±25% week over week.', outcome: 'CONTINUE' }));
  }
  // 4. subscriber conversion
  const cv = d.conversion;
  if (cv) {
    const ev = { metric: 'net subscribers per 1,000 non-advertising views', period: cv.window, value: cv.per_1000_non_ad === null ? `not computed (non-advertising views ${cv.non_ad_views === null ? '—' : fmt(cv.non_ad_views)} < ${fmt(MIN.convNonAdViews)} or paid views unknown)` : `${cv.per_1000_non_ad} (net ${fmt(cv.net_subs)} on ${fmt(cv.non_ad_views)} non-advertising views); previous 28 days ${cv.prev_per_1000_non_ad === null ? '—' : cv.prev_per_1000_non_ad}`, volume_ok: cv.per_1000_non_ad !== null };
    if (cv.per_1000_non_ad === null) out.push(mk({ id: 'conv_wait', finding: 'Subscriber conversion cannot be read yet.', evidence: ev, diagnosis: { kind: 'confirmed', text: 'Too few non-advertising views (or unknown paid views) for a rate to mean anything. Net subscribers include some from paid views, which cannot be separated.' }, action: 'Wait for more non-advertising views; do not change creative on net subscriber counts alone.', priority: 'Medium', success: `At least ${fmt(MIN.convNonAdViews)} non-advertising views in the 28-day window.`, outcome: 'WAIT FOR DATA' }));
    else if (cv.prev_per_1000_non_ad !== null && cv.per_1000_non_ad < cv.prev_per_1000_non_ad * 0.8) out.push(mk({ id: 'conv_down', finding: 'Subscriber conversion fell versus the previous 28 days.', evidence: ev, diagnosis: { kind: 'hypothesis', text: 'Could reflect a different audience mix or content type; not tested. Net subscribers can include paid-view subscribers.' }, action: 'Check which uploads fell in the weaker period and test a clearer subscribe prompt on the next upload.', priority: 'Medium', success: 'Conversion returns to at least 80% of the earlier rate over the next 28 days.', outcome: 'TEST', creative: true }));
    else out.push(mk({ id: 'conv_ok', finding: `Subscriber conversion is ${cv.per_1000_non_ad} net subscribers per 1,000 non-advertising views.`, evidence: ev, diagnosis: { kind: 'confirmed', text: 'Computed from the daily series and traffic-source report.' }, action: 'Keep the current approach and keep tracking it weekly.', priority: 'Low', success: 'Rate stays at or above 80% of this level.', outcome: 'CONTINUE' }));
  }
  // 5. retention and drop-off (organic where available)
  if (d.retention) for (const c of d.retention.curves.slice(0, 3)) {
    const a = c.all; if (!a) continue; const volume = c.views !== null && c.views >= MIN.videoViews; const nm = c.title ? `“${String(c.title).slice(0, 50)}”` : 'a top video';
    const ev = { metric: 'audience watch ratio at 25% / 50% of the video', period: c.window, value: `all viewers ${pct(a.at25 * 100)} / ${pct(a.at50 * 100)}` + (c.organic ? `; organic only ${pct(c.organic.at25 * 100)} / ${pct(c.organic.at50 * 100)}` : '; organic-only not available') + (a.worst_segment ? `; steepest drop ${a.worst_segment.from_pct}%→${a.worst_segment.to_pct}% (−${pct(a.worst_segment.drop * 100)})` : ''), volume_ok: volume };
    if (!volume) { out.push(mk({ id: 'ret_low_' + c.video_id, finding: `Retention of ${nm} rests on too few views.`, evidence: ev, diagnosis: { kind: 'confirmed', text: `Fewer than ${MIN.videoViews} views in the period.` }, action: 'Do not change this video or the format on this curve.', priority: 'Low', success: `At least ${MIN.videoViews} views before reading the curve.`, outcome: 'WAIT FOR DATA', creative: true })); continue; }
    if (c.organic && c.organic.at25 !== null && a.at25 !== null && Math.abs(c.organic.at25 - a.at25) >= 0.08) out.push(mk({ id: 'ret_organic_gap_' + c.video_id, finding: `For ${nm}, organic viewers retain ${c.organic.at25 > a.at25 ? 'more' : 'less'} than all viewers at 25% of the video.`, evidence: ev, diagnosis: { kind: 'confirmed', text: 'Both curves come from the retention report; the organic curve excludes paid-ad viewers.' }, action: c.organic.at25 > a.at25 ? 'Judge this video on the organic curve; paid viewers drag the overall curve down.' : 'Paid viewers hold attention better than organic viewers on this video; compare the intro between paid and organic audiences before changing it.', priority: 'Medium', success: 'Organic watch ratio at 25% is tracked for the next two uploads.', outcome: 'TEST' }));
    if (a.at25 !== null && a.at25 < 0.5) out.push(mk({ id: 'ret_early_' + c.video_id, finding: `${nm} loses about half of viewers in the first quarter.`, evidence: ev, diagnosis: { kind: 'hypothesis', text: 'The opening may not match what viewers expected; not tested.' }, action: 'Test a shorter or different opening on the next upload and compare the watch ratio at 25%.', priority: 'High', success: 'Watch ratio at 25% rises by at least 10 points on the test upload.', outcome: 'TEST', creative: true }));
    else if (!(a.at25 !== null && a.at25 < 0.5)) out.push(mk({ id: 'ret_ok_' + c.video_id, finding: `${nm} holds viewers well (${pct(a.at25 * 100)} still watching at 25%).`, evidence: ev, diagnosis: { kind: 'confirmed', text: 'Audience retention report for this video and period.' }, action: 'Keep the current approach for this kind of video.', priority: 'Low', success: 'Watch ratio at 25% stays at or above 50%.', outcome: 'CONTINUE' }));
  } else if (d.collected) out.push(mk({ id: 'ret_none', finding: 'No retention curve is stored yet.', evidence: { metric: 'retention curves stored', period: win(w28), value: '0', volume_ok: false }, diagnosis: { kind: 'confirmed', text: 'Retention is collected per video after the per-video report; none was available in the last run (no video with enough views, or the step failed).' }, action: 'Check the collection log; no retention conclusion until a curve exists.', priority: 'Low', success: 'At least one top video has an all-viewers and an organic curve.', outcome: 'WAIT FOR DATA' }));
  // 6. format comparison
  if (d.formats && d.formats.rows.length) {
    const L = d.formats.rows.find((x) => x.type === 'long'), S = d.formats.rows.find((x) => x.type === 'short');
    if (L || S) out.push(mk({ id: 'format', finding: `Format split, ${L ? 'Long' : ''}${L && S ? ' vs ' : ''}${S ? 'Short' : ''}: ${L ? `Long ${pct(L.views_share_pct)} of views, ${pct(L.watch_share_pct)} of watch time` : ''}${L && S ? '; ' : ''}${S ? `Short ${pct(S.views_share_pct)} of views, ${pct(S.watch_share_pct)} of watch time` : ''}${d.formats.mix && d.formats.mix.videos ? `; Mix (by title) ${fmt(d.formats.mix.views)} views` : ''}.`, evidence: { metric: 'views and watch time by content type', period: d.formats.window, value: d.formats.rows.map((x) => `${x.type}: ${fmt(x.views)} views / ${x.watch_hours} h`).join('; '), volume_ok: false }, diagnosis: { kind: 'confirmed', text: 'YouTube content-type report. Shorts-feed watch time does not count as qualified watch hours.' }, action: d.business === 'srv_studio' ? 'SRV Studio is Long-only (CEO policy: Female Emotional Deep House, Long only). Do not resume Shorts: read the Short figures as historical evidence only and judge new Long videos on their own results.' : 'Keep producing all three formats. Do not shift production between formats on this split alone: it includes paid views and subscribers by format are not available.', priority: 'Medium', success: 'Re-read the split each month together with non-advertising views.', outcome: 'CONTINUE' }));
    if (d.formats.unrecognized && d.formats.unrecognized.length) out.push(mk({ id: 'format_unrecognized', finding: 'Some content-type values are not recognized and are not counted as Long, Short or zero.', evidence: { metric: 'unrecognized content types', period: d.formats.window, value: d.formats.unrecognized.join(', '), volume_ok: false }, diagnosis: { kind: 'confirmed', text: 'Unknown API values are kept as-is.' }, action: 'Review the new value before using the format split.', priority: 'Low', success: 'Every value is mapped or explained.', outcome: 'WAIT FOR DATA' }));
  }
  out.push(...monetization(d, opts));
  return finish(out);
}
// Monetization: ONLY dated official Studio Earn figures. Remaining milestones are differences between Studio's own numbers and Studio's own thresholds; eligibility is only ever as Studio states it.
function monetization(d, opts) {
  if (opts.ypp === undefined) return [];   // role without access to the official capture store: no monetization statement at all
  const y = opts.ypp; const mk2 = (o) => mk({ id: 'monetization', diagnosis: { kind: 'confirmed', text: 'Official YouTube Studio → Earn capture.' }, creative: false, ...o });
  const per = { from: y && y.dataAsOf ? y.dataAsOf : 'n/a', to: y && y.capturedAt ? y.capturedAt : 'n/a' };
  if (!y || y.state === 'not_captured' || y.state === 'invalid') return [mk2({ finding: 'Monetization status is unknown: no valid official Studio Earn capture is stored.', evidence: { metric: 'official Studio Earn capture', period: per, value: y ? y.state : 'not available', volume_ok: false }, action: 'Capture the figures from YouTube Studio → Earn (CEO authorization is needed before they are stored). The app does not estimate eligibility.', priority: 'Medium', success: 'A capture no more than 7 days old is stored and shown on the Revenue / YPP card.', outcome: 'WAIT FOR DATA' })];
  if (y.state === 'stale') return [mk2({ finding: `The last official Studio Earn capture is ${y.ageDays} days old.`, evidence: { metric: 'official Studio Earn capture age', period: per, value: `${y.ageDays} days (captured ${y.capturedAt})`, volume_ok: false }, action: 'Capture Studio → Earn again before relying on any monetization statement.', priority: 'Low', success: 'Capture no more than 7 days old.', outcome: 'WAIT FOR DATA' })];
  const f = (k) => (y.official.find((o) => o.key === k) || {}).value; const subs = f('subscribers'), hrs = f('public_watch_hours_12m'), shorts = f('shorts_views_90d'), up = f('uploads_90d');
  const early = y.thresholds && y.thresholds.early, full = y.thresholds && y.thresholds.full; const left = (t) => t ? { subscribers: Math.max(0, t.subscribers - subs), uploads: t.uploads === undefined ? null : Math.max(0, t.uploads - up), watch_hours: Math.max(0, t.watch_hours - hrs), shorts_views: Math.max(0, t.shorts_views - shorts) } : null;
  const e = left(early);
  const ev = { metric: 'official Studio Earn figures vs Studio thresholds', period: per, value: `subscribers ${fmt(subs)}, qualified watch hours ${fmt(hrs)}, Shorts views ${fmt(shorts)}${e ? `; remaining to the early tier as Studio states it: ${fmt(e.subscribers)} subscribers, ${fmt(e.watch_hours)} watch hours or ${fmt(e.shorts_views)} Shorts views` : ''}`, volume_ok: true };
  return [mk2({ finding: y.eligibility.text, evidence: ev, action: 'Keep building toward the thresholds Studio shows; re-capture Studio → Earn weekly. Eligibility is whatever Studio states, never an app calculation.', priority: 'Low', success: 'Next capture shows the remaining milestones shrinking.', outcome: 'CONTINUE' })];
}
function finish(list) {
  const rank = { High: 0, Medium: 1, Low: 2 }; const good = [];
  for (const r of list) { const v = validateDecision(r); if (v.ok) good.push(r); else good.push({ ...r, invalid: v.errors }); }
  return good.sort((a, b) => rank[a.priority] - rank[b.priority]);
}
