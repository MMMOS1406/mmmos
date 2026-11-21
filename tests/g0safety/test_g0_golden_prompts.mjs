// G0 / C4 — before/after generation-input comparison. The REAL api/ops.js (generate_package) and api/generate.js of this branch and of origin/main
// build the model request against ONE fake world (no network; the model call is captured, never sent). SYNTHETIC memory.
//   A. main renders the legacy learning blocks into SRV prompts (the problem).   B. this branch does not.
//   C. this branch with learning entries present == main WITHOUT them (the only change is the removal).   D. with no learning entries the request is byte-identical to main (approved prompts unchanged).
//   E. unrelated businesses (NextWave) and the Farsi Creative V2 path are byte-identical to main even with learning entries present.
// node tests/g0safety/test_g0_golden_prompts.mjs
import { world, resetWorld, loadPair, makeCall, cleanup, reporter, mkRes } from './world.mjs';
import { createHash } from 'node:crypto';
const { check, done } = reporter(); const sha = (x) => createHash('sha256').update(x).digest('hex').slice(0, 12);
const MARKERS = ['WINNING PATTERNS', 'TUNING DIRECTIVES', 'CHANNEL STRATEGY', 'APPLIED OPTIMIZATION RULES'];
const hasAny = (s) => MARKERS.filter((m) => s.includes(m));
// ── fixtures ──
const ANTI = [{ type: 'title', value: 'Quiet Window Light' }, { type: 'title', value: 'Midnight Train Home' }, { type: 'concept', value: 'waiting at a station for someone who will not come' }, { type: 'concept', value: 'a letter never sent after the rain' }, { type: 'hook', value: 'You left the porch light on' }, { type: 'mood', value: 'melancholy' }, { type: 'mood', value: 'romantic' }];
const LEARN = [{ type: 'winning_pattern', value: 'SENTINEL-WINNER-TITLE', retention: 9999, views: 24, subsGained: 0, source: 'p_c' }, { type: 'optimization_directive', value: 'SENTINEL-DIRECTIVE push romantic', action: 'INCREASE', priority: 'high', source: 'p_c_directive' },
  { type: 'active_rule', ruleId: 1, ruleType: 'hook_pattern_weight', ruleData: { pattern: 'SENTINEL-PATTERN', weight: 2, instruction: 'EMULATE this hook structure' }, priority: 'high', sourceDetail: 's', source: 'p_i' },
  { type: 'channel_strategy', status: 'reduce', statusReason: 'SENTINEL-STRATEGY stale', modeWeights: {}, promoted: [], reduced: [], cadencePerWeek: 1.5, source: 'p_s' }];
const PKG = [{ title: 'Quiet Window Light', mood: 'melancholy', vocal: 'male', concept: 'waiting at a station for someone who will not come', hook: 'You left the porch light on', source: 'local_package', generatedAt: 1 }, { title: 'Midnight Train Home', mood: 'romantic', vocal: 'female', concept: 'a letter never sent after the rain', hook: 'The rain wrote it for me', source: 'local_package', generatedAt: 2 }, { title: 'Published One', concept: '(published on YouTube)', hook: 'first line', source: 'youtube_published', generatedAt: 3 }];
const PKG_LEARN = [{ title: 'SENTINEL-WINNER-TITLE', retention: 9999, views: 24, source: 'winning_pattern' }, { action: 'INCREASE', detail: 'SENTINEL-DIRECTIVE', priority: 'high', source: 'optimization_directive' }, { ruleId: 1, ruleType: 'topic_weight', ruleData: { mood: 'SENTINEL-MOOD', weight: 2 }, source: 'active_rule' }, { source: 'channel_strategy', status: 'reduce', statusReason: 'SENTINEL-STRATEGY' }];
try {
  const ops = await loadPair('ops.js'); const gen = await loadPair('generate.js');
  const seeded = () => { let x = 12345; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; };   // fact-packet selection uses Math.random: make every call reproducible
  const run = async (mod, args) => { Math.random = seeded(); resetWorld(); const res = await makeCall(mod)(args); return { json: JSON.stringify(world.anthropic), code: res.code, n: world.anthropic.length }; };
  const genCall = async (mod, body) => { Math.random = seeded(); resetWorld(); const res = mkRes(); await mod.default({ method: 'POST', headers: {}, body }, res); return { json: JSON.stringify(world.anthropic), code: res.code, n: world.anthropic.length }; };

  /* ───────── api/ops.js generate_package (Factory path) ───────── */
  const OPS_CASES = [['srv_farsi', 'Female Voice — Romantic', 'short', {}], ['srv_farsi', 'Female Voice — Romantic', 'long', {}], ['srv_english', 'Love', 'short', {}], ['srv_english', 'Love', 'long', {}], ['srv_english', 'Love', 'short', { srvStudioV2: true }], ['srv_english', 'Love', 'long', { srvStudioV2: true }]];
  for (const [engineId, mode, contentFormat, extra] of OPS_CASES) {
    const tag = `ops ${engineId}/${contentFormat}${extra.srvStudioV2 ? '/V2' : ''}`; const base = (m) => ({ action: 'generate_package', ceo: true, ceoHeader: true, body: { engineId, mode, contentFormat, ...extra, existingMemory: m } });
    const bBoth = await run(ops.base, base([...ANTI, ...LEARN])), bAnti = await run(ops.base, base(ANTI)), cBoth = await run(ops.cur, base([...ANTI, ...LEARN])), cAnti = await run(ops.cur, base(ANTI));
    check(`${tag}: model request captured (non-empty) on main and on the branch`, bBoth.n >= 1 && cBoth.n >= 1 && bBoth.json.length > 500, `${bBoth.n}/${cBoth.n} calls, status ${bBoth.code}/${cBoth.code}`);
    check(`A ${tag}: main renders learning blocks into the prompt (${hasAny(bBoth.json).join(', ') || 'none found'})`, hasAny(bBoth.json).length >= 3 || (extra.srvStudioV2 && hasAny(bBoth.json).length >= 1) || /SENTINEL/.test(bBoth.json));
    check(`B ${tag}: this branch renders NONE of the learning blocks and none of the sentinel strings`, hasAny(cBoth.json).length === 0 && !/SENTINEL|9999/.test(cBoth.json));
    check(`C ${tag}: branch(anti-repetition + learning) is byte-identical to main(anti-repetition only) — removal is the ONLY change`, cBoth.json === bAnti.json, sha(cBoth.json) + ' vs ' + sha(bAnti.json));
    check(`D ${tag}: with no learning entries the request is byte-identical to main (approved prompts, system text, parameters unchanged)`, cAnti.json === bAnti.json, sha(cAnti.json));
    const keep = ANTI.every((e) => e.type === 'mood' ? true : cBoth.json.includes(e.value));
    check(`D ${tag}: anti-repetition titles/concepts/hooks are all still present in the branch prompt`, keep);
  }
  /* unrelated business: generate_package for NextWave is untouched even with learning entries */
  for (const fmt of ['short', 'long']) { const a = (m) => ({ action: 'generate_package', ceo: true, ceoHeader: true, body: { engineId: 'nextwave', mode: 'Finance', contentFormat: fmt, existingMemory: m } });
    const b = await run(ops.base, a([...ANTI, ...LEARN])), c = await run(ops.cur, a([...ANTI, ...LEARN]));
    check(`E ops nextwave/${fmt}: byte-identical to main even with learning entries present (unrelated business unchanged)`, b.json === c.json && b.n >= 1, sha(b.json)); }
  /* string-form legacy memory (non-array) is untouched */
  { const a = { action: 'generate_package', ceo: true, ceoHeader: true, body: { engineId: 'srv_farsi', mode: 'Female Voice — Romantic', contentFormat: 'short', existingMemory: 'old string memory' } }; const b = await run(ops.base, a), c = await run(ops.cur, a);
    check('E ops non-array (legacy string) memory: byte-identical to main', b.json === c.json && b.n >= 1); }

  /* ───────── api/generate.js (Task path) ───────── */
  const GEN_CASES = [['SRV Farsi', 'Female Voice — Romantic', 'short', {}], ['SRV Farsi', 'Female Voice — Romantic', 'long', {}], ['SRV English', 'Love', 'short', { srvStudioV2: true }], ['SRV English', 'Love', 'long', { srvStudioV2: true }], ['SRV English', 'Love', 'short', {}]];
  for (const [engine, mood, contentFormat, extra] of GEN_CASES) {
    const tag = `generate ${engine}/${contentFormat}${extra.srvStudioV2 ? '/V2' : '/legacy'}`; const body = (r) => ({ engine, mood, platform: 'YouTube', contentType: contentFormat === 'long' ? 'Long' : 'Short', contentFormat, taskName: 'Test', recentPackages: r, ...extra });
    const bBoth = await genCall(gen.base, body([...PKG, ...PKG_LEARN])), bAnti = await genCall(gen.base, body(PKG)), cBoth = await genCall(gen.cur, body([...PKG, ...PKG_LEARN])), cAnti = await genCall(gen.cur, body(PKG));
    check(`${tag}: model request captured on main and on the branch`, bBoth.n >= 1 && cBoth.n >= 1 && bBoth.json.length > 500, `${bBoth.n}/${cBoth.n} calls, status ${bBoth.code}/${cBoth.code}`);
    check(`A ${tag}: main lets learning entries into the prompt (sentinel/winning text or junk avoid lines)`, /SENTINEL/.test(bBoth.json) || bBoth.json !== bAnti.json);
    check(`B ${tag}: this branch carries none of the sentinel strings and no WINNING PATTERNS block`, !/SENTINEL|9999|WINNING PATTERNS/.test(cBoth.json));
    check(`C ${tag}: branch(anti-repetition + learning) is byte-identical to main(anti-repetition only)`, cBoth.json === bAnti.json, sha(cBoth.json) + ' vs ' + sha(bAnti.json));
    check(`D ${tag}: with no learning entries the request is byte-identical to main`, cAnti.json === bAnti.json, sha(cAnti.json));
  }
  /* SRV Farsi Creative V2 (flag on): independent of recentPackages — identical to main, with or without learning entries */
  { const body = (r) => ({ engine: 'SRV Farsi', srvFarsiCreativeV2: true, artist: 'Female', mood: 'Romantic', format: 'Long', attempt: 1, feedback: [], taskName: 'T', recentPackages: r });
    const b1 = await genCall(gen.base, body([...PKG, ...PKG_LEARN])), c1 = await genCall(gen.cur, body([...PKG, ...PKG_LEARN])), c0 = await genCall(gen.cur, body([]));
    check('E Farsi Creative V2: the V2 handler really called the model (>=1 request) and the request is identical to main (with learning entries) and identical with none — V2 never consumes recentPackages', b1.n >= 1 && b1.json === c1.json && c1.json === c0.json, `calls ${b1.n}/${c1.n}/${c0.n}`);
    check('E Farsi Creative V2: no learning sentinel in the V2 request', !/SENTINEL|9999/.test(c1.json)); }
  /* unrelated business through the Task path */
  { const body = { engine: 'NextWave', mood: 'Finance', platform: 'YouTube', contentType: 'Short', contentFormat: 'short', taskName: 'T', recentPackages: [...PKG, ...PKG_LEARN] }; const b = await genCall(gen.base, body), c = await genCall(gen.cur, body);
    check('E generate NextWave: byte-identical to main even with learning entries present', b.json === c.json); }
  /* cross-business: SRV English prompt never carries SRV Farsi memory and vice versa (the request body only has its own memory by construction; assert the sentinel mood never crosses) */
  { const eng = await genCall(gen.cur, { engine: 'SRV English', mood: 'Love', platform: 'YouTube', contentType: 'Short', contentFormat: 'short', taskName: 'T', srvStudioV2: true, recentPackages: [{ title: 'ENGLISH-ONLY-TITLE', source: 'local_package', mood: 'x', concept: 'y', hook: 'z' }] });
    const far = await genCall(gen.cur, { engine: 'SRV Farsi', mood: 'Female Voice — Romantic', platform: 'YouTube', contentType: 'Short', contentFormat: 'short', taskName: 'T', recentPackages: [{ title: 'FARSI-ONLY-TITLE', source: 'local_package', mood: 'x', concept: 'y', hook: 'z' }] });
    check('isolation: each engine prompt contains only its own supplied memory', eng.json.includes('ENGLISH-ONLY-TITLE') && !eng.json.includes('FARSI-ONLY-TITLE') && far.json.includes('FARSI-ONLY-TITLE') && !far.json.includes('ENGLISH-ONLY-TITLE')); }
} finally { cleanup(); }
process.exit(done() ? 1 : 0);
