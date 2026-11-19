// Growth data collection (minimum server-side collection): the request plan, the authorization record, and the merge of raw YouTube Analytics responses into
// ONE JSON document per business (app_settings key growth_data_<business>) — no new tables, no migration.
// PURE except runCollection(), which only calls the injected fetchJson (bound by the server to ONE business's own authorization).
// Rules enforced in code (tested):
//  - only requests verified in the first live probe (R-B) are used; GET-only Google read endpoints; no revenue, no Reach/Reporting API, no search.list;
//  - the identity call is checked first: a channel mismatch aborts before any report is read (business isolation);
//  - a failed / empty / unsupported step NEVER overwrites stored data and NEVER becomes a zero; its status is recorded per step;
//  - a business document only ever contains rows normalized for its own channel id;
//  - collection is DEFAULT DISABLED: it needs a switch record (app_settings key growth_collect) naming the business, with an expiry for manual runs;
//  - the document is size-bounded (oldest days / periods are dropped first).
import { PROBE_CHANNELS, isReadOnlyAllowed, scrub, defaultPeriod } from './growthProbe.mjs';
import { normalizeResult } from './growthReporting.mjs';

export const COLLECT_SWITCH_KEY = 'growth_collect';
export const dataKey = (business) => 'growth_data_' + business;
export const COLLECT_CONFIRMATION = 'COLLECT-ANALYTICS-READ-ONLY';
export const LIMITS = Object.freeze({ maxDays: 400, maxPeriods: 60, maxCollections: 30, maxVideos: 200, retentionVideos: 5, maxDocBytes: 350000, backfillDays: 90, minRetentionViews: 50 });
const DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const qs = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const AN = 'https://youtubeanalytics.googleapis.com/v2/reports?';
const CORE = 'views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost';

// ── authorization: default disabled ──
// Record: {"enabled":true,"businesses":["silk_road_voices","srv_studio"],"authorized_until":"<ISO>"   // manual runs (CEO button), time-boxed
//          ,"schedule":true,"schedule_until":"<ISO, optional>"}                                       // daily scheduled run (existing 00:00 UTC cron), separate switch
// Written only by engineering after the CEO's separate written authorization; browsers cannot write app_settings keys other than the shared-state key.
export function collectAuthorization(raw, nowMs, business, mode = 'manual') {
  let v; try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return { ok: false, reason: 'collection_not_authorized', detail: 'unreadable record' }; }
  if (!v || typeof v !== 'object' || v.enabled !== true) return { ok: false, reason: 'collection_not_authorized', detail: 'collection is disabled (default)' };
  if (!Array.isArray(v.businesses) || !v.businesses.includes(business)) return { ok: false, reason: 'collection_not_authorized', detail: 'business not covered' };
  const key = mode === 'scheduled' ? 'schedule_until' : 'authorized_until';
  if (mode === 'scheduled' && v.schedule !== true) return { ok: false, reason: 'schedule_not_authorized', detail: 'scheduled collection is off (default)' };
  if (v[key] === undefined && mode === 'scheduled') return { ok: true, until: null };
  const until = Date.parse(v[key] || ''); if (!Number.isFinite(until)) return { ok: false, reason: 'collection_not_authorized', detail: 'no valid expiry' };
  if (until <= nowMs) return { ok: false, reason: 'collection_authorization_expired', detail: 'expired ' + new Date(until).toISOString() };
  return { ok: true, until: new Date(until).toISOString() };
}

// ── plan ──
// Windows: `from`–`to` = the last 28 complete Pacific days (Studio convention); the daily series and the daily paid series are backfilled over `backfillDays` (≈ 90) on every run
// so the first run fills history and later runs refresh/extend it (merged by date, newest wins). Cost per run ≈ 12 Analytics requests + 10 retention requests + 1 Data API unit.
export function collectSteps({ to, days = 28, backfillDays = LIMITS.backfillDays } = {}) {
  const from = addDays(to, -(days - 1)), bf = addDays(to, -(backfillDays - 1));
  const A = (id, q, extra = {}) => ({ id, kind: 'analytics', url: AN + qs({ ids: 'channel==MINE', ...q }), from: q.startDate, to: q.endDate, ...extra });
  return [
    { id: 'identity', kind: 'identity', url: 'https://www.googleapis.com/youtube/v3/channels?' + qs({ part: 'id', mine: 'true' }) },
    A('channel_totals', { startDate: from, endDate: to, metrics: CORE }),
    A('channel_totals_7d', { startDate: addDays(to, -6), endDate: to, metrics: CORE }),
    A('channel_totals_prev', { startDate: addDays(from, -days), endDate: addDays(from, -1), metrics: CORE }),
    A('daily_series', { startDate: bf, endDate: to, dimensions: 'day', metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost', sort: 'day' }),
    A('traffic_source', { startDate: from, endDate: to, dimensions: 'insightTrafficSourceType', metrics: 'views,engagedViews,estimatedMinutesWatched', sort: '-views' }),
    A('traffic_source_daily', { startDate: bf, endDate: to, dimensions: 'insightTrafficSourceType,day', metrics: 'views,estimatedMinutesWatched', sort: 'day' }),
    A('content_type', { startDate: from, endDate: to, dimensions: 'creatorContentType', metrics: 'views,estimatedMinutesWatched,averageViewDuration' }),
    A('subscribed_status', { startDate: from, endDate: to, dimensions: 'subscribedStatus', metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage' }),
    A('per_video', { startDate: from, endDate: to, dimensions: 'video', metrics: CORE, sort: '-views', maxResults: 200 }),
  ];
}
export const retentionSteps = (videoId, from, to) => ['all', 'organic'].map((aud) => ({ id: 'retention_' + aud + ':' + videoId, kind: 'analytics', videoId, audienceType: aud === 'organic' ? 'ORGANIC' : null, from, to,
  url: AN + qs({ ids: 'channel==MINE', startDate: from, endDate: to, dimensions: 'elapsedVideoTimeRatio', filters: `video==${videoId}` + (aud === 'organic' ? ';audienceType==ORGANIC' : ''), metrics: 'audienceWatchRatio,relativeRetentionPerformance' }) }));

// ── run: sequential, time-boxed, read-only. fetchJson(url, timeoutMs) => {status, json}. Returns { results:{id:{status,json}}, steps:[{id,status,http}], aborted }.
export async function runCollection({ business, steps, fetchJson, now = () => Date.now(), deadlineMs = 150000, requestTimeoutMs = 20000, retentionVideos = LIMITS.retentionVideos }) {
  const want = PROBE_CHANNELS[business]; if (!want) throw new Error('unknown business');
  const t0 = now(), out = { business, channelId: want, results: {}, steps: [], aborted: null, requests: { data: 0, analytics: 0 } };
  const list = [...steps]; let retentionAdded = false, quotaHit = false;
  for (let i = 0; i < list.length; i++) {
    const st = list[i];
    const remaining = deadlineMs - (now() - t0);
    if (quotaHit) { out.steps.push({ id: st.id, status: 'skipped_quota' }); continue; }
    if (remaining <= 0) { out.steps.push({ id: st.id, status: 'skipped_deadline' }); continue; }
    if (!isReadOnlyAllowed(st.url)) { out.steps.push({ id: st.id, status: 'refused_not_read_only' }); continue; }
    let r; try { r = await fetchJson(st.url, Math.max(1000, Math.min(requestTimeoutMs, remaining))); } catch (e) { out.steps.push({ id: st.id, status: 'error', error: scrub(e && e.message || e).slice(0, 100) }); continue; }
    if (st.kind === 'identity') out.requests.data++; else out.requests.analytics++;
    if (st.kind === 'identity') {
      const got = r && r.json && r.json.items && r.json.items[0] && r.json.items[0].id;
      if (!(r.status >= 200 && r.status < 300)) { out.aborted = `identity check failed (HTTP ${r.status}) — nothing else was requested`; out.steps.push({ id: st.id, status: 'identity_failed', http: r.status }); break; }
      if (got !== want) { out.aborted = `channel isolation violation: authorization belongs to ${got || 'unknown'}, expected ${want}`; out.steps.push({ id: st.id, status: 'identity_mismatch' }); break; }
      out.steps.push({ id: st.id, status: 'ok', http: r.status }); continue;
    }
    out.results[st.id] = { status: r.status, json: r.json, step: st };
    const rs = Number(r.status); if (rs === 429 || (rs === 403 && /quota|ratelimit|dailylimit/i.test(JSON.stringify(r.json && r.json.error || '')))) quotaHit = true;
    out.steps.push({ id: st.id, status: rs >= 200 && rs < 300 ? 'ok' : 'http_' + rs, http: rs });
    // after the per-video report: the top videos (by views, with enough views for a curve to mean something) get an all-viewers and an organic-only retention curve
    if (st.id === 'per_video' && !retentionAdded && rs >= 200 && rs < 300 && r.json && Array.isArray(r.json.rows)) {
      retentionAdded = true; const names = (r.json.columnHeaders || []).map((x) => x.name), iV = names.indexOf('video'), iW = names.indexOf('views');
      const top = r.json.rows.filter((x) => Number(x[iW]) >= LIMITS.minRetentionViews).slice(0, retentionVideos).map((x) => x[iV]).filter((x) => /^[A-Za-z0-9_-]{6,20}$/.test(String(x)));
      for (const v of top) list.push(...retentionSteps(v, st.from, st.to));
    }
  }
  return out;
}

// ── merge ──
export const emptyDoc = (business) => ({ v: 1, business, channel_id: PROBE_CHANNELS[business], updated_at: null, collections: [], days: {}, periods: [], videos: null, retention: {}, reconciliation: null });
const stripUndefined = (o) => JSON.parse(JSON.stringify(o));
const round = (x, n = 1) => (x === null || x === undefined ? null : Math.round(x * 10 ** n) / 10 ** n);
// Normalize every step's response (the same normalizer the probe/test suite uses), then fold into the document. `prev` is the stored document (or null).
export function mergeCollection(prev, run, { business, from, to, nowIso }) {
  const want = PROBE_CHANNELS[business]; if (!want) throw new Error('unknown business');
  const doc = prev && prev.business === business && prev.channel_id === want ? stripUndefined(prev) : emptyDoc(business);
  const ctxFor = (st) => ({ business, channelId: want, from: st.from, to: st.to, retrievedAt: nowIso, provenance: { real: true }, videoId: st.videoId, audienceType: st.audienceType });
  const norm = {}; const stepStatus = {};
  for (const id of Object.keys(run.results)) { const { status, json, step } = run.results[id]; const q = id.startsWith('retention_') ? 'retention_curve' : id.replace(/_7d$|_prev$/, ''); const n = normalizeResult(q, { status, json }, ctxFor(step)); norm[id] = n; stepStatus[id] = n.status; }
  for (const s of run.steps) if (!(s.id in stepStatus)) stepStatus[s.id] = s.status;
  const ok = (id) => norm[id] && norm[id].status === 'ok';
  const g = (id) => (ok(id) ? norm[id].rows : []);
  // daily series (+ paid views per day, only when the daily traffic report answered)
  if (ok('daily_series')) {
    const paid = ok('traffic_source_daily') ? new Map(g('traffic_source_daily').filter((r) => r.is_paid).map((r) => [r.date, r.views])) : null;
    for (const r of g('daily_series')) doc.days[r.date] = { views: r.views, minutes: r.watch_minutes, subs_gained: r.subscribers_gained, subs_lost: r.subscribers_lost, paid_views: paid ? (paid.get(r.date) ?? 0) : (doc.days[r.date] && doc.days[r.date].paid_views !== undefined ? doc.days[r.date].paid_views : null) };
  }
  // one period record per collection run (28-day) with traffic / format / subscribed splits and the 7-day and previous-28-day totals
  const tot = (id) => { const r = g(id)[0]; return r ? { views: r.views, engaged_views: r.engaged_views, minutes: r.watch_minutes, avg_view_duration_sec: r.avg_view_duration_sec, avg_view_pct: r.avg_view_pct, subs_gained: r.subscribers_gained, subs_lost: r.subscribers_lost } : null; };
  if (ok('channel_totals')) {
    const rec = { from, to, collected_at: nowIso, totals: tot('channel_totals'), totals_7d: tot('channel_totals_7d'), totals_prev: tot('channel_totals_prev'),
      traffic: ok('traffic_source') ? g('traffic_source').map((r) => ({ source: r.source_type, views: r.views, minutes: r.watch_minutes, paid: !!r.is_paid })) : null,
      formats: ok('content_type') ? g('content_type').map((r) => ({ type: r.content_type, raw: r.content_type_raw, views: r.views, minutes: r.watch_minutes, avg_view_duration_sec: r.avg_view_duration_sec })) : null,
      subscribed: ok('subscribed_status') ? g('subscribed_status').map((r) => ({ status: r.subscribed_status, views: r.views, minutes: r.watch_minutes, avg_view_duration_sec: r.avg_view_duration_sec, avg_view_pct: r.avg_view_pct })) : null };
    const prevRec = doc.periods.find((p) => p.from === from && p.to === to);   // a sub-report that failed this time keeps its earlier value for the same window (never replaced by null/zero)
    if (prevRec) for (const k of ['totals_7d', 'totals_prev', 'traffic', 'formats', 'subscribed']) if (rec[k] === null && prevRec[k]) rec[k] = prevRec[k];
    doc.periods = [rec, ...doc.periods.filter((p) => !(p.from === from && p.to === to))].slice(0, LIMITS.maxPeriods);
  }
  if (ok('per_video')) doc.videos = { from, to, collected_at: nowIso, rows: g('per_video').slice(0, LIMITS.maxVideos).map((r) => ({ id: r.video_id, views: r.views, minutes: r.watch_minutes, avg_view_duration_sec: r.avg_view_duration_sec, avg_view_pct: r.avg_view_pct, subs_gained: r.subscribers_gained, subs_lost: r.subscribers_lost })) };
  // retention: ≤ retentionVideos videos × (all, organic); replaced as a set so old videos do not accumulate
  const retIds = Object.keys(norm).filter((id) => id.startsWith('retention_') && ok(id));
  if (retIds.length) {
    const next = {};
    for (const id of retIds) { const rows = norm[id].rows; if (!rows.length) continue; const vid = rows[0].video_id, aud = rows[0].audience === 'ORGANIC' ? 'organic' : 'all'; (next[vid] = next[vid] || { from, to, collected_at: nowIso })[aud] = rows.filter((r) => r.ratio !== null && r.audience_watch_ratio !== null).map((r) => [round(r.ratio, 2), round(r.audience_watch_ratio, 4)]); }
    doc.retention = next;
  }
  // reconciliation inside the collection: the channel total must equal the sum of the daily series for the same window
  if (ok('channel_totals') && ok('daily_series')) {
    const t = tot('channel_totals'); const inWin = Object.keys(doc.days).filter((d) => d >= from && d <= to); const sum = (k) => inWin.reduce((a, d) => a + (doc.days[d][k] || 0), 0);
    const expectDays = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
    const chk = (metric, a, b) => ({ metric, channel_total: a, daily_sum: b, diff_pct: a ? round(((b - a) / a) * 100, 2) : null, ok: a === null || b === null ? null : Math.abs(b - a) <= Math.max(1, Math.abs(a) * 0.01) });
    doc.reconciliation = { at: nowIso, window: { from, to }, days_present: inWin.length, days_expected: expectDays, checks: [chk('views', t.views, sum('views')), chk('watch_minutes', t.minutes, sum('minutes')), chk('net_subscribers', t.subs_gained === null || t.subs_lost === null ? null : t.subs_gained - t.subs_lost, sum('subs_gained') - sum('subs_lost'))] };
  }
  // bounded size: drop the oldest days, then the oldest periods
  const keys = Object.keys(doc.days).sort(); if (keys.length > LIMITS.maxDays) for (const k of keys.slice(0, keys.length - LIMITS.maxDays)) delete doc.days[k];
  doc.collections = [{ at: nowIso, window: { from, to }, steps: stepStatus, requests: run.requests, aborted: run.aborted || null }, ...doc.collections].slice(0, LIMITS.maxCollections);
  doc.updated_at = nowIso;
  while (JSON.stringify(doc).length > LIMITS.maxDocBytes && (Object.keys(doc.days).length > 60 || doc.periods.length > 4)) { const ks = Object.keys(doc.days).sort(); if (ks.length > 60) delete doc.days[ks[0]]; else doc.periods.pop(); }
  return doc;
}
export const collectPeriod = (nowMs, days = 28) => defaultPeriod(nowMs, days);

// Business-isolated runner used by the server actions (same pattern as the R-B probe): `connections` are the rows the server loaded; this function selects the ONE row that belongs to the
// business, refreshes its own token (`refresh(refreshToken)` => { accessToken }) and runs the plan with GET-only requests. No token ever leaves this function.
export async function collectForBusiness({ business, connections, refresh, fetchImpl, to, now, deadlineMs, requestTimeoutMs }) {
  const want = PROBE_CHANNELS[business]; if (!want) return { ok: false, error: 'unknown_business' };
  const mine = (Array.isArray(connections) ? connections : []).filter((c) => c && c.channel_id === want);
  if (mine.length !== 1) return { ok: false, error: mine.length ? 'ambiguous_connection' : 'no_connection' };
  if (!/yt-analytics\.readonly/i.test(String(mine[0].scope || ''))) return { ok: false, error: 'missing_yt_analytics_scope' };
  let token; try { token = (await refresh(mine[0].refresh_token)).accessToken; } catch (e) { return { ok: false, error: 'token_refresh_failed' }; }
  const fetchJson = async (url, timeoutMs = 20000) => { const r = await fetchImpl(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(timeoutMs) : undefined }); let json = null; try { json = await r.json(); } catch (_) { json = null; } return { status: r.status, json }; };
  const run = await runCollection({ business, steps: collectSteps({ to }), fetchJson, now, deadlineMs, requestTimeoutMs });
  return { ok: !run.aborted, run, error: run.aborted ? 'aborted' : null, detail: run.aborted || null };
}
// Stored documents are read back defensively: anything that does not have the expected shape is dropped (and counted in doc.sanitized), never trusted and never allowed to throw downstream.
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const fin = (x) => (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e12 ? x : null);   // implausible magnitudes are treated as invalid
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x + 'T00:00:00Z'));
const TOT = ['views', 'engaged_views', 'minutes', 'avg_view_duration_sec', 'avg_view_pct', 'subs_gained', 'subs_lost'];
const tot = (t) => (isObj(t) ? Object.fromEntries(TOT.map((k) => [k, fin(t[k])])) : null);
export function sanitizeDoc(v, business) {
  if (!isObj(v) || v.business !== business || v.channel_id !== PROBE_CHANNELS[business]) return null;
  let dropped = 0; const d = emptyDoc(business); d.updated_at = typeof v.updated_at === 'string' ? v.updated_at : null;
  if (isObj(v.days)) for (const [k, x] of Object.entries(v.days)) { if (isDate(k) && isObj(x) && fin(x.views) !== null) d.days[k] = { views: x.views, minutes: fin(x.minutes), subs_gained: fin(x.subs_gained), subs_lost: fin(x.subs_lost), paid_views: fin(x.paid_views) }; else dropped++; }
  else if (v.days !== undefined) dropped++;
  const list = (a, f) => (Array.isArray(a) ? a.map(f).filter(Boolean) : null);
  if (Array.isArray(v.periods)) for (const p of v.periods) {
    if (!isObj(p) || !isDate(p.from) || !isDate(p.to)) { dropped++; continue; }
    d.periods.push({ from: p.from, to: p.to, collected_at: typeof p.collected_at === "string" ? p.collected_at : null, totals: tot(p.totals), totals_7d: tot(p.totals_7d), totals_prev: tot(p.totals_prev),
      traffic: list(p.traffic, (x) => (isObj(x) && typeof x.source === 'string' && fin(x.views) !== null ? { source: x.source, views: x.views, minutes: fin(x.minutes), paid: x.paid === true } : null)),
      formats: list(p.formats, (x) => (isObj(x) && typeof x.type === 'string' && fin(x.views) !== null ? { type: x.type, raw: typeof x.raw === 'string' ? x.raw : null, views: x.views, minutes: fin(x.minutes) || 0, avg_view_duration_sec: fin(x.avg_view_duration_sec) } : null)),
      subscribed: list(p.subscribed, (x) => (isObj(x) && typeof x.status === 'string' && fin(x.views) !== null ? { status: x.status, views: x.views, minutes: fin(x.minutes), avg_view_duration_sec: fin(x.avg_view_duration_sec), avg_view_pct: fin(x.avg_view_pct) } : null)) });
  } else if (v.periods !== undefined) dropped++;
  if (isObj(v.videos) && Array.isArray(v.videos.rows) && isDate(v.videos.from) && isDate(v.videos.to)) d.videos = { from: v.videos.from, to: v.videos.to, collected_at: typeof v.videos.collected_at === 'string' ? v.videos.collected_at : null, rows: v.videos.rows.map((r) => (isObj(r) && typeof r.id === 'string' && fin(r.views) !== null ? { id: r.id, views: r.views, minutes: fin(r.minutes) || 0, avg_view_duration_sec: fin(r.avg_view_duration_sec), avg_view_pct: fin(r.avg_view_pct), subs_gained: fin(r.subs_gained), subs_lost: fin(r.subs_lost) } : null)).filter(Boolean) }; else if (v.videos) dropped++;
  if (isObj(v.retention)) for (const [vid, c] of Object.entries(v.retention)) {
    const pts = (a) => (Array.isArray(a) ? a.filter((q) => Array.isArray(q) && fin(q[0]) !== null && fin(q[1]) !== null).map((q) => [q[0], q[1]]) : null);
    if (/^[A-Za-z0-9_-]{6,20}$/.test(vid) && isObj(c) && isDate(c.from) && isDate(c.to)) d.retention[vid] = { from: c.from, to: c.to, collected_at: typeof c.collected_at === 'string' ? c.collected_at : null, all: pts(c.all), organic: pts(c.organic) }; else dropped++;
  } else if (v.retention) dropped++;
  if (isObj(v.reconciliation) && Array.isArray(v.reconciliation.checks) && isObj(v.reconciliation.window)) { const r = v.reconciliation; d.reconciliation = { at: typeof r.at === 'string' ? r.at : null, window: { from: r.window.from, to: r.window.to }, days_present: fin(r.days_present) || 0, days_expected: fin(r.days_expected) || 0, checks: r.checks.filter(isObj).map((c) => ({ metric: String(c.metric), channel_total: fin(c.channel_total), daily_sum: fin(c.daily_sum), diff_pct: fin(c.diff_pct), ok: c.ok === true ? true : c.ok === false ? false : null })) }; } else if (v.reconciliation) dropped++;
  if (Array.isArray(v.collections)) d.collections = v.collections.filter((c) => isObj(c) && isObj(c.steps)).map((c) => ({ at: typeof c.at === 'string' ? c.at : null, window: isObj(c.window) ? c.window : null, steps: Object.fromEntries(Object.entries(c.steps).map(([k, x]) => [k, String(x)])), requests: isObj(c.requests) ? c.requests : {}, aborted: typeof c.aborted === 'string' ? c.aborted : null }));
  if (dropped) d.sanitized = { dropped };
  return d;
}
export const parseDoc = (raw, business) => { try { return sanitizeDoc(typeof raw === 'string' ? JSON.parse(raw) : raw, business); } catch (_) { return null; } };
export const cronSignatureInput = (serviceKey) => 'growth_collect:' + String(serviceKey || '');
