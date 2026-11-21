// Finance V2 phase 3A — read-only financial-app import foundation (household). PURE: no network, no database, no clock (the caller passes `now`), no file system.
// A CEO-uploaded CSV is validated, parsed IN MEMORY, normalized, classified CONSERVATIVELY and folded into a small summary document. The original file is never retained: only counts, a
// fingerprint, month/category totals and salted row hashes (for duplicate and overlap detection) are kept — no merchant names, no account names, no free text.
// Rules enforced (and tested):
//  - nothing is invented: an adapter without a verified column mapping ("unmapped") refuses to parse; Rocket Money ships UNMAPPED until a real/redacted header is supplied;
//  - a transfer is never income or expense without evidence (category evidence from the adapter spec, or an equal-and-opposite pair across owned accounts);
//  - an inflow is income only with category evidence; a refund only with a matching earlier outflow; everything else is "unclassified" and excluded from income/expense totals;
//  - missing data stays missing (absent months, null) — never 0; duplicates and overlapping exports never double count; CSV formula cells are neutralized; malformed files are refused.
import { createHash } from 'node:crypto';
import { pairTransfers } from './finDedupe.mjs';

export const LIMITS = Object.freeze({ maxBytes: 2_000_000, maxRows: 20_000, maxCols: 40, maxCell: 500, maxMonths: 60, maxDocBytes: 350_000, maxRowHashes: 15_000, maxRejectedShare: 0.2, maxLineSamples: 20 });
export const ENTITY = 'household';
// Verification of an imported month (phase 3B correction): an authorized export can become VERIFIED only after an explicit CEO comparison with the source app and a typed confirmation.
export const VERIFY_CONFIRMATION = 'VERIFY-IMPORT-AGAINST-APP';
export const TOLERANCE_CENTS = 100;   // the CEO's figures may differ from the import by at most $1.00 per figure (rounding in the app); anything larger is a mismatch and is never verified
export const FRESH_DAYS = 35;          // an import older than this is shown STALE (it stays verified for its reporting period)
const sha = (s) => createHash('sha256').update(s).digest('hex');
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ── adapters ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// A spec lists the header names to look for. NOTHING is guessed: if the header does not contain the required columns the file is refused.
// `ROCKET_MONEY` below is the generic UNMAPPED placeholder (reads nothing) kept for tests of the unmapped path; the REGISTERED Rocket Money adapter is ROCKET_MONEY_V1.
export const ROCKET_MONEY = Object.freeze({ id: 'rocket_money', label: 'Rocket Money (transactions CSV)', status: 'unmapped', version: 0, verifiable: true,
  note: 'An unmapped source reads nothing until a real export is inspected and the mapping is accepted.' });

// ── Rocket Money transactions export — mapping VERIFIED FROM A REAL EXPORT and ACCEPTED by the PM (phase 3D) ────────────────────────────────────────────────────────────────────────────────
// Evidence: a real export (Transactions → Export, 62 rows, 2026-10-01…2026-10-30, three accounts at two institutions) was inspected locally on 2026-11-21 with tools/finance/inspect_rm_sample.mjs; nothing from it is stored here
// except the column NAMES (their fingerprint is the evidence) and the conventions below. Verified conventions (from that file; October 2026 then reconciled to the cent with Rocket Money's own Spending page):
//  - 15 columns: Date, Original Date, Account Type, Account Name, Account Number, Institution Name, Name, Custom Name, Amount, Description, Category, Note, Ignored From, Tax Deductible, Transaction Tags. No transaction id.
//  - Date = YYYY-MM-DD (Original Date identical in all rows). Amount = plain decimal, no $ or thousands separators, at most 2 decimals. **POSITIVE = money OUT (spending), NEGATIVE = money IN (income, refunds, transfers in).**
//  - Category is Rocket Money's own. 'Income' (credits) is income; 'Internal Transfers' and 'Credit Card Payment' (both legs present, one positive one negative) are NOT spending; the ten spending categories seen in the export (plus Shopping and Medical, seen as
//    spending on Rocket Money's Spending page) are spending. **Any OTHER category label (the CEO's account also has custom categories) is UNFAMILIAR: its rows are flagged for review and excluded from every total — never silently spending.**
//  - A credit (negative) inside a KNOWN spending category is a refund / reversal that Rocket Money NETS against that spending (its total spend matched the export only with the credit netted).
//  - Account Number is the last four digits (never used or stored); Account Name distinguishes the accounts; Ignored From / Note / Tags / Tax Deductible were empty — any non-empty Ignored From row is skipped (meaning not evidenced).
// PENDING TRANSACTIONS: the export has NO pending-status column, so pending transactions can NOT be identified. It is NOT known whether pending rows appear in the file; none are excluded and none are claimed absent (a warning says so on every import).
// NOT evidenced and therefore NOT supported: transaction ids, multi-currency, split transactions, and what 'Ignored From' contains when it is populated.
export const ROCKET_MONEY_V1_HEADER = Object.freeze(['Date', 'Original Date', 'Account Type', 'Account Name', 'Account Number', 'Institution Name', 'Name', 'Custom Name', 'Amount', 'Description', 'Category', 'Note', 'Ignored From', 'Tax Deductible', 'Transaction Tags']);
export const ROCKET_MONEY_V1 = Object.freeze({ id: 'rocket_money', label: 'Rocket Money (transactions CSV export)', status: 'mapped', version: 1, verifiable: true,
  columns: Object.freeze({ date: ['Date'], amount: ['Amount'], merchant: ['Name'], category: ['Category'], account: ['Account Name'] }),
  dateFormats: ['YYYY-MM-DD'], amountConvention: 'positive_is_outflow', transferCategories: ['internal transfers', 'credit card payment'], incomeCategories: ['income'], refundsReduceSpending: true, ignoreWhenNonEmpty: ['Ignored From'],
  spendingCategories: ['bills & utilities', 'loan payment', 'software & tech', 'charitable donations', 'personal care', 'auto & transport', 'groceries', 'entertainment & rec.', 'health & wellness', 'fees', 'shopping', 'medical'],
  pendingStatus: 'not_in_export',
  provides: Object.freeze({ income: true, spending: true, categories: true }),
  evidence: Object.freeze({ source: 'real_export_inspected_locally', header_sha256: '10c4d874c5d885ac06b982a29fad5421e184792c0a8b9ec64b5b898639dc19c4', inspected_on: '2026-11-21', rows_inspected: 62, period: '2026-10', reconciled_with: 'Rocket Money Spending page, October 2026: Total spend (bills included), Income and every category total matched to the cent',
    reviewed_by: 'pm', reviewed_on: '2026-11-21' }) });
// The production registry: Rocket Money is registered with the ACCEPTED mapping. It is IMPORT ONLY — a one-time file the CEO provides; nothing connects, nothing syncs.
export const ADAPTERS = Object.freeze({ rocket_money: ROCKET_MONEY_V1 });
// A synthetic adapter used ONLY by tests and the UI preview fixture (never registered in production).
export const FIXTURE_ADAPTER = Object.freeze({ id: 'fixture_csv', label: 'Synthetic fixture CSV', status: 'fixture', version: 1, verifiable: true,
  columns: { date: ['Date'], amount: ['Amount'], merchant: ['Description'], category: ['Category'], account: ['Account'], pending: ['Pending'] },
  dateFormats: ['YYYY-MM-DD'], amountConvention: 'negative_is_outflow', transferCategories: ['transfer'], incomeCategories: ['income', 'paycheck'], pendingTrueValues: ['true', 'yes', '1', 'pending'] });

// ── adapter specs: a mapping may only be enabled from REAL evidence (phase 3C) ────────────────────────────────────────────────────────────────────────────────
// status 'unmapped' = refuse to read (Rocket Money today). status 'mapped' = enabled from a real redacted export: the spec must carry `evidence` (the header fingerprint of that export, who reviewed it and when);
// the file being imported must have the SAME header or it is refused (format drift). status 'fixture' = synthetic tests only. Nothing is ever guessed.
export const SUPPORTED_DATE_FORMATS = Object.freeze(['YYYY-MM-DD', 'MM/DD/YYYY']);
export const AMOUNT_CONVENTIONS = Object.freeze(['negative_is_outflow', 'positive_is_outflow']);
export const headerFingerprint = (header) => sha((header || []).map((h) => String(h).trim()).join('\u001f'));
export function validateAdapterSpec(spec) {
  const problems = []; const bad = (m) => problems.push(m); const arr = (x) => Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'string' && v.trim());
  if (!spec || typeof spec !== 'object') return { ok: false, problems: ['not_an_object'] };
  if (!spec.id || typeof spec.id !== 'string') bad('missing_id'); if (!spec.label || typeof spec.label !== 'string') bad('missing_label');
  if (!['unmapped', 'mapped', 'fixture'].includes(spec.status)) bad('bad_status');
  if (spec.status === 'unmapped') { if (spec.columns) bad('unmapped_must_not_have_columns'); return { ok: problems.length === 0, problems }; }
  if (!Number.isInteger(spec.version) || spec.version < 1) bad('bad_version');
  const c = spec.columns || {}; if (!arr(c.date)) bad('missing_date_column'); if (!arr(c.amount)) bad('missing_amount_column');
  for (const k of ['merchant', 'category', 'account', 'pending']) if (c[k] !== undefined && !arr(c[k])) bad('bad_column_' + k);
  if (!Array.isArray(spec.dateFormats) || !spec.dateFormats.length || !spec.dateFormats.every((f) => SUPPORTED_DATE_FORMATS.includes(f))) bad('unsupported_date_format');
  if (!AMOUNT_CONVENTIONS.includes(spec.amountConvention)) bad('bad_amount_convention');
  for (const k of ['transferCategories', 'incomeCategories', 'pendingTrueValues']) if (spec[k] !== undefined && !(Array.isArray(spec[k]) && spec[k].every((v) => typeof v === 'string'))) bad('bad_' + k);
  if (spec.refundsReduceSpending !== undefined && typeof spec.refundsReduceSpending !== 'boolean') bad('bad_refundsReduceSpending'); if (spec.refundsReduceSpending && !c.category) bad('refunds_reduce_spending_needs_category_column');
  if (spec.ignoreWhenNonEmpty !== undefined && !arr(spec.ignoreWhenNonEmpty)) bad('bad_ignoreWhenNonEmpty');
  if (spec.spendingCategories !== undefined && (!arr(spec.spendingCategories) || !c.category)) bad('bad_spendingCategories');
  if (spec.pendingStatus !== undefined && !['not_in_export', 'column'].includes(spec.pendingStatus)) bad('bad_pendingStatus');
  const pv = spec.provides || {}; if (pv.categories && !c.category) bad('provides_categories_without_column'); if (pv.income && !(c.category && (spec.incomeCategories || []).length)) bad('provides_income_without_income_categories');
  if (spec.status === 'mapped') {
    const e = spec.evidence || {};
    if (!['real_redacted_export', 'real_export_inspected_locally'].includes(e.source)) bad('evidence_source_must_be_a_real_export');
    if (!/^[0-9a-f]{64}$/.test(String(e.header_sha256 || ''))) bad('evidence_header_fingerprint_missing');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.reviewed_on || ''))) bad('evidence_review_date_missing');
    if (!['ceo', 'pm'].includes(e.reviewed_by)) bad('evidence_reviewer_missing');
  }
  return { ok: problems.length === 0, problems };
}

// ── raw content checks ────────────────────────────────────────────────────────────────────
export function checkRawContent(content) {
  const errors = [];
  if (typeof content !== 'string' || !content.length) return [{ code: 'empty_file' }];
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > LIMITS.maxBytes) errors.push({ code: 'too_large', limit_bytes: LIMITS.maxBytes });
  if (content.startsWith('PK')) errors.push({ code: 'not_csv_archive' });             // xlsx / zip
  if (content.includes('\u0000')) errors.push({ code: 'binary_content' });
  if (content.includes('�')) errors.push({ code: 'bad_encoding' });               // invalid UTF-8 decoded with replacement characters
  const head = content.replace(/^﻿/, '').trimStart().slice(0, 1);
  if (head === '<' || head === '{' || head === '[') errors.push({ code: 'not_csv_markup_or_json' });
  const ctrl = (content.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  if (ctrl > 0) errors.push({ code: 'control_characters', count: ctrl });
  return errors;
}

// ── CSV (RFC 4180): comma delimiter, quoted fields, "" escapes, newlines inside quotes ────
export function parseCsv(text) {
  const t = String(text).replace(/^﻿/, ''); const rows = []; let row = [], cell = '', inQ = false, i = 0, quotedCell = false;
  const endCell = () => { row.push(cell); cell = ''; quotedCell = false; };
  const endRow = () => { endCell(); if (!(row.length === 1 && row[0] === '' )) rows.push(row); row = []; };
  while (i < t.length) {
    const c = t[i];
    if (inQ) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i += 2; continue; } inQ = false; i++; continue; } cell += c; i++; continue; }
    if (c === '"' && cell === '' && !quotedCell) { inQ = true; quotedCell = true; i++; continue; }
    if (c === ',') { endCell(); i++; continue; }
    if (c === '\r') { endRow(); i += t[i + 1] === '\n' ? 2 : 1; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    cell += c; i++;
  }
  if (inQ) return { ok: false, error: 'unterminated_quote', rows: [] };
  if (cell !== '' || row.length) endRow();
  return { ok: true, rows };
}

// ── field helpers ─────────────────────────────────────────────────────────────────────────
// Stored text is reduced to a short, harmless label: control characters and leading formula characters (= + - @ tab CR) are removed, whitespace collapsed.
export function sanitizeLabel(s, max = 40) { return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/^[\s=+\-@|]+/, '').replace(/\s+/g, ' ').trim().slice(0, max); }
export const isFormulaLike = (s) => /^[\s]*[=+@\t\r]/.test(String(s)) || /^[\s]*-[^\d.\s(]/.test(String(s)) || /\bDDE\s*\(|HYPERLINK\s*\(|cmd\s*\|/i.test(String(s));
const normText = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function parseDate(s, formats) {
  const v = String(s || '').trim(); if (!v) return { err: 'missing_date' };
  for (const f of formats) {
    let m, y, mo, d;
    if (f === 'YYYY-MM-DD' && (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if (f === 'MM/DD/YYYY' && (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) { mo = +m[1]; d = +m[2]; y = +m[3]; }
    else continue;
    const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 2000) return { err: 'bad_date' };
    return { iso: `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
  }
  return { err: 'bad_date' };
}
function parseCents(s) {
  const raw = String(s == null ? '' : s).trim(); if (!raw) return { err: 'missing_amount' };
  let v = raw, neg = false; if (/^\(.*\)$/.test(v)) { neg = true; v = v.slice(1, -1); }
  v = v.replace(/^\$/, '').replace(/^-\$/, '-'); if (v.startsWith('-')) { neg = !neg; v = v.slice(1); } else if (v.startsWith('+')) v = v.slice(1);
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(v)) return { err: 'bad_amount' };
  const n = Math.round(parseFloat(v.replace(/,/g, '')) * 100); if (!Number.isFinite(n) || n > 1e11) return { err: 'bad_amount' };
  return { cents: neg ? -n : n };
}
const dayNum = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 86400000);

// ── analysis ─────────────────────────────────────────────────────────────────────────────
// doc: the stored summary document (or null); adapters: registry; now: epoch ms. Returns a result that is safe to send to the browser (no row content).
export function analyzeImport({ content, adapterId, doc = null, adapters = ADAPTERS, now = 0, salt: newDocSalt = 'x' }) {
  const out = { ok: false, blocking: [], warnings: [], adapter: null, file: null, rows_fingerprint: null, period: null,
    counts: { data_rows: 0, accepted: 0, rejected: 0, pending_skipped: 0, ignored_skipped: 0, already_imported: 0, new_rows: 0, identical_within_file: 0 }, rejected: {}, formula_like_cells: 0,
    classification: { income: 0, expense: 0, refund: 0, transfer: 0, unclassified: 0, review: 0 }, review: { rows: 0, categories: [] }, evidence: {}, months: {}, overlap: { kind: 'none', with: [] }, _newRows: [] };
  const block = (code, extra) => { out.blocking.push({ code, ...(extra || {}) }); };
  const spec = adapters[adapterId] || null;
  if (!spec) { block('unknown_adapter'); return out; }
  out.adapter = { id: spec.id, label: spec.label, status: spec.status, version: spec.version, nets_refunds: !!spec.refundsReduceSpending };
  if (spec.status === 'unmapped') { block('adapter_unmapped', { note: spec.note }); return out; }
  if (spec.status !== 'fixture' && spec.status !== 'mapped') { block('adapter_unverified'); return out; }   // an adapter that is neither a synthetic fixture nor a mapping enabled from a real export is never read
  { const sv = validateAdapterSpec(spec); if (!sv.ok) { block('adapter_invalid', { problems: sv.problems }); return out; } }
  const raw = checkRawContent(content); if (raw.length) { for (const e of raw) block(e.code, e); return out; }
  out.file = { bytes: Buffer.byteLength(content, 'utf8'), sha256: sha(content) };
  const parsed = parseCsv(content); if (!parsed.ok) { block(parsed.error); return out; }
  const table = parsed.rows; if (table.length < 2) { block(table.length ? 'header_only' : 'empty_file'); return out; }
  if (table.length - 1 > LIMITS.maxRows) { block('too_many_rows', { limit: LIMITS.maxRows }); return out; }
  const header = table[0].map((h) => String(h).trim()); if (header.length > LIMITS.maxCols) { block('too_many_columns'); return out; }
  if (spec.status === 'mapped' && headerFingerprint(header) !== spec.evidence.header_sha256) { block('header_changed', { note: 'The file header differs from the export this mapping was verified against.' }); return out; }
  // column mapping from the spec only
  const idx = {}; const lower = header.map((h) => h.toLowerCase());
  for (const [field, names] of Object.entries(spec.columns || {})) { for (const n of names) { const i = lower.indexOf(String(n).toLowerCase()); if (i >= 0) { idx[field] = i; break; } } }
  const missing = ['date', 'amount'].filter((f) => !hasOwn(idx, f)); if (missing.length) { block('missing_columns', { missing, expected: missing.map((f) => (spec.columns[f] || []).join(' | ')) }); return out; }
  const salt = (doc && doc.salt) || newDocSalt; out._salt = salt;   // a first import creates the document with THIS salt (mergeImport) so later hashes match
  const rej = (reason, line) => { const r = out.rejected[reason] || (out.rejected[reason] = { count: 0, lines: [] }); r.count++; if (r.lines.length < LIMITS.maxLineSamples) r.lines.push(line); out.counts.rejected++; };
  const rows = []; const nowDay = Math.floor(now / 86400000);
  const ignIdx = (spec.ignoreWhenNonEmpty || []).map((n) => lower.indexOf(String(n).toLowerCase())).filter((i) => i >= 0);   // rows the source app marks as ignored are not counted (their meaning is not evidenced)
  for (let r = 1; r < table.length; r++) {
    const line = r + 1, cells = table[r]; out.counts.data_rows++;
    if (cells.length !== header.length) { rej('ragged_row', line); continue; }
    if (cells.some((c) => c.length > LIMITS.maxCell)) { rej('cell_too_long', line); continue; }
    for (let c = 0; c < cells.length; c++) if (c !== idx.amount && isFormulaLike(cells[c])) out.formula_like_cells++;
    if (ignIdx.some((i) => String(cells[i]).trim() !== '')) { out.counts.ignored_skipped++; continue; }
    const d = parseDate(cells[idx.date], spec.dateFormats || ['YYYY-MM-DD']); if (d.err) { rej(d.err, line); continue; }
    if (now && dayNum(d.iso) > nowDay + 1) { rej('future_date', line); continue; }
    const a = parseCents(cells[idx.amount]); if (a.err) { rej(a.err, line); continue; }
    const pend = hasOwn(idx, 'pending') && (spec.pendingTrueValues || []).includes(String(cells[idx.pending]).trim().toLowerCase());
    if (pend) { out.counts.pending_skipped++; continue; }
    rows.push({ line, date: d.iso, cents: spec.amountConvention === 'positive_is_outflow' ? -a.cents : a.cents,
      merchant: hasOwn(idx, 'merchant') ? normText(cells[idx.merchant]) : '', category: hasOwn(idx, 'category') ? sanitizeLabel(cells[idx.category]) : '', account: hasOwn(idx, 'account') ? normText(cells[idx.account]) : '' });
  }
  out.counts.accepted = rows.length;
  if (out.counts.data_rows && out.counts.rejected / out.counts.data_rows > LIMITS.maxRejectedShare) block('too_many_rejected', { rejected: out.counts.rejected, of: out.counts.data_rows });
  if (!rows.length) { block('no_valid_rows'); return out; }
  // classification (conservative)
  const spendingCats = spec.spendingCategories ? new Set(spec.spendingCategories.map((x) => x.toLowerCase())) : null; const reviewMap = new Map();
  const transferCats = new Set((spec.transferCategories || []).map((x) => x.toLowerCase())), incomeCats = new Set((spec.incomeCategories || []).map((x) => x.toLowerCase()));
  const ev = out.evidence; const bump = (k) => { ev[k] = (ev[k] || 0) + 1; };
  const outflows = rows.filter((x) => x.cents < 0);
  for (const x of rows) {
    const cat = x.category.toLowerCase();
    if (cat && transferCats.has(cat)) { x.kind = 'transfer'; bump('category_transfer'); }
    else if (x.cents > 0 && cat && incomeCats.has(cat)) { x.kind = 'income'; bump('category_income'); }
    else if (cat && spendingCats && !spendingCats.has(cat) && !incomeCats.has(cat)) {   // UNFAMILIAR category (e.g. a custom or transfer-like label): not enough evidence to call it spending, a refund or income — flagged, excluded from every total
      x.kind = 'review'; bump('unfamiliar_category'); const k = x.category.slice(0, 40); const e = reviewMap.get(k) || { label: k, rows: 0, out_cents: 0, in_cents: 0, looks_like_transfer: /transfer|payment|payoff|pay off|withdraw|deposit|reimburs|refund|credit card|loan|savings/i.test(k) }; e.rows++; if (x.cents < 0) e.out_cents += -x.cents; else e.in_cents += x.cents; reviewMap.set(k, e);
    }
    else if (x.cents > 0 && spec.refundsReduceSpending && cat && !incomeCats.has(cat)) { x.kind = 'refund'; x.netted = true; bump('refund_category_credit'); }   // the source categorises a credit inside a spending category and nets it against that spending (verified against the source app)
    else if (x.cents > 0) {
      const src = x.merchant && !incomeCats.has(cat) ? outflows.find((o) => o.merchant === x.merchant && -o.cents >= x.cents && dayNum(o.date) <= dayNum(x.date) && dayNum(x.date) - dayNum(o.date) <= 90) : null;
      if (src) { x.kind = 'refund'; bump('refund_matches_earlier_purchase'); } else { x.kind = 'unclassified'; bump('inflow_without_evidence'); }
    } else if (x.cents < 0 && cat && incomeCats.has(cat)) { x.kind = 'unclassified'; bump('outflow_in_income_category'); }   // money OUT labelled as income contradicts the evidence: never counted
    else if (x.cents < 0 && cat) { x.kind = 'expense'; bump('category_expense'); }
    else { x.kind = 'unclassified'; bump('outflow_without_category'); }
  }
  // equal-and-opposite pairs across OWNED accounts (accounts that appear in the file) are transfers — evidence: the pair itself
  const owned = new Set(rows.map((x) => x.account).filter(Boolean));
  if (owned.size > 1) {
    const cand = rows.map((x, i) => ({ i, ...x, account_fingerprint: x.account, amount: x.cents / 100, kind: x.kind }));
    const paired = pairTransfers(cand.filter((c) => c.account_fingerprint && c.kind === 'unclassified'), owned);
    for (const p of paired) if (p.kind === 'transfer' && rows[p.i].kind !== 'transfer') { rows[p.i].kind = 'transfer'; bump('paired_between_owned_accounts'); }
    if (ev.paired_between_owned_accounts) out.warnings.push({ code: 'paired_transfers_reclassified', count: ev.paired_between_owned_accounts });
  }
  // stable hashes (the nth identical row gets index n, so a re-export hashes the same way)
  const seen = new Map(); const existing = new Set(); if (doc && doc.rows) for (const m of Object.keys(doc.rows)) for (const h of doc.rows[m]) existing.add(h);
  for (const x of rows) { const key = `${x.date}|${x.cents}|${x.merchant}|${x.account}`; const n = (seen.get(key) || 0) + 1; seen.set(key, n); if (n > 1) out.counts.identical_within_file++; x.hash = sha(`${salt}|${key}|${n}`).slice(0, 12); }
  out.rows_fingerprint = sha(rows.map((x) => x.hash).sort().join(',')).slice(0, 32);
  const dates = rows.map((x) => x.date).sort(); out.period = { from: dates[0], to: dates[dates.length - 1] };
  // duplicate files and overlapping periods
  const prior = (doc && doc.imports) || [];
  const sameFile = prior.filter((p) => p.file_sha256_16 === out.file.sha256.slice(0, 16) || p.rows_fingerprint === out.rows_fingerprint.slice(0, 16));
  const overlapping = prior.filter((p) => p.period && !(out.period.to < p.period.from || out.period.from > p.period.to));
  const fresh = rows.filter((x) => !existing.has(x.hash)); out.counts.already_imported = rows.length - fresh.length; out.counts.new_rows = fresh.length;
  if (sameFile.length) { out.overlap = { kind: 'same_file', with: sameFile.map((p) => p.id) }; block('same_file_already_imported', { import: sameFile[0].id }); }
  else if (!fresh.length) { out.overlap = { kind: 'exact_duplicate_rows', with: overlapping.map((p) => p.id) }; block('no_new_rows', { already_imported: out.counts.already_imported }); }
  else if (out.counts.already_imported || overlapping.length) { out.overlap = { kind: 'partial_overlap', with: overlapping.map((p) => p.id), already_imported: out.counts.already_imported, new_rows: fresh.length }; out.warnings.push({ code: 'overlapping_period', already_imported: out.counts.already_imported, new_rows: fresh.length }); }
  // month totals for the NEW rows only (cents; categories only for expenses; no merchant or account names)
  for (const x of fresh) {
    out.classification[x.kind]++; const m = x.date.slice(0, 7); const t = out.months[m] || (out.months[m] = { income: 0, expense: 0, refund: 0, transfer: 0, unclassified_in: 0, unclassified_out: 0, count: 0, by_category: {} });
    t.count++;
    if (x.kind === 'income') t.income += x.cents; else if (x.kind === 'expense') { t.expense += -x.cents; t.by_category[x.category] = (t.by_category[x.category] || 0) + -x.cents; }
    else if (x.kind === 'refund') { t.refund += x.cents; if (x.netted) { t.expense -= x.cents; t.by_category[x.category] = (t.by_category[x.category] || 0) - x.cents; } } else if (x.kind === 'transfer') t.transfer += Math.abs(x.cents); else if (x.cents > 0) t.unclassified_in += x.cents; else t.unclassified_out += -x.cents;
  }
  if (reviewMap.size) { out.review = { rows: [...reviewMap.values()].reduce((a, e) => a + e.rows, 0), categories: [...reviewMap.values()].sort((a, b) => b.rows - a.rows).slice(0, 20) }; out.warnings.push({ code: 'unfamiliar_categories_flagged', count: out.review.rows, categories: out.review.categories.length }); }
  if (spec.pendingStatus === 'not_in_export') out.warnings.push({ code: 'pending_status_not_in_export' });   // never claimed absent
  if (out.classification.unclassified) out.warnings.push({ code: 'unclassified_rows_excluded', count: out.classification.unclassified });
  if (out.formula_like_cells) out.warnings.push({ code: 'formula_like_cells_neutralized', count: out.formula_like_cells });
  out.capabilities = { categories: hasOwn(idx, 'category') && rows.some((x) => x.category), income: (ev.category_income || 0) > 0, spending: (ev.category_expense || 0) > 0, refunds: (ev.category_credit_refund || 0) + (ev.refund_category_credit || 0) + (ev.refund_matches_earlier_purchase || 0) > 0, review: out.review.rows > 0, transfers: (ev.category_transfer || 0) + (ev.paired_between_owned_accounts || 0) > 0 };   // what THIS file gave adequate evidence for
  out._newRows = fresh.map((x) => ({ hash: x.hash, month: x.date.slice(0, 7) }));
  out.ok = out.blocking.length === 0; return out;
}
export const publicResult = (r) => { const { _newRows, _salt, ...rest } = r; return rest; };

// ── summary document ─────────────────────────────────────────────────────────────────────
export const emptyDoc = (salt) => ({ v: 1, entity: ENTITY, salt, updated_at: null, imports: [], months: {}, rows: {}, verified: {} });
export const newSalt = () => createHash('sha256').update(String(Math.random()) + String(Date.now())).digest('hex').slice(0, 16);
export function mergeImport(doc0, result, { nowIso, id }) {
  if (!result || !result.ok) throw new Error('import_not_committable');
  const doc = JSON.parse(JSON.stringify(doc0 || emptyDoc(result._salt || newSalt()))); if (doc.entity !== ENTITY) throw new Error('entity_mismatch');
  doc.imports.unshift({ id, source: result.adapter.id, adapter_version: result.adapter.version, imported_at: nowIso, period: result.period, rows_accepted: result.counts.accepted, rows_new: result.counts.new_rows, rows_already_imported: result.counts.already_imported,
    rows_rejected: result.counts.rejected, pending_skipped: result.counts.pending_skipped, classification: result.classification, file_sha256_16: result.file.sha256.slice(0, 16), rows_fingerprint: result.rows_fingerprint.slice(0, 16), overlap: result.overlap.kind });
  doc.imports = doc.imports.slice(0, 120);
  for (const [m, t] of Object.entries(result.months)) {
    const cur = doc.months[m] || (doc.months[m] = { income: 0, expense: 0, refund: 0, transfer: 0, unclassified_in: 0, unclassified_out: 0, count: 0, by_category: {}, imports: [] });
    for (const k of ['income', 'expense', 'refund', 'transfer', 'unclassified_in', 'unclassified_out', 'count']) cur[k] += t[k];
    for (const [c, v] of Object.entries(t.by_category)) cur.by_category[c] = (cur.by_category[c] || 0) + v;
    if (!cur.imports.includes(id)) cur.imports.push(id);
  }
  const reset = []; doc.verified = doc.verified || {};
  for (const m of Object.keys(result.months)) if (doc.verified[m]) { delete doc.verified[m]; reset.push(m); }   // new rows change the month's totals: the earlier CEO confirmation no longer applies
  if (reset.length) doc.imports[0].verification_reset = reset;
  for (const r of result._newRows) (doc.rows[r.month] || (doc.rows[r.month] = [])).push(r.hash);
  // bounds: keep the latest 60 months of totals; keep row hashes for the newest months only (older months stay as totals, flagged)
  const months = Object.keys(doc.months).sort(); for (const m of months.slice(0, Math.max(0, months.length - LIMITS.maxMonths))) { delete doc.months[m]; delete doc.rows[m]; }
  let total = Object.values(doc.rows).reduce((a, l) => a + l.length, 0);
  for (const m of Object.keys(doc.rows).sort()) { if (total <= LIMITS.maxRowHashes) break; total -= doc.rows[m].length; delete doc.rows[m]; if (doc.months[m]) doc.months[m].hashes_pruned = true; }
  doc.updated_at = nowIso;
  if (JSON.stringify(doc).length > LIMITS.maxDocBytes) throw new Error('summary_too_large');
  return doc;
}
// Defensive read of a stored document (anything unexpected is dropped; a wrong entity or shape yields null).
export function parseDoc(raw) {
  try { const v = typeof raw === 'string' ? JSON.parse(raw) : raw; if (!v || v.entity !== ENTITY || typeof v.salt !== 'string') return null;
    const d = emptyDoc(v.salt); d.updated_at = typeof v.updated_at === 'string' ? v.updated_at : null;
    d.imports = Array.isArray(v.imports) ? v.imports.filter((p) => p && typeof p.id === 'string' && p.period && typeof p.file_sha256_16 === 'string').slice(0, 120) : [];
    if (v.months && typeof v.months === 'object') for (const [m, t] of Object.entries(v.months)) if (/^\d{4}-\d{2}$/.test(m) && t && typeof t === 'object') d.months[m] = { income: +t.income || 0, expense: +t.expense || 0, refund: +t.refund || 0, transfer: +t.transfer || 0, unclassified_in: +t.unclassified_in || 0, unclassified_out: +t.unclassified_out || 0, count: +t.count || 0, by_category: t.by_category && typeof t.by_category === 'object' ? Object.fromEntries(Object.entries(t.by_category).map(([c, n]) => [sanitizeLabel(c), +n || 0])) : {}, imports: Array.isArray(t.imports) ? t.imports.filter((x) => typeof x === 'string') : [], ...(t.hashes_pruned ? { hashes_pruned: true } : {}) };
    if (v.rows && typeof v.rows === 'object') for (const [m, l] of Object.entries(v.rows)) if (/^\d{4}-\d{2}$/.test(m) && Array.isArray(l)) d.rows[m] = l.filter((h) => typeof h === 'string' && /^[0-9a-f]{12}$/.test(h));
    d.verified = {};
    if (v.verified && typeof v.verified === 'object') for (const [m, r] of Object.entries(v.verified)) if (/^\d{4}-\d{2}$/.test(m) && r && typeof r === 'object' && typeof r.verified_at === 'string' && r.compared && r.imported) d.verified[m] = { verified_at: r.verified_at, by: 'ceo', compared: { income: Math.round(+r.compared.income) || 0, expense: Math.round(+r.compared.expense) || 0 }, imported: { income: Math.round(+r.imported.income) || 0, expense: Math.round(+r.imported.expense) || 0 }, import_ids: Array.isArray(r.import_ids) ? r.import_ids.filter((x) => typeof x === 'string').slice(0, 120) : [] };
    return d; } catch (_) { return null; }
}
// CEO verification of ONE imported month. The CEO types the income and spending figures the source app shows for that month; they must match the imported (classified) totals within TOLERANCE_CENTS and
// the typed confirmation must be exact. Only months built entirely from imports of a verifiable source qualify. Never changes totals, provenance or freshness; only adds the verification record.
export function verifyMonth(doc0, month, compared, { nowIso, adapters = ADAPTERS, confirmation } = {}) {
  if (confirmation !== VERIFY_CONFIRMATION) return { ok: false, error: 'confirmation_required' };
  if (!doc0 || doc0.entity !== ENTITY) return { ok: false, error: 'no_import_summary' };
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !doc0.months[month]) return { ok: false, error: 'unknown_month' };
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) && Number.isInteger(x) && Math.abs(x) <= 1e11) ? x : null;
  const ci = num(compared && compared.income), ce = num(compared && compared.expense);
  if (ci === null || ce === null || ci < 0 || ce < 0) return { ok: false, error: 'bad_figures' };
  const m = doc0.months[month]; const ids = Array.isArray(m.imports) ? m.imports : [];
  const srcs = ids.map((id) => (doc0.imports.find((p) => p.id === id) || {}).source);
  if (!ids.length || srcs.some((x) => !x || !(adapters[x] && adapters[x].verifiable))) return { ok: false, error: 'source_not_verifiable' };
  const di = ci - m.income, de = ce - m.expense;
  if (Math.abs(di) > TOLERANCE_CENTS || Math.abs(de) > TOLERANCE_CENTS) return { ok: false, error: 'mismatch', difference: { income: di, expense: de }, tolerance_cents: TOLERANCE_CENTS };
  const doc = JSON.parse(JSON.stringify(doc0)); doc.verified = doc.verified || {};
  doc.verified[month] = { verified_at: nowIso, by: 'ceo', compared: { income: ci, expense: ce }, imported: { income: m.income, expense: m.expense }, import_ids: ids.slice() };
  doc.updated_at = nowIso;
  return { ok: true, doc, record: doc.verified[month] };
}
// What the UI shows: last successful import, coverage, month totals (net = income − expense; refunds, transfers and unclassified are shown separately and never folded in). No month with no data is invented.
export function statusView(doc, now = Date.now()) {
  if (!doc || !doc.imports.length) return { has_data: false, last_import: null, months: [], imports: [], verified_months: [] };
  const byId = Object.fromEntries(doc.imports.map((p) => [p.id, p]));
  const months = Object.keys(doc.months).sort().map((m) => { const t = doc.months[m], v = (doc.verified || {})[m] || null;
    const mi = (t.imports || []).map((id) => byId[id]).filter(Boolean); const latest = mi.map((p) => p.imported_at).filter(Boolean).sort().pop() || null; const age = latest ? (now - new Date(latest).getTime()) / 86400000 : null;
    return { month: m, income: t.income, expense: t.expense, net: t.income - t.expense, refund: t.refund, transfer_excluded: t.transfer, unclassified_in: t.unclassified_in, unclassified_out: t.unclassified_out, rows: t.count,
      verification: v ? 'verified' : 'pending', verified_at: v ? v.verified_at : null, compared: v ? v.compared : null, sources: [...new Set(mi.map((p) => p.source))], imported_at: latest, freshness: age == null ? 'unknown' : (age <= FRESH_DAYS ? 'fresh' : 'stale'),
      partial_note: doc.imports.length > 1 && t.imports.length > 1 ? 'built from several overlapping imports' : null, top_categories: Object.entries(t.by_category).sort((a, b) => b[1] - a[1]).slice(0, 5) }; });
  return { has_data: true, last_import: doc.imports[0], first_month: months[0].month, last_month: months[months.length - 1].month, months, imports: doc.imports.slice(0, 20), verified_months: months.filter((x) => x.verification === 'verified').map((x) => x.month) };
}
