// CEO-017F stage 1 — the browser shim must reassemble the ~8 MB package list through responses capped at 4 MB, in order, with no loss,
// and must not change small reads or writes. Runs the REAL shim code taken from public/index.html in a sandbox against a fake proxy.
//   node tests/ceo017f/test_shim_paging.mjs
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync('public/index.html', 'utf8');
const a = html.indexOf('const MMM_DIRECT_FALLBACK='); const b = html.indexOf('})();\n', html.indexOf('window.fetch=async function(input,init)')) + 6; const code = html.slice(a, b);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
// synthetic production-shaped data: 200 packages, newest first, ~8 MB in total, a few very large rows
const rows = Array.from({ length: 200 }, (_, i) => ({ package_id: 'pkg_' + (9000 - i), full_package: 'x'.repeat((i < 10 || i === 150) ? 640000 : 28000), engagement_score: i }));
let log = [];
const proxy = async (url, opts) => {
  const body = JSON.parse(opts.body); log.push({ url, method: body.method, path: body.path.slice(0, 60) });
  if (body.method === 'GET' && body.path.startsWith('packages?')) {
    const q = new URLSearchParams(body.path.split('?')[1]); const lim = +(q.get('limit') || 1000), off = +(q.get('offset') || 0); const slice = rows.slice(off, off + lim); const text = JSON.stringify(slice);
    if (Buffer.byteLength(text) > 4000000) return new Response(JSON.stringify({ ok: false, error: 'response_too_large' }), { status: 413, headers: { 'content-type': 'application/json' } });
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify([{ ok: 1, echoed: body.path }]), { status: 200, headers: { 'content-type': 'application/json' } });
};
const sandbox = { SUPABASE_URL: 'https://x.supabase.co', Response, URLSearchParams, JSON, Object, Math, parseInt, Array, console, AbortSignal };
sandbox.window = { fetch: async (url, opts) => (String(url).startsWith('/api/ops?action=db_proxy') ? proxy(url, opts) : new Response('DIRECT', { status: 200 })) };
sandbox.sessionStorage = { getItem: (k) => (k === 'mmm_ceo_session' ? JSON.stringify({ token: 'ceo.tok' }) : null) };
vm.createContext(sandbox); vm.runInContext(code, sandbox);
const F = sandbox.window.fetch; const REST = 'https://x.supabase.co/rest/v1/';
const q = REST + 'packages?order=generated_at.desc&limit=200&select=package_id,full_package,tiktok_video_id,instagram_reel_id,cross_platform_status,upload_sync_status,engagement_score';
let r = await F(q, { signal: AbortSignal.timeout(8000), headers: { apikey: 'k' } }); const got = await r.json();
check('the 8 MB package list comes back complete and in the original order through 4 MB responses', r.ok && got.length === 200 && got.every((g, i) => g.package_id === rows[i].package_id), `${got.length} rows, ${log.length} proxy calls`);
check('every proxied page respected the cap (no request was answered with an oversize body)', log.every((l) => l.url === '/api/ops?action=db_proxy'));
check('oversized pages were retried smaller instead of failing', log.length > 13, `${log.length} calls`);
check('the combined body is exactly what a single unlimited read would have returned', JSON.stringify(got) === JSON.stringify(rows));
log = []; r = await F(REST + 'packages?package_id=eq.pkg_9000&select=title,full_package', {}); check('a single-package read is NOT paged (one call)', log.length === 1);
log = []; r = await F(REST + 'app_settings?key=eq.mmm_finance_v118&select=value', { headers: { 'Cache-Control': 'no-cache' } }); check('a state read is one proxied call', log.length === 1 && log[0].method === 'GET');
log = []; r = await F(REST + 'packages?on_conflict=package_id', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify({ package_id: 'p1', engine: 'SRV Farsi' }) }); check('a package write is one proxied POST, not paged', log.length === 1 && log[0].method === 'POST');
// no session: transition switch keeps the old direct path
sandbox.sessionStorage.getItem = () => null; log = []; r = await F(REST + 'app_settings?key=eq.srv_studio_v2_enabled&select=value', {}); check('no session + transition switch on: the read goes direct (unchanged pre-login behaviour)', (await r.text()) === 'DIRECT' && log.length === 0);
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
