-- MMM OS v12.4 — Task 3: Internal Approval System
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type     TEXT NOT NULL,
  item_id       UUID,
  item_title    TEXT,
  submitted_by  TEXT NOT NULL,
  assigned_to   TEXT NOT NULL DEFAULT 'admin',
  status        TEXT NOT NULL DEFAULT 'pending',
  approval_type TEXT,
  notes         TEXT,
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revision_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id    UUID REFERENCES approvals(id) ON DELETE CASCADE,
  requested_by   TEXT NOT NULL,
  revision_notes TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approvals_status       ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_submitted_by ON approvals(submitted_by);
CREATE INDEX IF NOT EXISTS idx_approvals_assigned_to  ON approvals(assigned_to);
CREATE INDEX IF NOT EXISTS idx_revisions_approval_id  ON revision_requests(approval_id);
