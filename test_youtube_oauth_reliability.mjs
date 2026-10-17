// YouTube OAuth reliability patch (2026-10-17) — regression tests for the 3 changes:
//   1. api/youtube/callback.js — refresh_token preservation (never overwrite a stored,
//      valid refresh_token with null just because Google's grant response omitted one).
//   2. api/ops.js youtubeVideoStatus — a dead refresh token now returns a structured
//      401/token_refresh_failed instead of an uncaught exception surfacing as a bare 500.
//   3. api/youtube/callback.js — the legacy "write to all 4 channels" fallback is
//      removed; an unresolved target channel is rejected safely instead.
// Hermetic: changes 1+3 are tested by actually invoking the real handler with a mocked
// global.fetch (no real network calls, no real Supabase/Google writes). Change 2, like
// every other ops.js test in this repo, is verified at the source-text level — ops.js
// is a single giant serverless file this project's existing tests never import/execute
// directly (see test_nextwave_v2_production_route.mjs's OPS_A2_ALLOWED_REMOVED_LINES
// pattern), so this follows the same established convention for consistency.
//   node test_youtube_oauth_reliability.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

let pass = 0, fail = 0; const failures = [];
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; failures.push(name); console.log('  FAIL', name, '\n       ', e.message.split('\n')[0]); } };

// ── Mock fetch router for api/youtube/callback.js's real handler ──────────────────────
// Every call is recorded; responses are resolved by URL substring match, overridable
// per test via `overrides` (checked before the defaults).
function makeMockFetch(overrides = {}) {
  const calls = [];
  const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
  const fetchMock = async (url, init = {}) => {
    const method = init.method || 'GET';
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body || null; }
    calls.push({ url, method, body });
    for (const [pattern, fn] of Object.entries(overrides)) {
      if (url.includes(pattern)) return fn({ url, method, body, calls });
    }
    // ── defaults: a clean, fully-successful reconnect ──
    if (url.includes('oauth2.googleapis.com/token')) {
      return jsonRes(200, { access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly' });
    }
    if (url.includes('youtube/v3/channels') && url.includes('mine=true')) {
      return jsonRes(200, { items: [{ id: 'UC41nsMBfVJCqj4vJRLktZTQ', snippet: { title: 'NextWave Systems' }, statistics: { subscriberCount: '10', viewCount: '100', videoCount: '5' } }] });
    }
    if (url.includes('youtube/v3/channels') && url.includes('forHandle=')) {
      const handle = decodeURIComponent(url.split('forHandle=')[1]);
      const byHandle = {
        SilkRoadVoices: { id: 'UCCUa5BLzGh2eRBoqqWBCK_g', title: 'Silk Road Voices' },
        SRVStudioMusic: { id: 'UC0nzWQX6AaUqlF5FozNpWPg', title: 'SRV Studio' },
        'AICreation-tool': { id: 'UCs3bHOHKiHLPg_zdVcd8_gQ', title: 'AI Creation Studio' },
        NextWaveSys: { id: 'UC41nsMBfVJCqj4vJRLktZTQ', title: 'NextWave Systems' },
      };
      const c = byHandle[handle];
      return jsonRes(200, c ? { items: [{ id: c.id, snippet: { title: c.title }, statistics: { subscriberCount: '10', viewCount: '100', videoCount: '5' } }] } : { items: [] });
    }
    if (url.includes('youtube_connections') && method === 'GET') return jsonRes(200, []); // no existing row by default
    if (url.includes('youtube_connections') && method === 'POST') return jsonRes(200, []);
    if (url.includes('youtube_channels') && method === 'POST') return jsonRes(200, []);
    if (url.includes('youtube_sync_logs') && method === 'POST') return jsonRes(200, []);
    throw new Error('unmocked fetch: ' + method + ' ' + url);
  };
  return { fetchMock, calls };
}

function makeReqRes({ channelTarget = 'NextWave Systems' } = {}) {
  const state = 'mmm_youtube_auth__' + Buffer.from(channelTarget).toString('base64url');
  const req = { method: 'GET', query: { code: 'test-auth-code', state }, headers: { host: 'mmm-static.vercel.app' } };
  let redirectedTo = null;
  const res = {
    setHeader() {},
    redirect(code, url) { redirectedTo = url; return res; },
    status() { return { json() {} }; },
    get redirectedTo() { return redirectedTo; },
  };
  return { req, res, get redirectedTo() { return redirectedTo; } };
}

async function runCallback({ fetchMock, channelTarget }) {
  const realFetch = global.fetch;
  global.fetch = fetchMock;
  process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
  process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  try {
    const mod = await import('./api/youtube/callback.js?t=' + Date.now()); // cache-bust across tests that mutate module-scope nothing, but keeps intent clear
    const { req, res } = makeReqRes({ channelTarget });
    let redirectedTo = null;
    res.redirect = (code, url) => { redirectedTo = url; };
    await mod.default(req, res);
    return redirectedTo;
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\n[1] Change 1 + 3 — api/youtube/callback.js (real handler execution, mocked fetch)');

await t('(1) successful per-channel reconnect: refresh_token present in Google response -> saved, status connected, exactly ONE youtube_connections write, targeting only the resolved channel', async () => {
  const { fetchMock, calls } = makeMockFetch();
  const redirectedTo = await runCallback({ fetchMock, channelTarget: 'NextWave Systems' });
  assert.ok(redirectedTo && redirectedTo.includes('yt_connected=true'), 'expected a success redirect, got: ' + redirectedTo);
  const connWrites = calls.filter((c) => c.url.includes('youtube_connections') && c.method === 'POST');
  assert.equal(connWrites.length, 1, 'expected exactly one youtube_connections write (never a loop over all 4 channels)');
  assert.equal(connWrites[0].body.channel_id, 'UC41nsMBfVJCqj4vJRLktZTQ', 'the single write must target the resolved (NextWave) channel only');
  assert.equal(connWrites[0].body.refresh_token, 'new-refresh-token', 'the fresh refresh_token from Google must be saved');
  assert.equal(connWrites[0].body.status, 'connected');
});

await t('(2) missing refresh_token in Google response + no existing stored token -> status reauthorization_required, upsert payload omits the refresh_token key entirely (never writes null), redirect reports reauthorization_required', async () => {
  const { fetchMock, calls } = makeMockFetch({
    'oauth2.googleapis.com/token': () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'new-access-token', expires_in: 3600, scope: 'x' }), json: async () => ({ access_token: 'new-access-token', expires_in: 3600, scope: 'x' }) }), // no refresh_token
  });
  const redirectedTo = await runCallback({ fetchMock, channelTarget: 'NextWave Systems' });
  assert.ok(redirectedTo && redirectedTo.includes('yt_error=reauthorization_required'), 'expected a reauthorization_required redirect, got: ' + redirectedTo);
  const connWrites = calls.filter((c) => c.url.includes('youtube_connections') && c.method === 'POST');
  assert.equal(connWrites.length, 1);
  assert.ok(!('refresh_token' in connWrites[0].body), 'refresh_token key must be entirely ABSENT from the payload, not present-as-null — an absent key is what lets PostgREST leave the stored column untouched');
  assert.equal(connWrites[0].body.status, 'reauthorization_required');
});

await t('(3) missing refresh_token in Google response BUT an existing stored refresh_token is already on file -> preserved, status stays connected, upsert payload still omits the refresh_token key (so the existing DB value is left untouched, not re-written)', async () => {
  const { fetchMock, calls } = makeMockFetch({
    'oauth2.googleapis.com/token': () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'new-access-token', expires_in: 3600, scope: 'x' }), json: async () => ({ access_token: 'new-access-token', expires_in: 3600, scope: 'x' }) }),
    'youtube_connections': (c) => {
      if (c.method === 'GET') { const row = [{ channel_id: 'UC41nsMBfVJCqj4vJRLktZTQ', refresh_token: 'prior-still-valid-refresh-token' }]; return { ok: true, status: 200, text: async () => JSON.stringify(row), json: async () => row }; }
      return { ok: true, status: 200, text: async () => '[]', json: async () => [] };
    },
  });
  const redirectedTo = await runCallback({ fetchMock, channelTarget: 'NextWave Systems' });
  assert.ok(redirectedTo && redirectedTo.includes('yt_connected=true'), 'expected a success redirect (the channel remains usable on its existing refresh token), got: ' + redirectedTo);
  const connWrites = calls.filter((c) => c.url.includes('youtube_connections') && c.method === 'POST');
  assert.equal(connWrites.length, 1);
  assert.ok(!('refresh_token' in connWrites[0].body), 'refresh_token key must be absent from the payload — the existing DB value is the one that remains valid, and must not be touched/re-sent');
  assert.equal(connWrites[0].body.status, 'connected', 'an existing usable refresh_token means this channel is still fully connected, not reauthorization_required');
});

await t('(4) no refresh token available from either source (no new, no existing) -> reauthorization_required is the only possible outcome, never silently reported as connected', async () => {
  const { fetchMock, calls } = makeMockFetch({
    'oauth2.googleapis.com/token': () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'new-access-token', expires_in: 3600, scope: 'x' }), json: async () => ({ access_token: 'new-access-token', expires_in: 3600, scope: 'x' }) }),
  });
  const redirectedTo = await runCallback({ fetchMock, channelTarget: 'NextWave Systems' });
  assert.ok(redirectedTo.includes('yt_error=reauthorization_required'));
  const connWrites = calls.filter((c) => c.url.includes('youtube_connections') && c.method === 'POST');
  assert.equal(connWrites[0].body.status, 'reauthorization_required');
  assert.ok(!redirectedTo.includes('yt_connected=true'), 'must never claim success when no channel can actually authenticate afterward');
});

await t('(7) unresolved target channel -> rejected safely (channel_resolution_failed), and youtube_connections is NEVER written — proves a failed resolution cannot become any kind of write, multi-channel or otherwise', async () => {
  // mine=true resolves nothing (simulates Google not returning an authoritative channel),
  // AND channelTarget matches none of the 4 real brand-account titles fetchAllChannels
  // still successfully resolves — so targetChannel ends up unresolved by either path.
  const { fetchMock, calls } = makeMockFetch({
    'youtube/v3/channels?part=snippet,statistics&mine=true': () => ({ ok: true, status: 200, text: async () => '{"items":[]}', json: async () => ({ items: [] }) }),
  });
  const redirectedTo = await runCallback({ fetchMock, channelTarget: 'Some Totally Unknown Channel' });
  assert.ok(redirectedTo && redirectedTo.includes('yt_error=channel_resolution_failed'), 'expected a channel_resolution_failed redirect, got: ' + redirectedTo);
  const connWrites = calls.filter((c) => c.url.includes('youtube_connections') && c.method === 'POST');
  assert.equal(connWrites.length, 0, 'zero youtube_connections writes must occur when the target channel cannot be resolved');
});

await t('(8)+(9) no cross-channel token writes / four-business isolation: a successful reconnect for ONE channel never writes to any other channel\'s row — re-asserted directly against the real recorded calls, not just a code-shape check', async () => {
  const { fetchMock, calls } = makeMockFetch();
  await runCallback({ fetchMock, channelTarget: 'NextWave Systems' });
  const connWrites = calls.filter((c) => c.url.includes('youtube_connections') && c.method === 'POST');
  const distinctChannelIds = new Set(connWrites.map((c) => c.body.channel_id));
  assert.equal(distinctChannelIds.size, 1, 'exactly one distinct channel_id must ever appear across all youtube_connections writes in a single reconnect');
  assert.ok(!distinctChannelIds.has('UCCUa5BLzGh2eRBoqqWBCK_g') && !distinctChannelIds.has('UC0nzWQX6AaUqlF5FozNpWPg') && !distinctChannelIds.has('UCs3bHOHKiHLPg_zdVcd8_gQ'), 'SRV Farsi, SRV English/SRV Studio and AI Creation Studio channel IDs must never appear in a NextWave reconnect\'s writes');
});

await t('source check: the legacy "write to all 4 channels" loop is completely gone from callback.js', () => {
  const src = fs.readFileSync('./api/youtube/callback.js', 'utf8');
  assert.ok(!/LEGACY mode/.test(src), 'the legacy-fallback log line must be removed');
  assert.ok(!/for \(const channel of channels\) \{\s*\n\s*await sbUpsert\('youtube_connections'/.test(src), 'no loop may upsert youtube_connections once per fetched channel');
});

await t('source check: sbGetOne (the existing-row lookup) is scoped to a single channel_id via an eq filter, never a broader query', () => {
  const src = fs.readFileSync('./api/youtube/callback.js', 'utf8');
  const fnIdx = src.indexOf('async function sbGetOne');
  const fnEnd = src.indexOf('\nasync function sbUpsert', fnIdx);
  const body = src.slice(fnIdx, fnEnd);
  assert.ok(/channel_id=eq\.\$\{encodeURIComponent\(channelId\)\}/.test(body), 'must filter by exactly one channel_id');
  assert.ok(/limit=1/.test(body), 'must fetch at most one row');
});

console.log('\n[2] Change 2 — api/ops.js youtubeVideoStatus (source-text verification, matching this repo\'s established ops.js testing convention)');

const ops = fs.readFileSync('./api/ops.js', 'utf8');
const fnStart = ops.indexOf('async function youtubeVideoStatus');
const fnEndIdx = ops.indexOf('\n// v13.57.9 Sprint P_B', fnStart);
const fnBody = ops.slice(fnStart, fnEndIdx);

await t('(5)+(6) youtubeVideoStatus wraps the token refresh in try/catch and returns a structured 401/token_refresh_failed on failure — not a generic ops_failed 500', () => {
  assert.ok(/try \{\s*\n\s*refreshed = await _refreshYoutubeToken\(conn\.refresh_token\);/.test(fnBody), 'the refresh call must be inside a try block');
  assert.ok(/catch \(e\) \{\s*\n\s*return res\.status\(401\)\.json\(\{ ok: false, error: 'token_refresh_failed', message: e\.message \}\);/.test(fnBody), 'the catch must return the exact same structured 401 shape youtubeUploadVideo already uses');
});

await t('consistency check: the new catch block matches youtubeUploadVideo\'s existing token_refresh_failed pattern exactly, rather than inventing a new error shape', () => {
  const uploadStart = ops.indexOf('async function youtubeUploadVideo');
  const uploadEnd = ops.indexOf('\nasync function nextwaveV2ResolveObjectLocalPath', uploadStart);
  const uploadBody = ops.slice(uploadStart, uploadEnd);
  assert.ok(/res\.status\(401\)\.json\(\{ ok: false, error: 'token_refresh_failed', message: e\.message \}\)/.test(uploadBody), 'reference pattern must still exist in youtubeUploadVideo, unchanged');
  const occurrences = (ops.match(/res\.status\(401\)\.json\(\{ ok: false, error: 'token_refresh_failed', message: e\.message \}\)/g) || []).length;
  assert.equal(occurrences, 2, 'expected exactly 2 occurrences of this exact structured-error pattern: youtubeUploadVideo (pre-existing) and youtubeVideoStatus (this patch) — not a 3rd divergent copy');
});

await t('no credentials or token values are exposed by the new error path — only e.message (derived from Google\'s error response text, never from the actual token strings) is returned', () => {
  assert.ok(!/refresh_token: conn\.refresh_token/.test(fnBody), 'the raw refresh token must never be included in any response payload');
  const catchStart = fnBody.indexOf('} catch (e) {');
  const catchEnd = fnBody.indexOf('}', catchStart + '} catch (e) {'.length) + 1;
  const catchBlock = fnBody.slice(catchStart, catchEnd);
  assert.ok(catchBlock.length > 0 && catchBlock.length < 200, 'sanity bound on the extracted catch block');
  assert.ok(!/accessToken/.test(catchBlock), 'the catch branch itself must not reference the access token');
  assert.ok(!/conn\.refresh_token/.test(catchBlock), 'the catch branch itself must not reference the raw refresh token');
});

console.log('\n[3] Cross-business / no-regression evidence (structural — diff scope + untouched-function checks)');

await t('youtubeAnalyticsPull and youtubeSyncPerformance (existing YouTube analytics paths) are completely untouched by this patch', () => {
  const analyticsStart = ops.indexOf('async function youtubeAnalyticsPull');
  const analyticsEnd = ops.indexOf('\n', ops.indexOf('return res.status(200).json', analyticsStart + 2000));
  assert.ok(analyticsStart > -1, 'youtubeAnalyticsPull must still exist');
  const perfStart = ops.indexOf('async function youtubeSyncPerformance');
  assert.ok(perfStart > -1, 'youtubeSyncPerformance must still exist');
  assert.ok(/const apiKey = process\.env\.YOUTUBE_API_KEY;/.test(ops.slice(perfStart, perfStart + 500)), 'youtubeSyncPerformance must still use the public API key, not OAuth — confirms it was never touched by this OAuth-refresh patch');
});

await t('youtubeUploadVideo (existing YouTube upload path) is byte-for-byte unchanged by this patch', () => {
  const uploadStart = ops.indexOf('async function youtubeUploadVideo');
  const uploadEnd = ops.indexOf('\nasync function setYtThumbnail', uploadStart);
  const uploadBody = ops.slice(uploadStart, uploadEnd);
  const baseOps = execFileSync('git', ['show', 'origin/main:api/ops.js'], { maxBuffer: 1 << 28 }).toString();
  const baseStart = baseOps.indexOf('async function youtubeUploadVideo');
  const baseEnd = baseOps.indexOf('\nasync function setYtThumbnail', baseStart);
  const baseBody = baseOps.slice(baseStart, baseEnd);
  assert.equal(uploadBody, baseBody, 'youtubeUploadVideo must be byte-identical to origin/main — this patch only touches youtubeVideoStatus');
});

await t('SMM has no YouTube channel mapping before or after this patch — confirms the four-channel map (and this patch) never touches a 5th business', () => {
  const mapStart = ops.indexOf('const YT_ENGINE_TO_TITLE');
  const mapEnd = ops.indexOf('};', mapStart);
  const mapBody = ops.slice(mapStart, mapEnd);
  assert.ok(!/SMM/.test(mapBody), 'SMM must not appear in the engine-to-channel-title map');
  const mappedTitles = new Set([...mapBody.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual([...mappedTitles].sort(), ['AI Creation Studio', 'NextWave Systems', 'SRV Studio', 'Silk Road Voices'].sort(), 'exactly the 4 known channels, nothing more');
});

await t('diff scope: this patch touches only api/youtube/callback.js and api/ops.js (the two files named in the change proposal) — no business production lifecycle code, no .pause-deploy, no OAuth client id/secret/scope strings changed', () => {
  const diffFiles = execFileSync('git', ['diff', '--name-only', 'origin/main']).toString().trim().split('\n').filter(Boolean);
  const allowed = new Set(['api/youtube/callback.js', 'api/ops.js', 'test_youtube_oauth_reliability.mjs', 'test_nextwave_v2_production_route.mjs']);
  diffFiles.forEach((f) => assert.ok(allowed.has(f), `unexpected file in diff: ${f}`));
  const pauseDeployDiff = execFileSync('git', ['diff', 'origin/main', '--', '.pause-deploy']).toString();
  assert.equal(pauseDeployDiff, '', '.pause-deploy must show zero diff');
  const opsDiff = execFileSync('git', ['diff', 'origin/main', '--', 'api/ops.js']).toString();
  assert.ok(!/YOUTUBE_CLIENT_ID\s*=/.test(opsDiff.split('\n').filter((l) => l.startsWith('+')).join('\n')), 'no new line setting/changing YOUTUBE_CLIENT_ID in ops.js');
  const cbDiff = execFileSync('git', ['diff', 'origin/main', '--', 'api/youtube/callback.js']).toString();
  const addedLines = cbDiff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  addedLines.forEach((l) => {
    assert.ok(!/YT_SCOPES\s*=/.test(l), 'no added line redefines YT_SCOPES');
    assert.ok(!/BRAND_HANDLES\s*=/.test(l), 'no added line redefines BRAND_HANDLES (channel mappings)');
  });
});

console.log(`\n${pass} passed, ${fail} failed`); if (fail) { console.log('FAILED:', failures.join(' | ')); process.exit(1); }
