// 100% SYNTHETIC data for the analytics tests. No real video, channel statistic, title, subscriber or view number appears in this repository's tests.
// Deterministic (seeded) so every run is identical. Channel ids are the two public business identifiers already used by the application.
import * as G from '../../lib/growthAnalytics.mjs';
export const F = G.GROWTH_BUSINESSES.silk_road_voices, S = G.GROWTH_BUSINESSES.srv_studio;
export const PULL = '2030-03-20';                       // synthetic "latest Analytics pull" date
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const id = (p, i) => p + String(i).padStart(8, '0');    // obviously fake: F00000001, S00000001 …
// DB-shaped rows (snake_case) for one channel: `fresh` rows refreshed by the latest pull, `stale` rows by an older pull, `tests` [TEST] uploads, plus one dominant video and one tiny-view outlier.
export function synthChannelRows(channelId, prefix, { fresh, stale, tests, seed, dominant = true }) {
  const r = rng(seed); const out = []; let n = 0;
  const mk = (over) => ({ channel_id: channelId, video_id: id(prefix, ++n), title: 'Synthetic video ' + n, views: 0, view_count: 0, watch_time_min: 0, avg_view_duration_sec: 0, retention_pct: 0, subs_gained: 0, analytics_synced_at: PULL, synced_at: PULL, published_at: addDays(PULL, -Math.floor(r() * 90)), ...over });
  for (let i = 0; i < fresh; i++) { const views = Math.floor(r() * 400) + 5; out.push(mk({ views, view_count: views * 3 + Math.floor(r() * 50), watch_time_min: Math.round(views * (0.3 + r() * 1.2) * 10) / 10, retention_pct: Math.round((10 + r() * 70) * 10) / 10, subs_gained: r() < 0.2 ? Math.floor(r() * 3) : 0 })); }
  if (dominant) out.push(mk({ views: 9000, view_count: 9400, watch_time_min: 3500, retention_pct: 30.5, subs_gained: 2 }));                         // one heavily promoted video
  out.push(mk({ views: 9, view_count: 12, watch_time_min: 5, retention_pct: 2400, subs_gained: 0 }));                                             // tiny-view retention outlier (must not dominate)
  for (let i = 0; i < stale; i++) { const views = Math.floor(r() * 300) + 5; const old = addDays(PULL, -(8 + Math.floor(r() * 20))); out.push(mk({ views, view_count: views * 4, watch_time_min: views * 0.5, retention_pct: 20 + Math.round(r() * 40), subs_gained: 1, analytics_synced_at: old, synced_at: old })); }   // old window, not refreshed
  for (let i = 0; i < tests; i++) out.push(mk({ title: '[TEST] synthetic upload ' + i, views: 777, watch_time_min: 777, retention_pct: 99, subs_gained: 5 }));
  return out;
}
export const synthRowsF = () => synthChannelRows(F.channelId, 'F', { fresh: 40, stale: 12, tests: 3, seed: 11 });
export const synthRowsS = () => synthChannelRows(S.channelId, 'S', { fresh: 25, stale: 6, tests: 2, seed: 29, dominant: false });
// Daily channel counters: a steady climb, a one-week burst, and (kind 'drop') a counter DROP when older uploads are removed.
export function synthCounters(kind) {
  const out = []; let views = kind === 'drop' ? 3000 : 60000, subs = kind === 'drop' ? 10 : 140; const start = '2030-01-01';
  for (let i = 0; i < 80; i++) {
    const date = addDays(start, i);
    views += kind === 'drop' ? 12 : (i >= 50 && i < 56 ? 1500 : 70);
    if (kind === 'drop' && i === 40) views = 20;                    // removed uploads: the public counter falls
    if (i % 3 === 0) subs += 1;
    out.push({ channel: kind, date, totalViews: views, subscribers: subs });
  }
  return out;
}
