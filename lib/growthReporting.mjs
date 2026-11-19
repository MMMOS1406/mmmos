// Growth-intelligence foundation (R-B phase 3): the NORMALIZED reporting structure for both channels and the recommendation contract.
// PURE library — no network, database or clock. NOT wired into any page or endpoint; it defines what a future server-side warehouse sync stores and what a recommendation must contain.
// Rules enforced in code (tested):
//  - every row carries business, channel_id, period, source query and `provenance_real`; rows from mock/unverified origin are always provenance_real=false;
//  - a business never receives another business's data (channel id must match);
//  - a recommendation states what the data shows, why it MAY be happening, whether the conclusion is PROVEN or HYPOTHETICAL, what to change, how it is measured and who owns it;
//  - "proven" needs real-provenance evidence; a causal claim about lyrics/visuals/music needs a completed controlled experiment; otherwise it must be a hypothesis with an experiment design.
import { PROBE_CHANNELS } from './growthProbe.mjs';

export const GROWTH_PRIORITIES = Object.freeze(['organic_growth', 'subscriber_conversion', 'listening_retention', 'thumbnail_performance', 'format_comparison']);
export const GROWTH_OWNERS = Object.freeze(['CEO', 'PM', 'VA', 'Engineering']);

// One table per grain. `source` = the probe query that fills it; `period` says what a row covers. All tables are keyed by (channel_id, …) and never mix businesses.
export const NORMALIZED_TABLES = Object.freeze({
  channel_day:            { key: ['channel_id', 'date'], source: 'daily_series', period: 'one Pacific-time day', columns: ['views', 'watch_minutes', 'subscribers_gained', 'subscribers_lost'] },
  channel_period:         { key: ['channel_id', 'period_from', 'period_to'], source: 'channel_totals', period: 'explicit range', columns: ['views', 'engaged_views', 'watch_minutes', 'avg_view_duration_sec', 'avg_view_pct', 'subscribers_gained', 'subscribers_lost'] },
  traffic_source_period:  { key: ['channel_id', 'period_from', 'period_to', 'source_type'], source: 'traffic_source', period: 'explicit range', columns: ['views', 'engaged_views', 'watch_minutes', 'is_paid'] },
  traffic_source_day:     { key: ['channel_id', 'date', 'source_type'], source: 'traffic_source_daily', period: 'one day', columns: ['views', 'watch_minutes', 'is_paid'] },
  video_period:           { key: ['channel_id', 'video_id', 'period_from', 'period_to'], source: 'per_video', period: 'explicit range', columns: ['views', 'engaged_views', 'watch_minutes', 'avg_view_duration_sec', 'avg_view_pct', 'subscribers_gained', 'subscribers_lost'], note: 'subscribers are watch-page attributed (lower than channel level)' },
  retention_curve:        { key: ['channel_id', 'video_id', 'period_from', 'period_to', 'ratio'], source: 'retention_curve', period: 'explicit range', columns: ['audience_watch_ratio', 'relative_retention'], note: '100 points per video' },
  format_period:          { key: ['channel_id', 'period_from', 'period_to', 'content_type'], source: 'content_type', period: 'explicit range', columns: ['views', 'watch_minutes', 'avg_view_duration_sec'] },
  subscribed_status_period: { key: ['channel_id', 'period_from', 'period_to', 'subscribed_status'], source: 'subscribed_status', period: 'explicit range', columns: ['views', 'watch_minutes', 'avg_view_duration_sec', 'avg_view_pct'] },
  reach_day:              { key: ['channel_id', 'date', 'video_id'], source: 'Reporting API channel_reach_basic_a1 (report file, after a job exists)', period: 'one day', columns: ['thumbnail_impressions', 'thumbnail_ctr'], note: 'reports are kept 60 days by Google — must be stored by us' },
  earn_estimate:          { key: ['channel_id', 'measure', 'period_to'], source: 'earn_longform_365d_by_source / earn_shorts_90d_by_source', period: '12 months / 90 days', columns: ['estimate', 'excluded_paid', 'excluded_shorts_feed'], note: 'labeled APPROXIMATION; Studio → Earn is the authority' },
});

const CONTENT_TYPE = { VIDEO_ON_DEMAND: 'long', SHORTS: 'short', LIVE_STREAM: 'live', STORY: 'story', UNSPECIFIED: 'unspecified' };
const num = (x) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
const idx = (cols, n) => cols.findIndex((c) => c.name === n);

// Convert ONE raw Google reports.query response into normalized rows (server-side use). ctx = { business, channelId, from, to, retrievedAt, provenance:{real}, videoId? }.
export function normalizeResponse(queryId, json, ctx) {
  const want = PROBE_CHANNELS[ctx && ctx.business];
  if (!want) throw new Error('unknown business');
  if (ctx.channelId !== want) throw new Error(`channel isolation violation: ${ctx.channelId} is not the channel of ${ctx.business}`);
  const cols = (json && json.columnHeaders) || []; const rows = (json && json.rows) || [];
  const base = { business: ctx.business, channel_id: want, source_query: queryId, retrieved_at: ctx.retrievedAt || null, provenance_real: !!(ctx.provenance && ctx.provenance.real === true) };
  const g = (r, n) => { const i = idx(cols, n); return i < 0 ? null : r[i]; };
  const per = { period_from: ctx.from, period_to: ctx.to };
  const m = (r) => ({ views: num(g(r, 'views')), engaged_views: num(g(r, 'engagedViews')), watch_minutes: num(g(r, 'estimatedMinutesWatched')), avg_view_duration_sec: num(g(r, 'averageViewDuration')), avg_view_pct: num(g(r, 'averageViewPercentage')), subscribers_gained: num(g(r, 'subscribersGained')), subscribers_lost: num(g(r, 'subscribersLost')) });
  const isPaid = (t) => t === 'ADVERTISING';
  switch (queryId) {
    case 'channel_totals': return rows.map((r) => ({ table: 'channel_period', ...base, ...per, ...m(r) }));
    case 'daily_series': return rows.map((r) => ({ table: 'channel_day', ...base, date: g(r, 'day'), views: num(g(r, 'views')), watch_minutes: num(g(r, 'estimatedMinutesWatched')), subscribers_gained: num(g(r, 'subscribersGained')), subscribers_lost: num(g(r, 'subscribersLost')) }));
    case 'per_video': return rows.map((r) => ({ table: 'video_period', ...base, ...per, video_id: g(r, 'video'), ...m(r) }));
    case 'traffic_source': return rows.map((r) => ({ table: 'traffic_source_period', ...base, ...per, source_type: g(r, 'insightTrafficSourceType'), views: num(g(r, 'views')), engaged_views: num(g(r, 'engagedViews')), watch_minutes: num(g(r, 'estimatedMinutesWatched')), is_paid: isPaid(g(r, 'insightTrafficSourceType')) }));
    case 'traffic_source_daily': return rows.map((r) => ({ table: 'traffic_source_day', ...base, date: g(r, 'day'), source_type: g(r, 'insightTrafficSourceType'), views: num(g(r, 'views')), watch_minutes: num(g(r, 'estimatedMinutesWatched')), is_paid: isPaid(g(r, 'insightTrafficSourceType')) }));
    case 'content_type': return rows.map((r) => ({ table: 'format_period', ...base, ...per, content_type: CONTENT_TYPE[g(r, 'creatorContentType')] || 'unspecified', views: num(g(r, 'views')), watch_minutes: num(g(r, 'estimatedMinutesWatched')), avg_view_duration_sec: num(g(r, 'averageViewDuration')) }));
    case 'subscribed_status': return rows.map((r) => ({ table: 'subscribed_status_period', ...base, ...per, subscribed_status: g(r, 'subscribedStatus'), views: num(g(r, 'views')), watch_minutes: num(g(r, 'estimatedMinutesWatched')), avg_view_duration_sec: num(g(r, 'averageViewDuration')), avg_view_pct: num(g(r, 'averageViewPercentage')) }));
    case 'retention_curve': return rows.map((r) => ({ table: 'retention_curve', ...base, ...per, video_id: ctx.videoId || null, ratio: num(g(r, 'elapsedVideoTimeRatio')), audience_watch_ratio: num(g(r, 'audienceWatchRatio')), relative_retention: num(g(r, 'relativeRetentionPerformance')) }));
    case 'earn_longform_365d_by_source': case 'earn_shorts_90d_by_source': {
      const long = queryId.startsWith('earn_longform'); const type = long ? 'VIDEO_ON_DEMAND' : 'SHORTS'; let total = 0, paid = 0, feed = 0;
      for (const r of rows) { if (g(r, 'creatorContentType') !== type) continue; const v = num(g(r, long ? 'estimatedMinutesWatched' : 'views')) || 0; const t = g(r, 'insightTrafficSourceType'); if (isPaid(t)) paid += v; else if (long && t === 'SHORTS') feed += v; else total += v; }
      return [{ table: 'earn_estimate', ...base, measure: long ? 'public_watch_hours_12m_estimate' : 'shorts_views_90d_estimate', period_to: ctx.to, estimate: long ? Math.round((total / 60) * 10) / 10 : total, excluded_paid: long ? Math.round((paid / 60) * 10) / 10 : paid, excluded_shorts_feed: long ? Math.round((feed / 60) * 10) / 10 : 0, approximation: true }];
    }
    default: throw new Error('no normalizer for query ' + queryId);
  }
}

// The recommendation contract. Returns { ok, errors[], warnings[] }; never throws.
const CAUSAL = /\b(because|caused by|causes|due to|leads to|drives|resulted in|is why|thanks to)\b/i;
const ASPECTS = /\b(lyric|lyrics|visual|visuals|cover art|thumbnail art|music|melody|voice)\b/i;
export function validateRecommendation(rec) {
  const errors = [], warnings = []; const need = (c, m) => { if (!c) errors.push(m); };
  if (!rec || typeof rec !== 'object') return { ok: false, errors: ['not_an_object'], warnings };
  need(PROBE_CHANNELS[rec.business], 'business must be silk_road_voices or srv_studio');
  need(GROWTH_PRIORITIES.includes(rec.priority), 'priority must be one of ' + GROWTH_PRIORITIES.join(', '));
  need(typeof rec.dataShows === 'string' && rec.dataShows.trim().length >= 20, '1. dataShows: what the data shows (specific, with figures)');
  need(Array.isArray(rec.evidence) && rec.evidence.length >= 1, 'evidence: at least one normalized-data reference');
  need(typeof rec.whyMayBeHappening === 'string' && rec.whyMayBeHappening.trim().length >= 10, '2. whyMayBeHappening: the possible explanation');
  need(rec.evidenceStatus === 'proven' || rec.evidenceStatus === 'hypothetical', '3. evidenceStatus must be "proven" or "hypothetical"');
  need(typeof rec.proposedChange === 'string' && rec.proposedChange.trim().length >= 10, '4. proposedChange: what should change');
  const mp = rec.measurementPlan; need(mp && mp.metric && mp.baseline !== undefined && mp.target !== undefined && mp.period && mp.method, '5. measurementPlan needs metric, baseline, target, period and method');
  need(GROWTH_OWNERS.includes(rec.owner), '6. owner must be one of ' + GROWTH_OWNERS.join(', '));
  need(['low', 'medium', 'high'].includes(rec.confidence), 'confidence must be low, medium or high');
  need(typeof rec.expectedBenefit === 'string' && rec.expectedBenefit.trim().length >= 5, 'expectedBenefit');
  const ev = Array.isArray(rec.evidence) ? rec.evidence : [];
  for (const e of ev) { if (!e || e.business !== rec.business) errors.push('evidence from another business or without a business is refused (isolation)'); if (!e || !e.sourceQuery) errors.push('every evidence item needs its sourceQuery'); }
  if (rec.evidenceStatus === 'proven') {
    need(ev.length > 0 && ev.every((e) => e && e.provenanceReal === true), 'a PROVEN conclusion needs evidence that came from real YouTube data (provenanceReal=true); mock or unverified data can only support a hypothesis');
    if (rec.causal === true) need(rec.experiment && rec.experiment.completed === true && rec.experiment.result, 'a causal claim needs a completed controlled experiment with a result');
  }
  if (rec.evidenceStatus === 'hypothetical') {
    need(rec.experiment && rec.experiment.design && rec.experiment.stopRule, 'a HYPOTHETICAL conclusion needs an experiment design and a stop rule');
    if (CAUSAL.test(String(rec.dataShows || ''))) warnings.push('dataShows uses causal wording; state the observation only and put the explanation in whyMayBeHappening');
  }
  if (ASPECTS.test(String(rec.whyMayBeHappening || '') + ' ' + String(rec.proposedChange || '')) && !(rec.experiment && (rec.experiment.design || rec.experiment.completed))) errors.push('a claim about lyrics, visuals or music needs a controlled-experiment design (no causal claim without evidence)');
  return { ok: errors.length === 0, errors, warnings };
}
