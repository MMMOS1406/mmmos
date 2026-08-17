-- MMM OS v12.4 — Task 1: VA Operator Workspace
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS operator_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  description       TEXT,
  engine            TEXT,
  priority          INT NOT NULL DEFAULT 5,
  due_date          DATE,
  status            TEXT NOT NULL DEFAULT 'open',
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status   TEXT,
  assigned_to       TEXT NOT NULL DEFAULT 'va',
  created_by        TEXT NOT NULL DEFAULT 'admin',
  completion_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operator_activity_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES operator_tasks(id) ON DELETE CASCADE,
  user_role  TEXT NOT NULL,
  action     TEXT NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operator_tasks_status      ON operator_tasks(status);
CREATE INDEX IF NOT EXISTS idx_operator_tasks_assigned_to ON operator_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_op_logs_task_id            ON operator_activity_logs(task_id);
