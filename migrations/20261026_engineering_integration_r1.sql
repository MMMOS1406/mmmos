-- MMMOS Engineering Integration — Release 1
-- NOT APPLIED to the live database. Apply only after CEO release approval,
-- BEFORE (or together with) the deploy of the matching api/ops.js. If the code
-- ships first, the new adviser actions fail closed (401 / signed_upload_failed);
-- nothing existing changes behaviour.
--
-- 1. engineering_advisers — the ChatGPT CEO Adviser identity, kept in its own
--    table so an adviser credential can never authenticate as an Engineering
--    Worker (and the reverse). Same posture as engineering_workers: RLS on,
--    zero policies, so only the server's service role can read or write it.
-- 2. engineering-artifacts — a PRIVATE storage bucket for engineering output
--    (videos, screenshots, source bundles, checkpoints, QA reports). No
--    storage.objects policies are added, so anon/authenticated get nothing;
--    the server hands out short-lived signed URLs instead. srv-assets (the
--    existing public bucket) is not touched.
-- Idempotent: safe to run more than once.

create table if not exists public.engineering_advisers (
  id               uuid primary key default gen_random_uuid(),
  label            text not null,
  credential_hash  text not null unique,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       text not null default 'ceo',
  revoked_at       timestamptz,
  revoked_by       text,
  last_seen_at     timestamptz
);

alter table public.engineering_advisers enable row level security;
-- Intentionally no policies: default-deny to anon/authenticated.
revoke all on table public.engineering_advisers from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'engineering-artifacts', 'engineering-artifacts', false, 524288000,
  array[
    'video/mp4', 'video/quicktime', 'video/webm',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'application/json', 'application/zip', 'application/gzip', 'application/x-tar',
    'text/plain', 'text/markdown', 'text/html', 'text/csv',
    'audio/mpeg', 'audio/wav'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
