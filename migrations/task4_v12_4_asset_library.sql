-- MMM OS v12.4 — Task 4: Asset Management Layer
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS production_assets_library (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type  TEXT NOT NULL,
  asset_name  TEXT NOT NULL,
  asset_url   TEXT,
  engine      TEXT,
  package_id  UUID,
  pipeline_id UUID,
  source      TEXT,
  platform    TEXT,
  tags        TEXT[],
  version     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'draft',
  uploaded_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_lib_type    ON production_assets_library(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_lib_engine  ON production_assets_library(engine);
CREATE INDEX IF NOT EXISTS idx_assets_lib_status  ON production_assets_library(status);
CREATE INDEX IF NOT EXISTS idx_assets_lib_pipeline ON production_assets_library(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_assets_lib_package  ON production_assets_library(package_id);
