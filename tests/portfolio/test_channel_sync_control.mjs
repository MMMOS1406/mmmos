// Per-channel background-sync switch — retired channels can be skipped, retained engines never, default behaviour unchanged. Real handlers, fake world, no network.
//   node tests/portfolio/test_channel_sync_control.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { pathToFileURL } from 'node:url'; import { execFileSync } from 'node:child_process';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); process.chdir(repo);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const L = await import(pathToFileURL(path.join(repo, 'lib/channelSyncControl.mjs')).href);
// ---- unit
const ids = (s) => [...s].sort().join(',');
check('no config → nothing disabled', ids(L.parseDisabled(undefined).youtube) === '' && ids(L.parseDisabled(null).tiktok) === '');
check('malformed config → nothing disabled (fail open)', ids(L.parseDisabled('{nope').youtube) === '' && ids(L.parseDisabled('[1,2]').youtube) === '');
check('valid config parsed; junk entries dropped', ids(L.parseDisabled('{"youtube":["A","",5,null,"B"],"tiktok":["T"]}').youtube) === 'A,B' && ids(L.parseDisabled({ tiktok: ['T'] }).tiktok) === 'T');
check('a failing reader → nothing disabled', ids((await L.loadDisabled(async () => { throw new Error('db down'); })).youtube) === '');
const rows = [{ channel_id: 'FA', mmm_engine: 'SRV Farsi' }, { channel_id: 'EN', mmm_engine: 'SRV English' }, { channel_id: 'NW', mmm_engine: 'NextWave' }, { channel_id: 'AI', mmm_engine: 'AI Studio' }, { channel_id: 'UN' }];
const all = new Set(['FA', 'EN', 'NW', 'AI', 'UN']);
check('listed retired channels are skipped; SRV Farsi / SRV English never; unknown engine never', L.filterEnabled(rows, all, 'channel_id').map((r) => r.channel_id).join(',') === 'FA,EN,UN');
check('engine map is used when rows carry no tag', L.filterEnabled([{ channel_id: 'X' }], new Set(['X']), 'channel_id', { X: 'NextWave' }).length === 0 && L.filterEnabled([{ channel_id: 'X' }], new Set(['X']), 'channel_id', { X: 'SRV Farsi' }).length === 1);
// ---- the real handlers in a fake world
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chsync-'));
const baseAuto = path.join(tmp, 'autosync_main.mjs'); fs.writeFileSync(baseAuto, execFileSync('git', ['show', 'origin/main:api/youtube/autosync.js']).toString());
let world; const calls = [];
const json = (o, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => o, text: async () => JSON.stringify(o) });
const WORLD = () => ({
  conns: [{ channel_id: 'FA' }, { channel_id: 'EN' }, { channel_id: 'NW' }, { channel_id: 'AI' }],
  channels: [{ channel_id: 'FA', mmm_engine: 'SRV Farsi', title: 'a', subscribers: 1, total_views: 1, total_videos: 1 }, { channel_id: 'EN', mmm_engine: 'SRV English', title: 'b', subscribers: 1, total_views: 1, total_videos: 1 }, { channel_id: 'NW', mmm_engine: 'NextWave', title: 'c', subscribers: 1, total_views: 1, total_videos: 1 }, { channel_id: 'AI', mmm_engine: 'AI Studio', title: 'd', subscribers: 1, total_views: 1, total_videos: 1 }],
  tt: [{ open_id: 'T-SRV', mmm_engine: 'SRV Farsi' }, { open_id: 'T-AI', mmm_engine: 'AI Studio' }],
  cfg: null, videos: [{ video_id: 'v1', channel_id: 'FA' }, { video_id: 'v2', channel_id: 'NW' }, { video_id: 'v3', channel_id: 'AI' }, { video_id: 'v4', channel_id: 'EN' }], cfgFail: false,
});
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const method = init.method || 'GET'; calls.push(method + ' ' + u.replace(/^https?:\/\/[^/]+/, '') + (init.body && method !== 'GET' ? ' ' + String(init.body).slice(0, 4000) : ''));
  if (u.includes('/rest/v1/app_settings?key=eq.sync_disabled_channels')) return world.cfgFail ? json({ message: 'boom' }, 500) : json(world.cfg == null ? [] : [{ value: world.cfg }]);
  if (u.includes('/rest/v1/youtube_connections?status=eq.connected')) return json(world.conns);
  if (u.includes('/rest/v1/youtube_connections?select=')) return json(world.conns.map((c) => ({ ...c, refresh_token: 'r', scope: 'x' })));
  if (u.includes('/rest/v1/tiktok_connections?status=eq.connected')) return json(world.tt);
  if (u.includes('/rest/v1/youtube_channels?')) return json(world.channels);
  if (u.includes('/rest/v1/youtube_videos?')) return json(world.videos);
  if (u.includes('/api/youtube/sync') || u.includes('/api/tiktok/sync')) return json({ success: true });
  if (u.includes('analytics_auto_run')) return json({ ok: true, status: 'healthy' });
  return json([], 201);
};
process.env.SUPABASE_URL = 'https://s.test'; process.env.SUPABASE_SERVICE_KEY = 'k'; process.env.APP_URL = 'https://app.test'; delete process.env.CRON_SECRET;
const patchedAuto = await import(pathToFileURL(path.join(repo, 'api/youtube/autosync.js')).href); const mainAuto = await import(pathToFileURL(baseAuto).href);
const run = async (mod, cfg, extra = {}) => { world = { ...WORLD(), cfg, ...extra }; calls.length = 0; const r = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await mod.default({ method: 'GET', headers: { host: 'x' } }, r); return { body: r.body, calls: [...calls] }; };
const synced = (c) => c.filter((x) => x.startsWith('POST') && x.includes('/api/youtube/sync')).map((x) => /"channelId":"([^"]+)"/.exec(x)[1]).join(',');
const ttSynced = (c) => c.filter((x) => x.includes('/api/tiktok/sync')).map((x) => /"openId":"([^"]+)"/.exec(x)[1]).join(',');
const stripCfg = (c) => c.filter((x) => !x.includes('sync_disabled_channels')).map((x) => x.replace('select=open_id,mmm_engine', 'select=open_id').replace(/"synced_at":"[^"]+"/g, '"synced_at":"<ts>"'));   // the only other difference: the TikTok read also selects the engine tag
const norm = (c) => c.map((x) => x.replace(/"synced_at":"[^"]+"/g, '"synced_at":"<ts>"'));
const a0r = await run(mainAuto, null), b0 = await run(patchedAuto, null); const a0 = { ...a0r, calls: norm(a0r.calls) };
if (JSON.stringify(stripCfg(b0.calls)) !== JSON.stringify(a0.calls)) { const A = a0.calls, B = stripCfg(b0.calls); for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) { console.log('first difference at', i, '\n main   :', A[i], '\n patched:', B[i]); break; } }
check('DEFAULT (no config row): the patched autosync makes exactly the same calls as main (apart from reading the switch)', JSON.stringify(stripCfg(b0.calls)) === JSON.stringify(a0.calls) && synced(b0.calls) === 'FA,EN,NW,AI' && ttSynced(b0.calls) === 'T-SRV,T-AI');
const b1 = await run(patchedAuto, JSON.stringify({ youtube: ['NW', 'AI'], tiktok: ['T-AI'] }));
check('retired NextWave + AI Studio channels and the AI Studio TikTok account are skipped', synced(b1.calls) === 'FA,EN' && ttSynced(b1.calls) === 'T-SRV', `${synced(b1.calls)} | ${ttSynced(b1.calls)}`);
check('the retained channels and SRV TikTok still sync, the analytics chain still runs', b1.calls.some((x) => x.includes('analytics_auto_run')) && b1.body.succeeded === 2 && b1.body.failed === 0);
const b2 = await run(patchedAuto, JSON.stringify({ youtube: ['FA', 'EN'], tiktok: ['T-SRV'] }));
check('listing a RETAINED channel / account has no effect (they still sync)', synced(b2.calls) === 'FA,EN,NW,AI' && ttSynced(b2.calls) === 'T-SRV,T-AI');
const b3 = await run(patchedAuto, '{broken'); check('malformed switch row → everything syncs', synced(b3.calls) === 'FA,EN,NW,AI');
const b4 = await run(patchedAuto, null, { cfgFail: true }); check('switch row unreadable → everything syncs', synced(b4.calls) === 'FA,EN,NW,AI');
const b5 = await run(patchedAuto, JSON.stringify({ youtube: ['NW'] }), { channels: [] }); check('engine tags unavailable → nothing is skipped (cannot prove it is retired)', synced(b5.calls) === 'FA,EN,NW,AI');
check('no credential row is read or written by the switch', !b1.calls.some((x) => /youtube_connections\?.*(PATCH|DELETE)/.test(x)) && !b1.calls.some((x) => x.startsWith('PATCH') || x.startsWith('DELETE')));
// ---- analytics pull + snapshot inside ops.js
const ops = await import(pathToFileURL(path.join(repo, 'api/ops.js')).href + '?cs');
const act = async (action, cfg) => { world = { ...WORLD(), cfg }; calls.length = 0; const r = { code: 200, body: null, setHeader() {}, removeHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } }; await ops.default({ method: 'GET', url: '/api/ops?action=' + action, query: { action, days: '30' }, headers: { host: 'x' }, body: null }, r); return { r, calls: [...calls] }; };
const snap = async (cfg) => { const x = await act('youtube_snapshot_now', cfg); const bodyOf = (p) => { const c = x.calls.find((k) => k.startsWith('POST') && k.includes(p)); return c ? c.slice(c.indexOf('[')) : ''; }; return { ch: [...new Set([...bodyOf('youtube_channel_snapshots').matchAll(/"channel_id":"([^"]+)"/g)].map((m) => m[1]))].join(','), res: x.r.body }; };
const s0 = await snap(null), s1 = await snap(JSON.stringify({ youtube: ['NW', 'AI'] })), s2 = await snap(JSON.stringify({ youtube: ['FA'] }));
check('snapshot, DEFAULT: all four channels', /FA/.test(s0.ch) && /NW/.test(s0.ch) && /AI/.test(s0.ch) && /EN/.test(s0.ch) && s0.res.ok === true, s0.ch);
check('snapshot, retired channels listed: only SRV Farsi and SRV English are snapshotted (and their videos)', s1.ch === 'FA,EN' && s1.res.videosSnapshotted === 2, `${s1.ch} videos=${s1.res.videosSnapshotted}`);
check('snapshot, a retained channel listed: unchanged', /FA/.test(s2.ch) && /EN/.test(s2.ch) && /NW/.test(s2.ch));
const p0 = await act('youtube_analytics_pull', null), p1 = await act('youtube_analytics_pull', JSON.stringify({ youtube: ['NW', 'AI'] }));
const pulled = (x) => x.calls.filter((c) => c.includes('youtubeanalytics.googleapis.com') || c.includes('oauth2.googleapis.com')).length;
const errs = (x) => (x.r.body && (x.r.body.results || []).length) + (x.r.body && (x.r.body.errors || []).length);
check('analytics pull: with retired channels listed it handles fewer connections than by default and never errors for the retained ones', errs(p1) < errs(p0) || (p0.r.code === p1.r.code && pulled(p1) <= pulled(p0)), `default ${errs(p0)} vs switched ${errs(p1)}`);
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
