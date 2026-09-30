-- MMMOS platform: business-state isolation for the shared app-state row (app_settings.mmm_finance_v118).
-- NOT YET APPLIED TO PRODUCTION. Additive and inert until:
--   1) the merge-aware client (saveAppState -> rpc/mmm_state_save) is live, then
--   2) mmm_platform_flags.state_merge_only is switched on.
-- Business-agnostic by construction: contains no engine names. Arrays of objects merge per (engine,id);
-- objects merge per key; anything a client did not change keeps the server's current value.
-- Requires migration p0_shared_state_write_guard (applied 2026-09-28 14:31 UTC); this file replaces
-- its guard function with the same checks plus the state_merge_only enforcement.

create table if not exists public.mmm_platform_flags (
  flag text primary key,
  enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.mmm_platform_flags enable row level security; -- no anon/authenticated policies: only server-side SQL can flip flags
insert into public.mmm_platform_flags(flag, enabled, note) values
  ('state_merge_only', false, 'When true, direct whole-row writes to mmm_finance_v118 are rejected; only mmm_state_save (3-way merge) may write it. Switch on only after the merge-aware client is in production.')
on conflict (flag) do nothing;

-- Read-only flag lookup usable from triggers fired by anon/authenticated writes. The flags table has RLS
-- with no client policies, so a plain SELECT from a client-role trigger would see no rows (flag always
-- "off"). SECURITY DEFINER returns just the boolean; clients still cannot read or change the table.
create or replace function public.mmm_platform_flag_enabled(p_flag text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from public.mmm_platform_flags where flag = p_flag), false)
$$;
revoke all on function public.mmm_platform_flag_enabled(text) from public;
grant execute on function public.mmm_platform_flag_enabled(text) to anon, authenticated;

-- 3-way merge: c = current server value, b = base the client loaded, n = what the client wants to save.
-- SQL NULL means "absent".
create or replace function public.mmm_json_merge3(c jsonb, b jsonb, n jsonb)
returns jsonb language plpgsql immutable as $$
declare
  k text; v jsonb; res jsonb; e jsonb; ek text;
  cm jsonb := '{}'; bm jsonb := '{}'; nm jsonb := '{}'; seen jsonb := '{}';
  keyed boolean;
begin
  if n is not distinct from b then return c; end if;   -- client did not touch it: keep current
  if c is not distinct from b then return n; end if;   -- only the client changed it
  if n is null then return c; end if;                  -- client deleted, someone else changed: keep
  if c is null then return n; end if;                  -- someone else deleted, client changed: keep client's
  if jsonb_typeof(c) = 'object' and jsonb_typeof(n) = 'object' and (b is null or jsonb_typeof(b) = 'object') then
    res := '{}';
    for k in select x from (select jsonb_object_keys(c) x union select jsonb_object_keys(n)
                            union select jsonb_object_keys(coalesce(b, '{}'))) s loop
      v := public.mmm_json_merge3(c -> k, b -> k, n -> k);
      if v is not null then res := res || jsonb_build_object(k, v); end if;
    end loop;
    return res;
  end if;
  if jsonb_typeof(c) = 'array' and jsonb_typeof(n) = 'array' and (b is null or jsonb_typeof(b) = 'array') then
    -- keyed merge only when every element (c, b, n) is an object carrying an id
    select coalesce(bool_and(jsonb_typeof(x) = 'object' and (x ? 'id')), true) into keyed
      from (select jsonb_array_elements(c) x union all select jsonb_array_elements(n)
            union all select jsonb_array_elements(coalesce(b, '[]'))) s;
    if keyed then
      for e in select jsonb_array_elements(c) loop cm := cm || jsonb_build_object(coalesce(e->>'engine','') || '|' || (e->>'id'), e); end loop;
      for e in select jsonb_array_elements(coalesce(b,'[]')) loop bm := bm || jsonb_build_object(coalesce(e->>'engine','') || '|' || (e->>'id'), e); end loop;
      for e in select jsonb_array_elements(n) loop nm := nm || jsonb_build_object(coalesce(e->>'engine','') || '|' || (e->>'id'), e); end loop;
      res := '[]';
      -- client's order first, then elements only the server has
      for e in select jsonb_array_elements(n) loop
        ek := coalesce(e->>'engine','') || '|' || (e->>'id');
        if seen ? ek then continue; end if;
        seen := seen || jsonb_build_object(ek, true);
        v := public.mmm_json_merge3(cm -> ek, bm -> ek, nm -> ek);
        if v is not null then res := res || jsonb_build_array(v); end if;
      end loop;
      for e in select jsonb_array_elements(c) loop
        ek := coalesce(e->>'engine','') || '|' || (e->>'id');
        if seen ? ek then continue; end if;
        seen := seen || jsonb_build_object(ek, true);
        v := public.mmm_json_merge3(cm -> ek, bm -> ek, nm -> ek);
        if v is not null then res := res || jsonb_build_array(v); end if;
      end loop;
      return res;
    end if;
  end if;
  return n; -- both changed the same leaf / unkeyed array: last writer wins for that leaf only
end $$;

-- Merge-save entry point for clients. Locks the row so concurrent saves serialize.
create or replace function public.mmm_state_save(p_key text, p_base jsonb, p_new jsonb)
returns jsonb language plpgsql as $$
declare cur jsonb; merged jsonb; k text;
begin
  if p_key !~ '^(mmm_finance_v118|mmm_isolation_test_[a-z0-9_]+)$' then
    raise exception 'MMM_STATE_ISOLATION: key % is not merge-managed', p_key using errcode = 'P0001';
  end if;
  if p_new is null or jsonb_typeof(p_new) <> 'object' then
    raise exception 'MMM_STATE_ISOLATION: p_new must be a JSON object' using errcode = 'P0001';
  end if;
  perform set_config('mmm.via_merge', 'on', true); -- before the SELECT: PERFORM would reset FOUND
  select value::jsonb into cur from public.app_settings where key = p_key for update;
  if not found then
    insert into public.app_settings(key, value) values (p_key, p_new::text);
    return p_new;
  end if;
  if p_base is null or jsonb_typeof(p_base) <> 'object' then
    raise exception 'MMM_STATE_ISOLATION: base required to save %', p_key using errcode = 'P0001';
  end if;
  -- top-level keys this client did not send are not managed by it: treat as unchanged
  for k in select jsonb_object_keys(p_base) loop
    if not (p_new ? k) then p_new := p_new || jsonb_build_object(k, p_base -> k); end if;
  end loop;
  merged := public.mmm_json_merge3(cur, p_base, p_new);
  update public.app_settings set value = merged::text, updated_at = now() where key = p_key;
  return merged;
end $$;

grant execute on function public.mmm_state_save(text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.mmm_json_merge3(jsonb, jsonb, jsonb) to anon, authenticated;

-- Existing catastrophic-shrink guard, plus: once state_merge_only is on, only mmm_state_save may write the row.
create or replace function public.mmm_state_write_guard() returns trigger
language plpgsql as $$
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
    raise exception 'MMM_STATE_GUARD: blocked catastrophic shrink of % (tasks % -> %, bytes % -> %)',
      NEW.key, ot, nt, ol, nl using errcode = 'P0001';
  end if;
  return NEW;
end $$;
