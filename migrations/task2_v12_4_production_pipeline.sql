-- MMM OS v12.4 — Task 2: Content Production Pipeline
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS production_pipeline (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id    UUID,
  title         TEXT NOT NULL,
  engine        TEXT,
  content_type  TEXT,
  stage         TEXT NOT NULL DEFAULT 'idea',
  platform      TEXT,
  assigned_to   TEXT NOT NULL DEFAULT 'va',
  missing_assets TEXT[],
  stalled       BOOLEAN NOT NULL DEFAULT FALSE,
  stalled_since TIMESTAMPTZ,
  due_date      TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID REFERENCES production_pipeline(id) ON DELETE CASCADE,
  asset_type  TEXT NOT NULL,
  asset_name  TEXT,
  asset_url   TEXT,
  source      TEXT,
  status      TEXT NOT NULL DEFAULT 'missing',
  uploaded_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stage       ON production_pipeline(stage);
CREATE INDEX IF NOT EXISTS idx_pipeline_assigned_to ON production_pipeline(assigned_to);
CREATE INDEX IF NOT EXISTS idx_pipeline_stalled     ON production_pipeline(stalled);
CREATE INDEX IF NOT EXISTS idx_assets_pipeline_id   ON production_assets(pipeline_id);
