-- MMMOS Engineering Integration — Release 1 — DATABASE ROLLBACK
-- Undoes migrations/20261026_engineering_integration_r1.sql.
--
-- Order: roll the CODE back first (promote the previous production deployment
-- or revert the merge on main), THEN run this. If this runs while the R1 code
-- is still live, adviser actions simply start failing closed (401) — nothing
-- else is affected.
--
-- Safety:
--   * Refuses to run while any file is stored in engineering-artifacts. Remove
--     or export those files through the Storage API first, so no stored file is
--     left orphaned (deleting the bucket row would not delete the files).
--   * Production's storage.protect_delete trigger blocks direct deletes from
--     storage tables unless storage.allow_delete_query is set for the
--     transaction; it is set with SET LOCAL, so it ends with this transaction.
--   * srv-assets and every other bucket are untouched.
--   * Tasks and evidence rows created through the adviser are ordinary data
--     and are intentionally left in place.
-- Tested against a replica of the production storage triggers in
-- tests/platform/test_engineering_integration_r1_migration.mjs.

begin;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'engineering-artifacts') then
    raise exception 'engineering-artifacts is not empty: remove its files through the Storage API first';
  end if;
end $$;

set local storage.allow_delete_query = 'true';
delete from storage.buckets where id = 'engineering-artifacts';

drop table if exists public.engineering_advisers;

commit;
