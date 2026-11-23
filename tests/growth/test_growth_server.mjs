// Growth server actions (growth_collect, growth_collect_scheduled, growth_report): the REAL handlers executed with stubs (no network, no database). SYNTHETIC data.
import fs from 'node:fs'; import { createHash, timingSafeEqual } from 'node:crypto';
import * as C from '../../lib/growthCollect.mjs'; import * as D from '../../lib/growthDecisions.mjs'; import * as Y from '../../lib/yppCard.mjs'; import * as GA from '../../lib/growthAnalytics.mjs'; import { createRunGuard } from '../../lib/growthProbe.mjs'; import { decide } from '../../lib/dataProxy.mjs';
import { makeWorld, addDays } from './collect_fixtures.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 400) : ''); } };
const NOW = Date.parse('2030-03-15T18:00:00Z'), B1 = 'silk_road_voices', B2 = 'srv_studio', CH1 = GA.GROWTH_BUSINESSES[B1].channelId, CH2 = GA.GROWTH_BUSINESSES[B2].channelId, KEY = 'SERVICE-KEY-FOR-TEST';
const ops = fs.readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8'); const a0 = ops.indexOf('const _growthCollectGuard'), a1 = ops.indexOf('// R-B — read-only YouTube API probe.'), src = ops.slice(a0, a1);
const switchRec = (o) => JSON.stringify({ enabled: true, businesses: [B1, B2], authorized_until: '2030-03-15T19:00:00Z', ...o });
const world = (over = {}) => {
  const w = { role: 'ceo', switch: null, docs: {}, ypp: null, writes: [], reads: [], google: [], accessTokens: [], cfg: { [B1]: {}, [B2]: {} }, conns: [{ channel_id: CH1, refresh_token: 'RT-' + 'one', scope: 'https://www.googleapis.com/auth/yt-analytics.readonly' }, { channel_id: CH2, refresh_token: 'RT-' + 'two', scope: 'https://www.googleapis.com/auth/yt-analytics.readonly' }], rows: { [CH1]: [], [CH2]: [] }, refreshFails: false, ...over };
  const worlds = { [B1]: makeWorld(B1, { end: '2030-03-14' }), [B2]: makeWorld(B2, { end: '2030-03-14', seed: 3 }) }; w.worlds = worlds;
  w.fetch = async (url, init) => { w.google.push({ url, method: (init && init.method) || 'GET', auth: init && init.headers && init.headers.Authorization }); const bz = Object.values(worlds).find((x) => (init.headers.Authorization || '') === 'Bearer AT-' + x.business); const wd = bz || worlds[B1]; if (w.cfg[wd.business].identity) wd.identity = w.cfg[wd.business].identity; const r = await wd.fetchJson(url); return { status: r.status, json: async () => r.json }; };
  const sbGet = async (q) => { w.reads.push(q);
    if (/^app_settings\?key=eq\.growth_collect&/.test(q)) return w.switch === null ? [] : [{ value: w.switch }];
    let m; if ((m = /^app_settings\?key=eq\.growth_data_(\w+)&/.exec(q))) return w.docs[m[1]] ? [{ value: JSON.stringify(w.docs[m[1]]) }] : [];
    if (/^app_settings\?key=eq\.ypp_earn_capture&/.test(q)) return w.ypp === null ? [] : [{ value: JSON.stringify(w.ypp) }];
    if (/^youtube_connections/.test(q)) { const id = /channel_id=eq\.([^&]+)/.exec(q)[1]; return w.conns.filter((c) => c.channel_id === decodeURIComponent(id)); }
    if (/^youtube_videos_analytics/.test(q)) { const id = decodeURIComponent(/channel_id=eq\.([^&]+)/.exec(q)[1]); return w.rows[id] || []; }
    if (/^youtube_channels/.test(q)) { const id = decodeURIComponent(/channel_id=eq\.([^&]+)/.exec(q)[1]); return [{ channel_id: id, subscribers: 100, total_views: 5000, updated_at: '2030-03-15T00:00:00Z' }]; }
    return []; };
  const stubs = { requireCeoSession: async () => w.role === 'ceo', _publisherFromRequest: async () => (w.role ? { role: w.role } : null), sbGet,
    sbInsert: async (t, d) => { w.writes.push(['insert', t, d.key]); if (t === 'app_settings') w.docs[d.key.replace('growth_data_', '')] = JSON.parse(d.value); return d; }, sbPatch: async (t, f, d) => { w.writes.push(['patch', t, f]); if (t === 'app_settings') w.docs[/growth_data_(\w+)/.exec(f)[1]] = JSON.parse(d.value); return d; },
    fetch: w.fetch, _refreshYoutubeToken: async (rt) => { if (w.refreshFails) throw new Error('no'); return { accessToken: 'AT-' + (rt === 'RT-one' ? B1 : B2) }; }, console: { log() {}, warn() {}, error() {} }, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
    createHash, timingSafeEqual, Buffer, SUPABASE_SERVICE_KEY: KEY, _growthCreateRunGuard: createRunGuard,
    _gcAuth: C.collectAuthorization, _gcSteps: C.collectSteps, _gcCollect: (o) => { (w.deadlines = w.deadlines || []).push(o.deadlineMs); return C.collectForBusiness(o); }, _gcMerge: C.mergeCollection, _gcParseDoc: C.parseDoc, _gcKey: C.dataKey, _gcSwitchKey: C.COLLECT_SWITCH_KEY, _gcConfirm: C.COLLECT_CONFIRMATION, _gcPeriod: C.collectPeriod, _gcCronInput: C.cronSignatureInput,
    _gdBuild: D.buildDashboard, _gaNorm: GA.normaliseRow, _gaBuild: GA.buildWorkspace, _gaBiz: GA.GROWTH_BUSINESSES, _yppParseStore: Y.parseCaptureStore, _yppBuild: Y.buildYppModel, _yppStoreKey: Y.YPP_STORE_KEY };
  const names = Object.keys(stubs); const f = new Function(...names, src + '\nreturn { growthCollect, growthCollectScheduled, growthReport };')(...names.map((k) => stubs[k]));
  const call = (fn) => async ({ method = 'POST', body = {}, headers = {} } = {}) => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(x) { res.body = x; return res; } }; await fn({ method, body, query: {}, headers }, res); return res; };
  w.collect = call(f.growthCollect); w.scheduled = call(f.growthCollectScheduled); w.report = call(f.growthReport);
  return w; };
const cronHeader = { 'x-mmm-cron': createHash('sha256').update(C.cronSignatureInput(KEY)).digest('hex') };
const readOnlyHost = (u) => /^https:\/\/(www\.googleapis\.com\/youtube\/v3\/(channels\?|videos\?part=contentDetails&)|youtubeanalytics\.googleapis\.com\/v2\/reports\?)/.test(u);

// 1. growth_collect
{ const w = world(); const a = await w.collect({ method: 'GET' }); w.role = null; const b = await w.collect(); 
  ok('GET → 405; no session → 401; neither contacts Google or the database', a.code === 405 && b.code === 401 && w.google.length === 0 && w.writes.length === 0 && w.reads.length === 0); }
{ const w = world(); const r = await w.collect({ body: { business: 'nextwave' } }); const d = await w.collect({ body: { business: B1, dryRun: true } });
  ok('unknown business → 400; dry run shows the plan and the authorization state ("disabled by default"), contacts NO Google, writes nothing', r.code === 400 && d.code === 200 && d.body.dryRun && d.body.authorization.ok === false && /disabled/.test(d.body.authorization.detail) && d.body.plan.length === 11 && w.google.length === 0 && w.writes.length === 0); }
{ const w = world(); const noConfirm = await w.collect({ body: { business: B1 } }); const off = await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } });
  ok('DEFAULT DISABLED: without the typed confirmation → 400; with it but no authorization record → 403 and NO Google request, NO write', noConfirm.code === 400 && off.code === 403 && off.body.error === 'collection_not_authorized' && w.google.length === 0 && w.writes.length === 0);
  w.switch = switchRec({ authorized_until: '2030-03-15T17:00:00Z' }); const exp = await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } });
  ok('an EXPIRED authorization → 403 collection_authorization_expired, nothing contacted', exp.code === 403 && exp.body.error === 'collection_authorization_expired' && w.google.length === 0);
  w.switch = switchRec({ businesses: [B2] }); const other = await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } });
  ok('an authorization for the OTHER business does not cover this one', other.code === 403 && w.google.length === 0); }
{ const w = world({ switch: switchRec() }); const r = await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } });
  ok('AUTHORIZED run → 200; every Google request is a GET to a read endpoint; every request carries the token of THIS business only', r.code === 200 && r.body.ok && w.google.length === 27 && w.google.every((g) => g.method === 'GET' && readOnlyHost(g.url) && g.auth === 'Bearer AT-' + B1), { n: w.google.length, r: r.body });
  ok('WRITES: exactly ONE row, in app_settings, with this business\'s key — no other key, table or business', w.writes.length === 1 && w.writes[0][1] === 'app_settings' && w.writes[0][2] === 'growth_data_' + B1 && !w.docs[B2]);
  ok('the stored document is this business\'s (channel id) and contains no token', w.docs[B1].channel_id === CH1 && !/AT-|RT-|Bearer/.test(JSON.stringify(w.docs[B1])));
  ok('the other business\'s connection was never read or used (only this channel id was queried)', w.reads.filter((q) => /youtube_connections/.test(q)).every((q) => q.includes(CH1)) && !w.google.some((g) => g.auth === 'Bearer AT-' + B2));
  ok('NEVER requested: search.list, revenue/monetary metrics, the Reporting API (Reach/CTR)', !w.google.some((g) => /search|estimatedRevenue|cpm|youtubereporting|impressions/i.test(g.url)));
  const again = await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } });
  ok('COOLDOWN: a second run within 10 minutes → 429 and no further Google request', again.code === 429 && w.google.length === 27); }
{ const w = world({ switch: switchRec() }); const [a, b] = await Promise.all([w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } }), w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } })]);
  ok('SINGLE-FLIGHT: two simultaneous runs for one business → one runs, one is refused; one document write', [a.code, b.code].sort().join() === '200,429' && w.writes.length === 1); }
{ const w = world({ switch: switchRec() }); const a = await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } }); const b = await w.collect({ body: { business: B2, confirm: C.COLLECT_CONFIRMATION } });
  ok('each business is collected independently and writes only its own key', a.code === 200 && b.code === 200 && w.writes.map((x) => x[2]).join() === `growth_data_${B1},growth_data_${B2}` && w.docs[B1].channel_id === CH1 && w.docs[B2].channel_id === CH2 && JSON.stringify(w.docs[B1]) !== JSON.stringify(w.docs[B2])); }
{ const w = world({ switch: switchRec(), cfg: { [B1]: { identity: async () => ({ status: 200, json: { items: [{ id: 'UCanotherChannelXXXXXXXX' }] } }) }, [B2]: {} } }); const r = await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } });
  ok('ISOLATION: a token that belongs to another channel → 502 with an isolation message, ONE request, NO write', r.code === 502 && /isolation/.test(r.body.detail) && w.google.length === 1 && w.writes.length === 0); }
{ const w = world({ switch: switchRec(), conns: [] }); const r = await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } }); const w2 = world({ switch: switchRec(), refreshFails: true }); const r2 = await w2.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } }); const w3 = world({ switch: switchRec(), conns: [{ channel_id: CH1, refresh_token: 'RT-one', scope: 'youtube.readonly' }] }); const r3 = await w3.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } });
  ok('no connection → 404; token refresh failure → 502 token_refresh_failed; missing analytics scope → 502 — each visible, none writes or calls Google reports', r.code === 404 && r2.code === 502 && r2.body.error === 'token_refresh_failed' && r3.code === 502 && r3.body.error === 'missing_yt_analytics_scope' && [w, w2, w3].every((x) => x.writes.length === 0 && x.google.length === 0)); }
{ const w = world({ switch: switchRec() }); w.worlds[B1].behave.daily_series = { status: 403, json: { error: { errors: [{ reason: 'dailyLimitExceeded' }], message: 'q' } } }; const r = await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } });
  ok('a QUOTA error is reported in the response steps (never silent) and the run stops requesting further reports', r.body.steps.daily_series === 'quota_exceeded' && Object.values(r.body.steps).some((v) => v === 'skipped_quota') && r.body.ok === true); }
// 2. scheduled
{ const w = world({ switch: switchRec({ schedule: true, businesses: [B1] }) }); const none = await w.scheduled({ method: 'GET' }); const bad = await w.scheduled({ method: 'GET', headers: { 'x-mmm-cron': 'wrong' } });
  ok('the scheduled action needs the cron signature (401 otherwise) and touches nothing without it', none.code === 401 && bad.code === 401 && w.google.length === 0 && w.reads.length === 0); }
{ const w = world(); const r = await w.scheduled({ method: 'GET', headers: cronHeader });
  ok('DEFAULT DISABLED: with a valid signature but no switch record, nothing is collected: zero Google requests, zero writes', r.code === 200 && r.body.results.every((x) => x.skipped === 'collection_not_authorized') && w.google.length === 0 && w.writes.length === 0);
  const w2 = world({ switch: switchRec() }); const r2 = await w2.scheduled({ method: 'GET', headers: cronHeader });
  ok('a MANUAL authorization alone never enables the schedule', r2.body.results.every((x) => x.skipped === 'schedule_not_authorized') && w2.google.length === 0 && w2.writes.length === 0);
  const w3 = world({ switch: switchRec({ schedule: true, businesses: [B2] }) }); const r3 = await w3.scheduled({ method: 'GET', headers: cronHeader });
  ok('with schedule:true for ONE business only that business is collected, using its own token and key', r3.body.results.find((x) => x.business === B2).ok === true && r3.body.results.find((x) => x.business === B1).skipped && w3.writes.length === 1 && w3.writes[0][2] === 'growth_data_' + B2 && w3.google.every((g) => g.auth === 'Bearer AT-' + B2)); }
{ const w = world({ switch: switchRec({ schedule: true }) }); await w.scheduled({ method: 'GET', headers: cronHeader });
  ok('SCHEDULED: both businesses run in one invocation; each run gets only the time left of 160 s (second ≤ first), manual runs keep the default', w.deadlines && w.deadlines.length === 2 && w.deadlines[0] <= 160000 && w.deadlines[1] <= w.deadlines[0] && w.deadlines[1] >= 20000, w.deadlines); }
// 3. report
{ const w = world(); w.role = null; const a = await w.report(); const b = await w.report({ method: 'GET' });
  ok('growth_report: no session → 401, GET → 405, nothing read', a.code === 401 && b.code === 405 && w.reads.length === 0); }
{ const w = world({ rows: { [CH1]: [{ channel_id: CH1, video_id: 'vidAAAAAAA1', title: 'Silk title', views: 120, view_count: 130, watch_time_min: 90, avg_view_duration_sec: 40, retention_pct: 30, subs_gained: 1, analytics_synced_at: '2030-03-15T00:49:00Z', synced_at: '2030-03-15T00:49:00Z', published_at: '2030-03-01T00:00:00Z' }], [CH2]: [{ channel_id: CH2, video_id: 'vidBBBBBBB1', title: 'Studio title', views: 50, view_count: 55, watch_time_min: 30, avg_view_duration_sec: 30, retention_pct: 20, subs_gained: 0, analytics_synced_at: '2030-03-15T00:49:00Z', synced_at: '2030-03-15T00:49:00Z', published_at: '2030-03-02T00:00:00Z' }] } });
  const r = await w.report(); const a = r.body.reports.find((x) => x.business === B1), b = r.body.reports.find((x) => x.business === B2);
  ok('NOT COLLECTED: both businesses report source "database_snapshot" with the R-A fallback and a High WAIT FOR DATA recommendation; reads only (no writes, no Google)', r.code === 200 && a.source === 'database_snapshot' && b.source === 'database_snapshot' && a.fallback && a.recommendations[0].outcome === 'WAIT FOR DATA' && w.writes.length === 0 && w.google.length === 0);
  ok('ISOLATION: each business\'s videos query is filtered to its own channel', w.reads.filter((q) => /^youtube_videos_analytics/.test(q)).length === 2 && w.reads.filter((q) => /^youtube_videos_analytics/.test(q)).every((q) => q.includes(CH1) !== q.includes(CH2)));
  ok('CEO sees the collection state (disabled by default) and the monetization statement (unknown: no capture)', a.collection.manual_authorized === false && a.collection.scheduled === false && a.recommendations.some((x) => x.id === 'monetization' && x.outcome === 'WAIT FOR DATA')); }
{ const w = world({ switch: switchRec() }); await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } }); await w.collect({ body: { business: B2, confirm: C.COLLECT_CONFIRMATION } });
  const r = await w.report({ body: { business: B1 } }); const d = r.body.reports[0];
  ok('COLLECTED: the report is built from the stored document: source, windows, paid split, retention, freshness and the collection log (steps + requests)', r.body.reports.length === 1 && d.source === 'collected_youtube_analytics' && d.windows.d28.views > 0 && d.freshness.status === 'fresh' && d.collection.manual_authorized === true && d.collection.last.requests.analytics === 25 && d.retention.organic_available);
  ok('every recommendation in the report satisfies the contract', d.recommendations.every((x) => !x.invalid && D.validateDecision(x).ok));
  w.role = 'operator'; const mark = w.reads.length; const v = await w.report({ body: { business: B1 } }); const vd = v.body.reports[0];
  ok('VA role: same analytics, but NO collection controls/state and NO monetization statement; the capture store and the switch are not read', vd.collection === null && !vd.recommendations.some((x) => x.id === 'monetization') && vd.windows.d28.views === d.windows.d28.views && !w.reads.slice(mark).some((q) => /ypp_earn_capture|growth_collect&/.test(q)) && w.reads.length > mark);
  ok('the report contains no token, key or secret', !/AT-|RT-|Bearer|SERVICE-KEY/.test(JSON.stringify(r.body))); }
{ const w = world(); const r = await w.report({ body: { business: 'other' } }); ok('unknown business → 400', r.code === 400); }
{ const w = world({ switch: switchRec() }); await w.collect({ body: { business: B1, confirm: C.COLLECT_CONFIRMATION } }); w.docs[B2] = { business: B2, channel_id: CH2, days: 'garbage', periods: [null, 5], videos: 7, retention: [] };
  const origRows = w.rows; w.rows = new Proxy(origRows, { get(t, k) { if (k === CH2) throw new Error('db exploded'); return t[k]; } });
  const r = await w.report(); const a = r.body.reports.find((x) => x.business === B1), b = r.body.reports.find((x) => x.business === B2);
  ok('FAILURE ISOLATION: when one business\'s report cannot be built, the response is still 200, the other business is complete, and the failed one is an explicit error entry (no partial numbers)', r.code === 200 && a.source === 'collected_youtube_analytics' && a.windows.d28.views > 0 && b.error === 'report_failed' && !b.windows);
  w.rows = origRows; const r2 = await w.report(); const b2 = r2.body.reports.find((x) => x.business === B2);
  ok('a malformed stored document is sanitized, not fatal: report builds as "not collected" for that business', r2.code === 200 && b2.source === 'database_snapshot' && !b2.error); }
// 4. browsers cannot read or write the growth keys (data proxy)
for (const role of ['operator', 'family', undefined]) ok(`data proxy: ${role || 'anonymous'} cannot READ growth_data_* or growth_collect`, ['growth_data_' + B1, 'growth_collect'].every((k) => !decide({ role, method: 'GET', path: `app_settings?key=eq.${k}` }).allow));
for (const role of ['ceo', 'operator', 'family']) ok(`data proxy: ${role} cannot WRITE growth keys from a browser`, ['growth_data_' + B1, 'growth_collect'].every((k) => !decide({ role, method: 'POST', path: 'app_settings', body: { key: k, value: '{}' } }).allow && !decide({ role, method: 'PATCH', path: `app_settings?key=eq.${k}`, body: { value: '{}' } }).allow));
// 5. static
ok('the growth block makes no direct Google call: Google is reached only through collectForBusiness (read-only, allow-listed)', !/fetch\(['"`]https/.test(src) && /_gcCollect\(/.test(src));
ok('the growth block writes only the growth_data_<business> row (no other sbInsert/sbPatch target)', (src.match(/sb(Insert|Patch)\(/g) || []).length === 2 && /_growthSaveDoc/.test(src) && !/sbInsert\('(?!app_settings)/.test(src));
ok('the daily cron references ONLY the scheduled hook action (never growth_collect directly, never a Google URL)', (() => { const a = fs.readFileSync(new URL('../../api/youtube/autosync.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, ''); return !/action=growth_collect['"`&]/.test(a) && !/googleapis\.com/.test(a); })());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
