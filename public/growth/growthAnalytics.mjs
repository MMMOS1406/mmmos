// MMMOS Growth & Analytics — analytics accuracy (release R-A). PURE functions: no network, no database, no clock except `now` passed in.
// Used by the page module (public/growth/growthAnalytics.mjs is a byte-identical copy) and the tests.
//
// What it fixes in the legacy detailed view:
//  1. STALE WINDOW VALUES: youtube_videos.views is an Analytics-API value for ONE lookback window. A video that drops out of a later window keeps its
//     old value. Window totals here use ONLY rows refreshed by the latest pull of THAT channel; older rows are reported separately, never summed.
//  2. LIFETIME vs WINDOW: `views` (window) and `view_count` (lifetime public counter) are different measures. Every metric carries its period kind.
//  3. UNWEIGHTED RETENTION: channel retention is the view-weighted mean of per-video average-percentage-viewed; average view duration is total
//     watch time / views. Values above 100% (Shorts/loops) are counted and disclosed, never hidden.
//  4. CROSS-CHANNEL CONTAMINATION: a workspace is built from rows of ONE channel only; a foreign row throws.
//  5. REMOVED / UNVERIFIED VIDEOS: excluded from window totals and flagged, never deleted (history kept).
//  6. NO FABRICATED DATA: every metric reports source, period, last sync, coverage and status; unavailable metrics are `null` + reason, never 0.

export const GROWTH_VERSION = 'growth-wp2-1';
export const GROWTH_BUSINESSES = Object.freeze({
  silk_road_voices: Object.freeze({ key: 'silk_road_voices', name: 'Silk Road Voices', engine: 'SRV Farsi', channelId: 'UCCUa5BLzGh2eRBoqqWBCK_g' }),
  srv_studio: Object.freeze({ key: 'srv_studio', name: 'SRV Studio', engine: 'SRV English', channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' }),
});
export const GROWTH_DEFAULTS = Object.freeze({ lookbackDays: 30, staleDays: 3, channelStaleDays: 2 });

const DAY = 86400000;
const toDay = (d) => (d ? String(d).slice(0, 10) : null);
const dayMs = (d) => Date.parse(toDay(d) + 'T00:00:00Z');
const addDays = (d, n) => new Date(dayMs(d) + n * DAY).toISOString().slice(0, 10);
const num = (x) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Number(x));

// Normalise a database row (youtube_videos / youtube_videos_analytics columns) to the internal shape.
export function normaliseRow(r) {
  return {
    channelId: r.channel_id ?? r.channelId, videoId: r.video_id ?? r.videoId, title: r.title ?? null,
    views: num(r.views), viewCount: num(r.view_count ?? r.viewCount), watchMin: num(r.watch_time_min ?? r.watchMin), avdSec: num(r.avg_view_duration_sec ?? r.avdSec),
    retPct: num(r.retention_pct ?? r.retPct), subs: num(r.subs_gained ?? r.subs),
    analyticsAt: toDay(r.analytics_synced_at ?? r.analyticsAt), syncedAt: toDay(r.synced_at ?? r.syncedAt), publishedAt: toDay(r.published_at ?? r.publishedAt),
    hasTitle: r.hasTitle !== undefined ? !!r.hasTitle : !!(r.title && String(r.title).trim()), isTest: r.isTest !== undefined ? !!r.isTest : /^\[test\]/i.test(String(r.title || '')),
  };
}

// Parse the pipe-separated test/prototype export: channel|video|views|viewCount|watchMin|avd|ret|subs|analyticsAt|syncedAt|publishedAt|titled|test
export function parseExport(text, channelIds = { F: GROWTH_BUSINESSES.silk_road_voices.channelId, S: GROWTH_BUSINESSES.srv_studio.channelId }) {
  return String(text).trim().split('\n').map((line) => {
    const p = line.split('|');
    return normaliseRow({ channel_id: channelIds[p[0]] || p[0], video_id: p[1], views: p[2], view_count: p[3], watch_time_min: p[4], avg_view_duration_sec: p[5], retention_pct: p[6], subs_gained: p[7],
      analytics_synced_at: p[8] || null, synced_at: p[9] || null, published_at: p[10] || null, hasTitle: p[11] === '1', isTest: p[12] === '1' });
  });
}

// Which rows may a workspace use? Throws on any foreign row (isolation guarantee).
export function assertSingleChannel(rows, channelId) {
  const foreign = rows.filter((r) => r.channelId !== channelId);
  if (foreign.length) throw new Error(`channel isolation violation: ${foreign.length} row(s) belong to another channel (first: ${foreign[0].videoId} / ${foreign[0].channelId}) — expected ${channelId}`);
}

const metric = (key, label, value, unit, o) => ({ key, label, value, unit, ...o });
const unavailable = (key, label, reason, plan) => ({ key, label, value: null, unit: null, status: 'unavailable', reason, plan, source: null, period: null, lastSync: null, coverage: null });

// The metrics the app cannot show yet, each with the reason and the work package that unlocks it (never shown as 0).
export function unavailableMetrics() {
  return [
    unavailable('impressions', 'Thumbnail impressions', 'Not fetched. Not in the targeted Analytics API; available in the Reporting API Reach reports (reported 2026-01-15) — probe pending.', 'planned read-only API probe'),
    unavailable('ctr', 'Thumbnail click-through rate', 'Not fetched (same reason). Visible only in YouTube Studio today.', 'planned read-only API probe'),
    unavailable('traffic_sources', 'Traffic sources (organic vs paid)', 'Not collected by the daily sync. Studio shows it; the Analytics API offers insightTrafficSourceType including advertising.', 'planned read-only API probe'),
    unavailable('retention_curve', 'Audience retention curve / first 30 seconds', 'Not collected. Needs one Analytics query per video (elapsedVideoTimeRatio).', 'planned read-only API probe'),
    unavailable('returning_viewers', 'Returning viewers', 'Studio-only today; no API source confirmed.', 'planned read-only API probe'),
    unavailable('geography_demographics', 'Geography and demographics', 'Not collected.', 'planned warehouse release'),
    unavailable('revenue', 'Revenue, RPM, CPM', 'Channel not yet monetized; revenue scope (yt-analytics-monetary.readonly) not granted.', 'after Partner Program eligibility'),
    unavailable('watch_hours_qualified', 'Qualified watch hours (monetization)', 'Studio-only figure (Earn page); no API source.', 'manual weekly capture'),
  ];
}

// ---- the legacy method, kept ONLY so the tests and the dashboard can show the before/after on any data ----
export function legacyDetailTotals(rows) {
  const r = rows.filter((x) => x.analyticsAt);                       // youtube_videos_analytics WHERE analytics_synced_at IS NOT NULL (Farsi [TEST] rows are excluded by that view)
  const used = r.filter((x) => !x.isTest);
  const withRet = used.filter((x) => x.retPct !== null);
  return { rows: used.length, views: used.reduce((a, x) => a + (x.views || 0), 0), watchHours: used.reduce((a, x) => a + (x.watchMin || 0), 0) / 60,
    subs: used.reduce((a, x) => a + (x.subs || 0), 0), retentionUnweighted: withRet.length ? withRet.reduce((a, x) => a + x.retPct, 0) / withRet.length : null };
}

// ---- the corrected workspace for ONE business ----
export function buildWorkspace(allRows, opts) {
  const o = { ...GROWTH_DEFAULTS, ...opts };
  const biz = o.business;
  if (!biz || !biz.channelId) throw new Error('buildWorkspace: business is required');
  assertSingleChannel(allRows, biz.channelId);
  const rows = allRows;
  const tests = rows.filter((r) => r.isTest);
  const real = rows.filter((r) => !r.isTest);

  // the latest pull of THIS channel defines the window
  const pulls = real.map((r) => r.analyticsAt).filter(Boolean).sort();
  const pull = pulls.length ? pulls[pulls.length - 1] : null;
  const period = pull ? { kind: 'window', from: addDays(pull, -o.lookbackDays), to: pull, days: o.lookbackDays, lengthKnown: false,
    note: `The window length is not stored with the data; ${o.lookbackDays} days is the default of the Analytics pull. Studio's own "28 days" window can differ by up to two days.` } : null;
  const inWindow = pull ? real.filter((r) => r.analyticsAt === pull) : [];
  const notInWindow = pull ? real.filter((r) => r.analyticsAt !== pull) : real;
  const staleCut = pull ? addDays(pull, -o.staleDays) : null;
  const unverified = notInWindow.filter((r) => !r.syncedAt || r.syncedAt < staleCut);   // no source refreshed it recently: cannot confirm it is still on the channel (needs the full uploads listing)

  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
  const winViews = sum(inWindow, (r) => r.views), winMin = sum(inWindow, (r) => r.watchMin), winSubs = sum(inWindow, (r) => r.subs);
  const retRows = inWindow.filter((r) => r.retPct !== null && r.views > 0);
  const retW = sum(retRows, (r) => r.views);
  const wRet = retW > 0 ? sum(retRows, (r) => r.retPct * r.views) / retW : null;
  const avdRows = inWindow.filter((r) => r.watchMin !== null && r.views > 0);
  const avdViews = sum(avdRows, (r) => r.views);
  const avd = avdViews > 0 ? (sum(avdRows, (r) => r.watchMin) * 60) / avdViews : null;
  const over100 = retRows.filter((r) => r.retPct > 100).length;
  const cov = (used, total) => ({ used, total, pct: total ? Math.round((used / total) * 1000) / 10 : null });
  const base = { source: 'YouTube Analytics API → youtube_videos (views, watch_time_min, retention_pct, subs_gained)', period, lastSync: pull };
  const status = (!pull ? 'unavailable' : 'ok');

  const m = {};
  m.views_window = metric('views_window', 'Views (selected period)', pull ? winViews : null, 'views', { ...base, status, coverage: cov(inWindow.length, inWindow.length), note: 'Analytics-API views for the period; Shorts count each start/replay.' });
  m.watch_hours_window = metric('watch_hours_window', 'Watch time (selected period)', pull ? Math.round((winMin / 60) * 10) / 10 : null, 'hours', { ...base, status, coverage: cov(inWindow.filter((r) => r.watchMin !== null).length, inWindow.length) });
  m.subs_attributed_window = metric('subs_attributed_window', 'Subscribers gained, attributed to videos (selected period)', pull ? winSubs : null, 'subscribers', { ...base, status: pull ? 'partial' : 'unavailable', coverage: cov(inWindow.filter((r) => r.subs !== null).length, inWindow.length),
    note: 'Sum of per-video subscribersGained. YouTube Studio shows the channel-level number, which is higher (subscribers who join from the channel page are not attributed to a video).' });
  m.avg_view_pct_weighted = metric('avg_view_pct_weighted', 'Average percentage viewed (view-weighted)', wRet === null ? null : Math.round(wRet * 10) / 10, '%', { ...base, status: wRet === null ? 'unavailable' : 'ok', coverage: cov(retRows.length, inWindow.length),
    note: over100 ? `${over100} video(s) report more than 100% (replays/loops); included, not capped.` : 'Mean of per-video average-percentage-viewed weighted by views.' });
  m.avg_view_duration = metric('avg_view_duration', 'Average view duration (watch time ÷ views)', avd === null ? null : Math.round(avd), 'seconds', { ...base, status: avd === null ? 'unavailable' : 'ok', coverage: cov(avdRows.length, inWindow.length) });

  // lifetime figures, labeled as such
  const fresh = real.filter((r) => pull && r.syncedAt && r.syncedAt >= staleCut && r.viewCount !== null);
  const lifeSum = sum(fresh, (r) => r.viewCount);
  m.views_lifetime_tracked = metric('views_lifetime_tracked', 'Lifetime views of videos with a fresh counter', pull ? lifeSum : null, 'views', { source: 'YouTube Data API statistics → youtube_videos.view_count', period: { kind: 'lifetime' }, lastSync: pull ? fresh.map((r) => r.syncedAt).sort().pop() || null : null,
    status: pull ? 'partial' : 'unavailable', coverage: o.channel && o.channel.totalViews ? { used: lifeSum, total: o.channel.totalViews, pct: Math.round((lifeSum / o.channel.totalViews) * 1000) / 10 } : null,
    note: `Counters are refreshed daily for the newest uploads only (${fresh.length} of ${real.length} rows are fresh).` });
  if (o.channel) {
    const age = pull && o.channel.updatedAt ? (dayMs(pull) - dayMs(o.channel.updatedAt)) / DAY : null;
    const cstatus = age === null ? 'unknown' : age > o.channelStaleDays ? 'stale' : 'ok';
    m.subscribers_total = metric('subscribers_total', 'Subscribers (current)', num(o.channel.subscribers), 'subscribers', { source: 'YouTube Data API channels.list → youtube_channels', period: { kind: 'current' }, lastSync: toDay(o.channel.updatedAt), status: cstatus, coverage: null });
    m.views_lifetime_channel = metric('views_lifetime_channel', 'Lifetime channel views', num(o.channel.totalViews), 'views', { source: 'YouTube Data API channels.list → youtube_channels', period: { kind: 'lifetime' }, lastSync: toDay(o.channel.updatedAt), status: cstatus, coverage: null,
      note: 'Includes videos that were later removed or made private.' });
  }

  return {
    version: GROWTH_VERSION, business: biz.key, businessName: biz.name, channelId: biz.channelId, period,
    metrics: m, unavailable: unavailableMetrics(),
    rows: { total: rows.length, test: tests.length, inWindow: inWindow.length, notInWindow: notInWindow.length, unverifiedOnChannel: unverified.length,
      untitled: real.filter((r) => !r.hasTitle).length },
    excluded: { staleViewsNotSummed: sum(notInWindow, (r) => r.views), staleRows: notInWindow.length, note: 'Not summed into the selected period: refreshed by an older pull. Kept in the database as history.' },
    top: inWindow.slice().sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5).map((r) => ({ videoId: r.videoId, title: r.title, views: r.views })),
    legacy: legacyDetailTotals(rows),
    periods: reportingPeriods(m, period, o.counterSeries),
  };
}

// Compare a workspace with figures read from YouTube Studio. studio = { views, watchHours, subsChannel }.
export function compareToStudio(ws, studio, tol = { views: 0.05, watchHours: 0.05 }) {
  const rel = (a, b) => (b ? (a - b) / b : null);
  const out = {};
  if (studio.views != null) { const d = rel(ws.metrics.views_window.value, studio.views); out.views = { app: ws.metrics.views_window.value, studio: studio.views, diffPct: Math.round(d * 1000) / 10, ok: Math.abs(d) <= tol.views }; }
  if (studio.watchHours != null) { const d = rel(ws.metrics.watch_hours_window.value, studio.watchHours); out.watchHours = { app: ws.metrics.watch_hours_window.value, studio: studio.watchHours, diffPct: Math.round(d * 1000) / 10, ok: Math.abs(d) <= tol.watchHours }; }
  if (studio.subsChannel != null) out.subs = { app: ws.metrics.subs_attributed_window.value, studio: studio.subsChannel, note: 'attributed-to-videos vs channel-level: the app value is expected to be lower', ok: ws.metrics.subs_attributed_window.value <= studio.subsChannel };
  const lv = ws.legacy.views, nv = ws.metrics.views_window.value;
  out.legacyOverstatementPct = nv ? Math.round(((lv - nv) / nv) * 1000) / 10 : null;
  return out;
}

// ---- reporting periods from the DAILY CHANNEL COUNTERS (youtube_channel_snapshots: total_views, subscribers) ----
// These are exact point-in-time counters, so differences give true lifetime / 7-day / 28-day / custom changes that do not depend on the Analytics lookback window.
// Caveats disclosed in the result: the public counter can DROP when videos are removed (a decrease is never reported as growth); channel-level subscriber change is net (gained − lost).
export function parseCounters(text) {
  return String(text).trim().split('\n').map((l) => { const p = l.split('|'); return { channel: p[0], date: p[1], totalViews: Number(p[2]), subscribers: Number(p[3]) }; });
}
// One period between two dates (custom ranges use this directly). Never reports a counter DROP (removed videos / resets) as growth.
export function counterRange(series, fromDate, toDate) {
  const s = series.slice().sort((a, b) => a.date.localeCompare(b.date));
  const base = { from: fromDate, to: toDate };
  if (!s.length || fromDate > toDate) return { ...base, views: null, subscribersNet: null, status: 'unavailable', note: 'No counter history for this range.' };
  const end = s.filter((x) => x.date <= toDate).pop(), start = s.filter((x) => x.date <= fromDate).pop();
  if (!end || !start || fromDate < s[0].date) return { ...base, views: null, subscribersNet: null, status: 'unavailable', note: 'The channel counters do not reach back that far.' };
  const range = s.filter((x) => x.date >= start.date && x.date <= end.date);
  let drop = false; for (let i = 1; i < range.length; i++) if (range[i].totalViews < range[i - 1].totalViews) drop = true;
  const dv = end.totalViews - start.totalViews, ds = end.subscribers - start.subscribers;
  if (drop || dv < 0) return { ...base, from: start.date, to: end.date, views: null, subscribersNet: ds, status: 'unreliable', note: 'The channel view counter decreased inside this period (videos were removed or made private), so a view change cannot be computed from the counters. Subscriber change is still valid.' };
  return { ...base, from: start.date, to: end.date, views: dv, subscribersNet: ds, status: 'ok', note: 'Difference of the public lifetime counter at the two dates (all videos).' };
}
export function counterPeriods(series, asOf, periods = [7, 28, 90]) {
  const s = series.slice().sort((a, b) => a.date.localeCompare(b.date));
  const end = asOf ? s.filter((x) => x.date <= toDay(asOf)).pop() : s[s.length - 1];
  if (!end) return { asOf: null, lifetime: null, periods: [] };
  return { asOf: end.date, lifetime: { views: end.totalViews, subscribers: end.subscribers, source: 'youtube_channel_snapshots (YouTube Data API channels.list)' },
    periods: periods.map((n) => ({ days: n, ...counterRange(s, addDays(end.date, -n), end.date) })) };
}
// Daily views (counter differences), used to show bursts such as a paid campaign. Negative steps are returned as null.
export function dailyViews(series) {
  const s = series.slice().sort((a, b) => a.date.localeCompare(b.date)); const out = [];
  for (let i = 1; i < s.length; i++) { const d = s[i].totalViews - s[i - 1].totalViews; out.push({ date: s[i].date, views: d >= 0 ? d : null, subscribersNet: s[i].subscribers - s[i - 1].subscribers }); }
  return out;
}

// The period table shown with every workspace: lifetime, the Analytics window, last 7 / 28 days and custom ranges are SEPARATE rows, never blended.
// `counterSeries` (daily channel counters of THIS channel) is optional: without it the 7-day, 28-day and custom rows are explicitly unavailable.
export function reportingPeriods(m, period, counterSeries) {
  const rows = [];
  rows.push({ key: 'lifetime', label: 'Lifetime', views: m.views_lifetime_channel ? m.views_lifetime_channel.value : null, subscribers: m.subscribers_total ? m.subscribers_total.value : null, status: m.views_lifetime_channel ? m.views_lifetime_channel.status : 'unavailable', source: 'YouTube Data API channels.list → youtube_channels', note: 'Public counters; include videos later removed.' });
  rows.push({ key: 'analytics_window', label: period ? `Analytics window ${period.from} → ${period.to}` : 'Analytics window', views: m.views_window.value, subscribers: null, status: m.views_window.status, source: m.views_window.source, note: 'Window of the last Analytics pull; length assumed, not stored.' });
  const none = (key, label, reason) => ({ key, label, views: null, subscribers: null, status: 'unavailable', source: null, note: reason });
  if (Array.isArray(counterSeries) && counterSeries.length) {
    const cp = counterPeriods(counterSeries, null, [7, 28]);
    for (const x of cp.periods) rows.push({ key: 'last_' + x.days, label: `Last ${x.days} days (${x.from} → ${x.to})`, views: x.views, subscribers: x.subscribersNet, status: x.status, source: 'youtube_channel_snapshots', note: x.note });
    rows.push(none('custom', 'Custom range', 'Choose a range: computed from the same counters with counterRange().'));
  } else {
    const why = 'Needs the daily channel-counter history, which the browser cannot read in this release (table not in the data-proxy allow-list). Provided by a later server-side release.';
    rows.push(none('last_7', 'Last 7 days', why), none('last_28', 'Last 28 days', why), none('custom', 'Custom range', why));
  }
  return rows;
}
