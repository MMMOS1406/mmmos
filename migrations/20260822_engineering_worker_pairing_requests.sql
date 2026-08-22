-- CEO Decision #17 Step 2D — Secure Cowork Pairing Flow
-- NOT YET APPLIED to the live database. Prepared and tested against a mocked
-- harness only, per the Step 2D order's "do NOT deploy without separate CEO
-- authorization" boundary — this schema change is part of what a future
-- authorized push+deploy step would apply.
--
-- Mirrors engineering_workers' own security posture exactly: RLS enabled,
-- zero policies defined, so the publishable/anon key (already embedded
-- client-side and in the MCP server) gets default-deny on every operation.
-- Only api/ops.js, using SUPABASE_SERVICE_KEY (which bypasses RLS), can ever
-- read or write this table. No pairing row is ever readable via the
-- publishable key at any point in its lifecycle.

create table if not exists engineering_worker_pairing_requests (
  id                 uuid primary key default gen_random_uuid(),
  label              text not null,
  pairing_secret_hash text,               -- cleared (set null) once consumed by engineeringWorkerPairingComplete
  status             text not null default 'pending', -- pending | approved | rejected | expired | completed
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  approved_at        timestamptz,
  approved_by        text,
  completed_at       timestamptz,
  worker_id          uuid references engineering_workers(id)
);

create index if not exists idx_engineering_worker_pairing_status
  on engineering_worker_pairing_requests(status);

alter table engineering_worker_pairing_requests enable row level security;
-- Intentionally no policies: default-deny to anon/authenticated (publishable
-- key). Server-side access only, via SUPABASE_SERVICE_KEY in api/ops.js.
