-- CEO Decision #17 Release Record Fix (2026-08-23)
-- Adds explicit task classification so already-completed, already-tested
-- engineering work can be registered for governed CEO release without
-- fabricating Engineering Worker authorization/execution history.
--
-- Additive only: new column with a safe default. Every existing row becomes
-- 'new_development' (the default), which is the exact behavior every existing
-- task already has today — no existing row's meaning changes.

alter table engineering_tasks
  add column if not exists release_kind text not null default 'new_development'
  constraint engineering_tasks_release_kind_check check (release_kind in ('new_development', 'retroactive_release'));

comment on column engineering_tasks.release_kind is
  'new_development (default) = normal Task Generator -> Authorize Agent -> Engineering Worker -> Execution -> Engineering Review -> CEO Approve/Reject -> Production Release flow, unchanged. retroactive_release = already-completed, already-tested work registered directly for CEO Engineering Review -> Approve/Reject -> Production Release, with no agent authorization or execution required or fabricated. Set only at task creation (engineering_task_create / engineering_task_create_from_decision); engineering_task_update rejects any attempt to change it afterward, so an in-flight task can never relabel itself to bypass Agent Authorization/execution.';
