// SRV Farsi Creative V2 — unit, handler, isolation and client-guard tests.
// Run: node tests/srv/test_srv_farsi_creative_v2.mjs   (SRVF_CV2_BASE=<git ref>, default 036a754 = main before V2)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as V2 from '../../lib/srvFarsiCreativeV2.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.SRVF_CV2_BASE || '036a754'; // last main before SRV Farsi Creative V2
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const git = cmd => execSync('git ' + cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────
const LYR_FEMALE = `[INTRO — MUSIC]

[VERSE 1]
صبح که می‌آیی چای تازه دم است
خنده‌ات در خانه آرام می‌پیچد
از پنجره نور روی موهایت
دلم مثل روز اول می‌لرزد

[CHORUS]
دستت را بده، با من بمان
امشب بی‌قرارم، آرام جان
هر جا که بروی با تو می‌آیم
دستت را بده، با من بمان

[INSTRUMENTAL BREAK — MUSIC]

[VERSE 2]
دیروز گفتی از فردا می‌ترسی
گفتم کنار من چیزی کم نیست
قول دادیم ساده زندگی کنیم
با یک سقف و دو دل که یکی است

[FINAL CHORUS]
دستت را بده، با من بمان
امشب بی‌قرارم، آرام جان
تا آخر این راه با تو می‌آیم
دستت را بده، با من بمان

[OUTRO — MUSIC]`;
const SP_FEMALE = 'A warm, mature female vocal sings close and clear, with natural Persian pronunciation, real breaths, soft pauses and expressive held notes that grow in intensity toward the chorus. A sweet, melodic Persian love song: intimate, sparse verses over warm Rhodes and gentle acoustic guitar, then a chorus that opens with a wider melody, richer harmony and strings. A setar motif answers the singer between phrases and returns in the instrumental break, while a melodic bass line moves underneath. Small piano fills, instruments enter and leave naturally, leaving space around the voice. A subtle deep house pulse with soft percussion keeps a gentle sway at 110 BPM. Polished studio sound, the singer always in front, human and tender.';
const GOOD = {
  artist: 'Female', mood: 'Romantic',
  story: 'A woman sings to the man she loves on an ordinary morning at home. In Verse 1 she notices how he still makes her heart race; in Verse 2 she remembers his fear of the future and her promise that a simple life together is enough.',
  concept: 'A quiet morning confession that a simple shared life is all she needs.',
  title: '🌷 دستت را بده 🌷', titleFinglish: 'Dastat Ra Bede',
  hook: 'دستت را بده، با من بمان',
  lyrics: LYR_FEMALE, sunoPrompt: SP_FEMALE,
  excludeStyles: 'hard kick, techno, brass section',
  captionYouTube: 'این آهنگ درباره عشقی ساده و آرام است. زنی در یک صبح معمولی به محبوبش می‌گوید که زندگی ساده کنار او کافی است.',
  thumbnailText: '🌷 دستت را بده', centralImage: 'shared umbrella', location: 'sunlit balcony',
  hookStructure: 'gentle-plea', emotionalScenario: 'promising a simple shared future to a lover who fears tomorrow', emotionalSubMode: 'tender devotion',
};
const MEMORY = {
  ok: true,
  title: ['💔 صندلی خالی تو 💔', '📖 دفتر کهنه 📖', '🌉 پل قدیمی 💔'],
  hook: ['هنوز دو استکان چای می‌ریزم', 'میز همان، تو نیستی'],
  concept: ['A woman returns to the café where they used to sit together, now sitting alone at the same table'],
  mood: ['romantic'], central_image: ['empty chair', 'henna-painted hands', 'henna on hands', 'henna-decorated hands', 'two tea glasses'],
  location: ['wedding hall', 'café table', 'morning café', 'late-night café'],
  hook_structure: ['object-as-memory', 'sensory-recall', 'place-as-longing'],
  emotional_scenario: ['returning to a place full of memories, sitting alone where you used to sit together'],
};
const SEL = { artist: 'Female', mood: 'Romantic' };
const clone = o => JSON.parse(JSON.stringify(o));
const gates = (p, sel = SEL, mem = MEMORY) => V2.srvfCv2DeterministicGates(p, { ...sel, memory: mem });

// ── 1. structure + deterministic gates ────────────────────────────────────────────────────────────────────────────
{
  const G = gates(GOOD);
  const bad = Object.entries(G).filter(([, v]) => !v.pass);
  ok(bad.length === 0, 'good fixture passes all deterministic gates', JSON.stringify(bad));
  ok(Object.keys(G).join(',') === 'G1,G2,G3,G4,G5,G6,G7,G8,G9,G10,G11,G12,G13,G14', '14 hard gates G1..G14 present');
  const { sections } = V2.srvfCv2Sections(LYR_FEMALE);
  ok(sections.map(s => s.key).join('|') === V2.SRVF_CV2_STRUCTURE.map(s => s.key).join('|'), 'locked structure parsed in order');
  ok(V2.SRVF_CV2_STRUCTURE.map(s => s.key).join(' / ') === 'INTRO — MUSIC / VERSE 1 / CHORUS / INSTRUMENTAL BREAK — MUSIC / VERSE 2 / FINAL CHORUS / OUTRO — MUSIC', 'structure constant equals the CEO-locked structure');
  ok(V2.srvfCv2Sections('[Intro - Music]\n[verse 1]\nا ب').sections[0].key === 'INTRO — MUSIC', 'header normalisation (dash/case)');
}
const failsOnly = (p, gate, name, sel, mem) => { const G = gates(p, sel, mem); ok(!G[gate].pass, name + ' → ' + gate + ' fails'); return G; };
{ // G1
  let p = clone(GOOD); p.artist = 'Male'; failsOnly(p, 'G1', 'artist echo differs');
  p = clone(GOOD); p.sunoPrompt = SP_FEMALE.replace('female vocal', 'male vocal'); failsOnly(p, 'G1', 'female task, male vocal in style');
  p = clone(GOOD); p.sunoPrompt = SP_FEMALE + ' duet'; failsOnly(p, 'G1', 'female task, duet in style');
  p = clone(GOOD); p.artist = 'Male'; p.sunoPrompt = SP_FEMALE.replace('female vocal', 'male vocal');
  ok(gates(p, { artist: 'Male', mood: 'Romantic' }).G1.pass, 'male task with male vocal passes G1');
  // duet
  const duetLyr = LYR_FEMALE.replace('[VERSE 1]', '[VERSE 1 — MALE]').replace('[VERSE 2]', '[VERSE 2 — FEMALE]').replace('[CHORUS]', '[CHORUS — BOTH]').replace('[FINAL CHORUS]', '[FINAL CHORUS — BOTH]');
  p = clone(GOOD); p.artist = 'Duet'; p.lyrics = duetLyr; p.sunoPrompt = SP_FEMALE.replace('A warm, mature female vocal sings', 'A male and female duet, two warm mature voices, sings');
  const GD = gates(p, { artist: 'Duet', mood: 'Romantic' });
  ok(GD.G1.pass && GD.G3.pass, 'duet with MALE/FEMALE verse turns passes G1+G3', JSON.stringify([GD.G1, GD.G3]));
  p.lyrics = duetLyr.replace('[VERSE 2 — FEMALE]', '[VERSE 2 — MALE]'); failsOnly(p, 'G1', 'duet with same singer on both verses', { artist: 'Duet', mood: 'Romantic' });
  p = clone(GOOD); p.lyrics = duetLyr; failsOnly(p, 'G3', 'solo song with singer tags');
}
{ // G2
  const p = clone(GOOD); p.mood = 'Happy'; failsOnly(p, 'G2', 'mood echo differs');
}
{ // G3
  let p = clone(GOOD); p.lyrics = LYR_FEMALE.replace('[INSTRUMENTAL BREAK — MUSIC]', '[BRIDGE]\nیک خط اضافه برای پل\n\n[INSTRUMENTAL BREAK — MUSIC]'); failsOnly(p, 'G3', 'bridge added');
  p = clone(GOOD); p.lyrics = LYR_FEMALE.replace('[CHORUS]', '[PRE-CHORUS]\nیک خط پیش از کر\n\n[CHORUS]'); failsOnly(p, 'G3', 'pre-chorus added');
  p = clone(GOOD); p.lyrics = LYR_FEMALE.replace('[INTRO — MUSIC]\n', '[INTRO — MUSIC]\nآه آه آه\n'); failsOnly(p, 'G3', 'lyrics inside music section');
  p = clone(GOOD); p.lyrics = LYR_FEMALE.replace('[OUTRO — MUSIC]', ''); failsOnly(p, 'G3', 'missing outro');
  p = clone(GOOD); p.lyrics = LYR_FEMALE.replace('دلم مثل روز اول می‌لرزد\n', ''); p.lyrics = p.lyrics.replace('از پنجره نور روی موهایت\n', ''); failsOnly(p, 'G3', 'verse too short');
}
{ // G4
  const p = clone(GOOD); p.lyrics = LYR_FEMALE.replace('خنده‌ات در خانه آرام می‌پیچد', 'I love you so much tonight'); failsOnly(p, 'G4', 'English line in lyrics');
}
{ // G5/G6/G7
  let p = clone(GOOD); p.story = 'short'; failsOnly(p, 'G5', 'thin story');
  p = clone(GOOD); p.hook = 'هنوز منتظرم کنار پنجره'; failsOnly(p, 'G6', 'hook not sung in choruses');
  p = clone(GOOD); p.hook = 'بمان'; failsOnly(p, 'G6', 'one-word hook');
  p = clone(GOOD); p.lyrics = LYR_FEMALE.replace(/\[CHORUS\]\n[\s\S]*?\n\n\[INSTRUMENTAL/, '[CHORUS]\nصبح که می‌آیی چای تازه دم است\nخنده‌ات در خانه آرام می‌پیچد\nاز پنجره نور روی موهایت\nدستت را بده، با من بمان\n\n[INSTRUMENTAL');
  failsOnly(p, 'G7', 'chorus repeats verse lines');
}
{ // G8–G11, G13, G14
  let p = clone(GOOD); p.sunoPrompt = 'Female vocal. Persian love song with Rhodes, guitar, strings, setar motif answering the singer, fills, instruments enter and leave, space. Subtle deep house pulse underneath. ' + 'Clean polished sound. '.repeat(14); failsOnly(p, 'G8', 'no human vocal direction');
  p = clone(GOOD); p.sunoPrompt = 'A warm, mature female vocal with natural Persian pronunciation, real breaths, pauses and expressive held notes, intensity rising, human and intimate. A Persian love song over a subtle deep house pulse. ' + 'Polished warm studio sound for a heartfelt romantic song. '.repeat(6); failsOnly(p, 'G9', 'no living arrangement');
  for (const w of ['hard kick', 'EDM drop', 'techno', 'trance', 'festival', 'harsh synths', 'repetitive electronic loop', 'four-on-the-floor']) {
    p = clone(GOOD); p.sunoPrompt = SP_FEMALE.replace('Polished studio sound', 'Polished studio sound with ' + w); failsOnly(p, 'G10', 'style contains "' + w + '"');
  }
  p = clone(GOOD); p.sunoPrompt = SP_FEMALE.replace('Small piano fills', 'Deep house drums and small piano fills'); failsOnly(p, 'G10', 'deep house mentioned twice');
  p = clone(GOOD); p.sunoPrompt = SP_FEMALE.replace('A subtle deep house pulse with soft percussion keeps a gentle sway at 110 BPM. ', ''); failsOnly(p, 'G10', 'deep house missing');
  p = clone(GOOD); p.sunoPrompt = SP_FEMALE.replace('instruments enter and leave naturally', 'instruments drop out and return naturally');
  ok(gates(p).G10.pass, '"drop out" (arrangement) is not treated as an EDM drop');
  p = clone(GOOD); p.sunoPrompt = 'cinematic modern Persian pop, ' + SP_FEMALE; failsOnly(p, 'G11', 'legacy boilerplate opening');
  p = clone(GOOD); p.sunoPrompt = SP_FEMALE + ' '.repeat(10) + 'x'.repeat(1000 - SP_FEMALE.length); failsOnly(p, 'G13', 'style prompt ≥1000 chars');
  ok(gates(GOOD).G13.pass && SP_FEMALE.length < 1000, 'style prompt <1000 passes G13 (' + SP_FEMALE.length + ')');
  p = clone(GOOD); p.title = 'Dastat Ra Bede'; failsOnly(p, 'G14', 'Latin-only title');
}
{ // G12 diversity
  let p = clone(GOOD); p.title = '💔 صندلی خالی تو 💔'; failsOnly(p, 'G12', 'same title as memory');
  p = clone(GOOD); p.centralImage = 'henna hands'; failsOnly(p, 'G12', 'saturated/repeated central image');
  p = clone(GOOD); p.location = 'cozy café'; failsOnly(p, 'G12', 'saturated location (café)');
  p = clone(GOOD); p.hookStructure = 'sensory-recall'; failsOnly(p, 'G12', 'hook structure used in last 3');
  p = clone(GOOD); p.hook = 'هنوز دو استکان چای می‌ریزم'; failsOnly(p, 'G12', 'hook from memory');
  p = clone(GOOD); p.concept = 'She returns to the café where they used to sit together and sits alone at the same table.'; failsOnly(p, 'G12', 'same premise');
  ok(V2.srvfCv2Saturated(MEMORY).includes('henna') && V2.srvfCv2Saturated(MEMORY).includes('cafe') === false ? true : V2.srvfCv2Saturated(MEMORY).includes('henna'), 'saturation finds henna');
  ok(gates(GOOD, SEL, { ok: false }).G12.pass, 'empty memory never blocks');
}
// ── 2. judge mapping + finalisation ────────────────────────────────────────────────────────────────────────────────
{
  const G = gates(GOOD);
  const J = { naturalFarsi: { score: 8 }, story: { score: 8 }, hook: { score: 9 }, contrast: { score: 8 }, moodFit: { score: 8 }, artistFit: { score: 9 }, humanNotAI: { score: 8 } };
  ok(V2.srvfCv2Failed(V2.srvfCv2ApplyJudge(G, J)).length === 0, 'judge ≥7 everywhere → pass');
  const J2 = clone(J); J2.naturalFarsi = { score: 5, reason: 'stiff' }; J2.moodFit = { score: 6, reason: 'too sad' };
  const f2 = V2.srvfCv2Failed(V2.srvfCv2ApplyJudge(G, J2)).map(x => x.gate).sort().join(',');
  ok(f2 === 'G2,G4', 'low naturalFarsi → G4, low moodFit → G2', f2);
  const f3 = V2.srvfCv2Failed(V2.srvfCv2ApplyJudge(G, null)).map(x => x.gate).sort().join(',');
  ok(f3 === 'G11,G4,G5,G6,G7', 'judge unavailable fails closed on judged gates', f3);
  const raw = clone(GOOD); raw.mood = 'Happy'; raw.artist = 'Duet';
  const pkg = V2.srvfCv2Finalize(raw, { artist: 'Female', mood: 'Romantic', gateResults: { passed: true }, attempt: 2 });
  ok(pkg.mood === 'romantic' && pkg.vocal === 'female' && pkg.artist === 'Female' && pkg.mode === 'Female — Romantic', 'selection is authoritative over the model reply');
  for (const f of ['title', 'titleFinglish', 'concept', 'hook', 'mood', 'vocal', 'lyrics', 'sunoPrompt', 'captionYouTube', 'centralImage', 'location', 'hookStructure', 'emotionalScenario'])
    ok(typeof pkg[f] === 'string' && pkg[f].length > 0, 'contract field ' + f);
  for (const f of ['captionYT', 'shortLyrics', 'shortSunoPrompt', 'shortTitle', 'thumbnailText', 'captionTikTok', 'captionInstagram', 'workflowNotes'])
    ok(f in pkg, 'legacy alias present: ' + f);
  ok(pkg.captionYT === pkg.captionYouTube, 'captionYT alias equals captionYouTube');
  ok(pkg.shortLyrics.includes('دستت را بده') && !pkg.shortLyrics.includes('['), 'shortLyrics derived from Chorus (no extra tokens)');
  ok(pkg.creativeV2 === true && pkg.creativeGateVersion === V2.SRVF_CV2_VERSION && pkg.creativeAttempt === 2, 'additive V2 fields');
  ok(V2.SRVF_CV2_EXCLUDE_DEFAULT.every(x => pkg.excludeStyles.includes(x)) && pkg.excludeStyles.includes('brass section'), 'excludeStyles = defaults + song extras');
  ok(pkg.excludeStyles.length < 400, 'excludeStyles concise (' + pkg.excludeStyles.length + ')');
  ok(!V2.srvfCv2ExcludeStyles('persian vocals, piano, x').includes('piano'), 'excludeStyles never excludes core identity');
  ok(!('taskId' in pkg) && !('id' in pkg), 'reply cannot carry id/taskId');
}
// ── 3. flag + selection ──────────────────────────────────────────────────────────────────────────────────────────
{
  const P = V2.srvfCv2ParseFlag;
  ok(P(null) === 'off' && P('') === 'off' && P('off') === 'off' && P(false) === 'off' && P('garbage') === 'off', 'flag defaults off');
  ok(P('on') === 'on' && P(true) === 'on' && P('"on"') === 'on' && P('true') === 'on' && P({ mode: 'on' }) === 'on', 'flag on forms');
  ok(P('test') === 'test' && P('"test"') === 'test', 'flag test');
  ok(V2.srvfCv2Allowed('on', false) && V2.srvfCv2Allowed('test', true) && !V2.srvfCv2Allowed('test', false) && !V2.srvfCv2Allowed('off', true), 'allowed matrix');
  ok(V2.srvfCv2Selection({ artist: 'duet', mood: 'happy', format: 'long' }).artist === 'Duet', 'selection normalises case');
  ok(!V2.srvfCv2Selection({ artist: 'Choir', mood: 'Happy', format: 'Long' }).ok && !V2.srvfCv2Selection({ artist: 'Male', mood: 'Happy', format: 'Short' }).ok, 'selection rejects bad artist / Short');
  const up = V2.srvfCv2UserPrompt({ artist: 'Male', mood: 'Happy', memory: MEMORY, feedback: [{ gate: 'G6', reason: 'hook missing from final chorus' }] });
  ok(up.includes('ARTIST (fixed): Male') && up.includes('MOOD (fixed): Happy') && up.includes('hook missing from final chorus') && up.includes('صندلی خالی تو'), 'user prompt carries structured selection, memory and feedback');
  ok(!/5%|special theme/i.test(V2.SRVF_CV2_SYSTEM + up), 'no Happy-as-5%-special-case rule');
  ok(/never festival EDM/.test(V2.SRVF_CV2_MOOD_PROFILES.Happy.feel), 'Happy profile per CEO');
}
// ── 4. handler with mocked network ───────────────────────────────────────────────────────────────────────────────
function mockFetch({ flag = 'on', memoryOk = true, genReply = JSON.stringify(GOOD), judge = { naturalFarsi: { score: 8 }, story: { score: 8 }, hook: { score: 8 }, contrast: { score: 8 }, moodFit: { score: 8 }, artistFit: { score: 8 }, humanNotAI: { score: 8 } } } = {}) {
  const calls = [];
  const f = async (url, opt = {}) => {
    calls.push({ url: String(url), body: opt.body ? JSON.parse(opt.body) : null });
    const j = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o, text: async () => JSON.stringify(o) });
    if (String(url).includes('/app_settings')) return j(flag == null ? [] : [{ value: flag }]);
    if (String(url).includes('/generation_memory')) {
      if (!memoryOk) return j({ error: 'x' }, 500);
      ok(/engine_id=eq\.srv_farsi/.test(url), 'memory query is filtered to engine_id=srv_farsi');
      const type = String(url).match(/memory_type=eq\.([a-z_]+)/)[1];
      return j((MEMORY[type] || []).map(value => ({ value })));
    }
    if (String(url).includes('api.anthropic.com')) {
      const b = JSON.parse(opt.body);
      return j({ content: [{ type: 'text', text: b.model === V2.SRVF_CV2_JUDGE_MODEL ? JSON.stringify(judge) : genReply }], usage: { input_tokens: 1, output_tokens: 1 } });
    }
    return j({}, 404);
  };
  f.calls = calls; return f;
}
const ENV = { apiKey: 'k', supabaseUrl: 'https://sb', supabaseKey: 's' };
const BODY = { engine: 'SRV Farsi', srvFarsiCreativeV2: true, artist: 'Female', mood: 'Romantic', format: 'Long', srvFarsiTest: true };
{
  for (const [flag, isTest, expectOff] of [[null, true, true], ['off', true, true], ['test', false, true], ['test', true, false], ['on', false, false]]) {
    V2._resetSrvfCv2FlagCache();
    const f = mockFetch({ flag });
    const r = await V2.srvfCv2Handle({ ...BODY, srvFarsiTest: isTest }, { ...ENV, fetchImpl: f });
    const anth = f.calls.filter(c => c.url.includes('anthropic')).length;
    ok(expectOff ? (r.json.code === 'srv_farsi_creative_v2_off' && anth === 0) : (r.json.success === true && anth === 2), `flag=${flag} test=${isTest} → ${expectOff ? 'off, no model call' : 'V2 runs (gen+judge)'}`, JSON.stringify(r.json).slice(0, 200));
  }
  V2._resetSrvfCv2FlagCache();
  let f = mockFetch({ flag: 'on' });
  let r = await V2.srvfCv2Handle(BODY, { ...ENV, fetchImpl: f });
  ok(r.json.success && r.json.package.creativeGateResults.passed === true && r.json.package.creativeGateResults.memoryLoaded === true, 'success returns package with gate results');
  const genCall = f.calls.find(c => c.url.includes('anthropic') && c.body.model === V2.SRVF_CV2_GEN_MODEL);
  ok(genCall && genCall.body.system === V2.SRVF_CV2_SYSTEM, 'generation uses only the canonical V2 system prompt');
  ok(genCall && !/SRV FARSI IDENTITY|FROZEN v13/.test(genCall.body.system), 'legacy prompt not used by V2');
  V2._resetSrvfCv2FlagCache();
  const badReply = clone(GOOD); badReply.lyrics = LYR_FEMALE.replace('[VERSE 2]', '[BRIDGE]\nخط\n\n[VERSE 2]');
  f = mockFetch({ flag: 'on', genReply: JSON.stringify(badReply) });
  r = await V2.srvfCv2Handle(BODY, { ...ENV, fetchImpl: f });
  ok(r.json.success === false && r.json.code === 'srv_farsi_creative_v2_gates_failed' && r.json.failed.some(x => x.gate === 'G3') && !r.json.package, 'gate failure returns reasons and NO package');
  V2._resetSrvfCv2FlagCache();
  f = mockFetch({ flag: 'on', genReply: 'not json' });
  r = await V2.srvfCv2Handle(BODY, { ...ENV, fetchImpl: f });
  ok(r.json.code === 'srv_farsi_creative_v2_gates_failed' && r.json.failed[0].gate === 'PARSE', 'unparseable reply = failed attempt');
  V2._resetSrvfCv2FlagCache();
  f = mockFetch({ flag: 'on', memoryOk: false });
  r = await V2.srvfCv2Handle(BODY, { ...ENV, fetchImpl: f });
  ok(r.json.success && r.json.package.creativeGateResults.memoryLoaded === false, 'memory read failure does not block, is recorded');
  V2._resetSrvfCv2FlagCache();
  f = mockFetch({ flag: 'on' });
  r = await V2.srvfCv2Handle({ ...BODY, format: 'Short' }, { ...ENV, fetchImpl: f });
  ok(r.json.code === 'srv_farsi_creative_v2_off' && !f.calls.some(c => c.url.includes('anthropic')), 'Short never uses V2');
}
{ // judge retry + diagnostics
  const mk = replies => { let k = 0; const f = mockFetch({ flag: 'on' }); return async (url, opt) => {
    if (String(url).includes('anthropic') && JSON.parse(opt.body).model === V2.SRVF_CV2_JUDGE_MODEL) { const t = replies[Math.min(k++, replies.length - 1)]; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: t }] }), text: async () => t }; }
    return f(url, opt); }; };
  const good = JSON.stringify(Object.fromEntries(['naturalFarsi', 'story', 'hook', 'contrast', 'moodFit', 'artistFit', 'humanNotAI'].map(d => [d, { score: 8, reason: 'ok' }])));
  V2._resetSrvfCv2FlagCache();
  let r = await V2.srvfCv2Handle(BODY, { ...ENV, fetchImpl: mk(['{"naturalFarsi":{"score":8,"reason":"tru', good]) });
  ok(r.json.success === true, 'truncated judge reply → one retry → pass');
  V2._resetSrvfCv2FlagCache();
  r = await V2.srvfCv2Handle(BODY, { ...ENV, fetchImpl: mk(['nope', 'still nope']) });
  ok(r.json.success === false && /unusable judge reply/.test(r.json.gateResults.judgeError || ''), 'two bad judge replies → fail closed, judgeError recorded');
  V2._resetSrvfCv2FlagCache();
  r = await V2.srvfCv2Handle(BODY, { ...ENV, fetchImpl: mk(['{"naturalFarsi":{"score":9}}']) });
  ok(r.json.success === false, 'judge reply missing dimensions is not accepted');
  ok(/95-120 words/.test(V2.SRVF_CV2_SYSTEM) && /AUTOMATIC CHECKS/.test(V2.srvfCv2UserPrompt({ artist: 'Duet', mood: 'Happy', memory: {} })) && /male and female duet/.test(V2.srvfCv2UserPrompt({ artist: 'Duet', mood: 'Happy', memory: {} })), 'length in words + automatic checks block in the request');
}
{ // style cleanup
  const ctx = { artist: 'Female', mood: 'Romantic', raw: GOOD };
  let c = V2.srvfCv2CleanStyle(SP_FEMALE.replace('Polished studio sound,', 'Polished studio sound, never harsh, no robotic vocals,'), ctx);
  ok(!/harsh|robotic/i.test(c.sunoPrompt) && c.log.removedNegations.length === 2 && /Polished studio sound/.test(c.sunoPrompt), 'negated excluded styles removed, rest kept', c.sunoPrompt.slice(-160));
  ok(gates({ ...GOOD, sunoPrompt: c.sunoPrompt }).G10.pass, 'cleaned prompt passes G10');
  c = V2.srvfCv2CleanStyle(SP_FEMALE, ctx);
  ok(c.sunoPrompt === SP_FEMALE && !c.log.changed, 'clean prompt untouched');
  const long = SP_FEMALE + ' The arrangement breathes like a late evening conversation between old friends who never tire of each other. Every instrument has its own small moment and then steps back for the singer and the story. The final seconds settle softly, like a door closing gently on a happy room.';
  ok(long.length >= 1000, 'fixture is ≥1000 (' + long.length + ')');
  c = V2.srvfCv2CleanStyle(long, ctx);
  ok(c.sunoPrompt.length < 1000 && c.log.droppedSentences.length >= 1 && gates({ ...GOOD, sunoPrompt: c.sunoPrompt }).G13.pass, 'over-long prompt trimmed by whole sentences to <1000 (' + c.sunoPrompt.length + ')');
  for (const k of ['G1', 'G8', 'G9', 'G10', 'G11']) ok(gates({ ...GOOD, sunoPrompt: c.sunoPrompt })[k].pass, 'trim keeps ' + k);
  const pad = n => ' ' + Array.from({ length: n }, (_, i) => 'tender' + i).join(' ');
  const essential = 'A warm female vocal with natural breaths, pauses, held notes, intensity' + pad(55) + '. Rhodes, guitar, setar motif answering the singer, strings, melodic bass line, fills, instruments enter, space, subtle deep house pulse' + pad(45) + '.';
  c = V2.srvfCv2CleanStyle(essential, ctx);
  ok(c.sunoPrompt.length >= 1000, 'no trim when it would break a style gate (G13 then fails honestly)');
  V2._resetSrvfCv2FlagCache();
  const f = mockFetch({ flag: 'on', genReply: JSON.stringify({ ...GOOD, sunoPrompt: long }) });
  const r = await V2.srvfCv2Handle(BODY, { ...ENV, fetchImpl: f });
  ok(r.json.success && r.json.package.sunoPrompt.length < 1000 && r.json.package.creativeGateResults.styleCleanup.changed === true, 'handler applies cleanup and records it');
}
{ // language + style quality (from live run 2)
  let p = clone(GOOD);
  p.lyrics = LYR_FEMALE.replace('صبح که می‌آیی چای تازه دم است', 'می‌دونم که اونجا تو خونه نمی‌تونم').replace('دیروز گفتی از فردا می‌ترسی', 'می‌خوام بمونم همون جا');
  ok(V2.srvfCv2TehraniForms(p.lyrics).length === 7, 'Tehrani forms counted (' + V2.srvfCv2TehraniForms(p.lyrics).join(',') + ')');
  failsOnly(p, 'G4', 'Tehran colloquial dominance');
  p = clone(GOOD); p.lyrics = LYR_FEMALE.replace('صبح که می‌آیی چای تازه دم است', 'می‌دونم که اونجا هستی');
  ok(gates(p).G4.pass, 'a light colloquial touch (2 forms) passes G4');
  ok(V2.srvfCv2TehraniForms(LYR_FEMALE.replace('[CHORUS]', '[CHORUS]\nمی‌دونم').replace('[FINAL CHORUS]', '[FINAL CHORUS]\nمی‌دونم')).length === 1, 'repeated chorus line counted once');
  p = clone(GOOD); p.sunoPrompt = SP_FEMALE.replace('Polished studio sound, the singer always in front, human and tender.', 'Human and tender.'); failsOnly(p, 'G8', 'no studio sound / singer not in front');
  p = clone(GOOD); p.sunoPrompt = 'Open with ' + SP_FEMALE.charAt(0).toLowerCase() + SP_FEMALE.slice(1); failsOnly(p, 'G11', '"Open with" opening');
  const c = V2.srvfCv2CleanStyle('Open with ' + SP_FEMALE.charAt(0).toLowerCase() + SP_FEMALE.slice(1), { artist: 'Female', mood: 'Romantic', raw: GOOD });
  ok(c.log.rewroteOpening && /^A warm, mature female vocal/.test(c.sunoPrompt) && gates({ ...GOOD, sunoPrompt: c.sunoPrompt }).G11.pass, 'cleanup rewrites "Open with…" into a description');
  const human = 'Human vocal performance with expressive held notes and natural pauses for breath at every emotional word.';
  const longEss = SP_FEMALE + ' ' + human + ' ' + human.replace('Human', 'Truly human');
  const c2 = V2.srvfCv2CleanStyle(longEss, { artist: 'Female', mood: 'Romantic', raw: GOOD });
  ok(c2.log.droppedSentences.every(x => !/held|breath|human/i.test(x)), 'cleanup never drops a human-performance sentence');
  ok(c2.log.droppedSentences.length <= 3, 'cleanup drops at most 3 sentences');
}
{ // calibration on the real live-run-2 packages (if present locally)
  const f = path.join(os.homedir(), 'MMM', 'srv-farsi-creative-v2', 'run2.json');
  if (fs.existsSync(f)) {
    const R = JSON.parse(fs.readFileSync(f, 'utf8'));
    const res = R.filter(r => r.package).map(r => { const pk = r.package; const raw = { ...pk, artist: r.artist, mood: r.mood }; const G = V2.srvfCv2DeterministicGates(raw, { artist: r.artist, mood: r.mood, memory: {} }); return r.artist + '-' + r.mood + ':' + Object.entries(G).filter(([, v]) => !v.pass).map(([k]) => k).join('+'); });
    console.log('  calibration (run 2 packages vs new deterministic gates): ' + res.join(' · '));
  }
}
// ── 5. api/generate.js: V2 branch + legacy byte-identical request bodies vs BASE ────────────────────────────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srvf-cv2-'));
  fs.mkdirSync(path.join(tmp, 'api')); fs.symlinkSync(path.join(ROOT, 'lib'), path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'api', 'generate.js'), git(`show ${BASE}:api/generate.js`));
  fs.writeFileSync(path.join(tmp, 'package.json'), fs.readFileSync(path.join(ROOT, 'package.json')));
  const baseMod = await import(pathToFileURL(path.join(tmp, 'api', 'generate.js')).href);
  const newMod = await import(pathToFileURL(path.join(ROOT, 'api', 'generate.js')).href);
  process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.SUPABASE_SERVICE_KEY = 'svc';
  const run = async (handler, body) => {
    const calls = [];
    globalThis.fetch = async (url, opt = {}) => {
      calls.push({ url: String(url), body: opt.body || null });
      const j = o => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
      if (String(url).includes('app_settings')) return j([]);
      if (String(url).includes('anthropic')) return j({ content: [{ type: 'text', text: JSON.stringify({ title: 'تست', lyrics: 'تست', script: 'one two three. four five.' }) }] });
      return j([]);
    };
    let out = null; const res = { setHeader() {}, status(s) { this.s = s; return this; }, json(o) { out = { s: this.s, o }; return this; }, end() { out = { s: this.s }; return this; } };
    await handler({ method: 'POST', body }, res);
    return { calls, out };
  };
  const cases = [
    { engine: 'SRV Farsi', mood: 'Female — Romantic', platform: 'YouTube', contentType: 'Long', contentFormat: 'long', taskName: 'SRV Farsi — Female — Romantic · Long', recentPackages: [{ title: 'a', mood: 'romantic' }] },
    { engine: 'SRV English', mood: 'Female — Emotional', platform: 'YouTube', contentType: 'Long', contentFormat: 'long', taskName: 'x', recentPackages: [] },
    { engine: 'NextWave', mood: 'm', platform: 'YouTube', contentType: 'Short', contentFormat: 'short', taskName: 'x', recentPackages: [] },
    { engine: 'AI Studio', mood: 'AI Tools & Productivity', platform: 'YouTube', contentType: 'Short', contentFormat: 'short', taskName: 'x', recentPackages: [] },
    { engine: 'AI Studio', mood: 'AI Tools & Productivity', platform: 'YouTube', contentType: 'Long', contentFormat: 'long', taskName: 'x', recentPackages: [] },
  ];
  const realRandom = Math.random;
  const seeded = () => { let x = 42; Math.random = () => ((x = (x * 16807) % 2147483647) / 2147483647); };
  for (const c of cases) {
    seeded(); const a = await run(baseMod.default, clone(c));
    seeded(); const b = await run(newMod.default, clone(c));
    Math.random = realRandom;
    const ab = a.calls.filter(x => x.url.includes('anthropic')).map(x => x.body), bb = b.calls.filter(x => x.url.includes('anthropic')).map(x => x.body);
    ok(ab.length === 1 && JSON.stringify(ab) === JSON.stringify(bb), `legacy request identical to ${BASE}: ${c.engine} ${c.contentFormat}`);
    ok(JSON.stringify(a.out) === JSON.stringify(b.out), `legacy response identical to ${BASE}: ${c.engine} ${c.contentFormat}`);
  }
  // A V2 request with the flag off: no model call, off code
  V2._resetSrvfCv2FlagCache();
  const off = await run(newMod.default, { ...BODY });
  ok(off.out.o.code === 'srv_farsi_creative_v2_off' && !off.calls.some(x => x.url.includes('anthropic')), 'generate.js V2 branch with flag off → off code, no model call');
  // srvFarsiCreativeV2 on any other engine is ignored
  const eng = await run(newMod.default, { ...cases[1], srvFarsiCreativeV2: true });
  ok(!eng.calls.some(x => x.url.includes('app_settings?key=eq.srv_farsi')), 'V2 flag on another engine ignored');
  fs.rmSync(tmp, { recursive: true, force: true });
}
// ── 6. static isolation vs BASE ──────────────────────────────────────────────────────────────────────────────────
function fnText(src, name) {
  const re = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm'); const m = re.exec(src); if (!m) return null;
  const end = src.indexOf('\n}\n', m.index); return src.slice(m.index, end + 2);
}
{
  const baseHtml = git(`show ${BASE}:public/index.html`), newHtml = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const protectedFns = ['generatePackage', 'getPackageMemory', 'savePackageToSupabase', 'saveMemoryItem', 'findDuplicatePackage', '_confirmDupSave', 'fetchPackagesFromTable',
    'vaFarsiGeneratePackage', '_srvFarsiRegeneratePackage', '_srvFarsiSetStage', '_srvFarsiGetStage', '_srvCopyBuildField', 'vaStartFarsiProductionTask', '_srvFarsiNextMode',
    '_srvFarsiNextArtist', '_srvFarsiNextMood', '_srvFarsiNextFormat', '_srvFarsiVaSetArtistFormat', '_srvFarsiVaCurrentArtistFormat', '_srvFarsiCreateShortFromLong', '_srvFarsiShortSources',
    '_srvFarsiApprovePackage', '_srvFarsiCancelTask', 'buildGenerationPrompt', 'srvLoadMp3', '_farsisaveEdit', 'renderPackageDisplay', 'vaGeneratePackage', '_srvEnglishGenerateWithGuard'];
  for (const n of protectedFns) {
    const a = fnText(baseHtml, n), b = fnText(newHtml, n);
    if (a === null && b === null) continue;
    ok(a !== null && a === b, 'index.html function unchanged: ' + n);
  }
  for (const c of ['const SRV_STAGES', 'const FARSI_ARTIST_CYCLE', 'const FARSI_MOOD_CYCLE', "const API_URL='/api/generate';"]) {
    const line = s => (s.split('\n').find(l => l.includes(c)) || null);
    ok(line(baseHtml) && line(baseHtml) === line(newHtml), 'unchanged: ' + c);
  }
  const baseGen = git(`show ${BASE}:api/generate.js`), newGen = fs.readFileSync(path.join(ROOT, 'api/generate.js'), 'utf8');
  for (const n of ['buildAvoidList', 'srvStudioV2Generate']) ok(fnText(baseGen, n) && fnText(baseGen, n) === fnText(newGen, n), 'generate.js function unchanged: ' + n);
  const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
  ok(between(baseGen, 'const SRV_FARSI_PROMPT', 'const TEMPLATES') === between(newGen, 'const SRV_FARSI_PROMPT', 'const TEMPLATES'), 'legacy SRV_FARSI_PROMPT + other prompts unchanged (rollback path)');
  ok(between(baseGen, 'const TEMPLATES', 'function buildAvoidList') === between(newGen, 'const TEMPLATES', 'function buildAvoidList'), 'TEMPLATES unchanged');
  // only additive lines in generate.js
  const genDiff = git(`diff ${BASE} -- api/generate.js`).split('\n').filter(l => /^[-+]/.test(l) && !/^(\+\+\+|---)/.test(l));
  ok(genDiff.every(l => l.startsWith('+')) && genDiff.length <= 10, 'generate.js diff is additive only (' + genDiff.length + ' lines)');
  // changed files scope
  const changed = git(`diff --name-only ${BASE}`).trim().split('\n').filter(Boolean);
  const allowed = f => ['api/generate.js', 'public/index.html', 'lib/srvFarsiCreativeV2.mjs'].includes(f) || f.startsWith('tests/srv/') || f.startsWith('docs/srv-farsi/');
  ok(changed.every(allowed), 'changed files within scope: ' + changed.join(', '));
  ok(!changed.includes('api/ops.js') && !changed.some(f => /srvStudioV2|nextwave|aiStudio|smm|youtube/i.test(f)), 'ops.js / SRV Studio / NextWave / AI Studio / SMM / YouTube files untouched');
  // index.html: every changed line is inside the SRV Farsi guard, the new V2 functions, or the SRV Farsi lifecycle card
  const lines = newHtml.split('\n');
  const added = [];
  for (const l of git(`diff -U0 ${BASE} -- public/index.html`).split('\n').filter(l => l.startsWith('@@'))) {
    const m = l.match(/\+(\d+)(?:,(\d+))?/); const st = +m[1], n = m[2] == null ? 1 : +m[2];
    for (let k = st; k < st + n; k++) if (lines[k - 1].trim() && !lines[k - 1].trim().startsWith('//')) added.push(k);
  }
  const owner = n => { for (let i = n - 1; i >= 0; i--) { const m = lines[i].match(/^(async )?function ([A-Za-z0-9_$]+)\(/); if (m) return m[2]; } return null; };
  const hunks = added;
  const okOwners = new Set(['_srvFarsiGenerateWithGuard', '_srvFarsiCreativeV2Selection', '_srvFarsiCreativeV2Attempt', '_srvFarsiCopyExcludeStyles', '_srvFarsiCreativeV2ReviewNote', 'renderSRVFarsiLifecycleCard']);
  const owners = hunks.map(owner);
  ok(owners.every(o => okOwners.has(o)), 'index.html changes only inside SRV Farsi creative functions: ' + [...new Set(owners)].join(', '));
  const delLines = git(`diff -U0 ${BASE} -- public/index.html`).split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'));
  ok(delLines.length === 3 && delLines.some(l => l.includes('await generatePackage(_tid);')), 'index.html removes only the 3 replaced lines (' + delLines.length + ')');
}
// ── 7. client guard in a sandbox ─────────────────────────────────────────────────────────────────────────────────
{
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const code = ['_srvFarsiCreativeV2Selection', '_srvFarsiCreativeV2Attempt', '_srvFarsiGenerateWithGuard', '_srvFarsiVaCurrentArtistFormat', '_srvFarsiSplitMood', '_srvFarsiCreativeV2ReviewNote'].map(n => fnText(html, n)).join('\n');
  function makeCtx({ replies, task }) {
    const log = { fetches: [], legacy: 0, saved: [], memory: [] };
    const ctx = {
      console: { log() {}, warn() {}, error() {} }, Date, JSON, String, Number, Array, Object, isNaN, Promise, Error,
      API_URL: '/api/generate', STORAGE_KEY: 'k', _srvFarsiGuardActive: false,
      D: { packages: [], tasks: [task], genMemory: { titles: [] } },
      _srvFarsiTaskById: id => (String(id) === String(task.id) ? task : null),
      _srvFarsiIsTestTask: t => /\[TEST\]/.test(t.name), _srvFarsiTaskUid: t => 'srvf_1_' + t.id,
      _getEngineState: () => 'running', saveAppState() {}, storageSafe: async () => true, buildStateObject: () => ({}),
      escHTML: s => String(s),
      savePackageToSupabase: async p => { log.saved.push(JSON.parse(JSON.stringify(p))); return true; },
      saveMemoryItem: async (t, v, e) => { log.memory.push([t, v, e]); },
      generatePackage: async () => { log.legacy++; ctx.D.packages.push({ id: 'legacy', engine: 'SRV Farsi', taskId: task.id, generatedAt: new Date().toISOString(), title: 'عنوان', lyrics: 'متن' }); },
      fetch: async (url, opt) => { const body = JSON.parse(opt.body); log.fetches.push(body); const r = replies.shift(); return { ok: true, status: 200, json: async () => r }; },
    };
    vm.createContext(ctx); vm.runInContext(code, ctx);
    return { ctx, log };
  }
  const task = { id: 7, name: 'SRV Farsi — Long · Duet — Happy [TEST]', engine: 'SRV Farsi', mood: 'Duet — Happy', isLong: true, contentType: 'Long', contentFormat: 'long', platform: 'YouTube' };
  const goodPkg = V2.srvfCv2Finalize(GOOD, { artist: 'Duet', mood: 'Happy', gateResults: { passed: true, gates: {} }, attempt: 1 });
  // flag off → legacy path exactly once
  let { ctx, log } = makeCtx({ replies: [{ success: false, code: 'srv_farsi_creative_v2_off' }], task: { ...task } });
  let pkg = await ctx._srvFarsiGenerateWithGuard(7, () => {});
  ok(log.legacy === 1 && pkg && pkg.id === 'legacy' && log.fetches.length === 1, 'flag off → unchanged legacy generatePackage');
  // fail, fail, pass → feedback forwarded, 1 package saved with authority values
  ({ ctx, log } = makeCtx({ replies: [
    { success: false, code: 'srv_farsi_creative_v2_gates_failed', failed: [{ gate: 'G3', reason: 'bridge added' }] },
    { success: false, code: 'srv_farsi_creative_v2_gates_failed', failed: [{ gate: 'G6', reason: 'hook missing' }] },
    { success: true, engineType: 'suno', creativeV2: true, package: { ...goodPkg, mood: 'sad', vocal: 'male', id: 'evil', taskId: 99 } }], task: { ...task } }));
  pkg = await ctx._srvFarsiGenerateWithGuard(7, () => {});
  ok(log.legacy === 0 && log.fetches.length === 3, 'V2 retries within the 3-attempt budget');
  ok(log.fetches[0].artist === 'Duet' && log.fetches[0].mood === 'Happy' && log.fetches[0].format === 'Long' && log.fetches[0].srvFarsiTest === true, 'structured artist/mood/format + test flag sent');
  ok(JSON.stringify(log.fetches[1].feedback) === JSON.stringify([{ gate: 'G3', reason: 'bridge added' }]) && log.fetches[2].feedback[0].gate === 'G6', 'failed-gate reasons fed into the next attempt');
  ok(pkg && pkg.mood === 'happy' && pkg.vocal === 'duet' && pkg.artist === 'Duet' && pkg.mode === 'Duet — Happy' && pkg.taskId === 7 && pkg.id !== 'evil' && pkg.engine === 'SRV Farsi', 'client enforces task authority over the reply');
  ok(ctx.D.packages.length === 1 && ctx.D.packages[0] === pkg && pkg.srvTaskUid === 'srvf_1_7' && pkg.isTest === true, 'one package in state, guard stamps identity + test');
  ok(log.memory.some(m => m[0] === 'central_image' && m[2] === 'srv_farsi') && log.memory.some(m => m[0] === 'mood' && m[1] === 'happy'), 'memory saved Farsi-only incl. diversity fields');
  ok(task.status === undefined, 'test fixture isolation');
  // 3 failures → throws, nothing saved, no legacy fallback
  ({ ctx, log } = makeCtx({ replies: [1, 2, 3].map(() => ({ success: false, code: 'srv_farsi_creative_v2_gates_failed', failed: [{ gate: 'G12', reason: 'too similar' }] })), task: { ...task } }));
  let threw = null; try { await ctx._srvFarsiGenerateWithGuard(7, () => {}); } catch (e) { threw = e; }
  ok(threw && /Creative quality check failed after 3 attempts/.test(threw.message) && log.saved.length === 0 && ctx.D.packages.length === 0 && log.legacy === 0 && log.memory.length === 0, 'exhausted retries: error, no package, no memory, no legacy fallback');
  // network error counts as a failed attempt
  ({ ctx, log } = makeCtx({ replies: [], task: { ...task } }));
  ctx.fetch = async () => { throw new Error('offline'); };
  threw = null; try { await ctx._srvFarsiGenerateWithGuard(7, () => {}); } catch (e) { threw = e; }
  ok(threw && /API/.test(threw.message) && ctx.D.packages.length === 0, 'network failure never creates a package');
  // Short task or legacy mood string → legacy path, no V2 request
  ({ ctx, log } = makeCtx({ replies: [], task: { ...task, isLong: false } }));
  ok((await ctx._srvFarsiCreativeV2Attempt(7, 1, null)).mode === 'legacy' && log.fetches.length === 0, 'Short task never calls V2');
  ({ ctx, log } = makeCtx({ replies: [], task: { ...task, mood: 'Romantic' } }));
  ok((await ctx._srvFarsiCreativeV2Attempt(7, 1, null)).mode === 'legacy', 'task without artist → legacy');
  ok(ctx._srvFarsiCreativeV2ReviewNote({ creativeV2: true, creativeGateResults: { gates: { G1: { pass: true }, G2: { pass: true } }, judge: { hook: { score: 9 } }, attempt: 2 }, mode: 'Male — Happy', sunoPrompt: 'x'.repeat(700) }).includes('2/2 HARD GATES PASSED'), 'Review note renders for V2 packages');
  ok(ctx._srvFarsiCreativeV2ReviewNote({ title: 'legacy' }) === '', 'Review note empty for legacy packages');
}
console.log(`\nSRV Farsi Creative V2: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
