-- SRV Studio V2 — Checkpoint E4 (order SRV-STUDIO-V2-016): write-lock the SRV Studio V2 control keys.
--
-- STATUS: PROPOSED. NOT APPLIED. Requires separate CEO authorization (app_settings is a shared table).
--
-- What it does: the public roles (anon = the key embedded in the web app, authenticated) can no longer
-- INSERT, UPDATE or DELETE any app_settings row whose key starts with 'srv_studio_v2_'
--   (srv_studio_v2_enabled, srv_studio_v2_pilot, srv_studio_v2_pilot_ledger).
-- They can still READ them (the browser reads the V2 flag and the pilot authorization).
-- The server (service_role, which bypasses RLS) and SQL administrators keep full control, so the pilot
-- ledger, activation and rollback keep working exactly as designed.
-- Every other key, and every other business, is unaffected: no browser code writes 'srv_studio_v2_' keys.
-- It mirrors the existing restrictive policies block_anon_ceo_lockout and block_anon_ceo_lockout_production.

begin;
create policy srv_studio_v2_keys_no_public_insert on public.app_settings
  as restrictive for insert to anon, authenticated
  with check (left(key, 14) <> 'srv_studio_v2_');
create policy srv_studio_v2_keys_no_public_update on public.app_settings
  as restrictive for update to anon, authenticated
  using (left(key, 14) <> 'srv_studio_v2_') with check (left(key, 14) <> 'srv_studio_v2_');
create policy srv_studio_v2_keys_no_public_delete on public.app_settings
  as restrictive for delete to anon, authenticated
  using (left(key, 14) <> 'srv_studio_v2_');
commit;

-- Verify (expects 3 rows):
--   select polname from pg_policy where polrelid = 'public.app_settings'::regclass and polname like 'srv_studio_v2_keys_%';

-- ROLLBACK (restores today's behaviour exactly):
--   drop policy if exists srv_studio_v2_keys_no_public_insert on public.app_settings;
--   drop policy if exists srv_studio_v2_keys_no_public_update on public.app_settings;
--   drop policy if exists srv_studio_v2_keys_no_public_delete on public.app_settings;
