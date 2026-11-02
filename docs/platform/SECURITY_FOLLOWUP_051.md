# Security follow-up (Order 051) — review only, nothing changed

## 1. app_settings (and other) TRUNCATE grants

**Finding (read-only, 2026-11-02 04:00Z).**
- The public roles `anon` and `authenticated` hold TRUNCATE on **57 of 95** public tables, including `app_settings`. They also hold REFERENCES and TRIGGER.
- The source is Supabase's default privileges for `postgres` and `supabase_admin` in `public` (`arwdDxtm` = all table privileges).
- Row-level security does **not** govern TRUNCATE, so the restrictive policies (CEO lockout, SRV Studio V2, Finance Pilot write-lock) would not stop it.

**Actual risk: LOW, latent (not exploitable today).** The checks:
- `anon` and `authenticated` cannot log in. They are reached only through `authenticator` (PostgREST).
- PostgREST exposes no TRUNCATE operation.
- No function in `public` contains TRUNCATE.
- No function executable by `anon` runs dynamic SQL (`EXECUTE`).
- `pg_graphql` is not installed.

It would become exploitable if any of these is ever added:
- a function callable with the public key that runs dynamic SQL;
- direct database login for these roles;
- another API layer that maps to TRUNCATE.

**Related, larger and pre-existing:** `anon_full_access_app_settings` lets the public key insert, update and delete any `app_settings` row without a restrictive policy. The shared-state guard trigger blocks catastrophic shrinks of `mmm_finance_v118` only. This is the same class of exposure the per-prefix write-locks close one namespace at a time.

**Recommended remediation (PREPARED, NOT APPLIED; needs CEO authorization as a database change):**
```sql
-- Defense in depth: the app never needs these privileges through the public roles.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;
-- (supabase_admin default privileges can only be changed by supabase_admin; new tables created by
--  migrations run as postgres, so the line above covers them.)
```
- **Verify:** `select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER');` returns 0. Then the anonymous verifier and the full suites.
- **Rollback:** `grant truncate, references, trigger on all tables in schema public to anon, authenticated;` and the matching `alter default privileges … grant …`.
- **Expected impact:** none. No app path uses these privileges.

## 2. Remaining Preview-secret exposure (unchanged since 048)

- **Targets:** re-read 2026-11-02 04:02Z, names only. 24 records, unchanged since stage 3a. 9 variables reach Preview: APP_URL, PEXELS_API_KEY, PLAID_CLIENT_ID, PLAID_ENV (sandbox), PLAID_SECRET_SANDBOX, SUPABASE_SERVICE_KEY, YOUTUBE_API_KEY, YOUTUBE_CLIENT_ID, YOUTUBE_REDIRECT_URI.
- **Old preview deployments:** 93 READY. 88 were built before the 048 stage changes and still hold the earlier preview values (live Plaid secret, YouTube client secret, paid AI/media keys). All sit behind Vercel preview login. Removing them, or setting a retention policy, is a separate CEO decision (irreversible).
- **Stage 4:** `SUPABASE_SERVICE_KEY` still reaches every new preview. Preview code runs with full database rights against **production** data (RLS bypassed), including the Finance Pilot rows. Removing it needs a non-production database (cost). Separate CEO decision.
- No environment, secret, deployment or database setting was changed by this review.
