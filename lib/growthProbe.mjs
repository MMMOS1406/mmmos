// Read-only YouTube API probe (R-B) — planner, capability registry, response checker and the per-business runner.
// PREPARED, NOT DEPLOYED: the only caller is the CEO-session-gated server action `growth_probe` (api/ops.js), which is not released.
// This module never performs a network call itself and never sees a token: the caller passes `fetchImpl` bound to ONE channel's authorization.
// Guarantees (tested): GET only; Google read endpoints only; the channel id returned by the identity call is asserted before anything else runs;
// a 400/403 is recorded and never retried with another channel; no monetary metric is requested; reports carry NO token and NO per-video or per-viewer records;
// a report is marked real ONLY when the caller states `provenance.real === true` (the server action does; tests never do) — mock output is never presented as YouTube data.
// No real analytics number is embedded in this file: Studio reference figures are supplied at call time by the CEO and are never stored.
export const PROBE_CHANNELS = Object.freeze({ silk_road_voices: 'UCCUa5BLzGh2eRBoqqWBCK_g', srv_studio: 'UC0nzWQX6AaUqlF5FozNpWPg' });
const ALLOWED = [/^https:\/\/www\.googleapis\.com\/youtube\/v3\/channels\?/, /^https:\/\/youtubeanalytics\.googleapis\.com\/v2\/reports\?/, /^https:\/\/youtubereporting\.googleapis\.com\/v1\/(reportTypes|jobs)(\?|$)/];
const qs = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const AN = 'https://youtubeanalytics.googleapis.com/v2/reports?';
const DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const TOP_VIDEO = '__TOP_VIDEO__';
// Default reporting period: the last `days` COMPLETE Pacific-time days (Analytics reports use Pacific dates and the current day is incomplete), ending yesterday (PT) — the same
// convention as Studio's "Last 28 days" (e.g. on Nov 18 it shows Oct 21 – Nov 17). `now` is epoch ms.
export function defaultPeriod(now, days = 28) {
  const pt = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });   // YYYY-MM-DD in Pacific time
  const to = addDays(pt, -1); return { from: addDays(to, -(days - 1)), to };
}


// Every step: what it asks, which capability it proves, the documented expectation, and its estimated quota cost.
//   expect: 'supported' (documented) | 'unconfirmed' (documentation silent/ambiguous — the probe exists to find out) | 'unsupported' (documented NOT available: a 400 is the EXPECTED, correct result)
//   quota:  Analytics API = 1 request each (Google: "each API request counts as one unit"; default allocation not published — read it in the Cloud console Quotas page);
//           Data API channels.list = 1 unit of the 10,000/day default; Reporting API quota is not stated in the documentation.
export function probeSteps({ from, to, videoId } = {}) {
  const base = { ids: 'channel==MINE', startDate: from, endDate: to };
  const okDate = /^\d{4}-\d{2}-\d{2}$/.test(String(to || ''));
  const yearStart = okDate ? addDays(to, -365) : to, ninetyStart = okDate ? addDays(to, -90) : to;
  const A = (id, cap, expect, q, extra = {}) => ({ id, cap, kind: 'analytics', expect, quota: { analytics: 1 }, url: AN + qs(q), ...extra });
  const core = 'views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost';
  const s = [
    { id: 'identity', cap: 'channel_identity', kind: 'identity', expect: 'supported', quota: { data: 1 }, url: 'https://www.googleapis.com/youtube/v3/channels?' + qs({ part: 'id,snippet,statistics', mine: 'true' }) },
    { id: 'reporting_types', cap: 'reach_report_availability', kind: 'reporting', expect: 'supported', quota: { reporting: 1 }, url: 'https://youtubereporting.googleapis.com/v1/reportTypes' },
    { id: 'reporting_jobs', cap: 'reach_report_availability', kind: 'reporting', expect: 'supported', quota: { reporting: 1 }, url: 'https://youtubereporting.googleapis.com/v1/jobs' },
    A('channel_totals', 'channel_level_metrics', 'supported', { ...base, metrics: core }, { aggregate: true }),
    A('daily_series', 'daily_time_series', 'supported', { ...base, dimensions: 'day', metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost', sort: 'day' }),
    A('per_video', 'video_level_metrics', 'supported', { ...base, dimensions: 'video', metrics: core, sort: '-views', maxResults: 200 }),
    A('traffic_source', 'traffic_sources', 'supported', { ...base, dimensions: 'insightTrafficSourceType', metrics: 'views,engagedViews,estimatedMinutesWatched', sort: '-views' }, { aggregate: true }),
    A('traffic_source_daily', 'advertising_traffic_by_day', 'supported', { ...base, dimensions: 'insightTrafficSourceType,day', metrics: 'views,estimatedMinutesWatched', sort: 'day' }, { adDailyOnly: true }),
    A('traffic_source_ads_detail', 'advertising_traffic_detail', 'supported', { ...base, dimensions: 'insightTrafficSourceDetail', filters: 'insightTrafficSourceType==ADVERTISING', metrics: 'views,estimatedMinutesWatched', sort: '-views', maxResults: 25 }),
    A('audience_type_organic', 'paid_vs_organic_filter', 'unconfirmed', { ...base, metrics: 'views,estimatedMinutesWatched', filters: 'audienceType==ORGANIC' }, { aggregate: true }),
    A('audience_type_ad_instream', 'paid_vs_organic_filter', 'unconfirmed', { ...base, metrics: 'views,estimatedMinutesWatched', filters: 'audienceType==AD_INSTREAM' }, { aggregate: true }),
    A('subscribed_status', 'subscribed_vs_unsubscribed_viewers', 'supported', { ...base, dimensions: 'subscribedStatus', metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage' }, { aggregate: true }),
    A('content_type', 'long_short_split', 'unconfirmed', { ...base, dimensions: 'creatorContentType', metrics: 'views,estimatedMinutesWatched,averageViewDuration' }, { aggregate: true }),
    A('age_gender', 'demographics', 'supported', { ...base, dimensions: 'ageGroup,gender', metrics: 'viewerPercentage' }),
    A('country', 'geography', 'supported', { ...base, dimensions: 'country', metrics: 'views,estimatedMinutesWatched', sort: '-views', maxResults: 25 }),
    // Earn-eligibility ESTIMATES (Studio's Earn page stays the authority): public long-form watch time by traffic source over 12 months; Shorts views by source over 90 days.
    A('earn_longform_365d_by_source', 'earn_public_watch_hours_estimate', 'unconfirmed', { ids: 'channel==MINE', startDate: yearStart, endDate: to, dimensions: 'insightTrafficSourceType,creatorContentType', metrics: 'estimatedMinutesWatched,views', sort: '-estimatedMinutesWatched' }, { aggregate: true }),
    A('earn_shorts_90d_by_source', 'earn_shorts_views_estimate', 'unconfirmed', { ids: 'channel==MINE', startDate: ninetyStart, endDate: to, dimensions: 'insightTrafficSourceType,creatorContentType', metrics: 'views', sort: '-views' }, { aggregate: true }),
    // documented NOT available: a 400 is the correct, expected answer (recorded as "unsupported_as_documented")
    A('neg_impressions', 'thumbnail_impressions_via_analytics_api', 'unsupported', { ...base, metrics: 'impressions' }, { negative: true }),
    A('neg_thumbnail_impressions', 'thumbnail_impressions_via_analytics_api', 'unsupported', { ...base, metrics: 'videoThumbnailImpressions' }, { negative: true }),
    A('neg_thumbnail_ctr', 'thumbnail_ctr_via_analytics_api', 'unsupported', { ...base, metrics: 'videoThumbnailImpressionsClickRate' }, { negative: true }),
    A('neg_subscribers_by_source', 'subscribers_by_traffic_source', 'unsupported', { ...base, dimensions: 'insightTrafficSourceType', metrics: 'subscribersGained' }, { negative: true }),
  ];
  const vid = videoId || TOP_VIDEO;   // default: the channel's top video by views, chosen server-side from the per_video result
  s.push(A('retention_curve', 'audience_retention_curve', 'supported', { ...base, dimensions: 'elapsedVideoTimeRatio', filters: `video==${vid}`, metrics: 'audienceWatchRatio,relativeRetentionPerformance' }, { needsVideo: !videoId }));
  s.push(A('retention_curve_organic', 'paid_vs_organic_filter', 'unconfirmed', { ...base, dimensions: 'elapsedVideoTimeRatio', filters: `video==${vid};audienceType==ORGANIC`, metrics: 'audienceWatchRatio' }, { needsVideo: !videoId }));
  return s;
}
export function isReadOnlyAllowed(url, method = 'GET') { return method === 'GET' && ALLOWED.some((r) => r.test(url)); }

// The documented capability matrix (STATIC: what the documentation says and what the probe will test). `live` is always "NOT RUN" here — a live result exists only in a report with provenance.real === true.
export function capabilityMatrix() {
  const S = (cap, label, api, period, scope, limits, expect) => ({ cap, label, api, period, scope, limits, documented: expect, live: 'NOT RUN' });
  const R = 'yt-analytics.readonly';
  return [
    S('channel_identity', 'Channel identity and subscriber/view counters', 'YouTube Data API v3 channels.list (part=id,snippet,statistics, mine=true)', 'current counters', 'youtube.readonly', 'current counters as exposed by the Data API; whether the owner sees a rounded subscriber count was not verified in the documentation read', 'supported'),
    S('channel_level_metrics', 'Views, engaged views, watch time, average view duration/percentage, subscribers gained/lost (channel)', 'YouTube Analytics API v2 reports.query, no dimension', 'any date range (probe: last 28 days)', R, 'views include co-views on TV; subscribersGained counts subscribe events, subscribersLost unsubscribes (net = gained − lost)', 'supported'),
    S('daily_time_series', 'Daily views / watch time / subscribers', 'Analytics API, dimensions=day', 'dates in Pacific time', R, 'one row per day; data for the most recent day(s) can be incomplete', 'supported'),
    S('video_level_metrics', 'Per-video views, watch time, average view duration/percentage, subscribers gained', 'Analytics API, dimensions=video, maxResults<=200', 'any date range', R, 'subscribersGained per video counts only subscriptions from that video\'s watch page (lower than the channel figure); top 200 videos by sort', 'supported'),
    S('traffic_sources', 'Traffic sources incl. advertising (paid) vs other sources', 'Analytics API, dimensions=insightTrafficSourceType, metrics views/engagedViews/estimatedMinutesWatched', 'any date range', R, 'metrics limited to views, engagedViews, estimatedMinutesWatched (NOT averageViewDuration, NOT subscribers); ADVERTISING = paid ads, PROMOTED = unpaid YouTube promotion; error if videos × days > 50,000', 'supported'),
    S('advertising_traffic_by_day', 'Paid-ad views per day (campaign window)', 'Analytics API, dimensions=insightTrafficSourceType,day', 'daily', R, 'same limits as traffic sources', 'supported'),
    S('advertising_traffic_detail', 'Ad format of paid views (e.g. in-stream, display)', 'Analytics API, dimensions=insightTrafficSourceDetail, filters=insightTrafficSourceType==ADVERTISING, sort required, maxResults<=25', 'any date range', R, 'top 25 details only; sort is mandatory', 'supported'),
    S('paid_vs_organic_filter', 'Paid vs organic split as in Studio\'s "Organic and paid traffic" filter', 'Analytics API filter audienceType (ORGANIC / AD_INSTREAM / AD_INDISPLAY)', 'any date range', R, 'documented for the audience-retention report; support on basic reports is NOT confirmed — the probe tests it; fall back: traffic source ADVERTISING vs the rest', 'unconfirmed'),
    S('subscribed_vs_unsubscribed_viewers', 'Viewers who are subscribed vs not', 'Analytics API, dimensions=subscribedStatus', 'any date range', R, 'status at the time of the activity; this is NOT "returning viewers" (Studio\'s new/casual/regular split has no confirmed API field)', 'supported'),
    S('long_short_split', 'Long vs Short vs Live performance', 'Analytics API, dimensions=creatorContentType (VIDEO_ON_DEMAND, SHORTS, LIVE_STREAM, STORY)', 'since 2019-01-01', R, 'documented as an optional dimension of other reports; stand-alone use is NOT confirmed — the probe tests it; Mix is a Long (no separate type)', 'unconfirmed'),
    S('audience_retention_curve', 'Audience retention curve and relative retention', 'Analytics API, dimensions=elapsedVideoTimeRatio, filters=video==ID (single video), metrics audienceWatchRatio / relativeRetentionPerformance', 'any date range', R, '100 points per video; ONE video per query (no channel-level curve); needs one request per video', 'supported'),
    S('reach_report_availability', 'Thumbnail impressions and CTR: do the Reach report types exist and do jobs exist?', 'YouTube Reporting API reportTypes.list / jobs.list (channel_reach_basic_a1, channel_reach_combined_a1)', 'daily reports; 30-day backfill when a job is created; kept 60 days (historical 30 days)', R, 'a job must exist before data is generated (creating one is a Google-side write and is NOT part of this probe); first data within 48 h; scope requirement for Reach is not restated on the Reach page', 'supported (types) — data not verified'),
    S('thumbnail_impressions_via_analytics_api', 'Impressions through the Analytics API', 'metrics impressions / videoThumbnailImpressions', '—', R, 'not listed in the Analytics API metrics reference (the only impressions-named metrics are annotation, card and ad impressions); expected 400', 'unsupported'),
    S('thumbnail_ctr_via_analytics_api', 'Thumbnail CTR through the Analytics API', 'metric videoThumbnailImpressionsClickRate', '—', R, 'not listed in the metrics reference; expected 400', 'unsupported'),
    S('subscribers_by_traffic_source', 'Subscribers gained per traffic source', 'metric subscribersGained with insightTrafficSourceType', '—', R, 'traffic-source reports allow only views/engagedViews/estimatedMinutesWatched; expected 400', 'unsupported'),
    S('earn_public_watch_hours_estimate', 'Estimate of Earn "public watch hours" (12 months)', 'Analytics API, dimensions=insightTrafficSourceType,creatorContentType, metric estimatedMinutesWatched, 365 days', '12 months', R, 'APPROXIMATION only: long-form watch time excluding ADVERTISING and SHORTS sources; YouTube\'s own qualified figure (Studio → Earn) excludes more (private/unlisted/deleted, non-VOD live) and remains the authority', 'unconfirmed'),
    S('earn_shorts_views_estimate', 'Estimate of Earn "Shorts views" (90 days)', 'Analytics API, dimensions=insightTrafficSourceType,creatorContentType, metric views, 90 days', '90 days', R, 'APPROXIMATION: SHORTS content views excluding ADVERTISING; Studio → Earn is the authority', 'unconfirmed'),
    S('demographics', 'Age and gender of logged-in viewers', 'Analytics API, dimensions=ageGroup,gender, metric viewerPercentage', 'any date range', R, 'logged-in viewers only; aggregate percentages (no viewer-level data)', 'supported'),
    S('geography', 'Views by country', 'Analytics API, dimensions=country', 'any date range', R, 'top 25 in the probe', 'supported'),
    S('revenue', 'Revenue, RPM, CPM', 'Analytics API estimatedRevenue / cpm …', '—', 'yt-analytics-monetary.readonly (NOT granted)', 'not requested by the probe; the channels are not in the Partner Program', 'not applicable'),
    S('returning_viewers', 'New / casual / regular viewers', 'Studio only', '—', '—', 'no API field confirmed in the documentation reviewed', 'not available via API'),
    S('qualified_watch_hours', 'YouTube\'s own qualified watch hours / Shorts views for Earn', 'Studio → Earn only', '12 months / 90 days', '—', 'no API field; use the dated manual capture plus the labeled estimates above', 'not available via API'),
  ];
}

const classify = (st, status, json, negative) => {
  const ok = status >= 200 && status < 300;
  const reason = json && json.error && ((json.error.errors && json.error.errors[0] && json.error.errors[0].reason) || json.error.status) || null;
  if (ok) return { status: negative ? 'unexpectedly_supported' : (json && Array.isArray(json.rows) && json.rows.length === 0 ? 'ok_empty' : 'ok'), reason: null };
  if (negative && status === 400) return { status: 'unsupported_as_documented', reason };
  if (status === 403 && /quota|ratelimit|dailylimit/i.test(String(reason))) return { status: 'quota_exceeded', reason };
  if (status === 429) return { status: 'quota_exceeded', reason: reason || 'rateLimitExceeded' };
  if (status === 403 || status === 401) return { status: 'forbidden_scope', reason };
  if (status === 400) return { status: 'bad_request', reason };
  return { status: 'failed', reason };
};

// Runs the plan with a caller-supplied fetchJson(url) => {status, json}. Aborts on identity mismatch (isolation) before any other request.
export async function runProbe({ business, steps, fetchJson, now = () => Date.now(), reference = null, provenance = { real: false, note: 'not real YouTube data (origin not asserted)' } }) {
  const want = PROBE_CHANNELS[business]; if (!want) throw new Error('unknown business');
  const report = { business, channelId: want, provenance: { real: provenance.real === true, ...(provenance.real === true ? {} : { note: provenance.note || 'not real YouTube data' }) }, results: [], aborted: null, aggregates: {}, reach: null };
  let topVideo = null, stopped = false;
  for (const st0 of steps) {
    if (stopped) break;
    const st = { ...st0 };
    if (st.url.includes(encodeURIComponent(TOP_VIDEO)) || st.url.includes(TOP_VIDEO)) {
      if (!topVideo) { report.results.push({ id: st.id, cap: st.cap, status: 'skipped_no_video', expect: st.expect }); continue; }
      st.url = st.url.split(encodeURIComponent(TOP_VIDEO)).join(encodeURIComponent(topVideo)).split(TOP_VIDEO).join(topVideo);
    }
    if (!isReadOnlyAllowed(st.url)) { report.results.push({ id: st.id, cap: st.cap, status: 'refused_not_read_only' }); continue; }
    const t0 = now(); let r; try { r = await fetchJson(st.url); } catch (e) { report.results.push({ id: st.id, cap: st.cap, status: 'error', latencyMs: now() - t0, error: String(e && e.message || e).slice(0, 120) }); continue; }
    const latencyMs = now() - t0;
    if (st.kind === 'identity') {
      const got = r && r.json && r.json.items && r.json.items[0] && r.json.items[0].id;
      if (got !== want) { report.aborted = `channel isolation violation: authorization belongs to ${got || 'unknown'}, expected ${want}`; report.results.push({ id: st.id, cap: st.cap, status: 'identity_mismatch', latencyMs }); stopped = true; continue; }
      report.results.push({ id: st.id, cap: st.cap, status: 'ok', httpStatus: r.status, latencyMs, channelId: got, expect: st.expect, quotaCost: st.quota }); continue;
    }
    const c = classify(st, r.status, r.json, !!st.negative);
    const row = { id: st.id, cap: st.cap, httpStatus: r.status, status: c.status, expect: st.expect, latencyMs };
    if (c.reason) row.reason = String(c.reason).slice(0, 60);
    if (r.status >= 200 && r.status < 300 && r.json) {
      if (Array.isArray(r.json.rows)) { row.rows = r.json.rows.length; row.columns = (r.json.columnHeaders || []).map((x) => x.name); }
      if (Array.isArray(r.json.reportTypes)) row.reportTypes = r.json.reportTypes.length;
      if (Array.isArray(r.json.jobs)) row.jobs = r.json.jobs.length;
    } else if (r.json && r.json.error) row.error = String(r.json.error.message || '').slice(0, 140);
    // channel-level aggregates only (no per-video, no per-viewer records) — plus the daily paid-ad series needed to see a campaign window
    if (r.status >= 200 && r.status < 300 && r.json && Array.isArray(r.json.rows)) {
      const names = (r.json.columnHeaders || []).map((x) => x.name);
      if (st.aggregate) report.aggregates[st.id] = { columns: names, rows: r.json.rows.slice(0, 40) };
      if (st.adDailyOnly) { const iT = names.indexOf('insightTrafficSourceType'), iD = names.indexOf('day'), iV = names.indexOf('views'); report.aggregates[st.id] = { columns: ['day', 'views'], rows: r.json.rows.filter((x) => x[iT] === 'ADVERTISING').map((x) => [x[iD], x[iV]]) }; }
      if (st.id === 'per_video' && r.json.rows[0]) { const iV = names.indexOf('video'); topVideo = r.json.rows[0][iV >= 0 ? iV : 0]; }   // the id stays server-side; it is never put in the report
    }
    if (st.id === 'reporting_types' && r.json && Array.isArray(r.json.reportTypes)) { const ids = r.json.reportTypes.map((x) => x.id); report.reach = { ...(report.reach || {}), typesListed: ['channel_reach_basic_a1', 'channel_reach_combined_a1'].filter((x) => ids.includes(x)), reportTypesTotal: ids.length }; }
    if (st.id === 'reporting_jobs' && r.json) { const jobs = Array.isArray(r.json.jobs) ? r.json.jobs : []; report.reach = { ...(report.reach || {}), jobsExisting: ['channel_reach_basic_a1', 'channel_reach_combined_a1'].filter((x) => jobs.some((j) => j.reportTypeId === x)), jobsTotal: jobs.length }; }
    row.quotaCost = st.quota || {};
    report.results.push(row);
  }
  report.summary = summarize(report.results);
  report.capabilities = evaluateCapabilities(report.results);
  if (reference && report.provenance.real) report.reconcile = reconcile(report.aggregates, reference);
  return report;
}

export function summarize(results) {
  const lat = results.map((x) => x.latencyMs).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const count = (s) => results.filter((x) => x.status === s).length;
  const q = { data: 0, analytics: 0, reporting: 0 };
  for (const x of results) if (x.httpStatus) { const c = x.quotaCost || {}; q.data += c.data || 0; q.analytics += c.analytics || 0; q.reporting += c.reporting || 0; }
  return { steps: results.length, ok: count('ok'), okEmpty: count('ok_empty'), unsupportedAsDocumented: count('unsupported_as_documented'), unexpectedlySupported: count('unexpectedly_supported'), badRequest: count('bad_request'), forbidden: count('forbidden_scope'), quotaExceeded: count('quota_exceeded'), failed: count('failed') + count('error'), skipped: count('skipped_no_video'),
    latencyMs: { total: lat.reduce((a, b) => a + b, 0), p50: lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null, max: lat.length ? lat[lat.length - 1] : null }, quotaUnits: q };
}

// Map step results to one verdict per capability: retrievable / retrievable_but_empty / not_supported / forbidden / not_retrievable / not_run.
export function evaluateCapabilities(results) {
  const by = {}; for (const x of results) (by[x.cap] = by[x.cap] || []).push(x);
  const out = [];
  for (const cap of Object.keys(by)) {
    const rs = by[cap]; const st = rs.map((x) => x.status);
    let verdict;
    if (st.every((s) => s === 'skipped_no_video')) verdict = 'not_run';
    else if (st.every((s) => s === 'unsupported_as_documented')) verdict = 'not_supported_confirmed';
    else if (st.some((s) => s === 'unexpectedly_supported')) verdict = 'retrievable_UNEXPECTED';
    else if (st.some((s) => s === 'quota_exceeded')) verdict = 'quota_exceeded';
    else if (st.some((s) => s === 'forbidden_scope')) verdict = 'forbidden';
    else if (st.some((s) => s === 'ok')) verdict = st.every((s) => s === 'ok' || s === 'skipped_no_video') ? 'retrievable' : 'partly_retrievable';
    else if (st.every((s) => s === 'ok_empty' || s === 'ok')) verdict = 'retrievable_but_empty';
    else verdict = 'not_retrievable';
    out.push({ cap, verdict, steps: rs.map((x) => x.id), documented: rs[0].expect || null });
  }
  return out;
}

// Reconcile API aggregates with Studio figures supplied by the CEO at call time (never stored): { totalViews, advertisingViews, netSubscribers, watchHours } — tolerance 1%.
export function reconcile(aggregates, ref) {
  const out = {}; const rel = (a, b) => (b ? (a - b) / b : null); const chk = (name, api, studio) => { if (studio == null || api == null) return; const d = rel(api, studio); out[name] = { api, studio, diffPct: d === null ? null : Math.round(d * 1000) / 10, within1pct: d !== null && Math.abs(d) <= 0.01 }; };
  const tot = aggregates.channel_totals && aggregates.channel_totals.rows[0]; const cols = aggregates.channel_totals && aggregates.channel_totals.columns;
  if (tot && cols) { const g = (n) => (cols.indexOf(n) >= 0 ? tot[cols.indexOf(n)] : null); chk('totalViews', g('views'), ref.totalViews); chk('watchHours', g('estimatedMinutesWatched') == null ? null : Math.round((g('estimatedMinutesWatched') / 60) * 10) / 10, ref.watchHours); chk('netSubscribers', g('subscribersGained') == null ? null : g('subscribersGained') - (g('subscribersLost') || 0), ref.netSubscribers); }
  const ts = aggregates.traffic_source; if (ts) { const iT = ts.columns.indexOf('insightTrafficSourceType'), iV = ts.columns.indexOf('views'); const adv = ts.rows.find((r) => r[iT] === 'ADVERTISING'); chk('advertisingViews', adv ? adv[iV] : 0, ref.advertisingViews); }
  return out;
}

// Business-isolated runner used by the server action. `connections` are the rows the server read (the caller passes ONLY what it loaded; this function still
// selects the one row that belongs to the requested business). `refresh(refreshToken)` returns { accessToken }; `fetchImpl` is fetch. No token is ever put in the report.
export async function runProbeForBusiness({ business, connections, refresh, fetchImpl, from, to, videoId, now, reference, provenance }) {
  const want = PROBE_CHANNELS[business]; if (!want) return { ok: false, error: 'unknown_business' };
  const mine = (Array.isArray(connections) ? connections : []).filter((c) => c && c.channel_id === want);
  if (mine.length !== 1) return { ok: false, error: mine.length ? 'ambiguous_connection' : 'no_connection' };
  if (!/yt-analytics\.readonly/i.test(String(mine[0].scope || ''))) return { ok: false, error: 'missing_yt_analytics_scope' };
  let token; try { token = (await refresh(mine[0].refresh_token)).accessToken; } catch (e) { return { ok: false, error: 'token_refresh_failed' }; }
  // every Google request has a 20-second timeout: one slow request can never hang the whole probe
  const fetchJson = async (url) => { const r = await fetchImpl(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined }); let json = null; try { json = await r.json(); } catch (_) {} return { status: r.status, json }; };
  const report = await runProbe({ business, steps: probeSteps({ from, to, videoId }), fetchJson, now, reference, provenance });
  return { ok: !report.aborted, ...report };
}
