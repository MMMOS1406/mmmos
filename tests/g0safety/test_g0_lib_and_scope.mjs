// G0 / C2–C5 — unit proof of lib/generationInputs.mjs and a SCOPE proof that the branch changes nothing outside the corrections.
// node tests/g0safety/test_g0_lib_and_scope.mjs   (needs a local origin/main ref)
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
import * as G from '../../lib/generationInputs.mjs'; import { reporter } from './world.mjs';
const { check, done } = reporter(); const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const git = (...a) => execFileSync('git', a, { cwd: repo, maxBuffer: 256 * 1024 * 1024 }).toString();

/* ── lib ── */
const M = [{ type: 'title', value: 'a' }, { type: 'winning_pattern' }, { type: 'optimization_directive' }, { type: 'active_rule', expiresAt: '2000-01-01T00:00:00Z' }, { type: 'active_rule', expiresAt: '2999-01-01T00:00:00Z' }, { type: 'channel_strategy' }, { source: 'winning_pattern' }, { source: 'local_package', title: 't' }];
check('default is OFF: learning inputs are not allowed to reach generation', G.LEARNING_INPUTS_TO_GENERATION === false);
for (const e of ['srv_farsi', 'srv_english', 'SRV Farsi', 'SRV English']) check(`${e}: every learning entry removed, anti-repetition kept`, G.stripLearningInputs(M, e).length === 2 && G.stripLearningInputs(M, e).every((x) => x.type === 'title' || x.source === 'local_package'));
for (const e of ['nextwave', 'NextWave', 'ai_studio', undefined, '']) check(`engine ${JSON.stringify(e)}: returned untouched (business isolation)`, G.stripLearningInputs(M, e) === M);
check('non-array memory (string / undefined / null) is returned unchanged', G.stripLearningInputs('x', 'srv_farsi') === 'x' && G.stripLearningInputs(undefined, 'srv_farsi') === undefined && G.stripLearningInputs(null, 'srv_farsi') === null);
{ const on = G.stripLearningInputs(M, 'srv_farsi', true, Date.parse('2026-11-21T00:00:00Z')); check('C2 even if learning inputs were enabled later: an EXPIRED rule is dropped, unexpired kept, others kept', on.length === 7 && !on.some((x) => x.expiresAt === '2000-01-01T00:00:00Z') && on.some((x) => x.expiresAt === '2999-01-01T00:00:00Z')); }
check('input array is not mutated', M.length === 8);
check('lib is pure: no network / database / file / env access in the module source', !/fetch|process\.env|require\(|readFile|supabase/i.test(fs.readFileSync(path.join(repo, 'lib/generationInputs.mjs'), 'utf8').replace(/\/\/.*$/gm, '')));

/* ── scope: only the intended files changed ── */
const changed = git('diff', '--name-only', 'origin/main').split('\n').filter(Boolean); const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
const all = [...new Set([...changed, ...untracked])].sort(); const allowed = (f) => ['api/ops.js', 'api/generate.js', 'public/index.html', 'lib/generationInputs.mjs'].includes(f) || /^tests\/g0safety\//.test(f);
check('every changed file is in the allowed set (3 code files, 1 new lib, tests/g0safety/*)', all.every(allowed), JSON.stringify(all.filter((f) => !allowed(f))));
check('vercel.json (cron/schedules), package.json, lib/dataProxy.mjs, Finance, Family, VA, publishing, analytics and growth files are untouched', !all.some((f) => /^(vercel\.json|package\.json|lib\/(dataProxy|fin|growth|yppCard|srv|youtube)|public\/(finance|growth|home2)|api\/youtube\/|projects\/)/.test(f)));
const lines = (f) => git('diff', '-U0', 'origin/main', '--', f).split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
const OPS_OK = [/const \{ engineId, mode, existingMemory/, /G0\//, /_stripLearningInputs/, /_existingMemoryRaw/, /generationInputs\.mjs/, /CEO_ONLY_MUTATING_ACTIONS/, /ceo_authorization_required/, /exArr\.length/, /Supersede older active rules/, /queued inactive and existing rules/, /rulesRaw/, /_nowMs/, /const rules = \(Array\.isArray/, /const rules = await sbGet\('optimization_rules\?active=eq\.true/, /^\+\s*}\s*$/, /^\+\s*\/\/ The daily job calls/, /^\+\s*\/\/ G0/, /^\+\s*$/];
{ const bad = lines('api/ops.js').filter((l) => !OPS_OK.some((re) => re.test(l))); check('api/ops.js: every added/removed line belongs to C2/C3/C4/C5 (' + lines('api/ops.js').length + ' lines in the diff)', bad.length === 0, JSON.stringify(bad.slice(0, 5))); }
{ const bad = lines('api/generate.js').filter((l) => !/generationInputs|G0\/C4|stripLearningInputs|recentPackages|const \{ engine, mood, platform, contentType, contentFormat, taskName/.test(l)); check('api/generate.js: only the C4 import and the recentPackages line changed (' + lines('api/generate.js').length + ' lines)', bad.length === 0, JSON.stringify(bad)); }
{ const L = lines('public/index.html'); const bad = L.filter((l) => !/G0\/C|server strips them again|LEARNING_INPUTS_TO_GENERATION|_learningInputsOn|_learn|expires_at|_nowMs|expiresAt|X-MMM-CEO-Session|rule\.expired|action=(strategy_recompute|optimization_apply_recs|optimization_toggle_auto)|const top=|const directives=|const activeRules=|const strategy=|select=id,rule_type|^\-\s+(return await r\.json\(\);|const top=|const directives=|const activeRules=|const strategy=)|sourceDetail: r\.source_detail|^\+\s*return \(await/.test(l)); check('public/index.html: every added/removed line belongs to C2/C4/C5 (' + L.length + ' lines in the diff)', bad.length === 0, JSON.stringify(bad.slice(0, 6))); }
/* ── gate registry: the existing session gate list is unchanged; the new set is exactly the three actions ── */
{ const cur = fs.readFileSync(path.join(repo, 'api/ops.js'), 'utf8'), base = git('show', 'origin/main:api/ops.js'); const reg = (s, n) => (new RegExp('const ' + n + ' = new Set\\(\\[([\\s\\S]*?)\\]\\)').exec(s) || [])[1];
  check('SESSION_GATED_ACTIONS and PUBLISH_GATED_ACTIONS are byte-identical to main', reg(cur, 'SESSION_GATED_ACTIONS') === reg(base, 'SESSION_GATED_ACTIONS') && reg(cur, 'PUBLISH_GATED_ACTIONS') === reg(base, 'PUBLISH_GATED_ACTIONS'));
  check('CEO_ONLY_MUTATING_ACTIONS is exactly the three maintenance actions', /CEO_ONLY_MUTATING_ACTIONS = new Set\(\['optimization_apply_recs', 'optimization_toggle_auto', 'strategy_recompute'\]\)/.test(cur));
  check('no other action name was added to the router', (cur.match(/if \(action === '/g) || []).length === (base.match(/if \(action === '/g) || []).length); }
process.exit(done() ? 1 : 0);
