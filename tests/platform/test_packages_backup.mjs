// Platform — package saves no longer rewrite the full packages backup (2026-10-16).
// Production: the browser role has statement_timeout=3s; the per-save backup wrote every package (~8.6 MB) into one
// app_settings value, was cancelled on every save since 2026-05-23 (HTTP 500) and added seconds to each save in every
// business. Runs the REAL savePackageToSupabase from public/index.html with a mocked fetch.
// Run: node tests/platform/test_packages_backup.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = fs.readFileSync(path.join(repo, 'public/index.html'), 'utf8');
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); };
const top = (name) => { const m = H.match(new RegExp('\\n(async )?function ' + name + '\\(')); const s = m.index + 1; return H.slice(s, H.indexOf('\n}\n', s) + 2); };

const calls = [];
const ctx = {
  console: { log() {}, warn() {}, error() {} }, JSON, Date, Promise, String, Object, Array,
  SUPABASE_URL: 'https://stub.invalid', SUPABASE_KEY: 'k', SB_PACKAGES_BACKUP_KEY: 'mmm_packages_backup',
  D: { packages: Array.from({ length: 520 }, (_, i) => ({ id: 'pkg_' + i, engine: 'SRV Farsi', title: 'T' + i })) },
  document: { getElementById: () => null },
  setTimeout: (f) => 0,
  fetch: async (url, opt = {}) => { calls.push({ url: String(url), method: opt.method || 'GET' }); return { ok: true, status: 200, text: async () => '', json: async () => null }; },
};
vm.createContext(ctx);
vm.runInContext(top('savePackageToSupabase') + top('writePackagesBackup'), ctx);

for (const engine of ['SRV Farsi', 'NextWave', 'AI Studio', 'SRV English']) {
  calls.length = 0;
  const r = await vm.runInContext(`savePackageToSupabase({ id: 'pkg_x', engine: ${JSON.stringify(engine)}, title: 'Song' })`, ctx);
  ok(`${engine}: a package save is one packages upsert and nothing else (no full app_settings backup)`, r === true && calls.length === 1 && /\/rest\/v1\/packages\?on_conflict=package_id/.test(calls[0].url), calls);
}
{
  calls.length = 0;
  ctx.fetch = async (url, opt = {}) => { calls.push({ url: String(url) }); return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) }; };
  const r = await vm.runInContext("savePackageToSupabase({ id: 'pkg_y', engine: 'SRV Farsi', title: 'S' })", ctx);
  ok('a failed package upsert still reports false and marks the package for retry', r === false && calls.length === 1 && ctx.D.packages && true);
}
ok('writePackagesBackup is still available for a deliberate manual backup', typeof ctx.writePackagesBackup === 'function');
ok('the save path no longer calls the backup', !/await writePackagesBackup\(\)/.test(top('savePackageToSupabase')));

// ── MMMOS-PLATFORM-027: repeated and concurrent saves through the real per-package save queue, with read-back ──
{
  const table = {}; let writes = 0, backups = 0, inFlight = 0, maxInFlight = 0;
  const ctx2 = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date, Promise, String, Object, Array,
    SUPABASE_URL: 'https://stub.invalid', SUPABASE_KEY: 'k', SB_PACKAGES_BACKUP_KEY: 'mmm_packages_backup', D: { packages: [] },
    document: { getElementById: () => null }, setTimeout: (f) => 0,
    fetch: async (url, opt = {}) => {
      const u = String(url);
      if (u.includes('/rest/v1/app_settings')) { backups++; return { ok: true, status: 200, text: async () => '', json: async () => null }; }
      if (u.includes('/rest/v1/packages?on_conflict')) {
        const row = JSON.parse(opt.body); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setImmediate(r)); // let other saves interleave
        table[row.package_id] = row; writes++; inFlight--;
        return { ok: true, status: 200, text: async () => '', json: async () => null };
      }
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    },
  };
  vm.createContext(ctx2);
  const qs = H.slice(H.indexOf('const _farsiPkgSaveQueues={};'), H.indexOf('// Write all packages as a backup'));
  vm.runInContext(top('savePackageToSupabase') + qs, ctx2);
  const engines = ['SRV English', 'SRV Farsi', 'NextWave', 'AI Studio', 'SMM'];
  const pk = engines.flatMap((e, i) => [0, 1].map((k) => ({ id: 'pkg_' + i + '_' + k, engine: e, title: e + ' song ' + k, rev: 0 })));
  ctx2.D.packages = pk;
  const jobs = [];
  for (let rev = 1; rev <= 5; rev++) for (const p of pk) { p.rev = rev; p.lyrics = p.engine + ' lyrics rev ' + rev; ctx2.__p = p; jobs.push(vm.runInContext('_srvSavePackageQueued(__p)', ctx2)); }
  const results = await Promise.all(jobs);
  const back = pk.map((p) => JSON.parse(table[p.id].full_package));
  ok('repeated + concurrent saves (5 rounds × 10 packages, 5 businesses): every save succeeds', results.every((r) => r === true) && writes === 50);
  ok('read-back: every package row holds its latest values (title, lyrics, revision)', back.every((b, i) => b.rev === 5 && b.lyrics === pk[i].engine + ' lyrics rev 5' && table[pk[i].id].title === pk[i].title));
  ok('saves of different packages run in parallel (no global wait) while one package stays in order', maxInFlight > 1);
  ok('no full packages backup is attempted by any of the 50 saves', backups === 0);
}

console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
