-- v13.22 — Plaid items table
-- Stores access_tokens server-side only. Browser never sees these values.
-- RLS: service_role only (no anon/auth read or write).

create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  item_id text unique not null,                 -- Plaid item identifier
  access_token text not null,                   -- Plaid access_token (sensitive)
  institution_id text,
  institution_name text,
  available_products text[],
  billed_products text[],
  user_label text default 'admin',              -- which MMM user owns this connection
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_cursor text                              -- for transactions/sync
);

create index if not exists idx_plaid_items_user on public.plaid_items (user_label);

alter table public.plaid_items enable row level security;

-- Service role can do everything (server-side API routes)
drop policy if exists "service_role_all_plaid_items" on public.plaid_items;
create policy "service_role_all_plaid_items"
  on public.plaid_items
  for all
  to service_role
  using (true)
  with check (true);

-- No anon/auth access — access_token must never leak to browsers
revoke all on public.plaid_items from anon, authenticated;
