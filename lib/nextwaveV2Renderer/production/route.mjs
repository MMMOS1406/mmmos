// NextWave V2 production route — approved script -> guarded Storyboard Brain -> PASS/NEEDS_REVIEW/BLOCK -> assets ->
// narration/alignment -> accepted V2 renderer -> thumbnail -> automated QC -> hand-off to the existing Review/Approve lifecycle.
// All I/O is injected (`deps`), so the same code runs in the serverless action handlers and in local dry-runs with stubs.
// Nothing in this module publishes anything: its terminal state is `ready_for_review`, `needs_review` or `blocked`.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { STYLE, loadSpriteFromUrl } from '../core.mjs';
import { wordsFromAlignment } from '../captions.mjs';
import { renderVideo } from '../render.mjs';
import { loadHostPoses } from '../assets.mjs';
import { loadBench } from '../props3.mjs';
import { composeStoryboard, SUPPORTED_TREATMENTS } from './compose.mjs';
import { deriveSceneSpec } from './scenespec.mjs';
import { chooseIllustratedBeats } from './illustration.mjs';
import { runQc } from './qc.mjs';
import { renderThumbnail } from './thumbnails.mjs';

export const ROUTE_VERSION = '2.2'; // bump whenever templates/compose change: it is part of the build id, so stale chunks are never reused
export const CHUNK_SECONDS = 8;
export const MAX_SCRIPT_CHARS = { short: 1500, long: 6000 };
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ── 1. gate: the Brain's verdict decides everything downstream ───────────────────────────────────────────────────────
export function classifyGate(brain) {
  if (!brain || brain.ok !== true) return { route: 'BLOCK', reasons: [{ kind: 'brain_error', detail: (brain && brain.error) || 'no storyboard' }] };
  const st = brain.integrity && brain.integrity.status; const issues = (brain.integrity && brain.integrity.issues) || [];
  const reasons = issues.map((i) => ({ kind: i.kind, severity: i.severity }));
  if (st === 'blocked') return { route: 'BLOCK', reasons };
  if (st === 'needs_review') return { route: 'NEEDS_REVIEW', reasons };
  if (st !== 'clean') return { route: 'BLOCK', reasons: [{ kind: 'unknown_integrity_status', detail: String(st) }] };
  const bad = (brain.scenes || []).filter((s) => !s.renderer_params || !SUPPORTED_TREATMENTS.includes(s.renderer_params.treatment));
  if (bad.length) return { route: 'NEEDS_REVIEW', reasons: bad.map((s) => ({ kind: 'unsupported_treatment', scene: s.scene_id, treatment: s.renderer_params && s.renderer_params.treatment })) };
  return { route: 'PASS', reasons: [] };
}

// ── 2. assets: reuse-first. Everything the templates draw is programmatic or already in the bank; a missing bank file is the
//    only case that would call Ideogram (bounded, registered, text-free prompts). ──────────────────────────────────────────
export const BANK_REQUIREMENTS = { day_cards: ['bg.roadWide', 'prop.wagon'], share_compare: ['bg.kitchenTall', 'bg.kitchenWide', 'prop.bag'], stock_chart: [], avatar_panel: [], money_flow: [], calc_card: [] };
export const ASSET_PROMPTS = {
  'bg.roadWide': 'wide panoramic countryside at golden hour: layered rolling green hills, distant town, empty meadow path',
  'bg.kitchenWide': 'cozy modern family kitchen interior, straight-on, empty wooden countertop lower third', 'bg.kitchenTall': 'cozy modern family kitchen interior vertical, empty wooden countertop lower third',
  'prop.wagon': 'small rustic wooden hand wagon, side view, empty open bed', 'prop.bag': 'brown paper grocery bag overflowing with vegetables and bread',
};
export function planAssets(storyboard, bench, formatName) {
  const need = new Set(); (storyboard.scenes || []).forEach((s) => { const t = s.renderer_params && s.renderer_params.treatment; (BANK_REQUIREMENTS[t] || []).forEach((k) => { if (t === 'share_compare' && s.renderer_params.displayMode !== 'chips') return; if (k === 'bg.kitchenTall' && formatName !== 'short') return; if (k === 'bg.kitchenWide' && formatName === 'short') return; need.add(k); }); });
  const has = (k) => { const [a, b] = k.split('.'); return !!(bench && bench[a] && bench[a][b]); };
  const reused = [...need].filter(has), missing = [...need].filter((k) => !has(k));
  const requirements = (storyboard.scenes || []).flatMap((s) => (s.asset_requirements || []).map((r) => ({ scene: s.scene_id, type: r.type, concept: r.concept, resolution: 'programmatic_prop_or_environment_family', reuse_first: true })));
  return { bank_reused: reused, missing, generate: missing.map((k) => ({ key: k, prompt: ASSET_PROMPTS[k], est_usd: 0.03 })), requirements, host_poses: ['point', 'card', 'compare', 'react', 'think'], est_ideogram_usd: +(missing.length * 0.03).toFixed(2) };
}

// ── 2b. topic-specific illustration layer (bounded preview integration) — resolves the hook (Long) / dominant
//    comparison (Short) beat via deps.illustrateBeat (reuse/generate/QC; injected, so this is a no-op skip when the
//    caller doesn't wire it — every existing behavior is unchanged unless deps.illustrateBeat is provided). A
//    generation/QC failure never silently becomes a Creative PASS: it sets creative_qc.status = 'needs_review'.
export async function resolveIllustration(brain, formatName, deps) {
  if (!deps.illustrateBeat) return null;
  const choice = chooseIllustratedBeats(brain.scenes, formatName);
  const valuesById = new Map((brain.values || []).map((v) => [v.id, v]));
  const perScene = {}; const vendor = { ideogram_images: 0, ideogram_usd: 0, qc_calls: 0, qc_usd: 0 }; let reused = 0, generated = 0, fallback = 0; const fallbackReasons = [];
  for (const [mode, idx] of [['hook', choice.hookIdx], ['comparison', choice.dominantIdx]]) {
    if (idx == null || idx < 0) continue; const scene = brain.scenes[idx];
    const spec = deriveSceneSpec({ scene, index: idx, allScenes: brain.scenes, format: formatName, valuesById });
    let r; try { r = await deps.illustrateBeat(spec, mode); } catch (e) { r = { ok: false, mode: 'fallback', vendor: { ideogram_images: 0, ideogram_usd: 0, qc_calls: 0, qc_usd: 0 }, reasons: [`illustrate_exception: ${e.message}`] }; }
    vendor.ideogram_images += r.vendor.ideogram_images; vendor.ideogram_usd += r.vendor.ideogram_usd; vendor.qc_calls += r.vendor.qc_calls; vendor.qc_usd += r.vendor.qc_usd;
    if (r.ok) { perScene[idx] = { mode, asset_url: r.asset_url, asset_id: r.asset_id, source: r.mode, spec_relationship: spec.relationship, spec_topic: spec.topic }; if (r.mode === 'reuse') reused++; else generated++; }
    else { fallback++; fallbackReasons.push({ scene: scene.scene_id, mode, reasons: r.reasons }); }
  }
  return { perScene, vendor, decision: choice, counts: { reused, generated, fallback }, creative_qc: fallback > 0 ? { status: 'needs_review', reasons: fallbackReasons, owner: 'va_production_product_qc' } : { status: 'pass', reasons: [] } };
}
async function loadIllustrationImages(illustration) {
  const images = {}; if (!illustration) return images;
  for (const [idx, v] of Object.entries(illustration.perScene || {})) { try { images[idx] = { mode: v.mode, image: await loadSpriteFromUrl(v.asset_url) }; } catch { /* falls through to the scene's normal renderer-2.1 template */ } }
  return images;
}

// ── 3. start: gate -> narration -> compile (fast pre-render QC). Vendor spend happens only AFTER a PASS. ─────────────────────
export async function startRoute({ script, formatName, title, deps }) {
  const out = { route_version: ROUTE_VERSION, format: formatName, script, script_sha256: sha(script), vendor: { anthropic_calls: 0, elevenlabs_chars: 0, ideogram_images: 0 }, stages: [] };
  const stage = (name, ok, extra = {}) => out.stages.push({ name, ok, ...extra });
  if (!STYLE.formats[formatName]) return { ...out, status: 'blocked', gate: { route: 'BLOCK', reasons: [{ kind: 'unknown_format', detail: formatName }] } };
  if (typeof script !== 'string' || !script.trim() || script.length > MAX_SCRIPT_CHARS[formatName]) return { ...out, status: 'blocked', gate: { route: 'BLOCK', reasons: [{ kind: 'script_length', detail: `1..${MAX_SCRIPT_CHARS[formatName]} chars` }] } };
  let brain; try { brain = await deps.buildStoryboard(script); out.vendor.anthropic_calls = brain && brain.semantic && brain.semantic.live_calls != null ? brain.semantic.live_calls : 2; } catch (e) { brain = { ok: false, error: e.message }; }
  const gate = classifyGate(brain); out.gate = gate; stage('storyboard_brain', gate.route === 'PASS', { route: gate.route, integrity: brain && brain.integrity && brain.integrity.status });
  if (gate.route !== 'PASS') return { ...out, status: gate.route === 'BLOCK' ? 'blocked' : 'needs_review', stopped_before: 'assets_narration_render', exception: { route: gate.route, reasons: gate.reasons, scenes_affected: (brain.integrity && brain.integrity.issues || []).map((i) => i.scene || i.entity || i.target).filter(Boolean).slice(0, 10), owner: gate.route === 'BLOCK' ? 'engineering_triage' : 'va_production_product_qc' } };
  out.storyboard = brain;
  const poses = await deps.loadPoses(); let bench = await deps.loadBench(); const assetPlan = planAssets(brain, bench, formatName); out.asset_plan = assetPlan;
  if (assetPlan.missing.length) { if (!deps.generateAsset) { stage('assets', false, { missing: assetPlan.missing }); return { ...out, status: 'needs_review', exception: { route: 'NEEDS_REVIEW', reasons: [{ kind: 'bank_asset_missing', detail: assetPlan.missing }], owner: 'engineering_triage' } }; } for (const m of assetPlan.generate) { await deps.generateAsset(m); out.vendor.ideogram_images++; } bench = await deps.loadBench(); const still = planAssets(brain, bench, formatName).missing; if (still.length) { stage('assets', false, { missing: still }); return { ...out, status: 'needs_review', exception: { route: 'NEEDS_REVIEW', reasons: [{ kind: 'bank_asset_missing', detail: still }], owner: 'engineering_triage' } }; } }
  stage('assets', true, { reused: assetPlan.bank_reused.length, generated: out.vendor.ideogram_images });
  const illustration = await resolveIllustration(brain, formatName, deps); out.illustration = illustration;
  if (illustration) { out.vendor.ideogram_images += illustration.vendor.ideogram_images; out.vendor.ideogram_usd = +((out.vendor.ideogram_usd || 0) + illustration.vendor.ideogram_usd).toFixed(4); out.vendor.qc_calls = illustration.vendor.qc_calls; out.vendor.qc_usd = +illustration.vendor.qc_usd.toFixed(4); }
  stage('illustration', !illustration || illustration.creative_qc.status === 'pass', illustration ? { reused: illustration.counts.reused, generated: illustration.counts.generated, fallback: illustration.counts.fallback } : { skipped: true });
  const nar = await deps.narrate(script); if (!nar || !nar.ok) { stage('narration', false, { error: nar && nar.error }); return { ...out, status: 'blocked', exception: { route: 'BLOCK', reasons: [{ kind: 'narration_failed', detail: nar && nar.error }], owner: 'engineering_triage' } }; }
  out.vendor.elevenlabs_chars = script.length; out.narration = nar; const words = wordsFromAlignment(script, nar.alignment);
  if (words.length < script.split(/\s+/).filter(Boolean).length * 0.98) { stage('alignment', false); return { ...out, status: 'blocked', exception: { route: 'BLOCK', reasons: [{ kind: 'alignment_incomplete' }], owner: 'engineering_triage' } }; }
  stage('narration', true, { chars: script.length, words: words.length });
  const format = STYLE.formats[formatName]; const illustrationImages = await loadIllustrationImages(illustration); const C = composeStoryboard({ storyboard: brain, words, assets: { poses, bench }, format, illustration: illustrationImages });
  const unlocated = C.scenes.filter((s) => !s.located); const qc = runQc({ format, formatName, drawFrame: C.draw, duration: C.duration, scenes: C.scenes, storyboard: brain, script, derived: C.derived, words });
  stage('compile_qc', qc.ok && !unlocated.length, { issues: qc.issues.map((i) => i.kind), unlocated: unlocated.map((s) => s.id) }); out.qc_pre_render = qc;
  if (!qc.ok || unlocated.length) return { ...out, status: 'needs_review', stopped_before: 'render', exception: { route: 'NEEDS_REVIEW', reasons: [...qc.issues.map((i) => ({ kind: i.kind })), ...unlocated.map((s) => ({ kind: 'scene_not_located_in_narration', scene: s.id }))], owner: 'va_production_product_qc' } };
  out.timeline = C.scenes; out.duration_sec = +C.duration.toFixed(2); out.chunks = chunkPlan(C.duration); out.words_count = words.length; out.title = title || null;
  return { ...out, status: 'planned', _compiled: { C, words, format, poses, bench } };
}
export function chunkPlan(duration, sec = CHUNK_SECONDS) { const n = Math.ceil(duration / sec); return Array.from({ length: n }, (_, i) => ({ index: i, tStart: +(i * sec).toFixed(3), dur: +Math.min(sec, duration - i * sec).toFixed(3) })); }

// ── 4. render one chunk (video only) / finalize (concat + mux narration + thumbnail + post-encode probe) ────────────────────────
export async function renderChunk({ C, format, chunk, outPath, ffmpegPath, onProgress }) { mkdirSync(join(outPath, '..'), { recursive: true }); await renderVideo({ ffmpegPath, format, duration: chunk.dur, drawFrame: C.draw, outPath, tStart: chunk.tStart, onProgress, crf: 20 }); return outPath; }
const run = (bin, args) => new Promise((res, rej) => { const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let e = ''; p.stderr.on('data', (d) => { e += d.toString().slice(-1500); }); p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg: ' + e.slice(-500))))); });
export async function finalizeVideo({ chunkPaths, audioPath, outPath, ffmpegPath, workDir, duration }) {
  const list = join(workDir, 'concat.txt'); writeFileSync(list, chunkPaths.map((p) => `file '${p}'`).join('\n'));
  await run(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-t', Number(duration).toFixed(3), '-movflags', '+faststart', outPath]); return outPath;
}
export function probe(ffmpegPath, path) { return new Promise((res) => { const p = spawn(ffmpegPath, ['-i', path], { stdio: ['ignore', 'ignore', 'pipe'] }); let e = ''; p.stderr.on('data', (d) => { e += d.toString(); }); p.on('close', () => { const d = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(e); const v = /Video: .*?, (\d+)x(\d+)/.exec(e); res({ duration: d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : null, width: v ? +v[1] : null, height: v ? +v[2] : null, has_audio: /Audio:/.test(e), has_video: /Video:/.test(e) }); }); }); }
export const makeThumbnail = ({ storyboard, formatName, title, bench }) => renderThumbnail({ storyboard, format: formatName, title, bench });
export { loadHostPoses, loadBench };

// wraps a live model caller so every call is tallied (calls / tokens / USD) — the route reports its own model spend
export function makeTalliedCaller(live, costOf) {
  const tally = { live_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  const callModel = async (system, user) => { const r = await live(system, user); tally.live_calls++; tally.input_tokens += (r.usage && r.usage.input_tokens) || 0; tally.output_tokens += (r.usage && r.usage.output_tokens) || 0; tally.cost_usd += costOf ? costOf(r.usage) : 0; return r; };
  return { callModel, tally };
}
// compact, serialisable build state persisted between the serverless invocations (start -> chunk* -> finish)
export function buildStateFrom(route, { title, buildId, model }) {
  return { route_version: ROUTE_VERSION, build_id: buildId, format: route.format, title: title || null, script_sha256: route.script_sha256, status: route.status, gate: route.gate, stages: route.stages,
    storyboard: route.storyboard, alignment: route.narration && route.narration.alignment, script: route.script, duration_sec: route.duration_sec, chunks: route.chunks, timeline: route.timeline,
    audio_url: route.narration && route.narration.audio_url, asset_plan: route.asset_plan, qc_pre_render: route.qc_pre_render, exception: route.exception || null, vendor: { ...route.vendor, model },
    illustration: route.illustration ? { perScene: route.illustration.perScene, counts: route.illustration.counts, creative_qc: route.illustration.creative_qc, decision: route.illustration.decision } : null,
    created_at: new Date().toISOString() };
}
// deterministic recompile from persisted state (used by every chunk invocation) — re-fetches any illustrated
// beat's image by its stored permanent URL, so every chunk (and any resume) renders byte-identical frames.
export async function compileFromState(state, deps) {
  const format = STYLE.formats[state.format]; const words = wordsFromAlignment(state.script, state.alignment); const poses = await deps.loadPoses(); const bench = await deps.loadBench();
  const illustrationImages = await loadIllustrationImages(state.illustration);
  return { C: composeStoryboard({ storyboard: state.storyboard, words, assets: { poses, bench }, format, illustration: illustrationImages }), format, words, bench };
}
