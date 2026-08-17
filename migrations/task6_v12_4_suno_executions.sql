-- MMM OS v12.4 — Suno Execution Bridge table
-- Run this in the Supabase SQL Editor (project: tldcwvtwjypmwynsklsd)

CREATE TABLE IF NOT EXISTS suno_executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL,
  package_id      UUID,
  engine          TEXT,
  status          TEXT NOT NULL DEFAULT 'not_started',
  suno_prompt     TEXT,
  short_prompt    TEXT,
  lyrics          TEXT,
  short_lyrics    TEXT,
  suno_song_url   TEXT,
  mp3_url         TEXT,
  short_mp3_url   TEXT,
  version_notes   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suno_exec_task_id ON suno_executions(task_id);
CREATE INDEX IF NOT EXISTS idx_suno_exec_status ON suno_executions(status);
CREATE INDEX IF NOT EXISTS idx_suno_exec_engine ON suno_executions(engine);
