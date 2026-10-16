// SRV Studio V2 — Checkpoint B (order SRV-STUDIO-V2-003): music identity, both generator paths,
// deterministic quality validator, flag gating, header status. Offline: every network call is mocked.
// Run: node tests/srv/test_srv_studio_v2_music.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as M from '../../lib/srvStudioV2Music.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
const H = read('public/index.html'), OPS = read('api/ops.js'), GEN = read('api/generate.js'), LIB = read('lib/srvStudioV2Music.mjs');
const base = (f) => execSync(`git show origin/main:${f}`, { cwd: repo, maxBuffer: 64 << 20 }).toString('utf8');
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const top = (src, name) => { const m = src.match(new RegExp('\\n(async )?function ' + name + '\\(')); if (!m) throw new Error('missing ' + name); const s = m.index + 1; return src.slice(s, src.indexOf('\n}\n', s) + 2); };

const GOOD = {
  title: 'Hold Me Through the Exit Signs', hook: 'Hold me through the exit signs', bpm: 119, concept: 'She asks him to stay one more mile before they part', styleNotes: 'glassy pads, warm tape hiss, distant siren swells',
  lyrics: "[Intro]\n[Verse 1]\nHold me through the exit signs\nYour hand is shaking on the wheel\nWe said this was the last time\nBut the highway knows the deal\n[Pre-Chorus]\nDon't turn the radio down\nDon't let the silence in\n[Chorus]\nHold me through the exit signs\nTill the city lets us go\nIf we keep on driving\nWe never have to know\n[Verse 2]\nTwo coffees going cold\nYour jacket on my knees\nEvery mile you don't say it\nIs a mile I still believe\n[Pre-Chorus]\nDon't turn the radio down\nDon't let the silence in\n[Chorus]\nHold me through the exit signs\nTill the city lets us go\nIf we keep on driving\nWe never have to know\n[Bridge]\nMaybe morning ends it\nMaybe morning doesn't come\n[Final Chorus]\nHold me through the exit signs\nTill the city lets us go\nIf we keep on driving\nWe never have to know\n[Outro]",
  shortLyrics: 'Hold me through the exit signs\nTill the city lets us go\nIf we keep on driving\nWe never have to know',
  captionYouTube: 'Hold me through the exit signs\nA song about one more mile.\nListen now.\n#SRVStudio #DeepHouse', hashtags: '#SRVStudio #DeepHouse #NightDrive', vocal: 'female',
};
const fin = (raw, isLong, recentTitles = []) => M.finalizeSrvStudioV2Package(raw, { isLong, mode: 'Female — Emotional', recentTitles });
const status = (v, id) => (v.checks.find((c) => c.id === id) || {}).status;

// ── 1. Music identity in the prompts ──
const sys = M.SRV_STUDIO_V2_SYSTEM;
ok('Identity: English, adult female lead, Emotional Deep House / Night Drive stated', /English only/.test(sys) && /adult female lead vocalist/.test(sys) && /Emotional Deep House with a Night Drive atmosphere/.test(sys));
ok('Identity: never male, never duet/feature, never teenage or childlike', /Never male\. Never a duet or a feature\. Never teenage or childlike/.test(sys));
ok('Identity: no cinematic-pop default and no artist references in the V2 prompts', !/cinematic pop/i.test(sys + M.SRV_STUDIO_V2_STYLE_CORE) && M.SRV_STUDIO_V2_ARTIST_NAMES.every((n) => !(sys + M.SRV_STUDIO_V2_STYLE_CORE).includes(n)));
ok('Identity: imitation of real artists/songs is forbidden', /Never name, quote or imitate a real artist, band or existing song/.test(sys));
ok('Songwriting: hook-first, repeated chorus phrase, one-breath lines, cliché list, story', /first sung line is the strongest/.test(sys) && /chorus repeats ONE memorable phrase/.test(sys) && /singable in one breath/.test(sys) && /Avoid clichés/.test(sys) && /Each verse moves the story forward/.test(sys));
ok('Arrangements: LONG full structure and SHORT 30s standalone both defined', /LONG \(full release/.test(sys) && /\[Bridge\]/.test(sys) && /SHORT \(standalone 30 seconds\)/.test(sys));
const up = M.buildSrvStudioV2UserPrompt({ isLong: false, mode: 'Female — Romantic', avoidText: 'PRIOR TITLES: "Stay Until the Sunrise"' });
ok('User prompt: carries the format, mood colour and the existing avoid list (anti-repetition kept)', /SHORT \(30-second standalone\)/.test(up) && /Romantic — warm, yearning/.test(up) && /Stay Until the Sunrise/.test(up));
ok('Checkpoint C: Romantic / Melancholic / Hopeful are emotional variations; the genre never changes', /Emotional variations: each song is Romantic, Melancholic or Hopeful/.test(sys) && /The genre stays Emotional Deep House \/ Night Drive/.test(up) && M.SRV_STUDIO_V2_MOODS.emotional.label === 'Melancholic' && M.SRV_STUDIO_V2_MOODS.happy.label === 'Hopeful' && Object.values(M.SRV_STUDIO_V2_MOODS).every((m) => m.bpm[0] >= 112 && m.bpm[1] <= 126));

// ── 2. System-owned Suno prompts ──
for (const fmt of ['long', 'short']) {
  const sp = M.buildSrvStudioV2SunoPrompt({ format: fmt, bpm: 140, moodKey: 'emotional', notes: 'male choir, duet ad-libs, Kygo style plucks, teenage energy, in the style of Lane 8, glassy pads, 128 bpm' });
  ok(`Suno ${fmt}: female lead, deep house, night drive, English`, /female lead vocal/.test(sp) && /emotional deep house/.test(sp) && /night drive/.test(sp) && /English lyrics/.test(sp));
  ok(`Suno ${fmt}: BPM clamped into the mood's deep house range`, /\b120 BPM\b/.test(sp) && !/140|128/.test(sp));
  ok(`Suno ${fmt}: male/duet/teen/artist/imitation words stripped from model notes`, !/\b(male|duet|teenage|Kygo|Lane 8|style of)\b/i.test(sp.replace('female', '')) && /glassy pads/.test(sp));
  ok(`Suno ${fmt}: arrangement tail`, fmt === 'short' ? /0:30 runtime, vocal starts at 0:00/.test(sp) : /3:00-3:30 runtime/.test(sp));
}
ok('Suno notes: an off-identity note is dropped whole, never left half-sentence', M.cleanSrvStudioV2StyleNotes('detuned pad wash, lonely synth lead answering the vocal') === 'detuned pad wash');
ok('Mood mapping: Romantic/Emotional/Happy → colour and tempo inside deep house', M.srvStudioV2MoodKey('Female — Happy') === 'happy' && M.clampSrvStudioV2Bpm(100, 'happy') === 120 && M.clampSrvStudioV2Bpm(130, 'romantic') === 122);

// ── 3. Validator ──
{
  const L = fin(GOOD, true).validation, S = fin(GOOD, false).validation;
  ok('Validator: a strong Long package passes every check', L.checks.every((c) => c.status === 'pass') && L.score === 10, JSON.stringify(L.checks.filter((c) => c.status !== 'pass')));
  ok('Validator: a strong Short package passes every check', S.checks.every((c) => c.status === 'pass') && S.score === 10, JSON.stringify(S.checks.filter((c) => c.status !== 'pass')));
  const p = fin(GOOD, true).pkg;
  const v = (mut, isLong = true, rt) => M.srv2ValidatePackage({ ...p, ...mut }, { isLong, recentTitles: rt || [] });
  ok('Female: "male vocal" in an edited Suno prompt → hard fail', status(v({ sunoPrompt: p.sunoPrompt + ', male vocal harmonies' }), 'female') === 'fail' && v({ sunoPrompt: p.sunoPrompt + ', male vocal harmonies' }).hardFail);
  ok('Female: duet part label in lyrics → hard fail', status(v({ lyrics: p.lyrics.replace('[Bridge]', '[Bridge]\n(Him) I never wanted to leave') }), 'female') === 'fail');
  ok('Female: childlike direction in the prompt → hard fail', status(v({ sunoPrompt: p.sunoPrompt + ', girlish sweet voice' }), 'female') === 'fail');
  ok('Female: prompt without "female" → hard fail', status(v({ sunoPrompt: p.sunoPrompt.replace('female ', '') }), 'female') === 'fail');
  ok('Female: package vocal field not female → hard fail', status(v({ vocal: 'duet' }), 'female') === 'fail');
  ok('Adult: school/teen markers in lyrics → warning', status(v({ lyrics: p.lyrics.replace('Two coffees going cold', 'Skipping school to see you') }), 'adult') === 'warn');
  ok('English: Farsi lyrics → hard fail', status(v({ lyrics: '[Verse 1]\nدلم برات تنگ شده\nتو رفتی و من موندم' }), 'english') === 'fail');
  ok('English: Spanish (Latin script) lyrics → warning, not silently passed', ['warn', 'fail'].includes(status(v({ shortLyrics: 'Quédate conmigo esta noche\nNo me dejes sola aquí\nLa ciudad duerme sin ti\nY yo sigo aquí' }, false), 'english')));
  ok('Originality: artist name in prompt or title → hard fail', status(v({ sunoPrompt: p.sunoPrompt + ', like Dua Lipa' }), 'original') === 'fail' && status(v({ title: 'Taylor Swift Nights' }), 'original') === 'fail');
  ok('Deep House: BPM outside 112-126 → hard fail', status(v({ sunoPrompt: p.sunoPrompt.replace('119 BPM', '95 BPM') }), 'deephouse') === 'fail');
  ok('Deep House: genre missing → hard fail', status(v({ sunoPrompt: p.sunoPrompt.replace('emotional deep house, ', 'acoustic pop, ') }), 'deephouse') === 'fail');
  ok('Night Drive: missing in prompt → fail; no night/motion image in lyrics → warning', status(v({ sunoPrompt: p.sunoPrompt.replace('night drive, ', '') }), 'nightdrive') === 'fail' && status(v({ lyrics: '[Verse 1]\nI love you\n', shortLyrics: 'I love you' }), 'nightdrive') === 'warn');
  ok('Title: genre/label word → fail; reused title → fail; near-duplicate → warning', status(v({ title: 'Night Drive Feelings' }), 'title') === 'fail' && status(v({}, true, ['hold me through the exit signs']), 'title') === 'fail' && status(v({}, true, ['Hold Me Through Exit Signs Tonight']), 'title') === 'warn');
  ok('Hook: cliché → flagged', /cliché/.test(v({ lyrics: p.lyrics.replace('Two coffees going cold', "You're my everything tonight") }).checks.find((c) => c.id === 'hook').detail));
  ok('Hook: song that does not open with the hook → flagged', v({ hook: 'A line that appears nowhere' }).checks.find((c) => c.id === 'hook').status !== 'pass');
  ok('Format Long: no bridge and one chorus → hard fail', status(v({ lyrics: '[Verse 1]\nHold me through the exit signs\nline two\n[Chorus]\nHold me through the exit signs' }), 'format') === 'fail');
  ok('Format Short: section labels and no 0:30 → hard fail', status(v({ shortLyrics: '[Hook]\nHold me through the exit signs\nTill the city lets us go\nIf we keep on driving\nWe never have to know', shortSunoPrompt: 'deep house, female' }, false), 'format') === 'fail');
  ok('Score: any hard fail caps the score at 4', v({ sunoPrompt: p.sunoPrompt + ', male vocal' }).score <= 4);
  ok('Validator never claims to hear the voice (text-only wording in code)', /cannot hear or guarantee the gender of an actual generated voice/.test(LIB));
  ok('Finalize: vocal forced female, #SRVStudio ensured, captions mirrored, srvStudioV2 summary attached', p.vocal === 'female' && /#SRVStudio/.test(p.hashtags) && p.captionYT === p.captionYouTube && p.srvStudioV2 && p.srvStudioV2.version === M.SRV_STUDIO_V2_VERSION);
  ok('Finalize: section labels removed from shortLyrics', !/\[/.test(fin({ ...GOOD, shortLyrics: '[Hook]\nHold me through the exit signs\n[Chorus]\nTill the city lets us go' }, false).pkg.shortLyrics));
}

// ── 4. Client copy of the validator is byte-identical ──
{
  const a = LIB.indexOf('// <srv-v2-validator>'), b = LIB.indexOf('// </srv-v2-validator>') + '// </srv-v2-validator>'.length;
  ok('Client validator in public/index.html is byte-identical to lib/srvStudioV2Music.mjs', H.includes(LIB.slice(a, b)));
}

// ── 5. Flag check fails closed ──
{
  const f = (resp) => async () => resp;
  const cases = [
    ['no key', { supabaseUrl: 'u', supabaseKey: '' }, false],
    ['network error', { supabaseUrl: 'u', supabaseKey: 'k', fetchImpl: async () => { throw new Error('down'); } }, false],
    ['HTTP 500', { supabaseUrl: 'u', supabaseKey: 'k', fetchImpl: f({ ok: false }) }, false],
    ['no row', { supabaseUrl: 'u', supabaseKey: 'k', fetchImpl: f({ ok: true, json: async () => [] }) }, false],
    ['value false', { supabaseUrl: 'u', supabaseKey: 'k', fetchImpl: f({ ok: true, json: async () => [{ value: 'false' }] }) }, false],
    ['value true', { supabaseUrl: 'u', supabaseKey: 'k', fetchImpl: f({ ok: true, json: async () => [{ value: 'true' }] }) }, true],
  ];
  for (const [label, opt, want] of cases) { M._resetSrvStudioV2FlagCache(); ok('Server flag: ' + label + ' → ' + (want ? 'ON' : 'OFF'), (await M.srvStudioV2FlagEnabled(opt)) === want); }
  M._resetSrvStudioV2FlagCache();
}

// ── 6. /api/generate (Tasks lifecycle path): V1 unchanged, V2 only with request + flag ──
{
  process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.SUPABASE_URL = 'https://stub.invalid'; process.env.SUPABASE_SERVICE_KEY = 'svc';
  let flagValue = 'false'; const sent = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/app_settings')) return { ok: true, json: async () => [{ value: flagValue }] };
    if (u.includes('api.anthropic.com')) { const b = JSON.parse(opt.body); sent.push(b); const v2 = b.system === M.SRV_STUDIO_V2_SYSTEM; return { ok: true, json: async () => ({ content: [{ text: JSON.stringify(v2 ? GOOD : { title: 'V1 Song', lyrics: 'x' }) }] }) }; }
    throw new Error('unexpected fetch ' + u);
  };
  const { default: handler } = await import('../../api/generate.js');
  const call = async (body) => { let code = 0, json = null; const res = { setHeader() {}, status(c) { code = c; return this; }, json(j) { json = j; return this; }, end() { return this; } }; await handler({ method: 'POST', body }, res); return { code, json }; };
  const body = { engine: 'SRV English', mood: 'Female — Emotional', contentType: 'Short Video', contentFormat: 'short', taskName: 't', recentPackages: [{ title: 'Old Song', mood: 'x' }] };
  const v1prompt = (base('api/generate.js').match(/const SRV_ENGLISH_PROMPT = `([\s\S]*?)`;/) || [])[1];
  M._resetSrvStudioV2FlagCache(); await call(body);
  ok('/api/generate: no srvStudioV2 field → original V1 SRV English system prompt', sent.at(-1).system === v1prompt && sent.at(-1).model === 'claude-sonnet-4-5');
  M._resetSrvStudioV2FlagCache(); await call({ ...body, srvStudioV2: true });
  ok('/api/generate: srvStudioV2 requested but flag row OFF → still V1 (fails closed)', sent.at(-1).system === v1prompt);
  flagValue = 'true'; M._resetSrvStudioV2FlagCache(); const r = await call({ ...body, srvStudioV2: true });
  ok('/api/generate: request + flag ON → V2 system prompt, avoid list passed through', sent.at(-1).system === M.SRV_STUDIO_V2_SYSTEM && /Old Song/.test(sent.at(-1).messages[0].content));
  ok('/api/generate: V2 response is a finalized package with system-owned Suno prompts', r.code === 200 && r.json.success && r.json.engineType === 'suno' && r.json.package.vocal === 'female' && /emotional deep house/.test(r.json.package.shortSunoPrompt) && r.json.package.srvStudioV2.score === 10);
  M._resetSrvStudioV2FlagCache(); await call({ ...body, engine: 'SRV Farsi', srvStudioV2: true });
  ok('/api/generate: SRV Farsi never takes the V2 path, even if asked', sent.at(-1).system !== M.SRV_STUDIO_V2_SYSTEM && /SRV Farsi/.test(sent.at(-1).system));
  ok('/api/generate: original SRV_ENGLISH_PROMPT text byte-identical to main', (GEN.match(/const SRV_ENGLISH_PROMPT = `([\s\S]*?)`;/) || [])[1] === v1prompt);
  // Remove exactly the three V2 insertions (import, flag-gated early return, appended function): the rest must equal main.
  let g = GEN;
  g = g.replace(/\/\/ SRV Studio V2 \(Checkpoint B\)[^\n]*\nimport \{[^\n]*srvStudioV2Music\.mjs';\n/, '');
  g = g.replace(/\n  \/\/ SRV Studio V2: the client asks for V2[\s\S]*?return srvStudioV2Generate\([^\n]*\n  \}\n/, '');
  g = g.replace(/\n\/\/ SRV Studio V2 generation for the Tasks lifecycle path[\s\S]*$/, '');
  ok('/api/generate: everything outside the three flag-gated V2 insertions is byte-identical to main', g === base('api/generate.js'));
}

// ── 7. /api/ops generate_package (Factory path): run the real function with stubs ──
{
  const fnSrc = top(OPS, 'generatePackage');
  let flagOn = false; const sent = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, process: { env: { ANTHROPIC_API_KEY: 'k' } }, AbortController, setTimeout, clearTimeout, JSON, Date, Math, Object, Array, String, Number, Set, Promise, RegExp, Error,
    SUPABASE_URL: 'https://stub.invalid', SUPABASE_SERVICE_KEY: 'svc',
    srvStudioV2FlagEnabled: async () => flagOn, SRV_STUDIO_V2_SYSTEM: M.SRV_STUDIO_V2_SYSTEM, buildSrvStudioV2UserPrompt: M.buildSrvStudioV2UserPrompt, finalizeSrvStudioV2Package: M.finalizeSrvStudioV2Package,
    fetch: async (u, opt) => { const b = JSON.parse(opt.body); sent.push(b); return { ok: true, json: async () => ({ content: [{ text: '<package>' + JSON.stringify(b.system === M.SRV_STUDIO_V2_SYSTEM ? GOOD : { title: 'V1', lyrics: 'x' }) + '</package>' }] }) }; },
  };
  vm.createContext(ctx); vm.runInContext(fnSrc + '\nthis.generatePackage=generatePackage;', ctx);
  const call = async (body) => { let json = null; const res = { status() { return this; }, json(j) { json = j; return this; } }; await ctx.generatePackage({ method: 'POST', body }, res); return json; };
  const memory = [{ type: 'title', value: 'Hold Me Through the Exit Signs' }, { type: 'concept', value: 'old concept' }];
  await call({ engineId: 'srv_english', mode: 'Female — Emotional', existingMemory: memory, contentFormat: 'short' });
  const v1 = sent.at(-1);
  ok('/api/ops: no srvStudioV2 → original V1 SRV English SHORT prompt, no V2 system', /SRV English SHORT VIDEO generator/.test(v1.messages[0].content) && !v1.system);
  await call({ engineId: 'srv_english', mode: 'Female — Emotional', existingMemory: memory, contentFormat: 'long', srvStudioV2: true });
  ok('/api/ops: srvStudioV2 requested but flag OFF → original V1 LONG prompt', /SRV English LONG SONG generator/.test(sent.at(-1).messages[0].content) && !sent.at(-1).system);
  flagOn = true;
  const r = await call({ engineId: 'srv_english', mode: 'Female — Emotional', existingMemory: memory, contentFormat: 'long', srvStudioV2: true });
  ok('/api/ops: request + flag ON → V2 system + V2 user prompt carrying the existing memory block', sent.at(-1).system === M.SRV_STUDIO_V2_SYSTEM && /PRIOR TITLES/.test(sent.at(-1).messages[0].content) && /LONG \(full release\)/.test(sent.at(-1).messages[0].content));
  ok('/api/ops: V2 package finalized; title already in memory is flagged by the validator', r.success && r.package.vocal === 'female' && r.package.srvStudioV2.failed.includes('title'));
  await call({ engineId: 'srv_farsi', mode: 'Female — Romantic', existingMemory: [], contentFormat: 'short', srvStudioV2: true });
  ok('/api/ops: SRV Farsi never takes the V2 path', sent.at(-1).system !== M.SRV_STUDIO_V2_SYSTEM);
  const b0 = top(base('api/ops.js'), 'generatePackage');
  const v1Branch = (s) => s.slice(s.indexOf("  } else if (engineId === 'srv_english') {"), s.indexOf("  } else if (engineId === 'nextwave') {"));
  ok('/api/ops: original SRV English prompt branch byte-identical to main', v1Branch(fnSrc) === v1Branch(b0));
}

// ── 8. Client gating and header status (Workstream 5) ──
{
  ok('Client: generatePackage sends srvStudioV2 only for SRV English while the flag is on', /\.\.\.\(t\.engine==='SRV English'&&typeof _srvStudioV2On==='function'&&_srvStudioV2On\(\)\?\{srvStudioV2:true\}:\{\}\)/.test(top(H, 'generatePackage')));
  ok('Client: Factory sends srvStudioV2 only for srv_english while the flag is on', /fEngine\.id==='srv_english'&&typeof _srvStudioV2On==='function'&&_srvStudioV2On\(\)\?\{srvStudioV2:true\}:\{\}/.test(top(H, 'startGeneration')));
  const banner = top(H, 'renderExecMode');
  ok('Header: flag OFF keeps the original task.status field byte-for-byte', banner.includes("${_srvStudioV2On()?_srvEnglishV2StatusField(t):`<div class=\"exec-field\"><div class=\"exec-field-label\">STATUS</div><div class=\"exec-field-val\" style=\"color:${STATUS_COLORS[t.status]||'#c9a84c'}\">${(t.status||'pending').toUpperCase()}</div></div>`}"));
  const ctx = { D: { tasks: [], srvLifecycleStages: {} }, SRV_STAGE_COLORS: { generate: '#c9a84c', review: '#3b82f6', build: '#8b5cf6', approve: '#f59e0b', publish: '#22c55e', done: '#22c55e' }, saveAppState() {}, escHTML: (x) => String(x), console };
  vm.createContext(ctx);
  const sl = H.slice(H.indexOf('function _srvEnglishIsTask('), H.indexOf('// srvTaskUid match first.')) + H.slice(H.indexOf('const SRV_STUDIO_V2_STATUS_LABELS'), H.indexOf('function _srvEnglishV2RecentTitles('));
  vm.runInContext(sl, ctx);
  ctx.D.tasks = [{ id: 5, engine: 'SRV English', status: 'generating', createdAt: 1000 }];
  ctx.D.srvLifecycleStages = { __identityEpoch: 1, srve_1000_5: 'build' };
  ok('Header: task.status "generating" at lifecycle BUILD now reads IN BUILD', vm.runInContext('_srvEnglishV2StatusLabel(D.tasks[0]).label', ctx) === 'IN BUILD');
  ctx.D.srvLifecycleStages.srve_1000_5 = 'review';
  ok('Header: … and IN REVIEW at Review', vm.runInContext('_srvEnglishV2StatusLabel(D.tasks[0]).label', ctx) === 'IN REVIEW');
  ok('Header: task.status itself is not modified', ctx.D.tasks[0].status === 'generating');
  ctx.D.tasks[0].cancelledAt = 1;
  ok('Header: cancelled task reads CANCELLED', vm.runInContext('_srvEnglishV2StatusLabel(D.tasks[0]).label', ctx) === 'CANCELLED');
}

// ── 9. SRV Farsi scoring and prompts untouched ──
ok('Farsi: renderSRVFarsiLifecycleCard (incl. its quality scorer) unchanged', top(H, 'renderSRVFarsiLifecycleCard') === top(base('public/index.html'), 'renderSRVFarsiLifecycleCard'));
ok('Farsi: SRV_FARSI_PROMPT in api/generate.js unchanged', (GEN.match(/const SRV_FARSI_PROMPT = `([\s\S]*?)`;/) || [])[1] === (base('api/generate.js').match(/const SRV_FARSI_PROMPT = `([\s\S]*?)`;/) || [])[1]);
ok('Farsi: farsiRegenCaption unchanged', top(OPS, 'farsiRegenCaption') === top(base('api/ops.js'), 'farsiRegenCaption'));

console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
