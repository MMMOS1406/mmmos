// SRV Studio V2 Checkpoint B — 10 sample generations through the branch's REAL generator code
// (7 via the api/generate.js handler, 3 via the api/ops.js generatePackage function).
//   Live:     ANTHROPIC_API_KEY=... node tests/srv/studio-v2-samples/run-samples.mjs OUT.json
//   Offline:  node tests/srv/studio-v2-samples/run-samples.mjs OUT.json --authored
//             (replays the sample replies in tests/srv/studio-v2-preview/v2-samples.mjs in place of the model)
// Only api.anthropic.com is reached (live mode). The flag check is answered locally (ON); any other
// request is refused. No database is touched. The avoid list is a read-only snapshot of the SRV English
// generation memory (srv-english-memory-snapshot.json).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const OUT = process.argv[2];
if (!process.argv.includes('--authored') && !process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY, or pass --authored for the offline replay.'); process.exit(2); }
if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = 'offline-replay';
process.env.SUPABASE_URL = 'https://isolated-flag-stub.invalid'; process.env.SUPABASE_SERVICE_KEY = 'stub';
const realFetch = globalThis.fetch;
const AUTHORED_MODE = process.argv.includes('--authored');
const { V2_SAMPLE_REPLIES: AUTHORED } = AUTHORED_MODE ? await import('../studio-v2-preview/v2-samples.mjs') : { V2_SAMPLE_REPLIES: [] };
let authoredIdx = 0; const modelRequests = [];
const hosts = [];
globalThis.fetch = async (url, opt) => {
  const u = new URL(String(url)); hosts.push(u.host);
  if (u.host === 'isolated-flag-stub.invalid') return { ok: true, json: async () => [{ value: 'true' }] };
  if (u.host === 'api.anthropic.com') {
    const b = JSON.parse(opt.body); modelRequests.push({ model: b.model, system: (b.system || '').slice(0, 60), user: b.messages[0].content });
    if (!AUTHORED_MODE) return realFetch(url, opt);
    const reply = JSON.stringify(AUTHORED[authoredIdx++]);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: reply }] }) };
  }
  throw new Error('blocked request to ' + u.host);
};
const M = await import(path.join(REPO, 'lib/srvStudioV2Music.mjs'));
const { default: genHandler } = await import(path.join(REPO, 'api/generate.js'));
// /api/ops generate_package: run the real function body (the file's ffmpeg/canvas imports are not needed for it)
const OPS = fs.readFileSync(path.join(REPO, 'api/ops.js'), 'utf8');
const s = OPS.indexOf('\nasync function generatePackage(') + 1; const fnSrc = OPS.slice(s, OPS.indexOf('\n}\n', s) + 2);
const ctx = { console: { log() {}, warn() {}, error() {} }, process, AbortController, setTimeout, clearTimeout, fetch: globalThis.fetch, JSON, Date, Math, Object, Array, String, Number, Set, Promise, RegExp, Error,
  SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY: 'stub', srvStudioV2FlagEnabled: M.srvStudioV2FlagEnabled, SRV_STUDIO_V2_SYSTEM: M.SRV_STUDIO_V2_SYSTEM, buildSrvStudioV2UserPrompt: M.buildSrvStudioV2UserPrompt, finalizeSrvStudioV2Package: M.finalizeSrvStudioV2Package };
vm.createContext(ctx); vm.runInContext(fnSrc + '\nthis.generatePackage=generatePackage;', ctx);

const mem = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'srv-english-memory-snapshot.json'), 'utf8'));
const generated = [];
const plan = [
  ['generate', 'short', 'Female — Romantic'], ['generate', 'long', 'Female — Emotional'], ['generate', 'short', 'Female — Happy'],
  ['generate', 'long', 'Female — Romantic'], ['generate', 'short', 'Female — Emotional'], ['generate', 'long', 'Female — Happy'],
  ['generate', 'short', 'Female — Romantic'], ['ops', 'long', 'Female — Emotional'], ['ops', 'short', 'Female — Emotional'], ['ops', 'long', 'Female — Romantic'],
];
const results = [];
for (let i = 0; i < plan.length; i++) {
  const [route, format, mode] = plan[i];
  const t0 = Date.now(); let pkg = null, err = null;
  try {
    if (route === 'generate') {
      const recentPackages = mem.titles.map((t, k) => ({ title: t, mood: '?', vocal: 'female', concept: mem.concepts[k] || '', hook: mem.hooks[k] || '' }))
        .concat(generated.map((g) => ({ title: g.title, mood: g.mood, vocal: 'female', concept: g.concept, hook: g.hook })));
      let code = 0, json = null; const res = { setHeader() {}, status(c) { code = c; return this; }, json(j) { json = j; return this; }, end() { return this; } };
      M._resetSrvStudioV2FlagCache();
      await genHandler({ method: 'POST', body: { engine: 'SRV English', mood: mode, contentType: format === 'long' ? 'Long' : 'Short Video', contentFormat: format, taskName: `Checkpoint B sample ${i + 1}`, recentPackages, srvStudioV2: true } }, res);
      if (!json || !json.success) throw new Error(JSON.stringify(json).slice(0, 300));
      pkg = json.package;
    } else {
      const existingMemory = [...mem.titles.map((v) => ({ type: 'title', value: v })), ...mem.concepts.map((v) => ({ type: 'concept', value: v })), ...mem.hooks.map((v) => ({ type: 'hook', value: v })),
        ...generated.flatMap((g) => [{ type: 'title', value: g.title }, { type: 'concept', value: g.concept }, { type: 'hook', value: g.hook }])];
      let json = null; const res = { status() { return this; }, json(j) { json = j; return this; } };
      M._resetSrvStudioV2FlagCache();
      await ctx.generatePackage({ method: 'POST', body: { engineId: 'srv_english', mode, existingMemory, contentFormat: format, srvStudioV2: true } }, res);
      if (!json || !json.success) throw new Error(JSON.stringify(json).slice(0, 300));
      pkg = json.package;
    }
  } catch (e) { err = e.message; }
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  if (pkg) {
    const recentTitles = mem.titles.concat(generated.map((g) => g.title));
    const validation = M.srv2ValidatePackage(pkg, { isLong: format === 'long', recentTitles });
    generated.push(pkg);
    results.push({ n: i + 1, route, format, mode, secs, pkg, validation });
    console.log(`#${i + 1} ${route} ${format} ${mode} ${secs}s → "${pkg.title}" score ${validation.score} ${validation.checks.filter((c) => c.status !== 'pass').map((c) => c.id + ':' + c.status).join(',')}`);
  } else { results.push({ n: i + 1, route, format, mode, secs, error: err }); console.log(`#${i + 1} ${route} ${format} ERROR ${err}`); }
  fs.writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), source: AUTHORED_MODE ? 'model replies authored by Claude Code following the V2 prompt (no valid API key on this Mac); processed by the real generator code' : 'live Anthropic API', hosts: [...new Set(hosts)], results, modelRequests }, null, 2));
}
console.log('hosts contacted:', [...new Set(hosts)].join(', '));
