// G0 / C4 — isolation against alternative memory formats and engine identifiers, and advisory availability. The REAL handlers of this branch and of origin/main
// run against ONE fake world (no network, nothing written). SYNTHETIC data.
// node tests/g0safety/test_g0_variants.mjs
import * as G from '../../lib/generationInputs.mjs';
import { world, resetWorld, loadPair, makeCall, cleanup, reporter, mkRes, signCeo } from './world.mjs';
import { cronSignature } from '../../lib/cronAuth.mjs';
const { check, done } = reporter();

/* ── lib: engine identifiers ── */
for (const e of ['srv_farsi', 'srv_english', 'SRV Farsi', 'SRV English', 'SRV-FARSI', 'srv farsi', ' srv_farsi ', 'SRV_ENGLISH', 'Srv Studio', 'srv_studio', 'Silk Road Voices', 'silk-road-voices'])
  check(`engine ${JSON.stringify(e)} is governed`, G.isGovernedEngine(e));
for (const e of ['nextwave', 'NextWave', 'NextWave Systems', 'ai_studio', 'smm', 'srv', 'farsi', '', undefined, null, 5, ['srv_farsi']])
  check(`engine ${JSON.stringify(e)} is NOT governed (other businesses untouched)`, !G.isGovernedEngine(e));

/* ── lib: entry spellings and shapes ── */
const LEARN = [
  { type: 'winning_pattern', value: 'a' }, { type: 'Winning-Pattern', value: 'a' }, { type: 'winningPattern', value: 'a' }, { type: 'WINNERS', value: 'a' }, { source: 'winning_pattern', title: 'a' }, { source: ' Winning Pattern ' },
  { type: 'optimization_directive', value: 'a' }, { type: 'optimizationDirective', value: 'a' }, { type: 'tuning-directive' }, { source: 'p_c_directive' }, { source: 'p_c' },
  { type: 'active_rule' }, { type: 'activeRule' }, { type: 'Active Rule' }, { source: 'p_i' }, { type: 'optimization_rule' }, { kind: 'active_rule' }, { entryType: 'channelStrategy' }, { memory_type: 'active_rule' },
  { type: 'channel_strategy' }, { source: 'channel_strategy' }, { source: 'p_s' }, { type: 'strategy' },
  { ruleType: 'topic_weight', ruleData: { mood: 'x' } }, { rule_type: 'hook_pattern_weight', rule_data: {} }, { ruleId: 5 },                                  // no label at all
  { status: 'reduce', statusReason: 'old', cadencePerWeek: 1.5 }, { modeWeights: {}, promoted: [] }, { cadence_per_week: 3 },                                    // strategy shape
  { action: 'INCREASE', detail: 'push romantic', priority: 'high' }, { action: 'continue', value: 'keep', priority: 'medium' },                                   // directive shape
  { title: 'x', retention: 9999, views: 3 }, { retention_pct: 250, views: 5 },                                                                                    // winner shape
];
for (const e of LEARN) check(`learning entry ${JSON.stringify(e).slice(0, 70)} is removed`, G.stripLearningInputs([e], 'srv_farsi').length === 0);
const KEEP = [
  { type: 'title', value: 'Rules of Love' }, { type: 'concept', value: 'a strategy for winning back someone' }, { type: 'hook', value: 'Winning pattern of the heart' }, { type: 'mood', value: 'romantic' },
  { title: 'T', mood: 'm', vocal: 'v', topic: 't', category: 'Strategy', categoryName: 'Rules', angle: 'a', concept: 'c', hook: 'h', script: 's', generatedAt: 1, source: 'local_package' },
  { title: 'P', concept: '(published on YouTube)', hook: 'first line', topic: '(published)', angle: '(published)', script: '', generatedAt: 2, source: 'youtube_published' },
  { title: 'Z', source: 'z2' }, { type: 'title', value: 'Strategy' }, 'plain string entry', 42, null,
];
{ const out = G.stripLearningInputs(KEEP, 'SRV English'); check('every anti-repetition entry shape is KEPT (including words like "Rules"/"Strategy"/"Winning pattern" inside titles and categories)', out.length === KEEP.length, `${out.length}/${KEEP.length}`); }
check('non-governed engines keep learning entries untouched (same array)', G.stripLearningInputs(LEARN, 'NextWave') === LEARN);

/* ── real handlers ── */
try {
  const ops = await loadPair('ops.js'); const gen = await loadPair('generate.js');
  const seeded = () => { let x = 777; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; };
  const run = async (mod, args) => { Math.random = seeded(); resetWorld(); const res = await makeCall(mod)(args); return { json: JSON.stringify(world.anthropic), code: res.code, n: world.anthropic.length }; };
  const ANTI = [{ type: 'title', value: 'Quiet Window Light' }, { type: 'concept', value: 'waiting at a station' }, { type: 'hook', value: 'You left the porch light on' }, { type: 'mood', value: 'romantic' }];
  const VARIANT = [{ type: 'Winning-Pattern', value: 'SENTINEL-A', retention: 9999, views: 3 }, { type: 'optimizationDirective', value: 'SENTINEL-B', action: 'INCREASE', priority: 'high' }, { type: 'activeRule', ruleType: 'topic_weight', ruleData: { mood: 'SENTINEL-C' } },
    { source: 'P_S', status: 'reduce', statusReason: 'SENTINEL-D', cadencePerWeek: 1.5 }, { ruleType: 'hook_pattern_weight', ruleData: { pattern: 'SENTINEL-E' } }, { action: 'INCREASE', detail: 'SENTINEL-F', priority: 'high' }];
  const CANON = [{ type: 'winning_pattern', value: 'SENTINEL-A', retention: 9999, views: 3 }, { type: 'optimization_directive', value: 'SENTINEL-B', action: 'INCREASE', priority: 'high' }, { type: 'active_rule', ruleType: 'topic_weight', ruleData: { mood: 'SENTINEL-C', weight: 2, instruction: 'SENTINEL-C2' } },
    { type: 'channel_strategy', status: 'reduce', statusReason: 'SENTINEL-D', modeWeights: {}, promoted: [], reduced: [], cadencePerWeek: 1.5 }];
  const a = (engineId, mem, extra = {}) => ({ action: 'generate_package', ceo: true, ceoHeader: true, body: { engineId, mode: 'Female Voice — Romantic', contentFormat: 'short', ...extra, existingMemory: mem } });
  /* alternative ENGINE identifiers reach the generators' generic fallback prompt on main; the branch removes learning entries there too */
  for (const eid of ['SRV Farsi', 'SRV English', 'srv-farsi', 'SRV_ENGLISH', 'Srv Farsi']) {
    const bl = await run(ops.base, a(eid, [...ANTI, ...CANON])), ba = await run(ops.base, a(eid, ANTI)), cl = await run(ops.cur, a(eid, [...ANTI, ...CANON])), cv = await run(ops.cur, a(eid, [...ANTI, ...VARIANT]));
    check(`ops engineId ${JSON.stringify(eid)} (generic fallback prompt): main renders the learning sentinels`, bl.n >= 1 && /SENTINEL/.test(bl.json) && bl.json !== ba.json, `calls ${bl.n}`);
    check(`ops engineId ${JSON.stringify(eid)}: branch(anti + learning) == main(anti only), no sentinel`, cl.json === ba.json && !/SENTINEL/.test(cl.json));
    check(`ops engineId ${JSON.stringify(eid)}: branch with alternative memory SPELLINGS/SHAPES == main(anti only), no sentinel`, cv.json === ba.json && !/SENTINEL/.test(cv.json));
  }
  /* alternative MEMORY formats on the canonical ids */
  for (const [eid, extra] of [['srv_farsi', {}], ['srv_english', {}], ['srv_english', { srvStudioV2: true }]]) {
    const ba = await run(ops.base, a(eid, ANTI, extra)), cv = await run(ops.cur, a(eid, [...ANTI, ...VARIANT], extra));
    check(`ops ${eid}${extra.srvStudioV2 ? '/V2' : ''}: alternative memory spellings/shapes == main(anti only), no sentinel`, cv.json === ba.json && !/SENTINEL/.test(cv.json));
  }
  /* Task path: variants in recentPackages; unknown engine spellings are refused before any model call */
  const g = async (mod, body) => { Math.random = seeded(); resetWorld(); const res = mkRes(); await mod.default({ method: 'POST', headers: { 'x-mmm-ceo-session': signCeo() }, body }, res); return { json: JSON.stringify(world.anthropic), code: res.code, n: world.anthropic.length }; };
  const PK = [{ title: 'Quiet Window Light', mood: 'm', vocal: 'v', concept: 'c', hook: 'h', source: 'local_package', generatedAt: 1 }];
  const PV = [{ title: 'SENTINEL-W', retention: 9999, views: 3, source: 'Winning_Pattern' }, { type: 'activeRule', ruleType: 'x', ruleData: { mood: 'SENTINEL-R' } }, { action: 'INCREASE', detail: 'SENTINEL-D', priority: 'high' }, { statusReason: 'SENTINEL-S', cadencePerWeek: 1 }, { source: 'p_c_directive', detail: 'SENTINEL-P' }];
  for (const [engine, extra] of [['SRV Farsi', {}], ['SRV English', { srvStudioV2: true }], ['SRV English', {}]]) {
    const body = (r) => ({ engine, mood: 'Love', platform: 'YouTube', contentType: 'Short', contentFormat: 'short', taskName: 'T', recentPackages: r, ...extra });
    const ba = await g(gen.base, body(PK)), cv = await g(gen.cur, body([...PK, ...PV]));
    check(`generate ${engine}${extra.srvStudioV2 ? '/V2' : ''}: alternative recentPackages spellings/shapes == main(anti only), no sentinel`, cv.json === ba.json && !/SENTINEL/.test(cv.json) && ba.n >= 1);
  }
  { const r = await g(gen.cur, { engine: 'srv farsi', mood: 'Love', contentFormat: 'short', recentPackages: [...PK, ...PV] }); check('generate: a non-canonical engine spelling is refused (400) and makes NO model call', r.code === 400 && r.n === 0); }
  /* NextWave unchanged */
  { const b = await run(ops.base, a('nextwave', [...ANTI, ...CANON])), c = await run(ops.cur, a('nextwave', [...ANTI, ...CANON])); check('ops nextwave: byte-identical to main with learning entries present', b.json === c.json && b.n >= 1); }

  /* ── advisory availability: recommendations are still produced and visible; they just do not reach generation ── */
  { const call = async (mod, action, extra = {}) => { resetWorld(); const res = await makeCall(mod)({ action, method: extra.method || 'GET', ceo: true, ceoHeader: true, body: extra.body || {} }); return { code: res.code, body: JSON.stringify(res.body).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>') }; };   // generation timestamps differ by milliseconds between any two calls
    for (const action of ['decision_engine', 'growth_report']) { const b = await call(ops.base, action, action === 'growth_report' ? { method: 'POST' } : {}), c = await call(ops.cur, action, action === 'growth_report' ? { method: 'POST' } : {});
      check(`${action}: response identical to main (status ${c.code})`, b.code === c.code && b.body === c.body); }
    { resetWorld(); world.rules = [{ id: 1, engine: 'SRV Farsi', rule_type: 'topic_weight', rule_data: {}, active: true, expires_at: null }]; const b = await makeCall(ops.base)({ action: 'optimization_state', method: 'GET' }), c = await makeCall(ops.cur)({ action: 'optimization_state', method: 'GET' });
      const strip = (o) => ({ ...o, activeRules: (o.activeRules || []).map(({ expired, ...r }) => r) }); check('optimization_state: identical to main apart from the added "expired" flag (recommendations/state stay visible)', JSON.stringify(strip(b.body)) === JSON.stringify(strip(c.body)) && c.body.activeRules[0].expired === false); }
    { resetWorld(); world.settings.forEach((s) => { s.auto_apply = false; }); world.decision = { ok: true, perChannel: [{ engine: 'SRV Farsi', recommendations: [{ action: 'INCREASE', priority: 'high', detail: 'Top retainers use "alpha" pattern.' }] }] };
      await makeCall(ops.cur)({ action: 'analytics_auto_run', method: 'GET', headers: { 'x-mmm-cron': cronSignature('analytics_auto_run', 'svc-test') } }); const r = await makeCall(ops.cur)({ action: 'optimization_state', method: 'GET' });
      check('a new recommendation is stored (queued inactive) and the audit log shows it — advisory output still produced', world.rules.length === 1 && world.rules[0].active === false && world.audit.some((x) => x.action === 'rule_queued') && r.code === 200); }
  }
} finally { cleanup(); }
process.exit(done() ? 1 : 0);
