create policy nextwave_finance_pilot_keys_no_public_insert on public.app_settings
  as restrictive for insert to anon, authenticated
  with check (left(key, 23) <> 'nextwave_finance_pilot_');
create policy nextwave_finance_pilot_keys_no_public_update on public.app_settings
  as restrictive for update to anon, authenticated
  using (left(key, 23) <> 'nextwave_finance_pilot_') with check (left(key, 23) <> 'nextwave_finance_pilot_');
create policy nextwave_finance_pilot_keys_no_public_delete on public.app_settings
  as restrictive for delete to anon, authenticated
  using (left(key, 23) <> 'nextwave_finance_pilot_');
