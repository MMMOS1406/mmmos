#!/usr/bin/env node
// Finance V2 phase 3C — SHAPE-ONLY inspector for a real, REDACTED Rocket Money export (run LOCALLY by the engineer, read-only, nothing is written or sent anywhere).
// It prints what is needed to write the adapter mapping from evidence instead of guessing: the header names, the header fingerprint (adapter evidence), per-column date / amount conventions and sign
// distribution, and — only for low-cardinality text columns (likely categories) — the distinct labels. High-cardinality text (merchants, names, notes) is NEVER echoed.
//   node tools/finance/inspect_rm_sample.mjs <redacted-export.csv>
import fs from 'node:fs';
import { parseCsv, headerFingerprint, checkRawContent, LIMITS } from '../../lib/finImport.mjs';
export function inspect(content) {
  const raw = checkRawContent(content); if (raw.length) return { ok: false, refused: raw.map((e) => e.code) };
  const p = parseCsv(content); if (!p.ok || p.rows.length < 2) return { ok: false, refused: [p.error || 'too_few_rows'] };
  const header = p.rows[0].map((h) => String(h).trim()); const body = p.rows.slice(1, LIMITS.maxRows + 1);
  const cols = header.map((name, i) => {
    const vals = body.map((r) => (r[i] === undefined ? '' : String(r[i]).trim())); const nonEmpty = vals.filter((v) => v !== '');
    const c = { index: i, name, rows: vals.length, empty: vals.length - nonEmpty.length, max_len: nonEmpty.reduce((a, v) => Math.max(a, v.length), 0) };
    const iso = nonEmpty.filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)).length, us = nonEmpty.filter((v) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)).length;
    if (nonEmpty.length && (iso + us) / nonEmpty.length > 0.9) { c.type = 'date'; c.date_formats = { 'YYYY-MM-DD': iso, 'M/D/YYYY (day-first vs month-first must be confirmed from a day > 12)': us }; if (us) { const first = nonEmpty.filter((v) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)).map((v) => v.split('/').map(Number)); c.slash_dates = { first_part_over_12: first.filter((x) => x[0] > 12).length, second_part_over_12: first.filter((x) => x[1] > 12).length }; } }
    else {
      const num = nonEmpty.filter((v) => /^[-+]?\(?\$?-?[\d,]+(\.\d{1,2})?\)?$/.test(v)).length;
      if (nonEmpty.length && num / nonEmpty.length > 0.9) { c.type = 'amount'; const n = nonEmpty.map((v) => { const neg = /^\(.*\)$/.test(v) || /^-/.test(v) || /^-\$|^\$-/.test(v); const x = parseFloat(v.replace(/[^\d.]/g, '')); return neg ? -x : x; }); c.sign = { negative: n.filter((x) => x < 0).length, positive: n.filter((x) => x > 0).length, zero: n.filter((x) => x === 0).length }; c.formats = { dollar_sign: nonEmpty.filter((v) => v.includes('$')).length, parentheses: nonEmpty.filter((v) => /^\(/.test(v)).length, thousands_comma: nonEmpty.filter((v) => /\d,\d{3}/.test(v)).length, plus_sign: nonEmpty.filter((v) => /^\+/.test(v)).length }; }
      else {
        const distinct = new Map(); for (const v of nonEmpty) distinct.set(v, (distinct.get(v) || 0) + 1); c.type = 'text'; c.distinct = distinct.size;
        const avg = nonEmpty.length ? nonEmpty.reduce((a, v) => a + v.length, 0) / nonEmpty.length : 0;
        if (distinct.size <= 40 && avg <= 30 && nonEmpty.length >= distinct.size * 2) { c.categorical = true; c.labels = [...distinct.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`); }   // only low-cardinality, short labels (categories, booleans, account types)
        else c.categorical = false;   // high-cardinality text: values are NOT shown
      }
    }
    return c;
  });
  return { ok: true, bytes: Buffer.byteLength(content, 'utf8'), data_rows: body.length, columns: header.length, header, header_sha256: headerFingerprint(header), column_report: cols };
}
if (process.argv[1] && process.argv[1].endsWith('inspect_rm_sample.mjs')) {
  const file = process.argv[2]; if (!file) { console.error('usage: node tools/finance/inspect_rm_sample.mjs <redacted-export.csv>'); process.exit(2); }
  const r = inspect(fs.readFileSync(file, 'utf8')); console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1);
}
