-- MMM OS v12.3 — Task 5: API Queue Stabilization
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS api_queue (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  provider      text        NOT NULL,
  job_type      text        NOT NULL,
  payload       jsonb       DEFAULT '{}',
  status        text        DEFAULT 'pending',
  priority      integer     DEFAULT 5,
  attempts      integer     DEFAULT 0,
  max_attempts  integer     DEFAULT 3,
  error_message text,
  scheduled_at  timestamptz DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_queue_status_priority
  ON api_queue(status, priority DESC, scheduled_at ASC);

CREATE INDEX IF NOT EXISTS api_queue_provider_status
  ON api_queue(provider, status);

CREATE INDEX IF NOT EXISTS api_queue_started_at
  ON api_queue(started_at);
