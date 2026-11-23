// Thumbnail impressions and click-through rate — YouTube Reporting API "reach" reports (C3). READINESS ONLY: PURE library (no network, database or clock; the caller passes `nowMs`).
// NOTHING here is wired into any endpoint, schedule or page. It defines, tests and documents what a future, separately authorized reach sync will do:
//   plan (which requests, which are state-changing) · authorization record (default DISABLED) · request allow-list · CSV parsing · per-business document · packaging comparison · budget · failure handling.
// Facts used (Google documentation reviewed 2026-11-22; NOT yet confirmed by a live request):
//  - report types channel_reach_basic_a1 (date, channel_id, video_id → video_thumbnail_impressions, video_thumbnail_impressions_ctr) and
//    channel_reach_combined_a1 (adds traffic_source_type, traffic_source_detail, operating_system, device_type); added 2026-01-15.
//  - an impression = thumbnail shown > 1 s with ≥ 50% visible; CTR = clicks ÷ impressions; whether Shorts/feed impressions are included is NOT stated.
//  - YouTube generates nothing until a job exists; first report ≤ 48 h after creation for the creation day, plus up to 30 days of earlier history (typically within a couple of days);
//    non-historical reports stay downloadable 60 days (historical 30) → we must download and keep them; one report = one Pacific day; versioned CSV, gzip optional.
//  - scope: the page lists yt-analytics.readonly (and the monetary scope) for Reporting API requests but its samples use the monetary scope → sufficiency of the read-only scope is UNVERIFIED.
//  - the CTR value's scale (fraction vs percent) is not stated → parsed with an explicit, tested detection and reported as ambiguous when it cannot be decided.
import { PROBE_CHANNELS } from './growthProbe.mjs';

export const REACH_SWITCH_KEY = 'growth_reach';
export const reachDataKey = (business) => 'growth_reach_' + business;
export const REACH_TYPES = Object.freeze({ basic: 'channel_reach_basic_a1', combined: 'channel_reach_combined_a1' });
export const REACH_LIMITS = Object.freeze({ keepDays: 60, maxDocBytes: 350000, minGroup: 5, minImpressions: 1000, backfillReports: 31 });
const DAY = 86400000;
const BASE = 'https://youtubereporting.googleapis.com/v1';

// ── authorization: default disabled (same pattern as growth_collect; written only by engineering after the CEO's separate written authorization) ──
// Record: {"enabled":true,"businesses":["silk_road_voices"],"authorized_until":"<ISO>","types":["basic"]}
export function reachAuthorization(raw, nowMs, business, type = 'basic') {
  let v; try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return { ok: false, reason: 'reach_not_authorized', detail: 'unreadable record' }; }
  if (!v || typeof v !== 'object' || v.enabled !== true) return { ok: false, reason: 'reach_not_authorized', detail: 'reach sync is disabled (default)' };
  if (!Array.isArray(v.businesses) || !v.businesses.includes(business)) return { ok: false, reason: 'reach_not_authorized', detail: 'business not covered' };
  if (!Array.isArray(v.types) || !v.types.includes(type)) return { ok: false, reason: 'reach_not_authorized', detail: 'report type not covered' };
  const until = Date.parse(v.authorized_until || ''); if (!Number.isFinite(until)) return { ok: false, reason: 'reach_not_authorized', detail: 'no valid expiry' };
  if (until <= nowMs) return { ok: false, reason: 'reach_authorization_expired', detail: 'expired ' + new Date(until).toISOString() };
  return { ok: true, until: new Date(until).toISOString() };
}

// ── the plan: every request, flagged by whether it changes state at Google. Nothing is executed here. ──
export function reachPlan({ business, types = ['basic'] }) {
  if (!PROBE_CHANNELS[business]) throw new Error('unknown business');
  const steps = [{ id: 'report_types', method: 'GET', url: `${BASE}/reportTypes`, state_change: false, purpose: 'confirm the reach report types exist for this channel and that the granted scope is accepted' },
    { id: 'jobs_list', method: 'GET', url: `${BASE}/jobs`, state_change: false, purpose: 'find an existing job for each type (never create a duplicate)' }];
  for (const t of types) {
    steps.push({ id: 'job_create:' + t, method: 'POST', url: `${BASE}/jobs`, body: { reportTypeId: REACH_TYPES[t], name: `mmmos-${business}-${t}` }, state_change: true, once: true, purpose: 'creates the reporting job at Google (reversible with jobs.delete; no cost)' });
    steps.push({ id: 'reports_list:' + t, method: 'GET', url: `${BASE}/jobs/<jobId>/reports`, state_change: false, daily: true, purpose: 'list reports newer than the last stored one' });
    steps.push({ id: 'report_download:' + t, method: 'GET', url: `${BASE}/media/<downloadUrl>`, state_change: false, daily: true, gzip: true, purpose: 'download each new day\'s CSV (Accept-Encoding: gzip)' });
  }
  return steps;
}
// Allow-list for a future executor: only these shapes; the single POST is jobs.create with a reach report type.
export function reachRequestAllowed(url, method = 'GET', body) {
  if (method === 'GET') return /^https:\/\/youtubereporting\.googleapis\.com\/v1\/(reportTypes|jobs)(\?|$)/.test(url) || /^https:\/\/youtubereporting\.googleapis\.com\/v1\/jobs\/[A-Za-z0-9_-]+\/reports(\?|$)/.test(url) || /^https:\/\/youtubereporting\.googleapis\.com\/v1\/media\/[A-Za-z0-9_\-/.%]+(\?|$)/.test(url);
  if (method === 'POST') return url === `${BASE}/jobs` && !!body && Object.values(REACH_TYPES).includes(body.reportTypeId);
  return false;
}
// Budget (requests), from documented behaviour. `reportsPerDay` = new reports per type per day (1 normally; backfill replaces earlier days under new ids).
export function reachBudget({ businesses = 2, types = 1, newReportsPerDay = 1 } = {}) {
  const once = businesses * (2 + types) + businesses * types * REACH_LIMITS.backfillReports;   // report_types + jobs_list per business, job_create per type, backfill downloads
  const daily = businesses * types * (1 + newReportsPerDay);   // reports_list + downloads
  return { one_time_requests: once, daily_requests: daily, notes: 'Reporting API quota is not documented on the pages reviewed; Data API default is 10,000 units/day and is not used by these calls.' };
}

// ── parsing ──
const SOURCE_CODES = Object.freeze({ 0: 'NO_LINK_OTHER', 1: 'ADVERTISING', 3: 'BROWSE', 4: 'YT_CHANNEL', 5: 'YT_SEARCH', 7: 'RELATED_VIDEO', 8: 'YT_OTHER_PAGE', 9: 'EXT_URL', 11: 'CAMPAIGN_CARD', 14: 'PLAYLIST', 17: 'NOTIFICATION', 18: 'PLAYLIST_PAGE', 20: 'END_SCREEN', 23: 'STORIES', 24: 'SHORTS', 25: 'PRODUCT_PAGE', 26: 'HASHTAGS', 27: 'SOUND_PAGE', 28: 'LIVE_REDIRECT', 29: 'PODCASTS', 30: 'VIDEO_REMIXES', 31: 'VERTICAL_LIVE', 32: 'RELATED_VIDEO' });
// NOTE: Reporting API code 7 ("Suggested videos") and 32 ("Related video") both map to the Analytics API's RELATED_VIDEO; the others use the closest documented name. Unknown codes stay TYPE_<n>.
export const sourceName = (code) => SOURCE_CODES[Number(code)] || (Number.isFinite(Number(code)) ? 'TYPE_' + Number(code) : null);
export function parseCsv(text) {   // minimal RFC-4180 reader (quotes, commas, CRLF); header-only files are valid (days with no data)
  const rows = []; let row = [], cell = '', q = false; const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c; }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); } return rows.filter((r) => r.some((x) => x !== ''));
}
const isoDate = (x) => { const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(x || '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const num = (x) => { if (x === '' || x === null || x === undefined || /^null$/i.test(String(x))) return null; const n = Number(x); return Number.isFinite(n) && n >= 0 ? n : null; };
// Returns { rows:[{date, video_id, impressions, ctr_raw, [source]}], dropped:{foreign_channel, bad_row}, ctr_scale:'fraction'|'percent'|'ambiguous'|'unknown', header_only }
export function parseReachCsv(text, { channelId, combined = false } = {}) {
  const want = String(channelId || ''); if (!want) throw new Error('channel id required');
  const all = parseCsv(text); const out = { rows: [], dropped: { foreign_channel: 0, bad_row: 0 }, ctr_scale: 'unknown', header_only: all.length <= 1 };
  if (!all.length) return out; const h = all[0].map((x) => x.trim()); const ix = (n) => h.indexOf(n);
  const iD = ix('date'), iC = ix('channel_id'), iV = ix('video_id'), iI = ix('video_thumbnail_impressions'), iR = ix('video_thumbnail_impressions_ctr'), iT = ix('traffic_source_type');
  if ([iD, iC, iV, iI, iR].some((i) => i < 0) || (combined && iT < 0)) { out.dropped.bad_row = all.length - 1; out.error = 'unexpected_columns'; return out; }
  for (const r of all.slice(1)) {
    if (r[iC] !== want) { out.dropped.foreign_channel++; continue; }   // ISOLATION: a row of another channel is never kept
    const date = isoDate(r[iD]), imp = num(r[iI]), ctr = num(r[iR]); if (!date || !/^[A-Za-z0-9_-]{6,20}$/.test(r[iV] || '') || imp === null || ctr === null) { out.dropped.bad_row++; continue; }
    const row = { date, video_id: r[iV], impressions: Math.round(imp), ctr_raw: ctr }; if (combined) row.source = sourceName(r[iT]); out.rows.push(row);
  }
  const vals = out.rows.filter((r) => r.impressions >= 50).map((r) => r.ctr_raw); out.ctr_scale = !vals.length ? 'unknown' : vals.every((v) => v <= 1) ? (vals.some((v) => v > 0.2) ? 'ambiguous' : 'fraction') : vals.every((v) => v > 1 || v === 0) || vals.some((v) => v > 1.5) ? 'percent' : 'ambiguous';
  return out;
}
// CTR → fraction. Refuses to guess when the scale is ambiguous/unknown (returns null).
export const ctrFraction = (raw, scale) => (scale === 'fraction' ? raw : scale === 'percent' ? raw / 100 : null);

// ── the per-business document (key growth_reach_<business>): compact rows, rolling window, size-bounded ──
export const emptyReachDoc = (business) => ({ v: 1, business, channel_id: PROBE_CHANNELS[business], updated_at: null, ctr_scale: null, days: {}, jobs: {}, last_report: null });
export function mergeReach(prev, parsed, { business, nowIso, keepDays = REACH_LIMITS.keepDays, report = null }) {
  const want = PROBE_CHANNELS[business]; if (!want) throw new Error('unknown business');
  const doc = prev && prev.business === business && prev.channel_id === want ? JSON.parse(JSON.stringify(prev)) : emptyReachDoc(business);
  if (parsed.error) return { doc, error: parsed.error };
  const scale = parsed.ctr_scale === 'fraction' || parsed.ctr_scale === 'percent' ? parsed.ctr_scale : doc.ctr_scale; if (scale) doc.ctr_scale = doc.ctr_scale && doc.ctr_scale !== scale ? 'conflict' : scale;
  const byDay = {}; for (const r of parsed.rows) { if (r.impressions <= 0) continue; (byDay[r.date] = byDay[r.date] || []).push([r.video_id, r.impressions, r.ctr_raw]); }
  for (const [d, rows] of Object.entries(byDay)) doc.days[d] = rows.sort((a, b) => b[1] - a[1]);   // a re-issued report for a day replaces that day (YouTube backfill replaces earlier data)
  const keys = Object.keys(doc.days).sort(); if (keys.length > keepDays) for (const k of keys.slice(0, keys.length - keepDays)) delete doc.days[k];
  while (JSON.stringify(doc).length > REACH_LIMITS.maxDocBytes) { const ks = Object.keys(doc.days).sort(); if (ks.length <= 14) break; delete doc.days[ks[0]]; }
  if (report) doc.last_report = { id: String(report.id || '').slice(0, 80), start: report.start || null, end: report.end || null, at: nowIso };
  doc.updated_at = nowIso; return { doc, error: null, dropped: parsed.dropped };
}
// Per-video totals over a window → { video_id: { impressions, clicks, ctr } } (CTR weighted by impressions). Null CTR when the scale is not settled.
export function reachByVideo(doc, from, to) {
  const scale = doc && doc.ctr_scale; const out = {};
  for (const [d, rows] of Object.entries((doc && doc.days) || {})) { if (d < from || d > to) continue; for (const [vid, imp, raw] of rows) { const f = ctrFraction(raw, scale); const o = out[vid] || (out[vid] = { impressions: 0, clicks: 0, known: true }); o.impressions += imp; if (f === null) o.known = false; else o.clicks += imp * f; } }
  for (const o of Object.values(out)) { o.ctr = o.known && o.impressions > 0 ? o.clicks / o.impressions : null; delete o.known; o.clicks = Math.round(o.clicks); }
  return out;
}
// Packaging comparison for the diagnosis: uploads of the last 28 days vs the 28 days before, each video's CTR over its first up-to-28 days of impressions in the window.
// Enough evidence only when both groups have ≥ 5 uploads with ≥ 1,000 impressions each and a settled CTR scale.
export function packagingComparison(doc, uploads, nowMs, { days = 28 } = {}) {
  const key = (ms) => new Date(ms).toISOString().slice(0, 10); const to = key(nowMs), mid = nowMs - days * DAY, start = nowMs - 2 * days * DAY; const per = reachByVideo(doc, key(start), to);
  const g = (a, b) => (uploads || []).filter((u) => u.published_at && Date.parse(u.published_at) >= a && Date.parse(u.published_at) < b).map((u) => ({ id: u.video_id, ...(per[u.video_id] || {}) })).filter((x) => x.impressions >= REACH_LIMITS.minImpressions && x.ctr !== null);
  const recent = g(mid, nowMs + DAY), earlier = g(start, mid); const med = (a) => { const s = a.map((x) => x.ctr).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const mr = med(recent), me = med(earlier); const enough = recent.length >= REACH_LIMITS.minGroup && earlier.length >= REACH_LIMITS.minGroup && doc && (doc.ctr_scale === 'fraction' || doc.ctr_scale === 'percent');
  return { enough, recent: { n: recent.length, median_ctr: mr }, earlier: { n: earlier.length, median_ctr: me }, change_pct: enough && me > 0 ? Math.round(((mr - me) / me) * 1000) / 10 : null, rule: `needs ${REACH_LIMITS.minGroup}+ uploads with ${REACH_LIMITS.minImpressions}+ impressions in each group and a settled CTR scale` };
}

// ── failure handling (the future executor maps every response to one of these; none of them writes zeros or deletes data) ──
export function classifyReachError(status, body) {
  const s = Number(status); const txt = JSON.stringify(body && body.error ? body.error : body || '').toLowerCase();
  if (s === 401) return { kind: 'auth', action: 'refresh the business token once; if it still fails stop and report (no retry loop)' };
  if (s === 403 && /scope|insufficient|permission/.test(txt)) return { kind: 'scope_insufficient', action: 'stop; do NOT add a scope. Report to the CEO: reach reports need either the read-only scope to be accepted or a separate decision; fall back to the Studio export' };
  if (s === 403 && /quota|rate|limit/.test(txt)) return { kind: 'quota', action: 'stop this run, record it, retry on the next scheduled day' };
  if (s === 429) return { kind: 'quota', action: 'stop this run, record it, retry on the next scheduled day' };
  if (s === 404) return { kind: 'not_available', action: 'report type or job not found: record and do not create anything else' };
  if (s === 400) return { kind: 'bad_request', action: 'record the response; never retried automatically' };
  if (s >= 500) return { kind: 'transient', action: 'retry once after 30 s, then stop and record' };
  return { kind: 'unknown', action: 'record and stop' };
}
