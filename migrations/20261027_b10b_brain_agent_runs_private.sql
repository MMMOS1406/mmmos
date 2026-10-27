-- MMMOS Engineering Integration R2 — B10b: the engineering agent audit trail
-- (brain_agent_runs) is no longer public. NOT APPLIED. Apply only AFTER the R2
-- code is live: R2 moves the Brain v2 Agents panel to the CEO-session action
-- engineering_agent_runs_list, so nothing legitimate needs the public key.
-- Before: policy ceo015b_browser_read_only let the public browser key read every
-- run (run ids, task ids, artifact paths, PR numbers, refusal reasons).
-- After: no policy and no privilege for anon/authenticated; only the server.
-- Rollback: migrations/20261027_b10b_brain_agent_runs_private_rollback.sql
drop policy if exists ceo015b_browser_read_only on public.brain_agent_runs;
revoke all on table public.brain_agent_runs from anon, authenticated;
