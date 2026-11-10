// CEO-017 — server-side proof for the AI Creation Studio removal (isolated branch). Loads the REAL api/ops.js of this branch AND of origin/main against ONE fake world.
// No network, no credentials, nothing is written anywhere. node tests/ceo017/test_ai_studio_retirement.mjs
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { pathToFileURL } from 'node:url'; import { createHmac } from 'node:crypto';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); process.chdir(repo);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const SECRET = 'test-session-secret';
const signCeo = () => { const p = Buffer.from(JSON.stringify({ sub: 'ceo', exp: Date.now() + 3600e3 })).toString('base64url'); return `${p}.${createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
const world = { calls: [], anthropic: [] };
const json = (o, status = 200) => ({ ok: status < 400, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) }, json: async () => o, text: async () => JSON.stringify(o) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); world.calls.push(u.replace(/^https?:\/\/[^/]+/, '').split('?')[0]);
  if (u.includes('/rest/v1/ceo_auth_config')) return json(/operator_pin_hash/.test(u) ? [{ key: 'operator_pin_hash_production', value: 'f'.repeat(64) }, { key: 'publish_auth_mode', value: 'enforce' }] : [{ key: 'ceo_session_secret_production', value: SECRET }, { key: 'ceo_pin_hash_production', value: 'f'.repeat(64) }]);
  if (u.startsWith('https://api.anthropic.com')) { world.anthropic.push(JSON.parse(opts.body)); return json({ content: [{ type: 'text', text: '<package>{"title":"T","concept":"c","mood":"m","hook":"h"}</package>' }], stop_reason: 'end_turn' }); }
  if (u.includes('/rest/v1/')) return json([]);
  return json({}, 404);
};
process.env.SUPABASE_URL = 'https://supabase.test'; process.env.SUPABASE_SERVICE_KEY = 'svc-test'; process.env.ANTHROPIC_API_KEY = 'sk-test';
const mkRes = () => ({ code: 200, body: null, headers: {}, setHeader() {}, removeHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end(b) { this.raw = b; return this; } });
const call = async (mod, action, body, method = 'POST') => { const res = mkRes(); await mod.default({ method, query: { action }, headers: { origin: 'https://mmm-static.vercel.app' }, body: { ...body, ceo_session_token: signCeo() } }, res); return res; };
const load = async (file) => import(pathToFileURL(file).href + '?t=' + Math.random());
const baselineFile = path.join(repo, 'api', '.ops_baseline_ceo017.js');
try {
  fs.writeFileSync(baselineFile, execFileSync('git', ['show', 'origin/main:api/ops.js'], { maxBuffer: 256 * 1024 * 1024 }));
  const base = await load(baselineFile), cur = await load(path.join(repo, 'api', 'ops.js'));
  /* A. retained businesses: the model request (prompt + parameters) is byte-identical to main */
  for (const [engineId, mode, fmt] of [['srv_farsi', 'Romantic', 'short'], ['srv_farsi', 'Romantic', 'long'], ['srv_english', 'Love', 'short'], ['nextwave', 'Finance', 'short'], ['nextwave', 'Finance', 'long']]) {
    world.anthropic = []; const rb = await call(base, 'generate_package', { engineId, mode, contentFormat: fmt, existingMemory: [] }); const bodyB = JSON.stringify(world.anthropic);
    world.anthropic = []; const rc = await call(cur, 'generate_package', { engineId, mode, contentFormat: fmt, existingMemory: [] }); const bodyC = JSON.stringify(world.anthropic);
    check(`generate_package ${engineId}/${fmt}: model request identical to main`, bodyB === bodyC && bodyB.length > 200 && rb.code === rc.code, `${bodyB.length} bytes, status ${rb.code}/${rc.code}`);
  }
  /* B. the retired engine fails closed */
  world.anthropic = []; const old = await call(base, 'generate_package', { engineId: 'ai_studio', mode: 'AI Tools', contentFormat: 'short', existingMemory: [] });
  check('baseline (main) still generates for ai_studio — the removal is what changes this', old.code === 200 && world.anthropic.length === 1);
  world.anthropic = []; const gone = await call(cur, 'generate_package', { engineId: 'ai_studio', mode: 'AI Tools', contentFormat: 'short', existingMemory: [] });
  check('branch: generate_package ai_studio -> 410 engine_retired, no model call', gone.code === 410 && gone.body.error === 'engine_retired' && world.anthropic.length === 0);
  /* C. other entry points */
  const up = await call(cur, 'youtube_upload_video', { engine: 'AI Studio', videoUrl: 'https://supabase.test/storage/v1/object/public/srv-assets/x/y.mp4', title: 't' });
  check('branch: youtube_upload_video engine "AI Studio" -> refused (no engine mapping), nothing sent to YouTube', up.code === 400 && up.body && up.body.error === 'no_engine_mapping' && !world.calls.some((c) => /googleapis/.test(c)), JSON.stringify(up.body).slice(0, 90));
  const upB = await call(base, 'youtube_upload_video', { engine: 'AI Studio', videoUrl: 'https://supabase.test/storage/v1/object/public/srv-assets/x/y.mp4', title: 't' });
  check('baseline: the same call is NOT refused at the mapping step', !(upB.body && upB.body.error === 'no_engine_mapping'), JSON.stringify(upB.body).slice(0, 90));
  const ttB = await call(base, 'tiktok_publish_draft', { engine: 'SRV Farsi', videoUrl: 'https://supabase.test/x.mp4', title: 't' }), ttC = await call(cur, 'tiktok_publish_draft', { engine: 'SRV Farsi', videoUrl: 'https://supabase.test/x.mp4', title: 't' });
  check('tiktok_publish_draft SRV Farsi answers exactly as main (publishing stays under the existing freeze)', JSON.stringify(ttB.body) === JSON.stringify(ttC.body), JSON.stringify(ttC.body).slice(0, 80));
  const amb = await call(cur, 'ambient_music', {}, 'GET'); const ambB = await call(base, 'ambient_music', {}, 'GET');
  check('ambient_music (AI Studio-only WAV generator) is gone; main still serves it', Buffer.isBuffer(ambB.raw) && ambB.raw.length > 1000 && !Buffer.isBuffer(amb.raw), `main ${ambB.raw && ambB.raw.length} bytes, branch ${amb.raw ? 'bytes' : JSON.stringify(amb.body).slice(0, 60)}`);
  const hc = await call(cur, 'health_check', {}, 'GET'); const hcB = await call(base, 'health_check', {}, 'GET');
  const engs = (r) => Object.keys((r.body && r.body.engines) || {}).sort().join(',');
  check('health_check lists exactly the three retained businesses', engs(hc) === 'nextwave,srv_english,srv_farsi' && /ai_studio/.test(engs(hcB)), `main: ${engs(hcB)} | branch: ${engs(hc)}`);
  /* D. source-level guarantees */
  const src = fs.readFileSync('api/ops.js', 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n').replace("if (engineId === 'ai_studio') return res.status(410)", '');
  check('no engine list, map key or comparison in api/ops.js still names AI Studio / ai_studio', !/\[[^\]\n]*['"](AI Studio|ai_studio)['"][^\]\n]*\]/.test(code) && !/['"](AI Studio|AI Creation Studio)['"]\s*:/.test(code) && !/[=!]==\s*['"](AI Studio|ai_studio)['"]/.test(code), '');
} finally { try { fs.unlinkSync(baselineFile); } catch {} }
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
