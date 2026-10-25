// SRV-STUDIO-V2-031 — OAuth scope isolation: the SRV Studio playlist permission is requested and stored for SRV Studio
// only. Differential test: every other business's sign-in (start + callback) behaves exactly as the pre-031 callback
// (taken from git e154a20). Google, YouTube and Supabase are mocked; nothing leaves this machine.
//   node tests/srv/test_srv_studio_v2_031_oauth.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = []; let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 400))); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv031-'));
const oldSrc = execFileSync('git', ['-C', repo, 'show', 'e154a20:api/youtube/callback.js'], { encoding: 'utf8' });
fs.writeFileSync(path.join(tmp, 'callback.pre031.mjs'), oldSrc);
const NEW = (await import(pathToFileURL(path.join(repo, 'api/youtube/callback.js')).href)).default;
const OLD = (await import(pathToFileURL(path.join(tmp, 'callback.pre031.mjs')).href)).default;
const L = await import(pathToFileURL(path.join(repo, 'lib/srvStudioV2OAuth.mjs')).href);

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
  for (const q of [{}, { channel_target: 'Silk Road Voices' }, { channel_target: 'NextWave Systems' }, { channel_target: 'AI Creation Studio' }, { channel_target: 'InsideObjects AI' }]) {
    install({});
    const a = authParams(await call(NEW, q)), b = authParams(await call(OLD, q));
    ok('sign-in start unchanged for ' + (q.channel_target || 'the legacy all-channel button') + ': scopes, state, prompt identical to pre-031', JSON.stringify(a) === JSON.stringify(b) && a.scope === BASE && !a.scope.includes('force-ssl'), { a, b });
  }
  for (const q of [{ channel_target: 'SRV Studio ' }, { channel_target: 'SRV Studio' }, { scope_set: 'srv_studio_playlists' }]) {
    install({});
    const a = authParams(await call(NEW, q));
    ok('SRV Studio reconnect (' + JSON.stringify(q) + ') requests the base scopes + youtube.force-ssl only, with the SRV Studio state', a.scope === BASE + ' https://www.googleapis.com/auth/youtube.force-ssl' && a.state.startsWith('mmm_youtube_auth_srvpl__') && a.prompt === 'consent select_account' && a.access_type === 'offline' && a.include_granted_scopes === 'false', a);
  }
  install({});
  ok('look-alike targets do not get the playlist permission ("SRV Farsi", "Studio")', !authParams(await call(NEW, { channel_target: 'SRV Farsi' })).scope.includes('force-ssl') && !authParams(await call(NEW, { channel_target: 'Studio' })).scope.includes('force-ssl'));
  restore();
}

// ── 2. callback ──
const GRANT_SRV = BASE + ' https://www.googleapis.com/auth/youtube.force-ssl';
{
  const restore = quiet();
  const srvState = L.srvStudioState('SRV Studio ');
  let w = install({ mine: CH.srv, grantedScope: GRANT_SRV });
  let r = await call(NEW, { code: 'c', state: srvState });
  const conn = w.writes.filter((x) => x.table === 'youtube_connections');
  ok('SRV Studio consent for SRV Studio: one token row written, for UC0nzWQX6AaUqlF5FozNpWPg only, with the playlist scope recorded', r.status === 302 && /yt_connected=true/.test(r.redirect) && conn.length === 1 && conn[0].body.channel_id === CH.srv.id && conn[0].body.scope.includes('youtube.force-ssl') && conn[0].body.refresh_token === 'ref', { redirect: r.redirect, conn });
  for (const other of [CH.farsi, CH.nw, CH.ai]) {
    w = install({ mine: other, grantedScope: GRANT_SRV });
    r = await call(NEW, { code: 'c', state: srvState });
    ok('SRV Studio playlist reconnect where the consent picked ' + other.title + ': refused, NOTHING written (no token, no metadata, no log)', r.status === 302 && /yt_error=srv_studio_playlist_wrong_channel/.test(r.redirect) && w.writes.length === 0, { redirect: r.redirect, writes: w.writes.length });
  }
  w = install({ mine: null, grantedScope: GRANT_SRV });
  r = await call(NEW, { code: 'c', state: srvState });
  ok('SRV Studio playlist reconnect where Google cannot say which channel: refused, nothing written', /yt_error=srv_studio_playlist_wrong_channel/.test(r.redirect) && w.writes.length === 0);
  // differential: every legacy state behaves exactly like pre-031
  const legacy = [['mmm_youtube_auth', CH.farsi], ['mmm_youtube_auth__' + Buffer.from('Silk Road Voices').toString('base64url'), CH.farsi], ['mmm_youtube_auth__' + Buffer.from('NextWave Systems').toString('base64url'), CH.nw], ['mmm_youtube_auth__' + Buffer.from('AI Creation Studio').toString('base64url'), CH.ai], ['tampered_state', CH.farsi]];
  for (const [st, mine] of legacy) {
    const w1 = install({ mine, grantedScope: BASE }); const r1 = await call(NEW, { code: 'c', state: st });
    const w2 = install({ mine, grantedScope: BASE }); const r2 = await call(OLD, { code: 'c', state: st });
    const strip = (ws) => JSON.stringify(ws.map((x) => ({ t: x.table, b: Object.fromEntries(Object.entries(x.body).filter(([k]) => !/(_at|last_sync)$/.test(k))) })));
    ok('callback unchanged for state "' + st.slice(0, 30) + '" (' + mine.title + '): same redirect and the same Supabase writes as pre-031', r1.redirect === r2.redirect && strip(w1.writes) === strip(w2.writes), { r1: r1.redirect, r2: r2.redirect });
  }
  restore();
}

// ── 3. source scope ──
{
  const before = oldSrc, after = fs.readFileSync(path.join(repo, 'api/youtube/callback.js'), 'utf8');
  ok('the shared base scope list (YT_SCOPES) is unchanged', before.match(/const YT_SCOPES = \[[\s\S]*?\]\.join\(' '\);/)[0] === after.match(/const YT_SCOPES = \[[\s\S]*?\]\.join\(' '\);/)[0]);
  ok('youtube.force-ssl appears only in the SRV Studio module, never in the shared scope list', !/force-ssl/.test(after) && /force-ssl/.test(fs.readFileSync(path.join(repo, 'lib/srvStudioV2OAuth.mjs'), 'utf8')));
  const added = after.split('\n').filter((l) => !before.split('\n').includes(l));
  ok('every added line in the shared callback is part of the SRV Studio change (≤ 25 lines)', added.length <= 25 && added.every((l) => /srv|SRV|^\s*$|^\s*[:?]|^\s*\}|state =|scope:|channelTarget = srvState|import \{|\/\/ SRV-STUDIO-V2-031|\/\/ to SRV Studio itself|console\.error\('\[srv2-031\]/i.test(l)), added);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
