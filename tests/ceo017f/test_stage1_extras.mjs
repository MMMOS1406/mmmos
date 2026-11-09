// CEO-017F stage 1 — session token never travels in a URL; header form works; older body/query forms still work; the page never builds a token URL.
//   node tests/ceo017f/test_stage1_extras.mjs
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; import { createHmac, createHash } from 'node:crypto';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); process.chdir(repo);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const html = fs.readFileSync('public/index.html', 'utf8');
check('the page builds no URL containing a session token (no "session_token=" in any URL string)', !/[?&](ceo|operator|family)_session_token=/.test(html) && !/session_token='\s*\+/.test(html));
check('the three Social Media Manager reads send the CEO session in a header', ['ceo_review_queue_list', 'sm_asset_gap_report', 'sm_content_asset_list'].every((a) => new RegExp(`action=${a}&businessId='\\+encodeURIComponent\\(businessId\\),\\{headers:\\{'X-MMM-CEO-Session'`).test(html)));
check('uploads send no upsert header (new files only; required before the storage lockdown)', !/'x-upsert'\s*:\s*'true'/.test(html));
check('the proxy call itself has a fixed URL (tokens go in the body)', /realFetch\('\/api\/ops\?action=db_proxy',\{method:'POST'/.test(html));
const SECRET = 'st1-secret'; const H = (s) => createHash('sha256').update(s).digest('hex');
const cfg = new Map([['ceo_session_secret_production', SECRET], ['ceo_pin_hash_production', H('st1-ceo')], ['operator_pin_hash_production', H('st1-va')]]);
const json = (o, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => o, text: async () => JSON.stringify(o) });
globalThis.fetch = async (url) => { const u = String(url); if (u.includes('/rest/v1/ceo_auth_config')) { const m = /key=in\.\(([^)]*)\)/.exec(u), e = /key=eq\.([^&]+)/.exec(u); const ks = m ? m[1].split(',') : e ? [decodeURIComponent(e[1])] : []; return json(ks.filter((k) => cfg.has(k)).map((k) => ({ key: k, value: cfg.get(k) }))); } return json([]); };
process.env.SUPABASE_URL = 'https://s.test'; process.env.SUPABASE_SERVICE_KEY = 'k';
const mod = await import(pathToFileURL(path.join(repo, 'api', 'ops.js')).href + '?s1');
const get = async (action, query, headers = {}) => { const r = { code: 200, body: null, setHeader() {}, removeHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } }; await mod.default({ method: 'GET', query: { action, ...query }, headers: { origin: 'https://mmm-static.vercel.app', ...headers } }, r); return r; };
const sign = (o) => { const p = Buffer.from(JSON.stringify({ ...o, exp: Date.now() + 36e5 })).toString('base64url'); return p + '.' + createHmac('sha256', SECRET).update(p).digest('base64url'); };
const ceo = sign({ sub: 'ceo' });
let r = await get('ceo_review_queue_list', { businessId: 'b1' }); check('no token -> 401', r.code === 401);
r = await get('ceo_review_queue_list', { businessId: 'b1' }, { 'x-mmm-ceo-session': ceo }); check('CEO token in the header -> accepted', r.code === 200 && r.body.ok === true);
r = await get('ceo_review_queue_list', { businessId: 'b1' }, { 'x-mmm-ceo-session': ceo.slice(0, -3) + 'AAA' }); check('forged header token -> 401', r.code === 401);
r = await get('ceo_review_queue_list', { businessId: 'b1' }, { 'x-mmm-ceo-session': sign({ sub: 'operator', pv: 'x' }) }); check('a non-CEO token in the CEO header -> 401', r.code === 401);
r = await get('ceo_review_queue_list', { businessId: 'b1', ceo_session_token: ceo }); check('older tabs: token in the query string still accepted (until the strict switch)', r.code === 200);
r = await get('sm_content_asset_list', { businessId: 'b1' }, { 'x-mmm-ceo-session': ceo }); check('sm_content_asset_list with header token works', r.code === 200 && r.body.ok === true);
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
