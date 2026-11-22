// G0 / C2, C3, C5 — server-side proof. The REAL api/ops.js of this branch and of origin/main run against ONE fake world (no network, nothing written anywhere).
//   C5: the three mutating optimization actions are refused without a valid CEO session (and a refused call reaches no database write).
//   C3: with auto_apply OFF the daily job queues rules inactive and never changes an existing rule; with auto_apply ON behaviour is unchanged.
//   C2: optimization_state flags expired rules.
// node tests/g0safety/test_g0_gate_and_rules.mjs
import { world, resetWorld, loadPair, makeCall, cleanup, reporter, signCeo, mkRes } from './world.mjs';
const { check, done } = reporter();
try {
  const { base, cur } = await loadPair('ops.js'); const B = makeCall(base), C = makeCall(cur);
  const ACTIONS = [['optimization_apply_recs', 'GET', {}], ['optimization_toggle_auto', 'GET', { engine: 'SRV Farsi', enabled: 'true' }], ['strategy_recompute', 'GET', {}]];

  /* ── C5 BEFORE: the baseline (origin/main) has no gate — proof the problem was real (local fake world only) ── */
  for (const [action, method, query] of ACTIONS) {
    resetWorld(); const r = await B({ action, method, query });
    check(`BASELINE main: ${action} without any session is NOT refused (status ${r.code})`, r.code !== 401);
  }
  { resetWorld(); const r = await B({ action: 'optimization_toggle_auto', method: 'GET', query: { engine: 'SRV Farsi', enabled: 'true' } });
    check('BASELINE main: an anonymous toggle request turned auto_apply back ON in the fake world', world.settings.find((s) => s.engine === 'SRV Farsi').auto_apply === true && r.code === 200); }

  /* ── C5 AFTER: this branch ── */
  for (const [action, method, query] of ACTIONS) {
    resetWorld(); const r = await C({ action, method, query });
    check(`${action}: no session → 401 ceo_authorization_required`, r.code === 401 && r.body && r.body.error === 'ceo_authorization_required');
    check(`${action}: refused call performs NO database write and NO database read of optimization tables`, world.writes.length === 0 && !world.reads.some((x) => /^optimization_|^channel_strategy/.test(x)));
    resetWorld(); const f1 = await C({ action, method, query, headers: { 'x-mmm-ceo-session': 'forged.token.value' } });
    const f2 = await C({ action, method: 'POST', body: { ceo_session_token: 'forged.token.value' }, query });
    check(`${action}: forged CEO token in header and in body → 401, no write`, f1.code === 401 && f2.code === 401 && world.writes.length === 0);
    resetWorld(); const op = await C({ action, method: 'POST', body: { operator_session_token: 'forged.va.token', family_session_token: 'forged.family.token' }, query });
    check(`${action}: VA / Family style tokens are not accepted → 401, no write`, op.code === 401 && world.writes.length === 0);
    resetWorld(); const x = await C({ action, method, query, headers: { origin: 'https://evil.example' } });
    check(`${action}: cross-origin anonymous caller → 401, no write`, x.code === 401 && world.writes.length === 0);
    resetWorld(); const exp = Buffer.from(JSON.stringify({ sub: 'ceo', exp: Date.now() - 1000 })).toString('base64url'); const expired = await C({ action, method, query, headers: { 'x-mmm-ceo-session': exp + '.sig' } });
    check(`${action}: malformed / expired token → 401`, expired.code === 401);
  }
  { resetWorld(); const r = await C({ action: 'optimization_toggle_auto', method: 'GET', query: { engine: 'SRV Farsi', enabled: 'true' }, ceo: true, ceoHeader: true });
    check('toggle with a valid CEO session (header) is allowed and writes only the settings row + audit row', r.code === 200 && world.settings.find((s) => s.engine === 'SRV Farsi').auto_apply === true && world.writes.every((w) => w.table === 'optimization_settings' || w.table === 'optimization_audit_log'));
    resetWorld(); const r2 = await C({ action: 'optimization_toggle_auto', method: 'POST', body: { engine: 'SRV English', enabled: 'false' }, ceo: true });
    check('toggle with a valid CEO session (body token) is allowed', r2.code === 200); }
  { resetWorld(); const r = await C({ action: 'optimization_state', method: 'GET' }); const d = await C({ action: 'decision_engine', method: 'GET' });
    check('optimization_state (read) remains reachable and unchanged in kind (status 200)', r.code === 200 && r.body && r.body.ok === true); }

  /* ── the daily job path (analytics_auto_run → in-process optimizationApplyRecommendations) is NOT behind the new gate ── */
  { resetWorld(); world.decision = { ok: true, perChannel: [{ engine: 'SRV Farsi', recommendations: [{ action: 'INCREASE', priority: 'high', detail: 'Top retainers use "alpha" pattern for the next generations.' }] }] };
    const r = await C({ action: 'analytics_auto_run', method: 'GET' });
    check('daily job (analytics_auto_run, no session, as the cron calls it) still runs the rule step in-process', r.code === 200 && r.body && r.body.steps && r.body.steps.optimization_apply_recs !== undefined, JSON.stringify(r.body && r.body.steps && r.body.steps.optimization_apply_recs));
    check('…and with auto_apply OFF it queued the rule INACTIVE', world.rules.length === 1 && world.rules[0].active === false && world.rules[0].auto_applied === false && world.audit.some((a) => a.action === 'rule_queued')); }

  /* ── C3: supersede ── */
  const HOOK = (p) => ({ action: 'INCREASE', priority: 'high', detail: `Top retainers use "${p}" pattern for the next generations.` });
  const seed = (autoApply) => { resetWorld(); world.settings.forEach((s) => { s.auto_apply = autoApply; }); world.rules = [{ id: 1, engine: 'SRV Farsi', rule_type: 'hook_pattern_weight', rule_data: { pattern: 'old', weight: 2, instruction: 'x' }, active: true, auto_applied: true, superseded_at: null }, { id: 2, engine: 'SRV English', rule_type: 'hook_pattern_weight', rule_data: { pattern: 'old-en', weight: 2, instruction: 'x' }, active: true, auto_applied: true, superseded_at: null }]; world.nextRuleId = 100;
    world.decision = { ok: true, perChannel: [{ engine: 'SRV Farsi', recommendations: [HOOK('new')] }] }; };
  { seed(false); const before = JSON.stringify(world.rules); const r = await C({ action: 'optimization_apply_recs', method: 'GET', ceo: true, ceoHeader: true });
    check('C3: auto_apply OFF → the existing active rules are NOT touched (no PATCH to optimization_rules)', !world.writes.some((w) => w.method === 'PATCH') && JSON.stringify(world.rules.slice(0, 2)) === before, JSON.stringify(world.writes.map((w) => w.method + ' ' + w.table)));
    check('C3: …the new recommendation is queued inactive (active=false, auto_applied=false) with audit "rule_queued"', world.rules.length === 3 && world.rules[2].active === false && world.rules[2].auto_applied === false && world.audit.some((a) => a.action === 'rule_queued') && r.code === 200);
    check('C3: …and only the SRV Farsi row was created (SRV English untouched)', world.rules.filter((x) => x.engine === 'SRV English').length === 1 && world.rules[2].engine === 'SRV Farsi'); }
  { seed(false); await B({ action: 'optimization_apply_recs', method: 'GET' });
    check('BASELINE main with auto_apply OFF: the old rule WAS deactivated by the supersede step (the defect)', world.rules[0].active === false && !!world.rules[0].superseded_at); }
  { // auto_apply ON: behaviour of this branch equals main's, call for call
    seed(true); await B({ action: 'optimization_apply_recs', method: 'GET' }); const wb = JSON.stringify(world.writes.map((w) => [w.method, w.table, w.body && w.body.active, w.body && w.body.auto_applied, w.body && w.body.rule_type])); const rb = JSON.stringify(world.rules.map((r) => [r.id, r.engine, r.rule_type, r.active, r.auto_applied]));
    seed(true); await C({ action: 'optimization_apply_recs', method: 'GET', ceo: true, ceoHeader: true }); const wc = JSON.stringify(world.writes.map((w) => [w.method, w.table, w.body && w.body.active, w.body && w.body.auto_applied, w.body && w.body.rule_type])); const rc = JSON.stringify(world.rules.map((r) => [r.id, r.engine, r.rule_type, r.active, r.auto_applied]));
    check('C3: auto_apply ON → write sequence and resulting rules are IDENTICAL to main (supersede + active insert preserved)', wb === wc && rb === rc && JSON.parse(rc)[0][3] === false && JSON.parse(rc)[2][3] === true, wb.slice(0, 160)); }
  { seed(false); world.decision = { ok: true, perChannel: [{ engine: 'SRV English', recommendations: [HOOK('en-new')] }, { engine: 'SRV Farsi', recommendations: [HOOK('fa-new')] }] }; await C({ action: 'optimization_apply_recs', method: 'GET', ceo: true, ceoHeader: true });
    const en = world.rules.filter((r) => r.engine === 'SRV English' && r.id >= 100), fa = world.rules.filter((r) => r.engine === 'SRV Farsi' && r.id >= 100);
    check('business isolation: each engine receives only its own recommendation (one new row each, patterns not crossed)', en.length === 1 && fa.length === 1 && en[0].rule_data.pattern === 'en-new' && fa[0].rule_data.pattern === 'fa-new'); }

  /* ── C2: expiry is visible in the state read ── */
  { resetWorld(); const past = new Date(Date.now() - 86400e3).toISOString(), future = new Date(Date.now() + 86400e3 * 5).toISOString();
    world.rules = [{ id: 1, engine: 'SRV Farsi', rule_type: 'cadence_target', rule_data: {}, active: true, expires_at: past }, { id: 2, engine: 'SRV Farsi', rule_type: 'topic_weight', rule_data: {}, active: true, expires_at: future }, { id: 3, engine: 'SRV English', rule_type: 'cta_template', rule_data: {}, active: true, expires_at: null }];
    const r = await C({ action: 'optimization_state', method: 'GET' }); const by = Object.fromEntries((r.body.activeRules || []).map((x) => [x.id, x.expired]));
    check('C2: optimization_state marks an expired rule expired=true, a future rule false, a rule without expiry false; all rows still listed', by[1] === true && by[2] === false && by[3] === false && (r.body.activeRules || []).length === 3, JSON.stringify(by)); }
} finally { cleanup(); }
process.exit(done() ? 1 : 0);
