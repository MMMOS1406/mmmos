-- Rollback of 20261027_b10b_brain_agent_runs_private.sql: restores the exact
-- pre-B10b state (browser read-only policy + SELECT for anon/authenticated).
grant select on table public.brain_agent_runs to anon, authenticated;
drop policy if exists ceo015b_browser_read_only on public.brain_agent_runs;
create policy ceo015b_browser_read_only on public.brain_agent_runs for select to anon, authenticated using (true);
