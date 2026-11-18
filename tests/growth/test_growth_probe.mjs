// R-B probe: planner, capability registry, classification, latency/quota accounting, business isolation, token handling and static guards on the server action.
// ALL responses below are SYNTHETIC MOCKS. Nothing here is, or is presented as, real YouTube data; a report is "real" only when the server action asserts provenance.real.
import fs from 'node:fs';
import * as P from '../../lib/growthProbe.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 300) : ''); } };
const steps = P.probeSteps({ from: '2030-01-01', to: '2030-01-28' });
const A = P.PROBE_CHANNELS.silk_road_voices, B = P.PROBE_CHANNELS.srv_studio;
const metricsOf = (u) => new URL(u).searchParams.get('metrics') || '';

// ── 1. planner ──
ok('plan: identity + 2 reporting reads + 20 analytics queries (incl. 4 documented-unsupported controls and 2 retention queries) = 23 steps', steps.length === 23 && steps.filter((s) => s.negative).length === 4 && steps.filter((s) => s.kind === 'analytics').length === 20, [steps.length, steps.filter((s) => s.kind === 'analytics').length]);
ok('every planned URL is a GET to an allow-listed Google read endpoint (no jobs.create, no write)', steps.every((s) => P.isReadOnlyAllowed(s.url)));
ok('write methods, foreign hosts and other Google endpoints are refused', !P.isReadOnlyAllowed(steps[2].url, 'POST') && !P.isReadOnlyAllowed('https://evil.example.com/youtube/v3/channels?mine=true') && !P.isReadOnlyAllowed('https://www.googleapis.com/youtube/v3/videos?id=x') && !P.isReadOnlyAllowed('https://youtubereporting.googleapis.com/v1/jobs/new?x'));
ok('no monetary metric is requested (scope yt-analytics-monetary.readonly is not granted)', !steps.some((s) => /revenue|earnings|cpm|monetary|monetized/i.test(s.url)));
ok('impressions/CTR metrics appear ONLY in the documented-unsupported controls', steps.filter((s) => /impressions|ClickRate/i.test(metricsOf(s.url))).every((s) => s.negative));
const ts = steps.find((s) => s.id === 'traffic_source');
ok('documented constraint: the traffic-source query asks only for views / engagedViews / estimatedMinutesWatched (the report allows nothing else)', metricsOf(ts.url).split(',').every((m) => ['views', 'engagedViews', 'estimatedMinutesWatched'].includes(m)), metricsOf(ts.url));
const det = new URL(steps.find((s) => s.id === 'traffic_source_ads_detail').url).searchParams;
ok('documented constraint: ad-detail query filters insightTrafficSourceType==ADVERTISING, sorts, and maxResults ≤ 25', det.get('filters') === 'insightTrafficSourceType==ADVERTISING' && det.get('sort') === '-views' && Number(det.get('maxResults')) <= 25);
ok('per-video query is capped at 200 rows and retention is per ONE video (filters video==…)', Number(new URL(steps.find((s) => s.id === 'per_video').url).searchParams.get('maxResults')) === 200 && /^video==/.test(new URL(steps.find((s) => s.id === 'retention_curve').url).searchParams.get('filters')));
const e365 = new URL(steps.find((s) => s.id === 'earn_longform_365d_by_source').url).searchParams, e90 = new URL(steps.find((s) => s.id === 'earn_shorts_90d_by_source').url).searchParams;
ok('Earn-estimate queries cover 365 and 90 days ending at the same end date', e365.get('endDate') === '2030-01-28' && e365.get('startDate') === '2029-01-28' && e90.get('startDate') === '2029-10-30');
ok('quota accounting: identity = 1 Data API unit; every analytics step = 1 request; reporting reads = 1 each', steps.every((s) => (s.kind === 'identity' ? s.quota.data === 1 : s.kind === 'analytics' ? s.quota.analytics === 1 : s.quota.reporting === 1)));
ok('the probe makes NO write call of any kind (all planned methods are GET by construction; runner issues method GET only)', steps.every((s) => !/jobs\?|create|insert|update|delete/i.test(s.url)));

ok('default period = the last N COMPLETE Pacific-time days ending yesterday (Studio convention): at 2030-01-29 21:56Z → 2030-01-01…2030-01-28 for N=28; and just after UTC midnight (still the previous day in Pacific time) it ends two UTC-days back', (() => { const a = P.defaultPeriod(Date.parse('2030-01-29T21:56:00Z'), 28), b = P.defaultPeriod(Date.parse('2030-01-30T03:00:00Z'), 28); return a.from === '2030-01-01' && a.to === '2030-01-28' && b.to === '2030-01-28' && P.defaultPeriod(Date.parse('2030-01-29T21:56:00Z'), 7).from === '2030-01-22'; })());
// ── 2. capability matrix is static documentation, never a live result ──
const matrix = P.capabilityMatrix();
ok('capability matrix: every capability the plan proves is documented; every row says live = "NOT RUN"', steps.every((s) => matrix.some((m) => m.cap === s.cap)) && matrix.every((m) => m.live === 'NOT RUN'), steps.filter((s) => !matrix.some((m) => m.cap === s.cap)).map((s) => s.cap));
ok('capability matrix: each row states API source, period, scope, limitations and documented status', matrix.every((m) => m.api && m.period && m.scope && m.limits && m.documented));
ok('capability matrix marks what is NOT obtainable: impressions/CTR via Analytics API, subscribers by source, returning viewers, qualified watch hours, revenue', ['thumbnail_impressions_via_analytics_api', 'thumbnail_ctr_via_analytics_api', 'subscribers_by_traffic_source', 'returning_viewers', 'qualified_watch_hours', 'revenue'].every((c) => /unsupported|not available|not applicable/.test(matrix.find((m) => m.cap === c).documented)));

// ── 3. runner on MOCK responses ──
const js = (status, json) => ({ status, json });
const colsFor = (u) => { const q = new URL(u).searchParams; return [...(q.get('dimensions') ? q.get('dimensions').split(',') : []), ...(q.get('metrics') || '').split(',')].filter(Boolean).map((name) => ({ name })); };
const mock = (chan, over = {}) => async (url) => {
  for (const k of Object.keys(over)) if (url.includes(k)) return typeof over[k] === 'function' ? over[k](url) : over[k];
  if (/youtube\/v3\/channels/.test(url)) return js(200, { items: [{ id: chan }] });
  if (/reportTypes/.test(url)) return js(200, { reportTypes: [{ id: 'channel_basic_a3' }, { id: 'channel_reach_basic_a1' }, { id: 'channel_reach_combined_a1' }] });
  if (/youtubereporting.*jobs/.test(url)) return js(200, { jobs: [] });
  const m = new URL(url).searchParams.get('metrics') || '';
  if (/impressions|ClickRate/i.test(m) || /subscribersGained/.test(m) && /insightTrafficSourceType/.test(url) && !/dimensions=video/.test(url) && !/subscribersLost/.test(m)) return js(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'The query is not supported.' } });
  if (/dimensions=video&/.test(url)) return js(200, { columnHeaders: colsFor(url), rows: [['MOCKVID0001', 100, 10, 5, 50, 1, 0, 0], ['MOCKVID0002', 50, 5, 2, 40, 0, 0, 0]] });
  if (/insightTrafficSourceType%2Cday/.test(url)) return js(200, { columnHeaders: colsFor(url), rows: [['ADVERTISING', '2030-01-02', 500, 40], ['YT_SEARCH', '2030-01-02', 5, 1], ['ADVERTISING', '2030-01-03', 600, 50]] });
  if (/dimensions=insightTrafficSourceType&/.test(url)) return js(200, { columnHeaders: colsFor(url), rows: [['ADVERTISING', 1100, 100, 90], ['RELATED_VIDEO', 100, 90, 10]] });
  if (/audienceType/.test(url)) return js(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'unsupported filter' } });
  return js(200, { columnHeaders: colsFor(url), rows: [[1000, 900, 5000, 30, 40, 10, 2]] });
};
let clock = 0; const tick = () => { clock += 100; return clock; };
const calls = []; const spy = (f) => async (u) => { calls.push(u); return f(u); };
const r1 = await P.runProbe({ business: 'silk_road_voices', steps, fetchJson: spy(mock(A)), now: tick });
ok('mock run completes, no abort, one result per step', !r1.aborted && r1.results.length === 23, r1.aborted);
ok('PROVENANCE: a mock run is NOT marked real (default) and says so; no reconciliation is produced for non-real data', r1.provenance.real === false && /not real/.test(r1.provenance.note) && r1.reconcile === undefined);
ok('classification: documented-unsupported 400s → "unsupported_as_documented"; unconfirmed audienceType 400 → "bad_request" (documentation gap, not an error of ours)', r1.results.filter((x) => x.id.startsWith('neg_')).every((x) => x.status === 'unsupported_as_documented') && r1.results.find((x) => x.id === 'audience_type_organic').status === 'bad_request');
const cap = (c) => r1.capabilities.find((x) => x.cap === c).verdict;
ok('capability verdicts: retrievable / not_supported_confirmed / not_retrievable are computed from the step results', cap('traffic_sources') === 'retrievable' && cap('thumbnail_impressions_via_analytics_api') === 'not_supported_confirmed' && cap('paid_vs_organic_filter') === 'not_retrievable' && cap('reach_report_availability') === 'retrievable');
ok('latency accounting uses the injected clock; summary reports total, p50 and max', r1.summary.latencyMs.max === 100 && r1.summary.latencyMs.p50 === 100 && r1.summary.latencyMs.total === 2300, r1.summary.latencyMs);
ok('quota accounting: 1 Data API unit, 20 Analytics requests, 2 Reporting requests for the full plan', r1.summary.quotaUnits.data === 1 && r1.summary.quotaUnits.analytics === 20 && r1.summary.quotaUnits.reporting === 2, r1.summary.quotaUnits);
ok('Reach availability is derived from the report-type and job listings (types listed; no jobs exist yet)', JSON.stringify(r1.reach.typesListed) === JSON.stringify(['channel_reach_basic_a1', 'channel_reach_combined_a1']) && r1.reach.jobsExisting.length === 0);
ok('top video: the retention queries use the top video of per_video, chosen server-side, and the video id is NOT in the report', calls.some((u) => u.includes('MOCKVID0001') && u.includes('elapsedVideoTimeRatio')) && !JSON.stringify(r1).includes('MOCKVID'));
ok('report holds channel-level aggregates only: no per-video rows; the daily paid series lists ADVERTISING days only', !r1.aggregates.per_video && r1.aggregates.traffic_source_daily.rows.length === 2 && r1.aggregates.traffic_source_daily.rows.every((x) => x.length === 2));
const r2 = await P.runProbe({ business: 'srv_studio', steps, fetchJson: mock(B, { 'dimensions=video&': js(200, { columnHeaders: [{ name: 'video' }], rows: [] }) }), now: tick });
ok('no per-video rows → retention steps are skipped_no_video and the capability is "not_run" (never fabricated)', r2.results.filter((x) => x.status === 'skipped_no_video').length === 2 && r2.capabilities.find((x) => x.cap === 'audience_retention_curve').verdict === 'not_run');
const r3 = await P.runProbe({ business: 'srv_studio', steps: [steps[0], steps.find((s) => s.id === 'traffic_source'), steps.find((s) => s.id === 'channel_totals'), steps.find((s) => s.id === 'neg_impressions')], fetchJson: mock(B, { 'insightTrafficSourceType&': js(403, { error: { errors: [{ reason: 'quotaExceeded' }], message: 'quota' } }), 'metrics=views%2CengagedViews%2CestimatedMinutesWatched%2CaverageViewDuration': js(403, { error: { errors: [{ reason: 'forbidden' }], message: 'scope' } }), 'metrics=impressions': js(200, { columnHeaders: [], rows: [[1]] }) }), now: tick });
ok('error handling: 403 quotaExceeded → quota_exceeded; 403 forbidden → forbidden_scope; an unexpectedly working "impressions" is flagged; nothing is retried or switched to another channel', r3.results[1].status === 'quota_exceeded' && r3.results[2].status === 'forbidden_scope' && r3.results[3].status === 'unexpectedly_supported' && r3.capabilities.find((x) => x.cap === 'thumbnail_impressions_via_analytics_api').verdict === 'retrievable_UNEXPECTED', r3.results.map((x) => x.status));
const r4 = await P.runProbe({ business: 'srv_studio', steps: [steps[0], steps.find((s) => s.id === 'channel_totals'), steps.find((s) => s.id === 'traffic_source')], fetchJson: mock(B, { 'dimensions=insightTrafficSourceType&': js(200, { columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }], rows: [['ADVERTISING', 1000]] }), 'dimensions=day': js(200, { rows: [] }) }), now: tick, provenance: { real: true }, reference: { advertisingViews: 1005, totalViews: 1000 } });
ok('reconciliation ARITHMETIC (only when the caller asserts real provenance; data here is synthetic): within 1% passes, outside fails', r4.reconcile.advertisingViews.within1pct === true && r4.reconcile.totalViews.within1pct === true && (await P.runProbe({ business: 'srv_studio', steps: [steps[0], steps.find((s) => s.id === 'traffic_source')], fetchJson: mock(B, { 'dimensions=insightTrafficSourceType&': js(200, { columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }], rows: [['ADVERTISING', 1000]] }) }), now: tick, provenance: { real: true }, reference: { advertisingViews: 1300 } })).reconcile.advertisingViews.within1pct === false);

// ── 4. business isolation and token handling (runner) ──
const TOKA = 'REFRESH-TOKEN-A-DO-NOT-LEAK', TOKB = 'REFRESH-TOKEN-B-DO-NOT-LEAK';
const conns = [{ channel_id: A, refresh_token: TOKA, scope: 'youtube.readonly yt-analytics.readonly' }, { channel_id: B, refresh_token: TOKB, scope: 'youtube.readonly yt-analytics.readonly' }];
{ const refreshed = [], seenAuth = new Set();
  const refresh = async (t) => { refreshed.push(t); return { accessToken: 'ACCESS-FOR-' + t }; };
  const inits = []; const fetchImpl = async (url, init) => { inits.push(init); seenAuth.add(init.headers.Authorization); const chan = init.headers.Authorization.includes(TOKB) ? B : A; const o = await mock(chan)(url); return { status: o.status, json: async () => o.json }; };
  const r = await P.runProbeForBusiness({ business: 'srv_studio', connections: conns, refresh, fetchImpl, from: '2030-01-01', to: '2030-01-28' });
  ok('ISOLATION: a probe for SRV Studio refreshes ONLY the SRV Studio connection and never touches the other business\'s token', r.ok && refreshed.length === 1 && refreshed[0] === TOKB && [...seenAuth].every((a) => a.includes(TOKB)), { refreshed, r: r.aborted });
  ok('every Google request is a GET with a 20-second timeout (a slow request cannot hang the probe)', inits.length === 23 && inits.every((i) => i.method === 'GET' && i.signal), inits.length);
  ok('the report never contains a refresh token, an access token or a bearer header; provenance is not real unless asserted', !/REFRESH-TOKEN|ACCESS-FOR|Bearer/.test(JSON.stringify(r)) && r.provenance.real === false);
  const r5 = await P.runProbeForBusiness({ business: 'silk_road_voices', connections: conns, refresh, fetchImpl, from: '2030-01-01', to: '2030-01-28', provenance: { real: true } });
  ok('and the other way round; an explicit provenance.real=true is carried through', r5.ok && refreshed[1] === TOKA && r5.provenance.real === true);
  ok('an authorization that belongs to the wrong channel aborts after the identity call and nothing else is requested', await (async () => { const seen = []; const r6 = await P.runProbeForBusiness({ business: 'srv_studio', connections: conns, refresh, fetchImpl: async (u) => { seen.push(u); const o = await mock(A)(u); return { status: o.status, json: async () => o.json }; }, from: 'a', to: 'b' }); return /isolation violation/.test(r6.aborted || '') && seen.length === 1; })()); }
ok('no connection / duplicate connection / missing analytics scope / failed refresh / unknown business are clean refusals', (await P.runProbeForBusiness({ business: 'srv_studio', connections: [conns[0]], refresh: async () => ({}), fetchImpl: async () => ({}) })).error === 'no_connection'
  && (await P.runProbeForBusiness({ business: 'srv_studio', connections: [conns[1], conns[1]], refresh: async () => ({}), fetchImpl: async () => ({}) })).error === 'ambiguous_connection'
  && (await P.runProbeForBusiness({ business: 'srv_studio', connections: [{ ...conns[1], scope: 'youtube.readonly' }], refresh: async () => ({}), fetchImpl: async () => ({}) })).error === 'missing_yt_analytics_scope'
  && (await P.runProbeForBusiness({ business: 'srv_studio', connections: [conns[1]], refresh: async () => { throw new Error('boom ' + TOKB); }, fetchImpl: async () => ({}) })).error === 'token_refresh_failed'
  && (await P.runProbeForBusiness({ business: 'other', connections: conns, refresh: async () => ({}), fetchImpl: async () => ({}) })).error === 'unknown_business');
{ let t = null; try { await P.runProbe({ business: 'nope', steps, fetchJson: async () => ({}) }); } catch (e) { t = e.message; } ok('unknown business throws', t === 'unknown business'); }

// ── 5. static guards on the server action and the files ──
{ const ops = fs.readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8');
  const a = ops.indexOf('async function growthProbe('), body = ops.slice(a, ops.indexOf('\n}\n', a) + 3);
  ok('the action is CEO-session only and POST only', /requireCeoSession\(req\)/.test(body) && /POST only/.test(body));
  ok('the action performs NO write: no insert/patch/upsert/storage call and no non-GET request', !/sbInsert|sbPatch|sbUpsert|sbStorage|method:\s*'(POST|PUT|PATCH|DELETE)'/.test(body));
  ok('the action reads exactly one table (youtube_connections) for the one business channel; the database read comes AFTER the dry-run return and AFTER the live-confirmation check', (body.match(/sbGet\(/g) || []).length === 1 && /youtube_connections\?channel_id=eq\./.test(body) && body.indexOf('dryRun') < body.indexOf('sbGet(') && body.indexOf('live_confirmation_required') < body.indexOf('sbGet('));
  ok('a live run needs the explicit confirmation string; provenance.real is asserted only on that path', /RUN-LIVE-READ-ONLY-PROBE/.test(body) && (body.match(/provenance: \{ real: true \}/g) || []).length === 1 && body.indexOf('provenance: { real: true }') > body.indexOf('live_confirmation_required'));
  ok('the reference figures are validated numbers and are never logged or stored', /Number\(b\.reference\[k\]\)/.test(body) && !/console\.(log|warn|error)/.test(body) && !/sb(Insert|Patch|Upsert)/.test(body));
  ok('the action is dispatched once as growth_probe and no new serverless file exists (Hobby limit 12)', (ops.match(/action === 'growth_probe'/g) || []).length === 1 && fs.readdirSync(new URL('../../api/', import.meta.url), { recursive: true }).filter((f) => /\.js$/.test(f)).length === 12);
  const page = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8') + fs.readFileSync(new URL('../../public/home2.js', import.meta.url), 'utf8');
  ok('NO browser-side Google access: the page never references the Analytics/Reporting API hosts; it calls only OUR server action (once, from the CEO-only card, with the CEO session header); Home never references it', !/youtubeanalytics\.googleapis|youtubereporting\.googleapis/.test(page) && (fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8').match(/action=growth_probe/g) || []).length === 1 && !/growth_probe/.test(fs.readFileSync(new URL('../../public/home2.js', import.meta.url), 'utf8')) && /_ceoGetSessionToken\(\)\)\)return ''/.test(fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8'))); }
{ const lib = fs.readFileSync(new URL('../../lib/growthProbe.mjs', import.meta.url), 'utf8');
  ok('the library embeds no analytics figure: the only 4+ digit numbers are the timeout, a day length, a documented year and the Cloud limit text (reference figures arrive at call time only)', (lib.match(/\b\d{4,}\b/g) || []).every((n) => ['1000', '20000', '2019', '86400000'].includes(n)));
  ok('the library performs no file or network I/O of its own', !/\bfetch\(|require\(|from 'node:(fs|http|https|net)'|XMLHttpRequest/.test(lib)); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
