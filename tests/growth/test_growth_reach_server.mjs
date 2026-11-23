// growth_reach_status / growth_reach_sync: the REAL handlers from api/ops.js executed with stubs (no network, no database). SYNTHETIC data. Disabled by default; dry run by default.
import fs from 'node:fs';
import * as R from '../../lib/growthReach.mjs'; import { createRunGuard } from '../../lib/growthProbe.mjs'; import { GROWTH_BUSINESSES } from '../../lib/growthAnalytics.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 500) : ''); } };
const NOW = Date.parse('2030-03-15T18:00:00Z'), B1 = 'silk_road_voices', B2 = 'srv_studio', CH1 = GROWTH_BUSINESSES[B1].channelId, CH2 = GROWTH_BUSINESSES[B2].channelId;
const ops = fs.readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8'); const a0 = ops.indexOf('// ── growth_reach (C3)'), a1 = ops.indexOf('// ── end growth_reach ──'); const src = ops.slice(a0, a1);
const rec = (o) => JSON.stringify({ enabled: true, businesses: [B1], types: ['basic'], authorized_until: '2030-03-16T00:00:00Z', ...o });
const csv = (ch, d, v, i, c) => `date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\r\n${d},${ch},${v},${i},${c}\r\n`;
const world = (over = {}) => {
  const w = { role: 'ceo', record: null, docs: {}, writes: [], reads: [], net: [], conns: [{ channel_id: CH1, refresh_token: 'RT-one', scope: 'yt-analytics.readonly' }, { channel_id: CH2, refresh_token: 'RT-two', scope: 'yt-analytics.readonly' }], refreshFails: false, jobs: [], apiOff: false, ...over };
  const sbGet = async (q) => { w.reads.push(q); let m;
    if (/^app_settings\?key=eq\.growth_reach&/.test(q)) return w.record === null ? [] : [{ value: w.record }];
    if ((m = /^app_settings\?key=eq\.growth_reach_(\w+)&/.exec(q))) return w.docs[m[1]] ? [{ value: JSON.stringify(w.docs[m[1]]) }] : [];
    if (/^youtube_connections/.test(q)) { const id = decodeURIComponent(/channel_id=eq\.([^&]+)/.exec(q)[1]); return w.conns.filter((c) => c.channel_id === id); }
    return []; };
  const fetchStub = async (url, init) => { const u = String(url); const tok = init && init.headers && init.headers.Authorization; w.net.push({ url: u, method: (init && init.method) || 'GET', auth: tok });
    if (w.apiOff) return { status: 403, json: async () => ({ error: { status: 'PERMISSION_DENIED', message: 'YouTube Reporting API has not been used in project 1 before or it is disabled.' } }), text: async () => '' };
    const ch = tok === 'Bearer AT-' + B1 ? CH1 : CH2;
    if (/\/reportTypes$/.test(u)) return { status: 200, json: async () => ({ reportTypes: [{ id: 'channel_reach_basic_a1' }] }), text: async () => '' };
    if (/\/jobs$/.test(u) && ((init && init.method) || 'GET') === 'GET') return { status: 200, json: async () => ({ jobs: w.jobs }), text: async () => '' };
    if (/\/jobs$/.test(u)) { const j = { id: 'job1', reportTypeId: 'channel_reach_basic_a1', createTime: '2030-03-15T10:00:00Z' }; w.jobs.push(j); return { status: 200, json: async () => j, text: async () => '' }; }
    if (/\/reports/.test(u)) return { status: 200, json: async () => ({ reports: [{ id: 'r1', startTime: '2030-03-14T00:00:00Z', endTime: '2030-03-15T00:00:00Z', downloadUrl: 'https://youtubereporting.googleapis.com/v1/media/CH/1' }] }), text: async () => '' };
    if (/\/media\//.test(u)) return { status: 200, json: async () => null, text: async () => csv(ch, '20300314', 'vidAAAAAAA1', 1200, 0.04) };
    return { status: 404, json: async () => ({}), text: async () => '' }; };
  const stubs = { requireCeoSession: async () => w.role === 'ceo', sbGet, sbInsert: async (t, d) => { w.writes.push(['insert', t, d.key]); const m = /^growth_reach_(\w+)$/.exec(d.key); if (m) w.docs[m[1]] = JSON.parse(d.value); return d; }, sbPatch: async (t, f, d) => { w.writes.push(['patch', t, f]); const m = /key=eq\.growth_reach_(\w+)/.exec(f); if (m) w.docs[m[1]] = JSON.parse(d.value); return d; },
    _refreshYoutubeToken: async (rt) => { if (w.refreshFails) throw new Error('no'); return { accessToken: 'AT-' + (rt === 'RT-one' ? B1 : B2) }; }, fetch: fetchStub, AbortSignal, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
    _gaBiz: GROWTH_BUSINESSES, _GROWTH_BUSINESSES: [B1, B2], _growthCreateRunGuard: createRunGuard, _grRun: R.runReachSync, _grAuth: R.reachAuthorization, _grDataKey: R.reachDataKey, _grSwitchKey: R.REACH_SWITCH_KEY, _grConfirm: R.REACH_CONFIRMATION, _grTypes: R.REACH_TYPES };
  const names = Object.keys(stubs); const f = new Function(...names, src + '\nreturn { growthReachStatus, growthReachSync };')(...names.map((k) => stubs[k]));
  const call = (fn) => async ({ method = 'POST', body = {}, headers = {} } = {}) => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(x) { res.body = x; return res; } }; await fn({ method, body, query: {}, headers }, res); return res; };
  w.status = call(f.growthReachStatus); w.sync = call(f.growthReachSync); return w; };
// session
{ const w = world(); w.role = null; const a = await w.status({ method: 'GET' }), b = await w.sync({ body: { business: B1 } }); ok('no CEO session → 401 on both actions; nothing read, nothing sent', a.code === 401 && b.code === 401 && w.reads.length === 0 && w.net.length === 0); }
{ const w = world(); w.role = 'operator'; const a = await w.status({ method: 'GET' }), b = await w.sync({ body: { business: B1 } }); ok('a VA session is refused as well (CEO only)', a.code === 401 && b.code === 401 && w.net.length === 0); }
// default disabled
{ const w = world(); const s = await w.status({ method: 'GET' }); ok('status by default: not authorized, nothing stored, no network, no write', s.body.reach.every((x) => x.authorization.basic === false && x.stored === null) && w.net.length === 0 && w.writes.length === 0);
  const d = await w.sync({ body: { business: B1 } }); const l = await w.sync({ body: { business: B1, dryRun: false, confirm: R.REACH_CONFIRMATION } });
  ok('DEFAULT DISABLED: with no record both a dry run and a confirmed live run are refused (403), with zero connection reads, zero network and zero writes', d.code === 403 && l.code === 403 && w.net.length === 0 && w.writes.length === 0 && !w.reads.some((q) => /youtube_connections/.test(q))); }
// dry run / confirmation
{ const w = world({ record: rec() }); const d = await w.sync({ body: { business: B1 } }); ok('dry run is the DEFAULT: returns the plan (one state-changing step), contacts nothing, writes nothing, reads no token', d.code === 200 && d.body.dryRun && d.body.plan.filter((x) => x.state_change).length === 1 && w.net.length === 0 && w.writes.length === 0 && !w.reads.some((q) => /youtube_connections/.test(q)));
  const nc = await w.sync({ body: { business: B1, dryRun: false } }); ok('a live run without the typed confirmation → 400 and nothing is sent', nc.code === 400 && w.net.length === 0);
  const un = await w.sync({ body: { business: 'nextwave' } }); ok('unknown business → 400', un.code === 400);
  const other = await w.sync({ body: { business: B2 } }); ok('ISOLATION: a record that covers one business is a 403 for the other', other.code === 403 && w.net.length === 0); }
// live (fake API): job exists; no allow_create needed
{ const w = world({ record: rec(), jobs: [{ id: 'job1', reportTypeId: 'channel_reach_basic_a1', createTime: '2030-03-01T00:00:00Z' }] }); const r = await w.sync({ body: { business: B1, dryRun: false, confirm: R.REACH_CONFIRMATION } });
  ok('LIVE (fake API): reports are downloaded and stored under growth_reach_<business> only; every request goes to the Reporting API with THIS business\'s token', r.code === 200 && r.body.ok && w.docs[B1] && Object.keys(w.docs[B1].days).length === 1 && w.net.every((n) => /^https:\/\/youtubereporting\.googleapis\.com\/v1\//.test(n.url) && n.auth === 'Bearer AT-' + B1) && !w.docs[B2], r.body);
  ok('the response never contains a token or refresh token', !/AT-|RT-|Bearer/.test(JSON.stringify(r.body)));
  const again = await w.sync({ body: { business: B1, dryRun: false, confirm: R.REACH_CONFIRMATION } }); ok('COOLDOWN: a second live run within 5 minutes → 429 and no further request', again.code === 429 && w.net.length === r.body.requests); }
{ const w = world({ record: rec() }); const r = await w.sync({ body: { business: B1, dryRun: false, confirm: R.REACH_CONFIRMATION } }); ok('JOB SAFEGUARD: with no job and no allow_create the run stops (job_missing) before any POST', r.body.stopped.kind === 'job_missing' && !w.net.some((n) => n.method === 'POST'));
  const w2 = world({ record: rec({ allow_create: true }) }); const r2 = await w2.sync({ body: { business: B1, dryRun: false, confirm: R.REACH_CONFIRMATION } }); ok('with allow_create the job is created exactly once (one POST)', w2.net.filter((n) => n.method === 'POST').length === 1 && r2.body.ok); }
{ const w = world({ record: rec(), apiOff: true }); const r = await w.sync({ body: { business: B1, dryRun: false, confirm: R.REACH_CONFIRMATION } }); ok('API not enabled in the Google project (the observed 2026-11-19 state) → stops after one request with a clear reason; nothing stored', r.body.stopped.kind === 'api_not_enabled' && w.net.length === 1 && Object.keys(w.docs).length === 0 && w.writes.length === 0); }
{ const w = world({ record: rec(), refreshFails: true }); const r = await w.sync({ body: { business: B1, dryRun: false, confirm: R.REACH_CONFIRMATION } }); ok('a token refresh failure is reported (502) and nothing is sent to Google', r.code === 502 && r.body.error === 'token_refresh_failed' && w.net.length === 0); }
{ const w = world({ record: rec({ authorized_until: '2030-03-14T00:00:00Z' }) }); const r = await w.sync({ body: { business: B1 } }); ok('an expired authorization is refused', r.code === 403 && w.net.length === 0); }
ok('NOT SCHEDULED: no cron, rewrite or autosync reference to the reach actions (nothing runs by itself)', !/growth_reach/.test(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) && !/growth_reach/.test(fs.readFileSync(new URL('../../api/youtube/autosync.js', import.meta.url), 'utf8')));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
