// MMMOS Engineering Integration — Release 1 — migration + rollback tests.
// Runs the REAL migration and rollback SQL against local Postgres (PGlite) set up
// like production storage: the same storage.buckets columns and defaults, the
// four production trigger functions (copied verbatim from pg_get_functiondef on
// 2026-10-26), a migration role shaped like Supabase's `postgres` (not superuser,
// bypasses RLS, member of service_role) and Supabase's default grants of new
// public tables to anon/authenticated. Never touches production.
// Run: node tests/platform/test_engineering_integration_r1_migration.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG = readFileSync(join(root, 'migrations/20261026_engineering_integration_r1.sql'), 'utf8');
const RB = readFileSync(join(root, 'migrations/20261026_engineering_integration_r1_rollback.sql'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };

// ── Production storage trigger functions (verbatim) ──────────────────────────
const PROD_FUNCTIONS = String.raw`
CREATE OR REPLACE FUNCTION storage.enforce_bucket_name_length()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$function$;

CREATE OR REPLACE FUNCTION storage.protect_delete()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION storage.enforce_bucket_lifecycle_service_role()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF current_user::text IS DISTINCT FROM TG_ARGV[0]
     AND (
       OLD.lifecycle_configuration IS DISTINCT FROM NEW.lifecycle_configuration
       OR OLD.lifecycle_configuration_generation IS DISTINCT FROM NEW.lifecycle_configuration_generation
     ) THEN
    RAISE EXCEPTION 'bucket control columns may only be changed by the configured storage service role'
      USING ERRCODE = 'PST01', SCHEMA = TG_TABLE_SCHEMA, TABLE = TG_TABLE_NAME, CONSTRAINT = TG_NAME;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION storage.protect_bucket_control_columns()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  configuration_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_configuration IS NOT NULL
       OR NEW.lifecycle_configuration_generation IS NOT NULL THEN
      IF NOT pg_has_role(current_user, TG_ARGV[0], 'MEMBER') THEN
        RAISE EXCEPTION 'only members of the configured storage service role may insert lifecycle policy state'
          USING ERRCODE = '42501',
                HINT = format('Insert with both lifecycle columns NULL and configure lifecycle through the Storage API afterward, or insert as a member of %I.', TG_ARGV[0]);
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  configuration_changed =
    OLD.lifecycle_configuration IS DISTINCT FROM NEW.lifecycle_configuration
    OR OLD.lifecycle_configuration_generation IS DISTINCT FROM NEW.lifecycle_configuration_generation;
  IF NOT configuration_changed THEN RETURN NEW; END IF;
  IF NEW.type IS DISTINCT FROM 'STANDARD' THEN
    RAISE EXCEPTION 'bucket versioning and lifecycle controls require a Standard bucket' USING ERRCODE = '0A000';
  END IF;
  IF NEW.lifecycle_configuration IS NULL AND NEW.lifecycle_configuration_generation IS NULL THEN RETURN NEW; END IF;
  IF NEW.lifecycle_configuration IS NULL
     OR NEW.lifecycle_configuration_generation IS NULL
     OR OLD.lifecycle_configuration IS NOT DISTINCT FROM NEW.lifecycle_configuration
     OR OLD.lifecycle_configuration_generation IS NOT DISTINCT FROM NEW.lifecycle_configuration_generation THEN
    RAISE EXCEPTION 'a changed lifecycle policy requires a new non-null generation' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
`;

async function replica() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role migrator nologin bypassrls in role service_role;
    create schema storage; grant usage on schema storage to anon, authenticated, service_role, migrator;
    create type storage.buckettype as enum ('STANDARD','ANALYTICS','VECTOR');
    create table storage.buckets (id text primary key, name text not null, owner uuid,
      created_at timestamptz default now(), updated_at timestamptz default now(),
      public boolean default false, avif_autodetection boolean default false, file_size_limit bigint,
      allowed_mime_types text[], owner_id text, type storage.buckettype not null default 'STANDARD',
      versioning_status text not null default 'DISABLED', lifecycle_configuration jsonb, lifecycle_configuration_generation uuid);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, metadata jsonb);
    alter table storage.buckets enable row level security; alter table storage.objects enable row level security;
    grant all on storage.buckets, storage.objects to migrator, service_role;
    grant select on storage.buckets to anon, authenticated; grant all on storage.objects to anon, authenticated;
    create policy srv_assets_select_anon on storage.objects for select to anon, authenticated using (bucket_id = 'srv-assets');
    create policy srv_assets_insert_anon on storage.objects for insert to anon, authenticated with check (bucket_id = 'srv-assets');
    insert into storage.buckets (id, name, public, file_size_limit) values ('srv-assets','srv-assets',true,524288000);
    grant usage, create on schema public to migrator; grant usage on schema public to anon, authenticated;
    alter default privileges for role migrator in schema public grant all on tables to anon, authenticated, service_role;
  `);
  await pg.exec(PROD_FUNCTIONS);
  await pg.exec(`
    create trigger enforce_bucket_name_length_trigger before insert or update of name on storage.buckets for each row execute function storage.enforce_bucket_name_length();
    create trigger protect_bucket_control_insert before insert on storage.buckets for each row execute function storage.protect_bucket_control_columns('service_role');
    create trigger protect_bucket_control_update before update of lifecycle_configuration, lifecycle_configuration_generation on storage.buckets for each row execute function storage.protect_bucket_control_columns();
    create trigger protect_bucket_control_update_role after update of lifecycle_configuration, lifecycle_configuration_generation on storage.buckets for each row execute function storage.enforce_bucket_lifecycle_service_role('service_role');
    create trigger protect_buckets_delete before delete on storage.buckets for each statement execute function storage.protect_delete();`);
  return pg;
}
// Runs SQL as the production-shaped migration role; returns the error message or null.
async function asMigrator(pg, sql) {
  try { await pg.exec(`set role migrator; ${sql}; reset role;`); return null; }
  catch (e) { try { await pg.exec('rollback'); } catch (_) {} await pg.exec('reset role'); return e.message; }
}
const one = async (pg, q) => (await pg.query(q)).rows[0];

const pg = await replica();
ok('migration applies under the production-shaped role and triggers', (await asMigrator(pg, MIG)) === null);
ok('migration can be re-run (idempotent)', (await asMigrator(pg, MIG)) === null);
const b = await one(pg, `select public, type::text t, lifecycle_configuration lc, file_size_limit fl, 'video/mp4' = any(allowed_mime_types) mp4 from storage.buckets where id='engineering-artifacts'`);
ok('engineering-artifacts is private, STANDARD, no lifecycle state, 500 MB, accepts MP4', b && b.public === false && b.t === 'STANDARD' && b.lc === null && Number(b.fl) === 524288000 && b.mp4 === true);
ok('srv-assets bucket unchanged', (await one(pg, `select public from storage.buckets where id='srv-assets'`)).public === true);
const grants = (await pg.query(`select grantee from information_schema.role_table_grants where table_name='engineering_advisers' and grantee in ('anon','authenticated')`)).rows;
ok('default anon/authenticated grants are removed from engineering_advisers', grants.length === 0, JSON.stringify(grants));
const rls = await one(pg, `select relrowsecurity r from pg_class where relname='engineering_advisers'`);
const pol = await one(pg, `select count(*)::int n from pg_policies where tablename='engineering_advisers'`);
ok('engineering_advisers has RLS on and zero policies', rls.r === true && pol.n === 0);
await pg.exec(`insert into public.engineering_advisers (label, credential_hash) values ('t','h')`);
let e = null; try { await pg.exec('set role anon; select * from public.engineering_advisers;'); } catch (x) { e = x.message; } await pg.exec('reset role');
ok('anon cannot read engineering_advisers', /permission denied/.test(e || ''), e);
e = null; try { await pg.exec(`set role anon; insert into storage.objects (bucket_id, name) values ('engineering-artifacts','x/y.mp4');`); } catch (x) { e = x.message; } await pg.exec('reset role');
ok('anon cannot add files to engineering-artifacts', /row-level security/.test(e || ''), e);
await pg.exec(`insert into storage.objects (bucket_id, name) values ('engineering-artifacts','mmmos/t/r/1-private.mp4'), ('srv-assets','public.png')`);
await pg.exec('set role anon');
const seen = await one(pg, `select count(*)::int n from storage.objects where bucket_id='engineering-artifacts'`);
const seenSrv = await one(pg, `select count(*)::int n from storage.objects where bucket_id='srv-assets'`);
await pg.exec('reset role');
ok('anon sees no engineering files while srv-assets stays readable', seen.n === 0 && seenSrv.n === 1);
await pg.exec(`update storage.buckets set public = true where id='engineering-artifacts'`);
await asMigrator(pg, MIG);
ok('re-running the migration forces the bucket back to private', (await one(pg, `select public from storage.buckets where id='engineering-artifacts'`)).public === false);

// ── Rollback ─────────────────────────────────────────────────────────────────
e = await asMigrator(pg, RB);
ok('rollback refuses while files are stored', /not empty/.test(e || ''), e);
ok('the refused rollback removed nothing', (await one(pg, `select count(*)::int n from storage.buckets where id='engineering-artifacts'`)).n === 1
  && (await one(pg, `select to_regclass('public.engineering_advisers') r`)).r !== null);
e = await asMigrator(pg, `delete from storage.buckets where id='engineering-artifacts'`);
ok('a plain bucket DELETE is blocked by the production protect_delete trigger', /Direct deletion/.test(e || ''), e);
await pg.exec(`delete from storage.objects where bucket_id='engineering-artifacts'`);
ok('rollback succeeds once the bucket is empty', (await asMigrator(pg, RB)) === null);
ok('rollback removed the bucket and table and left srv-assets and its files',
  (await one(pg, `select count(*)::int n from storage.buckets where id='engineering-artifacts'`)).n === 0
  && (await one(pg, `select to_regclass('public.engineering_advisers') r`)).r === null
  && (await one(pg, `select count(*)::int n from storage.objects where bucket_id='srv-assets'`)).n === 1);
ok('allow_delete_query does not outlive the rollback transaction', (await one(pg, `select coalesce(current_setting('storage.allow_delete_query', true), '') v`)).v !== 'true');
ok('the migration can be re-applied after rollback', (await asMigrator(pg, MIG)) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
