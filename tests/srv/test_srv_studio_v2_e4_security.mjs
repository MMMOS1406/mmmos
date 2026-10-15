// SRV Studio V2 — Checkpoint E4 (order SRV-STUDIO-V2-016): app_settings public-write exposure.
// Rebuilds the production app_settings permissions in PGlite (grants + the three production policies, as read
// from pg_policy on 2026-10-15), reproduces today's exposure, applies the proposed V2-key write lock
// (docs/srv-studio-v2/e4-app-settings-v2-write-lock.sql), re-checks every business's write path, and rolls back.
// Run: node tests/srv/test_srv_studio_v2_e4_security.mjs   (needs @electric-sql/pglite: npm i --no-save)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); };
let PG; try { ({ PGlite: PG } = await import('@electric-sql/pglite')); } catch { console.log('SKIP: @electric-sql/pglite not installed'); process.exit(0); }
const sql = fs.readFileSync(path.join(repo, 'docs/srv-studio-v2/e4-app-settings-v2-write-lock.sql'), 'utf8');
const rollback = sql.split('\n').filter((l) => /^--\s+drop policy/.test(l)).map((l) => l.replace(/^--\s+/, '')).join('\n');

const db = new PG();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create table public.app_settings (key text primary key, value text, updated_at timestamptz default now());
  alter table public.app_settings enable row level security;
  grant select, insert, update, delete on public.app_settings to anon, authenticated, service_role;
  -- production policies (pg_policy, 2026-10-15)
  create policy anon_full_access_app_settings on public.app_settings for all to anon using (true) with check (true);
  create policy block_anon_ceo_lockout on public.app_settings as restrictive for all to anon using (key <> 'ceo_login_security_preview') with check (key <> 'ceo_login_security_preview');
  create policy block_anon_ceo_lockout_production on public.app_settings as restrictive for all to anon using (key <> 'ceo_login_security_production') with check (key <> 'ceo_login_security_production');
  insert into public.app_settings(key, value) values
    ('mmm_finance_v118','{}'), ('mmm_packages_backup','[]'), ('mmm_cdp_overrides','{}'), ('nextwave_v2_route_enabled','true'),
    ('nwv2r_state_nwv2r-abc','{}'), ('ceo_login_security_production','{}'),
    ('srv_studio_v2_pilot_ledger','{"rev":4,"entries":[{"status":"uploaded"},{"status":"uploaded"}]}');
`);
const as = async (role, q) => { try { await db.exec(`set role ${role};`); const r = await db.query(q); return { ok: true, n: r.affectedRows ?? (r.rows || []).length, rows: r.rows }; } catch (e) { return { ok: false, err: e.message }; } finally { await db.exec('reset role;'); } };
const val = async (k) => ((await db.query(`select value from public.app_settings where key = $1`, [k])).rows[0] || {}).value;
const has = async (k) => (await db.query(`select 1 from public.app_settings where key = $1`, [k])).rows.length === 1;
const cleanup = () => db.exec(`delete from public.app_settings where key in ('srv_studio_v2_enabled','srv_studio_v2_pilot','zz_new_key'); update public.app_settings set value='{"rev":4,"entries":[{"status":"uploaded"},{"status":"uploaded"}]}' where key='srv_studio_v2_pilot_ledger'; insert into public.app_settings(key,value) values ('srv_studio_v2_pilot_ledger','{"rev":4,"entries":[{"status":"uploaded"},{"status":"uploaded"}]}') on conflict do nothing;`);
const LEDGER0 = '{"rev":4,"entries":[{"status":"uploaded"},{"status":"uploaded"}]}';

async function attack() {
  const r = {};
  r.flag = (await as('anon', `insert into public.app_settings(key,value) values ('srv_studio_v2_enabled','true')`)).ok && (await has('srv_studio_v2_enabled'));
  r.pilot = (await as('anon', `insert into public.app_settings(key,value) values ('srv_studio_v2_pilot','{"enabled":true}')`)).ok && (await has('srv_studio_v2_pilot'));
  await as('anon', `update public.app_settings set value='{"rev":0,"entries":[]}' where key='srv_studio_v2_pilot_ledger'`); r.ledgerReset = (await val('srv_studio_v2_pilot_ledger')) !== LEDGER0;
  await db.exec(`update public.app_settings set value='${LEDGER0}' where key='srv_studio_v2_pilot_ledger'`);
  await as('anon', `delete from public.app_settings where key='srv_studio_v2_pilot_ledger'`); r.ledgerDelete = !(await has('srv_studio_v2_pilot_ledger'));
  r.upsertFlag = (await as('anon', `insert into public.app_settings(key,value) values ('srv_studio_v2_enabled','true') on conflict (key) do update set value=excluded.value`)).ok && (await has('srv_studio_v2_enabled'));
  await cleanup(); return r;
}
async function legit() { // every write path other businesses use today
  const r = {};
  r.packagesBackup = (await as('anon', `insert into public.app_settings(key,value) values ('mmm_packages_backup','[1]') on conflict (key) do update set value=excluded.value`)).ok && (await val('mmm_packages_backup')) === '[1]';
  r.financeLegacyUpsert = (await as('anon', `insert into public.app_settings(key,value) values ('mmm_finance_v118','{"x":1}') on conflict (key) do update set value=excluded.value`)).ok;
  r.newKey = (await as('anon', `insert into public.app_settings(key,value) values ('zz_new_key','1')`)).ok;
  r.anonUpdateOther = (await as('anon', `update public.app_settings set value='{"y":1}' where key='nwv2r_state_nwv2r-abc'`)).ok && (await val('nwv2r_state_nwv2r-abc')) === '{"y":1}';
  r.readV2 = (await as('anon', `select value from public.app_settings where key='srv_studio_v2_pilot_ledger'`)).rows.length === 1;
  r.ceoStillBlocked = !(await as('anon', `insert into public.app_settings(key,value) values ('ceo_login_security_production','x') on conflict (key) do update set value=excluded.value`)).ok;
  r.serverWritesV2 = (await as('service_role', `insert into public.app_settings(key,value) values ('srv_studio_v2_pilot','{"enabled":true}')`)).ok
    && (await as('service_role', `update public.app_settings set value='{"rev":5,"entries":[]}' where key='srv_studio_v2_pilot_ledger'`)).ok && (await val('srv_studio_v2_pilot_ledger')) === '{"rev":5,"entries":[]}'
    && (await as('service_role', `delete from public.app_settings where key='srv_studio_v2_pilot'`)).ok && !(await has('srv_studio_v2_pilot'));
  await cleanup(); return r;
}

const before = await attack();
ok('Today (production policies): the public anon role CAN switch V2 on, create a pilot authorization, reset and delete the ledger', before.flag && before.pilot && before.ledgerReset && before.ledgerDelete && before.upsertFlag, before);
const legitBefore = await legit();

await db.exec(sql.replace(/^--.*$/gm, ''));
const policies = (await db.query(`select polname from pg_policy where polrelid='public.app_settings'::regclass and polname like 'srv_studio_v2_keys_%'`)).rows.length;
ok('Proposed fix applies cleanly: 3 restrictive policies, scoped to srv_studio_v2_* keys', policies === 3);
const after = await attack();
ok('With the fix: anon can no longer activate V2, authorize pilot tasks, or reset/delete the ledger (insert, upsert, update, delete all refused)', !after.flag && !after.pilot && !after.ledgerReset && !after.ledgerDelete && !after.upsertFlag, after);
const legitAfter = await legit();
ok('With the fix: every other write path is unchanged (packages backup, legacy finance upsert, new keys, NextWave state updates)', legitAfter.packagesBackup && legitAfter.financeLegacyUpsert && legitAfter.newKey && legitAfter.anonUpdateOther && JSON.stringify(legitAfter) === JSON.stringify(legitBefore), legitAfter);
ok('With the fix: the browser can still READ the V2 flag/pilot/ledger; the CEO-lockout keys stay blocked', legitAfter.readV2 && legitAfter.ceoStillBlocked);
ok('With the fix: the server (service_role) still writes the pilot ledger and authorization — pilot and rollback work', legitAfter.serverWritesV2);

await db.exec(rollback);
const rolled = await attack();
ok('Rollback SQL restores today\'s behaviour exactly', rolled.flag && rolled.pilot && rolled.ledgerReset && rolled.ledgerDelete && (await db.query(`select count(*)::int n from pg_policy where polrelid='public.app_settings'::regclass`)).rows[0].n === 3);

const left14 = 'srv_studio_v2_'.length === 14;
ok('Key prefix test is exact (left(key,14) = "srv_studio_v2_"; no LIKE wildcards)', left14 && !/like/i.test(sql.replace(/^--.*$/gm, '')));
console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
