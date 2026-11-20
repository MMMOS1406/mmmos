// Finance V2 phase 3A — import foundation (pure library). SYNTHETIC data only, generated at run time (no real figures, names or ids). node tests/finance/test_fin_import.mjs
import * as I from '../../lib/finImport.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 400) : ''); } };
const NOW = Date.parse('2031-06-15T12:00:00Z');
const AD = { fixture_csv: I.FIXTURE_ADAPTER, rocket_money: I.ROCKET_MONEY };
const H = 'Date,Description,Category,Amount,Account,Pending';
const csv = (rows, head = H) => [head, ...rows].join('\n') + '\n';
const run = (content, doc = null, adapterId = 'fixture_csv') => I.analyzeImport({ content, adapterId, doc, adapters: AD, now: NOW });
const codes = (r) => r.blocking.map((b) => b.code);
const commit = (doc, r, id = 'imp1') => I.mergeImport(doc, r, { nowIso: '2031-06-15T12:00:00Z', id });
// Unique synthetic merchant strings that must NEVER appear in a stored document
const M1 = 'Zorblax Synthetic Mart', M2 = 'Quuxville Fuel Depot', M3 = 'Plugh Payroll Unit';
const base = [`2031-05-02,${M1},Groceries,-40.25,Chk,false`, `2031-05-03,${M2},Gas,-30.00,Chk,false`, `2031-05-05,${M3},Paycheck,2500.00,Chk,false`, `2031-05-06,Move to savings,Transfer,-400.00,Chk,false`, `2031-05-06,Move from checking,Transfer,400.00,Sav,false`];

// ── adapter honesty
{ const r = run(csv(base), null, 'rocket_money'); ok('Rocket Money is UNMAPPED: nothing is parsed, the refusal asks for a real sample, no mapping is guessed', !r.ok && codes(r).join() === 'adapter_unmapped' && r.counts.data_rows === 0 && r.adapter.status === 'unmapped'); }
ok('unknown adapter refused', codes(run(csv(base), null, 'nope')).join() === 'unknown_adapter');
ok('the production registry (ADAPTERS) contains NO fixture adapter and Rocket Money is unmapped', !I.ADAPTERS.fixture_csv && I.ADAPTERS.rocket_money.status === 'unmapped' && !I.ADAPTERS.rocket_money.columns);

// ── parse + validate
{ const r = run(csv(base)); ok('well-formed file accepted', r.ok && r.counts.accepted === 5 && r.counts.rejected === 0, r.blocking); }
ok('BOM and CRLF are handled', run('﻿' + csv(base).replace(/\n/g, '\r\n')).ok);
ok('quoted fields with commas, doubled quotes and embedded newlines parse as ONE row', (() => { const p = I.parseCsv('a,b\n"x, ""y""\nz",2\n'); return p.ok && p.rows.length === 2 && p.rows[1][0] === 'x, "y"\nz' && p.rows[1][1] === '2'; })());
ok('unterminated quote refused', codes(run('Date,Amount\n2031-05-01,"5\n', null)).includes('unterminated_quote') || !run('Date,Amount\n2031-05-01,"5\n').ok);
ok('empty file refused', codes(run('')).includes('empty_file'));
ok('header only refused', codes(run(H + '\n')).includes('header_only'));
ok('binary (NUL) refused', codes(run(csv(base) + '\u0000')).includes('binary_content'));
ok('zip/xlsx magic refused', codes(run('PK\u0003\u0004abc')).includes('not_csv_archive'));
ok('HTML refused', codes(run('<html><body>x</body></html>')).includes('not_csv_markup_or_json'));
ok('JSON refused', codes(run('{"a":1}')).includes('not_csv_markup_or_json') && codes(run('[1,2]')).includes('not_csv_markup_or_json'));
ok('invalid UTF-8 (replacement character) refused', codes(run(csv(base) + '�')).includes('bad_encoding'));
ok('control characters refused', codes(run(csv(base) + '\u0007')).includes('control_characters'));
ok('oversize file refused before parsing', codes(run('x'.repeat(I.LIMITS.maxBytes + 10))).includes('too_large'));
{ const many = Array.from({ length: I.LIMITS.maxRows + 1 }, (_, i) => `2031-05-01,M${i},Cat,-1.00,Chk,false`); ok('too many rows refused', codes(run(csv(many))).includes('too_many_rows')); }
ok('missing required column is named, no guessing', (() => { const r = run('When,Description,Category,Value\n2031-05-01,x,y,1\n'); return codes(r).join() === 'missing_columns' && r.blocking[0].missing.join() === 'date,amount'; })());
{ const r = run(csv([...base, '2031-05-07,short row', `2031-05-08,${M1},Groceries,abc,Chk,false`, `2031-05-09,${M1},Groceries,,Chk,false`, `2031-13-09,${M1},Groceries,-1.00,Chk,false`, `,${M1},Groceries,-1.00,Chk,false`, `2031-05-10,${M1},Groceries,-1.005,Chk,false`]));
  ok('malformed rows are rejected by reason with LINE NUMBERS ONLY (no cell content)', r.counts.rejected === 6 && r.rejected.ragged_row.lines[0] === 7 && r.rejected.bad_amount.count === 2 && r.rejected.missing_amount.count === 1 && r.rejected.bad_date.count === 1 && r.rejected.missing_date.count === 1 && !JSON.stringify(r.rejected).includes('Zorblax'), r.rejected); }
{ const bad = Array.from({ length: 10 }, (_, i) => `x${i}`); const r = run(csv([...base, ...bad])); ok('a file that is mostly garbage is refused as a whole (too many rejected rows)', codes(r).includes('too_many_rejected')); }
ok('future-dated rows are rejected (not silently accepted)', run(csv([...base, `2031-09-01,${M1},Groceries,-1.00,Chk,false`])).rejected.future_date.count === 1);
ok('a date before 2000 is rejected', run(csv([...base, `1999-05-01,${M1},Groceries,-1.00,Chk,false`])).rejected.bad_date.count === 1);
ok('a cell longer than the cap is rejected', run(csv([...base, `2031-05-01,${'x'.repeat(600)},Groceries,-1.00,Chk,false`])).rejected.cell_too_long.count === 1);
ok('pending rows are skipped (counted, never totalled)', (() => { const r = run(csv([...base, `2031-05-09,${M1},Groceries,-99.00,Chk,true`])); return r.ok && r.counts.pending_skipped === 1 && r.months['2031-05'].expense === 7025; })());
ok('amount formats: $1,234.50  (12.00)  -$3.10  +5 parse to exact cents; the large inflow has no income evidence so it stays unclassified', (() => { const r = run(csv(['2031-05-01,A,Cat,"$1,234.50",Chk,false', '2031-05-01,B,Cat,(12.00),Chk,false', '2031-05-01,C,Cat,-$3.10,Chk,false', '2031-05-01,D,Income,+5,Chk,false'])); const m = r.months['2031-05']; return r.ok && r.counts.accepted === 4 && m.income === 500 && m.expense === 1510 && m.unclassified_in === 123450; })());

// ── classification (conservative)
{ const r = run(csv(base)); const m = r.months['2031-05'];
  ok('income only with category evidence; expenses with a category; transfers excluded from both', m.income === 250000 && m.expense === 4025 + 3000 && m.transfer === 80000 && r.classification.transfer === 2 && r.classification.income === 1 && r.classification.expense === 2, m); }
{ const r = run(csv(['2031-05-02,Mystery,,-50.00,Chk,false', '2031-05-03,Someone,,200.00,Chk,false'])); const m = r.months['2031-05'];
  ok('an inflow with NO income evidence is "unclassified", not income; an outflow with no category is unclassified, not expense', m.income === 0 && m.expense === 0 && m.unclassified_in === 20000 && m.unclassified_out === 5000 && r.classification.unclassified === 2 && r.warnings.some((w) => w.code === 'unclassified_rows_excluded')); }
{ const r = run(csv(['2031-05-02,Same Store,Shopping,-80.00,Chk,false', '2031-05-20,Same Store,Shopping,30.00,Chk,false'])); const m = r.months['2031-05'];
  ok('a refund is recognised only against an EARLIER outflow at the same merchant; it is reported as refund, never income', m.refund === 3000 && m.income === 0 && r.classification.refund === 1 && r.evidence.refund_matches_earlier_purchase === 1); }
{ const r = run(csv(['2031-05-20,Same Store,Shopping,30.00,Chk,false'])); ok('an inflow with no earlier matching purchase is NOT a refund (unclassified)', r.months['2031-05'].refund === 0 && r.months['2031-05'].unclassified_in === 3000); }
{ const r = run(csv(['2031-05-02,Same Store,Shopping,-20.00,Chk,false', '2031-05-20,Same Store,Shopping,30.00,Chk,false'])); ok('a "refund" larger than the earlier purchase is not accepted as a refund', r.months['2031-05'].refund === 0 && r.months['2031-05'].unclassified_in === 3000); }
{ const r = run(csv(['2031-01-02,Same Store,Shopping,-80.00,Chk,false', '2031-05-20,Same Store,Shopping,30.00,Chk,false'])); ok('a refund more than 90 days after the purchase is not matched', r.classification.refund === 0); }
{ const r = run(csv(['2031-05-02,Xfer out,,-300.00,Chk,false', '2031-05-04,Xfer in,,300.00,Sav,false', '2031-05-05,Other,,-300.00,Ext,false'])); const m = r.months['2031-05'];
  ok('equal-and-opposite uncategorised legs across two OWNED accounts (within 3 days) are a transfer by pairing evidence and are excluded from income/expense', r.evidence.paired_between_owned_accounts === 2 && m.transfer === 60000 && m.unclassified_in === 0 && m.income === 0 && m.expense === 0 && m.unclassified_out === 30000, m); }
{ const r = run(csv(['2031-05-02,Xfer out,,-300.00,Chk,false', '2031-05-12,Xfer in,,300.00,Sav,false'])); ok('the same pair more than 3 days apart is NOT paired (stays unclassified)', r.classification.transfer === 0 && r.classification.unclassified === 2); }
{ const r = run(csv(['2031-05-02,Out,,-300.00,Chk,false', '2031-05-03,In,,300.00,Chk,false'])); ok('equal-and-opposite within the SAME account is not a transfer', r.classification.transfer === 0); }
{ const r = run(csv(['2031-05-02,Groceries run,Groceries,-300.00,Chk,false', '2031-05-03,Other,Paycheck,300.00,Sav,false'])); ok('rows with their own category evidence are never re-labelled as a transfer by pairing', r.classification.transfer === 0 && r.classification.expense === 1 && r.classification.income === 1); }
ok('a transfer-category row is never income or expense even when positive/negative', (() => { const r = run(csv(['2031-05-02,x,Transfer,500.00,Chk,false', '2031-05-02,y,Transfer,-500.00,Chk,false'])); const m = r.months['2031-05']; return m.income === 0 && m.expense === 0 && m.transfer === 100000; })());
ok('category matching is case-insensitive, income category on a NEGATIVE amount is not income', (() => { const r = run(csv(['2031-05-02,x,PAYCHECK,100.00,Chk,false', '2031-05-02,y,Paycheck,-100.00,Chk,false'])); return r.months['2031-05'].income === 10000 && r.classification.expense === 1; })());
ok('months with no rows are ABSENT (unavailable), never zero', (() => { const r = run(csv(['2031-03-02,x,Cat,-1.00,Chk,false', '2031-05-02,x,Cat,-1.00,Chk,false'])); return Object.keys(r.months).join() === '2031-03,2031-05'; })());
ok('no-category-column file: nothing is classified as income/expense', (() => { const a = { ...I.FIXTURE_ADAPTER, columns: { date: ['Date'], amount: ['Amount'] } }; const r = I.analyzeImport({ content: 'Date,Amount\n2031-05-01,-5.00\n2031-05-02,9.00\n', adapterId: 'x', adapters: { x: a }, now: NOW }); return r.ok && r.classification.unclassified === 2 && r.months['2031-05'].income === 0 && r.months['2031-05'].expense === 0; })());
ok('positive_is_outflow adapters invert the sign', (() => { const a = { ...I.FIXTURE_ADAPTER, amountConvention: 'positive_is_outflow' }; const r = I.analyzeImport({ content: csv(['2031-05-01,x,Groceries,10.00,Chk,false']), adapterId: 'x', adapters: { x: a }, now: NOW }); return r.months['2031-05'].expense === 1000; })());

// ── formula injection / text hygiene
{ const evil = ['2031-05-01,=HYPERLINK("http://x"),Groceries,-1.00,Chk,false', '2031-05-01,@SUM(A1),=cmd|calc,-2.00,Chk,false', '2031-05-01,+1+1,Groceries,-3.00,Chk,false', '2031-05-01,-2+3,Groceries,-4.00,Chk,false'];
  const r = run(csv(evil)); const d = commit(null, r);
  ok('formula-like cells are COUNTED and the stored categories can never start with = + - @ or contain control characters', r.formula_like_cells >= 4 && Object.values(d.months).every((m) => Object.keys(m.by_category).every((c) => !/^[=+\-@\t\r|]/.test(c) && !/[\u0000-\u001F]/.test(c))) && r.warnings.some((w) => w.code === 'formula_like_cells_neutralized')); }
ok('sanitizeLabel strips leading formula characters, control chars and caps length', I.sanitizeLabel('=SUM(A1)') === 'SUM(A1)' && I.sanitizeLabel('\t@x\n') === 'x' && I.sanitizeLabel('a'.repeat(100)).length === 40 && I.sanitizeLabel(null) === '');
ok('isFormulaLike: =,+,@,tab flagged; negative numbers are not', I.isFormulaLike('=1+1') && I.isFormulaLike('@a') && I.isFormulaLike('+cmd') && !I.isFormulaLike('-12.50') && !I.isFormulaLike('Groceries'));

// ── provenance, fingerprints, duplicates, overlap
{ const r = run(csv(base)); const d = commit(null, r);
  ok('provenance recorded: source, version, timestamp, period, row counts, file + rows fingerprints', d.imports.length === 1 && d.imports[0].source === 'fixture_csv' && d.imports[0].adapter_version === 1 && d.imports[0].imported_at && d.imports[0].period.from === '2031-05-02' && d.imports[0].period.to === '2031-05-06' && d.imports[0].rows_accepted === 5 && /^[0-9a-f]{16}$/.test(d.imports[0].file_sha256_16) && /^[0-9a-f]{16}$/.test(d.imports[0].rows_fingerprint)); }
{ const r1 = run(csv(base)); const d = commit(null, r1); const r2 = run(csv(base), d);
  ok('re-uploading the SAME file is blocked (same_file_already_imported) and nothing would be merged', !r2.ok && codes(r2).includes('same_file_already_imported')); }
{ const r1 = run(csv(base)); const d = commit(null, r1); const r2 = run(csv([...base].reverse()), d);
  ok('the same rows in a different order / re-exported file are still recognised (rows fingerprint) and blocked', !r2.ok && (codes(r2).includes('same_file_already_imported') || codes(r2).includes('no_new_rows'))); }
{ const d = commit(null, run(csv(base))); const r2 = run(csv([...base, `2031-05-09,${M1},Groceries,-12.00,Chk,false`]), d);
  ok('a LATER overlapping export: only the NEW row is counted, existing rows are not double counted, overlap is reported', r2.ok && r2.counts.new_rows === 1 && r2.counts.already_imported === 5 && r2.overlap.kind === 'partial_overlap' && r2.months['2031-05'].expense === 1200 && r2.months['2031-05'].income === 0);
  const d2 = commit(d, r2, 'imp2');
  ok('after merging the overlap the month totals equal the union exactly once', d2.months['2031-05'].expense === 4025 + 3000 + 1200 && d2.months['2031-05'].income === 250000 && d2.months['2031-05'].transfer === 80000 && d2.imports.length === 2); }
{ const d = commit(null, run(csv(base))); const sub = run(csv(base.slice(0, 3)), d);
  ok('a file whose rows are all already imported (a subset) is blocked as no_new_rows', !sub.ok && codes(sub).includes('no_new_rows') && sub.overlap.kind === 'exact_duplicate_rows'); }
{ const two = [`2031-05-02,${M1},Groceries,-9.99,Chk,false`, `2031-05-02,${M1},Groceries,-9.99,Chk,false`]; const r = run(csv(two)); const d = commit(null, r);
  ok('two genuinely identical purchases in one file are BOTH kept (occurrence index)', r.counts.accepted === 2 && r.counts.identical_within_file === 1 && d.months['2031-05'].expense === 1998 && d.rows['2031-05'].length === 2);
  const again = run(csv([...two, `2031-05-02,${M1},Groceries,-9.99,Chk,false`]), d);
  ok('a later export containing a THIRD identical purchase adds exactly one', again.ok && again.counts.new_rows === 1 && again.months['2031-05'].expense === 999); }
{ const d = commit(null, run(csv(base))); const far = run(csv([`2031-02-02,${M1},Groceries,-5.00,Chk,false`]), d);
  ok('a non-overlapping period is a clean import (no overlap warning)', far.ok && far.overlap.kind === 'none' && far.warnings.every((w) => w.code !== 'overlapping_period')); }
{ const d = commit(null, run(csv(base))); const other = run(csv([`2031-05-02,${M1},Groceries,-7.00,Chk,false`, `2031-05-03,${M2},Gas,-8.00,Chk,false`]), d);
  ok('an export covering the same dates but DIFFERENT rows warns about the overlapping period and counts only the new rows', other.ok && other.overlap.kind === 'partial_overlap' && other.counts.new_rows === 2 && other.warnings.some((w) => w.code === 'overlapping_period')); }
ok('rows fingerprint is stable across runs of the same salt and changes with the salt', run(csv(base)).rows_fingerprint === run(csv(base)).rows_fingerprint && I.analyzeImport({ content: csv(base), adapterId: 'fixture_csv', adapters: AD, now: NOW, salt: 'other' }).rows_fingerprint !== run(csv(base)).rows_fingerprint);

// ── privacy of the stored document
{ const r = run(csv(base)); const d = commit(null, r); const s = JSON.stringify(d) + JSON.stringify(I.publicResult(r)) + JSON.stringify(I.statusView(d));
  ok('NO merchant name, account name or raw line is stored or returned anywhere', ![M1, M2, M3, 'Zorblax', 'Quuxville', 'Plugh', 'Move to savings', 'Chk', 'Sav', 'Description'].some((x) => s.includes(x)), s.slice(0, 300));
  ok('stored row identifiers are 12-hex salted hashes only', Object.values(d.rows).every((l) => l.every((h) => /^[0-9a-f]{12}$/.test(h))));
  ok('the document is small and entity-bound to household', JSON.stringify(d).length < 5000 && d.entity === 'household'); }
ok('mergeImport refuses a failed analysis and a foreign-entity document', (() => { let a = false, b = false; try { I.mergeImport(null, run(''), { nowIso: 'x', id: 'i' }); } catch (_) { a = true; } try { I.mergeImport({ ...I.emptyDoc('s'), entity: 'srv_farsi' }, run(csv(base)), { nowIso: 'x', id: 'i' }); } catch (_) { b = true; } return a && b; })());
ok('parseDoc rejects wrong entity / garbage and drops hostile fields', I.parseDoc('{"entity":"srv_farsi","salt":"x"}') === null && I.parseDoc('not json') === null && I.parseDoc(null) === null && (() => { const d = I.parseDoc({ entity: 'household', salt: 's', imports: [{ id: 'a', period: { from: 'a', to: 'b' }, file_sha256_16: 'x' }, { nope: 1 }], months: { '2031-05': { income: 'zz', by_category: { '=EVIL': 5 } }, bad: {} }, rows: { '2031-05': ['abcdef012345', '<script>'] } }); return d.imports.length === 1 && d.months['2031-05'].income === 0 && !Object.keys(d.months['2031-05'].by_category).some((c) => c.startsWith('=')) && !d.months.bad && d.rows['2031-05'].length === 1; })());

// ── bounds
{ let doc = null; for (let i = 0; i < 70; i++) { const m = String(((i % 12) + 1)).padStart(2, '0'); const y = 2020 + Math.floor(i / 12); const r = I.analyzeImport({ content: csv([`${y}-${m}-05,x${i},Cat,-${i + 1}.00,Chk,false`]), adapterId: 'fixture_csv', doc, adapters: AD, now: NOW }); if (!r.ok) break; doc = I.mergeImport(doc || I.emptyDoc('s'), r, { nowIso: '2031-06-15T00:00:00Z', id: 'i' + i }); }
  ok('totals are bounded to 60 months', Object.keys(doc.months).length <= I.LIMITS.maxMonths, Object.keys(doc.months).length); }
ok('imports history is bounded (120)', (() => { let d = null; for (let i = 0; i < 130; i++) { const r = I.analyzeImport({ content: csv([`2031-05-0${(i % 9) + 1},u${i},Cat,-${i + 1}.00,Chk,false`]), adapterId: 'fixture_csv', doc: d, adapters: AD, now: NOW }); if (!r.ok) continue; d = I.mergeImport(d || I.emptyDoc('s'), r, { nowIso: 'x', id: 'i' + i }); } return d.imports.length <= 120; })());

// ── status view
ok('status view: no data → has_data false, nothing invented', (() => { const v = I.statusView(null); return v.has_data === false && v.months.length === 0 && v.last_import === null; })());
{ const d = commit(null, run(csv(base))); const v = I.statusView(d);
  ok('status view: last import, coverage, net = income − expense, transfers and unclassified shown separately', v.has_data && v.last_import.id === 'imp1' && v.first_month === '2031-05' && v.months[0].net === 250000 - 7025 && v.months[0].transfer_excluded === 80000 && v.months[0].unclassified_in === 0); }
// ── CEO verification of an imported month (phase 3B correction)
const C = I.VERIFY_CONFIRMATION;
const base0 = () => commit(null, run(csv(base)));
const vm = (d, cmp, over = {}) => I.verifyMonth(d, '2031-05', cmp, { nowIso: '2031-06-16T09:00:00Z', adapters: AD, confirmation: C, ...over });
{ const d = base0(); const r = vm(d, { income: 250000, expense: 7025 });
  ok('VERIFY: exact comparison with the app\'s figures verifies the month and records who/when, the compared and imported figures and the contributing import ids', r.ok && r.doc.verified['2031-05'].by === 'ceo' && r.doc.verified['2031-05'].verified_at === '2031-06-16T09:00:00Z' && r.doc.verified['2031-05'].compared.income === 250000 && r.doc.verified['2031-05'].imported.expense === 7025 && r.doc.verified['2031-05'].import_ids.join() === 'imp1');
  ok('VERIFY: totals, provenance, row hashes and import records are untouched by verification', JSON.stringify({ ...r.doc, verified: 0, updated_at: 0 }) === JSON.stringify({ ...d, verified: 0, updated_at: 0 }));
  ok('VERIFY: a difference of $1.00 or less (app rounding) is accepted; $1.01 is a mismatch that reports the difference and verifies nothing', vm(d, { income: 250100, expense: 6925 }).ok && (() => { const m = vm(d, { income: 250101, expense: 7025 }); return !m.ok && m.error === 'mismatch' && m.difference.income === 101 && m.difference.expense === 0 && m.tolerance_cents === 100; })());
  ok('VERIFY: without the exact typed confirmation nothing is verified', ['', 'yes', 'verify-import-against-app', undefined, true].every((c) => { const x = vm(d, { income: 250000, expense: 7025 }, { confirmation: c }); return !x.ok && x.error === 'confirmation_required'; }));
  ok('VERIFY: unknown month, missing / negative / fractional / non-numeric / infinite figures are refused', I.verifyMonth(d, '2031-09', { income: 1, expense: 1 }, { nowIso: 'x', adapters: AD, confirmation: C }).error === 'unknown_month' && [{}, { income: -1, expense: 1 }, { income: 1.5, expense: 1 }, { income: '2500', expense: 1 }, { income: Infinity, expense: 1 }, { income: NaN, expense: 1 }, null].every((c) => vm(d, c).error === 'bad_figures'));
  ok('VERIFY: a month built from a source that is not verifiable (no adapter flag) cannot be verified', vm(d, { income: 250000, expense: 7025 }, { adapters: { fixture_csv: { ...I.FIXTURE_ADAPTER, verifiable: false } } }).error === 'source_not_verifiable' && vm(d, { income: 250000, expense: 7025 }, { adapters: {} }).error === 'source_not_verifiable');
  ok('VERIFY: no import summary / foreign entity refused', I.verifyMonth(null, '2031-05', { income: 1, expense: 1 }, { nowIso: 'x', adapters: AD, confirmation: C }).error === 'no_import_summary' && I.verifyMonth({ ...d, entity: 'srv_farsi' }, '2031-05', { income: 250000, expense: 7025 }, { nowIso: 'x', adapters: AD, confirmation: C }).error === 'no_import_summary'); }
{ const d = base0(); const v = vm(d, { income: 250000, expense: 7025 }).doc;
  const r2 = run(csv([...base, `2031-05-09,${M1},Groceries,-12.00,Chk,false`, `2031-04-09,${M1},Groceries,-5.00,Chk,false`]), v); const d2 = commit(v, r2, 'imp2');
  ok('VERIFY: a later import that adds rows to a verified month RESETS that month to pending (its totals changed) and records which month was reset', !d2.verified['2031-05'] && d2.imports[0].verification_reset.join() === '2031-05' && I.statusView(d2).months.find((m) => m.month === '2031-05').verification === 'pending');
  const d3 = commit(v, run(csv([`2031-03-09,${M1},Groceries,-5.00,Chk,false`]), v), 'imp3'); ok('VERIFY: an import that touches only OTHER months leaves the verified month verified', !!d3.verified['2031-05'] && !d3.imports[0].verification_reset); }
{ const d = base0(); const v = vm(d, { income: 250000, expense: 7025 }).doc; const sv = I.statusView(v, Date.parse('2031-06-20T00:00:00Z')); const m = sv.months[0];
  ok('STATUS: verified month reports verification, date, sources, import date and freshness (fresh); other months stay pending; verified_months lists it', m.verification === 'verified' && m.verified_at === '2031-06-16T09:00:00Z' && m.sources.join() === 'fixture_csv' && m.imported_at === '2031-06-15T12:00:00Z' && m.freshness === 'fresh' && sv.verified_months.join() === '2031-05');
  ok('STATUS: the same month is STALE once the import is older than 35 days (verification itself is kept)', I.statusView(v, Date.parse('2031-08-01T00:00:00Z')).months[0].freshness === 'stale' && I.statusView(v, Date.parse('2031-08-01T00:00:00Z')).months[0].verification === 'verified');
  ok('STATUS: an unverified month is "pending", never "verified"', I.statusView(d).months[0].verification === 'pending' && I.statusView(d).verified_months.length === 0);
  const rt = I.parseDoc(JSON.stringify(v)); ok('parseDoc keeps a valid verification record and drops hostile or malformed ones', !!rt.verified['2031-05'] && Object.keys(I.parseDoc({ entity: 'household', salt: 's', imports: [], months: {}, rows: {}, verified: { 'bad': { verified_at: 'x', compared: { income: 1, expense: 1 }, imported: { income: 1, expense: 1 } }, '2031-05': { verified_at: 5 }, '2031-06': { verified_at: 'x', compared: { income: 'zz', expense: 1 }, imported: { income: 1, expense: 1 }, by: 'attacker' } } }).verified).join() === '2031-06' && I.parseDoc({ entity: 'household', salt: 's', verified: { '2031-06': { verified_at: 'x', compared: { income: 1, expense: 1 }, imported: { income: 1, expense: 1 }, by: 'attacker' } } }).verified['2031-06'].by === 'ceo'); }
// ── MUTATION CHECKS: each deliberate defect in the library must be caught by a probe
import fs from 'node:fs';
const LIB = fs.readFileSync(new URL('../../lib/finImport.mjs', import.meta.url), 'utf8').replace("from './finDedupe.mjs'", `from '${new URL('../../lib/finDedupe.mjs', import.meta.url).href}'`);
const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const mutate = async (name, from, to, probe) => { const src = LIB.replace(from, to); if (src === LIB) { ok('mutation anchor present: ' + name, false); return; } let M; try { M = await load(src); } catch (e) { ok('mutation loads: ' + name, false, String(e)); return; } const good = await probe(M).catch(() => false); ok('MUTATION caught — ' + name, good === false); };
const runM = (M, content, doc = null) => M.analyzeImport({ content, adapterId: 'fixture_csv', doc, adapters: { fixture_csv: M.FIXTURE_ADAPTER }, now: NOW });
await mutate('inflow without income evidence counted as income', "else if (x.cents > 0) {\n      const src", "else if (x.cents > 0 && !cat) { x.kind = 'income'; } else if (x.cents > 0) {\n      const src", async (M) => { const r = runM(M, csv(['2031-05-03,Someone,,200.00,Chk,false'])); return r.months['2031-05'].income === 0; });
await mutate('transfer category treated as expense', "if (cat && transferCats.has(cat)) { x.kind = 'transfer'; bump('category_transfer'); }", "if (false) { }", async (M) => { const r = runM(M, csv(['2031-05-02,x,Transfer,-500.00,Chk,false'])); return r.months['2031-05'].expense === 0; });
await mutate('duplicate rows no longer detected (existing set ignored)', "const fresh = rows.filter((x) => !existing.has(x.hash));", "const fresh = rows.slice();", async (M) => { const r1 = runM(M, csv(base)); const d = M.mergeImport(null, r1, { nowIso: 'x', id: 'a' }); const r2 = runM(M, csv([...base, `2031-05-09,${M1},Groceries,-12.00,Chk,false`]), d); return r2.counts.new_rows === 1; });
await mutate('no_new_rows (all rows already imported) check removed', "else if (!fresh.length) {", "else if (false) {", async (M) => { const r1 = runM(M, csv(base)); const d = M.mergeImport(null, r1, { nowIso: 'x', id: 'a' }); const r2 = runM(M, csv(base.slice(0, 3)), d); return r2.blocking.length > 0; });
await mutate('formula characters kept in stored labels', "replace(/^[\\s=+\\-@|]+/, '')", "replace(/^[\\s]+/, '')", async (M) => !M.sanitizeLabel('=SUM(A1)').startsWith('='));
await mutate('refund accepted without a matching purchase', "if (src) { x.kind = 'refund'", "if (true) { x.kind = 'refund'", async (M) => { const r = runM(M, csv(['2031-05-20,Same Store,Shopping,30.00,Chk,false'])); return r.months['2031-05'].refund === 0; });
await mutate('pairing allowed to re-label rows that already have category evidence', "c.kind === 'unclassified'", "true", async (M) => { const r = runM(M, csv(['2031-05-02,Groceries run,Groceries,-300.00,Chk,false', '2031-05-03,Other,Paycheck,300.00,Sav,false'])); return r.classification.transfer === 0; });
await mutate('future-dated rows accepted', "if (now && dayNum(d.iso) > nowDay + 1) { rej('future_date', line); continue; }", "", async (M) => runM(M, csv([...base, `2031-09-01,${M1},Groceries,-1.00,Chk,false`])).counts.rejected === 1);
await mutate('pending rows totalled', "if (pend) { out.counts.pending_skipped++; continue; }", "", async (M) => { const r = runM(M, csv([...base, `2031-05-09,${M1},Groceries,-99.00,Chk,true`])); return r.months['2031-05'].expense === 7025; });
await mutate('Rocket Money unmapped guard removed', "if (spec.status === 'unmapped') { block('adapter_unmapped', { note: spec.note }); return out; }", "", async (M) => { const r = M.analyzeImport({ content: csv(base), adapterId: 'rocket_money', adapters: M.ADAPTERS, now: NOW }); return r.blocking.length > 0 && r.counts.data_rows === 0; });
await mutate('merchant name leaked into stored month totals', "t.by_category[x.category] = (t.by_category[x.category] || 0) + -x.cents;", "t.by_category[x.merchant] = (t.by_category[x.merchant] || 0) + -x.cents;", async (M) => { const r = runM(M, csv(base)); const d = M.mergeImport(null, r, { nowIso: 'x', id: 'a' }); return !JSON.stringify(d).includes('zorblax'); });
await mutate('missing month zero-filled instead of absent', "const m = x.date.slice(0, 7); const t = out.months[m] ||", "for (const mm of ['2031-04']) out.months[mm] = out.months[mm] || { income: 0, expense: 0, refund: 0, transfer: 0, unclassified_in: 0, unclassified_out: 0, count: 0, by_category: {} }; const m = x.date.slice(0, 7); const t = out.months[m] ||", async (M) => Object.keys(runM(M, csv(['2031-05-02,x,Cat,-1.00,Chk,false'])).months).join() === '2031-05');

await mutate('verification tolerance removed (anything verifies)', "if (Math.abs(di) > TOLERANCE_CENTS || Math.abs(de) > TOLERANCE_CENTS) return", "if (false) return", async (M) => { const d = M.mergeImport(null, runM(M, csv(base)), { nowIso: 'x', id: 'a' }); return !M.verifyMonth(d, '2031-05', { income: 999999, expense: 1 }, { nowIso: 'x', adapters: { fixture_csv: M.FIXTURE_ADAPTER }, confirmation: M.VERIFY_CONFIRMATION }).ok; });
await mutate('typed confirmation not required', "if (confirmation !== VERIFY_CONFIRMATION) return { ok: false, error: 'confirmation_required' };", "", async (M) => { const d = M.mergeImport(null, runM(M, csv(base)), { nowIso: 'x', id: 'a' }); return !M.verifyMonth(d, '2031-05', { income: 250000, expense: 7025 }, { nowIso: 'x', adapters: { fixture_csv: M.FIXTURE_ADAPTER } }).ok; });
await mutate('non-verifiable sources can be verified', "|| !(adapters[x] && adapters[x].verifiable)", "", async (M) => { const d = M.mergeImport(null, runM(M, csv(base)), { nowIso: 'x', id: 'a' }); return !M.verifyMonth(d, '2031-05', { income: 250000, expense: 7025 }, { nowIso: 'x', adapters: {}, confirmation: M.VERIFY_CONFIRMATION }).ok; });
await mutate('new rows no longer reset a verified month', "if (doc.verified[m]) { delete doc.verified[m]; reset.push(m); }", "", async (M) => { const d = M.mergeImport(null, runM(M, csv(base)), { nowIso: 'x', id: 'a' }); const v = M.verifyMonth(d, '2031-05', { income: 250000, expense: 7025 }, { nowIso: 'x', adapters: { fixture_csv: M.FIXTURE_ADAPTER }, confirmation: M.VERIFY_CONFIRMATION }).doc; const r2 = runM(M, csv([...base, `2031-05-09,${M1},Groceries,-12.00,Chk,false`]), v); const d2 = M.mergeImport(v, r2, { nowIso: 'x', id: 'b' }); return !d2.verified['2031-05']; });
await mutate('stale imports reported as fresh', "freshness: age == null ? 'unknown' : (age <= FRESH_DAYS ? 'fresh' : 'stale')", "freshness: 'fresh'", async (M) => { const d = M.mergeImport(null, runM(M, csv(base)), { nowIso: '2031-06-15T12:00:00Z', id: 'a' }); return M.statusView(d, Date.parse('2032-01-01')).months[0].freshness === 'stale'; });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
