# Preview secrets: exposure and staged isolation plan (039)

No secret value was read or printed. Nothing was changed, revoked or rotated.

## Inventory (Vercel environment targets, names only)

Preview builds and runtime receive 16 variables. Production-only: 7 (GITHUB_REPO, GITHUB_TOKEN, NEXTWAVE_V2_ROUTE_PRODUCTION, PRODUCTION_DEPLOY_HOOK_URL, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI).

| Priority | Variable | Kind | Why it matters in a preview |
|---|---|---|---|
| P1 | SUPABASE_SERVICE_KEY | privileged database | Full read/write to every business's production data; it also reads stored OAuth refresh tokens |
| P1 | YOUTUBE_CLIENT_SECRET (+ CLIENT_ID, REDIRECT_URI) | OAuth | With the service key, a preview can refresh and use the channels' YouTube tokens |
| P1 | PLAID_SECRET (live) + PLAID_CLIENT_ID, PLAID_ENV | financial | Live Plaid API access; previews read the same PLAID_ENV as production |
| P2 | ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, HEYGEN_API_KEY, RUNWAY_API_KEY, SUBMAGIC_API_KEY | paid APIs | Spend and quota abuse |
| P3 | PEXELS_API_KEY, YOUTUBE_API_KEY | low-value API keys | Quota |
| — | APP_URL, PLAID_SECRET_SANDBOX | config / sandbox | Low |

## Exposure paths

1. **Build time.** Every branch pushed to `MMMOS1406/mmmos` builds a preview, and a branch's own `vercel.json` decides the build command. Any code in that branch runs during the build with all 16 values.
   - **Who can push:** the owner and the owner's local sessions only.
   - **Cannot push:** the runner deploy key (staging only), Actions (off), and forks (fork protection on).
2. **Runtime.** Preview functions run with the same values, behind Vercel sign-in (029). One automation-bypass secret exists in Vercel; it does not appear in the public repo.
3. **Not exposed:** the public repo and its history contain no secrets (038 scan).

## Compromise check (039)

- **Deployments:** all 85 in the last 30 days were created by `mmmos1406`, source git, repository `mmmos`. There are no unknown creators or repositories.
- **Code search:** no bypass-token reference in code.
- **Result:** no evidence of compromise, so no emergency rotation is needed.

## Staged plan (each stage needs CEO approval; none costs money)

| Stage | Change | Production impact | Preview impact | Verify | Rollback |
|---|---|---|---|---|---|
| 1 | Preview-only `PLAID_ENV=sandbox`; remove the **Preview** target from `PLAID_SECRET` (production keeps it) | none: production values untouched | previews use Plaid sandbox (the code picks the secret matching PLAID_ENV) | production Plaid health; preview shows sandbox | re-add the Preview target |
| 2 | Remove the **Preview** target from `YOUTUBE_CLIENT_SECRET` | none | previews cannot refresh YouTube tokens (they can't publish anyway: publishing gate) | production autosync cron OK | re-add the target |
| 3 | Replace Preview AI keys with separate, low-limit keys from each provider (or none) | none | preview generation limited | provider dashboards | restore |
| 4 | Previews without `SUPABASE_SERVICE_KEY`: separate non-production Supabase project, or Supabase branching | none | previews need their own data | — | — |

Stage 4 has a cost (a second project or branch-hours), so it needs a CEO spending decision.

**Rotation:** recommended only if a value is ever found exposed. With no evidence of compromise, stages 1–3 change who can reach the secrets without rotating them.

**Before each stage:**
- record the environment target lists;
- check that production deployments keep READY and that the key production checks pass (anonymous-denial verifier, Plaid status, YouTube autosync log);
- record the evidence in the checkpoint.
