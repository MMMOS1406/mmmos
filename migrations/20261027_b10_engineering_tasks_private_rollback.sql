-- Rollback of 20261027_b10_engineering_tasks_private.sql: restores the exact
-- pre-B10 state (public read policy + the privileges anon/authenticated held).
grant all on table public.engineering_tasks to anon, authenticated;
drop policy if exists anon_read_engineering_tasks on public.engineering_tasks;
create policy anon_read_engineering_tasks on public.engineering_tasks for select to anon, authenticated using (true);
