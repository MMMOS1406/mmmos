// Evaluation harness for the general-language Storyboard Brain.
//
//   node test_nextwave_v2_storyboard_semantic_eval.mjs --set dev|final [--live] [--dump DIR] [--render]
//
// * Ground truth (acceptable roles, independent recomputations) lives in
//   nextwave_v2_storyboard_eval/{dev_set,final_holdout}.mjs and is NEVER sent
//   to the model — the proposer only sees the script and its extracted,
//   marked quantities.
// * Model calls are recorded/replayed (recordings/<set>.json). With --live and
//   ANTHROPIC_API_KEY in the environment, unseen prompts call the model and
//   are recorded; without --live, only replay runs (offline, $0, deterministic).
// * The FINAL set is refused if its SHA-256 no longer matches freeze.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deps as baseDeps, SCRIPTS as PROOF_SCRIPTS } from './test_nextwave_v2_storyboard_brain.mjs';
import { nextwaveV2BuildStoryboardSemantic } from './lib/nextwaveV2SemanticStoryboard.mjs';
import { makeLiveCaller, makeRecordingCaller, MODEL_ID } from './lib/nextwaveV2SemanticProposer.mjs';
import { DEV, DEV2, DEV3, DEV4 } from './nextwave_v2_storyboard_eval/dev_set.mjs';

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : null; };
const setName = argVal('--set') || 'dev';
const live = args.includes('--live');
const dumpDir = argVal('--dump');
const doRender = args.includes('--render');
const dir = new URL('./nextwave_v2_storyboard_eval/', import.meta.url).pathname;

let cases;
if (setName === 'final') {
  const freeze = JSON.parse(readFileSync(dir + 'freeze.json', 'utf8'));
  const actual = createHash('sha256').update(readFileSync(dir + 'final_holdout.mjs')).digest('hex');
  if (actual !== freeze.sha256) { console.error(`REFUSING TO RUN: final_holdout.mjs hash ${actual} != frozen ${freeze.sha256}. The final set is no longer untouched.`); process.exit(2); }
  console.log(`final hold-out hash verified against freeze.json (${actual.slice(0, 12)}…, frozen ${freeze.frozen_at})`);
  cases = (await import('./nextwave_v2_storyboard_eval/final_holdout.mjs')).FINAL;
} else if (setName === 'fresh') {
  const freeze = JSON.parse(readFileSync(dir + 'freeze_fresh.json', 'utf8'));
  const actual = createHash('sha256').update(readFileSync(dir + freeze.file)).digest('hex');
  if (actual !== freeze.sha256) { console.error(`REFUSING TO RUN: ${freeze.file} hash ${actual} != frozen ${freeze.sha256}. The fresh set is no longer untouched.`); process.exit(2); }
  console.log(`fresh hold-out hash verified against freeze_fresh.json (${actual.slice(0, 12)}…, frozen ${freeze.frozen_at})`);
  cases = (await import('./nextwave_v2_storyboard_eval/' + freeze.file)).FRESH;
} else if (setName === 'third') {
  const freeze = JSON.parse(readFileSync(dir + 'freeze_third.json', 'utf8'));
  const actual = createHash('sha256').update(readFileSync(dir + freeze.file)).digest('hex');
  if (actual !== freeze.sha256) { console.error(`REFUSING TO RUN: ${freeze.file} hash ${actual} != frozen ${freeze.sha256}. The third set is no longer untouched.`); process.exit(2); }
  console.log(`third hold-out hash verified against freeze_third.json (${actual.slice(0, 12)}…, frozen ${freeze.frozen_at})`);
  cases = (await import('./nextwave_v2_storyboard_eval/' + freeze.file)).THIRD;
} else if (setName === 'dev') {
  // the first final set was SPENT (seen and reported); it is now development data
  cases = [...DEV, ...DEV2, ...DEV3, ...DEV4, ...(await import('./nextwave_v2_storyboard_eval/final_holdout.mjs')).FINAL, ...(await import('./nextwave_v2_storyboard_eval/fresh_holdout.mjs')).FRESH];
} else if (setName === 'proofs') {
  // Proof A / Proof B / synthetic C scripts through the SEMANTIC Brain (no ground truth
  // here: status, scenes, derived values and renderer parameters are inspected directly)
  cases = Object.entries(PROOF_SCRIPTS).map(([k, script]) => ({ id: 'P' + k + '_proof_script', script, mentions: [], calcs: [], together: [], status: 'PASS' }));
} else { console.error('unknown --set ' + setName); process.exit(2); }

// recording store
const recPath = dir + `recordings/${setName === 'final' ? 'final' : setName}.json`;
mkdirSync(dir + 'recordings', { recursive: true });
const store = new Map(existsSync(recPath) ? Object.entries(JSON.parse(readFileSync(recPath, 'utf8'))) : []);
// spent hold-out sets are development data: their recorded model responses are reusable for replay
if (setName === 'dev') for (const f of ['fresh', 'final', 'proofs', 'third_spent']) { const fp = dir + `recordings/${f}.json`; if (existsSync(fp)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(fp, 'utf8')))) if (!store.has(k)) store.set(k, v); }
const tally = { live_calls: 0, replayed: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
let liveCaller = null;
if (live) {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('--live requires ANTHROPIC_API_KEY in the environment'); process.exit(2); }
  liveCaller = makeLiveCaller(process.env.ANTHROPIC_API_KEY);
}
const callModel = makeRecordingCaller({ live: liveCaller, store, tally });
const deps = { ...baseDeps, callModel };

const norm = (s) => String(s).replace(/\s+/g, ' ').toLowerCase();
const tolFor = (kind) => (kind === 'money' ? (v) => Math.max(1, 0.0005 * Math.abs(v)) : (v) => 0.6);

const rows = [];
let sums = { cases: 0, full: 0, needs_review: 0, misbindings: 0, silent_drops: 0, gt_mentions: 0, bound_ok: 0, unbound_reported: 0, calcs_gt: 0, calcs_verified: 0, calcs_agree: 0, provenance_bad: 0, blocked: 0 };

for (const c of cases) {
  let out;
  try { out = await nextwaveV2BuildStoryboardSemantic(c.script, deps); } catch (e) { out = { ok: false, error: e.message }; }
  const row = { id: c.id, status_expected: c.status, ok: out.ok, notes: [] };
  if (!out.ok) { row.notes.push('Brain error: ' + out.error); rows.push(row); sums.cases++; continue; }
  if (live && tally.live_calls) writeFileSync(recPath, JSON.stringify(Object.fromEntries(store), null, 1)); // persist per case so a scorer crash cannot lose paid responses
  if (dumpDir) { mkdirSync(dumpDir, { recursive: true }); writeFileSync(`${dumpDir}/${c.id}.json`, JSON.stringify(out, null, 2)); }

  const quantities = out.quantities || [];
  const entityByMention = new Map((out.values || []).filter((e) => e.provenance && e.provenance.mention_id).map((e) => [e.provenance.mention_id, e]));
  const unboundIds = new Set((out.unbound_mentions || []).map((u) => u.mention));
  const uncoveredTokens = (out.uncovered_numeric_tokens || []).map((t) => t.token);
  const sceneOfEntity = (id) => (out.scenes || []).find((s) => s.entity_ids.includes(id));

  let misb = 0, drops = 0, ok = 0, unb = 0; const mentionRows = [];
  for (const gt of c.mentions.filter(Boolean)) { // frozen F5 has a sparse-array hole from a stray comment; skip it
    const matches = quantities.filter((q) => norm(q.raw).includes(norm(gt.raw)) || norm(gt.raw).includes(norm(q.raw)) && q.raw.length > 2 && norm(q.raw) === norm(gt.raw));
    const exact = quantities.filter((q) => norm(q.raw) === norm(gt.raw));
    const use = exact.length ? exact : matches;
    if (!use.length) {
      const digits = gt.raw.replace(/[^\d.]/g, '');
      const reported = digits && uncoveredTokens.some((t) => t.replace(/[^\d.]/g, '') && digits.includes(t.replace(/[^\d.,]/g, '').replace(/,/g, '')));
      mentionRows.push({ raw: gt.raw, expected: gt.roles, result: reported ? 'reported_uncovered' : 'SILENT_DROP' });
      if (!reported) drops++; else unb++;
      continue;
    }
    for (const q of use) {
      const e = entityByMention.get(q.id);
      if (e) {
        const accepted = gt.roles.includes(e.role);
        mentionRows.push({ raw: q.raw, expected: gt.roles, bound: e.role, confidence: e.confidence && e.confidence.level, result: accepted ? 'OK' : 'MISBOUND' });
        if (accepted) ok++; else misb++;
      } else if (unboundIds.has(q.id)) { mentionRows.push({ raw: q.raw, expected: gt.roles, result: 'unbound_reported' }); unb++; }
      else {
        // labelled incidental (role none): not bound, not listed as unbound -> only ok if GT also allows nothing meaningful
        mentionRows.push({ raw: q.raw, expected: gt.roles, result: 'labelled_incidental' }); unb++;
      }
    }
  }
  row.mentionRows = mentionRows;

  // grouping
  const togetherFail = [];
  for (const [ra, rb] of c.together) {
    const ea = quantities.find((q) => norm(q.raw) === norm(ra)) , eb = quantities.find((q) => norm(q.raw) === norm(rb));
    const va = ea && entityByMention.get(ea.id), vb = eb && entityByMention.get(eb.id);
    const sa = va && sceneOfEntity(va.id), sb = vb && sceneOfEntity(vb.id);
    if (!(sa && sb && sa.scene_id === sb.scene_id)) togetherFail.push([ra, rb]);
  }

  // independent recomputation vs script's stated value vs Brain-verified calculation
  const calcRows = [];
  for (const cc of c.calcs) {
    sums.calcs_gt++;
    const q = quantities.find((qq) => norm(qq.raw).includes(norm(cc.target)));
    const stated = q ? (Array.isArray(q.value) ? q.value[1] : q.value) : null;
    const expected = cc.expected();
    const tol = cc.tol != null ? cc.tol : tolFor(q && q.kind)(expected);
    const statedOk = stated != null && Math.abs(stated - expected) <= tol;
    const det = (out.calculations || []).find((d) => d.target === (q && q.id) && d.verified);
    const brainExp = cc.brainExpected ? cc.brainExpected() : expected; // e.g. periods in the calculation's own cadence when the script states years
    const brainAgree = det ? Math.abs(det.computed - brainExp) <= Math.max(cc.brainExpected ? 0.01 * Math.abs(brainExp) : tol, 1e-6 * Math.abs(brainExp)) : null;
    if (det) sums.calcs_verified++;
    if (brainAgree) sums.calcs_agree++;
    calcRows.push({ target: cc.target, stated, independent_expected: +expected.toFixed(2), gt_consistent: statedOk, brain_verified: !!det, brain_computed: det ? det.computed : null, convention: det ? det.convention : null, brain_agrees_with_independent: brainAgree });
  }
  row.calcRows = calcRows;

  // independent VISUAL-SEMANTIC check on the final renderer parameters, using
  // the GT metric/time-basis tags (not the Brain's own identity logic)
  const gtOf = (span) => c.mentions.filter(Boolean).find((g) => norm(g.raw) === norm(span));
  const visualIssues = [];
  for (const sc of (out.scenes || [])) {
    const cmp = sc.comparison, rp = sc.renderer_params;
    if (!cmp) continue;
    const ents = cmp.values.map((v) => (out.values || []).find((e) => e.id === v.entity_id));
    const gts = ents.map((e) => e && e.provenance && e.provenance.span_text ? gtOf(e.provenance.span_text) : null);
    const bs = gts.map((g) => g && g.basis).filter(Boolean);
    if (new Set(bs).size > 1) visualIssues.push(`${sc.scene_id}: compared values have different GT time bases (${bs.join(' vs ')})`);
    if (cmp.form === 'bars') {
      const [b, a] = [rp.beforeCount, rp.afterCount];
      if (cmp.delta) {
        const num = Number(String(rp.deltaTextOverride || '').replace(/\([^)]*\)/g, '').replace(/[^0-9.]/g, '').replace(/(\d)\.$/, '$1').match(/[\d.]+/)?.[0]);
        // duration deltas print "N MONTHS": digits only
        if (Number.isFinite(num) && Math.abs(num - Math.abs(a - b)) > Math.max(1, 0.001 * Math.abs(a - b))) visualIssues.push(`${sc.scene_id}: delta ${rp.deltaTextOverride} != |${b}-${a}|`);
        const sign = a < b ? '-' : '+'; if (!String(rp.deltaTextOverride).startsWith(sign)) visualIssues.push(`${sc.scene_id}: delta sign`);
        if (cmp.delta.source === 'stated_gap') {
          const gapEnt = (out.values || []).find((e) => e.id === cmp.delta.entity_id); const gg = gapEnt && gtOf(gapEnt.provenance.span_text);
          if (gg && gg.basis && bs.length && gg.basis !== bs[0]) visualIssues.push(`${sc.scene_id}: stated gap basis ${gg.basis} != bars basis ${bs[0]}`);
        }
      }
    }
  }
  row.visualIssues = visualIssues; sums.visual_mismatch = (sums.visual_mismatch || 0) + (out.integrity.status === 'blocked' ? 0 : visualIssues.length);

  const iss = out.integrity.issues || [];
  const blockers = iss.filter((i) => i.severity === 'blocking');
  const status = out.integrity.status;
  row.status = status; row.reasons = iss.map((i) => `${i.severity}:${i.kind}${i.raw ? ' ' + i.raw : ''}${i.reason ? ' (' + i.reason + ')' : ''}${i.token ? ' ' + i.token : ''}`);
  row.misbound = misb; row.silent_drops = drops; row.together_fail = togetherFail;
  row.scenes = (out.scenes || []).map((s) => `${s.unit_ids.join('+')}:${s.treatment}(${s.intent})`);

  const expectPass = c.status === 'PASS';
  const expectSafeStop = c.status === 'needs_review', expectSafeAny = c.status === 'SAFE';
  const allBound = ok === c.mentions.filter(Boolean).length || (mentionRows.length && mentionRows.every((m) => m.result === 'OK'));
  const calcsOk = calcRows.every((r) => r.gt_consistent && r.brain_verified && r.brain_agrees_with_independent !== false);
  row.full = expectPass ? (status === 'clean' && allBound && togetherFail.length === 0 && misb === 0 && drops === 0)
    : expectSafeAny ? ((status !== 'clean' || (misb === 0 && drops === 0)) && visualIssues.length === 0)
    : ((status === 'needs_review' || status === 'blocked') && misb === 0 && drops === 0);
  row.kind = expectPass ? 'normal' : 'safety';
  row.calcs_all_verified = calcsOk;

  sums.normal = (sums.normal || 0) + (expectPass ? 1 : 0); sums.normal_full = (sums.normal_full || 0) + (expectPass && row.full ? 1 : 0); sums.normal_review = (sums.normal_review || 0) + (expectPass && status === 'needs_review' ? 1 : 0); sums.normal_blocked = (sums.normal_blocked || 0) + (expectPass && status === 'blocked' ? 1 : 0);
  sums.safety = (sums.safety || 0) + (expectPass ? 0 : 1); sums.safety_safe = (sums.safety_safe || 0) + (!expectPass && row.full ? 1 : 0);
  sums.cases++; sums.misbindings += misb; sums.silent_drops += drops; sums.gt_mentions += mentionRows.length; sums.bound_ok += ok; sums.unbound_reported += unb;
  if (row.full) sums.full++; if (status === 'needs_review') sums.needs_review++; if (status === 'blocked') sums.blocked++;
  sums.provenance_bad += blockers.filter((b) => b.kind === 'unprovenanced_rendered_number').length;

  // optional: renderer acceptance (real renderer functions, local ffmpeg, no vendors)
  if (doRender) row.render = await renderScenes(c.id, out);
  rows.push(row);
}

async function renderScenes(id, out) {
  const ff = process.env.FFMPEG_PATH || '/tmp/ffmpeg-darwin-test/node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg';
  const avatar = '/tmp/nwv2-v6-test/dummy_avatar.mp4', audio = '/tmp/nwv2-v6-test/dummy_audio.mp3';
  if (!existsSync(ff) || !existsSync(avatar)) return { skipped: 'ffmpeg/dummy media not found' };
  const src = readFileSync(new URL('./api/ops.js', import.meta.url), 'utf8');
  const extractFn = (name) => { const st = src.indexOf('function ' + name + '('); let f = st; const b = src.slice(Math.max(0, st - 10), st); if (b.trimEnd().endsWith('async')) f = st - (b.length - b.lastIndexOf('async')); const ps = src.indexOf('(', st); let pd = 1, k = ps + 1; while (pd > 0) { if (src[k] === '(') pd++; else if (src[k] === ')') pd--; k++; } const i = src.indexOf('{', k); let d = 1, j = i + 1; while (d > 0) { if (src[j] === '{') d++; else if (src[j] === '}') d--; j++; } return src.slice(f, j); };
  const extractConst = (n) => { const i = src.indexOf('const ' + n + ' ='); return src.slice(i, src.indexOf(';\n', i) + 1); };
  const code = ['NWV2_WHITE_BG', 'NWV2_WHITE_CARD', 'NWV2_NAVY', 'NWV2_GOLD', 'NWV2_GOLD_DARK', 'NWV2_SHADOW', 'NWV2L_W', 'NWV2L_H', 'SMM_FONT_PATH'].map(extractConst).join('\n') + '\n' + ['nwv2WhiteSanitize', 'nwv2LongCameraPushFilter', 'nwv2LongLogoFilter', 'nwv2LongMoneyFlowSegment', 'nwv2LongStockChartSegment', 'nwv2LongDayCardsSegment', 'nwv2LongShareCompareSegment', 'nwv2LongAvatarPanelSegment', 'nwv2LongCalcCardSegment', 'smAssertValidMediaFile', 'nwv2ProofWrapText'].map(extractFn).join('\n') + '\nreturn { nwv2LongMoneyFlowSegment, nwv2LongStockChartSegment, nwv2LongDayCardsSegment, nwv2LongShareCompareSegment, nwv2LongAvatarPanelSegment, nwv2LongCalcCardSegment };';
  const { stat } = await import('node:fs/promises'); const { join } = await import('node:path'); const ex = promisify(execFile);
  const R = new Function('execFileAsync', 'ffmpegInstaller', 'join', 'process', 'fsStat', code)(ex, { path: ff }, join, process, stat);
  mkdirSync('/tmp/nwv2-v6-test/sem_render', { recursive: true });
  const res = [];
  for (const s of out.scenes) {
    const p = s.renderer_params, o = `/tmp/nwv2-v6-test/sem_render/${id}_${s.scene_id}_${s.treatment}.mp4`;
    try {
      if (s.treatment === 'avatar_panel') await R.nwv2LongAvatarPanelSegment({ heygenLocalPath: avatar, audioLocalPath: audio, dur: 5, text: p.text, isCta: !!p.isCta, fadeEdge: null, contextCaption: p.contextCaption, outPath: o });
      else if (s.treatment === 'money_flow') await R.nwv2LongMoneyFlowSegment({ heygenLocalPath: avatar, seekSec: 0, fromLabel: p.fromLabel, toLabel: p.toLabel, amountText: p.amountText, dur: 7, outPath: o });
      else if (s.treatment === 'day_cards') await R.nwv2LongDayCardsSegment({ heygenLocalPath: avatar, seekSec: 0, heroText: p.heroText, heroSub: p.heroSub, days: p.days, dur: 7, outPath: o });
      else if (s.treatment === 'stock_chart') await R.nwv2LongStockChartSegment({ heygenLocalPath: avatar, seekSec: 0, label: p.label, subLabel: p.subLabel, yTicks: p.yTicks, yMax: p.yMax, milestones: p.milestones, changeText: p.changeText, direction: p.direction, series: p.series, axisStartLabel: p.axisStartLabel, axisEndLabel: p.axisEndLabel, markerIndex: p.markerIndex, markerLabel: p.markerLabel, dur: 9, outPath: o });
      else if (s.treatment === 'share_compare') await R.nwv2LongShareCompareSegment({ heygenLocalPath: avatar, seekSec: 0, beforeLabel: p.beforeLabel, beforeCount: p.beforeCount, beforeValue: p.beforeValue, afterLabel: p.afterLabel, afterCount: p.afterCount, afterValue: p.afterValue, displayMode: p.displayMode, anchorText: p.anchorText, deltaSuffix: p.deltaSuffix, deltaTextOverride: p.deltaTextOverride, deltaNote: p.deltaNote, headerLabel: p.headerLabel, deltaTone: p.deltaTone, dur: 9, outPath: o });
      else await R.nwv2LongCalcCardSegment({ heygenLocalPath: avatar, seekSec: 0, title: p.title, values: p.values, dur: 7, outPath: o });
      res.push({ scene: s.scene_id, treatment: s.treatment, ok: true, file: o });
    } catch (e) { res.push({ scene: s.scene_id, treatment: s.treatment, ok: false, error: e.message.split('\n')[0].slice(0, 140) }); }
  }
  return res;
}

// ── report ───────────────────────────────────────────────────────────────────
for (const r of rows) {
  console.log(`\n=== ${r.id}  [expected ${r.status_expected}]  -> ${r.status || 'ERROR'}${r.full ? '  FULL' : ''} ===`);
  if (r.notes.length) console.log(r.notes.join('\n'));
  if (!r.mentionRows) continue;
  console.log('scenes: ' + r.scenes.join('  '));
  r.mentionRows.forEach((m) => console.log(`  ${m.result.padEnd(18)} ${String(m.raw).padEnd(14)} ${m.bound ? 'bound=' + m.bound + ' (' + m.confidence + ')' : ''}  expected ${m.expected.join('|')}`));
  r.calcRows.forEach((c) => console.log(`  calc ${String(c.target).padEnd(12)} stated=${c.stated} independent=${c.independent_expected} gtOK=${c.gt_consistent} brainVerified=${c.brain_verified}${c.brain_verified ? ` computed=${c.brain_computed} (${c.convention}) agrees=${c.brain_agrees_with_independent}` : ''}`));
  if (r.together_fail.length) console.log('  SCENE-GROUPING FAIL: ' + JSON.stringify(r.together_fail));
  if (r.reasons.length) console.log('  issues: ' + r.reasons.slice(0, 8).join(' | '));
  if (r.visualIssues && r.visualIssues.length) console.log('  VISUAL-SEMANTIC ISSUES: ' + r.visualIssues.join(' | '));
  if (r.render) console.log('  render: ' + (r.render.skipped ? r.render.skipped : r.render.map((x) => `${x.scene}:${x.treatment}:${x.ok ? 'OK' : 'FAIL ' + x.error}`).join('  ')));
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : 'n/a');
console.log(`\n================ SUMMARY (${setName} set, ${sums.cases} scripts) ================`);
console.log(`FULL understanding: ${sums.full}/${sums.cases} (${pct(sums.full, sums.cases)})   needs_review: ${sums.needs_review}/${sums.cases}   blocked: ${sums.blocked}`);
console.log(`NORMAL scripts: FULL ${sums.normal_full || 0}/${sums.normal || 0}   needs_review ${sums.normal_review || 0}   blocked ${sums.normal_blocked || 0}   |   SAFETY scripts stopped/handled safely: ${sums.safety_safe || 0}/${sums.safety || 0}`);
console.log(`ground-truth quantities: ${sums.gt_mentions}   bound correctly: ${sums.bound_ok}   unbound/reported: ${sums.unbound_reported}   MISBINDINGS: ${sums.misbindings}   SILENT DROPS: ${sums.silent_drops}`);
console.log(`independent visual-semantic mismatches through rendering: ${sums.visual_mismatch || 0}`);
console.log(`calculations (independent recompute): ${sums.calcs_gt}   Brain-verified: ${sums.calcs_verified}   agree with independent: ${sums.calcs_agree}   unprovenanced rendered numbers: ${sums.provenance_bad}`);
console.log(`model: ${MODEL_ID}   live calls: ${tally.live_calls}  replayed: ${tally.replayed}  tokens in/out: ${tally.input_tokens}/${tally.output_tokens}  cost this run: $${tally.cost_usd.toFixed(4)}`);
if (live && tally.live_calls) writeFileSync(recPath, JSON.stringify(Object.fromEntries(store), null, 1));
writeFileSync(`/tmp/sem_eval_${setName}_summary.json`, JSON.stringify({ setName, sums, tally, model: MODEL_ID, rows: rows.map((r) => ({ id: r.id, status: r.status, full: r.full, misbound: r.misbound, silent_drops: r.silent_drops, together_fail: r.together_fail, scenes: r.scenes, reasons: r.reasons })) }, null, 1));
