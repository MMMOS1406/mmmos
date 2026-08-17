-- MMM OS v12.4 — Upload Queue table
-- Run this in the Supabase SQL Editor (project: tldcwvtwjypmwynsklsd)

CREATE TABLE IF NOT EXISTS upload_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      TEXT,
  local_key    TEXT,
  package_id   UUID,
  engine       TEXT,
  title        TEXT,
  platform     TEXT NOT NULL,
  content_type TEXT,
  asset_url    TEXT,
  upload_url   TEXT,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'ready_to_upload',
  uploaded_at  TIMESTAMPTZ,
  verified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_queue_local_key ON upload_queue(local_key);
CREATE INDEX IF NOT EXISTS idx_upload_queue_task_id   ON upload_queue(task_id);
CREATE INDEX IF NOT EXISTS idx_upload_queue_status    ON upload_queue(status);
