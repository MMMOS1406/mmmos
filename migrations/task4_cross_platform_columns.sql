-- MMM OS v12.3 — Task 4: Cross-Platform Package Linking
-- Run in Supabase SQL Editor before deploying

ALTER TABLE packages ADD COLUMN IF NOT EXISTS tiktok_video_id text;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS instagram_reel_id text;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS cross_platform_status text DEFAULT 'pending';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS upload_sync_status jsonb DEFAULT '{}';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS engagement_score numeric DEFAULT 0;
