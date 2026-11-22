// G0 / C2, C4, C5 — client-side proof. The REAL functions of public/index.html are sliced out and executed with stubs (no browser, no network). SYNTHETIC data.
// node tests/g0safety/test_g0_client.mjs
import fs from 'node:fs'; import path from 'node:path';
import { reporter } from './world.mjs';
const { check, done } = reporter();
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); const html = fs.readFileSync(path.join(repo, 'public/index.html'), 'utf8');
const slice = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('marker missing: ' + a.slice(0, 40)); return html.slice(i, j); };

/* ── C4: getPackageMemory never fetches or emits learning inputs for the two music engines; other engines are unchanged ── */
{ const src = slice('// G0/C4 — legacy learning inputs (directives', '// Sprint Z.2 — concept-overlap dedup'); const calls = { top: 0, dir: 0, rules: 0, strat: 0 };
  const stubs = { D: { packages: [{ engine: 'SRV Farsi', title: 'Local Farsi', concept: 'c', hook: 'h', mood: 'm' }, { engine: 'SRV English', title: 'Local English', concept: 'c', hook: 'h', mood: 'm' }, { engine: 'NextWave', title: 'Local NW', concept: 'c', hook: 'h', mood: 'm' }] },
    _normPkgKey: (s) => String(s || '').trim().toLowerCase(), _z2FetchPublishedForEngine: async () => [], _z2MapYTEntry: (v) => v, _Z2_YTCACHE: {}, console: { log() {}, warn() {} },
    _pcFetchTopPerformersForEngine: async () => { calls.top++; return [{ title: 'W', retention_pct: 9999, views: 24 }]; }, _pcFetchOptimizationDirectives: async () => { calls.dir++; return [{ action: 'INCREASE', detail: 'd', priority: 'high', source: 'optimization_directive' }]; },
    _piFetchActiveRulesForEngine: async () => { calls.rules++; return [{ id: 1, rule_type: 'topic_weight', rule_data: {}, priority: 'high', source_detail: 's', expires_at: null }]; }, _psFetchChannelStrategy: async () => { calls.strat++; return { status: 'reduce', status_reason: 'x', mode_weights: {}, promoted_categories: [], reduced_categories: [], cadence_per_week: 1.5 }; } };
  const names = Object.keys(stubs); const fn = new Function(...names, src + '\nreturn { getPackageMemory, LEARNING_INPUTS_TO_GENERATION };')(...names.map((k) => stubs[k]));
  check('client constant LEARNING_INPUTS_TO_GENERATION is false', fn.LEARNING_INPUTS_TO_GENERATION === false);
  for (const eng of ['SRV Farsi', 'SRV English']) { calls.top = calls.dir = calls.rules = calls.strat = 0; const m = await fn.getPackageMemory(eng);
    check(`${eng}: no learning fetch is made (top performers, decision-engine directives, rules, strategy all 0 calls)`, calls.top + calls.dir + calls.rules + calls.strat === 0, JSON.stringify(calls));
    check(`${eng}: memory contains none of winning_pattern / optimization_directive / active_rule / channel_strategy`, !m.some((e) => ['winning_pattern', 'optimization_directive', 'active_rule', 'channel_strategy'].includes(e.source)));
    check(`${eng}: anti-repetition entries are still returned (own local package present)`, m.some((e) => e.source === 'local_package' && e.title === 'Local ' + eng.replace('SRV ', ''))); }
  { calls.top = calls.dir = calls.rules = calls.strat = 0; const m = await fn.getPackageMemory('NextWave');
    check('NextWave (unrelated, retired): behaviour unchanged — all four fetches still made and entries present', calls.top === 1 && calls.dir === 1 && calls.rules === 1 && calls.strat === 1 && m.some((e) => e.source === 'active_rule') && m.some((e) => e.source === 'channel_strategy')); }
  { const s = await fn.getPackageMemory('SRV Farsi'); check('SRV Farsi memory has no entry from another business', s.every((e) => !String(e.title || '').includes('English') && !String(e.title || '').includes('NW'))); }
}

/* ── C2: expired rules are not returned ── */
{ const src = slice('async function _piFetchActiveRulesForEngine(engine){', '// v13.62.9 PRIORITY C — fetch decision-engine directives'); let seenUrl = '';
  const past = new Date(Date.now() - 86400e3).toISOString(), future = new Date(Date.now() + 86400e3).toISOString();
  const stubs = { SUPABASE_URL: 'https://x.test', SUPABASE_KEY: 'k', console: { warn() {} }, fetch: async (u) => { seenUrl = u; return { ok: true, json: async () => [{ id: 1, expires_at: past }, { id: 2, expires_at: future }, { id: 3, expires_at: null }] }; } };
  const names = Object.keys(stubs); const f = new Function(...names, src + '\nreturn _piFetchActiveRulesForEngine;')(...names.map((k) => stubs[k]));
  const r = await f('SRV Farsi');
  check('C2: an expired rule is dropped; unexpired and no-expiry rules are kept', r.map((x) => x.id).join(',') === '2,3', JSON.stringify(r.map((x) => x.id)));
  check('C2: the request selects expires_at and is scoped to one engine', /select=[^&]*expires_at/.test(seenUrl) && /engine=eq\.SRV%20Farsi/.test(seenUrl)); }

/* ── C5: the three optimization screens send the CEO session ── */
for (const a of ['strategy_recompute', 'optimization_apply_recs', 'optimization_toggle_auto']) {
  const re = new RegExp("fetch\\('/api/ops\\?action=" + a + "[^\\n]*X-MMM-CEO-Session"); check(`C5 UI: the ${a} call carries X-MMM-CEO-Session`, re.test(html));
}
check('C5 UI: no remaining unauthenticated call to the three mutating actions', !/fetch\('\/api\/ops\?action=(strategy_recompute|optimization_apply_recs|optimization_toggle_auto)[^)]*'\)\s*;/.test(html));
check('C2 UI: expired rules are tagged on the optimization screen', html.includes("(not in force)"));
process.exit(done() ? 1 : 0);
