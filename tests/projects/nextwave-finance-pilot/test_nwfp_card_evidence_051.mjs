// Order 051 — Finance Pilot card evidence correction. The card shows only what the manifest's verified
// evidence and live facts support. Pure module; no network. Run: node tests/projects/nextwave-finance-pilot/test_nwfp_card_evidence_051.mjs
import * as P from '../../../projects/nextwave-finance-pilot/lib/pilotState.mjs';
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
const st = (env, writes) => P.buildStatus({ stateValue: null, writesFlag: writes, tasks: [], evidence: [], environment: env });
const byId = (s) => Object.fromEntries(s.stages.map(x => [x.id, x.status]));
const prod = byId(st('production', false));
ok('production, both switches OFF: Registration LIVE, L1 DEPLOYED — WRITES OFF, L2 DEPLOYED — READ ONLY, L3 DEPLOYED — SAVING OFF, L4-L7 NOT STARTED',
  prod.registration === 'LIVE' && prod.L1 === 'DEPLOYED — WRITES OFF' && prod.L2 === 'DEPLOYED — READ ONLY' && prod.L3 === 'DEPLOYED — SAVING OFF' && ['L4', 'L5', 'L6', 'L7'].every(k => prod[k] === 'NOT STARTED'), JSON.stringify(prod));
ok('latest verified checkpoint is 052', st('production', false).latest_verified_checkpoint === '052');
ok('L3 follows the REAL plan-saving switch: ON shows DEPLOYED \u2014 SAVING ON; it is independent of the L1 switch', byId(P.buildStatus({ stateValue: null, writesFlag: false, planWritesFlag: true, tasks: [], evidence: [], environment: 'production' })).L3 === 'DEPLOYED \u2014 SAVING ON' && byId(st('production', true)).L3 === 'DEPLOYED \u2014 SAVING OFF');
ok('L1 follows the REAL write switch: ON shows DEPLOYED — WRITES ON (never assumed OFF)', byId(st('production', true)).L1 === 'DEPLOYED — WRITES ON');
for (const env of ['preview', 'development', 'local', undefined]) {
  const s = byId(st(env, false));
  ok(`outside production (${env}) nothing shows LIVE or DEPLOYED`, Object.values(s).every(v => !/^(LIVE|DEPLOYED)/.test(v)) && s.registration === 'PREVIEW READY' && s.L1 === 'PREVIEW READY' && s.L2 === 'PREVIEW READY' && s.L3 === 'PREVIEW READY');
}
ok('every DEPLOYED/LIVE manifest line names a checkpoint and a merge commit as evidence',
  P.STAGES.filter(s => s.status === 'LIVE' || s.status === 'DEPLOYED').every(s => /Checkpoint 0\d\d/.test(s.evidence || '') && /merge [0-9a-f]{7}/.test(s.evidence || '')));
ok('L1 evidence names the applied write-lock migration; L3 evidence names PR #79 and saving OFF', /20261102034457/.test(P.STAGES.find(s => s.id === 'L1').evidence) && /PR #79/.test(P.STAGES.find(s => s.id === 'L3').evidence) && /saving OFF/.test(P.STAGES.find(s => s.id === 'L3').evidence));
ok('the manifest uses only allowed statuses and displayed statuses are from the allowed display set',
  P.STAGES.every(s => P.STAGE_STATUSES.includes(s.status)) && ['production', 'preview'].every(e => [true, false].every(w => st(e, w).stages.every(x => P.DISPLAY_STATUSES.includes(x.status)))));
ok('no stage beyond L3 claims DEPLOYED or LIVE; overall stays NOT OPERATIONAL (L3 planning is not an operational stage)', P.STAGES.filter(s => /^L[4-7]$/.test(s.id)).every(s => s.status === 'NOT STARTED') && st('production', true).operational === 'NOT OPERATIONAL');
ok('generation and publishing stay DISABLED in every case', ['production', 'preview'].every(e => [true, false].every(w => { const s = st(e, w); return s.generation === 'DISABLED' && s.publishing === 'DISABLED'; })));
ok('state defaults unchanged (registered, generation/publishing disabled)', P.defaultState().lifecycle_stage === 'registered' && P.defaultState().generation.enabled === false && P.defaultState().publishing.enabled === false);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
