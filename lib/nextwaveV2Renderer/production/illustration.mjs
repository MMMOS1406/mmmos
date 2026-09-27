// NextWave V2 production — asset decision + prompt construction for the topic-specific illustration layer.
// PURE logic (no network, no Supabase, no vendor call) so it is fully unit-testable offline. All I/O (Ideogram,
// Claude-vision QC, asset-library lookup/insert) is injected by the caller (api/ops.js), exactly like route.mjs's
// existing `deps.buildStoryboard` / `deps.narrate` pattern.
const STYLE = 'flat editorial vector illustration, painterly cinematic lighting, warm cream navy and gold palette, soft atmospheric depth, original illustration style consistent with the NextWave brand, no text, no letters, no numbers, no logos, no watermark, no UI, no chart panels';
const NEG = 'text, letters, numbers, words, watermark, signage, UI, chart, graph, dashboard';

// Which beats are eligible for topic-specific GENERATION this round (bounded, per the PMO order — "generation must
// serve the narration/argument", not increase variety for its own sake):
//   LONG : the opening hook only (avatar_panel/presenter_hook) — the weakest, most generic "host+backdrop+object"
//          moment identified by Creative review; every other beat keeps its existing renderer-2.1 template/asset
//          (race/orchard/bar/kitchen — already reuse-appropriate per rule A of the order).
//   SHORT: the single dominant comparison beat (its one major idea) — never the hook or close, and never more than
//          one generated scene, so Short stays fast and uncluttered per the order's Short rules.
export function chooseIllustratedBeats(scenes, formatName) {
  const out = { hookIdx: -1, dominantIdx: -1 };
  if (!scenes || !scenes.length) return out;
  if (formatName === 'long') { if (scenes[0].renderer_params?.treatment === 'avatar_panel' && /hook/.test(scenes[0].intent || '')) out.hookIdx = 0; return out; }
  // short: the comparison-shaped beat with the most evidence entities (ties broken by first occurrence)
  let best = -1, bestScore = -1;
  scenes.forEach((s, i) => { if (i === 0 || i === scenes.length - 1) return; const p = s.renderer_params || {}; if (!['stock_chart', 'share_compare'].includes(p.treatment)) return; const score = (s.reveal_steps || []).length; if (score > bestScore) { bestScore = score; best = i; } });
  out.dominantIdx = best; return out;
}

export const assetKey = (spec) => `${spec.relationship || 'none'}|${spec.topic || 'none'}|${spec.format}`;

// One-sentence-per-field prompt, built from the Scene Spec's own fields (never a fixed per-topic string table —
// this is meant to generalize to relationships/topics beyond the ones named in the order).
export function buildPrompt(spec) {
  const rel = spec.relationship; const subj = spec.required_subjects || 'the financial idea in this beat';
  const composition = spec.format === 'short'
    ? 'a tall vertical illustrated composition, camera looking up/along the scene, single dominant idea filling the frame'
    : 'a wide cinematic illustrated composition, single continuous scene, layered depth for a camera to move through';
  const ask = `An original illustrated scene whose composition visually explains this financial idea: ${spec.visual_objective}. The scene must clearly show ${subj}, set in a context matching ${spec.environment_hint}. ${composition}. ${STYLE}.`;
  return { prompt: ask, negative: NEG, aspect: spec.format === 'short' ? '9x16' : '16x9' };
}

// mode: 'reuse' (an approved matching asset exists) | 'generate' (no match, attempt Ideogram) | 'skip' (not an
// illustrated beat this round — stays on the existing renderer-2.1 template, unchanged).
export function planAsset(spec, approvedMatch) {
  if (!spec) return { mode: 'skip' };
  if (approvedMatch) return { mode: 'reuse', asset: approvedMatch };
  return { mode: 'generate', ...buildPrompt(spec) };
}

// QC prompt sent with the generated image to the vision check (Anthropic, already-approved vendor).
export function qcPrompt(spec) {
  return `You are a strict visual QC reviewer for a financial-education video illustration. The Scene Spec required: visual objective = "${spec.visual_objective}"; required subjects = "${spec.required_subjects}"; format = ${spec.format} (${spec.format === 'short' ? 'must be a native vertical composition' : 'must be a native wide composition'}).
Look at the attached image and answer ONLY with compact JSON: {"pass": true|false, "reasons": ["..."]}.
Reject (pass:false) if ANY of these are true: the image does not match the visual objective; the required subjects/relationship are not actually present (illustrated people ARE allowed and are not a reason to reject on their own); the image contains any rendered text, numbers, currency symbols, or chart/UI panels; the composition visually implies a financial relationship (e.g. which side is bigger) that could contradict real data; there are obvious generation artifacts (mirrored/duplicated geometry, broken lines, warped forms); the aspect/orientation does not match the required format; the style looks like generic stock AI art rather than a coherent illustration; there is no reasonably clear, uncluttered area where text captions could be placed without covering the main subject.
Return ONLY the JSON object, nothing else.`;
}

export function parseQcResponse(text) {
  try { const m = /\{[\s\S]*\}/.exec(text); if (!m) return { pass: false, reasons: ['qc_response_unparseable'] }; const j = JSON.parse(m[0]); return { pass: !!j.pass, reasons: Array.isArray(j.reasons) ? j.reasons.slice(0, 6) : [] }; }
  catch { return { pass: false, reasons: ['qc_response_unparseable'] }; }
}
