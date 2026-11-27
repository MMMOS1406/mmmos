// G5 — growth_content_refresh through the REAL api/ops.js: CEO session only, reads only this business's packages and channel catalog, writes only growth_content_<business>. Fake world, SYNTHETIC data.
import { world, resetWorld, loadPair, cleanup, mkRes, json, signCeo, reporter } from '../g0safety/world.mjs';
const { check, done } = reporter();
const baseFetch = globalThis.fetch; let reads = [], writes = [], stored = {};
const id = (n) => 'V' + String(n).padStart(10, '0');
const PK = { 'SRV Farsi': [{ id: 1, engine: 'SRV Farsi', youtube_video_id: null, full_package: JSON.stringify({ youtubeVideoId: id(1), contentFormat: 'long', mood: 'romantic', vocal: 'female' }) }, { id: 2, engine: 'SRV Farsi', full_package: JSON.stringify({ youtubeVideoId: id(2), contentFormat: 'short' }) }],
  'SRV English': [{ id: 9, engine: 'SRV English', full_package: JSON.stringify({ srvProduction: { youtubeVideoId: id(5), kind: 'long' } }) }] };
const CAT = { UCCUa5BLzGh2eRBoqqWBCK_g: [1, 2, 3].map((n) => ({ video_id: id(n), title: 'T' + n, published_at: '2026-10-01T10:00:00Z', view_count: 5 })), UC0nzWQX6AaUqlF5FozNpWPg: [5, 6].map((n) => ({ video_id: id(n), title: 'S' + n, published_at: '2026-10-02T10:00:00Z', view_count: 7 })) };
globalThis.fetch = async (url, opt = {}) => { const u = String(url), m = (opt && opt.method) || 'GET';
  if (/\/rest\/v1\/youtube_videos\?/.test(u)) { reads.push(u); const ch = /channel_id=eq\.([A-Za-z0-9_-]+)/.exec(u); return json(ch && CAT[ch[1]] ? CAT[ch[1]] : []); }
  if (/\/rest\/v1\/packages\?/.test(u)) { reads.push(u); const e = decodeURIComponent((/engine=eq\.([^&]+)/.exec(u) || [])[1] || ''); const off = Number((/offset=(\d+)/.exec(u) || [])[1] || 0); return json(off === 0 ? (PK[e] || []) : []); }
  if (/\/rest\/v1\/app_settings\?key=eq\.growth_content_/.test(u) && m === 'GET') { const k = /key=eq\.(growth_content_\w+)/.exec(u)[1]; return json(stored[k] ? [{ key: k }] : []); }
  if (/\/rest\/v1\/app_settings/.test(u) && m !== 'GET' && /growth_content_/.test(u + (opt.body || ''))) { const b = opt.body ? JSON.parse(opt.body) : {}; const k = b.key || (/key=eq\.(growth_content_\w+)/.exec(u) || [])[1]; writes.push({ m, k, body: b }); stored[k] = b.value; return json([]); }
  return baseFetch(url, opt); };
const log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && /^(PASS|FAIL|\d+ passed)/.test(a[0])) log(...a); }; console.warn = () => {}; console.error = () => {};
resetWorld(); const ops = (await loadPair('ops.js', '7d3f81a')).cur.default;
const call = async ({ method = 'POST', headers = {}, body = {}, query = { action: 'growth_content_refresh' } } = {}) => { reads = []; writes = []; const r = mkRes(); await ops({ method, headers: { host: 'app.test', origin: 'https://mmm-static.vercel.app', ...headers }, query, body: method === 'POST' ? body : null }, r); return { r, reads: reads.slice(), writes: writes.slice() }; };
const CEO = { 'x-mmm-ceo-session': signCeo() };
{ const o = await call({ body: { business: 'silk_road_voices' } }); check('no session → 401 and nothing is read or written', o.r.code === 401 && o.reads.length === 0 && o.writes.length === 0, o.r.code); }
{ const o = await call({ headers: { 'x-mmm-ceo-session': 'garbage' }, body: { business: 'silk_road_voices' } }); check('forged/garbage session → 401, nothing read or written', o.r.code === 401 && o.reads.length === 0 && o.writes.length === 0); }
{ const o = await call({ method: 'GET', headers: CEO }); check('GET → 405', o.r.code === 405 && o.writes.length === 0); }
{ const o = await call({ headers: CEO, body: { business: 'nextwave' } }); check('unknown business → 400, nothing read or written', o.r.code === 400 && o.reads.length === 0 && o.writes.length === 0); }
{ const o = await call({ headers: CEO, body: { business: 'silk_road_voices' } });
  check('CEO refresh of Silk Road Voices answers 200 with the linkage counts (2 of 3 catalog videos linked)', o.r.code === 200 && o.r.body.ok && o.r.body.results[0].linked === 2 && o.r.body.results[0].catalog_videos === 3, o.r.body);
  check('it reads only SRV Farsi packages and only the Silk Road Voices channel catalog (no SRV English, no other channel)', o.reads.filter((x) => /packages\?/.test(x)).every((x) => /engine=eq\.SRV%20Farsi|engine=eq\.SRV Farsi/.test(x)) && o.reads.filter((x) => /youtube_videos\?/.test(x)).every((x) => /UCCUa5BLzGh2eRBoqqWBCK_g/.test(x)) && !o.reads.some((x) => /SRV%20English|SRV English|UC0nzWQX6AaUqlF5FozNpWPg/.test(x)), o.reads);
  check('it writes exactly one row: its own growth_content_silk_road_voices key, bound to the business, features only', o.writes.length === 1 && o.writes[0].k === 'growth_content_silk_road_voices' && JSON.parse(o.writes[0].body.value).business === 'silk_road_voices' && !/sunoPrompt|lyrics|caption/i.test(o.writes[0].body.value), o.writes.map((w) => w.k)); }
{ const o = await call({ headers: CEO, body: { business: 'srv_studio' } });
  check('SRV Studio refresh: SRV English packages and the Studio catalog only; links the production video id as a Long; writes only growth_content_srv_studio', o.r.code === 200 && o.r.body.results[0].linked === 1 && o.writes.length === 1 && o.writes[0].k === 'growth_content_srv_studio' && JSON.parse(o.writes[0].body.value).videos[id(5)].role === 'long' && !o.reads.some((x) => /SRV%20Farsi|SRV Farsi|UCCUa5BLzGh2eRBoqqWBCK_g/.test(x)), o.reads); }
{ const o = await call({ headers: CEO, body: {} }); check('no business named → both refreshed, still only the two content keys written', o.r.code === 200 && o.r.body.results.length === 2 && o.writes.every((w) => /^growth_content_(silk_road_voices|srv_studio)$/.test(w.k)) && o.writes.length === 2); }
{ const o = await call({ headers: CEO, body: { business: 'silk_road_voices' } }); check('a second refresh updates the existing row (PATCH) instead of inserting a duplicate', o.writes.length === 1 && o.writes[0].m === 'PATCH', o.writes.map((w) => w.m)); }
console.log = log; cleanup(); done();
