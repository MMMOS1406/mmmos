// CEO-017 — proves WHICH top-level functions the AI Creation Studio removal touched, and that every other one is byte-identical to the baseline.
// Parses with acorn (a real JS parser): functions are compared by exact source text, per file.
// usage: ACORN=<dir containing node_modules/acorn> node tests/ceo017/function_diff.mjs <baselineRepo> <branchRepo> [--json out.json]
import fs from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const acorn = require(require.resolve('acorn', { paths: [process.env.ACORN || process.cwd()] }));
const [base, branch] = process.argv.slice(2, 4);
function scriptsOf(file, text) { // [{code, offset}] — whole file for .js, inline <script> blocks for .html
  if (!file.endsWith('.html')) return [{ code: text, offset: 0 }];
  const out = []; const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(text))) out.push({ code: m[1], offset: m.index + m[0].indexOf('>') + 1 }); return out; }
function functionsOf(file, text) { // module files may use export function: treat ExportNamedDeclaration.declaration too
  const out = new Map();
  for (const { code } of scriptsOf(file, text)) {
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: file.endsWith('.html') ? 'script' : 'module', allowReturnOutsideFunction: !file.endsWith('.js'), allowHashBang: true });
    const seen = new Map();
    for (const n0 of ast.body) { const n = n0.type === 'ExportNamedDeclaration' && n0.declaration ? n0.declaration : n0; if (n.type !== 'FunctionDeclaration') continue; {
      const k = (seen.get(n.id.name) || 0); seen.set(n.id.name, k + 1);
      out.set(k ? `${n.id.name}#${k + 1}` : n.id.name, code.slice(n.start, n.end)); } }
  }
  return out;
}
const report = {};
for (const file of ['public/index.html', 'api/ops.js', 'api/generate.js', 'api/youtube/detect.js', 'api/tiktok/callback.js', 'api/instagram/callback.js', 'api/reports/weekly.js']) {
  const a = functionsOf(file, fs.readFileSync(`${base}/${file}`, 'utf8')), b = functionsOf(file, fs.readFileSync(`${branch}/${file}`, 'utf8'));
  const removed = [], changed = [], added = []; let same = 0;
  for (const [n, body] of a) { if (!b.has(n)) removed.push(n); else if (b.get(n) !== body) changed.push(n); else same++; }
  for (const n of b.keys()) if (!a.has(n)) added.push(n);
  report[file] = { baselineFunctions: a.size, branchFunctions: b.size, identical: same, removed, changed, added };
}
const j = process.argv.indexOf('--json'); if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
