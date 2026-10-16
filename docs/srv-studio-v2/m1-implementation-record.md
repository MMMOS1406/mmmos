# SRV Studio V2 — M1 implementation record (order SRV-STUDIO-V2-018)

CEO decision: M1 APPROVED. Applied 2026-10-15 to production Supabase `tldcwvtwjypmwynsklsd`.

## Change
- Migration `20261015211556` `srv_studio_v2_app_settings_write_lock`, exactly the three policies in
  `e4-app-settings-v2-write-lock.sql`: `srv_studio_v2_keys_no_public_insert` / `_update` / `_delete`,
  RESTRICTIVE, roles `anon, authenticated`, predicate `left(key, 14) <> 'srv_studio_v2_'`.
- No other policy, grant, table, row, or business touched. No deploy, no V2 activation, no upload.

## Pre-change baseline (matched E4 audit — no STOP condition)
- RLS enabled; 3 policies: `anon_full_access_app_settings` (permissive ALL anon, true/true),
  `block_anon_ceo_lockout`, `block_anon_ceo_lockout_production` (restrictive ALL anon).
- Grants: anon/authenticated SELECT/INSERT/UPDATE/DELETE; service_role bypasses RLS.
- 116 rows, 0 `srv_studio_v2_*` rows.

## Post-change verification (production, inside a transaction rolled back by RAISE EXCEPTION)
| Probe | anon | authenticated | service_role |
|---|---|---|---|
| INSERT `srv_studio_v2_enabled` | refused (RLS) | refused | ok |
| UPSERT `srv_studio_v2_pilot` | refused | refused | — |
| UPDATE `srv_studio_v2_pilot_ledger` | 0 rows | 0 rows | 1 row |
| DELETE `srv_studio_v2_pilot_ledger` | 0 rows | 0 rows | ok |
| SELECT V2 rows | readable | — | — |
| INSERT/UPDATE/DELETE other key | ok (unchanged) | — | — |
| CEO lockout key | still refused | — | — |

After the probe: 116 rows, 0 V2/probe rows (nothing persisted). Policy count 6.

## Regression (local, bounded)
SRV Studio: E4 security 8/8, pilot 37/37, isolation 32/32, lifecycle 81/81, music 71/71.
SRV Farsi: analytics 17, P1 safety 37, VA artist format 32, visuals 77 — all pass. P0 state guard 8/8.
NextWave: discard 18, dup 25, pkg resolution 13, preview close 36, closeout 28 pass; production route 161 pass / 3 fail (pre-existing baseline, also fails on main).
CEO release UI 29/29. Platform: release isolation 13, client isolation e2e 11, state isolation 33 — pass.

## Rollback (ready, untested in prod; exercised in PGlite replica test)
```sql
drop policy if exists srv_studio_v2_keys_no_public_insert on public.app_settings;
drop policy if exists srv_studio_v2_keys_no_public_update on public.app_settings;
drop policy if exists srv_studio_v2_keys_no_public_delete on public.app_settings;
```

## MMMOS Engineering Brain
`eb_create_task` was refused by RLS on `engineering_tasks` (42501) for this client; this file is the record
until the Engineering Brain write path is restored or an operator records it.
