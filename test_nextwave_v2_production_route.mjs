// NextWave V2 production route — routing, gate, QC, wiring and lifecycle-preservation tests.
// Hermetic: the guarded Brain runs on RECORDED model responses (no live call, $0); narration is a stub; nothing is uploaded or published.
//   node test_nextwave_v2_production_route.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { deps as baseDeps, SCRIPTS } from './test_nextwave_v2_storyboard_brain.mjs';
import { nextwaveV2BuildStoryboardSemantic, runCalculations } from './lib/nextwaveV2SemanticStoryboard.mjs';
import { nextwaveV2BuildStoryboard } from './lib/nextwaveV2StoryboardBrain.mjs';
import { makeRecordingCaller, validateProposal } from './lib/nextwaveV2SemanticProposer.mjs';
import { DEV, DEV2, DEV3, DEV4 } from './nextwave_v2_storyboard_eval/dev_set.mjs';
import { STYLE } from './lib/nextwaveV2Renderer/core.mjs';
import { wordsFromAlignment } from './lib/nextwaveV2Renderer/captions.mjs';
import { loadHostPoses } from './lib/nextwaveV2Renderer/assets.mjs';
import { loadBench } from './lib/nextwaveV2Renderer/props3.mjs';
import { startRoute, classifyGate, planAssets, chunkPlan, compileFromState, buildStateFrom } from './lib/nextwaveV2Renderer/production/route.mjs';
import { composeStoryboard } from './lib/nextwaveV2Renderer/production/compose.mjs';
import { runQc, collectDrawnText, numberProvenance, allowedNumbers, occupancy, idleWindows } from './lib/nextwaveV2Renderer/production/qc.mjs';
import { placeScenes, eventTime } from './lib/nextwaveV2Renderer/production/timing.mjs';
import { barEnv } from './lib/nextwaveV2Renderer/production/vocab.mjs';
import { integerToWords, numberToSpokenWords, spanTextToSpoken, expandNumbersForSpeech, wordsFromAlignmentWithSpeechSpans } from './lib/nextwaveV2Renderer/production/speech.mjs';

const BASELINE = 'fa34eb0'; // pre-integration commit: the accepted benchmark standard, before the route was wired into ops.js / index.html
let pass = 0, fail = 0; const failures = [];
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; failures.push(name); console.log('  FAIL', name, '\n       ', e.message.split('\n')[0]); } };

// recorded model responses (offline replay)
const store = new Map(); for (const f of ['proofs.json', 'dev.json', 'production_dryrun.json']) Object.entries(JSON.parse(fs.readFileSync(`./nextwave_v2_storyboard_eval/recordings/${f}`, 'utf8'))).forEach(([k, v]) => store.set(k, v));
const tally = { live_calls: 0, replayed: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
const callModel = makeRecordingCaller({ live: null, store, tally });
const brain = (s) => nextwaveV2BuildStoryboardSemantic(s, { ...baseDeps, callModel });
const synthAlign = (text) => { const w = [...text].map((c) => (/[.!?]/.test(c) ? 6 : /[,;:]/.test(c) ? 3 : c === ' ' ? 0.6 : /[\d$%]/.test(c) ? 1.7 : 1)); const tot = w.reduce((a, b) => a + b, 0); let acc = 0; const s = [], e = []; w.forEach((x) => { s.push((acc / tot) * 40 + 0.1); acc += x; e.push((acc / tot) * 40 + 0.1); }); return { characters: [...text], character_start_times_seconds: s, character_end_times_seconds: e }; };
const mkDeps = (over = {}) => { const calls = { narrate: 0, assets: 0 }; return { calls, deps: { buildStoryboard: brain, loadPoses: loadHostPoses, loadBench, narrate: async (text) => { calls.narrate++; return { ok: true, alignment: synthAlign(text), audio_url: 'stub://narration.mp3' }; }, ...over } }; };
const PB = SCRIPTS.B ? SCRIPTS.B : null;
const scriptOf = (name) => { const s = SCRIPTS[name]; return typeof s === 'string' ? s : s.script || s.text; };
const PASS_SCRIPT = scriptOf('B'); const PASS_SHORT = scriptOf('A');
const ALL = [...DEV, ...DEV2, ...DEV3, ...DEV4, ...(await import('./nextwave_v2_storyboard_eval/final_holdout.mjs')).FINAL, ...(await import('./nextwave_v2_storyboard_eval/fresh_holdout.mjs')).FRESH, ...(await import('./nextwave_v2_storyboard_eval/third_holdout.mjs')).THIRD]; const NR = ALL.find((c) => c.id === 'U1_direction_unknown');

console.log('\n[1] routing proof — PASS / NEEDS_REVIEW / BLOCK');
await t('PASS: clean Brain result -> planned; narration called once; chunk plan built', async () => { const { deps, calls } = mkDeps(); const r = await startRoute({ script: PASS_SCRIPT, formatName: 'long', title: 't', deps }); assert.equal(r.gate.route, 'PASS'); assert.equal(r.status, 'planned'); assert.equal(calls.narrate, 1); assert.ok(r.chunks.length >= 4); assert.equal(r.vendor.elevenlabs_chars, PASS_SCRIPT.length); assert.equal(r.qc_pre_render.ok, true); });
await t('NEEDS_REVIEW: stops before narration/assets/render; exception owner = VA Production / Product QC', async () => { const { deps, calls } = mkDeps(); const r = await startRoute({ script: NR.script, formatName: 'short', deps }); assert.equal(r.gate.route, 'NEEDS_REVIEW'); assert.equal(r.status, 'needs_review'); assert.equal(calls.narrate, 0); assert.equal(r.vendor.elevenlabs_chars, 0); assert.equal(r.vendor.ideogram_images, 0); assert.ok(!r.chunks); assert.equal(r.exception.owner, 'va_production_product_qc'); assert.ok(r.exception.reasons.length > 0); });
await t('BLOCK: a script whose stated figure contradicts the calculators stops (no spend)', async () => { const bad = 'Say you invest five hundred dollars every month at an average eight percent annual return. If you start today, that portfolio grows to about ninety nine thousand dollars after ten years. But if you wait five years before you start, contributing the same five hundred dollars a month for the remaining five years, you end up with only about thirty six thousand, seven hundred thirty eight dollars.'; const { deps, calls } = mkDeps({ buildStoryboard: async (s) => nextwaveV2BuildStoryboard(s, baseDeps) }); const r = await startRoute({ script: bad, formatName: 'short', deps }); assert.equal(r.gate.route, 'BLOCK'); assert.equal(r.status, 'blocked'); assert.equal(calls.narrate, 0); assert.ok(r.gate.reasons.some((x) => x.kind === 'stated_value_inconsistent')); assert.equal(r.exception.owner, 'engineering_triage'); });
await t('BLOCK: Brain throws -> blocked, never a silent fallback', async () => { const { deps, calls } = mkDeps({ buildStoryboard: async () => { throw new Error('model down'); } }); const r = await startRoute({ script: PASS_SCRIPT, formatName: 'long', deps }); assert.equal(r.status, 'blocked'); assert.equal(calls.narrate, 0); assert.equal(r.gate.reasons[0].kind, 'brain_error'); });
await t('NEEDS_REVIEW: clean storyboard with an unsupported treatment is stopped', async () => { const { deps, calls } = mkDeps({ buildStoryboard: async (s) => { const sb = await brain(s); sb.scenes[1].renderer_params.treatment = 'hologram'; return sb; } }); const r = await startRoute({ script: PASS_SCRIPT, formatName: 'long', deps }); assert.equal(r.status, 'needs_review'); assert.equal(calls.narrate, 0); assert.equal(r.gate.reasons[0].kind, 'unsupported_treatment'); });
await t('unknown integrity status is treated as BLOCK (fail closed)', () => { assert.equal(classifyGate({ ok: true, integrity: { status: 'weird', issues: [] }, scenes: [] }).route, 'BLOCK'); assert.equal(classifyGate(null).route, 'BLOCK'); assert.equal(classifyGate({ ok: false, error: 'x' }).route, 'BLOCK'); });
await t('input validation: bad format / empty / over-length script -> blocked before any Brain call', async () => { let brainCalls = 0; const { deps } = mkDeps({ buildStoryboard: async () => { brainCalls++; return {}; } }); assert.equal((await startRoute({ script: 'x', formatName: 'square', deps })).status, 'blocked'); assert.equal((await startRoute({ script: '   ', formatName: 'short', deps })).status, 'blocked'); assert.equal((await startRoute({ script: 'a'.repeat(1600), formatName: 'short', deps })).status, 'blocked'); assert.equal(brainCalls, 0); });
await t('replay proof: every Brain call above was replayed from recordings (0 live calls, $0)', () => { assert.equal(tally.live_calls, 0); assert.ok(tally.replayed > 0); assert.equal(tally.cost_usd, 0); });
await t('compose() itself refuses a non-clean storyboard (defence in depth)', async () => { const sb = await brain(PASS_SCRIPT); sb.integrity.status = 'needs_review'; const words = wordsFromAlignment(PASS_SCRIPT, synthAlign(PASS_SCRIPT)); assert.throws(() => composeStoryboard({ storyboard: sb, words, assets: { poses: {}, bench: {} }, format: STYLE.formats.long }), /refuses storyboard/); });

console.log('\n[2] asset routing — reuse-first; only a missing bank file would call Ideogram');
await t('all bank assets present -> reused, 0 generated, $0', async () => { const sb = await brain(scriptOf('C')); const p = planAssets(sb, await loadBench(), 'long'); assert.equal(p.missing.length, 0); assert.equal(p.est_ideogram_usd, 0); });
await t('asset requirements from the Brain resolve to programmatic props / environment families (no per-scene generation)', async () => { const sb = await brain(PASS_SHORT); const p = planAssets(sb, await loadBench(), 'short'); assert.ok(p.requirements.every((r) => r.resolution.startsWith('programmatic'))); });
await t('missing bank asset without a generator -> NEEDS_REVIEW (stops before narration); with a generator -> bounded priced request', async () => { const b = await loadBench(); const noBag = async () => ({ ...b, prop: { ...b.prop, bag: undefined } }); const A1 = mkDeps({ loadBench: noBag }); const r = await startRoute({ script: PASS_SHORT, formatName: 'short', deps: A1.deps }); assert.equal(r.gate.route, 'PASS'); assert.equal(r.status, 'needs_review'); assert.equal(r.exception.reasons[0].kind, 'bank_asset_missing'); assert.equal(A1.calls.narrate, 0); const gen = []; let generated = false; const A2 = mkDeps({ loadBench: async () => (generated ? b : noBag()), generateAsset: async (m) => { gen.push(m); generated = true; } }); const r2 = await startRoute({ script: PASS_SHORT, formatName: 'short', deps: A2.deps }); assert.equal(gen.length, 1); assert.equal(gen[0].key, 'prop.bag'); assert.equal(r2.asset_plan.est_ideogram_usd, 0.03); });
await t('planned assets never include text in prompts', async () => { const { ASSET_PROMPTS } = await import('./lib/nextwaveV2Renderer/production/route.mjs'); Object.values(ASSET_PROMPTS).forEach((p) => assert.ok(!/\b(text|letters|numbers|words|caption)\b/i.test(p.replace(/no text/i, '')))); });

console.log('\n[3] automated QC actually catches failures');
const fmtLong = STYLE.formats.long; const sbPass = await brain(PASS_SCRIPT); const wordsPass = wordsFromAlignment(PASS_SCRIPT, synthAlign(PASS_SCRIPT)); const Cp = composeStoryboard({ storyboard: sbPass, words: wordsPass, assets: { poses: await loadHostPoses(), bench: await loadBench() }, format: fmtLong });
await t('clean composition passes QC (numbers provenanced, occupancy ok, no idle window, captions in safe area)', () => { const q = runQc({ format: fmtLong, formatName: 'long', drawFrame: Cp.draw, duration: Cp.duration, scenes: Cp.scenes, storyboard: sbPass, script: PASS_SCRIPT, derived: Cp.derived, words: wordsPass }); assert.equal(q.ok, true, JSON.stringify(q.issues)); assert.ok(q.numbers.drawn_tokens > 50); });
await t('an unprovenanced number painted on screen is caught', () => { const evil = (g, tm) => { Cp.draw(g, tm); g.font = '40px sans-serif'; g.fillText('$12,345 GUARANTEED', 200, 200); }; const q = runQc({ format: fmtLong, formatName: 'long', drawFrame: evil, duration: Cp.duration, scenes: Cp.scenes, storyboard: sbPass, script: PASS_SCRIPT, derived: Cp.derived, words: wordsPass }); assert.equal(q.ok, false); assert.ok(q.issues.some((i) => i.kind === 'unprovenanced_number_on_screen')); });
await t('an empty (idle) frame function is caught by occupancy + idle checks', () => { const blank = (g) => { g.fillStyle = '#F7F4EE'; g.fillRect(0, 0, fmtLong.w, fmtLong.h); }; const q = runQc({ format: fmtLong, formatName: 'long', drawFrame: blank, duration: 12, scenes: [{ id: 'S1', treatment: 'avatar_panel', start: 0, end: 12 }], storyboard: sbPass, script: PASS_SCRIPT, derived: [], words: wordsPass }); assert.ok(q.issues.some((i) => i.kind === 'frame_occupancy_low')); assert.ok(q.issues.some((i) => i.kind === 'idle_window')); });
await t('a caption chunk outside the safe area is caught', () => { const words = [{ w: 'x', start: 0, end: 1 }]; const q = runQc({ format: STYLE.formats.short, formatName: 'short', drawFrame: (g) => { g.fillRect(0, 0, 10, 10); }, duration: 2, scenes: [{ id: 'S', treatment: 'x', start: 0, end: 2 }], storyboard: { values: [], scenes: [] }, script: 'x', derived: [], words, minEdge: 0 }); assert.ok(q.captions.max_bottom <= q.captions.safe_bottom); });
await t('numeric provenance accepts spoken/verified numbers and rejects others', () => { const allowed = allowedNumbers({ storyboard: sbPass, script: PASS_SCRIPT, derived: Cp.derived }); assert.ok(allowed.has('54735')); assert.ok(!allowed.has('54736')); });

console.log('\n[3b] narrative treatment — arbitrary Brain-PASS scripts render richly and without unprovenanced numbers');
const { topicOf, comparisons } = await import('./lib/nextwaveV2Renderer/production/narrative.mjs');
await t('topic precedence: savings/deposit evidence never becomes loan just because of the word "rate"; loan evidence still wins for debt', () => {
  const cases = [
    ['Imagine you put $20,000 in a savings account for 15 years. At a 5 percent rate you would end up with more.', 'savings'],
    ['A high-yield deposit paying a 4.5% APY grows your balance.', 'savings'],
    ['Say you borrow $350,000 for 30 years. At a 6% rate you pay back about that much.', 'loan'],
    ['The APR on your loan decides what the debt really costs.', 'loan'],
    ['Refinance your mortgage when the rate drops.', 'loan'],
    ['Your index fund earns a 7 percent rate of return each year.', 'invest'],
    ['With a fund charging 1 percent a year, fees eat into your return.', 'invest'],
    ['At a 5% rate,', null],
    ['Your savings account earns interest, but your mortgage charges more.', 'loan'],
  ]; cases.forEach(([txt, want]) => assert.equal(topicOf(txt), want, txt)); });
await t('environment follows the topic of the argument (delay->road, loan->city, invest->office, prices->kitchen)', () => { assert.equal(topicOf('The first is when you start.'), 'time'); assert.equal(topicOf('Say you borrow $250,000 for 30 years.'), 'loan'); assert.equal(topicOf('Invest $400 every month.'), 'invest'); assert.equal(topicOf('Prices rise 3% a year.'), 'price'); assert.equal(topicOf('Nothing topical here.'), null); });
await t('composed Long: avatar scenes carry a focal object (no host-only scenes); environments change with the argument; closing is a recap of every comparison', async () => { const C2 = composeStoryboard({ storyboard: await brain(scriptOf('B')), words: wordsFromAlignment(scriptOf('B'), synthAlign(scriptOf('B'))), assets: { poses: await loadHostPoses(), bench: await loadBench() }, format: fmtLong }); const av = C2.scenes.filter((x) => x.treatment === 'avatar_panel'); assert.ok(av.length >= 2); assert.ok(av.every((x) => ['metaphor', 'value_stack', 'timeline', 'recap'].includes(x.kit)), JSON.stringify(av)); assert.equal(av[av.length - 1].kit, 'recap'); });
await t('chart scenes open with the subject (verified recurring amount / principal) on screen before the first line; short bridges are merged into the next evidence scene', async () => { const sbB = await brain(scriptOf('B')); const wB = wordsFromAlignment(scriptOf('B'), synthAlign(scriptOf('B'))); const C4 = composeStoryboard({ storyboard: sbB, words: wB, assets: { poses: await loadHostPoses(), bench: await loadBench() }, format: fmtLong }); const ch = C4.scenes.find((x) => x.treatment === 'stock_chart'); assert.ok(ch); assert.ok(['physical_race', 'physical_orchard', 'chart_story'].includes(ch.kit), ch.kit); const drawn = collectDrawnText({ format: fmtLong, drawFrame: C4.draw, times: [ch.start + 1.8] })[0].strings.join(' '); assert.ok(/\$500/.test(drawn), 'subject value not on screen before the chart: ' + drawn.slice(0, 200)); const shortBridge = sbB.scenes.filter((x, i) => i > 0 && i < sbB.scenes.length - 1 && x.renderer_params.treatment === 'avatar_panel'); assert.ok(C4.scenes.every((x) => x.treatment !== 'avatar_panel' || x.end - x.start >= 3.6 || x.id === sbB.scenes[0].scene_id || x.id === sbB.scenes[sbB.scenes.length - 1].scene_id), 'a sub-3.6 s bridge survived as its own scene'); });
const { selectPhysical } = await import('./lib/nextwaveV2Renderer/production/physical.mjs');
await t('physical selection rules: delay marker -> race; two series no delay -> orchard; one series / 3 series / unparsable -> chart-card fallback', () => { const mk = (series, markerIndex) => ({ p: { series, markerIndex } }); const S = (v) => ({ finalValueText: v, points: [0, 1, 2, 3] }); assert.equal(selectPhysical(mk([S('$100'), S('$50')], 5)).kind, 'race'); assert.equal(selectPhysical(mk([S('$100'), S('$50')], 0)).kind, 'orchard'); assert.equal(selectPhysical(mk([S('$100')], 0)), null); assert.equal(selectPhysical(mk([S('$1'), S('$2'), S('$3')], 0)), null); assert.equal(selectPhysical(mk([S('n/a'), S('$2')], 0)), null); });
await t('physical scenes: the two subjects share ONE scale and the gap tag is derived from the verified finals; every render passes number provenance', async () => { const sbB = await brain(scriptOf('B')); const wB = wordsFromAlignment(scriptOf('B'), synthAlign(scriptOf('B'))); for (const fm of [fmtLong, STYLE.formats.short]) { const C5 = composeStoryboard({ storyboard: sbB, words: wB, assets: { poses: await loadHostPoses(), bench: await loadBench() }, format: fm }); const ch = C5.scenes.find((x) => x.treatment === 'stock_chart'); assert.ok(/^physical_/.test(ch.kit), fm.w + ' ' + ch.kit); assert.ok(C5.derived.some((d) => d.formula === 'abs(final_a - final_b)')); } });
const { tagBox, overlapArea, placeFirst } = await import('./lib/nextwaveV2Renderer/production/physical.mjs');
await t('generalized tag-collision rule: for 300 random verified value pairs the gap tag never overlaps a value tag when any candidate slot is free', () => { let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280); let bad = 0; for (let n = 0; n < 300; n++) { const a = 50000 + rnd() * 900000, b = a * (0.15 + rnd() * 0.8); const per = 255 / a; const xa = 1500, xb = 1900, ta = 700 - a * per, tb = 700 - b * per; const va = tagBox(xa, ta - 52, '$' + Math.round(a), 44, 'START TODAY', 20, 'down'), vb = tagBox(xb, tb - 52, '$' + Math.round(b), 44, 'WAIT', 20, 'down'); const placed = [va, vb]; const mid = (ta + tb) / 2; const cands = [[xb + 170, mid], [1700, Math.min(va.y0, vb.y0) - 90], [xb + 170, ta - 100], [xb + 40, Math.max(ta, tb) + 130]].map(([x, y]) => ({ x, y, box: tagBox(x, y, '$' + Math.round(a - b), 56, 'THE GAP', 22, 'none') })); const pick = placeFirst(cands, placed, { x0: 40, x1: 2360, y0: 150, y1: 4000 }); if (pick.cost === undefined && placed.some((q) => overlapArea(pick.box, q) > 0)) bad++; } assert.equal(bad, 0); });
await t('comparisons() collects every verified comparison (two-topic script -> 2 gaps, each with its own topic label)', async () => { const two = await brain(scriptOf('B')); assert.ok(comparisons(two.scenes).length >= 1); });
await t('robustness: every recorded Brain-PASS script (Short and Long formats) composes, paints, and passes on-screen number provenance', async () => { let n = 0, bad = []; const poses = await loadHostPoses(), bench = await loadBench(); for (const c of ALL) { let sb; try { sb = await brain(c.script); } catch { continue; } if (!sb.ok || sb.integrity.status !== 'clean') continue; if (!sb.scenes.every((x) => ['avatar_panel', 'money_flow', 'day_cards', 'stock_chart', 'share_compare', 'calc_card'].includes(x.renderer_params.treatment))) continue; for (const fname of ['short', 'long']) { const fm = STYLE.formats[fname]; const words = wordsFromAlignment(c.script, synthAlign(c.script)); let C3; try { C3 = composeStoryboard({ storyboard: sb, words, assets: { poses, bench }, format: fm }); } catch (e) { bad.push(c.id + ':' + fname + ':' + e.message); continue; } const times = []; for (let x = 0.7; x < C3.duration; x += 2.5) times.push(x); const drawn = collectDrawnText({ format: fm, drawFrame: C3.draw, times }); const pv = numberProvenance({ drawn, allowed: allowedNumbers({ storyboard: sb, script: c.script, derived: C3.derived }) }); if (!pv.ok) bad.push(c.id + ':' + fname + ':' + JSON.stringify(pv.unprovenanced[0])); n++; } } assert.ok(n >= 20, 'too few scripts exercised: ' + n); assert.deepEqual(bad, [], bad.slice(0, 3).join(' | ')); console.log('       exercised', n, 'script/format renders'); });
console.log('\n[4] timing — scenes located in the spoken word stream; reveals anchored to spoken values');
await t('every scene located; contiguous; reveal time inside its scene', () => { const spans = placeScenes(sbPass.scenes, wordsPass); assert.ok(spans.every((s) => s.located)); spans.forEach((s, i) => { assert.ok(s.end > s.start); if (i) assert.ok(Math.abs(s.start - spans[i - 1].end) < 1e-6); }); const ev = eventTime(wordsPass, spans[1], sbPass.scenes[1].renderer_params.meaning_event_pattern); assert.ok(ev.t >= spans[1].start && ev.t <= spans[1].end); });
await t('chunk plan covers the full duration with no gaps', () => { const c = chunkPlan(84.53); assert.equal(c[0].tStart, 0); const sum = c.reduce((a, x) => a + x.dur, 0); assert.ok(Math.abs(sum - 84.53) < 1e-6); c.forEach((x, i) => { if (i) assert.ok(Math.abs(x.tStart - (c[i - 1].tStart + c[i - 1].dur)) < 1e-6); }); });
await t('deterministic recompile from persisted state gives the identical frame (chunk invocations agree)', async () => { const r = await startRoute({ script: PASS_SCRIPT, formatName: 'long', title: 'x', deps: mkDeps().deps }); const st = JSON.parse(JSON.stringify(buildStateFrom(r, { title: 'x', buildId: 'nwv2r-0000000000000000', model: {} }))); const a = await compileFromState(st, { loadPoses: loadHostPoses, loadBench }); const { stillFrame } = await import('./lib/nextwaveV2Renderer/render.mjs'); const f1 = stillFrame({ format: a.format, drawFrame: r._compiled.C.draw, t: 20 }), f2 = stillFrame({ format: a.format, drawFrame: a.C.draw, t: 20 }); assert.ok(Buffer.compare(f1, f2) === 0); });

console.log('\n[5] ops.js wiring — auth, flag, isolation');
const ops = fs.readFileSync('./api/ops.js', 'utf8');
const handlerBody = (name) => { const i = ops.indexOf(`async function ${name}(`); assert.ok(i > 0, name); return ops.slice(i, ops.indexOf('\n}\n', i)); };
await t('start/chunk/finish/status/set_enabled are CEO-session gated before doing anything', () => { ['nextwaveV2RouteStart', 'nextwaveV2RouteChunk', 'nextwaveV2RouteFinish', 'nextwaveV2RouteStatus', 'nextwaveV2RouteSetEnabled'].forEach((n) => { const b = handlerBody(n); assert.ok(/^async function \w+\(req, res\) \{\n  if \(!\(await requireCeoSession\(req\)\)\) return res\.status\(401\)/.test(b), n + ' not gated first'); }); });
await t('start/chunk/finish refuse to run while the flag is OFF (409 v2_route_disabled)', () => { ['nextwaveV2RouteStart', 'nextwaveV2RouteChunk', 'nextwaveV2RouteFinish'].forEach((n) => assert.ok(handlerBody(n).includes("v2_route_disabled"), n)); });
await t('flag defaults OFF (missing row, parse error or DB error -> disabled)', () => { const b = handlerBody('nwv2rIsEnabled'); assert.ok(b.includes('return false;') && b.includes('v.enabled === true')); });
await t('config is read-only and returns no secrets; set_enabled is not called by any client code', () => { assert.ok(!/requireCeoSession/.test(handlerBody('nextwaveV2RouteConfig'))); const html = fs.readFileSync('./public/index.html', 'utf8'); assert.ok(!html.includes('nextwave_v2_route_set_enabled')); });
await t('renderer library is lazily imported (no top-level import: other actions unaffected)', () => { assert.ok(!/^import .*nextwaveV2Renderer/m.test(ops)); assert.ok(!/^import .*SemanticStoryboard/m.test(ops)); assert.ok(handlerBody('nwv2rLib').includes("import('../lib/nextwaveV2Renderer/production/route.mjs')")); });
await t('route actions never reference HeyGen / Submagic / YouTube / publish', () => { const block = ops.slice(ops.indexOf('const NWV2R_FLAG_KEY'), ops.indexOf('async function nextwaveV2CompositeLongSegmentRender')); assert.ok(!/heygen|submagic|youtube|tiktok|publish(?!ing_router)/i.test(block.replace(/Nothing here publishes\.|does not publish|never publishes/gi, '').replace(/no HeyGen/gi, '')), 'forbidden vendor/publish reference in route block'); });
await t('every pre-existing NextWave V2 action is still dispatched (nothing removed or renamed)', () => { ['nextwave_v2_build_render', 'nextwave_v2_composite_white_motion', 'nextwave_v2_composite_long_segment', 'nextwave_v2_concat_long', 'nextwave_v2_storyboard_brain', 'nextwave_v2_prepare_master_narration', 'heygen_start_render', 'heygen_render_status', 'generate_package', 'approve'].forEach((a) => assert.ok(ops.includes(`action === '${a}'`), a)); });
// Production Hardening Release A2 (2026-09-28) — one exception is now allow-listed: the
// SRV-Farsi-only playlist-name fallback was hardcoded regardless of engine, which would have
// mis-named NextWave's playlists. The new line is a byte-for-byte no-op for every existing
// (non-NextWave) caller (same lookup, same fallback string when engine !== 'NextWave') and adds
// a NextWave-only fallback branch — reviewed and authorized, not a silent/unbounded change.
const OPS_A2_ALLOWED_REMOVED_LINES = new Set([
  "        const plTitle = _FARSI_PLAYLIST_MAP[playlistCategory] || ('SRV Farsi - ' + playlistCategory);",
  "const NEXTWAVE_V2_NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|' +",
  "  'fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion';",
  "  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,",
  "  result += current + halfBonus;",
  "  return { value: result, suffix };",
]);
// Reconciliation closeout (2026-10-03) — this test's comparison point was `BASELINE` (fa34eb0, the
// commit immediately before NextWave existed in this file at all). That stopped being the right
// zero-point the moment NextWave's branch was reconciled onto current main: main had independently
// shipped 17 of its OWN commits (SRV Farsi analytics/lifecycle work, Platform business isolation,
// etc.) since fa34eb0, touching this same file in places unrelated to NextWave. Diffing the
// reconciled file against fa34eb0 therefore now ALSO flags main's own already-shipped, already-reviewed
// edits as if they were unexpected NextWave removals — 8 such lines, verified by hand to belong
// exclusively to `revenueDashboard`/`decisionEngine`/`analyticsFoundationReport` (main-only changed
// functions, confirmed via `git diff fa34eb0..origin/main` line-range inspection), none to NextWave.
// The fix is NOT to broaden the allow-list (that would make the test blind to a real NextWave
// deletion in that same region) and NOT to delete the assertion (that would remove the protection
// entirely). It's to move the zero-point forward to `MAIN_RECONCILE_BASELINE` — origin/main's HEAD
// immediately before this merge — which is the version of the file NextWave's merge was actually
// applied ON TOP OF. Relative to THAT point, main's independent work is already fully present on
// both sides of the comparison (not a removal), while every genuine NextWave edit this test exists
// to catch is unchanged (NextWave's own code didn't exist in main before the merge either, same as it
// didn't exist in fa34eb0) — confirmed empirically: the exact same 6-line OPS_A2 allow-list, unchanged,
// produces zero unexpected lines against the new baseline. The protection is equivalent, not weaker:
// it still fails on any unreviewed deletion of pre-existing (now: current-main) code by NextWave's own
// commits; it simply no longer blames main's unrelated, independently-reviewed work for existing.
const MAIN_RECONCILE_BASELINE = '479f7bff437e5c2f4412927b0fae3572217c97dc'; // origin/main HEAD immediately before the NextWave <-> main reconciliation merge
await t('ops.js diff vs the pre-reconciliation main baseline is purely additive except the dispatcher lines and the Release A2/decimal-repair allow-list', () => { const base = execFileSync('git', ['show', MAIN_RECONCILE_BASELINE + ':api/ops.js'], { maxBuffer: 1 << 28 }).toString().split('\n'); const cur = ops.split('\n'); const baseSet = new Map(); base.forEach((l) => baseSet.set(l, (baseSet.get(l) || 0) + 1)); let removed = 0; const unexpected = []; const curSet = new Map(); cur.forEach((l) => curSet.set(l, (curSet.get(l) || 0) + 1)); baseSet.forEach((n, l) => { const m = curSet.get(l) || 0; if (m < n) { const delta = n - m; removed += delta; if (!OPS_A2_ALLOWED_REMOVED_LINES.has(l)) unexpected.push(l); } }); assert.equal(unexpected.length, 0, `unexpected pre-existing lines removed/changed in ops.js: ${JSON.stringify(unexpected)}`); assert.ok(removed <= OPS_A2_ALLOWED_REMOVED_LINES.size, `${removed} pre-existing lines removed/changed in ops.js (expected at most ${OPS_A2_ALLOWED_REMOVED_LINES.size})`); });

await t('build id includes the renderer revision (stale chunks can never be reused) and ops rev == route lib version', async () => { const { ROUTE_VERSION } = await import('./lib/nextwaveV2Renderer/production/route.mjs'); assert.ok(ops.includes(`const NWV2R_REV = '${ROUTE_VERSION}'`)); assert.ok(/update\(`\$\{NWV2R_REV\}\|\$\{format\}\|\$\{script\}`\)/.test(ops)); });
console.log('\n[3c] topic-specific illustration layer (bounded preview integration)');
const { chooseIllustratedBeats, assetKey, buildPrompt, qcPrompt, parseQcResponse, routingModeFor } = await import('./lib/nextwaveV2Renderer/production/illustration.mjs');
const { deriveSceneSpec } = await import('./lib/nextwaveV2Renderer/production/scenespec.mjs');
const { resolveIllustration } = await import('./lib/nextwaveV2Renderer/production/route.mjs');
await t('beat selection: Long -> its own hook plus its richest substantive comparison beat (Illustration Generation Quality Gate order §4); Short -> the richest comparison beat only, never the hook/close, never more than one', async () => { const sbB = await brain(scriptOf('B')); const cL = chooseIllustratedBeats(sbB.scenes, 'long'); assert.equal(cL.hookIdx, 0); assert.ok(cL.dominantIdx > 0 && cL.dominantIdx < sbB.scenes.length - 1, 'Long must independently qualify a substantive evidence/comparison beat, not just the hook'); assert.notEqual(cL.dominantIdx, cL.hookIdx); const sbA = await brain(scriptOf('A')); const cS = chooseIllustratedBeats(sbA.scenes, 'short'); assert.ok(cS.dominantIdx > 0 && cS.dominantIdx < sbA.scenes.length - 1); assert.equal(cS.hookIdx, -1); });
await t('reusable per-relationship-family metaphor strategy: erosion/delayed_start/rate_outcome families each get a distinct physical-metaphor prompt, not a per-topic string table', () => { const mk = (relationship) => buildPrompt({ visual_objective: 'x', relationship, required_subjects: 'fallback subject', environment_hint: 'financial district', format: 'long' });
  const erosion = mk('fee_drag'); assert.equal(erosion.family, 'erosion'); assert.ok(/losing part of itself|draining/i.test(erosion.prompt));
  const delayed = mk('delay'); assert.equal(delayed.family, 'delayed_start'); assert.ok(/head start/i.test(delayed.prompt));
  const rateA = mk('loan_cost'), rateB = mk('savings_split'); assert.equal(rateA.family, 'rate_outcome'); assert.equal(rateB.family, 'rate_outcome'); assert.ok(/same starting point/i.test(rateA.prompt)); assert.equal(rateA.prompt.includes('same starting point'), rateB.prompt.includes('same starting point'), 'same family -> same reusable metaphor regardless of topic');
  const none = mk(null); assert.equal(none.family, null); assert.ok(none.prompt.includes('fallback subject'), 'no family match falls back to the Scene Spec required_subjects, never a topic-specific string');
});
await t('prompt strengthens text-leakage prevention with an explicit zero-readable-characters instruction and an expanded negative-prompt ban list, without weakening the Claude-vision QC gate itself', () => { const p = buildPrompt({ visual_objective: 'x', required_subjects: 'y', environment_hint: 'z', format: 'short' }); assert.ok(/ZERO readable characters/i.test(p.prompt)); assert.ok(/axis|dashboard|ticker|price tag/i.test(p.negative)); });
await t('Scene Spec never invents a fact: every evidence entry traces back to a real storyboard value id', async () => { const sbB = await brain(scriptOf('B')); const valuesById = new Map(sbB.values.map((v) => [v.id, v])); const spec = deriveSceneSpec({ scene: sbB.scenes[0], index: 0, allScenes: sbB.scenes, format: 'long', valuesById }); spec.evidence.forEach((e) => assert.ok(valuesById.has(e.entity_id))); assert.equal(spec.relationship, 'hook'); });
await t('Release B2: meaning_units map each concrete reveal to a real value (no invented facts), tag it with a semantic visual_event, and only the last beat has no exit_transition', async () => { const sbB = await brain(scriptOf('B')); const valuesById = new Map(sbB.values.map((v) => [v.id, v])); const cL = chooseIllustratedBeats(sbB.scenes, 'long');
  const dominant = deriveSceneSpec({ scene: sbB.scenes[cL.dominantIdx], index: cL.dominantIdx, allScenes: sbB.scenes, format: 'long', valuesById });
  assert.ok(dominant.meaning_units.length >= 2, 'the dominant comparison beat should have more than one concrete reveal to sequence');
  dominant.meaning_units.forEach((u) => { assert.ok(valuesById.has(u.entity_id), 'meaning unit not traceable to a real storyboard value'); assert.ok(['subject_intro', 'evidence_reveal', 'comparison', 'transformation', 'emphasis'].includes(u.visual_event), u.visual_event); assert.ok(['subject', 'object'].includes(u.subject_or_object)); assert.equal(u.host_role, 'point'); });
  assert.equal(dominant.meaning_units[dominant.meaning_units.length - 1].visual_event, 'emphasis', 'a multi-reveal beat should land its last concrete reveal as the emphasis');
  const lastIdx = sbB.scenes.length - 1; const closeSpec = deriveSceneSpec({ scene: sbB.scenes[lastIdx], index: lastIdx, allScenes: sbB.scenes, format: 'long', valuesById });
  (closeSpec.meaning_units || []).forEach((u) => assert.equal(u.exit_transition, false, 'the video\'s final beat must never signal an exit/transition to a next beat that does not exist'));
});
await t('prompt/QC text ban authoritative content but do not ban illustrated people (PM correction)', () => { const p = buildPrompt({ visual_objective: 'x', required_subjects: 'two people at different ages', environment_hint: 'home', format: 'long' }); assert.ok(!/no people/i.test(p.negative)); assert.ok(/text/i.test(p.negative) && /numbers/i.test(p.negative)); const q = qcPrompt({ visual_objective: 'x', required_subjects: 'y', format: 'long' }); assert.ok(/people ARE allowed/i.test(q)); assert.ok(!/reject.*any people/i.test(q)); });
await t('QC response parser: rejects malformed/missing JSON safely (fail closed)', () => { assert.equal(parseQcResponse('not json').pass, false); assert.equal(parseQcResponse('{"pass":true,"reasons":[]}').pass, true); assert.deepEqual(parseQcResponse('{"pass":false,"reasons":["x","y"]}').reasons, ['x', 'y']); });
await t('resolveIllustration: reuse costs nothing; generate+QC-pass registers a NEW asset (not yet reusable); QC-fail/exception falls back and marks creative_qc needs_review, never silently pass', async () => { const sbB = await brain(scriptOf('B'));
  // Long now independently qualifies BOTH its hook and its substantive comparison beat (order §4), so a stub that
  // always resolves the same way is invoked once per qualified beat -> 2, not 1.
  const beatCount = chooseIllustratedBeats(sbB.scenes, 'long'); const expected = (beatCount.hookIdx >= 0 ? 1 : 0) + (beatCount.dominantIdx >= 0 ? 1 : 0); assert.ok(expected >= 2, 'fixture script must qualify at least hook+comparison for this test to be meaningful');
  const reuseDeps = { illustrateBeat: async () => ({ ok: true, mode: 'reuse', asset_url: 'https://x/reused.png', vendor: { ideogram_images: 0, ideogram_usd: 0, qc_calls: 0, qc_usd: 0 } }) };
  const r1 = await resolveIllustration(sbB, 'long', reuseDeps); assert.equal(r1.counts.reused, expected); assert.equal(r1.counts.generated, 0); assert.equal(r1.vendor.ideogram_usd, 0); assert.equal(r1.creative_qc.status, 'pass');
  const genDeps = { illustrateBeat: async () => ({ ok: true, mode: 'generate', asset_url: 'https://x/new.png', asset_id: 'a1', vendor: { ideogram_images: 1, ideogram_usd: 0.03, qc_calls: 1, qc_usd: 0.01 } }) };
  const r2 = await resolveIllustration(sbB, 'long', genDeps); assert.equal(r2.counts.generated, expected); assert.equal(r2.vendor.ideogram_usd, 0.03 * expected); assert.equal(r2.creative_qc.status, 'pass');
  const failDeps = { illustrateBeat: async () => ({ ok: false, mode: 'fallback', reasons: ['qc_rejected: no match'], vendor: { ideogram_images: 1, ideogram_usd: 0.03, qc_calls: 2, qc_usd: 0.02 } }) };
  const r3 = await resolveIllustration(sbB, 'long', failDeps); assert.equal(r3.counts.fallback, expected); assert.equal(r3.creative_qc.status, 'needs_review'); assert.equal(r3.creative_qc.owner, 'va_production_product_qc'); assert.ok(r3.creative_qc.reasons[0].reasons[0].includes('qc_rejected'));
  const throwDeps = { illustrateBeat: async () => { throw new Error('network down'); } }; const r4 = await resolveIllustration(sbB, 'long', throwDeps); assert.equal(r4.creative_qc.status, 'needs_review'); assert.ok(r4.creative_qc.reasons[0].reasons[0].includes('illustrate_exception'));
  const skipped = await resolveIllustration(sbB, 'long', {}); assert.equal(skipped, null); // no deps.illustrateBeat -> byte-for-byte renderer-2.1 behavior
});
console.log('\n[3d] semantic routing finalization (erosion/fee-drag -> deterministic; delayed_start/rate_outcome -> generate, unchanged)');
await t('routing table: erosion -> deterministic; delayed_start and rate_outcome -> generate, unchanged; unknown relationship -> generate (default, byte-for-byte prior behavior)', () => {
  assert.equal(routingModeFor('fee_drag'), 'deterministic');
  assert.equal(routingModeFor('delay'), 'generate');
  ['accumulation', 'purchasing_power', 'loan_cost', 'savings_split', 'outcome_gap'].forEach((rel) => assert.equal(routingModeFor(rel), 'generate', rel));
  assert.equal(routingModeFor('hook'), 'generate'); assert.equal(routingModeFor('close'), 'generate'); assert.equal(routingModeFor(null), 'generate');
});
// Local, fully deterministic fixtures (no Brain/vendor call) — per the order: "a local deterministic render is
// sufficient for the erosion-routing proof; do NOT spend another real narration/Ideogram preview cycle."
const fakeBrain = (relationship, rendererParams) => ({
  ok: true, integrity: { status: 'clean' },
  values: [], scenes: [
    { scene_id: 'S0', intent: 'introduction', narration: { text: 'An unrelated introduction beat, never a hook or a comparison.' }, renderer_params: { treatment: 'avatar_panel' }, reveal_steps: [] },
    { scene_id: 'S1', intent: 'outcome_comparison', narration: { text: relationship === 'fee_drag' ? 'That fee difference costs you real money over time.' : 'A verified comparison beat for this fixture.' }, renderer_params: rendererParams, reveal_steps: [] },
    { scene_id: 'S2', intent: 'presenter_conclusion', narration: { text: 'A closing beat.' }, renderer_params: { treatment: 'avatar_panel' }, reveal_steps: [] },
  ],
});
await t('(A) erosion/fee_drag routes DIRECTLY to the deterministic physical-evidence template: deps.illustrateBeat is NEVER called, zero Ideogram/QC vendor calls, and a correctly-routed deterministic beat does not flip creative_qc to needs_review', async () => {
  const b = fakeBrain('fee_drag', { treatment: 'share_compare', beforeValue: '$105,204', afterValue: '$85,528', beforeLabel: 'Low fee', afterLabel: 'High fee' });
  let calls = 0; const spyDeps = { illustrateBeat: async () => { calls++; throw new Error('deps.illustrateBeat must never be called for an erosion/fee_drag-routed beat'); } };
  const r = await resolveIllustration(b, 'long', spyDeps);
  assert.equal(calls, 0, 'Ideogram/QC path was invoked for an erosion beat');
  assert.equal(r.counts.deterministic, 1); assert.equal(r.counts.generated, 0); assert.equal(r.counts.fallback, 0);
  assert.equal(r.vendor.ideogram_images, 0); assert.equal(r.vendor.ideogram_usd, 0); assert.equal(r.vendor.qc_calls, 0); assert.equal(r.vendor.qc_usd, 0);
  assert.equal(r.creative_qc.status, 'pass', 'a deterministic (approved) treatment must never be flagged needs_review merely for not using Ideogram');
  assert.deepEqual(r.perScene, {}, 'no illustration asset for a deterministic beat -> compose.mjs falls through to its existing renderer-2.1/2.3 template unchanged');
});
await t('(B) delayed_start remains eligible for generated illustration, unchanged', async () => {
  const b = fakeBrain('delay', { treatment: 'stock_chart', markerIndex: 3, series: [{ label: 'Start today', finalValueText: '$155,924' }, { label: 'Delayed start', finalValueText: '$79,477' }] });
  let calls = 0; const genDeps = { illustrateBeat: async () => { calls++; return { ok: true, mode: 'generate', asset_url: 'https://x/delay.png', asset_id: 'a1', vendor: { ideogram_images: 1, ideogram_usd: 0.03, qc_calls: 1, qc_usd: 0.01 } }; } };
  const r = await resolveIllustration(b, 'long', genDeps);
  assert.equal(calls, 1); assert.equal(r.counts.generated, 1); assert.equal(r.counts.deterministic, 0); assert.equal(r.creative_qc.status, 'pass');
});
await t('(C) rate_outcome (e.g. loan_cost) remains governed by the existing semantic route + QC, unchanged', async () => {
  const b = fakeBrain('loan_cost', { treatment: 'share_compare', beforeValue: '$395,503', afterValue: '$435,382', beforeLabel: '5.25% rate', afterLabel: '6.25% rate' });
  b.scenes[1].narration.text = 'Say you borrow $220,000 for a mortgage.'; // loan topic, not fee -> relationship loan_cost
  let calls = 0; const genDeps = { illustrateBeat: async () => { calls++; return { ok: true, mode: 'generate', asset_url: 'https://x/loan.png', asset_id: 'a2', vendor: { ideogram_images: 1, ideogram_usd: 0.03, qc_calls: 1, qc_usd: 0.01 } }; } };
  const r = await resolveIllustration(b, 'long', genDeps);
  assert.equal(calls, 1); assert.equal(r.counts.generated, 1); assert.equal(r.counts.deterministic, 0); assert.equal(r.creative_qc.status, 'pass');
});
await t('(D) an unknown/genuine generation failure on a generate-routed beat still produces the existing safe fallback + needs_review (unchanged by the routing finalization)', async () => {
  const b = fakeBrain('delay', { treatment: 'stock_chart', markerIndex: 3, series: [{ label: 'A', finalValueText: '$1' }, { label: 'B', finalValueText: '$2' }] });
  const failDeps = { illustrateBeat: async () => ({ ok: false, mode: 'fallback', reasons: ['qc_rejected: ambiguous'], vendor: { ideogram_images: 1, ideogram_usd: 0.03, qc_calls: 2, qc_usd: 0.02 } }) };
  const r = await resolveIllustration(b, 'long', failDeps);
  assert.equal(r.counts.fallback, 1); assert.equal(r.creative_qc.status, 'needs_review'); assert.equal(r.creative_qc.owner, 'va_production_product_qc');
});
// (E) zero unprovenanced authoritative numbers, and (F) existing lifecycle/production guard remain intact: both are
// already proven by the unchanged suites below ([3b]'s 114-script robustness sweep and section [6]'s byte-identical
// lifecycle/auth/production-guard tests) — this routing finalization touches neither number provenance nor lifecycle.
await t('illustrated beats render with word-anchored evidence tags and pass number provenance (hook + comparison, both formats)', async () => { const { loadSprite } = await import('./lib/nextwaveV2Renderer/core.mjs'); const stub = await loadSprite('./api/assets/nextwave-v2/bench/bg_road_wide.png'); const sbB = await brain(scriptOf('B'));
  for (const fname of ['long', 'short']) { const fm = STYLE.formats[fname]; const words = wordsFromAlignment(scriptOf('B'), synthAlign(scriptOf('B'))); const choice = chooseIllustratedBeats(sbB.scenes, fname); const illustration = {}; if (choice.hookIdx >= 0) illustration[choice.hookIdx] = { mode: 'hook', image: stub }; if (choice.dominantIdx >= 0) illustration[choice.dominantIdx] = { mode: 'comparison', image: stub };
    const C = composeStoryboard({ storyboard: sbB, words, assets: { poses: await loadHostPoses(), bench: await loadBench() }, format: fm, illustration }); const illustrated = C.scenes.filter((s) => s.illustrated); assert.ok(illustrated.length >= 1, fname);
    const drawn = collectDrawnText({ format: fm, drawFrame: C.draw, times: [1, C.duration / 2, C.duration - 1] }); const pv = numberProvenance({ drawn, allowed: allowedNumbers({ storyboard: sbB, script: scriptOf('B'), derived: C.derived }) }); assert.ok(pv.ok, fname + ' ' + JSON.stringify(pv.unprovenanced).slice(0, 200)); }
});
console.log('\n[6] lifecycle preservation — Generate → Review → Build → Approve → Publish → Done');
const html = fs.readFileSync('./public/index.html', 'utf8'); const baseHtml = execFileSync('git', ['show', BASELINE + ':public/index.html'], { maxBuffer: 1 << 28 }).toString();
// Production Hardening Release A2 (2026-09-28) — four more pre-existing lines are now allow-listed,
// all inside _nextWaveRunPublish (excluded below from the byte-identical freeze and covered instead
// by its own dedicated behavior tests further down): populate the real description instead of an
// empty string, category 22->27 (Education), and read the thumbnail from either build path's field.
const HTML_A2_ALLOWED_REMOVED_LINES = new Set([
  'if(isNextWaveV2Preview){',
  "description:pkg.captionYT||pkg.captionYouTube||pkg.description||'',",
  "categoryId:'22',",
  'if(pkg.nextwaveV2ThumbnailUrl&&_ytId){',
  "body:JSON.stringify({videoId:_ytId,engine:'NextWave',thumbUrl:pkg.nextwaveV2ThumbnailUrl}),".slice(0, 80),
  // Package resolution integrity fix (2026-10-04) — _nextWavePkgForTask's old plain find() (no
  // engine filter, first-match = oldest-by-push-order) is replaced with an engine-filtered,
  // newest-by-generatedAt resolution; see the function's own comment in index.html.
  "return (D.packages||[]).find(function(p){return String(p.taskId||'')===_tId;})||".slice(0, 80),
  // Discard & Regenerate in-page confirmation (2026-10-04) — the old native confirm() onclick is
  // replaced with the same two-step reveal pattern already used for Close Preview; the underlying
  // action (_nextWaveSetStage(taskId,'generate')) is unchanged. See the function's own comment.
  "body+=`<button style=\"${btnRed}\" onclick=\"if(confirm('Discard package and regene".slice(0, 80),
]);
// Reconciliation closeout (2026-10-03): same reasoning as MAIN_RECONCILE_BASELINE above — this test's
// zero-point moves from fa34eb0 to origin/main's pre-merge HEAD, so main's own independent edits
// (SRV-Farsi lifecycle/finance-sync helpers etc., 35 lines, verified to belong exclusively to
// functions NextWave never touches) stop being misread as unexpected NextWave deletions. The
// byte-identical-function tests just below intentionally keep using the original `baseHtml`
// (fa34eb0) — they check NextWave's OWN functions were never silently altered since before NextWave
// existed at all, which is unaffected by main's unrelated work and needs no change.
const baseHtmlReconciled = execFileSync('git', ['show', MAIN_RECONCILE_BASELINE + ':public/index.html'], { maxBuffer: 1 << 28 }).toString();
await t('index.html diff vs the pre-reconciliation main baseline: only the Release A2-reviewed lines changed; everything else is additive', () => { const a = baseHtmlReconciled.split('\n'), b = html.split('\n'); const bm = new Map(); b.forEach((l) => bm.set(l, (bm.get(l) || 0) + 1)); const am = new Map(); a.forEach((l) => am.set(l, (am.get(l) || 0) + 1)); const removed = []; am.forEach((n, l) => { const m = bm.get(l) || 0; if (m < n) removed.push(l.trim().slice(0, 80)); }); const unexpected = removed.filter((l) => !HTML_A2_ALLOWED_REMOVED_LINES.has(l)); assert.deepEqual(unexpected, [], JSON.stringify(removed)); });
await t('stage machine, approve, publish and done are byte-identical (function sources unchanged), except _nextWaveRunPublish (Release A2 — covered by its own tests below)', () => { ['_nextWaveSetStage', '_nextWaveGetStage', '_nextWaveApproveReview', '_nextWaveGeneratePackage', 'autoStartHeygenRender', '_pollHeygenRenders', '_pollSubmagicProjects', 'savePackageToSupabase'].forEach((fn) => { const grab = (s) => { const i = s.indexOf(`function ${fn}(`); assert.ok(i > 0, fn); let d = 0, k = s.indexOf('{', i); const st = k; for (; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}') { d--; if (d === 0) break; } } return s.slice(i, k + 1); }; assert.equal(grab(html), grab(baseHtml), fn + ' changed'); }); });
await t('_nextWaveRunPublish (Release A2): categoryId is 27 (Education, was 22); description QC-blocks when empty/short instead of silently publishing with one; thumbnail prefers nextwaveV2ThumbnailUrl (HeyGen path) then falls back to thumbnailUrl (V2 route path); playlistCategory is wired from pkg.angle/contentFormat', () => { const grabFn = (s, fn) => { const i = s.indexOf(`function ${fn}(`); assert.ok(i > 0, fn); let d = 0, k = s.indexOf('{', i); for (; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}') { d--; if (d === 0) break; } } return s.slice(i, k + 1); }; const fn = grabFn(html, '_nextWaveRunPublish'); assert.ok(fn.includes("categoryId:'27'"), 'categoryId not updated to 27'); assert.ok(!fn.includes("categoryId:'22'"), 'stale categoryId 22 still present'); assert.ok(/_nwDescription\.length\s*<\s*20/.test(fn), 'no minimum-length description QC gate'); assert.ok(fn.includes('pkg.nextwaveV2ThumbnailUrl||pkg.thumbnailUrl'), 'thumbnail fallback not wired for both build paths'); assert.ok(fn.includes('playlistCategory:_nwPlaylistCategory'), 'playlistCategory not passed to the upload request'); assert.ok(fn.includes('containsSyntheticMedia:true'), 'structured AI-disclosure field not wired'); });
await t('Release A3: containsSyntheticMedia is additive/opt-in server-side (every other engine unaffected unless it explicitly opts in)', () => { const grabFn = (s, fn) => { const i = s.indexOf(`function ${fn}(`); assert.ok(i > 0, fn); let d = 0, k = s.indexOf('(', i); for (; k < s.length; k++) { if (s[k] === '(') d++; else if (s[k] === ')') { d--; if (d === 0) break; } } const bodyStart = s.indexOf('{', k); let d2 = 0, k2 = bodyStart; for (; k2 < s.length; k2++) { if (s[k2] === '{') d2++; else if (s[k2] === '}') { d2--; if (d2 === 0) break; } } return s.slice(i, k2 + 1); }; const fn = grabFn(ops, 'youtubeUploadVideo'); assert.ok(/containsSyntheticMedia\s*===\s*true/.test(fn), 'not gated behind an explicit === true opt-in check'); assert.ok(fn.includes('metadata.status.containsSyntheticMedia = true'), 'field not actually set on metadata.status when opted in'); });
// lift the new client block and run it against mocks
const cStart = html.indexOf('const _nwv2Route={cfg:null,loading:false};'); const cEnd = html.indexOf('// ── NextWave V2 Build renderer (Phase 4.4)'); assert.ok(cStart > 0 && cEnd > cStart);
const clientSrc = html.slice(cStart, cEnd);
const mkClient = (responses, { cfgEnabled = true } = {}) => { const log = []; const ctx = { D: { tasks: [], packages: [] }, console, escHTML: (s) => String(s), currentTab: 'tasks', renderTab: () => {}, setTimeout: () => {}, alert: () => {}, _persistPkgPipelineState: async () => {}, _nextwaveV2CheckCeoStatus: () => {}, _nextWaveSetStage: () => {},
  fetch: async (url) => { log.push(String(url)); const u = String(url); if (u.includes('nextwave_v2_route_config')) return { json: async () => ({ ok: true, enabled: cfgEnabled }) }; return { json: async () => ({ ok: true }) }; },
  _ceoAuthedFetch: async (url, body) => { const a = /action=([a-z0-9_]+)/.exec(url)[1]; log.push(a); const r = responses[a]; const out = typeof r === 'function' ? r(body) : r; return { status: 200, json: async () => out }; } };
  vm.createContext(ctx); vm.runInContext(clientSrc.replace(/^const /gm, 'var ').replace(/\nfunction /g, '\nfunction ') + '\nthis.__api={_nwv2Route,_nextwaveV2RouteOn,nextwaveV2RouteBuild,_nextwaveV2RoutePanel,_nextwaveV2RouteLoadConfig};', ctx); return { api: ctx.__api, log, ctx }; };
const okStart = { ok: true, build_id: 'nwv2r-aaaaaaaaaaaaaaaa', status: 'planned', gate: { route: 'PASS', reasons: [] }, chunks: [{ index: 0 }, { index: 1 }], duration_sec: 12, chunk_count: 2, vendor: { elevenlabs_chars: 100 }, qc_pre_render: { numbers: { drawn_tokens: 10, unprovenanced: 0 } } };
await t('flag OFF (default): _nextwaveV2RouteOn is false before config and when server says disabled -> Build stage unchanged', async () => { const c = mkClient({}, { cfgEnabled: false }); assert.equal(c.api._nextwaveV2RouteOn({}, {}), false); await new Promise((r) => setTimeout(r, 20)); assert.equal(c.api._nextwaveV2RouteOn({}, {}), false); });
await t('flag ON: route shown only after config confirms enabled', async () => { const c = mkClient({}, { cfgEnabled: true }); c.api._nextwaveV2RouteOn({}, {}); await new Promise((r) => setTimeout(r, 20)); assert.equal(c.api._nextwaveV2RouteOn({}, {}), true); });
await t('PASS path -> same terminal state as the existing path (renderStatus enhanced + videoUrl + thumbnail); never calls HeyGen/Submagic/publish', async () => { const c = mkClient({ nextwave_v2_route_start: okStart, nextwave_v2_route_chunk: { ok: true }, nextwave_v2_route_finish: { ok: true, status: 'ready_for_review', final: { video_url: 'https://x/final.mp4', thumbnail_url: 'https://x/t.png', encode: { duration: 12.1 } } } }); const pkg = { id: 'p1', taskId: 't1', script: 'hello', title: 'T', contentFormat: 'short' }; const r = await c.api.nextwaveV2RouteBuild(pkg); assert.equal(r.ok, true); assert.equal(pkg.renderStatus, 'enhanced'); assert.equal(pkg.videoUrl, 'https://x/final.mp4'); assert.equal(pkg.thumbnailUrl, 'https://x/t.png'); assert.deepEqual(c.log.filter((x) => /heygen|submagic|youtube|publish|upload/i.test(x)), []); assert.deepEqual(c.log.filter((x) => x.startsWith('nextwave_v2_route_')), ['nextwave_v2_route_start', 'nextwave_v2_route_chunk', 'nextwave_v2_route_chunk', 'nextwave_v2_route_finish']); });
await t('idempotent re-entry: start returns a PRIOR ready_for_review build (reused, zero vendor spend) -> terminal enhanced state reached directly, chunk/finish NEVER called (the ready_for_review-can-never-be-rechunked bug)', async () => {
  const reusedStart = { ok: true, build_id: 'nwv2r-dddddddddddddddd', status: 'ready_for_review', gate: { route: 'PASS', reasons: [] }, chunk_count: 5, vendor: { elevenlabs_chars: 100, ideogram_usd: 0.06 }, final: { video_url: 'https://x/reused-final.mp4', thumbnail_url: 'https://x/reused-thumb.png', encode: { duration: 33.68 } }, illustration: { counts: { reused: 0, generated: 0, fallback: 1, deterministic: 0 }, creative_qc: { status: 'needs_review', reasons: [] } } };
  const c = mkClient({ nextwave_v2_route_start: reusedStart, nextwave_v2_route_chunk: () => { throw new Error('must never be called for an already ready_for_review build'); }, nextwave_v2_route_finish: () => { throw new Error('must never be called for an already ready_for_review build'); } });
  const pkg = { id: 'p_reentry', taskId: 't_reentry', script: 'already built script', title: 'T', contentFormat: 'short' };
  const r = await c.api.nextwaveV2RouteBuild(pkg);
  assert.equal(r.ok, true); assert.equal(r.reused, true);
  assert.equal(pkg.renderStatus, 'enhanced'); assert.equal(pkg.videoUrl, 'https://x/reused-final.mp4'); assert.equal(pkg.thumbnailUrl, 'https://x/reused-thumb.png'); assert.equal(pkg.renderDurationSec, 33.68);
  assert.equal(pkg.nextwaveV2Route.illustration.creative_qc.status, 'needs_review', 'creative_qc must carry through unchanged, never silently pass');
  assert.deepEqual(c.log.filter((x) => x.startsWith('nextwave_v2_route_')), ['nextwave_v2_route_start'], 'chunk/finish must never be invoked on a reused ready_for_review build');
});
await t('NEEDS_REVIEW -> stops, status v2_needs_review, no chunk/finish call, no advance, notification to operations', async () => { const c = mkClient({ nextwave_v2_route_start: { ok: true, build_id: 'nwv2r-bbbbbbbbbbbbbbbb', status: 'needs_review', gate: { route: 'NEEDS_REVIEW' }, exception: { route: 'NEEDS_REVIEW', reasons: [{ kind: 'scenario_partition_disagreement' }], owner: 'va_production_product_qc' }, vendor: { elevenlabs_chars: 0 } } }); const pkg = { id: 'p2', taskId: 't2', script: 'x' }; const r = await c.api.nextwaveV2RouteBuild(pkg); assert.equal(r.ok, false); assert.equal(pkg.renderStatus, 'v2_needs_review'); assert.ok(!pkg.videoUrl); assert.ok(!c.log.includes('nextwave_v2_route_chunk') && !c.log.includes('nextwave_v2_route_finish')); assert.ok(c.log.some((x) => x.includes('create_notification'))); });
await t('BLOCK -> status v2_blocked, engineering triage, nothing rendered', async () => { const c = mkClient({ nextwave_v2_route_start: { ok: true, build_id: 'nwv2r-cccccccccccccccc', status: 'blocked', gate: { route: 'BLOCK' }, exception: { route: 'BLOCK', reasons: [{ kind: 'stated_value_inconsistent' }], owner: 'engineering_triage' } } }); const pkg = { id: 'p3', script: 'x' }; await c.api.nextwaveV2RouteBuild(pkg); assert.equal(pkg.renderStatus, 'v2_blocked'); assert.ok(!c.log.includes('nextwave_v2_route_chunk')); });
await t('server refusal (flag off / auth) -> failed with the real error; still no HeyGen fallback', async () => { const c = mkClient({ nextwave_v2_route_start: { ok: false, error: 'ceo_authorization_required' } }); const pkg = { id: 'p4', script: 'x' }; const r = await c.api.nextwaveV2RouteBuild(pkg); assert.equal(r.ok, false); assert.equal(pkg.renderStatus, 'failed'); assert.match(pkg.renderError, /ceo_authorization_required/); assert.deepEqual(c.log.filter((x) => /heygen|submagic/i.test(x)), []); });
await t('chunk failure -> failed, resumable; post-encode issue -> v2_needs_review (never advances)', async () => { const c1 = mkClient({ nextwave_v2_route_start: okStart, nextwave_v2_route_chunk: (b) => (b.index === 1 ? { ok: false, error: 'boom' } : { ok: true }) }); const p1 = { id: 'p5', script: 'x' }; await c1.api.nextwaveV2RouteBuild(p1); assert.equal(p1.renderStatus, 'failed'); const c2 = mkClient({ nextwave_v2_route_start: okStart, nextwave_v2_route_chunk: { ok: true }, nextwave_v2_route_finish: { ok: true, status: 'needs_review', exception: { reasons: [{ kind: 'duration_mismatch' }] }, final: { video_url: 'https://x' } } }); const p2 = { id: 'p6', script: 'x' }; await c2.api.nextwaveV2RouteBuild(p2); assert.equal(p2.renderStatus, 'v2_needs_review'); assert.ok(!p2.videoUrl); });
await t('format detection matches the existing HeyGen path (contentFormat / task / landscape note)', () => { const c = mkClient({}); c.ctx.D.tasks = [{ id: 't9', contentFormat: 'long' }]; assert.equal(c.ctx._nextwaveV2RouteFormat({ contentFormat: 'long' }), 'long'); assert.equal(c.ctx._nextwaveV2RouteFormat({ taskId: 't9' }), 'long'); assert.equal(c.ctx._nextwaveV2RouteFormat({ workflowNotes: 'Landscape 16:9' }), 'long'); assert.equal(c.ctx._nextwaveV2RouteFormat({}), 'short'); });
await t('Build panel renders every state, and its Approve button is the existing _nextWaveSetStage(approve)', () => { const c = mkClient({}); const st = { btnGreen: 'g', btnBlue: 'b', btnRed: 'r' }; const S = (rs, extra = {}) => c.api._nextwaveV2RoutePanel({}, { renderStatus: rs, videoUrl: 'https://x/v.mp4', nextwaveV2Route: { exception: { reasons: [{ kind: 'k' }], owner: 'va_production_product_qc' }, progress: { done: 1, total: 3 }, ...extra } }, 't1', 'p1', st); assert.ok(S('enhanced').includes("_nextWaveSetStage('t1','approve')")); assert.ok(S('v2_needs_review').includes('NEEDS REVIEW')); assert.ok(S('v2_blocked').includes('BLOCKED')); assert.ok(S('v2_building').includes('rendering chunk')); assert.ok(S('failed').includes('failed')); assert.ok(S('').includes('Build with NextWave V2 route')); });
await t('illustration NEEDS_REVIEW banner: shown (and Approve still present, not blocked in code) when a fallback occurred; absent when illustration passed cleanly', () => { const c = mkClient({}); const st = { btnGreen: 'g', btnBlue: 'b', btnRed: 'r' }; const withFallback = c.api._nextwaveV2RoutePanel({}, { renderStatus: 'enhanced', videoUrl: 'https://x/v.mp4', nextwaveV2Route: { illustration: { counts: { reused: 0, generated: 0, fallback: 1 }, creative_qc: { status: 'needs_review', owner: 'va_production_product_qc', reasons: [{ scene: 'S1', mode: 'hook', reasons: ['qc_rejected'] }] } } } }, 't1', 'p1', st); assert.ok(/CREATIVE NEEDS REVIEW/.test(withFallback)); assert.ok(withFallback.includes("_nextWaveSetStage('t1','approve')"), 'Approve stays available — this is a visibility banner, not a lifecycle block'); const clean = c.api._nextwaveV2RoutePanel({}, { renderStatus: 'enhanced', videoUrl: 'https://x/v.mp4', nextwaveV2Route: { illustration: { counts: { reused: 1, generated: 0, fallback: 0 }, creative_qc: { status: 'pass' } } } }, 't1', 'p1', st); assert.ok(!/CREATIVE NEEDS REVIEW/.test(clean)); });
await t('panel HTML never mentions HeyGen or Submagic as an action', () => { const c = mkClient({}); const st = { btnGreen: 'g', btnBlue: 'b', btnRed: 'r' }; ['enhanced', 'v2_needs_review', 'v2_blocked', 'v2_building', 'failed', ''].forEach((rs) => { const h = c.api._nextwaveV2RoutePanel({}, { renderStatus: rs, videoUrl: 'u', nextwaveV2Route: {} }, 't', 'p', st); assert.ok(!/autoStartHeygen|heygen_start|submagic/i.test(h.replace(/No HeyGen\./, ''))); }); });

console.log('\n[7] Bounded Storyboard Brain repair — decision-boundary isolation (2026-09-29)');
// Diagnostic authorization traced two confirmed cross-decision contamination bugs in
// nextwaveV2StoryboardBrain.mjs's calculator/verification (used directly by the
// nextwave_v2_storyboard_brain debug action, and as nextwaveV2BuildStoryboardSemantic's
// fail-safe fallback when the semantic proposer returns no usable pass): a multi-decision
// script's loan/growth calculation could silently be fed an EARLIER, unrelated decision's
// principal/horizon/recurring value (confirmed: a $280,000 DECIDE loan derived from an
// earlier AVOID scene's $50,000 principal), and a gap could be verified against a
// DIFFERENT decision's outcomes (first gap entity vs. first comparison scene, regardless
// of which decision either belonged to). These fixtures pin the fix permanently.
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
function trustedLoanTotal(principal, ratePct, years) { const r = ratePct / 100 / 12, n = years * 12; const M = (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1); return M * n; }
const decideT1 = trustedLoanTotal(280000, 3.25, 30), decideT2 = trustedLoanTotal(280000, 6.75, 30);
const FIXTURE_A = `Say you borrow $280,000 for 30 years. At a 3.25 percent rate, you will pay back about ${usd(decideT1)} in total. At a 6.75 percent rate, you will pay back about ${usd(decideT2)} in total. That rate difference costs you an extra ${usd(decideT2 - decideT1)}.`;
const avoidE1 = 50000 * Math.pow(1.0695, 30), avoidE2 = 50000 * Math.pow(1.0625, 30);
const FIXTURE_B = `Imagine you invest $50,000 and leave it alone for 30 years, earning an annual 7 percent return before costs. With a fund that charges an annual 0.05 percent fee, you would end up with about ${usd(avoidE1)}. With a fund that charges an annual 0.75 percent fee, you would end up with about ${usd(avoidE2)}. That fee difference costs you ${usd(avoidE1 - avoidE2)}. Now, say you borrow $280,000 for 30 years. At a 3.25 percent rate, you will pay back about ${usd(decideT1)} in total. At a 6.75 percent rate, you will pay back about ${usd(decideT2)} in total. That rate difference costs you an extra ${usd(decideT2 - decideT1)}.`;
const saveE1 = 15000 * Math.pow(1.005, 8), saveE2 = 15000 * Math.pow(1.045, 8);
const FIXTURE_C = `Imagine you invest $50,000 and leave it alone for 30 years, earning an annual 7 percent return before costs. With a fund that charges an annual 0.05 percent fee, you would end up with about ${usd(avoidE1)}. With a fund that charges an annual 0.75 percent fee, you would end up with about ${usd(avoidE2)}. That fee difference costs you ${usd(avoidE1 - avoidE2)}. Say you keep $15,000 earning an annual 0.5 percent yield for 8 years — that grows to about ${usd(saveE1)}. The same $15,000 earning an annual 4.5 percent yield grows to about ${usd(saveE2)} over the same 8 years. That's ${usd(saveE2 - saveE1)} you left on the table. Say you borrow $280,000 for 30 years. At a 3.25 percent rate, you will pay back about ${usd(decideT1)} in total. At a 6.75 percent rate, you will pay back about ${usd(decideT2)} in total. That rate difference costs you an extra ${usd(decideT2 - decideT1)}.`;
const FIXTURE_D = "Three numbers most people never check — each one quietly costs tens or hundreds of thousands. Imagine you invest $50,000 and leave it alone for 30 years, earning an annual 7 percent return before costs. With a fund that charges an annual 0.05 percent fee, you would end up with about $374,734. With a fund that charges an annual 0.75 percent fee, you would end up with about $341,236. That fee difference costs you $33,498. Now take savings rates. Say you keep $15,000 earning an annual 0.5 percent yield for 8 years — that grows to about $15,612. The same $15,000 earning an annual 4.5 percent yield grows to about $21,193 over the same 8 years. That's $5,581 you left on the table. Finally, borrowing costs. Say you borrow $280,000 for 30 years. At a 3.25 percent rate, you will pay back about $447,908 in total. At a 6.75 percent rate, you will pay back about $665,280 in total. That rate difference costs you an extra $217,372. Three numbers — a fund fee, a savings yield, a loan rate — and the gaps add up to a quarter million dollars across a lifetime. Check them. [DISCLAIMER: Not financial advice. Educational only.]";
const loanVerif = (sb) => (sb.integrity.verifications || []).filter((v) => v.check === 'outcome' && v.formula === 'loan_total_paid');
await t('A: DECIDE alone — $280,000 loan verifies against itself (integrity clean)', () => { const sb = nextwaveV2BuildStoryboard(FIXTURE_A, baseDeps); assert.equal(sb.integrity.status, 'clean'); const lv = loanVerif(sb); assert.equal(lv.length, 2); lv.forEach((v) => assert.ok(v.ok, JSON.stringify(v))); });
await t('B: AVOID ($50k) + DECIDE ($280k) — the $280,000 loan derives from $280,000, NOT the earlier $50,000 principal', () => { const sb = nextwaveV2BuildStoryboard(FIXTURE_B, baseDeps); const lv = loanVerif(sb); assert.equal(lv.length, 2); lv.forEach((v) => { assert.ok(v.ok, `loan verification failed — derived ${v.derived} from a contaminated principal, expected agreement with stated ${v.stated}`); assert.ok(Math.abs(v.derived - trustedLoanTotal(280000, v.stated === Math.round(decideT1) ? 3.25 : 6.75, 30)) < 1, 'derived value must match the trusted $280,000 calculation, not the $50,000 one'); }); });
await t('C: AVOID + SAVE + DECIDE, repeated 30yr horizon — same invariant holds with three decisions and a repeated horizon value', () => { const sb = nextwaveV2BuildStoryboard(FIXTURE_C, baseDeps); const lv = loanVerif(sb); assert.equal(lv.length, 2); lv.forEach((v) => assert.ok(v.ok, JSON.stringify(v))); });
await t('D: actual A5-failing Long structure, verbatim — loan now derives from the correct $280,000 (the model\'s own stated figures still legitimately disagree by ~2%, which is a genuine arithmetic-accuracy finding, not a binding bug)', () => { const sb = nextwaveV2BuildStoryboard(FIXTURE_D, baseDeps); const lv = loanVerif(sb); assert.equal(lv.length, 2); const correctDerived = [Math.round(trustedLoanTotal(280000, 3.25, 30)), Math.round(trustedLoanTotal(280000, 6.75, 30))]; lv.forEach((v) => assert.ok(correctDerived.some((d) => Math.abs(d - v.derived) < 1), `derived ${v.derived} does not match either correct $280,000 total ${correctDerived.join('/')} — contamination regressed`)); });
await t('invariant: identical decision inputs produce identical derived calculations regardless of unrelated neighboring decisions (A vs B vs C vs D all agree on the DECIDE loan)', () => { const results = [FIXTURE_A, FIXTURE_B, FIXTURE_C, FIXTURE_D].map((s) => loanVerif(nextwaveV2BuildStoryboard(s, baseDeps)).map((v) => Math.round(v.derived))); const [a, b, c, d] = results; assert.deepEqual(a, b); assert.deepEqual(a, c); assert.deepEqual(a, d); });
await t('gap ownership: every gap is checked against its OWN decision, never a different one (fixture D: three decisions, three independently-correct gap checks)', () => { const sb = nextwaveV2BuildStoryboard(FIXTURE_D, baseDeps); const gapChecks = (sb.integrity.verifications || []).filter((v) => v.check === 'gap'); assert.ok(gapChecks.length >= 1, 'at least one gap must be verified'); gapChecks.forEach((v) => assert.ok(v.ok, `gap ${v.entity} checked against the wrong decision: stated ${v.stated}, derived ${v.derived}`)); });
await t('robustness: a malformed script that used to crash the whole build (missing $ before computed values, confirmed TypeError at the share_compare renderer) now degrades to the existing BLOCK contract instead', () => { const malformed = 'Imagine you invest $50,000 and leave it alone for 30 years, earning an annual 7 percent return before costs. With a fund that charges an annual 0.05 percent fee, you would end up with about 375313. With a fund that charges an annual 0.75 percent fee, you would end up with about 308204. That fee difference costs you 67109. Say you keep $15,000 earning an annual 0.5 percent yield for 8 years — that grows to about 15611. The same $15,000 earning an annual 4.5 percent yield grows to about 21332 over the same 8 years. That is 5721 you left on the table. Say you borrow $280,000 for 30 years. At a 3.25 percent rate, you will pay back about 438688 in total. At a 6.75 percent rate, you will pay back about 653787 in total. That rate difference costs you an extra 215099.'; let sb; assert.doesNotThrow(() => { sb = nextwaveV2BuildStoryboard(malformed, baseDeps); }); assert.equal(sb.ok, true, 'the function itself must still return ok (script/segmentation succeeded)'); assert.equal(sb.integrity.status, 'blocked'); assert.ok(sb.integrity.issues.some((i) => i.kind === 'renderer_error'), 'the render failure must surface as a normal blocking issue, not an uncaught exception'); });

console.log('\n[8] Phase 2 — deterministic financial math (fact packets + closing the AVOID/SAVE integrity gap)');
const { generateFactPacket } = await import('./lib/nextwaveV2FactPacket.mjs');
const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-US');
const scriptFor = (p) => {
  if (p.angle === 'GROW') return `Say you invest ${fmt$(p.recurring_amount)} every month, assuming an average ${p.rate} percent annual return. If you start today, that portfolio grows to about ${fmt$(p.outcome_a)} after ${p.horizon} years. But if you wait ${p.delay} years before you start, contributing the same ${fmt$(p.recurring_amount)} a month for the remaining years, you end up with only about ${fmt$(p.outcome_b)}. That ${p.delay} year delay costs you ${fmt$(p.gap)}.`;
  if (p.angle === 'AVOID') return `Imagine you invest ${fmt$(p.principal)} and leave it alone for ${p.horizon} years, earning an annual ${p.rate} percent return before costs. With a fund that charges an annual ${p.fee} percent fee, you would end up with about ${fmt$(p.outcome_a)}. With a fund that charges an annual ${p.comparison_fee} percent fee, you would end up with about ${fmt$(p.outcome_b)}. That fee difference costs you ${fmt$(p.gap)}.`;
  if (p.angle === 'SAVE') return `Say you deposit ${fmt$(p.principal)} earning an annual ${p.rate} percent yield for ${p.horizon} years — that grows to about ${fmt$(p.outcome_a)}. The same ${fmt$(p.principal)} earning an annual ${p.comparison_rate} percent yield grows to about ${fmt$(p.outcome_b)} over the same ${p.horizon} years. That's ${fmt$(p.gap)} you left on the table.`;
  return `Say you borrow ${fmt$(p.principal)} for ${p.horizon} years. At a ${p.rate} percent rate, you will pay back about ${fmt$(p.outcome_a)} in total. At a ${p.comparison_rate} percent rate, you will pay back about ${fmt$(p.outcome_b)} in total. That rate difference costs you an extra ${fmt$(p.gap)}.`;
};
await t('fact-packet-generated numbers pass Brain arithmetic verification with zero blocking issues, for all 4 angles (20 random draws each)', () => { for (const angle of ['GROW', 'AVOID', 'SAVE', 'DECIDE']) { for (let i = 0; i < 20; i++) { const p = generateFactPacket(angle, []); const sb = nextwaveV2BuildStoryboard(scriptFor(p), baseDeps); const blocking = sb.integrity.issues.filter((x) => x.severity === 'blocking'); assert.equal(blocking.length, 0, `${angle} draw ${i} (${p.scenario_type}) blocked: ${JSON.stringify(blocking)}`); } } });
await t('AVOID/SAVE lump-sum outcomes are now independently verified (not merely unblocked by absence of a check) — corrupting a stated AVOID outcome is caught', () => { const p = generateFactPacket('AVOID', []); const good = scriptFor(p); const sbGood = nextwaveV2BuildStoryboard(good, baseDeps); const outVerifs = sbGood.integrity.verifications.filter((v) => v.check === 'outcome'); assert.ok(outVerifs.length >= 2, 'AVOID must produce real outcome verifications, not zero (the previously-unverified gap)'); assert.ok(outVerifs.every((v) => v.ok)); const corrupted = good.replace(fmt$(p.outcome_a), fmt$(p.outcome_a * 1.5)); const sbBad = nextwaveV2BuildStoryboard(corrupted, baseDeps); assert.ok(sbBad.integrity.issues.some((i) => i.severity === 'blocking' && i.kind === 'stated_value_inconsistent'), 'a corrupted AVOID outcome must now be caught, not silently pass'); });
await t('rate/fee cue tie fixed: AVOID\'s fee percentages bind to fee_rate (not left ambiguous against rate) now that the redundant "annual" double-count is removed', () => { const p = generateFactPacket('AVOID', []); const sb = nextwaveV2BuildStoryboard(scriptFor(p), baseDeps); const feeVals = sb.values.filter((v) => v.role === 'fee_rate'); assert.equal(feeVals.length, 2, 'both AVOID fee percentages should bind cleanly to fee_rate'); assert.ok(!sb.integrity.issues.some((i) => i.kind === 'unbound_value' && /percent/.test(i.raw || '') && /ambiguous.*fee_rate/.test(i.reason || ''))); });

console.log('\n[9] Decimal-integrity repair — spelled-out decimals (2026-09-30)');
// Real-route validation surfaced this: a fresh Long spelled numbers out in words, and "seven point
// five percent" / "zero point zero six percent" / "zero point six percent" all silently lost their
// leading digits (parsed as bare "five percent" / "six percent" / "six percent"), collapsing two
// distinct AVOID fees to the identical wrong value. Fixed in _nextwaveWordsToNumber (api/ops.js).
const wtn = (s) => baseDeps.wordsToNumber(s).value;
await t('spelled-out decimal composition: exact required examples', () => {
  assert.equal(wtn('seven point five percent'), 7.5);
  assert.equal(wtn('zero point six percent'), 0.6);
  assert.equal(wtn('zero point zero six percent'), 0.06);
  assert.equal(wtn('one point two five percent'), 1.25);
});
await t('digit form and word form resolve to the identical value', () => {
  assert.equal(wtn('7.5 percent'), wtn('seven point five percent'));
  assert.equal(wtn('0.6 percent'), wtn('zero point six percent'));
  assert.equal(wtn('0.06 percent'), wtn('zero point zero six percent'));
  assert.equal(wtn('75000 dollars'), wtn('seventy-five thousand dollars'));
  assert.equal(wtn('$75,000'), 75000);
});
await t('malformed/unsupported decimal phrases fail safely (NaN, never a guessed number) — the exact safety rule the order required', () => {
  assert.ok(Number.isNaN(wtn('two point twenty percent')), 'a non-digit word after "point" must not silently resolve');
  assert.ok(Number.isNaN(wtn('zero point point six percent')), 'more than one "point" must not silently resolve');
  assert.ok(Number.isNaN(wtn('seven point percent')), 'an empty decimal side must not silently resolve');
  assert.notEqual(wtn('zero point zero six percent'), 6, '0.06 must never collapse to 6 — the exact failure this repair targets');
});
await t('a malformed decimal phrase in a real script drops the mention (uncovered_numeric_token) rather than binding a wrong value', () => {
  const script = 'Say you borrow $50,000 for 10 years. At a two point twenty percent rate, you will pay back about $55,000 in total. At a five percent rate, you will pay back about $61,000 in total. That rate difference costs you an extra $6,000.';
  const sb = nextwaveV2BuildStoryboard(script, baseDeps);
  assert.ok(sb.uncovered_numeric_tokens.some((u) => /point/.test(u.token)), 'the malformed rate phrase must surface as uncovered, not silently bind a wrong value');
});
await t('AVOID fee comparison 0.06% vs 0.6% — the exact real-world case that surfaced this defect: two distinct entities, two distinct correct outcomes, zero blocking issues', () => {
  const principal = 75000, rate = 7.5, years = 20, feeLow = 0.06, feeHigh = 0.6;
  const endLow = principal * Math.pow(1 + (rate - feeLow) / 100, years);
  const endHigh = principal * Math.pow(1 + (rate - feeHigh) / 100, years);
  const script = `Imagine you invest $${principal.toLocaleString('en-US')} and leave it alone for ${years} years, earning an annual seven point five percent return before costs. With a fund that charges an annual zero point zero six percent fee, you would end up with about $${Math.round(endLow).toLocaleString('en-US')}. With a fund that charges an annual zero point six percent fee, you would end up with about $${Math.round(endHigh).toLocaleString('en-US')}. That fee difference costs you $${Math.round(endLow - endHigh).toLocaleString('en-US')}.`;
  const sb = nextwaveV2BuildStoryboard(script, baseDeps);
  const fees = sb.values.filter((v) => v.role === 'fee_rate');
  assert.equal(fees.length, 2, 'both fees must bind as two distinct entities');
  const feeVals = fees.map((f) => f.value).sort((a, b) => a - b);
  assert.deepEqual(feeVals, [0.06, 0.6], '0.06% and 0.6% must remain two distinct values, never collapse to the same one');
  const blocking = sb.integrity.issues.filter((i) => i.severity === 'blocking');
  assert.equal(blocking.length, 0, `expected clean arithmetic, got: ${JSON.stringify(blocking)}`);
});
await t('SAVE rate comparison with spelled-out decimals verifies correctly', () => {
  const principal = 22000, rateLow = 0.9, rateHigh = 4.2, years = 4;
  const endLow = principal * Math.pow(1 + rateLow / 100, years);
  const endHigh = principal * Math.pow(1 + rateHigh / 100, years);
  const script = `Say you deposit $${principal.toLocaleString('en-US')} earning an annual zero point nine percent yield for ${years} years — that grows to about $${Math.round(endLow).toLocaleString('en-US')}. The same $${principal.toLocaleString('en-US')} earning an annual four point two percent yield grows to about $${Math.round(endHigh).toLocaleString('en-US')} over the same ${years} years. That's $${Math.round(endHigh - endLow).toLocaleString('en-US')} you left on the table.`;
  const sb = nextwaveV2BuildStoryboard(script, baseDeps);
  const blocking = sb.integrity.issues.filter((i) => i.severity === 'blocking');
  assert.equal(blocking.length, 0, `expected clean arithmetic, got: ${JSON.stringify(blocking)}`);
});
await t('multi-decision Long containing several spelled-out decimal values: zero blocking issues, zero cross-decision contamination (the actual real script that originally surfaced this defect, verbatim)', () => {
  const script = "Three everyday decisions where a fraction of a percent quietly costs you thousands — or saves you thousands. Start with the slow burn. Imagine you invest seventy-five thousand dollars and leave it alone for twenty years, earning an annual seven point five percent return before costs. With a fund that charges an annual zero point zero six percent fee, you would end up with about three hundred fifteen thousand fifty-one dollars. With a fund that charges an annual zero point six percent fee, you would end up with about two hundred eighty-four thousand eight hundred forty-nine dollars. That fee difference costs you thirty thousand two hundred two dollars. Most investors never even check the expense ratio. Now flip to saving. Say you deposit twenty-two thousand dollars earning an annual zero point nine percent yield for four years — that grows to about twenty-two thousand eight hundred three dollars. The same twenty-two thousand dollars earning an annual four point two percent yield grows to about twenty-five thousand nine hundred thirty-five dollars over the same four years. That's three thousand one hundred thirty-three dollars you left on the table. Finally, the borrowing side. Say you borrow twenty-two thousand dollars for four years. At a seven percent rate, you will pay back about twenty-five thousand two hundred eighty-seven dollars in total. At a sixteen percent rate, you will pay back about twenty-nine thousand nine hundred twenty-seven dollars in total. That rate difference costs you an extra four thousand six hundred forty dollars. Your credit score directly controls which rate you qualify for. The pattern holds: percentages look abstract until you run the actual math. [DISCLAIMER: Not financial advice. Educational only.]";
  const sb = nextwaveV2BuildStoryboard(script, baseDeps);
  const blocking = sb.integrity.issues.filter((i) => i.severity === 'blocking');
  assert.equal(blocking.length, 0, `expected clean arithmetic on the real defect-surfacing script, got: ${JSON.stringify(blocking)}`);
  const avoidFees = sb.values.filter((v) => v.role === 'fee_rate').map((v) => v.value).sort((a, b) => a - b);
  assert.deepEqual(avoidFees, [0.06, 0.6], 'the two AVOID fees must remain distinct in the real multi-decision script');
});

console.log('\n[10] Closing-recap $1 rounding repair (2026-09-30) — the Short #3 / Long #3 real B4 unprovenanced_number_on_screen root cause');
await t('reproduced case: Short #3 AVOID fee comparison — recap now uses the verified gap ($74,144), not the unregistered a-b recomputation ($74,143)', () => {
  const scenes = [{ narration: { text: 'fee comparison' }, renderer_params: { displayMode: 'bar', beforeValue: '$345,613', afterValue: '$271,470', deltaTextOverride: '-$74,144', anchorText: '$60,000 AT 7% OVER 27 YEARS', beforeLabel: 'LOW FEE FUND 0.3%', afterLabel: 'HIGH FEE FUND 1.25%' } }];
  const [cmp] = comparisons(scenes);
  assert.equal(cmp.gap, 74144, `recap gap must equal the verified/stated $74,144, not the raw before-after subtraction (${345613 - 271470})`);
});
await t('reproduced case: Long #3 AVOID fee comparison — recap now uses the verified gap ($52,330), not the unregistered a-b recomputation ($52,329)', () => {
  const scenes = [{ narration: { text: 'fee comparison' }, renderer_params: { displayMode: 'bar', beforeValue: '$369,734', afterValue: '$317,405', deltaTextOverride: '-$52,330', anchorText: '$100,000 AT 6% OVER 23 YEARS', beforeLabel: 'LOW FEE', afterLabel: 'HIGH FEE' } }];
  const [cmp] = comparisons(scenes);
  assert.equal(cmp.gap, 52330, `recap gap must equal the verified/stated $52,330, not the raw before-after subtraction (${369734 - 317405})`);
});
await t('no registered gap: recap falls back to the a-b recomputation exactly as before (no behavior change for scenes that never had an override)', () => {
  const scenes = [{ narration: { text: 'plain comparison' }, renderer_params: { displayMode: 'bar', beforeValue: '$500', afterValue: '$300', anchorText: 'x', beforeLabel: 'a', afterLabel: 'b' } }];
  const [cmp] = comparisons(scenes);
  assert.equal(cmp.gap, 200, 'with no deltaTextOverride, the old a-b behavior must be preserved unchanged');
});
await t('negative proof: a genuinely invented on-screen number with no verified lineage still triggers unprovenanced_number_on_screen (the gate is not weakened by this repair)', () => {
  const storyboard = { values: [{ display: '$74,144', value: 74144 }], scenes: [{ renderer_params: { deltaTextOverride: '-$74,144' } }] };
  const script = 'That fee difference costs you $74144.';
  const allowed = allowedNumbers({ storyboard, script });
  const drawn = [{ t: 33, strings: ['$99,999 FABRICATED'] }]; // a number injected by a hypothetical renderer bug/attack, never registered anywhere
  const result = numberProvenance({ drawn, allowed });
  assert.equal(result.ok, false, 'an invented number with no verified lineage must still fail provenance');
  assert.ok(result.unprovenanced.some((u) => u.token.includes('99,999')), 'the specific invented token must be named as unprovenanced');
});

console.log('\n[11] Semantic partition hardening Phase 1 (2026-09-30) — opening/closing invented-aggregate prompt contract, deterministic backstop');
const AGG_BASE = "Three everyday decisions where a fraction of a percent quietly costs you thousands — or saves you thousands. Start with the slow burn. Imagine you invest seventy-five thousand dollars and leave it alone for twenty years, earning an annual seven point five percent return before costs. With a fund that charges an annual zero point zero six percent fee, you would end up with about three hundred fifteen thousand fifty-one dollars. With a fund that charges an annual zero point six percent fee, you would end up with about two hundred eighty-four thousand eight hundred forty-nine dollars. That fee difference costs you thirty thousand two hundred two dollars. Most investors never even check the expense ratio. Now flip to saving. Say you deposit twenty-two thousand dollars earning an annual zero point nine percent yield for four years — that grows to about twenty-two thousand eight hundred three dollars. The same twenty-two thousand dollars earning an annual four point two percent yield grows to about twenty-five thousand nine hundred thirty-five dollars over the same four years. That is three thousand one hundred thirty-three dollars you left on the table. Finally, the borrowing side. Say you borrow twenty-two thousand dollars for four years. At a seven percent rate, you will pay back about twenty-five thousand two hundred eighty-seven dollars in total. At a sixteen percent rate, you will pay back about twenty-nine thousand nine hundred twenty-seven dollars in total. That rate difference costs you an extra four thousand six hundred forty dollars. Your credit score directly controls which rate you qualify for. The pattern holds: percentages look abstract until you run the actual math.";
await t('closing invented aggregate (does not match any real gap or their sum) IS caught: blocking gap_inconsistent, derived against the nearest real decision', () => {
  const script = `${AGG_BASE} Combined, these three choices cost you nearly $50,000 in real money.`;
  const sb = nextwaveV2BuildStoryboard(script, baseDeps);
  const blocking = sb.integrity.issues.filter((i) => i.severity === 'blocking');
  assert.ok(blocking.some((i) => i.kind === 'gap_inconsistent' && i.stated === 50000), `expected the invented closing aggregate to be caught as gap_inconsistent, got: ${JSON.stringify(blocking)}`);
});
await t('supplied decision-level numbers remain allowed and correctly verified alongside an invented closing aggregate (the real gaps are not collateral damage)', () => {
  const script = `${AGG_BASE} Combined, these three choices cost you nearly $50,000 in real money.`;
  const sb = nextwaveV2BuildStoryboard(script, baseDeps);
  const realGaps = sb.values.filter((v) => v.role === 'gap' && v.value !== 50000).map((v) => v.value).sort((a, b) => a - b);
  assert.deepEqual(realGaps, [3132, 4640, 30202], 'the three real decision gaps must remain correctly bound and unaffected by the invented aggregate');
});
await t('KNOWN GAP (flagged for PM review, not fixed in this pass — Phase 1 order scope is prompt-only): an opening invented aggregate is NOT currently caught by the plain Brain — no preceding comparison scene exists to verify it against, so it silently binds as an unverified 4th "gap" entity with zero issues. The prompt-layer prohibition (api/generate.js) is the only current defense for this position; do not rely on this deterministic backstop for opening-position aggregates until it is explicitly authorized and fixed.', () => {
  const script = `These three decisions alone could cost you over $50,000 if you get them wrong. ${AGG_BASE}`;
  const sb = nextwaveV2BuildStoryboard(script, baseDeps);
  const fake = sb.values.find((v) => v.value === 50000);
  const issuesOnFake = sb.integrity.issues.filter((i) => i.entity === (fake && fake.id));
  assert.ok(fake && fake.role === 'gap', 'documents current behavior: the invented opening aggregate binds as role=gap');
  assert.equal(issuesOnFake.length, 0, 'documents current behavior: zero verification issues are raised for it — this is the gap this test exists to make visible, not to endorse');
});

console.log('\n[12] scanFree partition repair (2026-10-01) — paraphrase fields verified by numeric VALUE, never substring; evidence stays verbatim');
const PP_UNITS = [
  { unit: 'u00', text: 'Say you invest $150 every month, assuming an average 6.5 percent annual return.', mentions: [{ id: 'u00.m0', unit_id: 'u00', kind: 'money' }] },
  { unit: 'u01', text: 'But if you wait 8 years before you start, you end up with much less.', mentions: [{ id: 'u01.m0', unit_id: 'u01', kind: 'duration' }] },
];
const PP_MENTIONS = PP_UNITS.flatMap((u) => u.mentions);
const scenesFor = (purpose) => validateProposal({ mentions: [], scenarios: [], calculations: [], scenes: [
  { unit_ids: ['u00'], intent: 'flow', purpose: 'introduce the monthly amount', from_label: null, to_label: null },
  { unit_ids: ['u01'], intent: 'outcome_comparison', purpose, from_label: null, to_label: null },
] }, { units: PP_UNITS, mentions: PP_MENTIONS });
await t('A. real supported paraphrase passes: fresh Long #2\'s exact real rejected purpose string ("compare starting today versus delaying 8 years") now survives — the script genuinely has "wait 8 years"', () => {
  const { proposal, rejections } = scenesFor('comparing start today vs wait 8 years with gap');
  assert.equal(proposal.scenes.length, 2, `expected both scenes to survive, got: ${JSON.stringify(rejections)}`);
  assert.equal(rejections.length, 0, `expected zero rejections, got: ${JSON.stringify(rejections)}`);
});
await t('B. equivalent Long #2b case passes: the actual real rejected purpose string ("compare starting today versus waiting 6 years") now survives against a script with a genuine 6-year delay', () => {
  const units = [
    { unit: 'u00', text: 'Say you invest $200 every month, assuming an average 9 percent annual return.', mentions: [{ id: 'u00.m0', unit_id: 'u00', kind: 'money' }] },
    { unit: 'u01', text: 'But if you wait 6 years before you start, contributing the same $200 a month, you end up with only about $95784.', mentions: [{ id: 'u01.m0', unit_id: 'u01', kind: 'duration' }] },
  ];
  const mentions = units.flatMap((u) => u.mentions);
  const { proposal, rejections } = validateProposal({ mentions: [], scenarios: [], calculations: [], scenes: [
    { unit_ids: ['u00'], intent: 'flow', purpose: 'introduce the monthly amount', from_label: null, to_label: null },
    { unit_ids: ['u01'], intent: 'outcome_comparison', purpose: 'compare starting today versus waiting 6 years', from_label: null, to_label: null },
  ] }, { units, mentions });
  assert.equal(proposal.scenes.length, 2, `expected both scenes to survive, got: ${JSON.stringify(rejections)}`);
});
await t('C/F. fabricated numeric value fails and still invalidates the whole partition (the existing all-or-nothing safety behavior is unchanged)', () => {
  const { proposal, rejections } = scenesFor('comparing start today vs wait 95 years with gap');
  assert.equal(proposal.scenes.length, 0, 'a fabricated number must still wholesale-invalidate the partition, exactly as before this repair');
  assert.ok(rejections.some((r) => r.where === 'scenes[1].purpose' && /not present in the script/.test(r.why)), `expected the fabricated "95" to be rejected, got: ${JSON.stringify(rejections)}`);
});
await t('D. numeric substring collision fails: a purpose referencing "8" must NOT be validated merely because the script contains "80,000" — value equality, never substring containment', () => {
  const units = [{ unit: 'u00', text: 'Say you invest $80,000 in a fund.', mentions: [{ id: 'u00.m0', unit_id: 'u00', kind: 'money' }] }];
  const mentions = units.flatMap((u) => u.mentions);
  const { proposal, rejections } = validateProposal({ mentions: [], scenarios: [], calculations: [], scenes: [
    { unit_ids: ['u00'], intent: 'flow', purpose: 'the 8 dollar investment', from_label: null, to_label: null },
  ] }, { units, mentions });
  assert.equal(proposal.scenes.length, 0, '"8" must not pass merely because the script contains "80,000" — this is the exact collision the fix must prevent');
  assert.ok(rejections.some((r) => r.where === 'scenes[0].purpose'), `expected the unsupported "8" to be rejected, got: ${JSON.stringify(rejections)}`);
});
await t('E. evidence remains verbatim-gated exactly as before — a paraphrased (non-quote) evidence string still fails even though its number is real', () => {
  const units = [{ unit: 'u00', text: 'Say you invest $150 every month for 8 years.', mentions: [{ id: 'u00.m0', unit_id: 'u00', kind: 'money' }] }];
  const mentions = units.flatMap((u) => u.mentions);
  const { proposal, rejections } = validateProposal({ mentions: [
    { id: 'u00.m0', role: 'recurring_amount', confidence: 1, evidence: 'you put in 150 dollars monthly', label: null },
  ], scenarios: [], calculations: [], scenes: [] }, { units, mentions });
  assert.equal(Object.keys(proposal.mentions).length, 0, 'a paraphrased (non-verbatim) evidence quote must still be rejected — this repair touches ONLY purpose/from_label/to_label');
  assert.ok(rejections.some((r) => /evidence is not verbatim/.test(r.why)), `expected the verbatim-evidence rejection to be unchanged, got: ${JSON.stringify(rejections)}`);
});

console.log('\n[13] Disclaimer structural-markup repair (2026-10-02) — the "[DISCLAIMER:" bracket found baked into every B4 piece\'s closing captions');
const DISCLAIMED_SCRIPT = `${PASS_SCRIPT} [DISCLAIMER: Not financial advice. Educational only.]`;
const plainBrainDeps = { buildStoryboard: async (s) => nextwaveV2BuildStoryboard(s, baseDeps) };
await t('no "[DISCLAIMER:" markup reaches narration (TTS) — the stub narrate() receives the unwrapped disclosure sentence, never the tag', async () => {
  let capturedText = null;
  const { deps } = mkDeps({ ...plainBrainDeps, narrate: async (text) => { capturedText = text; return { ok: true, alignment: synthAlign(text), audio_url: 'stub://narration.mp3' }; } });
  const r = await startRoute({ script: DISCLAIMED_SCRIPT, formatName: 'long', title: 't', deps });
  assert.equal(r.status, 'planned', `expected a clean PASS, got: ${JSON.stringify(r.exception)}`);
  assert.ok(capturedText, 'narrate must have been called');
  assert.ok(!/\[DISCLAIMER/i.test(capturedText), `narration text must never contain the structural tag, got tail: ${capturedText.slice(-80)}`);
  assert.ok(!/\]/.test(capturedText), `narration text must never contain a stray closing bracket, got tail: ${capturedText.slice(-80)}`);
  assert.ok(/Not financial advice\. Educational only\./.test(capturedText), 'the actual disclosure SENTENCE must still be present — this is an unwrap, not a deletion');
});
await t('no "[DISCLAIMER:" markup reaches captions — the persisted/returned route script (what alignment and captions are built from) is equally clean', async () => {
  const { deps } = mkDeps(plainBrainDeps);
  const r = await startRoute({ script: DISCLAIMED_SCRIPT, formatName: 'long', title: 't', deps });
  assert.equal(r.status, 'planned');
  assert.ok(!/\[DISCLAIMER/i.test(r.script), `the route's own persisted script (source for wordsFromAlignment -> captions) must be clean, got tail: ${r.script.slice(-80)}`);
  assert.ok(/Not financial advice\. Educational only\./.test(r.script), 'the disclosure sentence must survive into the persisted/captioned script');
  assert.equal(r.qc_pre_render.ok, true, `QC must stay clean on the unwrapped script, got: ${JSON.stringify(r.qc_pre_render)}`);
});
await t('the Brain analyzes the ORIGINAL script unchanged — this repair touches only narration/caption text, never storyboard verification input', async () => {
  let brainSawText = null;
  const { deps } = mkDeps({ buildStoryboard: async (s) => { brainSawText = s; return brain(s); } });
  await startRoute({ script: DISCLAIMED_SCRIPT, formatName: 'long', title: 't', deps });
  assert.equal(brainSawText, DISCLAIMED_SCRIPT, 'the Brain must still receive the exact original script, bracket included — frozen Brain input is untouched');
});
await t('a script with no disclaimer suffix is unaffected (no-op for scripts that never had the tag)', async () => {
  let capturedText = null;
  const { deps } = mkDeps({ narrate: async (text) => { capturedText = text; return { ok: true, alignment: synthAlign(text), audio_url: 'stub://narration.mp3' }; } });
  const r = await startRoute({ script: PASS_SCRIPT, formatName: 'long', title: 't', deps });
  assert.equal(r.status, 'planned');
  assert.equal(capturedText, PASS_SCRIPT, 'a script with no bracket must pass through byte-for-byte unchanged');
});
await t('YouTube description AI/synthetic-media disclosure safety net is untouched by this repair (separate mechanism, api/ops.js _youtubeResumableUpload)', () => {
  const src = fs.readFileSync('./api/ops.js', 'utf8');
  assert.ok(/AI-generated avatar narration/.test(src), 'the existing YouTube-description AI-disclosure safety net must remain intact');
});

console.log('\n[14] Long visual-treatment variety (2026-10-02) — AVOID and SAVE no longer collapse onto the identical share_compare backdrop');
await t('AVOID (fee/fund) and SAVE (savings/CD) get distinct bar-scene environments — the real repetition found across both AVOID+SAVE+DECIDE B4 Longs', () => {
  const avoidEnv = barEnv('invest', 'annual fee');
  const saveEnv = barEnv('savings', 'annual yield');
  const loanEnv = barEnv('loan', 'annual rate');
  assert.notEqual(avoidEnv, saveEnv, `AVOID and SAVE must no longer share a backdrop, got both: ${avoidEnv}`);
  assert.notEqual(saveEnv, loanEnv, 'SAVE and DECIDE must remain distinct as before');
  assert.notEqual(avoidEnv, loanEnv, 'AVOID and DECIDE must remain distinct as before');
});
await t('SAVE\'s new environment (office) is fully programmatic — no new banked/generated asset, no new vendor cost', () => {
  assert.equal(barEnv('savings', 'annual yield'), 'office');
  const src = fs.readFileSync('./lib/nextwaveV2Renderer/sets.mjs', 'utf8');
  assert.ok(/export function officeSet/.test(src), 'officeSet must already exist as a programmatic renderer (no banked image dependency)');
});
await t('loan and kitchen/price environments are unchanged by this repair (bounded to the AVOID/SAVE collision only)', () => {
  assert.equal(barEnv('loan', ''), 'neighbourhood');
  assert.equal(barEnv('price', ''), 'kitchen');
  assert.equal(barEnv('invest', 'annual fee'), 'finance');
});

console.log('\n[15] P0 deterministic numeric-input verification (2026-10-03) — a calculation that cannot even evaluate with its mapped inputs is no longer a silent blind spot');
const mk = (value, kind = 'money') => ({ value, kind });
await t('6.5% -> "5%" must fail: real case — principal/years absent from the mapped inputs (the generator dropped that clause), rate+fee corrupted; compute() cannot evaluate at all, and this is now caught (not silently excluded)', () => {
  const mentionsById = new Map([['rate_m', mk(5)], ['fee_m', mk(1)], ['outcome_m', mk(113605)]]);
  const { details } = runCalculations({ calculations: [{ id: 'c1', model: 'compound_growth', inputs: { rate: { mention: 'rate_m' }, fee: { mention: 'fee_m' } }, output: 'end_value', target: 'outcome_m' }] }, mentionsById);
  assert.equal(details[0].ok, false);
  assert.equal(details[0].reason, 'model could not be evaluated with the mapped inputs');
  assert.equal(details[0].target, 'outcome_m', 'the target this unevaluable calc was supposed to verify must now be recorded, not dropped');
  assert.equal(details[0].stated, 113605, 'the stated figure it failed to verify must be recorded for the review issue');
});
await t('0.09% -> "09%"/9% must fail: wrong fee input, but principal/years ARE present so compute() evaluates to a real (wrong) number — this was already correctly caught before this repair and remains caught', () => {
  const mentionsById = new Map([['p_m', mk(15000)], ['y_m', mk(22)], ['rate_m', mk(6)], ['fee_m', mk(9)], ['outcome_m', mk(53052)]]);
  const { details } = runCalculations({ calculations: [{ id: 'c1', model: 'compound_growth', inputs: { principal: { mention: 'p_m' }, years: { mention: 'y_m' }, rate: { mention: 'rate_m' }, fee: { mention: 'fee_m' } }, output: 'end_value', target: 'outcome_m' }] }, mentionsById);
  assert.notEqual(details[0].ok, false, 'compute() must still evaluate (a real, if wrong, candidate exists)');
  assert.equal(details[0].verified, false, 'the wrong fee (9% instead of 0.09%) must not reproduce the true stated outcome');
});
await t('0.1% -> "1%" must fail: same missing-clause pattern as the 6.5->5 case, isolated to fee alone', () => {
  const mentionsById = new Map([['rate_m', mk(6.5)], ['fee_m', mk(1)], ['outcome_m', mk(113605)]]);
  const { details } = runCalculations({ calculations: [{ id: 'c1', model: 'compound_growth', inputs: { rate: { mention: 'rate_m' }, fee: { mention: 'fee_m' } }, output: 'end_value', target: 'outcome_m' }] }, mentionsById);
  assert.equal(details[0].ok, false); assert.equal(details[0].target, 'outcome_m'); assert.equal(details[0].stated, 113605);
});
await t('0.9% -> "9%" must fail (comparison_fee side of the same real case)', () => {
  const mentionsById = new Map([['rate_m', mk(6.5)], ['fee_m', mk(9)], ['outcome_m', mk(91964)]]);
  const { details } = runCalculations({ calculations: [{ id: 'c1', model: 'compound_growth', inputs: { rate: { mention: 'rate_m' }, fee: { mention: 'fee_m' } }, output: 'end_value', target: 'outcome_m' }] }, mentionsById);
  assert.equal(details[0].ok, false); assert.equal(details[0].target, 'outcome_m'); assert.equal(details[0].stated, 91964);
});
await t('1.15% -> "15%" must fail (the third real sample\'s exact comparison_fee corruption)', () => {
  const mentionsById = new Map([['rate_m', mk(6.5)], ['fee_m', mk(15)], ['outcome_m', mk(232109)]]);
  const { details } = runCalculations({ calculations: [{ id: 'c1', model: 'compound_growth', inputs: { rate: { mention: 'rate_m' }, fee: { mention: 'fee_m' } }, output: 'end_value', target: 'outcome_m' }] }, mentionsById);
  assert.equal(details[0].ok, false); assert.equal(details[0].target, 'outcome_m'); assert.equal(details[0].stated, 232109);
});
await t('correct fact-packet input + correct derived outcome -> PASS: the true 6.5%/0.1% over 28 years on $20,000 genuinely verifies', () => {
  const mentionsById = new Map([['p_m', mk(20000)], ['y_m', mk(28)], ['rate_m', mk(6.5)], ['fee_m', mk(0.1)], ['outcome_m', mk(113605)]]);
  const { results } = runCalculations({ calculations: [{ id: 'c1', model: 'compound_growth', inputs: { principal: { mention: 'p_m' }, years: { mention: 'y_m' }, rate: { mention: 'rate_m' }, fee: { mention: 'fee_m' } }, output: 'end_value', target: 'outcome_m' }] }, mentionsById);
  assert.equal(results.get('c1').verified, true, 'the real, correct inputs must still verify cleanly — this repair must not create false positives');
});
await t('wrong input that genuinely evaluates to a different number than stated (not an eval failure) remains correctly caught exactly as before — unaffected by this repair', () => {
  const mentionsById = new Map([['p_m', mk(20000)], ['y_m', mk(28)], ['rate_m', mk(5)], ['fee_m', mk(1)], ['outcome_m', mk(113605)]]);
  const { details } = runCalculations({ calculations: [{ id: 'c1', model: 'compound_growth', inputs: { principal: { mention: 'p_m' }, years: { mention: 'y_m' }, rate: { mention: 'rate_m' }, fee: { mention: 'fee_m' } }, output: 'end_value', target: 'outcome_m' }] }, mentionsById);
  assert.notEqual(details[0].ok, false, 'compute() evaluates fine with valid-shaped (if wrong) numeric inputs — this is the pre-existing, already-working catch path');
  assert.equal(details[0].verified, false);
  assert.ok(Math.abs(details[0].computed - 59974) < 1, `expected the wrong-input computation (~$59,974), got ${details[0].computed}`);
});
await t('integer-valued rates/fees remain valid: a plain 6% rate with no decimal still verifies normally (this repair only affects calculations that cannot evaluate at all)', () => {
  const mentionsById = new Map([['p_m', mk(10000)], ['y_m', mk(10)], ['rate_m', mk(6)], ['outcome_m', mk(17908)]]);
  const { results } = runCalculations({ calculations: [{ id: 'c1', model: 'compound_growth', inputs: { principal: { mention: 'p_m' }, years: { mention: 'y_m' }, rate: { mention: 'rate_m' } }, output: 'end_value', target: 'outcome_m' }] }, mentionsById);
  assert.equal(results.get('c1').verified, true);
});
await t('a cascading "depends on a calculation that did not resolve" failure (never has a target) remains unaffected — this repair is scoped only to the unevaluable-with-mapped-inputs case', () => {
  const { details } = runCalculations({ calculations: [{ id: 'c1', model: 'compound_growth', inputs: {}, output: 'end_value', target: 'outcome_m' }, { id: 'c2', model: 'arithmetic', inputs: { a: { calc: 'c1' } }, output: 'value', target: 'gap_m' }] }, new Map([['outcome_m', mk(113605)], ['gap_m', mk(5000)]]));
  const c2detail = details.find((d) => d.calc === 'c2');
  assert.equal(c2detail.reason, 'depends on a calculation that did not resolve');
  assert.equal(c2detail.target, undefined, 'a dependency-chain cascade failure still carries no target — unchanged from before this repair');
});

console.log('\n[16] Number Narration Clarity Gate (2026-10-03) — deterministic spoken-number expansion/collapse (lib/nextwaveV2Renderer/production/speech.mjs)');
const REGRESSION_MATRIX = [
  { span: '$2,346', kind: 'money', value: 2346 }, { span: '$25,500', kind: 'money', value: 25500 },
  { span: '$303,597', kind: 'money', value: 303597 }, { span: '$1,000,000', kind: 'money', value: 1000000 },
  { span: '0.06%', kind: 'percent', value: 0.06 }, { span: '0.09%', kind: 'percent', value: 0.09 },
  { span: '0.1%', kind: 'percent', value: 0.1 }, { span: '0.9%', kind: 'percent', value: 0.9 },
  { span: '1.15%', kind: 'percent', value: 1.15 }, { span: '6.5%', kind: 'percent', value: 6.5 },
  { span: '7.5%', kind: 'percent', value: 7.5 }, { span: '8%', kind: 'percent', value: 8 },
  { span: '8 years', kind: 'duration', value: 8 }, { span: '24 years', kind: 'duration', value: 24 },
];
await t('spoken-form round-trip: every required regression value speaks a phrase that the EXISTING production words-to-number parser (api/ops.js _nextwaveWordsToNumber, lifted verbatim into baseDeps) reads back to the identical numeric value — canonical meaning preserved end-to-end, text differs, value never does', () => {
  for (const { span, kind, value } of REGRESSION_MATRIX) {
    const r = spanTextToSpoken(span, kind);
    assert.ok(r, `spanTextToSpoken returned null for ${span}`);
    const { value: roundTripped } = baseDeps.wordsToNumber(r.text);
    assert.ok(Math.abs(roundTripped - value) < 1e-9, `${span} -> "${r.text}" -> ${roundTripped}, expected ${value}`);
  }
});
await t('percent SYMBOL-form spans ("0.06%") never pass a literal "%" character to TTS — the entity\'s kind drives the spoken unit word, never the source punctuation (ElevenLabs\' handling of raw symbols/tags was already shown unreliable by the earlier <break> tag probe)', () => {
  assert.equal(spanTextToSpoken('0.06%', 'percent').text, 'zero point zero six percent');
  assert.equal(spanTextToSpoken('6.5%', 'percent').text, 'six point five percent');
  for (const { span } of REGRESSION_MATRIX.filter((m) => m.kind === 'percent')) assert.ok(!spanTextToSpoken(span, 'percent').text.includes('%'), `no literal % may reach the spoken string for ${span}`);
});
await t('decimal precision is never lost or coarsened: 0.06 / 0.09 / 0.1 / 0.9 / 1.15 remain distinct from each other and from any whole-number reading', () => {
  const spoken = ['0.06%', '0.09%', '0.1%', '0.9%', '1.15%'].map((s) => spanTextToSpoken(s, 'percent').text);
  assert.deepEqual(spoken, ['zero point zero six percent', 'zero point zero nine percent', 'zero point one percent', 'zero point nine percent', 'one point one five percent']);
  assert.equal(new Set(spoken).size, spoken.length, 'every distinct input decimal must produce a distinct spoken phrase (the exact "0.06% must never become six percent" invariant the PM order requires)');
});
await t('large integers expand correctly through the thousand/million scale: $303,597 and $1,000,000', () => {
  assert.equal(spanTextToSpoken('$303,597', 'money').text, 'three hundred three thousand five hundred ninety-seven dollars');
  assert.equal(spanTextToSpoken('$1,000,000', 'money').text, 'one million dollars');
});
await t('durations speak the number but reuse the actual written unit word verbatim (never re-derived or re-pluralized): 8 years vs 24 years, never confused with a same-numeral percent (8 years vs 8%)', () => {
  assert.equal(spanTextToSpoken('8 years', 'duration').text, 'eight years');
  assert.equal(spanTextToSpoken('24 years', 'duration').text, 'twenty-four years');
  assert.notEqual(spanTextToSpoken('8 years', 'duration').text, spanTextToSpoken('8%', 'percent').text);
});
await t('the collapsed caption token is the ORIGINAL numeral exactly as written, never the Brain\'s reformatted display field, and never bundled with a trailing unit word as a second token — this is what keeps the real caption renderer\'s one-token-per-word.w invariant intact for a multi-token span like "8 years" (a bug caught and fixed this pass: collapsing the whole phrase to a two-word display crashed drawCaptions)', () => {
  assert.equal(spanTextToSpoken('8 years', 'duration').numericDisplay, '8');
  assert.equal(spanTextToSpoken('7 percent', 'percent').numericDisplay, '7');
  assert.equal(spanTextToSpoken('$2,346', 'money').numericDisplay, '$2,346');
  assert.equal(spanTextToSpoken('6.5%', 'percent').numericDisplay, '6.5%');
});
await t('a range or compact-scale shorthand this gate does not cover safely fails closed (returns null) rather than silently dropping part of the meaning — the exact real defect found in script A, where "2 to 3 days" first expanded to just "two days", losing the upper bound entirely', () => {
  assert.equal(spanTextToSpoken('2 to 3 days', 'duration'), null);
  assert.equal(spanTextToSpoken('$2.3 million', 'money'), null);
});

console.log('\n[16b] Number Narration — full expand/collapse pipeline against a synthetic multi-value script (canonical/display/alignment mapping + neighbor safety)');
const NN_SCRIPT = 'The starting amount is $2,346 today. The rate is 6.5% with a 0.1% fee, but a corrupted comparison once used 1.15% instead. Over 8 years the outcome reaches $25,500, and over 24 years it reaches $303,597, a gap worth $1,000,000 if ignored. Smaller fee variants of 0.06%, 0.09%, 0.9%, 7.5%, and 8% were also tested.';
const NN_SPECS = [
  { span: '$2,346', kind: 'money', display: '$2,346' }, { span: '6.5%', kind: 'percent', display: '6.5%' },
  { span: '0.1%', kind: 'percent', display: '0.1%' }, { span: '1.15%', kind: 'percent', display: '1.15%' },
  { span: '8 years', kind: 'duration', display: '8' }, { span: '$25,500', kind: 'money', display: '$25,500' },
  { span: '24 years', kind: 'duration', display: '24' }, { span: '$303,597', kind: 'money', display: '$303,597' },
  { span: '$1,000,000', kind: 'money', display: '$1,000,000' }, { span: '0.06%', kind: 'percent', display: '0.06%' },
  { span: '0.09%', kind: 'percent', display: '0.09%' }, { span: '0.9%', kind: 'percent', display: '0.9%' },
  { span: '7.5%', kind: 'percent', display: '7.5%' }, { span: '8%', kind: 'percent', display: '8%' },
];
const buildValues = (script, specs) => { let cursor = 0; return specs.map((s, i) => { const start = script.indexOf(s.span, cursor); assert.ok(start >= 0, `fixture error: "${s.span}" not found in NN_SCRIPT after offset ${cursor}`); const end = start + s.span.length; cursor = end; return { id: `v${i}`, kind: s.kind, display: s.display, provenance: { kind: 'script', unit_id: `u${String(i).padStart(2, '0')}`, span_text: s.span, start: 0, end: s.span.length } }; }); };
const NN_VALUES = buildValues(NN_SCRIPT, NN_SPECS);
await t('every one of the 14 regression-matrix values survives expand -> synthetic ElevenLabs-shaped alignment -> collapse, landing on its OWN numeral, in script order, with none skipped and none merged into a neighbor, and every caption word stays a single space-free token (the exact invariant the real captions.mjs renderer requires)', () => {
  const { ttsText, spans } = expandNumbersForSpeech(NN_SCRIPT, NN_VALUES);
  assert.equal(spans.length, NN_VALUES.length, 'every regression-matrix value must produce exactly one TTS span — none silently skipped');
  const alignment = synthAlign(ttsText);
  const words = wordsFromAlignmentWithSpeechSpans(ttsText, alignment, spans);
  words.forEach((w) => assert.ok(!/\s/.test(w.w), `caption word "${w.w}" contains whitespace — would desync the real caption renderer's per-token index`));
  const collapsed = words.filter((w) => NN_VALUES.some((v) => v.display === w.w));
  assert.equal(collapsed.length, NN_VALUES.length, `expected exactly ${NN_VALUES.length} collapsed numeral caption words, got ${collapsed.length}`);
  NN_VALUES.forEach((v, i) => assert.equal(collapsed[i].w, v.display, `value #${i} ("${v.provenance.span_text}") collapsed to the wrong entity — possible cross-mapping to a neighbor`));
  for (let i = 1; i < collapsed.length; i++) assert.ok(collapsed[i].start >= collapsed[i - 1].end, `collapsed caption entries must never overlap in time (index ${i}: "${collapsed[i - 1].w}" vs "${collapsed[i].w}")`);
  assert.equal(words.length, NN_SCRIPT.split(/\s+/).filter(Boolean).length, 'collapsing a multi-word spoken numeral back to one caption word must never change the overall caption word count the renderer/alignment sanity check expects');
});
await t('expandNumbersForSpeech never mutates its inputs — the canonical script string and every value\'s display/provenance fields are byte-identical before and after (representation C is derived FROM A/B, it never writes back into them)', () => {
  const before = JSON.stringify(NN_VALUES);
  expandNumbersForSpeech(NN_SCRIPT, NN_VALUES);
  assert.equal(JSON.stringify(NN_VALUES), before);
});
await t('a script with zero script-sourced financial values is a true no-op — already-spelled-out scripts (e.g. the accepted PASS_SCRIPT fixture, which already reads "five hundred dollars" etc.) are left byte-for-byte unchanged, exactly as before this gate existed', () => {
  const { ttsText, spans } = expandNumbersForSpeech(PASS_SCRIPT, []);
  assert.equal(ttsText, PASS_SCRIPT);
  assert.equal(spans.length, 0);
});
await t('REGRESSION (2026-10-03 real defect, script A): a duplicate span_text ("$3,000" appearing twice) resolves each occurrence to its OWN position via document order rather than scrambling the text, and the unsupported range form ("2 to 3 days") safely falls back to fully unexpanded rather than silently losing its upper bound', async () => {
  const scriptA = scriptOf('A');
  const b = await brain(scriptA);
  const { ttsText, spans } = expandNumbersForSpeech(scriptA, b.values);
  assert.ok(ttsText.includes('paid you three thousand dollars in dividends'), 'first $3,000 occurrence must expand in place, not scramble the preceding prose');
  assert.ok(ttsText.includes('same three thousand dollars buys fewer shares'), 'second $3,000 occurrence must resolve to ITS OWN position, not collide with the first one\'s');
  assert.ok(ttsText.includes('take 2 to 3 days to process'), '"2 to 3 days" is a range this gate does not cover — it must be left exactly as written, never truncated to "two days"');
  assert.equal(spans.length, 3, 'exactly 3 of the 4 script-sourced mentions expand ($3,000 x2, 2% — the range is correctly skipped)');
});

console.log(`\n${pass} passed, ${fail} failed`); if (fail) { console.log('FAILED:', failures.join(' | ')); process.exit(1); }
