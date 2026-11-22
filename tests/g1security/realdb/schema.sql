-- Throwaway NON-production schema for the lock test: the shape of the production table `public.app_settings` (key text PK, value text, updated_at timestamptz default now(), RLS on)
-- and the same UPDATE/DELETE guard trigger that production has on it (copied from the production function definition). Local database only; no production data.
create role authenticator login noinherit;
create role anon nologin;
create role service_role nologin bypassrls;
grant anon, service_role to authenticator;
create table public.app_settings (key text primary key, value text, updated_at timestamptz default now());
alter table public.app_settings enable row level security;
grant usage on schema public to anon, service_role;
grant all on public.app_settings to service_role;
create function public.mmm_platform_flag_enabled(text) returns boolean language sql as $$ select false $$;
create or replace function public.mmm_state_write_guard() returns trigger language plpgsql as $function$
declare o jsonb; n jsonb; ot int; nt int; ol int; nl int;
begin
  if coalesce(current_setting('mmm.allow_state_shrink', true),'') = 'on' then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;
  if TG_OP = 'DELETE' then
    if OLD.key = 'mmm_finance_v118' then
      raise exception 'MMM_STATE_GUARD: blocked delete of %', OLD.key using errcode = 'P0001';
    end if;
    return OLD;
  end if;
  if NEW.key <> 'mmm_finance_v118' then return NEW; end if;
  if coalesce(current_setting('mmm.via_merge', true),'') <> 'on'
     and public.mmm_platform_flag_enabled('state_merge_only') then
    raise exception 'MMM_STATE_ISOLATION: direct whole-state write to % rejected; use rpc mmm_state_save', NEW.key using errcode = 'P0001';
  end if;
  begin o := OLD.value::jsonb; exception when others then return NEW; end;
  begin n := NEW.value::jsonb; exception when others then
    raise exception 'MMM_STATE_GUARD: blocked non-JSON write to %', NEW.key using errcode = 'P0001';
  end;
  ot := coalesce(jsonb_array_length(case when jsonb_typeof(o->'tasks')='array' then o->'tasks' end),0);
  nt := coalesce(jsonb_array_length(case when jsonb_typeof(n->'tasks')='array' then n->'tasks' end),0);
  ol := length(OLD.value); nl := length(NEW.value);
  if (ot >= 10 and nt*4 < ot) or (ol >= 20000 and nl*4 < ol) then
    raise exception 'MMM_STATE_GUARD: blocked catastrophic shrink of % (tasks % -> %, bytes % -> %)', NEW.key, ot, nt, ol, nl using errcode = 'P0001';
  end if;
  return NEW;
end $function$;
create trigger mmm_state_write_guard_upd before update on public.app_settings for each row execute function public.mmm_state_write_guard();
create trigger mmm_state_write_guard_del before delete on public.app_settings for each row execute function public.mmm_state_write_guard();
-- the tables the autosync handler itself reads/writes (minimal columns)
create table public.youtube_connections (channel_id text primary key, status text, refresh_token text, scope text);
create table public.youtube_channels (channel_id text primary key, mmm_engine text, title text);
create table public.youtube_sync_logs (id bigserial primary key, channel_id text, status text, message text, synced_at timestamptz);
create table public.tiktok_connections (open_id text primary key, status text, mmm_engine text);
grant all on public.youtube_connections, public.youtube_channels, public.youtube_sync_logs, public.tiktok_connections to service_role;
grant usage, select on sequence public.youtube_sync_logs_id_seq to service_role;
