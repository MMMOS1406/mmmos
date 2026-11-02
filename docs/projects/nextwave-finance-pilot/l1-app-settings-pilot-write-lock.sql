-- NextWave Finance Pilot — L1 (Order 049): write-lock the pilot's app_settings rows.
--
-- STATUS: PREPARED, NOT APPLIED. Applying it is a database change and needs separate CEO authorization.
--
-- Why it is needed:
--   app_settings is writable by the public key that the web app embeds (policy anon_full_access_app_settings),
--   except for keys already protected by restrictive policies (block_anon_ceo_lockout*, srv_studio_v2_keys_*).
--   Without this lock, a browser (or another business's screen) could write the pilot's state row
--   'nextwave_finance_pilot_state' directly. With it, only the server (service_role, which bypasses RLS)
--   can write any key starting with 'nextwave_finance_pilot_'.
-- What it does: the public roles (anon, authenticated) can no longer INSERT, UPDATE or DELETE any app_settings
--   row whose key starts with 'nextwave_finance_pilot_'. They can still READ them (nothing secret is stored).
-- What it does not change: every other key and every other business. No browser code writes these keys.
-- It mirrors docs/srv-studio-v2/e4-app-settings-v2-write-lock.sql (applied 2026-10-15) exactly.
-- 'nextwave_finance_pilot_' is 23 characters.

begin;
create policy nextwave_finance_pilot_keys_no_public_insert on public.app_settings
  as restrictive for insert to anon, authenticated
  with check (left(key, 23) <> 'nextwave_finance_pilot_');
create policy nextwave_finance_pilot_keys_no_public_update on public.app_settings
  as restrictive for update to anon, authenticated
  using (left(key, 23) <> 'nextwave_finance_pilot_') with check (left(key, 23) <> 'nextwave_finance_pilot_');
create policy nextwave_finance_pilot_keys_no_public_delete on public.app_settings
  as restrictive for delete to anon, authenticated
  using (left(key, 23) <> 'nextwave_finance_pilot_');
commit;

-- Verify (expects 3 rows):
--   select polname from pg_policy where polrelid = 'public.app_settings'::regclass and polname like 'nextwave_finance_pilot_keys_%';
-- Then (as the public key, from a test client) an insert of key 'nextwave_finance_pilot_probe' must be refused,
-- and the server action nwfp_state_update must still succeed once the CEO switch is on.

-- ACTIVATION after the migration (separate CEO step): insert the switch row
--   insert into mmm_platform_flags (flag, enabled) values ('nwfp_state_writes', true);
-- Deactivate: update mmm_platform_flags set enabled = false where flag = 'nwfp_state_writes';

-- ROLLBACK (restores today's behaviour exactly):
--   drop policy if exists nextwave_finance_pilot_keys_no_public_insert on public.app_settings;
--   drop policy if exists nextwave_finance_pilot_keys_no_public_update on public.app_settings;
--   drop policy if exists nextwave_finance_pilot_keys_no_public_delete on public.app_settings;
