// SRV Farsi Mix sources must never be cleanup candidates (PM order 2026-11-14). node tools/ceo016a/test-cleanup-protection.mjs
import { protection, buildCleanup, setMixSourceManifest, CLEANUP_SQL } from './cleanup-lib.mjs';
let pass = 0, fail = 0; const ok = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL', n); } };
const base = { category: 'package', business: 'SRV Farsi', is_video: true, size: 1000, pkg_age_days: 120, referenced: true };
const o = (x) => ({ ...base, ...x });
ok('SQL exposes mix_source', /mix_source/.test(CLEANUP_SQL) && /srv_farsi_mix_sources/.test(CLEANUP_SQL) && /content_type = 'Mix'/.test(CLEANUP_SQL));
setMixSourceManifest([]);
ok('a TEST-class Long that nothing protects is still a candidate (rule is not a blanket)', protection(o({ name: 'pkg_1/long_1_srv_farsi_long.webm', class: 'test' })) === null);
ok('stale unpublished draft is still a candidate', protection(o({ name: 'pkg_2/long_1_srv_farsi_long.webm', class: 'unpublished' })) === null);
ok('a Short of a published song is still a candidate (only Longs are Mix sources)', protection(o({ name: 'pkg_3/short_1_srv_short.webm', class: 'published' })) === null);
ok('published SRV Farsi Long render is protected (P6)', /^P6 published/.test(protection(o({ name: 'pkg_4/long_1_srv_farsi_long.webm', class: 'published' })) || ''));
ok('file referenced by a Mix package / registry is protected whatever its class (mix_source = true or "t")', /^P6 SRV Farsi Mix source/.test(protection(o({ name: 'pkg_5/long_1_x.webm', class: 'test', mix_source: true })) || '') && /^P6/.test(protection(o({ name: 'pkg_5/long_1_x.webm', class: 'unpublished', mix_source: 't' })) || ''));
setMixSourceManifest(['pkg_6/long_9_srv_farsi_long.webm', 'pkg_6/audio_9_x.mp3']);
ok('manifest path is protected even for test/unpublished class (recovered historical source)', /^P6/.test(protection(o({ name: 'pkg_6/long_9_srv_farsi_long.webm', class: 'test' })) || '') && /^P6/.test(protection(o({ name: 'pkg_6/audio_9_x.mp3', class: 'test', is_video: false })) || ''));
const plan = buildCleanup([o({ name: 'pkg_6/long_9_srv_farsi_long.webm', class: 'test' }), o({ name: 'pkg_7/long_9_srv_farsi_long.webm', class: 'test' })]);
const paths = plan.groups.flatMap((g) => g.paths);
ok('buildCleanup leaves the manifest file out and still lists the unprotected test render', !paths.includes('pkg_6/long_9_srv_farsi_long.webm') && paths.includes('pkg_7/long_9_srv_farsi_long.webm'));
ok('SRV English rule unchanged (P5)', /^P5/.test(protection(o({ business: 'SRV English', name: 'pkg_8/long_1.webm', class: 'published' })) || ''));
setMixSourceManifest([]);
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
const r1 = spawnSync('node', [dir + 'cleanup-cli.mjs', '/dev/null', '--cli-workdir', '/nonexistent'], { encoding: 'utf8' });
ok('the cleanup CLI REFUSES to run without --protect (exit 2, nothing queried)', r1.status === 2 && /REFUSED/.test(r1.stderr));
const synth = { paths: [...Array.from({ length: 12 }, (_, i) => `pkg_17000000000${String(i).padStart(2, '0')}/long_17000000001${String(i).padStart(2, '0')}_srv_farsi_long.webm`), 'pkg_1700000000099/audio_1700000000199_original.mp3'] };   // SYNTHETIC shape only — the real manifest is private
ok('a manifest of 13 paths (12 Longs + 1 MP3) protects every listed object even when the package is test-flagged', (setMixSourceManifest(synth.paths), synth.paths.every((p) => /^P6/.test(protection({ category: 'package', business: 'SRV Farsi', class: 'test', is_video: false, name: p }) || ''))));
const mf = spawnSync('node', [dir + 'cleanup-cli.mjs', '/dev/null', '--cli-workdir', '/nonexistent', '--protect', '/nonexistent-manifest.json'], { encoding: 'utf8' }); ok('a missing/unreadable manifest stops the run (never silently protects nothing)', mf.status !== 0);
ok('no manifest of real object paths is stored in this repository (no *manifest*.json next to the tool)', !fs.readdirSync(dir).some((f) => /manifest.*\.json$/i.test(f)));
setMixSourceManifest([]);
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
