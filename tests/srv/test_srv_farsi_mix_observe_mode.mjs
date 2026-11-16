// Defence in depth: even if the generic publishing gate were in log-only ("observe") mode, srv_farsi_mix refuses unsigned, Family and forged callers by its OWN session check (CEO order 2026-11-12).
// A fresh process with publish_auth_mode = observe and a feature flag that is ON, so only the handler's own check stands in the way.   node tests/srv/test_srv_farsi_mix_observe_mode.mjs
import { createHash } from 'node:crypto';
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 300) : '')); };
const SB = 'https://tldcwvtwjypmwynsklsd.supabase.co'; const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const db = { ceo_auth_config: [{ key: 'ceo_session_secret_production', value: 's' }, { key: 'ceo_pin_hash_production', value: sha('914273') }, { key: 'publish_auth_mode', value: 'observe' }], app_settings: [{ key: 'srv_farsi_mix', value: JSON.stringify({ enabled: true, channelId: 'UCfarsiMixTestChannel01' }) }], packages: [], youtube_channels: [{ channel_id: 'UCfarsiMixTestChannel01', title: 'Silk Road Voices' }], youtube_connections: [{ channel_id: 'UCfarsiMixTestChannel01', refresh_token: 'rt' }] };
const touched = [];
globalThis.fetch = async (input, init = {}) => { const u = String(input); touched.push(u); const resp = (st, b) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: st });
  if (u.startsWith(SB + '/rest/v1/')) { const t = new URL(u).pathname.split('/').pop(), rows = db[t] || []; const qs = [...new URL(u).searchParams.entries()]; let r = rows; for (const [k, v] of qs) if (v.startsWith('eq.')) r = r.filter((x) => String(x[k]) === decodeURIComponent(v.slice(3))); else if (/^in\./.test(v)) { const set = v.slice(4, -1).split(','); r = r.filter((x) => set.includes(String(x[k]))); } return resp(200, r); }
  return resp(599, 'UNEXPECTED ' + u); };
process.env.SUPABASE_SERVICE_KEY = 'svc'; const log = console.log, w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {}; console.log = () => {};
const { default: handler } = await import('../../api/ops.js');
async function call(action, body = {}) { const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; }, end() { return this; }, setHeader() {}, removeHeader() {}, getHeader() {} }; await handler({ method: 'POST', query: { action }, body, headers: {} }, res); return res; }
Object.assign(console, { log, warn: w, error: e });
const ops = ['status', 'upload_init', 'upload_chunk', 'upload_status', 'thumbnail', 'playlist', 'verify', 'video_status', 'abort'];
const control = await call('youtube_check_scope', {}); ok('control: in observe mode the generic gate lets an unsigned call through (so the next checks really test the handler\'s own check)', control.code !== 401 || control.body.error !== 'publisher_session_required', { code: control.code, body: control.body });
for (const o of ops) { const r = await call('srv_farsi_mix', { op: o }); ok(`unsigned ${o}: refused by the handler (401 publisher_session_required)`, r.code === 401 && r.body.error === 'publisher_session_required', r.body); }
for (const [name, extra] of [['Family token', { family_session_token: 'stub.family' }], ['forged CEO token', { ceo_session_token: 'forged.token' }], ['forged VA token', { operator_session_token: 'forged.token' }]]) { const r = await call('srv_farsi_mix', { op: 'status', ...extra }); ok(`${name}: refused`, r.code === 401, r.body); }
ok('no YouTube or storage call was made by any refused request', !touched.some((u) => /googleapis|storage\/v1/.test(u)), touched.filter((u) => /googleapis|storage/.test(u)));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
