// Finance V2 phase 3C — CEO-attested Rocket Money headline figures (household). PURE: no network, no database, no clock (the caller passes `now`).
// Rocket Money has no supported API, so its headline figures (net worth, assets, liabilities, cash, savings, debt) reach MMMOS only because the CEO READ them in Rocket Money and TYPED them here, with the
// reporting definition, the as-of date and an explicit confirmation. They are labelled "Rocket Money — CEO-attested": never live, never provider-verified. Rules (all tested):
//  - every figure is optional; a figure that is not typed stays UNAVAILABLE (never 0); at least one is required;
//  - the whole snapshot is internally consistent: net worth = assets − liabilities (±$1.00) when all three are typed; cash + savings cannot exceed assets;
//  - ONE snapshot is displayed (the latest as-of); figures are never mixed across dates;
//  - freshness: FRESH ≤ 35 days after the as-of date, STALE 36–120 days (shown, flagged), EXPIRED > 120 days (not displayed as a figure);
//  - nothing is summed across sources: the snapshot never feeds the Investment page, and the definition records whether Rocket Money's assets already include investments.
import { createHash } from 'node:crypto';
export const ENTITY = 'household';
export const KEY = 'fin_rm_snapshots';
export const SNAP_CONFIRMATION = 'ATTEST-FROM-ROCKET-MONEY';
export const FRESH_DAYS = 35;
export const EXPIRE_DAYS = 120;
export const TOLERANCE_CENTS = 100;
export const MAX_SNAPSHOTS = 36;
export const FIGURES = Object.freeze(['net_worth', 'assets', 'liabilities', 'cash', 'savings', 'debt']);
export const DEFINITION_OPTIONS = Object.freeze({ assets_include_investments: ['yes_manual', 'yes_linked', 'no'], liabilities_include_credit_cards: ['yes', 'no', 'unknown'] });
export const FORMULA = 'Net worth = Assets − Debts, as calculated by Rocket Money';
const DAY = 86400000;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isoToMs = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return null; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d.getTime() : null; };

// ── validation (returns every problem, never throws) ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function validateSnapshot(input, { now = 0 } = {}) {
  const errors = []; const inp = input && typeof input === 'object' ? input : {};
  if (inp.confirmation !== SNAP_CONFIRMATION) errors.push({ code: 'confirmation_required' });
  const asOfMs = isoToMs(inp.as_of); const today = Math.floor(now / DAY) * DAY;
  if (asOfMs === null) errors.push({ code: 'bad_as_of' });
  else if (now && asOfMs > today) errors.push({ code: 'future_as_of' });
  else if (now && (today - asOfMs) / DAY > 400) errors.push({ code: 'as_of_too_old' });
  const figs = {}; const given = inp.figures && typeof inp.figures === 'object' ? inp.figures : {};
  for (const k of Object.keys(given)) if (!FIGURES.includes(k)) errors.push({ code: 'unknown_figure', figure: k });
  for (const k of FIGURES) {
    const v = hasOwn(given, k) ? given[k] : null;
    if (v === null || v === undefined) { figs[k] = null; continue; }
    if (typeof v !== 'number' || !Number.isInteger(v) || Math.abs(v) > 1e12) { errors.push({ code: 'bad_figure', figure: k }); figs[k] = null; continue; }
    if (k !== 'net_worth' && v < 0) { errors.push({ code: 'negative_figure', figure: k }); figs[k] = null; continue; }
    figs[k] = v;
  }
  if (!errors.some((e) => e.code === 'bad_figure' || e.code === 'negative_figure') && FIGURES.every((k) => figs[k] === null)) errors.push({ code: 'no_figures' });
  const def = inp.definition && typeof inp.definition === 'object' ? inp.definition : {}; const cleanDef = {};
  for (const [k, opts] of Object.entries(DEFINITION_OPTIONS)) { if (opts.includes(def[k])) cleanDef[k] = def[k]; else errors.push({ code: 'bad_definition', field: k }); }
  // internal consistency (Rocket Money's own formula) — catches typos before anything is stored
  if (figs.net_worth !== null && figs.assets !== null && figs.liabilities !== null && Math.abs(figs.net_worth - (figs.assets - figs.liabilities)) > TOLERANCE_CENTS)
    errors.push({ code: 'net_worth_mismatch', expected: figs.assets - figs.liabilities, difference: figs.net_worth - (figs.assets - figs.liabilities), tolerance_cents: TOLERANCE_CENTS });
  if (figs.assets !== null && ((figs.cash || 0) + (figs.savings || 0)) > figs.assets + TOLERANCE_CENTS) errors.push({ code: 'cash_savings_exceed_assets' });
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], clean: { source: 'rocket_money', as_of: String(inp.as_of), figures: figs, definition: cleanDef } };
}

// ── document ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const emptyDoc = () => ({ v: 1, entity: ENTITY, updated_at: null, snapshots: [] });
export function addSnapshot(doc0, clean, { nowIso, id }) {
  const doc = doc0 ? JSON.parse(JSON.stringify(doc0)) : emptyDoc(); if (doc.entity !== ENTITY) throw new Error('entity_mismatch');
  const rec = { id, source: clean.source, as_of: clean.as_of, entered_at: nowIso, figures: clean.figures, definition: clean.definition, attested: true, by: 'ceo' };
  doc.snapshots.unshift(rec); doc.snapshots = doc.snapshots.slice(0, MAX_SNAPSHOTS); doc.updated_at = nowIso; return doc;
}
export const newId = (seed) => 'snap_' + createHash('sha256').update(String(seed)).digest('hex').slice(0, 10);
export function parseDoc(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw; if (!v || v.entity !== ENTITY || !Array.isArray(v.snapshots)) return null;
    const d = emptyDoc(); d.updated_at = typeof v.updated_at === 'string' ? v.updated_at : null;
    for (const s of v.snapshots.slice(0, MAX_SNAPSHOTS)) {
      if (!s || typeof s.id !== 'string' || isoToMs(s.as_of) === null || typeof s.entered_at !== 'string' || !s.figures || !s.definition) continue;
      const figs = {}; for (const k of FIGURES) { const x = s.figures[k]; figs[k] = (typeof x === 'number' && Number.isInteger(x) && Math.abs(x) <= 1e12 && (k === 'net_worth' || x >= 0)) ? x : null; }
      const def = {}; for (const [k, opts] of Object.entries(DEFINITION_OPTIONS)) def[k] = opts.includes(s.definition[k]) ? s.definition[k] : null;
      d.snapshots.push({ id: s.id, source: 'rocket_money', as_of: s.as_of, entered_at: s.entered_at, figures: figs, definition: def, attested: true, by: 'ceo' });
    }
    return d;
  } catch (_) { return null; }
}
// freshness of ONE snapshot relative to `now`
export function freshness(asOf, now) {
  const ms = isoToMs(asOf); if (ms === null) return { age_days: null, state: 'unknown' };
  const age = Math.floor((now - ms) / DAY);
  return { age_days: age, state: age <= FRESH_DAYS ? 'fresh' : (age <= EXPIRE_DAYS ? 'stale' : 'expired'), expires_on: new Date(ms + (EXPIRE_DAYS + 1) * DAY).toISOString().slice(0, 10) };
}
// What the UI and the display rules read. `latest` = the ONE snapshot used for display (latest as-of, then latest entry); older ones are history only and are never mixed in.
export function statusView(doc, now = Date.now()) {
  const list = (doc && doc.snapshots) || [];
  if (!list.length) return { has_data: false, latest: null, history: [], rules: rules() };
  const sorted = list.slice().sort((a, b) => (a.as_of === b.as_of ? (a.entered_at < b.entered_at ? 1 : -1) : (a.as_of < b.as_of ? 1 : -1)));
  const withF = sorted.map((s) => ({ ...s, ...freshness(s.as_of, now), label: 'Rocket Money — CEO-attested', live: false, provider_verified: false }));
  return { has_data: true, latest: withF[0], history: withF.slice(0, 12), rules: rules() };
}
export const rules = () => ({ fresh_days: FRESH_DAYS, expire_days: EXPIRE_DAYS, formula: FORMULA, tolerance_cents: TOLERANCE_CENTS });
