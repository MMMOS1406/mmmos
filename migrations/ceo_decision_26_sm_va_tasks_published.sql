-- CEO Decision #26: SMM -> VA Portal lifecycle integration, Publish stage.
-- Additive only: widens the existing status CHECK constraint on sm_va_tasks to allow
-- a new terminal value 'published', representing that a task was carried through the
-- shared lifecycle's safe/test Publish step (no external platform call, publish_locked
-- stays permanently true on sm_production_packages/sm_video_productions -- untouched here).
-- Does not affect sm_production_packages, sm_video_productions, or any other table.
-- Applied directly via Supabase MCP apply_migration on 2026-08-26.
ALTER TABLE sm_va_tasks DROP CONSTRAINT sm_va_tasks_status_check;
ALTER TABLE sm_va_tasks ADD CONSTRAINT sm_va_tasks_status_check
  CHECK (status = ANY (ARRAY['queued'::text, 'package_ready'::text, 'ceo_reviewed'::text, 'published'::text]));
