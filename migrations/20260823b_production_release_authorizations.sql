-- CEO Decision #17: Governed Production Execution Fix (2026-08-23)
-- v2 — Production Execution Failure-Safety Fix (2026-08-23, same day,
-- pre-push correction — this table has never been applied to production,
-- so this file is edited in place rather than layering a second migration).
--
-- Splits "CEO approves this release" from "who physically calls the Vercel
-- Deploy Hook" into two independently-verified steps, so Cowork (authenticated
-- as a registered Engineering Worker) can execute an already-CEO-authorized
-- production release without ever holding a CEO session or the Deploy Hook
-- secret.
--
-- Critical governance rule this table exists to enforce: engineering_tasks
-- being status='done' AND ceo_decision='approved' means the WORK is correct.
-- It is explicitly NOT, by itself, authority to deploy. A separate, durable
-- row here — created only via the CEO-session-gated
-- production_release_authorization_create action — is the actual production
-- release decision, scoped to one exact task + one exact commit + one exact
-- branch.
--
-- Execution lifecycle (v2): authorized -> executing -> triggered | failed |
-- ambiguous. 'executing' is entered only via an atomic, conditional update
-- (status=eq.authorized), which is what makes concurrent/replayed execution
-- attempts against the same row impossible. 'triggered', 'failed', and
-- 'ambiguous' are all terminal — nothing in application code ever moves a
-- row backward to 'authorized'. A confirmed hook rejection is 'failed'
-- (definitive); a network/timeout failure where Vercel may or may not have
-- received the request is 'ambiguous' (fail-closed, never auto-retried).
-- The only way to retry after 'failed' or 'ambiguous' is a brand-new row
-- from a brand-new, explicit CEO-session-gated authorization call — this
-- table intentionally has no worker-reachable reset/retry path at all.
--
-- Additive only: new table, plus two new nullable columns on the existing
-- production_deployments audit table (a link back to the authorization
-- executed, and which worker executed it). No existing row, column, or code
-- path is changed in any way.

create table if not exists production_release_authorizations (
  id uuid primary key default gen_random_uuid(),
  engineering_task_id uuid not null references engineering_tasks(id),
  commit_sha text not null,
  deploy_branch text not null default 'main',
  status text not null default 'authorized'
    constraint production_release_authorizations_status_check
    check (status in ('authorized', 'executing', 'triggered', 'failed', 'ambiguous', 'revoked')),
  ceo_authorized_at timestamptz not null default now(),
  ceo_authorized_by text not null default 'CEO',
  acquired_at timestamptz,
  acquired_by_worker_id uuid references engineering_workers(id),
  triggered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  failure_detail jsonb,
  ambiguous_at timestamptz,
  ambiguous_detail jsonb,
  production_deployment_id uuid,
  revoked_at timestamptz,
  revoked_by text,
  created_at timestamptz not null default now(),
  constraint production_release_authorizations_sha_format_check
    check (commit_sha ~ '^[0-9a-f]{40}$')
);

comment on table production_release_authorizations is
  'CEO Decision #17 Governed Production Execution Fix (v2 — failure-safety). One durable production-release decision per row, scoped to exactly one engineering_task_id + commit_sha + deploy_branch. Created only by the CEO-session-gated production_release_authorization_create action. Lifecycle: authorized -> executing (atomic acquire, conditional on status=eq.authorized -- the concurrency/replay guard) -> triggered (confirmed hook success) | failed (confirmed hook rejection, failure_reason/failure_detail set) | ambiguous (network/timeout failure of unknown outcome, ambiguous_detail set for reconciliation against Vercel''s own deployment history). triggered/failed/ambiguous are all terminal -- application code never moves a row back to authorized; the only retry path after failed/ambiguous is a brand-new row from a brand-new CEO authorization call. Never writable by the browser or by any Engineering Agent Gateway op -- engineering_tasks.status=''done''/ceo_decision=''approved'' alone is never sufficient to deploy.';

create index if not exists idx_production_release_authorizations_task
  on production_release_authorizations(engineering_task_id);
create index if not exists idx_production_release_authorizations_status
  on production_release_authorizations(status);

-- Additive link-back columns on the existing, unmodified audit trail table.
-- Both nullable, no default: every pre-existing production_deployments row
-- (created by the original CEO-direct productionDeploymentAuthorize path)
-- is completely unaffected and simply has these as null. production_deployments.status
-- has no check constraint (plain text, matching its existing informal-enum
-- usage elsewhere in this table), so it can take the new 'executing' /
-- 'ambiguous' values used by the worker-execution audit rows without any
-- further schema change.
alter table production_deployments
  add column if not exists production_release_authorization_id uuid references production_release_authorizations(id);
alter table production_deployments
  add column if not exists executed_by_worker_id uuid references engineering_workers(id);

comment on column production_deployments.production_release_authorization_id is
  'Set only for deployments executed via engineering_worker_execute_production_release; null for the original CEO-direct productionDeploymentAuthorize path (unchanged).';
comment on column production_deployments.executed_by_worker_id is
  'Which registered Engineering Worker (engineering_workers.id) executed this deployment on an already-CEO-authorized release; null for the CEO-direct path.';

-- RLS enabled, no policies added — matches the engineering_worker_pairing_requests
-- precedent from Step 2D: all reads/writes in api/ops.js use the service-role
-- key server-side (which bypasses RLS by design), so this has no effect on any
-- existing server code, while leaving the anon/authenticated client roles with
-- zero direct access to this governance-critical table by default.
alter table production_release_authorizations enable row level security;
