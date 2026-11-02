// Finance Pilot scope guard (Order 053). Used by every pilot suite to check a branch against origin/main.
//
// Rule: a pilot change may touch only the pilot's own folders and the two shared files. Inside the shared
// files (api/ops.js, public/index.html) EVERY changed line, whether added, edited or removed, must sit inside a
// pilot-owned top-level function (name starts with nwfp / _nwfp) in the file version it belongs to (removed
// lines: main; added lines: the branch), or be one of the known pilot hook lines (the pilot module import, a
// router line for an nwfp_ action, the card mount). Lines are located by their exact line number from the diff,
// never by searching for their text.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PILOT_DIRS = ['projects/nextwave-finance-pilot/', 'tests/projects/nextwave-finance-pilot/', 'docs/projects/nextwave-finance-pilot/'];
export const SHARED_FILES = ['api/ops.js', 'public/index.html'];
const PILOT_FN = /^_?nwfp/i;
export const HOOK_LINES = [
  /^import \* as NWFP(?:_[A-Z]+)? from '\.\.\/projects\/nextwave-finance-pilot\/lib\/[A-Za-z]+\.mjs'; \/\/ .*$/, // pilot module import (api/ops.js)
  /^ {4}if \(action === 'nwfp_[a-z_]+'\)\s+return await nwfp[A-Za-z]+\(req, res\);\s+\/\/ .*$/,                  // router line for an nwfp_ action
  /^ {6}\$\{_nwfpCardSection\(\)\}$/,                                                                          // card mount (Engineering Review)
];

// Top-level function spans: from a column-0 `function`/`async function` declaration to the line before the
// next column-0 line that is not blank and not '}' (the closing brace belongs to the function).
export function functionSpans(text) {
  const lines = text.split('\n'), spans = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(l);
    if (m) { if (cur) { cur.end = i; spans.push(cur); } cur = { name: m[1], start: i + 1, end: null }; continue; }
    if (cur && l.length && !/^\s/.test(l) && !/^\}/.test(l)) { cur.end = i; spans.push(cur); cur = null; }
  }
  if (cur) { let e = lines.length; while (e > cur.start && !lines[e - 1].trim()) e--; cur.end = e; spans.push(cur); }
  return spans;
}
const ownerAt = (spans, n) => { const s = spans.find(x => n >= x.start && n <= x.end); return s ? s.name : null; };

// Parses `git diff -U0` output for one file into removed (old line numbers) and added (new line numbers).
export function parseHunks(diffText) {
  const removed = [], added = [];
  let o = 0, n = 0;
  for (const line of diffText.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) { o = Number(h[1]); n = Number(h[2]); continue; }
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('-')) { removed.push({ n: o, text: line.slice(1) }); o++; }
    else if (line.startsWith('+')) { added.push({ n, text: line.slice(1) }); n++; }
  }
  return { removed, added };
}

// Returns the violations for one shared file.
export function sharedFileViolations(oldText, newText, diffText) {
  const { removed, added } = parseHunks(diffText);
  const oldSpans = functionSpans(oldText), newSpans = functionSpans(newText);
  const newLines = newText.split('\n');
  const isHook = (t) => HOOK_LINES.some(re => re.test(t));
  const out = [];
  for (const r of removed) {
    const owner = ownerAt(oldSpans, r.n);
    if (!(owner && PILOT_FN.test(owner)) && !isHook(r.text)) out.push(`removed/edited line ${r.n} in ${owner || 'top level'}: ${r.text.trim().slice(0, 80)}`);
  }
  for (const a of added) {
    const owner = ownerAt(newSpans, a.n);
    if ((owner && PILOT_FN.test(owner)) || isHook(a.text)) continue;
    // A blank or comment line is allowed only directly above a pilot function or hook line.
    if (/^\s*(\/\/.*)?$/.test(a.text)) {
      let k = a.n; // 1-based; newLines[k] is the next line
      while (k < newLines.length && /^\s*(\/\/.*)?$/.test(newLines[k])) k++;
      const next = k + 1, o2 = ownerAt(newSpans, next);
      if ((o2 && PILOT_FN.test(o2) && newSpans.find(s => s.start === next)) || (k < newLines.length && isHook(newLines[k]))) continue;
    }
    out.push(`added line ${a.n} in ${owner || 'top level'}: ${a.text.trim().slice(0, 80)}`);
  }
  return out;
}

// Checks the current branch (repo root) against origin/main. Returns { changed, foreignFiles, violations } or null.
export function checkBranchScope(root) {
  let changed;
  try { changed = execSync('git diff --name-only origin/main -- .', { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return null; }
  const foreignFiles = changed.filter(f => !SHARED_FILES.includes(f) && !PILOT_DIRS.some(d => f.startsWith(d)));
  const violations = [];
  for (const f of SHARED_FILES.filter(x => changed.includes(x))) {
    const oldText = execSync(`git show origin/main:${f}`, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
    const newText = readFileSync(join(root, f), 'utf8');
    const diff = execSync(`git diff -U0 origin/main -- ${f}`, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const v of sharedFileViolations(oldText, newText, diff)) violations.push(`${f}: ${v}`);
  }
  return { changed, foreignFiles, violations };
}
