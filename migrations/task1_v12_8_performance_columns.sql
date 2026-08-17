-- MMM OS v12.8 Task 1 — Add performance sync columns + index
-- Run in Supabase SQL Editor (project: tldcwvtwjypmwynsklsd)
-- Safe: all ADD COLUMN IF NOT EXISTS — no data loss

-- package_performance: new columns for YouTube auto-sync
ALTER TABLE package_performance ADD COLUMN IF NOT EXISTS video_id TEXT;
ALTER TABLE package_performance ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE package_performance ADD COLUMN IF NOT EXISTS upload_timestamp TIMESTAMPTZ;
ALTER TABLE package_performance ADD COLUMN IF NOT EXISTS views_per_day NUMERIC;
ALTER TABLE package_performance ADD COLUMN IF NOT EXISTS hook TEXT;
ALTER TABLE package_performance ADD COLUMN IF NOT EXISTS upload_day TEXT;
ALTER TABLE package_performance ADD COLUMN IF NOT EXISTS upload_hour INT;
ALTER TABLE package_performance ADD COLUMN IF NOT EXISTS auto_linked BOOLEAN DEFAULT false;

-- operator_tasks: new columns for video link-back
ALTER TABLE operator_tasks ADD COLUMN IF NOT EXISTS video_id TEXT;
ALTER TABLE operator_tasks ADD COLUMN IF NOT EXISTS video_url TEXT;

-- Index for get_performance_summary grouping
CREATE INDEX IF NOT EXISTS idx_pkg_perf_engine_mode ON package_performance(engine_id, mode);
