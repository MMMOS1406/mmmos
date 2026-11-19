// Finance V2 entity isolation rules (phase 2A design, unwired): household finances and each MMMOS business are separate entities; nothing is attributed to a business without a rule AND evidence;
// views are scoped to ONE entity on the server; transfers, investment contributions and market gains are never income or expense. PURE.
export const ENTITIES = Object.freeze({
  household:            Object.freeze({ kind: 'household', status: 'active' }),
  srv_farsi:            Object.freeze({ kind: 'business', status: 'active', engine: 'SRV Farsi' }),
  srv_studio:           Object.freeze({ kind: 'business', status: 'active', engine: 'SRV English' }),
  srv_circle_advisors:  Object.freeze({ kind: 'business', status: 'unconfigured' }),   // identity not confirmed: nothing may be attributed to it
  investment_engine:    Object.freeze({ kind: 'investment', status: 'active' }),
});
export const TXN_KINDS = Object.freeze(['income', 'expense', 'transfer', 'investment_contribution', 'dividend_interest', 'refund', 'fee', 'market_gain']);
export const isEntity = (id) => Object.prototype.hasOwnProperty.call(ENTITIES, id);
// Attribution: only by a rule that names an existing, CONFIGURED business entity and carries evidence (a reference to why). Anything else stays unattributed (null) — never guessed.
export function attribute(txn, rules) {
  for (const r of Array.isArray(rules) ? rules : []) {
    if (!r || !isEntity(r.entity) || ENTITIES[r.entity].status !== 'active' || ENTITIES[r.entity].kind === 'household') continue;
    if (!r.evidence || !r.evidence.type || !r.evidence.ref) continue;
    const m = r.match || {}; const hit = (m.account_id && m.account_id === txn.account_id) || (m.merchant_norm && m.merchant_norm === txn.merchant_norm);
    if (hit) return { entity_id: r.entity, attribution: { rule: r.id || null, evidence: { type: r.evidence.type, ref: r.evidence.ref }, confidence: r.confidence || 'rule' } };
  }
  return { entity_id: null, attribution: null };
}
// Access: only the CEO may read Finance V2 data, and only for ONE named entity (no "all" query); Family, VA and anonymous callers get nothing.
export function authorize({ role, entity }) {
  if (role !== 'ceo') return { ok: false, reason: 'role_not_allowed' };
  if (!isEntity(entity)) return { ok: false, reason: 'entity_required' };
  return { ok: true };
}
// A scoped view contains only rows of that entity. Household = rows explicitly household OR not yet attributed (the owner's money until a rule says otherwise); a business view = only rows attributed to it.
export function scopedView(rows, entity) {
  if (!isEntity(entity)) throw new Error('unknown entity');
  return (Array.isArray(rows) ? rows : []).filter((r) => (entity === 'household' ? (r.entity_id === 'household' || r.entity_id == null) : r.entity_id === entity));
}
export function assertIsolation(rows, entity) {
  for (const r of rows) { const own = entity === 'household' ? (r.entity_id === 'household' || r.entity_id == null) : r.entity_id === entity; if (!own) throw new Error('isolation violation: row of ' + (r.entity_id || 'unattributed') + ' in the ' + entity + ' view'); }
  return true;
}
// Cash flow of a view: income and expense only; transfers, investment contributions and market gains are excluded. A missing amount is skipped, never counted as 0 income.
export function cashFlow(rows) {
  let income = 0, expense = 0, excluded = { transfer: 0, investment_contribution: 0, market_gain: 0 }, unknown = 0;
  for (const r of rows) {
    if (typeof r.amount !== 'number' || !Number.isFinite(r.amount)) { unknown++; continue; }
    if (r.kind === 'transfer' || r.kind === 'investment_contribution' || r.kind === 'market_gain') { excluded[r.kind]++; continue; }
    if (r.kind === 'income' || r.kind === 'dividend_interest' || r.kind === 'refund') income += Math.abs(r.amount); else if (r.kind === 'expense' || r.kind === 'fee') expense += Math.abs(r.amount); else unknown++;
  }
  return { income, expense, net: income - expense, excluded, unclassified: unknown };
}
// Business REVENUE: only income attributed to that business with evidence. Investment market gains are never revenue.
export function businessRevenue(rows, entity) {
  if (!isEntity(entity) || ENTITIES[entity].kind !== 'business') return { available: false, reason: 'not_a_business' };
  const own = rows.filter((r) => r.entity_id === entity && r.kind === 'income' && r.attribution && r.attribution.evidence);
  return own.length ? { available: true, total: own.reduce((a, r) => a + Math.abs(r.amount || 0), 0), count: own.length } : { available: false, reason: ENTITIES[entity].status === 'unconfigured' ? 'entity_unconfigured' : 'no_attributed_income' };
}
