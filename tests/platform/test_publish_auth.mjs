// SRV-STUDIO-V2-017 — publishing sign-in, source allowlist, channel routing and CORS.
// Loads the REAL api/ops.js handler. Every network call (Supabase REST, Google OAuth/YouTube, sources,
// Submagic) goes to an in-memory fake; anything unexpected is recorded and fails the run. Nothing leaves
// this machine. Run: node tests/platform/test_publish_auth.mjs
import { createHash, createHmac } from 'node:crypto';

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 300) : '')); };

const SB = 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SRV = `${SB}/storage/v1/object/public/srv-assets/`;
const CEO_PIN = '914273', CEO_SECRET = 'test-ceo-session-secret';
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

// ── fake Supabase tables ──
const db = {
  ceo_auth_config: [{ key: 'ceo_session_secret_production', value: CEO_SECRET }, { key: 'ceo_pin_hash_production', value: sha(CEO_PIN) }],
  app_settings: [],
  youtube_channels: [
    { channel_id: 'UC_AI', title: 'AI Creation Studio' }, { channel_id: 'UC_NW', title: 'NextWave Systems' },
    { channel_id: 'UC_SRV', title: 'Silk Road Voices' }, { channel_id: 'UC0nz', title: 'SRV Studio ' },
  ],
  youtube_connections: [
    { channel_id: 'UC_AI', refresh_token: 'rt-ai' }, { channel_id: 'UC_NW', refresh_token: 'rt-nw' },
    { channel_id: 'UC_SRV', refresh_token: 'rt-srv' }, { channel_id: 'UC0nz', refresh_token: 'rt-studio' },
  ],
  sm_va_tasks: [],
};
function sbFilter(rows, qs) {
  let r = rows;
  for (const [k, v] of qs) {
    if (['select', 'limit', 'order'].includes(k)) continue;
    if (v.startsWith('eq.')) r = r.filter((x) => String(x[k]) === decodeURIComponent(v.slice(3)));
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(','); r = r.filter((x) => set.includes(String(x[k]))); }
  }
  return r;
}

// ── network log + fake fetch ──
const calls = [];
const reset = () => { calls.length = 0; };
const resp = (status, body, headers = {}) => new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), { status, headers });
const VIDEO = new Uint8Array(4096).fill(7);
// Like real fetch: follows 3xx unless redirect:'manual' is asked for.
globalThis.fetch = async (input, init = {}) => {
  const r = await fakeFetch(input, init);
  if (r.status >= 300 && r.status < 400 && init.redirect !== 'manual' && r.headers.get('location')) return globalThis.fetch(new URL(r.headers.get('location'), String(input)).href, init);
  return r;
};
async function fakeFetch(input, init = {}) {
  const url = String(input);
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  calls.push({ url, method: init.method || 'GET', headers, redirect: init.redirect });
  const u = new URL(url);
  if (url.startsWith(SB + '/rest/v1/')) {
    const table = u.pathname.split('/').pop();
    const rows = db[table] || [];
    const qs = [...u.searchParams.entries()];
    const method = init.method || 'GET';
    if (method === 'GET') return resp(200, sbFilter(rows, qs));
    const body = JSON.parse(init.body || '{}');
    if (method === 'POST') { rows.push(body); db[table] = rows; return resp(201, [body]); }
    if (method === 'PATCH') { const hit = sbFilter(rows, qs); hit.forEach((x) => Object.assign(x, body)); return resp(200, hit); }
  }
  if (url === 'https://oauth2.googleapis.com/token') return resp(200, { access_token: 'at-' + new URLSearchParams(init.body).get('refresh_token'), expires_in: 3600 });
  if (url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable')) return resp(200, '', { location: 'https://upload.example.youtube/session/1' });
  if (url === 'https://upload.example.youtube/session/1') return resp(200, { id: 'VID_NEW', status: {} });
  if (url.startsWith('https://www.googleapis.com/upload/youtube/v3/thumbnails/set')) return resp(200, { ok: true });
  if (url.startsWith('https://www.googleapis.com/youtube/v3/videos?')) return resp(200, { items: [{ status: { uploadStatus: 'processed' } }] });
  if (url === 'https://api.submagic.co/v1/projects/11111111-2222-3333-4444-555555555555') return resp(200, { downloadUrl: 'https://cdn.submagic.co/out/final.mp4' });
  if (url === 'https://api.submagic.co/v1/projects/66666666-2222-3333-4444-555555555555') return resp(200, { downloadUrl: 'https://d1234.cloudfront.net/out/final.mp4' });
  if (url === 'https://cdn.submagic.co/out/final.mp4' || url === 'https://d1234.cloudfront.net/out/final.mp4') return resp(200, VIDEO, { 'content-type': 'video/mp4', 'content-length': '4096' });
  if (url === SRV + 'pkg1/short.mp4' || url === SRV + 'pkg1/moved.mp4' || url === 'https://files2.heygen.ai/v/clip.mp4') return resp(200, VIDEO, { 'content-type': 'video/mp4', 'content-length': '4096' });
  if (url === SRV + 'pkg1/redirect-evil.mp4') return resp(302, '', { location: 'https://evil.example/x.mp4' });
  if (url === SRV + 'pkg1/redirect-ok.mp4') return resp(302, '', { location: SRV + 'pkg1/moved.mp4' });
  if (url === SRV + 'pkg1/missing.mp4') return resp(404, 'SECRET-UPSTREAM-BODY');
  if (url === SRV + 'pkg1/thumb.jpg' || url === 'https://files2.heygen.ai/t/thumb.jpg') return resp(200, new Uint8Array(2048).fill(1), { 'content-type': 'image/jpeg' });
  if (url === SRV + 'pkg1/big.jpg') return resp(200, new Uint8Array(3 * 1024 * 1024), { 'content-type': 'image/jpeg' });
  if (url.startsWith('https://evil.example/') || url.startsWith('https://attacker.example/')) return resp(200, VIDEO, { 'content-type': 'video/mp4', 'content-length': '4096' });
  return resp(599, 'UNEXPECTED');
}

process.env.YOUTUBE_CLIENT_ID = 'cid'; process.env.YOUTUBE_CLIENT_SECRET = 'csecret';
process.env.SUBMAGIC_API_KEY = 'sk-submagic-test'; process.env.SUPABASE_SERVICE_KEY = 'svc';
const origWarn = console.warn, origErr = console.error, origLog = console.log; const warnings = [];
console.warn = (...a) => warnings.push(a.join(' ')); console.error = () => {}; console.log = () => {};
const { default: handler } = await import('../../api/ops.js');

async function call(action, { method = 'POST', body = {}, origin } = {}) {
  const res = { code: 200, body: null, headers: { }, ended: false,
    status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; }, end() { this.ended = true; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, removeHeader(k) { delete this.headers[k.toLowerCase()]; }, getHeader(k) { return this.headers[k.toLowerCase()]; } };
  const req = { method, query: { action }, body, headers: origin ? { origin } : {} };
  await handler(req, res);
  return res;
}
const outbound = () => calls.filter((c) => !c.url.startsWith(SB + '/rest/v1/'));
const up = (extra = {}) => ({ videoUrl: SRV + 'pkg1/short.mp4', engine: 'SRV English', title: 'T', description: 'AI-generated test', privacyStatus: 'private', ...extra });
const initBody = () => { const c = calls.find((x) => x.url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos?')); return c; };

// CEO session
const login = await call('ceo_login', { body: { pin: CEO_PIN } });
const CEO = login.body && login.body.ceo_session_token;
ok('setup: CEO login issues a session', !!CEO, login.body);

// ── 1. Log-only state (no VA PIN yet) — today's behaviour is preserved for the VA ──
reset();
let r = await call('youtube_upload_video', { body: up() });
ok('log-only: unsigned upload from srv-assets still works (VA keeps publishing before the CEO sets a VA PIN)', r.code === 200 && r.body.ok === true && r.body.youtubeVideoId === 'VID_NEW', r.body);
ok('log-only: the unsigned call is logged', warnings.some((w) => /allowed \(log-only\) youtube_upload_video/.test(w)));
r = await call('youtube_upload_video', { body: up({ privacyStatus: 'public' }) });
ok('log-only: an unsigned "public" request is uploaded PRIVATE', r.body.ok === true && r.body.privacyStatus === 'private' && r.body.privacyCoerced === true, r.body);
r = await call('operator_login', { body: { pin: '0000' } });
ok('operator_login answers operator_not_configured before a VA PIN exists', r.body.error === 'operator_not_configured', r.body);

// ── 2. CEO sets the VA PIN ──
r = await call('publish_auth_set_operator_pin', { body: { pin: '482913' } });
ok('set VA PIN without a CEO session is refused', r.code === 401, r.body);
for (const bad of ['0000', '000000', '12345', CEO_PIN]) {
  r = await call('publish_auth_set_operator_pin', { body: { pin: bad, ceo_session_token: CEO } });
  ok(`set VA PIN refuses ${bad === CEO_PIN ? 'the CEO PIN' : JSON.stringify(bad)}`, r.code === 400, r.body);
}
r = await call('publish_auth_set_operator_pin', { body: { pin: '482913', ceo_session_token: CEO } });
ok('CEO sets the VA PIN; the gate switches to enforce automatically', r.body.ok === true && r.body.effectiveMode === 'enforce', r.body);
const pinRow = db.ceo_auth_config.find((x) => x.key === 'operator_pin_hash_production');
ok('only the SHA-256 of the VA PIN is stored (server-only table)', pinRow && pinRow.value === sha('482913'));
r = await call('publish_auth_status', { body: { ceo_session_token: CEO } });
ok('status (CEO) reports PIN set + enforce, never the hash', r.body.operatorPinSet === true && r.body.effectiveMode === 'enforce' && !JSON.stringify(r.body).includes(sha('482913')), r.body);

// ── 3. Enforced ──
const gated = ['youtube_upload_video', 'set_yt_thumbnail', 'tiktok_publish_draft', 'tiktok_check_publish_status', 'youtube_video_status', 'youtube_check_scope', 'sm_va_task_mark_published'];
for (const a of gated) {
  reset();
  r = await call(a, { body: { videoUrl: SRV + 'pkg1/short.mp4', engine: 'SRV English', videoId: 'x', thumbUrl: SRV + 'pkg1/thumb.jpg', vaTaskId: 'x', publish_id: 'x' } });
  ok(`enforce: unsigned ${a} → 401 with zero outbound calls`, r.code === 401 && r.body.error === 'publisher_session_required' && outbound().length === 0, { code: r.code, out: outbound().map((c) => c.url) });
}
r = await call('youtube_upload_video', { body: up({ operator_session_token: 'garbage.token' }) });
ok('enforce: a garbage operator token → 401', r.code === 401);
r = await call('youtube_upload_video', { body: up({ operator_session_token: CEO }) });
ok('enforce: a CEO token passed as an operator token → 401', r.code === 401);
const opSecret = createHmac('sha256', CEO_SECRET).update('mmmos-operator-session-v1').digest('base64url');
const mint = (obj, secret = opSecret) => { const p = Buffer.from(JSON.stringify(obj)).toString('base64url'); return p + '.' + createHmac('sha256', secret).update(p).digest('base64url'); };
const pv = sha('482913').slice(0, 12);
r = await call('youtube_upload_video', { body: up({ operator_session_token: mint({ sub: 'operator', exp: Date.now() - 1000, pv }) }) });
ok('enforce: an expired operator token → 401', r.code === 401);
r = await call('youtube_upload_video', { body: up({ operator_session_token: mint({ sub: 'operator', exp: Date.now() + 60000, pv }, 'wrong-secret') }) });
ok('enforce: an operator token signed with other key material → 401', r.code === 401);
r = await call('youtube_upload_video', { body: up({ operator_session_token: mint({ sub: 'ceo', exp: Date.now() + 60000, pv }) }) });
ok('enforce: an operator-signed token claiming sub=ceo → 401', r.code === 401);

r = await call('operator_login', { body: { pin: '111111' } });
ok('operator_login with the wrong PIN → 401 invalid_credentials', r.code === 401 && r.body.error === 'invalid_credentials', r.body);
r = await call('operator_login', { body: { pin: '482913' } });
const OP = r.body.operator_session_token;
ok('operator_login with the VA PIN issues an operator session', r.body.ok === true && !!OP, r.body);
r = await call('operator_check_session', { body: { operator_session_token: OP } });
ok('operator_check_session confirms it', r.body.ok === true);
r = await call('publish_auth_status', { body: { ceo_session_token: OP } });
ok('an operator token never passes a CEO-only action', r.code === 401);
r = await call('publish_auth_set_mode', { body: { mode: 'observe', operator_session_token: OP } });
ok('the VA cannot switch the gate off', r.code === 401);

reset();
r = await call('youtube_upload_video', { body: up({ operator_session_token: OP, privacyStatus: 'public', publishAt: '2026-11-01T14:00:00Z' }) });
const ib = initBody();
ok('VA upload works with the operator session', r.code === 200 && r.body.ok === true, r.body);
ok('VA upload is forced private, publishAt (scheduling) kept', r.body.privacyStatus === 'private' && r.body.privacyCoerced === true);
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, privacyStatus: 'public' }) });
ok('CEO upload keeps the requested privacy (public)', r.body.ok === true && r.body.privacyStatus === 'public' && !r.body.privacyCoerced, r.body);
r = await call('set_yt_thumbnail', { body: { operator_session_token: OP, videoId: 'VID_NEW', engine: 'SRV Farsi', thumbUrl: SRV + 'pkg1/thumb.jpg' } });
ok('VA thumbnail (SRV Farsi) works', r.body.ok === true, r.body);
r = await call('tiktok_publish_draft', { body: { operator_session_token: OP, engine: 'SRV Farsi', videoUrl: SRV + 'pkg1/short.mp4' } });
ok('TikTok stays frozen for a signed-in VA', r.body.error === 'production_frozen', r.body);

// ── 4. Channel routing (exact) ──
const routed = (engine) => calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token').map((c) => c.url) && calls;
for (const [engine, rt] of [['SRV English', 'rt-studio'], ['SRV Farsi', 'rt-srv'], ['NextWave', 'rt-nw'], ['AI Studio', 'rt-ai'], ['AI Creation Studio', 'rt-ai'], ['NextWave Systems', 'rt-nw']]) {
  reset();
  r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, engine }) });
  const tok = calls.find((c) => c.url === 'https://oauth2.googleapis.com/token');
  ok(`routing: engine ${engine} uploads to its own channel`, r.body.ok === true && tok && JSON.stringify(tok).length > 0 && r.body.channelId && db.youtube_connections.find((x) => x.channel_id === r.body.channelId).refresh_token === rt, r.body);
}
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, engine: 'Unknown' }) });
ok('routing: an unmapped engine is refused', r.code === 400 && r.body.error === 'no_engine_mapping');
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, channelHandle: 'Some Other Channel' }) });
ok('routing: a free-form channelHandle is refused', r.code === 400 && r.body.error === 'unknown_channel', r.body);
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, channelHandle: 'SRV Studio' }) });
ok('routing: channelHandle naming a mapped channel still works', r.body.ok === true && r.body.channelId === 'UC0nz', r.body);
db.youtube_channels.find((x) => x.channel_id === 'UC0nz').title = 'SRV Studio Archive';
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO }) });
ok('routing: no loose "contains" match — a near-miss title is refused, not guessed', r.code === 404 && r.body.error === 'no_connection_for_title' && !('availableTitles' in r.body), r.body);
db.youtube_channels.find((x) => x.channel_id === 'UC0nz').title = 'SRV Studio ';
for (const [engine, want] of [['SRV Studio', 'rt-studio'], ['NextWave', 'rt-nw'], ['SRV Farsi', 'rt-srv'], ['SRV English', 'rt-studio']]) {
  reset();
  r = await call('set_yt_thumbnail', { body: { ceo_session_token: CEO, videoId: 'V', engine, thumbUrl: SRV + 'pkg1/thumb.jpg' } });
  const tok = calls.find((c) => c.url === 'https://oauth2.googleapis.com/token');
  ok(`thumbnail routing: ${engine}`, r.body.ok === true && tok && tok.url && true, r.body);
}
r = await call('set_yt_thumbnail', { body: { ceo_session_token: CEO, videoId: 'V', engine: 'Silk', thumbUrl: SRV + 'pkg1/thumb.jpg' } });
ok('thumbnail routing: a partial name no longer matches a channel', r.code === 401 && r.body.error === 'no_yt_connection', r.body);

// ── 5. Source allowlist ──
const refused = [
  'https://evil.example/x.mp4', 'http://' + SRV.slice(8) + 'pkg1/short.mp4', 'https://tldcwvtwjypmwynsklsd.supabase.co.evil.example/storage/v1/object/public/srv-assets/a.mp4',
  `${SB}/storage/v1/object/public/other-bucket/a.mp4`, `${SB}/storage/v1/object/sign/srv-assets/a.mp4?token=x`, `${SB}/storage/v1/object/srv-assets/a.mp4`,
  `https://user:pw@tldcwvtwjypmwynsklsd.supabase.co/storage/v1/object/public/srv-assets/a.mp4`, `https://tldcwvtwjypmwynsklsd.supabase.co:8443/storage/v1/object/public/srv-assets/a.mp4`,
  `${SRV}..%2f..%2fother-bucket/a.mp4`, 'https://169.254.169.254/latest/meta-data/', 'https://127.0.0.1/x.mp4', 'https://attacker.example/x?submagic.co',
  'https://files2.heygen.ai.evil.example/x.mp4', 'https://app.submagic.co/other/path', 'file:///etc/passwd', 'javascript:alert(1)', '',
];
for (const u of refused) {
  reset();
  r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, videoUrl: u }) });
  ok(`allowlist refuses ${u || '(empty)'}`, r.code === 400 && outbound().length === 0, { code: r.code, body: r.body, out: outbound().map((c) => c.url) });
}
reset();
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, videoUrl: 'https://attacker.example/x?submagic.co' }) });
ok('F-A fixed: a URL that merely contains "submagic.co" never receives the Submagic key (and is never fetched)', !calls.some((c) => c.url.startsWith('https://attacker.example')), calls.map((c) => c.url));
reset();
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, videoUrl: 'https://files2.heygen.ai/v/clip.mp4', engine: 'AI Studio' }) });
ok('allowlist accepts HeyGen CDN (AI Studio / NextWave raw renders)', r.body.ok === true, r.body);
ok('the Submagic key is NOT sent to HeyGen', !calls.some((c) => c.headers['x-api-key']));
reset();
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, videoUrl: '11111111-2222-3333-4444-555555555555', engine: 'AI Studio' }) });
const cdn = calls.find((c) => c.url === 'https://cdn.submagic.co/out/final.mp4');
ok('Submagic project id resolves through the Submagic API and uploads', r.body.ok === true && cdn, r.body);
ok('the Submagic key goes to the real submagic.co CDN host', cdn && cdn.headers['x-api-key'] === 'sk-submagic-test');
reset();
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, videoUrl: 'https://app.submagic.co/api/file/download?path=x/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/66666666-2222-3333-4444-555555555555/final.mp4', engine: 'NextWave' }) });
const cf = calls.find((c) => c.url === 'https://d1234.cloudfront.net/out/final.mp4');
ok('Submagic SPA download URL resolves and uploads', r.body.ok === true && cf, r.body);
ok('F-A fixed: the Submagic key is NOT sent to a non-submagic host', cf && !cf.headers['x-api-key']);
reset();
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, videoUrl: SRV + 'pkg1/redirect-evil.mp4' }) });
ok('a redirect from srv-assets to another host is refused, and the other host is never fetched', r.body.ok === false && !calls.some((c) => c.url.startsWith('https://evil.example')), r.body);
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, videoUrl: SRV + 'pkg1/redirect-ok.mp4' }) });
ok('a redirect that stays inside srv-assets is followed', r.body.ok === true, r.body);
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO, videoUrl: SRV + 'pkg1/missing.mp4' }) });
ok('F-B fixed: an upstream error body is never returned to the caller', r.body.ok === false && !JSON.stringify(r.body).includes('SECRET-UPSTREAM-BODY'), r.body);
for (const u of ['https://evil.example/t.jpg', `${SB}/storage/v1/object/public/other/t.jpg`]) {
  reset();
  r = await call('set_yt_thumbnail', { body: { ceo_session_token: CEO, videoId: 'V', engine: 'SRV Farsi', thumbUrl: u } });
  ok(`thumbnail allowlist refuses ${u}`, r.code === 400 && outbound().length === 0, r.body);
}
r = await call('set_yt_thumbnail', { body: { ceo_session_token: CEO, videoId: 'V', engine: 'NextWave', thumbUrl: 'https://files2.heygen.ai/t/thumb.jpg' } });
ok('thumbnail from HeyGen (NextWave) is accepted', r.body.ok === true, r.body);
r = await call('set_yt_thumbnail', { body: { ceo_session_token: CEO, videoId: 'V', engine: 'SRV Farsi', thumbUrl: SRV + 'pkg1/big.jpg' } });
ok('thumbnail over 2 MB is refused before it reaches YouTube', r.code === 400 && r.body.error === 'thumb_too_large', r.body);

// ── 6. PIN change revokes VA sessions; rollback switch ──
r = await call('publish_auth_set_operator_pin', { body: { pin: '739102', ceo_session_token: CEO } });
r = await call('youtube_upload_video', { body: up({ operator_session_token: OP }) });
ok('changing the VA PIN signs every VA out', r.code === 401, r.body);
r = await call('publish_auth_set_mode', { body: { mode: 'observe', ceo_session_token: CEO } });
ok('rollback switch: CEO sets log-only', r.body.ok === true && r.body.effectiveMode === 'observe', r.body);
r = await call('youtube_upload_video', { body: up() });
ok('log-only again: unsigned upload allowed (forced private)', r.body.ok === true && r.body.privacyStatus === 'private', r.body);
r = await call('publish_auth_set_mode', { body: { mode: 'auto', ceo_session_token: CEO } });
ok('automatic: back to enforce because a VA PIN exists', r.body.effectiveMode === 'enforce', r.body);
r = await call('publish_auth_set_mode', { body: { mode: 'off', ceo_session_token: CEO } });
ok('an unknown mode is refused', r.code === 400);

// ── 7. Lockout ──
for (let i = 0; i < 5; i++) await call('operator_login', { body: { pin: 'wrong-' + i } });
r = await call('operator_login', { body: { pin: '739102' } });
ok('5 wrong VA PINs lock VA sign-in for 15 minutes (state in the server-only table)', r.code === 429 && db.ceo_auth_config.some((x) => x.key === 'operator_login_security_production'), r.body);
{ const lk = db.ceo_auth_config.find((x) => x.key === 'operator_login_security_production'); if (lk) lk.value = '{}'; }

// ── 8. CORS ──
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO }), origin: 'https://evil.example' });
ok('CORS: a foreign origin gets no Access-Control-Allow-Origin on a publishing action', !r.headers['access-control-allow-origin'] && r.headers['vary'] === 'Origin');
r = await call('youtube_upload_video', { body: up({ ceo_session_token: CEO }), origin: 'https://mmm-static.vercel.app' });
ok('CORS: the app origin is echoed', r.headers['access-control-allow-origin'] === 'https://mmm-static.vercel.app');
r = await call('youtube_upload_video', { method: 'OPTIONS', origin: 'https://evil.example' });
ok('CORS: preflight from a foreign origin gets no allow-origin', r.ended && !r.headers['access-control-allow-origin']);
r = await call('health_check', { method: 'GET', origin: 'https://evil.example' });
ok('CORS: every other action keeps "*" (no change outside publishing)', r.headers['access-control-allow-origin'] === '*');

// ── 9. Fail closed ──
const savedGet = globalThis.fetch;
const cfgRows = db.ceo_auth_config;
r = await call('publish_auth_set_mode', { body: { mode: 'auto', ceo_session_token: CEO } });
db.ceo_auth_config = null; // table read now errors
await new Promise((res) => setTimeout(res, 10));
globalThis.fetch = async (u, i) => (String(u).includes('/rest/v1/ceo_auth_config') ? resp(500, 'down') : savedGet(u, i));
// cache is warm for 30 s; force a re-read by calling an action that reloads with force
r = await call('operator_login', { body: { pin: '739102' } });
ok('auth config unavailable: VA sign-in refuses (500), never falls back', r.code === 500, r.body);
globalThis.fetch = savedGet; db.ceo_auth_config = cfgRows;

console.warn = origWarn; console.error = origErr; console.log = origLog;
console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
