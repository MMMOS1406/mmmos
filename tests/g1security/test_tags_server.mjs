// G6 — growth_tags_set through the REAL api/ops.js: CEO session only; the video must belong to THIS business's channel; validated options; derived data only (growth_tags_<business>), never packages. Fake world, SYNTHETIC data.
import { world, resetWorld, loadPair, cleanup, mkRes, json, signCeo, reporter } from '../g0safety/world.mjs';
const { check, done } = reporter();
const baseFetch = globalThis.fetch; let reads = [], writes = [], store = {};
const id = (n) => 'V' + String(n).padStart(10, '0');
const CAT = { UCCUa5BLzGh2eRBoqqWBCK_g: [1, 2].map(id), UC0nzWQX6AaUqlF5FozNpWPg: [5].map(id) };
globalThis.fetch = async (url, opt = {}) => { const u = String(url), m = (opt && opt.method) || 'GET';
  if (/\/rest\/v1\/youtube_videos\?/.test(u)) { reads.push(u); const ch = /channel_id=eq\.([A-Za-z0-9_-]+)/.exec(u), v = /video_id=eq\.([A-Za-z0-9_-]+)/.exec(u); return json(ch && v && (CAT[ch[1]] || []).includes(v[1]) ? [{ video_id: v[1] }] : []); }
  if (/\/rest\/v1\/app_settings/.test(u) && /growth_tags_/.test(u + (opt.body || ''))) {
    if (m === 'GET') { const k = /key=eq\.(growth_tags_\w+)/.exec(u)[1]; return json(store[k] ? [{ value: store[k] }] : []); }
    const b = opt.body ? JSON.parse(opt.body) : {};
    if (m === 'POST') { writes.push({ m, k: b.key }); if (store[b.key]) return { ok: false, status: 409, json: async () => ({}) }; store[b.key] = b.value; return json([{ key: b.key }]); }
    if (m === 'PATCH') { const k = /key=eq\.(growth_tags_\w+)/.exec(u)[1], old = decodeURIComponent(/value=eq\.(.*)$/.exec(u)[1]); writes.push({ m, k }); if (store[k] !== old) return json([]); store[k] = b.value; return json([{ key: k }]); } }
  return baseFetch(url, opt); };
const log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && /^(PASS|FAIL|\d+ passed)/.test(a[0])) log(...a); }; console.warn = () => {}; console.error = () => {};
resetWorld(); const ops = (await loadPair('ops.js', '7d3f81a')).cur.default;
const call = async ({ headers = {}, body = {}, method = 'POST' } = {}) => { reads = []; writes = []; const r = mkRes(); await ops({ method, headers: { host: 'app.test', origin: 'https://mmm-static.vercel.app', ...headers }, query: { action: 'growth_tags_set' }, body: method === 'POST' ? body : null }, r); return { r, reads: reads.slice(), writes: writes.slice() }; };
const CEO = { 'x-mmm-ceo-session': signCeo() }; const T = { opening_visual: 'avatar_close', intro_type: 'hook_first', visual_motion: 'slow_motion', vocal_style: 'soft', thumb_variant: 'A', genre: 'Deep House' };
{ const o = await call({ body: { business: 'silk_road_voices', video_id: id(1), tags: T } }); check('no session → 401, nothing read or written', o.r.code === 401 && !o.reads.length && !o.writes.length); }
{ const o = await call({ headers: { 'x-mmm-ceo-session': 'junk' }, body: { business: 'silk_road_voices', video_id: id(1), tags: T } }); check('forged session → 401', o.r.code === 401 && !o.writes.length); }
{ const o = await call({ method: 'GET', headers: CEO }); check('GET → 405', o.r.code === 405); }
{ const o = await call({ headers: CEO, body: { business: 'nextwave', video_id: id(1), tags: T } }); check('unknown business → 400', o.r.code === 400 && !o.writes.length); }
{ const o = await call({ headers: CEO, body: { business: 'silk_road_voices', video_id: 'bad id', tags: T } }); check('malformed video id → 400', o.r.code === 400 && !o.writes.length); }
{ const o = await call({ headers: CEO, body: { business: 'silk_road_voices', video_id: id(5), tags: T } }); check('ISOLATION: a Studio video cannot be tagged under Silk Road Voices (404, nothing written)', o.r.code === 404 && o.r.body.error === 'video_not_in_this_business' && !o.writes.length); }
{ const o = await call({ headers: CEO, body: { business: 'srv_studio', video_id: id(1), tags: T } }); check('ISOLATION: a Silk Road Voices video cannot be tagged under SRV Studio (404, nothing written)', o.r.code === 404 && !o.writes.length); }
{ const o = await call({ headers: CEO, body: { business: 'silk_road_voices', video_id: id(1), tags: { opening_visual: 'anything', intro_type: 7, genre: '<script>' } } }); check('values outside the fixed options are rejected (no valid fields → 400, nothing written)', o.r.code === 400 && o.r.body.error === 'no_valid_fields' && !o.writes.length); }
{ const o = await call({ headers: CEO, body: { business: 'silk_road_voices', video_id: id(1), tags: T } }); const d = JSON.parse(store.growth_tags_silk_road_voices);
  check('CEO tags a Silk Road Voices video: 200, one insert into growth_tags_silk_road_voices only (never packages), business-bound, validated, lower-cased text', o.r.code === 200 && o.writes.length === 1 && o.writes[0].k === 'growth_tags_silk_road_voices' && d.business === 'silk_road_voices' && d.videos[id(1)].opening_visual === 'avatar_close' && d.videos[id(1)].genre === 'deep house' && !o.reads.some((x) => /packages/.test(x)), [o.r.code, o.writes]); }
{ const o = await call({ headers: CEO, body: { business: 'silk_road_voices', video_id: id(1), tags: { intro_type: 'instrumental' } } }); const d = JSON.parse(store.growth_tags_silk_road_voices);
  check('a second tag on the same video updates in place (PATCH, compare-and-set) and keeps the earlier fields', o.r.code === 200 && o.writes[0].m === 'PATCH' && d.videos[id(1)].intro_type === 'instrumental' && d.videos[id(1)].opening_visual === 'avatar_close' && d.rev === 2); }
{ const o = await call({ headers: CEO, body: { business: 'srv_studio', video_id: id(5), tags: T } }); check('SRV Studio is stored in its own document; Silk Road Voices\' tags are untouched', o.r.code === 200 && o.writes[0].k === 'growth_tags_srv_studio' && !!store.growth_tags_silk_road_voices && !JSON.parse(store.growth_tags_srv_studio).videos[id(1)]); }
console.log = log; cleanup(); done();
