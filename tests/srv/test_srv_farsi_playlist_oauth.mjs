// SRV Farsi — Silk Road Voices playlist permission (CEO/PM decision 2026-10-24). Differential against the callback on main:
// only a Silk Road Voices reconnect changes; every other channel's sign-in and callback is identical. All network mocked.
//   node tests/srv/test_srv_farsi_playlist_oauth.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = []; let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 400))); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srvfapl-'));
// baseline = the callback on main before this change (c3bcb98, which already has the SRV Studio 031 permission)
const oldSrc = execFileSync('git', ['-C', repo, 'show', 'c3bcb98:api/youtube/callback.js'], { encoding: 'utf8' }).replace("from '../../lib/srvStudioV2OAuth.mjs'", 'from ' + JSON.stringify(pathToFileURL(path.join(repo, 'lib/srvStudioV2OAuth.mjs')).href));
fs.writeFileSync(path.join(tmp, 'callback.pre031.mjs'), oldSrc);
const NEW = (await import(pathToFileURL(path.join(repo, 'api/youtube/callback.js')).href)).default;
const OLD = (await import(pathToFileURL(path.join(tmp, 'callback.pre031.mjs')).href)).default;
const F = await import(pathToFileURL(path.join(repo, 'lib/srvFarsiOAuth.mjs')).href);

process.env.YOUTUBE_CLIENT_ID = 'test-client'; process.env.YOUTUBE_CLIENT_SECRET = 'test-secret';
process.env.YOUTUBE_REDIRECT_URI = 'https://mmm-static.vercel.app/api/youtube/callback'; process.env.APP_URL = 'https://mmm-static.vercel.app';
process.env.SUPABASE_SERVICE_KEY = 'svc';
const CH = { srv: { id: 'UC0nzWQX6AaUqlF5FozNpWPg', title: 'SRV Studio ' }, farsi: { id: 'UCCUa5BLzGh2eRBoqqWBCK_g', title: 'Silk Road Voices' }, nw: { id: 'UC41nsMBfVJCqj4vJRLktZTQ', title: 'NextWave Systems' }, ai: { id: 'UCs3bHOHKiHLPg_zdVcd8_gQ', title: 'AI Creation Studio' } };
const byHandle = { SilkRoadVoices: CH.farsi, SRVStudioMusic: CH.srv, NextWaveSys: CH.nw, 'AICreation-tool': CH.ai };

// mock world: which channel the consent was for, what Google granted; records every Supabase write
function install({ mine, grantedScope }) {
  const writes = []; const reads = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const j = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return j({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600, scope: grantedScope });
    if (u.includes('/channels?') && u.includes('mine=true')) return j({ items: mine ? [{ id: mine.id, snippet: { title: mine.title }, statistics: {} }] : [] });
    if (u.includes('/channels?') && u.includes('forHandle=')) { const h = new URL(u).searchParams.get('forHandle'); const c = byHandle[h]; return j({ items: c ? [{ id: c.id, snippet: { title: c.title }, statistics: {} }] : [] }); }
    if (u.includes('/rest/v1/')) {
      if ((init.method || 'GET') === 'GET') { reads.push(u); return j([]); }
      writes.push({ table: u.match(/rest\/v1\/([a-z_]+)/)[1], body: JSON.parse(init.body) }); return { ok: true, status: 201, text: async () => '' };
    }
    throw new Error('unexpected fetch ' + u);
  };
  return { writes, reads };
}
const call = async (handler, query) => {
  let redirect = null, status = 200, body = null; const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; }, status(c) { status = c; return this; }, json(o) { body = o; return this; }, redirect(c, u) { status = c; redirect = u; return this; } };
  await handler({ method: 'GET', query, headers: { host: 'mmm-static.vercel.app' } }, res);
  return { status, redirect, body };
};
const authParams = (r) => Object.fromEntries(new URL(r.redirect).searchParams);
const BASE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly';
const quiet = () => { const o = { log: console.log, warn: console.warn, error: console.error }; console.log = console.warn = console.error = () => {}; return () => Object.assign(console, o); };


// ── 1. sign-in start ──
{
  const restore = quiet();
  for (const q of [{ channel_target: 'Silk Road Voices' }, { scope_set: 'srv_farsi_playlists' }]) {
    install({});
    const a = authParams(await call(NEW, q)), b = authParams(await call(OLD, q));
    ok('Silk Road Voices reconnect (' + JSON.stringify(q) + ') asks for the base scopes + youtube.force-ssl only (the minimum for playlistItems.insert), with the SRV Farsi state; prompt/client/redirect unchanged',
      a.scope === BASE + ' https://www.googleapis.com/auth/youtube.force-ssl' && a.state.startsWith('mmm_youtube_auth_srvfapl__') && a.prompt === b.prompt && a.client_id === b.client_id && a.redirect_uri === b.redirect_uri && a.access_type === b.access_type, { a, b });
  }
  for (const q of [{}, { channel_target: 'NextWave Systems' }, { channel_target: 'AI Creation Studio' }, { channel_target: 'SRV Studio ' }, { channel_target: 'SRV Studio' }, { scope_set: 'srv_studio_playlists' }, { channel_target: 'InsideObjects AI' }, { channel_target: 'SRV Farsi' }, { channel_target: 'Silk Road' }]) {
    install({});
    const a = authParams(await call(NEW, q)), b = authParams(await call(OLD, q));
    ok('sign-in start identical to main for ' + JSON.stringify(q) + ' (scopes, state, prompt)', JSON.stringify(a) === JSON.stringify(b), { a, b });
  }
  restore();
}
// ── 2. callback ──
const GRANT = BASE + ' https://www.googleapis.com/auth/youtube.force-ssl';
{
  const restore = quiet();
  const st = F.srvFarsiState('Silk Road Voices');
  let w = install({ mine: CH.farsi, grantedScope: GRANT });
  let r = await call(NEW, { code: 'c', state: st });
  const conn = w.writes.filter((x) => x.table === 'youtube_connections');
  ok('Silk Road Voices consent: one token row, for UCCUa5BLzGh2eRBoqqWBCK_g only, with the playlist scope recorded', r.status === 302 && /yt_connected=true/.test(r.redirect) && conn.length === 1 && conn[0].body.channel_id === CH.farsi.id && conn[0].body.scope.includes('youtube.force-ssl'), { redirect: r.redirect, conn: conn.map((c) => c.body.channel_id) });
  for (const other of [CH.srv, CH.nw, CH.ai]) {
    w = install({ mine: other, grantedScope: GRANT });
    r = await call(NEW, { code: 'c', state: st });
    ok('Silk Road Voices playlist reconnect where the consent picked ' + other.title + ': refused, NOTHING written', /yt_error=srv_farsi_playlist_wrong_channel/.test(r.redirect) && w.writes.length === 0, { redirect: r.redirect, writes: w.writes.length });
  }
  w = install({ mine: null, grantedScope: GRANT });
  r = await call(NEW, { code: 'c', state: st });
  ok('Silk Road Voices playlist reconnect where Google cannot say which channel: refused, nothing written', /yt_error=srv_farsi_playlist_wrong_channel/.test(r.redirect) && w.writes.length === 0);
  const legacy = [['mmm_youtube_auth', CH.farsi], ['mmm_youtube_auth__' + Buffer.from('Silk Road Voices').toString('base64url'), CH.farsi], ['mmm_youtube_auth__' + Buffer.from('NextWave Systems').toString('base64url'), CH.nw], ['mmm_youtube_auth__' + Buffer.from('AI Creation Studio').toString('base64url'), CH.ai]];
  for (const [s, mine] of legacy) {
    const w1 = install({ mine, grantedScope: BASE }); const r1 = await call(NEW, { code: 'c', state: s });
    const w2 = install({ mine, grantedScope: BASE }); const r2 = await call(OLD, { code: 'c', state: s });
    const strip = (ws) => JSON.stringify(ws.map((x) => ({ t: x.table, b: Object.fromEntries(Object.entries(x.body).filter(([k]) => !/(_at|last_sync)$/.test(k))) })));
    ok('callback identical to main for existing state "' + s.slice(0, 30) + '" (' + mine.title + ')', r1.redirect === r2.redirect && strip(w1.writes) === strip(w2.writes));
  }
  { const w1 = install({ mine: CH.srv, grantedScope: GRANT }); const r1 = await call(NEW, { code: 'c', state: 'mmm_youtube_auth_srvpl__' + Buffer.from('SRV Studio ').toString('base64url') });
    const w2 = install({ mine: CH.srv, grantedScope: GRANT }); const r2 = await call(OLD, { code: 'c', state: 'mmm_youtube_auth_srvpl__' + Buffer.from('SRV Studio ').toString('base64url') });
    ok('SRV Studio playlist reconnect callback identical to main', r1.redirect === r2.redirect && w1.writes.length === w2.writes.length); }
  restore();
}
// ── 3. source scope ──
{
  const after = fs.readFileSync(path.join(repo, 'api/youtube/callback.js'), 'utf8');
  ok('shared base scope list (YT_SCOPES) unchanged and force-ssl never added to it', oldSrc.match(/const YT_SCOPES = \[[\s\S]*?\]\.join\(' '\);/)[0] === after.match(/const YT_SCOPES = \[[\s\S]*?\]\.join\(' '\);/)[0] && !/force-ssl/.test(after));
  ok('SRV Farsi module grants only to the Silk Road Voices channel id', F.srvFarsiTokenAllowed('UCCUa5BLzGh2eRBoqqWBCK_g') && !F.srvFarsiTokenAllowed('UC0nzWQX6AaUqlF5FozNpWPg') && !F.srvFarsiTokenAllowed('UC41nsMBfVJCqj4vJRLktZTQ') && !F.srvFarsiTokenAllowed('UCs3bHOHKiHLPg_zdVcd8_gQ') && !F.srvFarsiTokenAllowed(undefined));
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
