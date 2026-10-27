// B10 migration + rollback test: runs the REAL SQL on local Postgres (PGlite) set up
// like production's engineering_tasks (public SELECT policy, every privilege granted
// to anon/authenticated, RLS on). Never touches production.
// Run: node tests/platform/test_b10_engineering_tasks_private.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG = readFileSync(join(root, 'migrations/20261027_b10_engineering_tasks_private.sql'), 'utf8');
const RB = readFileSync(join(root, 'migrations/20261027_b10_engineering_tasks_private_rollback.sql'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
const pg = new PGlite();
await pg.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.engineering_tasks (id uuid primary key default gen_random_uuid(), problem text, agent_authorization_token_hash text);
  alter table public.engineering_tasks enable row level security;
  grant all on public.engineering_tasks to anon, authenticated, service_role;
  create policy anon_read_engineering_tasks on public.engineering_tasks for select to anon, authenticated using (true);
  insert into public.engineering_tasks (problem, agent_authorization_token_hash) values ('t1','h1'),('t2','h2');`);
const asRole = async (role, q) => { try { await pg.exec(`set role ${role}`); const r = await pg.query(q); return { rows: r.rows }; } catch (e) { return { error: e.message }; } finally { await pg.exec('reset role'); } };

let r = await asRole('anon', 'select count(*)::int n from public.engineering_tasks');
ok('before: anon can read every task (the B10 exposure)', r.rows && r.rows[0].n === 2);
await pg.exec(MIG);
await pg.exec(MIG);
ok('migration applies and can be re-run', true);
r = await asRole('anon', 'select * from public.engineering_tasks');
ok('after: anon read → permission denied', /permission denied/.test(r.error || ''), JSON.stringify(r));
r = await asRole('authenticated', 'select * from public.engineering_tasks');
ok('after: authenticated read → permission denied', /permission denied/.test(r.error || ''));
r = await asRole('anon', `insert into public.engineering_tasks (problem) values ('x')`);
ok('after: anon insert → permission denied', /permission denied/.test(r.error || ''));
r = await asRole('service_role', 'select count(*)::int n from public.engineering_tasks');
ok('after: the server (service role) still reads everything', r.rows && r.rows[0].n === 2);
const pol = (await pg.query(`select count(*)::int n from pg_policies where tablename='engineering_tasks'`)).rows[0].n;
ok('after: no policy remains on engineering_tasks', pol === 0);
await pg.exec(RB);
r = await asRole('anon', 'select count(*)::int n from public.engineering_tasks');
ok('rollback restores the exact previous public read', r.rows && r.rows[0].n === 2);
await pg.exec(MIG);
r = await asRole('anon', 'select * from public.engineering_tasks');
ok('migration re-applies cleanly after rollback', /permission denied/.test(r.error || ''));
// ── B10b: brain_agent_runs ────────────────────────────────────────────────────
const MIG_B = readFileSync(join(root, 'migrations/20261027_b10b_brain_agent_runs_private.sql'), 'utf8');
const RB_B = readFileSync(join(root, 'migrations/20261027_b10b_brain_agent_runs_private_rollback.sql'), 'utf8');
await pg.exec(`create table public.brain_agent_runs (id uuid primary key default gen_random_uuid(), session_id text, task_id text, action text);
  alter table public.brain_agent_runs enable row level security;
  grant select on public.brain_agent_runs to anon, authenticated; grant all on public.brain_agent_runs to service_role;
  create policy ceo015b_browser_read_only on public.brain_agent_runs for select to anon, authenticated using (true);
  insert into public.brain_agent_runs (session_id, task_id, action) values ('run1','t1','gateway:read_task_packet');`);
r = await asRole('anon', 'select count(*)::int n from public.brain_agent_runs');
ok('B10b before: anon can read the agent audit trail', r.rows && r.rows[0].n === 1);
await pg.exec(MIG_B); await pg.exec(MIG_B);
r = await asRole('anon', 'select * from public.brain_agent_runs');
ok('B10b after: anon read → permission denied (re-runnable)', /permission denied/.test(r.error || ''));
r = await asRole('service_role', 'select count(*)::int n from public.brain_agent_runs');
ok('B10b after: the server still reads it', r.rows && r.rows[0].n === 1);
await pg.exec(RB_B);
r = await asRole('anon', 'select count(*)::int n from public.brain_agent_runs');
ok('B10b rollback restores the previous browser read', r.rows && r.rows[0].n === 1);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
