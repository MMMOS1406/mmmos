// Unit tests for lib/homeInsights.mjs (CEO homepage business card). Synthetic data only. Run: node tests/home2/test_home_insights.mjs
import { buildHomeCard, findReset, pickRecommendations, MIN } from '../../lib/homeInsights.mjs';
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const NOW = Date.parse('2026-11-22T12:00:00Z');
const win = (o) => ({ views: 1000, non_ad_views: 1000, paid_views: 0, paid_share_pct: 0, watch_hours: 10, net_subs: 5, from: '2026-10-21', to: '2026-11-17', status: 'complete', ...o });
const mk = (o = {}) => ({ business: 'b', channel_id: 'UCx', collected: true, freshness: { last_day: '2026-11-21', collected_at: '2026-11-22T00:00:00Z' },
  windows: { d28: win({ non_ad_views: 2000, views: 2000 }), d28_prev: win({ non_ad_views: 1000, views: 1000 }), d7: win({ non_ad_views: 400, views: 400 }), d7_prev: win({ non_ad_views: 300, views: 300 }) },
  conversion: { per_1000_non_ad: 3, prev_per_1000_non_ad: 2 }, avd: {}, trend: [], formats: { rows: [] }, videos: { top: [], total_views: 2000 }, retention: { curves: [] }, recommendations: [], ...o });
const card = (dash, extra = {}) => buildHomeCard({ business: 'b', name: 'B', dash, rows: [], counters: { subscribers: 50, history: [] }, pipeline: null, nowMs: NOW, ...extra });

let c = card(mk());
check('growing: organic +100% over a comparable previous window', c.status.code === 'growing' && c.kpis.organic.delta_pct === 100, c.status.label);
c = card(mk({ windows: { ...mk().windows, d28: win({ non_ad_views: 700, views: 700 }), d28_prev: win({ non_ad_views: 1000, views: 1000 }) } }));
check('declining: −30%', c.status.code === 'declining' && c.kpis.organic.delta_pct === -30);
c = card(mk({ windows: { ...mk().windows, d28: win({ non_ad_views: 1050, views: 1050 }), d28_prev: win({ non_ad_views: 1000, views: 1000 }) } }));
check('flat within ±15%', c.status.code === 'flat');
c = card(mk({ windows: { ...mk().windows, d28: win({ non_ad_views: 300, views: 300 }), d28_prev: win({ non_ad_views: 100, views: 100 }) } }));
check(`small volume (<${MIN.organicWindow}) → no trend called`, c.status.code === 'unknown' && /too small/i.test(c.status.label + c.status.reason));
c = card(mk({ windows: { ...mk().windows, d28: win({ views: 5000, non_ad_views: null, paid_views: null }) } }));
check('paid series unknown → organic is null, split not verifiable, total never called organic', c.kpis.organic.value === null && c.split.verifiable === false && c.kpis.total.value === 5000 && c.status.code === 'unknown');
c = card(mk({ windows: { ...mk().windows, d28: win({ views: 10000, non_ad_views: 2000, paid_views: 8000, paid_share_pct: 80 }) } }));
check('paid + organic split states both numbers; organic excludes paid', c.split.verifiable && c.split.organic === 2000 && c.split.paid === 8000 && c.kpis.organic.value === 2000 && c.kpis.total.value === 10000);
const hist = [{ d: '2026-10-14', videos: 41, subs: 10, views: 100 }, { d: '2026-10-16', videos: 6, subs: 10, views: 110 }, { d: '2026-11-22', videos: 14, subs: 18, views: 400 }];
check('findReset detects a catalog reset (41 → 6)', findReset(hist, NOW) && findReset(hist, NOW).date === '2026-10-16');
c = card(mk(), { counters: { subscribers: 18, history: hist } });
check('catalog reset → NEW CATALOG, no delta percentage, not comparable', c.status.code === 'reset' && c.kpis.organic.delta_pct === null && c.kpis.organic.comparable === false && c.kpis.total.delta_pct === null);
check('revenue and expenses are explicit unavailable states with the work needed', c.money.length === 2 && c.money.every((m) => m.state === 'unavailable' && m.reason && m.needed));
check('no revenue/expense number anywhere in the card', !/\$\s?\d/.test(JSON.stringify(c.money)));
check('limitations name the collector work', c.limitations.length >= 3 && c.limitations.every((l) => l.work));
c = card(mk(), { collection: { scheduled: true } }); check('scheduled collection on → the "daily" limitation is dropped', !c.limitations.some((l) => l.key === 'daily'));
c = card(mk({ freshness: { last_day: '2026-11-17' } }), { collection: { scheduled: false } });
check('stale data (5 days) → banner with data-through date', c.freshness.stale && /Nov 17/.test(c.stale_banner) && c.freshness.age_days === 5, c.stale_banner);
c = card(mk(), { counters: { subscribers: 1, history: [{ d: '2026-11-17', subs: 1, views: 10, videos: 5 }, { d: '2026-11-22', subs: 3, views: 60, videos: 5 }] } });
check('since data-through counter movement is computed from snapshots', c.freshness.since_through && c.freshness.since_through.views === 50 && c.freshness.since_through.subs === 2);
c = card(mk({ recommendations: ['a', 'b', 'c', 'd', 'e'].map((x, i) => ({ id: 'x' + x, finding: x, priority: ['High', 'Medium', 'Low', 'High', 'Medium'][i], outcome: 'TEST', evidence: { metric: 'm', value: 'v', volume_ok: true }, diagnosis: { kind: 'hypothesis', text: 't' }, action: 'act', success: 's' })) }));
check('at most three recommendations, High first, each advisory with owner / review date / success measure', c.recommendations.length === 3 && c.recommendations[0].priority === 'High' && c.recommendations.every((r) => r.advisory && r.owner && r.review_by && r.success && r.action));
check('no recommendation when there is no evidence → empty list, no filler', card(mk()).recommendations.length === 0);
check('unavailable when no dash', buildHomeCard({ business: 'b', name: 'B', dash: null, nowMs: NOW }).state === 'unavailable');
check('unavailable on error dash', buildHomeCard({ business: 'b', name: 'B', dash: { error: 'report_failed' }, nowMs: NOW }).state === 'unavailable');
// isolation: two businesses built from different inputs never share content
const A = card(mk({ channel_id: 'UC_A', videos: { top: [{ id: 'va', title: 'ALPHA only', views: 500 }], total_views: 2000 } })), B = card(mk({ channel_id: 'UC_B', videos: { top: [{ id: 'vb', title: 'BETA only', views: 500 }], total_views: 2000 } }));
check('business isolation: each card carries only its own channel and content', A.isolation.channel_id === 'UC_A' && B.isolation.channel_id === 'UC_B' && !JSON.stringify(A).includes('BETA') && !JSON.stringify(B).includes('ALPHA'));
check('pure: same input → same output', JSON.stringify(card(mk())) === JSON.stringify(card(mk())));
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`); process.exit(R.every(Boolean) ? 0 : 1);
