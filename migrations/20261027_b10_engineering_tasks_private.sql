-- MMMOS Engineering Integration R2 — B10: engineering task data no longer public.
-- NOT APPLIED. Apply only AFTER the R2 code is live in production: R2 moves
-- every browser and connector read of engineering_tasks behind the server
-- (CEO session, or worker credential), so nothing legitimate needs the public
-- key any more. Applying this before R2 is live would empty CEO Engineering
-- Review's task list in the Engineering Brain panel.
--
-- Before: policy anon_read_engineering_tasks let the public browser key read
-- every row (packets, authorization boundaries, claim state, token hashes),
-- and anon/authenticated held every table privilege (row security alone
-- stopped writes). After: no policy and no privilege for anon/authenticated;
-- only the server's service role reads or writes the table.
-- Rollback: migrations/20261027_b10_engineering_tasks_private_rollback.sql
drop policy if exists anon_read_engineering_tasks on public.engineering_tasks;
revoke all on table public.engineering_tasks from anon, authenticated;
