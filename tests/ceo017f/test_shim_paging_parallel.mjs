// Release 1 — the data-proxy shim now fetches the package list's pages with limited parallelism. This proves, on the REAL shim code from public/index.html against a fake proxy
// with random per-page latency, that the reassembled result is IDENTICAL to a single unlimited read in every edge case, and that concurrency stays <= 4.
//   node tests/ceo017f/test_shim_paging_parallel.mjs [public/index.html]      (run on main too: every equivalence check must pass there as well; only the concurrency check differs)
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(process.argv[2] || 'public/index.html', 'utf8');
const a = html.indexOf('const MMM_DIRECT_FALLBACK='); const b = html.indexOf('})();\n', html.indexOf('window.fetch=async function(input,init)')) + 6; const code = html.slice(a, b);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const mk = (n, big = 0) => Array.from({ length: n }, (_, i) => ({ package_id: 'pkg_' + (9000 - i), full_package: 'x'.repeat(i < big ? 700000 : 5000), engagement_score: i }));
async function run({ rows, fail = null, cap = 4000000, jitter = true, firstJson = null, signal = undefined }) {
  let inflight = 0, maxIn = 0, calls = 0; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const proxy = async (url, opts) => {
    const body = JSON.parse(opts.body); inflight++; maxIn = Math.max(maxIn, inflight); calls++;
    try {
      await new Promise((res, rej) => { const t = setTimeout(res, jitter ? 2 + Math.random() * 40 : 1); if (opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); }); });
      const q = new URLSearchParams(body.path.split('?')[1]); const lim = +(q.get('limit') || 1000), off = +(q.get('offset') || 0);
      if (fail && fail.offset === off) return new Response(JSON.stringify({ ok: false, error: fail.error }), { status: fail.status, headers: { 'content-type': 'application/json' } });
      if (firstJson && off === 0) return new Response(JSON.stringify(firstJson), { status: 200, headers: { 'content-type': 'application/json' } });
      const text = JSON.stringify(rows.slice(off, off + lim));
      if (Buffer.byteLength(text) > cap) return new Response(JSON.stringify({ ok: false, error: 'response_too_large' }), { status: 413, headers: { 'content-type': 'application/json' } });
      return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
    } finally { inflight--; }
  };
  const sandbox = { SUPABASE_URL: 'https://x.supabase.co', Response, URLSearchParams, JSON, Object, Math, parseInt, Array, console, AbortSignal, DOMException, setTimeout, clearTimeout, Promise, Infinity };
  sandbox.window = { fetch: async (url, opts) => (String(url).startsWith('/api/ops?action=db_proxy') ? proxy(url, opts) : new Response('DIRECT', { status: 200 })) };
  sandbox.sessionStorage = { getItem: (k) => (k === 'mmm_operator_session' ? JSON.stringify({ token: 'op.tok' }) : null) };
  vm.createContext(sandbox); vm.runInContext(code, sandbox);
  const q = 'https://x.supabase.co/rest/v1/packages?order=generated_at.desc&limit=200&select=package_id,full_package,tiktok_video_id,instagram_reel_id,cross_platform_status,upload_sync_status,engagement_score';
  let res, err = null; try { res = await sandbox.window.fetch(q, { signal, headers: { apikey: 'k' } }); } catch (e) { err = e; }
  return { res, err, maxIn, calls };
}
const same = (got, rows) => JSON.stringify(got) === JSON.stringify(rows);
let o = await run({ rows: mk(200, 10) }); let got = await o.res.json();
check('200 packages (10 oversized rows) with random per-page latency: complete, original order, byte-identical to one unlimited read', o.res.ok && same(got, mk(200, 10)), `${got.length} rows, ${o.calls} calls`);
check('concurrency never exceeds 4 pages in flight (and parallelism is actually used)', o.maxIn <= 4 && o.maxIn >= 2, 'max in flight ' + o.maxIn + ' (main = 1)');
for (const n of [0, 1, 15, 16, 17, 32, 37, 199]) { o = await run({ rows: mk(n) }); got = await o.res.json(); check(`table with ${n} rows (limit 200): exactly those ${n} rows, in order, no duplicates, no extras`, o.res.ok && same(got, mk(n))); }
o = await run({ rows: mk(200, 10), cap: 1500000 }); got = await o.res.json(); check('pages answered 413 are halved until they fit (cap 1.5 MB, 700 KB rows): still complete and identical', o.res.ok && same(got, mk(200, 10)), `${o.calls} calls`);
o = await run({ rows: mk(200), fail: { offset: 48, status: 500, error: 'server_error' } }); check('a failing page (HTTP 500) returns that failure to the caller — never a silently partial list', o.res && o.res.status === 500);
o = await run({ rows: mk(200), fail: { offset: 0, status: 401, error: 'no_session' } }); check('a refused first page (401) is returned unchanged', o.res && o.res.status === 401);
o = await run({ rows: mk(200), firstJson: { error: 'weird' } }); got = o.res && (await o.res.json()); check('a non-array answer is passed through as is (as before)', o.res && o.res.status === 200 && got && got.error === 'weird');
const ac = new AbortController(); setTimeout(() => ac.abort(), 60); o = await run({ rows: mk(200), signal: ac.signal, jitter: true }); check('an abort of the caller\'s signal rejects the whole read (the loader then returns [] as before)', !!o.err || (o.res && !o.res.ok), o.err ? o.err.name : 'no error');
console.log(`\n${R.length} checks, ${R.filter((x) => !x).length} failed`); process.exit(R.some((x) => !x) ? 1 : 0);
