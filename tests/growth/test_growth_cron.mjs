// The daily cron hook for scheduled collection: the REAL autosync handler with stubbed fetch/env. Default = zero effect. node tests/growth/test_growth_cron.mjs
import fs from 'node:fs'; import { createHash } from 'node:crypto';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 300) : ''); } };
process.env.SUPABASE_SERVICE_KEY = 'KEY-FOR-TEST'; process.env.SUPABASE_URL = 'https://db.test'; process.env.APP_URL = 'https://app.test'; delete process.env.CRON_SECRET;
const calls = []; let growthResponse = { ok: true, results: [{ business: 'silk_road_voices', skipped: 'collection_not_authorized' }] }, growthThrows = false;
import { lockFetch, lockRows } from '../g1security/lockFake.mjs';   // G1: the single-flight lock's own database calls are answered by a faithful model
globalThis.fetch = async (url, init) => { url = String(url); const _lk = lockFetch(url, init); if (_lk) return _lk; calls.push({ url, headers: (init && init.headers) || {} });
  if (url.startsWith('https://db.test/rest/v1/youtube_connections')) return { ok: true, status: 200, json: async () => [{ channel_id: 'UCone' }] };
  if (url.startsWith('https://db.test/rest/v1/')) return { ok: true, status: 200, json: async () => [] };
  if (url.includes('/api/youtube/sync')) return { ok: true, status: 200, json: async () => ({ success: true }) };
  if (url.includes('action=analytics_auto_run')) return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
  if (url.includes('action=growth_collect_scheduled')) { if (growthThrows) throw new Error('boom'); return { ok: true, status: 200, json: async () => growthResponse }; }
  return { ok: true, status: 200, json: async () => ({ success: true }) }; };
const { default: handler } = await import('../../api/youtube/autosync.js?t=1');
const run = async () => { for (const k of Object.keys(lockRows)) delete lockRows[k]; const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(x) { res.body = x; return res; } }; await handler({ method: 'GET', headers: { host: 'app.test' } }, res); return res; };
const r = await run(); const g = calls.filter((c) => c.url.includes('growth_collect_scheduled'));
ok('the existing daily steps still run and the response keeps its fields', r.code === 200 && r.body.succeeded === 1 && r.body.analyticsAuto && 'tiktokAuto' in r.body);
ok('the growth hook is called exactly once, AFTER the existing steps, with the derived signature (no new credential)', g.length === 1 && calls.indexOf(g[0]) > calls.findIndex((c) => c.url.includes('analytics_auto_run')) && g[0].headers['x-mmm-cron'] === createHash('sha256').update('growth_collect:KEY-FOR-TEST').digest('hex'));
ok('default: the hook reports every business skipped (the action does nothing unless schedule is switched on) and the cron result carries it', r.body.growthAuto.results.every((x) => x.skipped));
growthThrows = true; calls.length = 0; const r2 = await run();
ok('a failure of the growth hook can never fail the cron: the response is still 200 with the earlier results', r2.code === 200 && r2.body.succeeded === 1 && r2.body.growthAuto.ok === false);
const src = fs.readFileSync(new URL('../../api/youtube/autosync.js', import.meta.url), 'utf8');
ok('the hook is the LAST step before the response and has a 150-second ceiling', src.indexOf('growth_collect_scheduled') > src.indexOf('syncAllTikTokAccounts(appUrl)') && /AbortSignal\.timeout\(150000\)/.test(src));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
