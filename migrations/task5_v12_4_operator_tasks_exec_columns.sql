-- MMM OS v12.4 — Execution workspace columns for operator_tasks
-- Run this in the Supabase SQL Editor (project: tldcwvtwjypmwynsklsd)

ALTER TABLE operator_tasks
  ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_notes TEXT,
  ADD COLUMN IF NOT EXISTS asset_checklist JSONB DEFAULT '[]';
