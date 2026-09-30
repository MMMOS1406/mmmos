-- SRV Farsi P1-C: analytics view that excludes SRV Farsi test uploads.
-- Additive and read-only. Apply BEFORE deploying the code that reads it.
-- Rule (deterministic): a video on the SRV Farsi channel whose title starts with "[TEST]" is a test upload.
-- SRV Farsi's test-mode publish always prefixes "[TEST]" and uploads private. Nothing else is guessed:
-- packages flagged isTest whose upload is public without the prefix stay in analytics (reported as
-- unresolved in the P1 checkpoint).
-- Every other channel's rows are returned unchanged, so other businesses' analytics are identical.
-- The raw table public.youtube_videos is untouched (test records kept for engineering/debugging).
create or replace view public.youtube_videos_analytics
with (security_invoker = true) as
select v.*
from public.youtube_videos v
where not exists (
  select 1 from public.youtube_channels c
  where c.channel_id = v.channel_id
    and c.mmm_engine = 'SRV Farsi'
    and v.title like '[TEST]%'
);

grant select on public.youtube_videos_analytics to anon, authenticated;

comment on view public.youtube_videos_analytics is
  'youtube_videos for analytics/performance summaries: identical to youtube_videos except SRV Farsi test uploads (title starts with [TEST]) are excluded. Raw data stays in youtube_videos.';
