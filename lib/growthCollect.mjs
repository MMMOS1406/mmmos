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
export const LIMITS = Object.freeze({ maxDays: 400, maxPeriods: 60, maxCollections: 30, maxVideos: 200, retentionVideos: 5, maxDocBytes: 350000, backfillDays: 90, minRetentionViews: 50,
  // G3 (C4–C6): per-video sources for the top videos + Long videos; durations in chunks of 50 ids (Data API videos.list); retention prefers Long videos
  retentionLong: 3, sourceVideos: 10, maxSourceVideos: 20, minSourceViews: 20, durationChunk: 50, maxCatalogMeta: 1000, shortMaxSec: 61, longMinSec: 180, daySourcesKeep: 60,
  // request budget (hard cap per run, below the project's quotas: Analytics 100,000/day and 720/min, Data API 10,000 units/day) and per-upload day-N collection
  maxRequestsPerRun: 90, uploadDays: 12, uploadWindowDays: 36, maxUploads: 150 });
const DAY = 86400000;
// The collector's own allow-list = the probe's read-only list + ONE extra read: Data API videos.list with part=contentDetails (youtube.readonly, 1 quota unit per call, ≤ 50 ids). GET only.
export const collectorAllowed = (url, method = 'GET') => isReadOnlyAllowed(url, method) || (method === 'GET' && /^https:\/\/www\.googleapis\.com\/youtube\/v3\/videos\?part=contentDetails&id=[A-Za-z0-9_,-]+&maxResults=\d+$/.test(url));
export const ptDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });   // YouTube Analytics days are Pacific-time days
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const qs = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const AN = 'https://youtubeanalytics.googleapis.com/v2/reports?';
const ENG = 'views,likes,comments,shares,subscribersGained,subscribersLost';
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
    A('traffic_source_prev', { startDate: addDays(from, -days), endDate: addDays(from, -1), dimensions: 'insightTrafficSourceType', metrics: 'views,engagedViews,estimatedMinutesWatched', sort: '-views' }),   // C1: previous 28 days, same call shape as traffic_source
    A('traffic_source_daily', { startDate: bf, endDate: to, dimensions: 'insightTrafficSourceType,day', metrics: 'views,estimatedMinutesWatched', sort: 'day' }),
    A('content_type', { startDate: from, endDate: to, dimensions: 'creatorContentType', metrics: 'views,estimatedMinutesWatched,averageViewDuration' }),
    A('subscribed_status', { startDate: from, endDate: to, dimensions: 'subscribedStatus', metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage' }),
    A('engagement', { startDate: from, endDate: to, metrics: ENG }, { optional: true }),   // likes / comments / shares (window); form documented, NOT yet verified live → a 400 is recorded, never fatal
    A('engagement_prev', { startDate: addDays(from, -days), endDate: addDays(from, -1), metrics: ENG }, { optional: true }),
    A('geography', { startDate: from, endDate: to, dimensions: 'country', metrics: 'views,estimatedMinutesWatched,averageViewDuration', sort: '-views', maxResults: 25 }),   // verified live (R-B probe, both channels)
    A('demographics', { startDate: from, endDate: to, dimensions: 'ageGroup,gender', metrics: 'viewerPercentage' }),   // verified live (R-B probe, both channels)
    A('per_video', { startDate: from, endDate: to, dimensions: 'video', metrics: CORE, sort: '-views', maxResults: 200 }),
  ];
}
export const retentionSteps = (videoId, from, to) => ['all', 'organic'].map((aud) => ({ id: 'retention_' + aud + ':' + videoId, kind: 'analytics', videoId, audienceType: aud === 'organic' ? 'ORGANIC' : null, from, to,
  url: AN + qs({ ids: 'channel==MINE', startDate: from, endDate: to, dimensions: 'elapsedVideoTimeRatio', filters: `video==${videoId}` + (aud === 'organic' ? ';audienceType==ORGANIC' : ''), metrics: 'audienceWatchRatio,relativeRetentionPerformance' }) }));

// ── run: sequential, time-boxed, read-only. fetchJson(url, timeoutMs) => {status, json}. Returns { results:{id:{status,json}}, steps:[{id,status,http}], aborted }.
export async function runCollection({ business, steps, fetchJson, now = () => Date.now(), deadlineMs = 150000, requestTimeoutMs = 20000, retentionVideos = LIMITS.retentionVideos, knownDurationIds = [], sourceVideos = LIMITS.sourceVideos, recentUploads = [], uploadsDone = [] }) {
  const want = PROBE_CHANNELS[business]; if (!want) throw new Error('unknown business');
  const t0 = now(), out = { business, channelId: want, results: {}, steps: [], aborted: null, requests: { data: 0, analytics: 0 }, selection: null }; const known = new Set(knownDurationIds);
  const list = [...steps]; let retentionAdded = false, quotaHit = false;
  // newly published videos (last 36 days, from the channel's own catalog rows the server passes in): day-1/3/7/28 performance. Only ids not yet complete; newest first; ≤ 12 per run; this channel's ids only.
  { const todo = new Set(uploadsDone); const to0 = (steps.find((x) => x.id === 'channel_totals') || {}).to; let n = 0;
    for (const u of [...(Array.isArray(recentUploads) ? recentUploads : [])].filter((x) => x && /^[A-Za-z0-9_-]{6,20}$/.test(String(x.id)) && Number.isFinite(Date.parse(x.published_at))).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))) {
      if (n >= LIMITS.uploadDays || todo.has(u.id) || !to0) continue; const pub = ptDate(Date.parse(u.published_at)); if (pub < addDays(to0, -LIMITS.uploadWindowDays)) continue; const end = addDays(pub, 27) < to0 ? addDays(pub, 27) : to0; if (pub > end) continue;
      list.push({ id: 'video_days:' + u.id, kind: 'analytics', videoId: u.id, pub, from: pub, to: end, url: AN + qs({ ids: 'channel==MINE', startDate: pub, endDate: end, dimensions: 'day', filters: 'video==' + u.id, metrics: 'views', sort: 'day' }) }); n++; } }
  for (let i = 0; i < list.length; i++) {
    const st = list[i];
    const remaining = deadlineMs - (now() - t0);
    if (quotaHit) { out.steps.push({ id: st.id, status: 'skipped_quota' }); continue; }
    if (st.kind !== 'identity' && out.requests.data + out.requests.analytics >= LIMITS.maxRequestsPerRun) { out.steps.push({ id: st.id, status: 'skipped_budget' }); continue; }
    if (remaining <= 0) { out.steps.push({ id: st.id, status: 'skipped_deadline' }); continue; }
    if (!collectorAllowed(st.url)) { out.steps.push({ id: st.id, status: 'refused_not_read_only' }); continue; }
    let r; try { r = await fetchJson(st.url, Math.max(1000, Math.min(requestTimeoutMs, remaining))); } catch (e) { out.steps.push({ id: st.id, status: 'error', error: scrub(e && e.message || e).slice(0, 100) }); continue; }
    if (st.kind === 'identity' || st.kind === 'data') out.requests.data++; else out.requests.analytics++;
    if (st.kind === 'identity') {
      const got = r && r.json && r.json.items && r.json.items[0] && r.json.items[0].id;
      if (!(r.status >= 200 && r.status < 300)) { out.aborted = `identity check failed (HTTP ${r.status}) — nothing else was requested`; out.steps.push({ id: st.id, status: 'identity_failed', http: r.status }); break; }
      if (got !== want) { out.aborted = `channel isolation violation: authorization belongs to ${got || 'unknown'}, expected ${want}`; out.steps.push({ id: st.id, status: 'identity_mismatch' }); break; }
      out.steps.push({ id: st.id, status: 'ok', http: r.status }); continue;
    }
    out.results[st.id] = { status: r.status, json: r.json, step: st };
    const rs = Number(r.status); if (rs === 429 || (rs === 403 && /quota|ratelimit|dailylimit/i.test(JSON.stringify(r.json && r.json.error || '')))) quotaHit = true;
    out.steps.push({ id: st.id, status: rs >= 200 && rs < 300 ? 'ok' : 'http_' + rs, http: rs });
    // after the per-video report (all use only this run's own per-video rows — nothing from another channel can enter):
    //  C5 retention curves (all + organic) for the top videos, preferring LONG videos (runtime ≥ 180 s from average view duration ÷ average % viewed) so Shorts do not crowd them out;
    //  C6 per-video traffic-source split (paid vs organic per video) for the top videos + Long videos;  C4 authoritative durations (Data API videos.list) for videos not yet known.
    if (st.id === 'per_video' && !retentionAdded && rs >= 200 && rs < 300 && r.json && Array.isArray(r.json.rows)) {
      retentionAdded = true; const names = (r.json.columnHeaders || []).map((x) => x.name), iV = names.indexOf('video'), iW = names.indexOf('views'), iD = names.indexOf('averageViewDuration'), iP = names.indexOf('averageViewPercentage');
      const okId = (x) => /^[A-Za-z0-9_-]{6,20}$/.test(String(x));
      const pv = r.json.rows.filter((x) => okId(x[iV])).map((x) => { const avd = Number(x[iD]), pct = Number(x[iP]); return { id: String(x[iV]), views: Number(x[iW]) || 0, runtime: avd > 0 && pct > 0 ? avd / (pct / 100) : null }; });
      const isLong = (v) => v.runtime !== null && v.runtime >= LIMITS.longMinSec;
      const eligible = pv.filter((v) => v.views >= LIMITS.minRetentionViews);
      const longs = eligible.filter(isLong).slice(0, Math.min(LIMITS.retentionLong, retentionVideos)); const others = eligible.filter((v) => !longs.includes(v)).slice(0, Math.max(0, retentionVideos - longs.length));
      const retIds = [...longs, ...others].sort((a, b) => b.views - a.views).map((v) => v.id);
      for (const v of retIds) list.push(...retentionSteps(v, st.from, st.to));
      const srcCand = pv.filter((v) => v.views >= LIMITS.minSourceViews); const srcIds = [...new Set([...srcCand.slice(0, sourceVideos), ...srcCand.filter(isLong)].map((v) => v.id))].slice(0, LIMITS.maxSourceVideos);
      for (const v of srcIds) list.push({ id: 'video_sources:' + v, kind: 'analytics', videoId: v, from: st.from, to: st.to, url: AN + qs({ ids: 'channel==MINE', startDate: st.from, endDate: st.to, dimensions: 'insightTrafficSourceType', filters: 'video==' + v, metrics: 'views,estimatedMinutesWatched', sort: '-views' }) });
      const need = pv.map((v) => v.id).filter((id) => !known.has(id));
      for (let k = 0; k < need.length; k += LIMITS.durationChunk) { const ids = need.slice(k, k + LIMITS.durationChunk); list.push({ id: 'video_durations:' + (k / LIMITS.durationChunk), kind: 'data', videoIds: ids, url: 'https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=' + ids.join(',') + '&maxResults=' + ids.length }); }
      out.selection = { retention_long: longs.map((v) => v.id), retention_other: others.map((v) => v.id), sources: srcIds, durations_requested: need.length };
    }
  }
  return out;
}

// ── merge ──
// ── reconciliation precision ──
// The Analytics API reports watch time per day in WHOLE minutes, so the sum of the daily values cannot equal the channel total exactly: each day can be off by up to 1 minute
// (observed on both live channels: daily sums ~0.5 min/day below the totals). Views and subscriber counts are integers with no such rounding.
// A check passes when |daily_sum − channel_total| <= max(1, 1% of the total)  [existing relative tolerance]  + for watch minutes only: 1 minute per reporting day that is present
// (bounded at 31 days). Missing days are NOT excused: a day with data that is absent from the daily series lowers the sum by its full amount and fails the check.
export const MINUTES_ROUNDING_PER_DAY = 1, MINUTES_ROUNDING_MAX_DAYS = 31;
export function judgeCheck(metric, channelTotal, dailySum, daysPresent) {
  if (channelTotal === null || channelTotal === undefined || dailySum === null || dailySum === undefined || !Number.isFinite(channelTotal) || !Number.isFinite(dailySum)) return { ok: null, allowed: null, diff: null, diff_pct: null };
  const rel = Math.max(1, Math.abs(channelTotal) * 0.01);
  const rounding = metric === 'watch_minutes' ? MINUTES_ROUNDING_PER_DAY * Math.min(Math.max(Number(daysPresent) || 0, 0), MINUTES_ROUNDING_MAX_DAYS) : 0;
  const allowed = rel + rounding, diff = dailySum - channelTotal;
  return { ok: Math.abs(diff) <= allowed, allowed: Math.round(allowed * 100) / 100, diff, diff_pct: channelTotal ? Math.round((diff / channelTotal) * 10000) / 100 : null };
}
export const reconcileChecks = (totals, sums, daysPresent) => [['views', totals.views, sums.views], ['watch_minutes', totals.minutes, sums.minutes], ['net_subscribers', totals.net, sums.net]].map(([metric, a, b]) => ({ metric, channel_total: a, daily_sum: b, ...judgeCheck(metric, a, b, daysPresent) }));

// ── G3 parsers (pure). Every parser only accepts ids/rows that belong to the requesting step, so nothing from another channel or an unexpected response can enter the document. ──
export function isoDurationSec(x) { const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(x || '')); if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null; const sec = (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Math.round(Number(m[4] || 0)); return sec > 0 && sec < 86400 * 2 ? sec : null; }
export function parseDurations(json, wantedIds) {
  const want = new Set(wantedIds || []); const out = new Map();
  for (const it of (json && Array.isArray(json.items) ? json.items : [])) { const id = it && it.id; const sec = isoDurationSec(it && it.contentDetails && it.contentDetails.duration); if (typeof id === 'string' && want.has(id) && sec !== null) out.set(id, sec); }
  return out;
}
export function parseVideoSources(json) {   // one video's traffic-source rows → { SOURCE: { views, minutes } }
  const names = ((json && json.columnHeaders) || []).map((x) => x.name), iS = names.indexOf('insightTrafficSourceType'), iV = names.indexOf('views'), iM = names.indexOf('estimatedMinutesWatched'); if (iS < 0 || iV < 0) return null;
  const out = {}; for (const r of (json && Array.isArray(json.rows) ? json.rows : [])) { const src = String(r[iS] || ''); const v = Number(r[iV]); const m = iM >= 0 ? Number(r[iM]) : null; if (/^[A-Z_]{2,30}$/.test(src) && Number.isFinite(v) && v >= 0) out[src] = { views: v, minutes: Number.isFinite(m) ? m : null }; }
  return out;
}
const table = (json) => { const names = ((json && json.columnHeaders) || []).map((x) => x.name); return Array.isArray(json && json.rows) && names.length ? { names, rows: json.rows } : null; };
const nz = (x) => { const n = Number(x); return Number.isFinite(n) && n >= 0 ? n : null; };
export function parseEngagement(json) {   // channel-level window totals: likes, comments, shares (+views, subscribers) — first row only
  const t = table(json); if (!t || !t.rows.length) return null; const g = (n) => { const i = t.names.indexOf(n); return i < 0 ? null : nz(t.rows[0][i]); };
  const o = { views: g('views'), likes: g('likes'), comments: g('comments'), shares: g('shares'), subs_gained: g('subscribersGained'), subs_lost: g('subscribersLost') }; return o.views === null ? null : o;
}
export function parseGeography(json) {
  const t = table(json); if (!t) return null; const iC = t.names.indexOf('country'), iV = t.names.indexOf('views'), iM = t.names.indexOf('estimatedMinutesWatched'), iA = t.names.indexOf('averageViewDuration'); if (iC < 0 || iV < 0) return null;
  return t.rows.filter((r) => /^[A-Z]{2}$/.test(String(r[iC])) && nz(r[iV]) !== null).slice(0, 25).map((r) => ({ country: r[iC], views: nz(r[iV]), minutes: iM < 0 ? null : nz(r[iM]), avd: iA < 0 ? null : nz(r[iA]) }));
}
export function parseDemographics(json) {
  const t = table(json); if (!t) return null; const iA = t.names.indexOf('ageGroup'), iG = t.names.indexOf('gender'), iP = t.names.indexOf('viewerPercentage'); if (iA < 0 || iG < 0 || iP < 0) return null;
  return t.rows.filter((r) => /^age\d/.test(String(r[iA])) && /^(female|male|user_specified)$/i.test(String(r[iG])) && nz(r[iP]) !== null).slice(0, 40).map((r) => ({ age: String(r[iA]), gender: String(r[iG]).toLowerCase(), pct: nz(r[iP]) }));
}
// Day-1/3/7/28 performance of one upload: cumulative views over the first N calendar (Pacific) days starting on the publish date. A value is known only when the requested range covers those N days
// (the API omits days without views, so missing days inside a covered range are zero); otherwise null — never a partial number presented as final.
export function parseUploadDays(json, pub, coveredTo) {
  const t = table(json); if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(pub || '') || !/^\d{4}-\d{2}-\d{2}$/.test(coveredTo || '')) return null; const iD = t.names.indexOf('day'), iV = t.names.indexOf('views'); if (iD < 0 || iV < 0) return null;
  const by = {}; for (const r of t.rows) if (/^\d{4}-\d{2}-\d{2}$/.test(String(r[iD])) && nz(r[iV]) !== null) by[r[iD]] = nz(r[iV]);
  const sum = (n) => { if (coveredTo < addDays(pub, n - 1)) return null; let v = 0; for (let i = 0; i < n; i++) v += by[addDays(pub, i)] || 0; return v; };
  return { pub, d1: sum(1), d3: sum(3), d7: sum(7), d28: sum(28), through: coveredTo };
}
export function noteFailure(prev, { business, nowIso, error }) {   // a failed run keeps all stored data; it only records the attempt so the CEO can see it
  const want = PROBE_CHANNELS[business]; if (!want) throw new Error('unknown business'); const doc = prev && prev.business === business && prev.channel_id === want ? JSON.parse(JSON.stringify(prev)) : emptyDoc(business);
  doc.last_attempt = { at: nowIso, ok: false, error: String(error || 'failed').slice(0, 160) }; return doc;
}
const runtimeEst = (r) => (r && r.avg_view_duration_sec > 0 && r.avg_view_pct > 0 ? r.avg_view_duration_sec / (r.avg_view_pct / 100) : null);
const klass = (sec) => (sec === null ? null : sec <= LIMITS.shortMaxSec ? 'short' : sec >= LIMITS.longMinSec ? 'long' : 'mid');
// C4 cross-check: stored authoritative duration vs the runtime estimated from average view duration ÷ average % viewed (the estimate the dashboard uses when a duration is missing)
export function formatCheck(rows, meta, nowIso) {
  const list = Array.isArray(rows) ? rows : []; let checked = 0, agree = 0, disagree = 0, noEstimate = 0; const bad = [];
  for (const r of list) { const m = meta && meta[r.id]; if (!m || !Number.isFinite(m.dur)) continue; const est = runtimeEst(r); if (est === null) { noEstimate++; continue; } checked++;
    const sameClass = klass(est) !== 'mid' && klass(est) === klass(m.dur), close = Math.abs(est - m.dur) / m.dur <= 0.15; if (sameClass || close) agree++; else { disagree++; if (bad.length < 5) bad.push({ id: r.id, duration_sec: m.dur, estimated_sec: Math.round(est) }); } }
  return { at: nowIso, videos: list.length, with_duration: list.filter((r) => meta && meta[r.id]).length, checked, agree, disagree, no_estimate: noEstimate, disagreements: bad };
}
// Quality / freshness / reconciliation block stored with every run. `ok:null` = could not be judged (never reported as a pass).
export function qualityChecks({ doc, prevDays, from, to, nowIso }) {
  const checks = []; const add = (id, label, ok, value, detail) => checks.push({ id, label, ok, value: value === undefined ? null : value, detail: detail || null });
  const per = doc.periods[0] || null; const tv = per && per.totals ? per.totals.views : null;
  const trafficSum = per && per.traffic ? per.traffic.reduce((a, x) => a + (x.views || 0), 0) : null;
  add('traffic_coverage', 'Traffic-source rows cover the channel total (±0.5%)', trafficSum === null || tv === null ? null : Math.abs(trafficSum - tv) <= Math.max(5, tv * 0.005), trafficSum === null || tv === null ? null : { traffic: trafficSum, channel: tv }, null);
  const rowsSum = doc.videos && Array.isArray(doc.videos.rows) ? doc.videos.rows.reduce((a, r) => a + (r.views || 0), 0) : null;
  add('per_video_total', 'Per-video views add up to the channel total (±0.5%; videos beyond the 200-row cap are not included)', rowsSum === null || tv === null ? null : (doc.videos.rows.length >= LIMITS.maxVideos ? null : Math.abs(rowsSum - tv) <= Math.max(5, tv * 0.005)), rowsSum === null || tv === null ? null : { per_video: rowsSum, channel: tv });
  const chPaid = per && per.traffic ? (per.traffic.find((x) => x.paid) || { views: 0 }).views : null; const srcRows = doc.videos && Array.isArray(doc.videos.rows) ? doc.videos.rows.filter((r) => r.sources) : [];
  const vidPaid = srcRows.reduce((a, r) => a + (r.paid_views || 0), 0);
  add('per_video_paid', 'Per-video advertising views never exceed the channel advertising total (+1%)', !srcRows.length || chPaid === null ? null : vidPaid <= chPaid * 1.01 + 2, !srcRows.length ? null : { per_video_paid: vidPaid, channel_paid: chPaid, videos: srcRows.length });
  const inWin = Object.keys(doc.days).filter((d) => d >= from && d <= to).sort(); const expect = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1; const last = Object.keys(doc.days).sort().pop() || null;
  add('days_present', 'Days present in the collected window', inWin.length >= expect - 1 ? true : false, { present: inWin.length, expected: expect }, inWin.length < expect ? 'the newest day is usually not yet reported by YouTube' : null);
  const age = last ? Math.floor((Date.parse(nowIso) - Date.parse(last + 'T00:00:00Z')) / DAY) : null;
  { const miss = []; for (let d = from; d <= to; d = addDays(d, 1)) if (!doc.days[d]) miss.push(d); const gaps = miss.filter((d) => d !== to && d !== addDays(to, 0)); add('missing_days', 'No missing days inside the window (the newest day may not be reported yet)', gaps.length === 0, { missing: miss.length, gaps: gaps.length }, gaps.length ? 'missing: ' + gaps.slice(0, 6).join(', ') : null); }
  add('freshness', 'Data-through date is within 3 days', age === null ? null : age <= 3, { data_through: last, age_days: age });
  // revisions: the same days as the previous collection, last 7 days of the window — how much did YouTube revise recent days?
  let revN = 0, revNet = 0, revAbs = 0, revMaxPct = 0; for (const d of inWin.slice(-7)) { const a = prevDays && prevDays[d] && prevDays[d].views, b = doc.days[d] && doc.days[d].views; if (Number.isFinite(a) && Number.isFinite(b)) { revN++; revNet += b - a; revAbs += Math.abs(b - a); if (a > 0) revMaxPct = Math.max(revMaxPct, Math.abs(b - a) / a * 100); } }
  add('revisions', 'Late revisions to the last 7 days since the previous collection (information)', revN ? true : null, revN ? { days: revN, net_views: revNet, abs_views: revAbs, max_pct: Math.round(revMaxPct * 10) / 10 } : null, revN ? null : 'no previous collection to compare');
  const dsDays = inWin.filter((d) => doc.days[d].sources && doc.days[d].views > 0); const dsBad = dsDays.filter((d) => { const sum = Object.values(doc.days[d].sources).reduce((a, x) => a + x, 0); return Math.abs(sum - doc.days[d].views) > Math.max(2, doc.days[d].views * 0.01); });
  add('daily_sources', 'Daily traffic-source split adds up to the daily views (±1%)', dsDays.length ? dsBad.length === 0 : null, dsDays.length ? { days: dsDays.length, off: dsBad.length } : null);
  const bytes = JSON.stringify(doc).length; add('doc_size', 'Stored document is under 80% of the size cap', bytes <= LIMITS.maxDocBytes * 0.8, { bytes, cap: LIMITS.maxDocBytes });
  const fc = doc.format_check; add('format_check', 'Authoritative durations agree with the runtime estimate', !fc || !fc.checked ? null : fc.disagree === 0 || fc.disagree / fc.checked <= 0.1, fc ? { checked: fc.checked, agree: fc.agree, disagree: fc.disagree } : null);
  return { at: nowIso, window: { from, to }, ok: checks.every((c) => c.ok !== false), failed: checks.filter((c) => c.ok === false).map((c) => c.id), checks };
}

export const emptyDoc = (business) => ({ v: 1, business, channel_id: PROBE_CHANNELS[business], updated_at: null, collections: [], days: {}, periods: [], videos: null, retention: {}, reconciliation: null, catalog_meta: {}, format_check: null, quality: null, retention_selection: null, uploads: {}, last_ok_at: null, data_through: null, last_attempt: null });
const stripUndefined = (o) => JSON.parse(JSON.stringify(o));
const round = (x, n = 1) => (x === null || x === undefined ? null : Math.round(x * 10 ** n) / 10 ** n);
// Normalize every step's response (the same normalizer the probe/test suite uses), then fold into the document. `prev` is the stored document (or null).
export function mergeCollection(prev, run, { business, from, to, nowIso }) {
  const want = PROBE_CHANNELS[business]; if (!want) throw new Error('unknown business');
  if (run && run.business && run.business !== business) throw new Error('isolation: the collection run belongs to another business');
  const doc = prev && prev.business === business && prev.channel_id === want ? stripUndefined(prev) : emptyDoc(business);
  const prevDays = JSON.parse(JSON.stringify(doc.days)); if (!doc.catalog_meta || typeof doc.catalog_meta !== 'object') doc.catalog_meta = {};
  const ctxFor = (st) => ({ business, channelId: want, from: st.from, to: st.to, retrievedAt: nowIso, provenance: { real: true }, videoId: st.videoId, audienceType: st.audienceType });
  const norm = {}; const stepStatus = {};
  for (const id of Object.keys(run.results)) { if (/^(video_sources|video_durations|video_days):/.test(id) || ['engagement', 'engagement_prev', 'geography', 'demographics'].includes(id)) continue; const { status, json, step } = run.results[id]; const q = id.startsWith('retention_') ? 'retention_curve' : id.replace(/_7d$|_prev$/, ''); const n = normalizeResult(q, { status, json }, ctxFor(step)); norm[id] = n; stepStatus[id] = n.status; }
  for (const s of run.steps) if (!(s.id in stepStatus)) stepStatus[s.id] = s.status;
  const ok = (id) => norm[id] && norm[id].status === 'ok';
  const runOk = (id) => run.results[id] && Number(run.results[id].status) >= 200 && Number(run.results[id].status) < 300;
  const g = (id) => (ok(id) ? norm[id].rows : []);
  // daily series (+ paid views per day, only when the daily traffic report answered)
  if (ok('daily_series')) {
    const paid = ok('traffic_source_daily') ? new Map(g('traffic_source_daily').filter((r) => r.is_paid).map((r) => [r.date, r.views])) : null;
    const dsrc = ok('traffic_source_daily') ? (() => { const m = new Map(); for (const r of g('traffic_source_daily')) { if (!r.date || !r.source_type || !Number.isFinite(r.views)) continue; const o = m.get(r.date) || {}; o[r.source_type] = (o[r.source_type] || 0) + r.views; m.set(r.date, o); } return m; })() : null;   // C2: the full daily split (was reduced to the paid series only)
    for (const r of g('daily_series')) { const keepSrc = dsrc ? dsrc.get(r.date) : (doc.days[r.date] && doc.days[r.date].sources); doc.days[r.date] = { views: r.views, minutes: r.watch_minutes, subs_gained: r.subscribers_gained, subs_lost: r.subscribers_lost, paid_views: paid ? (paid.get(r.date) ?? 0) : (doc.days[r.date] && doc.days[r.date].paid_views !== undefined ? doc.days[r.date].paid_views : null)  }; if (keepSrc && Object.keys(keepSrc).length) doc.days[r.date].sources = keepSrc; }
  }
  // one period record per collection run (28-day) with traffic / format / subscribed splits and the 7-day and previous-28-day totals
  const tot = (id) => { const r = g(id)[0]; return r ? { views: r.views, engaged_views: r.engaged_views, minutes: r.watch_minutes, avg_view_duration_sec: r.avg_view_duration_sec, avg_view_pct: r.avg_view_pct, subs_gained: r.subscribers_gained, subs_lost: r.subscribers_lost } : null; };
  if (ok('channel_totals')) {
    const rec = { from, to, collected_at: nowIso, totals: tot('channel_totals'), totals_7d: tot('channel_totals_7d'), totals_prev: tot('channel_totals_prev'),
      traffic: ok('traffic_source') ? g('traffic_source').map((r) => ({ source: r.source_type, views: r.views, minutes: r.watch_minutes, paid: !!r.is_paid })) : null,
      formats: ok('content_type') ? g('content_type').map((r) => ({ type: r.content_type, raw: r.content_type_raw, views: r.views, minutes: r.watch_minutes, avg_view_duration_sec: r.avg_view_duration_sec })) : null,
      engagement: runOk('engagement') ? parseEngagement(run.results.engagement.json) : null, engagement_prev: runOk('engagement_prev') ? parseEngagement(run.results.engagement_prev.json) : null,
      geography: runOk('geography') ? parseGeography(run.results.geography.json) : null, demographics: runOk('demographics') ? parseDemographics(run.results.demographics.json) : null,
      traffic_prev: ok('traffic_source_prev') ? g('traffic_source_prev').map((r) => ({ source: r.source_type, views: r.views, minutes: r.watch_minutes, paid: !!r.is_paid })) : null,
      subscribed: ok('subscribed_status') ? g('subscribed_status').map((r) => ({ status: r.subscribed_status, views: r.views, minutes: r.watch_minutes, avg_view_duration_sec: r.avg_view_duration_sec, avg_view_pct: r.avg_view_pct })) : null };
    const prevRec = doc.periods.find((p) => p.from === from && p.to === to);   // a sub-report that failed this time keeps its earlier value for the same window (never replaced by null/zero)
    if (prevRec) for (const k of ['totals_7d', 'totals_prev', 'traffic', 'traffic_prev', 'formats', 'subscribed', 'engagement', 'engagement_prev', 'geography', 'demographics']) if (rec[k] === null && prevRec[k]) rec[k] = prevRec[k];
    doc.periods = [rec, ...doc.periods.filter((p) => !(p.from === from && p.to === to))].slice(0, LIMITS.maxPeriods);
  }
  if (ok('per_video')) doc.videos = { from, to, collected_at: nowIso, rows: g('per_video').slice(0, LIMITS.maxVideos).map((r) => ({ id: r.video_id, views: r.views, minutes: r.watch_minutes, avg_view_duration_sec: r.avg_view_duration_sec, avg_view_pct: r.avg_view_pct, subs_gained: r.subscribers_gained, subs_lost: r.subscribers_lost })) };
  // C6: per-video traffic-source split (this run's window only) → paid views per video and organic average view duration per video (derived: (all minutes − advertising minutes) ÷ (all views − advertising views))
  if (doc.videos && Array.isArray(doc.videos.rows)) for (const row of doc.videos.rows) {
    const rr = run.results['video_sources:' + row.id]; if (!rr || !(Number(rr.status) >= 200 && Number(rr.status) < 300)) continue; const src = parseVideoSources(rr.json); if (!src || !Object.keys(src).length) continue;
    const total = Object.values(src).reduce((a, x) => a + x.views, 0); row.sources = src; row.sources_match = Math.abs(total - row.views) <= Math.max(2, row.views * 0.02);
    const ad = src.ADVERTISING || { views: 0, minutes: 0 }; row.paid_views = ad.views; const ov = row.views - ad.views, om = Number.isFinite(row.minutes) && Number.isFinite(ad.minutes) ? row.minutes - ad.minutes : null;
    row.organic_avd_sec = ov >= 1 && om !== null && om >= 0 ? Math.round((om * 60) / ov) : null;
  }
  // C4: authoritative durations (Data API); only ids that were asked for are accepted
  for (const id of Object.keys(run.results).filter((x) => x.startsWith('video_durations:'))) { const rr = run.results[id]; if (!(Number(rr.status) >= 200 && Number(rr.status) < 300)) continue; for (const [vid, sec] of parseDurations(rr.json, rr.step && rr.step.videoIds)) doc.catalog_meta[vid] = { dur: sec, at: nowIso }; }
  { const ks = Object.keys(doc.catalog_meta); if (ks.length > LIMITS.maxCatalogMeta) for (const k2 of ks.sort((a, b) => (doc.catalog_meta[a].at < doc.catalog_meta[b].at ? -1 : 1)).slice(0, ks.length - LIMITS.maxCatalogMeta)) delete doc.catalog_meta[k2]; }
  if (doc.videos && Array.isArray(doc.videos.rows)) doc.format_check = formatCheck(doc.videos.rows, doc.catalog_meta, nowIso);
  if (run.selection) doc.retention_selection = { at: nowIso, ...run.selection };
  // per-upload day-N performance (accumulates across runs; completed uploads are not requested again)
  if (!doc.uploads || typeof doc.uploads !== 'object') doc.uploads = {};
  for (const id of Object.keys(run.results).filter((x) => x.startsWith('video_days:'))) { const rr = run.results[id]; if (!(Number(rr.status) >= 200 && Number(rr.status) < 300) || !rr.step) continue; const u = parseUploadDays(rr.json, rr.step.pub, rr.step.to); if (u) doc.uploads[id.slice('video_days:'.length)] = { ...u, at: nowIso }; }
  { const ks = Object.keys(doc.uploads); if (ks.length > LIMITS.maxUploads) for (const k2 of ks.sort((a, b) => (doc.uploads[a].pub < doc.uploads[b].pub ? -1 : 1)).slice(0, ks.length - LIMITS.maxUploads)) delete doc.uploads[k2]; }
  if (ok('channel_totals') && ok('daily_series')) { doc.last_ok_at = nowIso; doc.data_through = Object.keys(doc.days).sort().pop() || null; doc.last_attempt = { at: nowIso, ok: true, error: null }; }
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
    const net = t.subs_gained === null || t.subs_lost === null ? null : t.subs_gained - t.subs_lost;
    doc.reconciliation = { at: nowIso, window: { from, to }, days_present: inWin.length, days_expected: expectDays, checks: reconcileChecks({ views: t.views, minutes: t.minutes, net }, { views: sum('views'), minutes: sum('minutes'), net: sum('subs_gained') - sum('subs_lost') }, inWin.length) };
  }
  doc.collections = [{ at: nowIso, window: { from, to }, steps: stepStatus, requests: run.requests, aborted: run.aborted || null }, ...doc.collections].slice(0, LIMITS.maxCollections);
  doc.updated_at = nowIso;
  doc.quality = qualityChecks({ doc, prevDays, from, to, nowIso });
  // bounded size: drop the oldest days, then the oldest periods
  const keys = Object.keys(doc.days).sort(); if (keys.length > LIMITS.maxDays) for (const k of keys.slice(0, keys.length - LIMITS.maxDays)) delete doc.days[k];
  while (JSON.stringify(doc).length > LIMITS.maxDocBytes) { const ks = Object.keys(doc.days).sort().filter((d) => doc.days[d].sources); if (ks.length > LIMITS.daySourcesKeep) delete doc.days[ks[0]].sources; else break; }   // C2 data goes first
  while (JSON.stringify(doc).length > LIMITS.maxDocBytes && (Object.keys(doc.days).length > 60 || doc.periods.length > 4)) { const ks = Object.keys(doc.days).sort(); if (ks.length > 60) delete doc.days[ks[0]]; else doc.periods.pop(); }
  return doc;
}
export const collectPeriod = (nowMs, days = 28) => defaultPeriod(nowMs, days);

// Business-isolated runner used by the server actions (same pattern as the R-B probe): `connections` are the rows the server loaded; this function selects the ONE row that belongs to the
// business, refreshes its own token (`refresh(refreshToken)` => { accessToken }) and runs the plan with GET-only requests. No token ever leaves this function.
export async function collectForBusiness({ business, connections, refresh, fetchImpl, to, now, deadlineMs, requestTimeoutMs, knownDurationIds, recentUploads, uploadsDone }) {
  const want = PROBE_CHANNELS[business]; if (!want) return { ok: false, error: 'unknown_business' };
  const mine = (Array.isArray(connections) ? connections : []).filter((c) => c && c.channel_id === want);
  if (mine.length !== 1) return { ok: false, error: mine.length ? 'ambiguous_connection' : 'no_connection' };
  if (!/yt-analytics\.readonly/i.test(String(mine[0].scope || ''))) return { ok: false, error: 'missing_yt_analytics_scope' };
  let token; try { token = (await refresh(mine[0].refresh_token)).accessToken; } catch (e) { return { ok: false, error: 'token_refresh_failed' }; }
  const fetchJson = async (url, timeoutMs = 20000) => { const r = await fetchImpl(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(timeoutMs) : undefined }); let json = null; try { json = await r.json(); } catch (_) { json = null; } return { status: r.status, json }; };
  const run = await runCollection({ business, steps: collectSteps({ to }), fetchJson, now, deadlineMs, requestTimeoutMs, knownDurationIds, recentUploads, uploadsDone });
  return { ok: !run.aborted, run, error: run.aborted ? 'aborted' : null, detail: run.aborted || null };
}
// Stored documents are read back defensively: anything that does not have the expected shape is dropped (and counted in doc.sanitized), never trusted and never allowed to throw downstream.
// (the stored `ok` of a check is informational only: it is re-judged from the stored numbers whenever a report is built)
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const fin = (x) => (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e12 ? x : null);   // implausible magnitudes are treated as invalid
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x + 'T00:00:00Z'));
const TOT = ['views', 'engaged_views', 'minutes', 'avg_view_duration_sec', 'avg_view_pct', 'subs_gained', 'subs_lost'];
const tot = (t) => (isObj(t) ? Object.fromEntries(TOT.map((k) => [k, fin(t[k])])) : null);
const engSan = (e) => (isObj(e) && fin(e.views) !== null ? { views: e.views, likes: fin(e.likes), comments: fin(e.comments), shares: fin(e.shares), subs_gained: fin(e.subs_gained), subs_lost: fin(e.subs_lost) } : null);
const srcMap = (o) => { if (!isObj(o)) return null; const out = {}; for (const [k, x] of Object.entries(o).slice(0, 24)) if (/^[A-Z_]{2,30}$/.test(k) && fin(x) !== null && x >= 0) out[k] = x; return Object.keys(out).length ? out : null; };
const srcDetail = (o) => { if (!isObj(o)) return null; const out = {}; for (const [k, x] of Object.entries(o).slice(0, 24)) if (/^[A-Z_]{2,30}$/.test(k) && isObj(x) && fin(x.views) !== null && x.views >= 0) out[k] = { views: x.views, minutes: fin(x.minutes) }; return Object.keys(out).length ? out : null; };
const qchecks = (q) => (isObj(q) && Array.isArray(q.checks) ? { at: typeof q.at === 'string' ? q.at : null, window: isObj(q.window) ? { from: isDate(q.window.from) ? q.window.from : null, to: isDate(q.window.to) ? q.window.to : null } : null, ok: q.ok !== false, failed: Array.isArray(q.failed) ? q.failed.filter((x) => typeof x === 'string').slice(0, 20) : [], checks: q.checks.filter((c) => isObj(c) && typeof c.id === 'string').slice(0, 30).map((c) => ({ id: c.id, label: typeof c.label === 'string' ? c.label.slice(0, 160) : '', ok: c.ok === true ? true : c.ok === false ? false : null, value: isObj(c.value) ? Object.fromEntries(Object.entries(c.value).slice(0, 8).map(([k, x]) => [k, typeof x === 'number' || typeof x === 'string' ? x : null])) : null, detail: typeof c.detail === 'string' ? c.detail.slice(0, 200) : null })) } : null);
export function sanitizeDoc(v, business) {
  if (!isObj(v) || v.business !== business || v.channel_id !== PROBE_CHANNELS[business]) return null;
  let dropped = 0; const d = emptyDoc(business); d.updated_at = typeof v.updated_at === 'string' ? v.updated_at : null;
  if (isObj(v.days)) for (const [k, x] of Object.entries(v.days)) { if (isDate(k) && isObj(x) && fin(x.views) !== null) d.days[k] = { views: x.views, minutes: fin(x.minutes), subs_gained: fin(x.subs_gained), subs_lost: fin(x.subs_lost), paid_views: fin(x.paid_views), ...(srcMap(x.sources) ? { sources: srcMap(x.sources) } : {}) }; else dropped++; }
  else if (v.days !== undefined) dropped++;
  const list = (a, f) => (Array.isArray(a) ? a.map(f).filter(Boolean) : null);
  if (Array.isArray(v.periods)) for (const p of v.periods) {
    if (!isObj(p) || !isDate(p.from) || !isDate(p.to)) { dropped++; continue; }
    d.periods.push({ from: p.from, to: p.to, collected_at: typeof p.collected_at === "string" ? p.collected_at : null, totals: tot(p.totals), totals_7d: tot(p.totals_7d), totals_prev: tot(p.totals_prev),
      traffic: list(p.traffic, (x) => (isObj(x) && typeof x.source === 'string' && fin(x.views) !== null ? { source: x.source, views: x.views, minutes: fin(x.minutes), paid: x.paid === true } : null)),
      engagement: engSan(p.engagement), engagement_prev: engSan(p.engagement_prev),
      geography: list(p.geography, (x) => (isObj(x) && /^[A-Z]{2}$/.test(String(x.country)) && fin(x.views) !== null ? { country: x.country, views: x.views, minutes: fin(x.minutes), avd: fin(x.avd) } : null)),
      demographics: list(p.demographics, (x) => (isObj(x) && /^age\d/.test(String(x.age)) && /^(female|male|user_specified)$/.test(String(x.gender)) && fin(x.pct) !== null ? { age: x.age, gender: x.gender, pct: x.pct } : null)),
      traffic_prev: list(p.traffic_prev, (x) => (isObj(x) && typeof x.source === 'string' && fin(x.views) !== null ? { source: x.source, views: x.views, minutes: fin(x.minutes), paid: x.paid === true } : null)),
      formats: list(p.formats, (x) => (isObj(x) && typeof x.type === 'string' && fin(x.views) !== null ? { type: x.type, raw: typeof x.raw === 'string' ? x.raw : null, views: x.views, minutes: fin(x.minutes) || 0, avg_view_duration_sec: fin(x.avg_view_duration_sec) } : null)),
      subscribed: list(p.subscribed, (x) => (isObj(x) && typeof x.status === 'string' && fin(x.views) !== null ? { status: x.status, views: x.views, minutes: fin(x.minutes), avg_view_duration_sec: fin(x.avg_view_duration_sec), avg_view_pct: fin(x.avg_view_pct) } : null)) });
  } else if (v.periods !== undefined) dropped++;
  if (isObj(v.videos) && Array.isArray(v.videos.rows) && isDate(v.videos.from) && isDate(v.videos.to)) d.videos = { from: v.videos.from, to: v.videos.to, collected_at: typeof v.videos.collected_at === 'string' ? v.videos.collected_at : null, rows: v.videos.rows.map((r) => (isObj(r) && typeof r.id === 'string' && fin(r.views) !== null ? { id: r.id, views: r.views, minutes: fin(r.minutes) || 0, avg_view_duration_sec: fin(r.avg_view_duration_sec), avg_view_pct: fin(r.avg_view_pct), subs_gained: fin(r.subs_gained), subs_lost: fin(r.subs_lost), ...(srcDetail(r.sources) ? { sources: srcDetail(r.sources), sources_match: r.sources_match === true, paid_views: fin(r.paid_views), organic_avd_sec: fin(r.organic_avd_sec) } : {}) } : null)).filter(Boolean) }; else if (v.videos) dropped++;
  if (isObj(v.retention)) for (const [vid, c] of Object.entries(v.retention)) {
    const pts = (a) => (Array.isArray(a) ? a.filter((q) => Array.isArray(q) && fin(q[0]) !== null && fin(q[1]) !== null).map((q) => [q[0], q[1]]) : null);
    if (/^[A-Za-z0-9_-]{6,20}$/.test(vid) && isObj(c) && isDate(c.from) && isDate(c.to)) d.retention[vid] = { from: c.from, to: c.to, collected_at: typeof c.collected_at === 'string' ? c.collected_at : null, all: pts(c.all), organic: pts(c.organic) }; else dropped++;
  } else if (v.retention) dropped++;
  if (isObj(v.reconciliation) && Array.isArray(v.reconciliation.checks) && isObj(v.reconciliation.window)) { const r = v.reconciliation; d.reconciliation = { at: typeof r.at === 'string' ? r.at : null, window: { from: r.window.from, to: r.window.to }, days_present: fin(r.days_present) || 0, days_expected: fin(r.days_expected) || 0, checks: r.checks.filter(isObj).map((c) => ({ metric: String(c.metric), channel_total: fin(c.channel_total), daily_sum: fin(c.daily_sum), diff_pct: fin(c.diff_pct), ok: c.ok === true ? true : c.ok === false ? false : null })) }; } else if (v.reconciliation) dropped++;
  if (Array.isArray(v.collections)) d.collections = v.collections.filter((c) => isObj(c) && isObj(c.steps)).map((c) => ({ at: typeof c.at === 'string' ? c.at : null, window: isObj(c.window) ? c.window : null, steps: Object.fromEntries(Object.entries(c.steps).map(([k, x]) => [k, String(x)])), requests: isObj(c.requests) ? c.requests : {}, aborted: typeof c.aborted === 'string' ? c.aborted : null }));
  if (isObj(v.catalog_meta)) for (const [vid, m] of Object.entries(v.catalog_meta).slice(0, LIMITS.maxCatalogMeta)) { if (/^[A-Za-z0-9_-]{6,20}$/.test(vid) && isObj(m) && fin(m.dur) !== null && m.dur > 0 && m.dur < 172800) d.catalog_meta[vid] = { dur: m.dur, at: typeof m.at === 'string' ? m.at : null }; else dropped++; }
  if (isObj(v.format_check)) { const f = v.format_check; d.format_check = { at: typeof f.at === 'string' ? f.at : null, videos: fin(f.videos) || 0, with_duration: fin(f.with_duration) || 0, checked: fin(f.checked) || 0, agree: fin(f.agree) || 0, disagree: fin(f.disagree) || 0, no_estimate: fin(f.no_estimate) || 0, disagreements: Array.isArray(f.disagreements) ? f.disagreements.filter(isObj).slice(0, 5).map((x) => ({ id: typeof x.id === 'string' ? x.id : '', duration_sec: fin(x.duration_sec), estimated_sec: fin(x.estimated_sec) })) : [] }; }
  d.quality = qchecks(v.quality);
  if (isObj(v.uploads)) for (const [id, u] of Object.entries(v.uploads).slice(0, LIMITS.maxUploads)) { if (/^[A-Za-z0-9_-]{6,20}$/.test(id) && isObj(u) && isDate(u.pub) && isDate(u.through)) d.uploads[id] = { pub: u.pub, d1: fin(u.d1), d3: fin(u.d3), d7: fin(u.d7), d28: fin(u.d28), through: u.through, at: typeof u.at === 'string' ? u.at : null }; else dropped++; }
  d.last_ok_at = typeof v.last_ok_at === 'string' ? v.last_ok_at : null; d.data_through = isDate(v.data_through) ? v.data_through : null;
  d.last_attempt = isObj(v.last_attempt) && typeof v.last_attempt.at === 'string' ? { at: v.last_attempt.at, ok: v.last_attempt.ok === true, error: typeof v.last_attempt.error === 'string' ? v.last_attempt.error.slice(0, 160) : null } : null;
  if (isObj(v.retention_selection)) d.retention_selection = { at: typeof v.retention_selection.at === 'string' ? v.retention_selection.at : null, retention_long: Array.isArray(v.retention_selection.retention_long) ? v.retention_selection.retention_long.filter((x) => typeof x === 'string').slice(0, 10) : [], retention_other: Array.isArray(v.retention_selection.retention_other) ? v.retention_selection.retention_other.filter((x) => typeof x === 'string').slice(0, 10) : [], sources: Array.isArray(v.retention_selection.sources) ? v.retention_selection.sources.filter((x) => typeof x === 'string').slice(0, 30) : [], durations_requested: fin(v.retention_selection.durations_requested) || 0 };
  if (dropped) d.sanitized = { dropped };
  return d;
}
export const parseDoc = (raw, business) => { try { return sanitizeDoc(typeof raw === 'string' ? JSON.parse(raw) : raw, business); } catch (_) { return null; } };
export const cronSignatureInput = (serviceKey) => 'growth_collect:' + String(serviceKey || '');
