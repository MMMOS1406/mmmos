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
const sha = (s) => createHash('sha256').update(s).digest('hex');
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ── adapters ──────────────────────────────────────────────────────────────────────────────
// A spec lists the header names to look for. NOTHING is guessed: if the header does not contain the required columns the file is refused.
export const ROCKET_MONEY = Object.freeze({ id: 'rocket_money', label: 'Rocket Money (transactions CSV)', status: 'unmapped', version: 0,
  note: 'Rocket Money documents a CSV export but not its columns. The mapping stays disabled until a real (redacted) header row is supplied and verified.' });
export const ADAPTERS = Object.freeze({ rocket_money: ROCKET_MONEY });
// A synthetic adapter used ONLY by tests and the UI preview fixture (never registered in production).
export const FIXTURE_ADAPTER = Object.freeze({ id: 'fixture_csv', label: 'Synthetic fixture CSV', status: 'fixture', version: 1,
  columns: { date: ['Date'], amount: ['Amount'], merchant: ['Description'], category: ['Category'], account: ['Account'], pending: ['Pending'] },
  dateFormats: ['YYYY-MM-DD'], amountConvention: 'negative_is_outflow', transferCategories: ['transfer'], incomeCategories: ['income', 'paycheck'], pendingTrueValues: ['true', 'yes', '1', 'pending'] });

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
    counts: { data_rows: 0, accepted: 0, rejected: 0, pending_skipped: 0, already_imported: 0, new_rows: 0, identical_within_file: 0 }, rejected: {}, formula_like_cells: 0,
    classification: { income: 0, expense: 0, refund: 0, transfer: 0, unclassified: 0 }, evidence: {}, months: {}, overlap: { kind: 'none', with: [] }, _newRows: [] };
  const block = (code, extra) => { out.blocking.push({ code, ...(extra || {}) }); };
  const spec = adapters[adapterId] || null;
  if (!spec) { block('unknown_adapter'); return out; }
  out.adapter = { id: spec.id, label: spec.label, status: spec.status, version: spec.version };
  if (spec.status === 'unmapped') { block('adapter_unmapped', { note: spec.note }); return out; }
  const raw = checkRawContent(content); if (raw.length) { for (const e of raw) block(e.code, e); return out; }
  out.file = { bytes: Buffer.byteLength(content, 'utf8'), sha256: sha(content) };
  const parsed = parseCsv(content); if (!parsed.ok) { block(parsed.error); return out; }
  const table = parsed.rows; if (table.length < 2) { block(table.length ? 'header_only' : 'empty_file'); return out; }
  if (table.length - 1 > LIMITS.maxRows) { block('too_many_rows', { limit: LIMITS.maxRows }); return out; }
  const header = table[0].map((h) => String(h).trim()); if (header.length > LIMITS.maxCols) { block('too_many_columns'); return out; }
  // column mapping from the spec only
  const idx = {}; const lower = header.map((h) => h.toLowerCase());
  for (const [field, names] of Object.entries(spec.columns || {})) { for (const n of names) { const i = lower.indexOf(String(n).toLowerCase()); if (i >= 0) { idx[field] = i; break; } } }
  const missing = ['date', 'amount'].filter((f) => !hasOwn(idx, f)); if (missing.length) { block('missing_columns', { missing, expected: missing.map((f) => (spec.columns[f] || []).join(' | ')) }); return out; }
  const salt = (doc && doc.salt) || newDocSalt; out._salt = salt;   // a first import creates the document with THIS salt (mergeImport) so later hashes match
  const rej = (reason, line) => { const r = out.rejected[reason] || (out.rejected[reason] = { count: 0, lines: [] }); r.count++; if (r.lines.length < LIMITS.maxLineSamples) r.lines.push(line); out.counts.rejected++; };
  const rows = []; const nowDay = Math.floor(now / 86400000);
  for (let r = 1; r < table.length; r++) {
    const line = r + 1, cells = table[r]; out.counts.data_rows++;
    if (cells.length !== header.length) { rej('ragged_row', line); continue; }
    if (cells.some((c) => c.length > LIMITS.maxCell)) { rej('cell_too_long', line); continue; }
    for (let c = 0; c < cells.length; c++) if (c !== idx.amount && isFormulaLike(cells[c])) out.formula_like_cells++;
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
  const transferCats = new Set((spec.transferCategories || []).map((x) => x.toLowerCase())), incomeCats = new Set((spec.incomeCategories || []).map((x) => x.toLowerCase()));
  const ev = out.evidence; const bump = (k) => { ev[k] = (ev[k] || 0) + 1; };
  const outflows = rows.filter((x) => x.cents < 0);
  for (const x of rows) {
    const cat = x.category.toLowerCase();
    if (cat && transferCats.has(cat)) { x.kind = 'transfer'; bump('category_transfer'); }
    else if (x.cents > 0 && cat && incomeCats.has(cat)) { x.kind = 'income'; bump('category_income'); }
    else if (x.cents > 0) {
      const src = x.merchant && !incomeCats.has(cat) ? outflows.find((o) => o.merchant === x.merchant && -o.cents >= x.cents && dayNum(o.date) <= dayNum(x.date) && dayNum(x.date) - dayNum(o.date) <= 90) : null;
      if (src) { x.kind = 'refund'; bump('refund_matches_earlier_purchase'); } else { x.kind = 'unclassified'; bump('inflow_without_evidence'); }
    } else if (x.cents < 0 && cat) { x.kind = 'expense'; bump('category_expense'); }
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
    else if (x.kind === 'refund') t.refund += x.cents; else if (x.kind === 'transfer') t.transfer += Math.abs(x.cents); else if (x.cents > 0) t.unclassified_in += x.cents; else t.unclassified_out += -x.cents;
  }
  if (out.classification.unclassified) out.warnings.push({ code: 'unclassified_rows_excluded', count: out.classification.unclassified });
  if (out.formula_like_cells) out.warnings.push({ code: 'formula_like_cells_neutralized', count: out.formula_like_cells });
  out._newRows = fresh.map((x) => ({ hash: x.hash, month: x.date.slice(0, 7) }));
  out.ok = out.blocking.length === 0; return out;
}
export const publicResult = (r) => { const { _newRows, _salt, ...rest } = r; return rest; };

// ── summary document ─────────────────────────────────────────────────────────────────────
export const emptyDoc = (salt) => ({ v: 1, entity: ENTITY, salt, updated_at: null, imports: [], months: {}, rows: {} });
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
    return d; } catch (_) { return null; }
}
// What the UI shows: last successful import, coverage, month totals (net = income − expense; refunds, transfers and unclassified are shown separately and never folded in). No month with no data is invented.
export function statusView(doc) {
  if (!doc || !doc.imports.length) return { has_data: false, last_import: null, months: [], imports: [] };
  const months = Object.keys(doc.months).sort().map((m) => { const t = doc.months[m]; return { month: m, income: t.income, expense: t.expense, net: t.income - t.expense, refund: t.refund, transfer_excluded: t.transfer, unclassified_in: t.unclassified_in, unclassified_out: t.unclassified_out, rows: t.count, partial_note: doc.imports.length > 1 && t.imports.length > 1 ? 'built from several overlapping imports' : null, top_categories: Object.entries(t.by_category).sort((a, b) => b[1] - a[1]).slice(0, 5) }; });
  return { has_data: true, last_import: doc.imports[0], first_month: months[0].month, last_month: months[months.length - 1].month, months, imports: doc.imports.slice(0, 20) };
}
