// node cleanup-cli.mjs <out.json> --cli-workdir <dir>   (read-only; writes the exact path list to an owner-only file and prints only aggregates)
import fs from 'node:fs'; import { makeCliQuery } from './cli-query.mjs'; import { CLEANUP_SQL, buildCleanup, setMixSourceManifest } from './cleanup-lib.mjs';
const out = process.argv[2]; const wd = process.argv[process.argv.indexOf('--cli-workdir') + 1];
const pi = process.argv.indexOf('--protect'); if (pi < 0) { console.error('REFUSED: pass --protect <manifest.json>. The manifest is a PRIVATE JSON file {"paths": [...]} listing storage objects that must never be deletable (the recovered SRV Farsi Mix sources). It is deliberately not stored in this repository. Without it the plan would list those sources as deletable.'); process.exit(2); }
if (pi > 0) { const m = JSON.parse(fs.readFileSync(process.argv[pi + 1], 'utf8')); const np = setMixSourceManifest(m.paths); if (!np) { console.error('REFUSED: the protect manifest is empty'); process.exit(2); } console.log('protect manifest: ' + np + ' paths'); }
const rows = (await makeCliQuery({ workdir: wd })(CLEANUP_SQL)).rows.map((r) => ({ ...r, size: Number(r.size) }));
const plan = buildCleanup(rows); fs.writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), objects: rows.length, ...plan }, null, 1), { mode: 0o600 });
const mb = (n) => (n / 1048576).toFixed(0).padStart(6);
for (const g of plan.groups) console.log(`${g.label.padEnd(86)} ${String(g.files).padStart(4)} files ${mb(g.bytes)} MiB  referenced ${String(g.referencedFiles).padStart(3)}  packages losing preview ${g.packagesLosingPreview}`);
for (const [k, v] of Object.entries(plan.protectedBreakdown).sort((a, b) => b[1].bytes - a[1].bytes)) console.log(`  PROTECTED ${k.padEnd(88)} ${String(v.files).padStart(4)} files ${mb(v.bytes)} MiB`);
console.log(`total ${mb(plan.totalBytes)} MiB | candidates ${mb(plan.candidateBytes)} | remaining ${mb(plan.remainingBytes)} | protected ${mb(plan.protectedBytes)} | other kept ${mb(plan.unclaimedUnprotectedBytes)}`);
