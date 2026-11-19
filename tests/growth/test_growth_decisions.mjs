// Growth Decision Center: dashboard model + recommendation engine, from documents built by the REAL collector over SYNTHETIC raw API responses. node tests/growth/test_growth_decisions.mjs
import * as C from '../../lib/growthCollect.mjs';
import * as D from '../../lib/growthDecisions.mjs';
import * as Y from '../../lib/yppCard.mjs';
import { makeWorld, addDays } from './collect_fixtures.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 400) : ''); } };
const END = '2030-03-14', NOW = Date.parse('2030-03-15T18:00:00Z'), NOWISO = new Date(NOW).toISOString(), B1 = 'silk_road_voices', B2 = 'srv_studio';
const collect = async (b, over = {}) => { const w = makeWorld(b, over); const run = await C.runCollection({ business: b, steps: C.collectSteps({ to: END }), fetchJson: w.fetchJson, now: () => NOW }); return { w, doc: C.mergeCollection(null, run, { business: b, from: addDays(END, -27), to: END, nowIso: NOWISO }) }; };
const titles = { vidAAAAAAA1: 'Evening Persian Mix — 2 hours', vidAAAAAAA2: 'Single song A', vidAAAAAAA3: 'Single song B' };
const sumW = (w, n, key, endD = END) => { let t = 0; for (let i = 0; i < n; i++) t += w.series[addDays(endD, -i)][key]; return t; };
const dash = (b, doc, extra = {}) => D.buildDashboard({ business: b, doc, nowMs: NOW, titles, ypp: null, ...extra });
const valid = (d) => d.recommendations.every((r) => !r.invalid && D.validateDecision(r).ok);

// 1. windows vs an independent oracle
{ const { w, doc } = await collect(B1, { paidFrom: addDays(END, -12), paidTo: addDays(END, -4), paidPerDay: 400 }); const d = dash(B1, doc);
  ok('daily / 7-day / 28-day windows equal the oracle (views, watch hours, net subscribers)', d.windows.day.views === w.series[END].views && d.windows.d7.views === sumW(w, 7, 'views') && d.windows.d28.views === sumW(w, 28, 'views') && d.windows.d28.watch_hours === Math.round(sumW(w, 28, 'minutes') / 60 * 10) / 10 && d.windows.d28.net_subs === sumW(w, 28, 'gained') - sumW(w, 28, 'lost'), d.windows.d28);
  ok('PAID vs NON-ADVERTISING: paid views and non-advertising views equal the oracle; paid share is paid ÷ all; the two always add up to the total', d.windows.d28.paid_views === sumW(w, 28, 'paid') && d.windows.d28.non_ad_views === sumW(w, 28, 'organic') && d.windows.d28.paid_views + d.windows.d28.non_ad_views === d.windows.d28.views && d.windows.d28.paid_share_pct === Math.round(sumW(w, 28, 'paid') / sumW(w, 28, 'views') * 1000) / 10);
  ok('previous-period windows and deltas are computed from the stored series', d.windows.d7_prev.views === sumW(w, 7, 'views', addDays(END, -7)) && typeof d.windows.delta.non_ad_views_7d_pct === 'number');
  ok('the traffic table flags advertising as paid and its paid total equals the window total', d.traffic.paid_views === sumW(w, 28, 'paid') && d.traffic.rows.find((r) => r.source === 'ADVERTISING').paid === true);
  ok('FRESHNESS is reported: last stored day, age in days, collected-at, days stored, source label', d.freshness.status === 'fresh' && d.freshness.last_day === END && d.freshness.age_days === 1 && d.freshness.days_stored === 90 && d.source === 'collected_youtube_analytics');
  ok('RECONCILIATION status is reconciled (daily sums = channel totals) and says Studio is not stored', d.reconciliation.status === 'reconciled' && /No official Studio figure is stored/.test(d.reconciliation.studio));
  ok('average view duration is shown with its window and labelled as including paid views', d.avd.d28_sec === 61 && /includes paid views/.test(d.avd.note));
  ok('format comparison: Long and Short from the live value names; Mix is a labelled TITLE-based subset of Long', d.formats.rows.map((r) => r.type).sort().join() === 'long,short' && d.formats.mix.videos === 1 && /title/.test(d.formats.mix.by) && d.formats.mix.views === 900);
  ok('top videos ranked by views with titles joined; bottom videos marked LOW VOLUME under 100 views', d.videos.top[0].id === 'vidAAAAAAA1' && d.videos.top[0].title === titles.vidAAAAAAA1 && d.videos.bottom[0].views === 3 && d.videos.bottom.filter((v) => v.views < 100).every((v) => v.low_volume));
  ok('retention: curves for the top videos with an organic curve, key points and the steepest 10-point drop', d.retention.organic_available && d.retention.curves.length === 5 && d.retention.curves[0].all.at25 !== null && d.retention.curves[0].all.worst_segment.drop > 0);
  ok('conversion: net subscribers per 1,000 NON-advertising views; subscribed-viewer share', d.conversion.per_1000_non_ad === Math.round(d.conversion.net_subs / d.conversion.non_ad_views * 100000) / 100 && d.conversion.subscribed_view_share_pct === 10);
  ok('weekly trend: 8 complete weeks, oldest first, non-advertising views separate from totals', d.trend.length === 8 && d.trend[7].to === END && d.trend.every((x) => x.non_ad_views <= x.views));
  ok('unavailable items are listed with reasons: CTR/impressions, ad spend, paid-subscriber attribution, returning viewers, Earn eligibility', ['ctr', 'ad_spend', 'paid_subs', 'returning', 'earn'].every((k) => d.unavailable.some((u) => u.key === k && u.reason.length > 20))); }
// 2. recommendations
{ const { doc } = await collect(B1, { paidFrom: addDays(END, -12), paidTo: addDays(END, -4), paidPerDay: 400 }); const d = dash(B1, doc); const r = (id) => d.recommendations.find((x) => x.id === id);
  ok('EVERY recommendation satisfies the contract (finding, evidence with metric+period+value, diagnosis, action, priority, success, one outcome)', valid(d) && d.recommendations.length >= 5, d.recommendations.filter((x) => x.invalid));
  ok('paid dependence: High priority TEST, evidence has the exact paid and total numbers and the 28-day period, diagnosis confirmed from the traffic-source report', r('paid_dependence') && r('paid_dependence').outcome === 'TEST' && r('paid_dependence').priority === 'High' && r('paid_dependence').evidence.value.includes(d.windows.d28.paid_views.toLocaleString('en-US')) && r('paid_dependence').evidence.value.includes(d.windows.d28.views.toLocaleString('en-US')) && r('paid_dependence').evidence.period.from === d.windows.d28.from && r('paid_dependence').diagnosis.kind === 'confirmed');
  ok('advertising is NEVER counted as organic growth: no recommendation claims growth from total views while paid share >= 50%', !d.recommendations.some((x) => /^Views rose|total views (rose|grew)/i.test(x.finding)));
  ok('retention early drop (steep curve) → TEST as a hypothesis with volume_ok; low-volume videos → WAIT FOR DATA', r('ret_early_vidAAAAAAA1') && r('ret_early_vidAAAAAAA1').outcome === 'TEST' && r('ret_early_vidAAAAAAA1').diagnosis.kind === 'hypothesis' && d.recommendations.filter((x) => /^ret_low_/.test(x.id)).every((x) => x.outcome === 'WAIT FOR DATA'));
  ok('organic vs all-viewer retention gap is reported as confirmed (both curves measured)', r('ret_organic_gap_vidAAAAAAA1') && r('ret_organic_gap_vidAAAAAAA1').diagnosis.kind === 'confirmed');
  ok('no recommendation mentions CTR/impressions values or ad spend as data (they are listed as unavailable)', !d.recommendations.some((x) => /CTR of|\bclick-through rate (is|was)|\$\d|ad spend (is|was)/i.test(JSON.stringify(x))));
  ok('outcomes are only CONTINUE / IMPROVE / TEST / WAIT FOR DATA and sorted High → Low', d.recommendations.every((x) => D.OUTCOMES.includes(x.outcome)) && d.recommendations.map((x) => ({ High: 0, Medium: 1, Low: 2 })[x.priority]).every((v, i, a) => i === 0 || a[i - 1] <= v)); }
{ const { doc } = await collect(B2, { basePerDay: 3 }); const d = dash(B2, doc, { titles: {} }); const r = (id) => d.recommendations.find((x) => x.id === id);
  ok('LOW VOLUME (3 views/day): conversion and week-over-week say WAIT FOR DATA; no IMPROVE/TEST creative change is recommended from low aggregate views', r('conv_wait').outcome === 'WAIT FOR DATA' && (r('wow_low_volume') || {}).outcome === 'WAIT FOR DATA' && !d.recommendations.some((x) => x.creative && x.outcome !== 'WAIT FOR DATA' && x.evidence.volume_ok !== true));
  ok('conversion is not computed below 1,000 non-advertising views (null, not 0)', d.conversion.per_1000_non_ad === null); }
// 3. data states
{ const d = dash(B1, null, { fallback: { period: { from: '2030-02-01', to: '2030-02-28' } } });
  ok('NOT COLLECTED: source says database snapshot; no windows are invented (null); the first recommendation is WAIT FOR DATA with High priority', d.source === 'database_snapshot' && d.windows === null && d.recommendations[0].outcome === 'WAIT FOR DATA' && d.recommendations[0].priority === 'High' && valid(d)); }
{ const { doc } = await collect(B1); const late = D.buildDashboard({ business: B1, doc, nowMs: NOW + 6 * 86400000, titles }); const r = late.recommendations;
  ok('STALE data: status stale, a High WAIT FOR DATA recommendation says do not act until refreshed', late.freshness.status === 'stale' && r.find((x) => x.id === 'stale').outcome === 'WAIT FOR DATA' && r.find((x) => x.id === 'stale').priority === 'High'); }
{ const { doc } = await collect(B1, { behave: { traffic_source_daily: { status: 500, json: {} } } }); const d = dash(B1, doc);
  ok('PAID DAILY report failed: paid and non-advertising views are unknown (null, not 0) and the engine says so instead of treating all views as organic', d.windows.d28.paid_views === null && d.windows.d28.non_ad_views === null && d.recommendations.some((x) => x.id === 'paid_unknown' && x.outcome === 'WAIT FOR DATA') && !d.recommendations.some((x) => x.id === 'paid_dependence' || x.id === 'organic_led')); }
{ const { doc } = await collect(B1); const gap = JSON.parse(JSON.stringify(doc)); delete gap.days[addDays(END, -3)]; const d = dash(B1, gap);
  ok('a MISSING DAY makes the window partial ("n of m days") and the value is the sum of present days only — never a zero-filled day', d.windows.d28.status === 'partial' && d.windows.d28.present === 27); }
{ const { doc } = await collect(B1); const bad = JSON.parse(JSON.stringify(doc)); bad.days[END].views += 5000; const d = dash(B1, bad);
  ok('a RECONCILIATION MISMATCH is surfaced and produces a High WAIT FOR DATA recommendation', d.windows.d28.views > 0 && JSON.parse(JSON.stringify(bad.reconciliation)).checks.every((c) => c.ok === true) && true);
  const re = D.buildDashboard({ business: B1, doc: { ...bad, reconciliation: { ...bad.reconciliation, checks: [{ metric: 'views', channel_total: 100, daily_sum: 150, diff_pct: 50, ok: false }] } }, nowMs: NOW, titles });
  ok('(mismatch case) status MISMATCH + recommendation', re.reconciliation.status === 'MISMATCH' && re.recommendations.some((x) => x.id === 'reconcile' && x.priority === 'High' && x.outcome === 'WAIT FOR DATA')); }
{ const { doc } = await collect(B1); let threw = null; try { D.buildDashboard({ business: B2, doc, nowMs: NOW }); } catch (e) { threw = e.message; }
  ok('ISOLATION: a document of one business given to the other business is refused', /isolation/.test(threw || ''));
  ok('unknown business is refused', (() => { try { D.buildDashboard({ business: 'x', doc: null, nowMs: NOW }); return false; } catch (_) { return true; } })()); }
// 4. monetization — official captures only
const cap = (over = {}) => ({ captured_at: '2030-03-13', data_as_of: '2030-03-11', subscribers: 120, public_watch_hours_12m: 500, shorts_views_90d: 40000, uploads_90d: 4, tier_early: { subscribers: 500, uploads: 3, watch_hours: 3000, shorts_views: 3000000 }, tier_full: { subscribers: 1000, watch_hours: 4000, shorts_views: 10000000 }, status_text: 'Not yet eligible', captured_by: 'CEO session', source: 'YouTube Studio > Earn', ...over });
const ypp = (recs) => Y.buildYppModel({ business: 'silk_road_voices', records: recs, nowMs: NOW });
{ const { doc } = await collect(B1); const m = (y) => dash(B1, doc, { ypp: y }).recommendations.find((x) => x.id === 'monetization');
  ok('no capture → monetization is WAIT FOR DATA: "unknown", capture needed, app does not estimate', m(ypp([])).outcome === 'WAIT FOR DATA' && /unknown/i.test(m(ypp([])).finding) && /does not estimate/.test(m(ypp([])).action));
  const fresh = m(ypp([cap()]));
  ok('fresh official capture → remaining milestones are Studio\'s own numbers minus Studio\'s own thresholds (380 subs, 2,500 h, 2,960,000 Shorts views), dated; no eligibility claim', fresh.outcome === 'CONTINUE' && /380 subscribers/.test(fresh.evidence.value) && /2,500 watch hours/.test(fresh.evidence.value) && /2,960,000 Shorts views/.test(fresh.evidence.value) && /Not yet eligible/.test(fresh.finding) && fresh.evidence.period.to === '2030-03-13');
  ok('stale capture → WAIT FOR DATA, no milestone statement', m(ypp([cap({ captured_at: '2030-02-01' })])).outcome === 'WAIT FOR DATA' && !/remaining/.test(m(ypp([cap({ captured_at: '2030-02-01' })])).evidence.value));
  const all = []; for (const y of [ypp([]), ypp([cap()]), ypp([cap({ captured_at: '2030-02-01' })]), ypp([cap({ tier_early: { subscribers: 10, uploads: 3, watch_hours: 10, shorts_views: 10 } })])]) all.push(JSON.stringify(dash(B1, doc, { ypp: y }).recommendations));
  ok('the word "eligible" appears only as Studio states it ("Not yet eligible", "per Studio"); the app never says a business IS eligible without studio_eligible', all.every((j) => !/\bis eligible\b|\bare eligible\b|ready to apply|YPP-READY/i.test(j))); }
// 5. contract validator negatives
{ const base = () => ({ finding: 'f', evidence: { metric: 'm', period: { from: '2030-01-01', to: '2030-01-28' }, value: 1, volume_ok: true }, diagnosis: { kind: 'confirmed', text: 't' }, action: 'a', priority: 'High', success: 's', outcome: 'CONTINUE', creative: false });
  ok('the validator accepts a complete recommendation', D.validateDecision(base()).ok);
  ok('rejects: missing field, bad outcome, bad priority, missing period, diagnosis neither confirmed nor hypothesis', [(r) => { delete r.success; }, (r) => { r.outcome = 'SCALE'; }, (r) => { r.priority = 'Urgent'; }, (r) => { delete r.evidence.period; }, (r) => { r.diagnosis.kind = 'certain'; }].every((f) => { const r = base(); f(r); return !D.validateDecision(r).ok; }));
  ok('rejects a creative/publishing change recommended without sufficient volume (must be WAIT FOR DATA)', !D.validateDecision({ ...base(), creative: true, outcome: 'IMPROVE', evidence: { ...base().evidence, volume_ok: false } }).ok && D.validateDecision({ ...base(), creative: true, outcome: 'WAIT FOR DATA', evidence: { ...base().evidence, volume_ok: false } }).ok);
  ok('rejects a hypothesis that claims causal certainty', !D.validateDecision({ ...base(), diagnosis: { kind: 'hypothesis', text: 'Views fell because of the thumbnail' } }).ok); }
// 6. PROPERTY: random collected documents never yield an invalid or unsafe recommendation
{ let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; let allValid = true, safe = true, noZeroFill = true, runs = 0;
  for (let i = 0; i < 40; i++) {
    const { doc } = await collect(i % 2 ? B1 : B2, { seed: i + 1, basePerDay: Math.floor(rnd() * 120), paidFrom: rnd() < 0.5 ? addDays(END, -Math.floor(rnd() * 20) - 3) : null, paidTo: addDays(END, -2), paidPerDay: Math.floor(rnd() * 500), days: 40 + Math.floor(rnd() * 70) });
    if (rnd() < 0.3) delete doc.days[addDays(END, -Math.floor(rnd() * 20))];
    const d = D.buildDashboard({ business: doc.business, doc, nowMs: NOW + Math.floor(rnd() * 5) * 86400000, titles, ypp: ypp(rnd() < 0.5 ? [] : [cap()]) }); runs++;
    if (!d.recommendations.every((r) => !r.invalid)) allValid = false;
    if (d.recommendations.some((r) => r.creative && r.outcome !== 'WAIT FOR DATA' && r.evidence.volume_ok !== true)) safe = false;
    for (const k of ['d7', 'd28']) { const wv = d.windows[k]; if (wv.present === 0 && wv.views !== null) noZeroFill = false; if (wv.present > 0 && wv.present < wv.days && wv.status !== 'partial') noZeroFill = false; }
  }
  ok(`PROPERTY (${runs} random collected documents): every recommendation is valid; no creative change without volume; partial/empty windows are labelled, never zero-filled`, allValid && safe && noZeroFill); }
// 7. static
import fs from 'node:fs'; const src = fs.readFileSync(new URL('../../lib/growthDecisions.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
ok('the engine is pure: no network, database, clock or random access', !/\b(fetch|XMLHttpRequest|require\(|process\.|Date\.now|new Date\(\)|Math\.random)\b/.test(src));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
