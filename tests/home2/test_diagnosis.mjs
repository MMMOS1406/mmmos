// Unit tests for lib/diagnosis.mjs (root-cause diagnostic model). Synthetic data only. Run: node tests/home2/test_diagnosis.mjs
import { buildDiagnosis, classifyVideos, DATA_PLAN, D_MIN } from '../../lib/diagnosis.mjs';
import { buildHomeCard } from '../../lib/homeInsights.mjs';
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const NOW = Date.parse('2026-11-22T12:00:00Z');
const win = (o) => ({ views: 1000, non_ad_views: 1000, paid_views: 0, paid_share_pct: 0, watch_hours: 10, net_subs: 5, from: '2026-10-21', to: '2026-11-17', status: 'complete', ...o });
const base = (o = {}) => ({ business: 'b', channel_id: 'UCx', collected: true, freshness: { last_day: '2026-11-17' },
  windows: { d28: win({ views: 5000, non_ad_views: 4000, paid_views: 1000, paid_share_pct: 20, net_subs: 15 }), d28_prev: win({ views: 6000, non_ad_views: 6000, net_subs: 10 }), d7: win({ non_ad_views: 300 }), d7_prev: win({ non_ad_views: 500 }) },
  traffic: { window: { from: '2026-10-22', to: '2026-11-18' }, rows: [{ source: 'ADVERTISING', views: 1000, paid: true }, { source: 'RELATED_VIDEO', views: 2000, paid: false }, { source: 'SHORTS', views: 1500, paid: false }, { source: 'YT_SEARCH', views: 500, paid: false }] },
  formats: { window: { from: '2026-10-22', to: '2026-11-18' }, rows: [{ type: 'long', views: 4300, watch_hours: 50, avg_view_duration_sec: 70, views_share_pct: 86 }, { type: 'short', views: 700, watch_hours: 2, avg_view_duration_sec: 20, views_share_pct: 14 }] },
  conversion: { per_1000_non_ad: 5, prev_per_1000_non_ad: 5.1, subscribed_view_share_pct: 3 }, avd: { d28_sec: 65, prev28_sec: 79 }, trend: [], videos: { top: [], total_views: 5000 },
  retention: { curves: [] }, recommendations: [], ...o });
const vr = (id, views, avd, pct) => ({ id, views, avd, pct });
const VR = [vr('L1', 2500, 70, 30), vr('L2', 1800, 66, 28), vr('S1', 400, 20, 62), vr('S2', 300, 21, 64)];   // L runtime ≈ 233 s, S ≈ 32 s
const curve = (id, at25, org) => ({ video_id: id, title: id + ' title', views: 500, all: { at25 }, organic: { at25: org ?? at25 } });
const cat = (id, days, views = 10) => ({ video_id: id, title: id, published_at: new Date(NOW - days * 864e5).toISOString(), view_count: views, like_count: Math.round(views / 50), comment_count: 0, ctr: null, impressions: null });
const mkStatus = (o = {}) => ({ code: 'declining', comparable: true, delta_pct: -33.3, momentum: { label: 'slowing', text: 'Last 7 days 300 organic views vs 500 the week before (−40%)' }, ...o });

// 1 classification
const cl = classifyVideos(VR, base().formats);
check('classification: estimated runtime splits Long (≥180 s) from Short (≤61 s)', cl.rows.find((r) => r.id === 'L1').type === 'long' && cl.rows.find((r) => r.id === 'S1').type === 'short');
check('classification validated against YouTube content-type totals (4,300 Long / 700 Short vs estimate 4,300 / 700)', cl.validated === true, cl.note);
const bad = classifyVideos(VR, { rows: [{ type: 'long', views: 100, views_share_pct: 1 }, { type: 'short', views: 4900 }] });
check('classification declared unreliable when it disagrees with the totals', bad.validated === false && /do NOT agree/.test(bad.note));
check('classification not validated when totals are missing', classifyVideos(VR, null).validated === null);

// 2 diagnosis, general business
const dash = base({ retention: { curves: [curve('L1', 0.3, 0.33), curve('L2', 0.4), curve('S1', 0.9)] } });
const cat1 = [cat('L1', 30), cat('L2', 10, 800), cat('S1', 5), cat('S2', 20), cat('X1', 40), cat('X2', 50), cat('X3', 3)];
const D = buildDiagnosis({ business: 'silk_road_voices', dash, status: mkStatus(), videoRows: VR, catalog: cat1, nowMs: NOW, longOnly: false });
const K = (k) => D.categories.find((c) => c.key === k);
check('five-way structure: four causes, each with status, confidence, missing evidence', D.categories.length === 4 && D.categories.every((c) => ['problem_observed', 'no_problem_observed', 'insufficient_evidence'].includes(c.status) && c.confidence && Array.isArray(c.missing) && Array.isArray(c.confirmed)));
check('distribution: problem observed (organic −33.3%), source mix and upload counts quoted, labelled hypothesis, missing evidence named', K('distribution').status === 'problem_observed' && K('distribution').confirmed.some((x) => /fell 33.3%/.test(x)) && K('distribution').confirmed.some((x) => /related video/.test(x)) && /Not tested/.test(K('distribution').hypothesis) && K('distribution').missing.some((x) => /previous 28 days/.test(x)));
check('retention: Long videos only are judged (S1 Short loop excluded); 2 of 2 Long under 0.5 → problem observed', K('retention').status === 'problem_observed' && K('retention').stats.long_n === 2 && K('retention').stats.long_low === 2);
check('retention: organic-only vs all-viewer values are both shown (paid is not blamed without evidence)', K('retention').confirmed.some((x) => /Organic-only viewers/.test(x)));
check('packaging: insufficient evidence (no impressions/CTR stored) and says exactly what is missing', K('packaging').status === 'insufficient_evidence' && K('packaging').missing.join(' ').includes('click-through rate') && K('packaging').confirmed[0].includes('No impressions or click-through rate'));
check('audience: conversion steady → no problem observed, and says the API cannot measure repeat viewing', K('audience').status === 'no_problem_observed' && K('audience').confirmed.some((x) => /Repeat viewing/.test(x)));
check('root cause is NOT claimed: label ROOT CAUSE NOT YET ESTABLISHED because evidence is missing', D.established === false && D.root_cause_label === 'ROOT CAUSE NOT YET ESTABLISHED' && D.cause_or_missing.length > 0);
check('every experiment has owner, review date, success measure and the authorization it needs', D.categories.filter((c) => c.experiment).every((c) => c.experiment.owner && /^\d{4}-\d\d-\d\d$/.test(c.experiment.review_by) && c.experiment.success && c.experiment.needs));
check('next test is single, prioritised, and starts with a diagnostic (no creative change first)', D.next_test && D.next_test.category === 'distribution' && /no creative change/i.test(D.next_test.text));
check('creative experiments require CEO approval and keep music/artist/mood fixed', /CEO approval/.test(K('retention').experiment.text) && /music, artist and mood/.test(K('retention').experiment.text + K('packaging').experiment.text));
check('policy text for Silk Road Voices preserves Creative V2 and artist/mood policies', /Creative V2/.test(D.policy) && /artist\/mood/.test(D.policy));
check('likes/comments are reported as collected lifetime counts', D.engagement && D.engagement.likes_per_1000 > 0 && /lifetime/.test(D.engagement.basis));
check('data plan separates "no authorization" items from collector changes that need CEO authorization', DATA_PLAN.some((p) => /No authorization/.test(p.auth)) && DATA_PLAN.filter((p) => /collector change|creates a job/.test(p.auth)).length >= 4 && DATA_PLAN.some((p) => p.id === 'C3' && /channel_reach_basic_a1/.test(p.now)));
// unvalidated classification falls back to all curves, stated
const Du = buildDiagnosis({ business: 'x', dash, status: mkStatus(), videoRows: [], catalog: cat1, nowMs: NOW, longOnly: false });
check('no per-video data → retention reads all measured videos and says the format could not be validated', Du.categories.find((c) => c.key === 'retention').confirmed.some((x) => /could not be validated/.test(x)));

// 3 Long-only business
const studio = base({ business: 'srv_studio', windows: { d28: win({ views: 4200, non_ad_views: 4200, net_subs: 7 }), d28_prev: win({ views: 64, non_ad_views: 64, net_subs: 0 }), d7: win({ non_ad_views: 70 }), d7_prev: win({ non_ad_views: 65 }) },
  traffic: { window: { from: '2026-10-22', to: '2026-11-18' }, rows: [{ source: 'SHORTS', views: 3900, paid: false }, { source: 'RELATED_VIDEO', views: 100, paid: false }] },
  formats: { window: { from: '2026-10-22', to: '2026-11-18' }, rows: [{ type: 'long', views: 220, avg_view_duration_sec: 90 }, { type: 'short', views: 3980, avg_view_duration_sec: 18 }] },
  retention: { curves: [curve('S1', 0.8), curve('S2', 0.9), curve('S3', 0.6)] }, conversion: { per_1000_non_ad: 1.6, prev_per_1000_non_ad: null } });
const SV = [vr('S1', 1200, 17, 57), vr('S2', 1000, 18, 60), vr('S3', 900, 15, 50), vr('S4', 880, 16, 55), vr('L1', 60, 90, 39), vr('L2', 50, 95, 40), vr('L3', 40, 85, 37), vr('L4', 70, 92, 38)];
const sCat = [cat('S1', 25), cat('S2', 24), cat('S3', 23), cat('S4', 22), cat('L1', 20), cat('L2', 18), cat('L3', 12), cat('L4', 5)];
const SD = buildDiagnosis({ business: 'srv_studio', dash: studio, status: mkStatus({ code: 'reset', comparable: false, delta_pct: null, momentum: null }), videoRows: SV, catalog: sCat, nowMs: NOW, longOnly: true });
const SK = (k) => SD.categories.find((c) => c.key === k);
check('Long-only: Long and Short are analysed separately — Long exposure vs historical Shorts is the lead evidence', /Long videos drew 220 views from 4 videos/.test(SK('distribution').confirmed[0]) && /historical/.test(SK('distribution').confirmed[0]));
check('Long-only: the Shorts feed share is stated as a surface Long uploads do not use', SK('distribution').confirmed.some((x) => /Shorts feed/.test(x)));
check('Long-only: retention is insufficient evidence (no Long video has 100+ views) and the Short curves are called historical', SK('retention').status === 'insufficient_evidence' && SK('retention').confirmed.some((x) => /historical Shorts/.test(x)));
check('Long-only: audience is insufficient evidence (7 net subscribers) and says Shorts-feed and Long viewers are not split', SK('audience').status === 'insufficient_evidence' && SK('audience').confirmed.some((x) => /not split by format/.test(x)));
const allText = JSON.stringify(SD.categories.map((c) => [c.experiment, c.hypothesis])) + JSON.stringify(SD.next_test);
check('Long-only: no experiment or hypothesis recommends producing, posting or resuming Shorts', !/\b(produc|post|resum|upload|publish|make|film)\w*\b[^."]*\bShorts?\b/i.test(allText.replace(/historical Shorts|earlier Shorts/gi, '')), allText.slice(0, 120));
check('Long-only: policy statement present and forbids resuming Shorts', /Long only/.test(SD.policy) && /resuming Shorts/.test(SD.policy));
check('Long-only: what-is-wrong names the specific finding, not generic advice', /Long videos are getting little exposure/.test(SD.what_is_wrong) && /about \d+ views each/.test(SD.what_is_wrong), SD.what_is_wrong);
// 4 isolation + purity
const A = buildHomeCard({ business: 'silk_road_voices', name: 'A', dash: base({ channel_id: 'UC_A', retention: { curves: [curve('AAA', 0.3)] } }), rows: [], videoRows: [vr('AAA', 100, 60, 28)], catalog: [{ ...cat('AAA', 5), title: 'ALPHA ONLY' }], counters: { subscribers: 1, history: [] }, nowMs: NOW });
const B = buildHomeCard({ business: 'srv_studio', name: 'B', dash: studio, rows: [], videoRows: SV, catalog: sCat, counters: { subscribers: 1, history: [] }, nowMs: NOW });
check('isolation: the diagnosis for one business never carries the other business\'s videos or policy', !JSON.stringify(B.diagnosis).includes('ALPHA') && !JSON.stringify(A.diagnosis).includes('Long only') && B.diagnosis.policy !== A.diagnosis.policy);
check('purity: same input → same output', JSON.stringify(buildDiagnosis({ business: 'silk_road_voices', dash, status: mkStatus(), videoRows: VR, catalog: cat1, nowMs: NOW, longOnly: false })) === JSON.stringify(D));
check('missing data → unavailable, no invented diagnosis', buildDiagnosis({ business: 'x', dash: null, nowMs: NOW }).state === 'unavailable');
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`); process.exit(R.every(Boolean) ? 0 : 1);
