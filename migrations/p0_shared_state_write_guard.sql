-- APPLIED TO PRODUCTION 2026-09-28 14:31:12 UTC (migration version 20260928143112). Recorded here for the repo.
-- P0 2026-09-28: block catastrophic shrink/reset/delete of shared app state (mmm_finance_v118).
-- Incident: a client saved default/near-empty state over the full company state (tasks ~80 -> 1).
-- Bypass for an approved server-side restore only: SET LOCAL mmm.allow_state_shrink = 'on'.
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

drop trigger if exists mmm_state_write_guard_upd on public.app_settings;
create trigger mmm_state_write_guard_upd before update on public.app_settings
  for each row execute function public.mmm_state_write_guard();
drop trigger if exists mmm_state_write_guard_del on public.app_settings;
create trigger mmm_state_write_guard_del before delete on public.app_settings
  for each row execute function public.mmm_state_write_guard();
