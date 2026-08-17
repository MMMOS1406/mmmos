-- MMM OS v12.4 — Add local_key column to suno_executions for weekly task lookup
-- Run this in the Supabase SQL Editor (project: tldcwvtwjypmwynsklsd)

ALTER TABLE suno_executions ADD COLUMN IF NOT EXISTS local_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_suno_exec_local_key
  ON suno_executions(local_key) WHERE local_key IS NOT NULL;
