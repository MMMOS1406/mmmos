# Preview-secret stages 1, 2 and 3a — final readiness recheck (047)

**NOT APPLIED.** No environment variable was changed, added, removed or read. This recheck supersedes `PREVIEW_SECRET_STAGES_046.md` where the two differ (two corrections below). Stage 4 stays a separate decision.

## 1. Current targets (re-read 2026-11-01, names and targets only, via `vercel env ls`)

- 23 variables in total. 16 reach Preview, the same 16 as in 046.
- 7 are production-only: NEXTWAVE_V2_ROUTE_PRODUCTION, GITHUB_TOKEN, PRODUCTION_DEPLOY_HOOK_URL, GITHUB_REPO and the 3 TIKTOK_* variables.
- Nothing has changed since 046.

## 2. Exact changes (unchanged from 046)

| Stage | Record | Today | After |
|---|---|---|---|
| 1a | PLAID_SECRET (eAut91…) | Preview + Production | Production |
| 1b | PLAID_ENV (Or5j2q…) | Production + Preview | Production |
| 1c | new PLAID_ENV = `sandbox` | — | Preview |
| 2a | YOUTUBE_CLIENT_SECRET (L8bi2r…) | Production + Preview | Production |
| 3a | ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, HEYGEN_API_KEY, RUNWAY_API_KEY, SUBMAGIC_API_KEY | Preview + Production | Production |

**Production targets: unchanged.**
- Every change only removes `preview` from a record (or adds a preview-only record), and no production value is touched.
- An environment change does not redeploy anything. The live production deployment (dpl_6jmdF5CE…) keeps running as it is, and the next production build reads the same production values.

## 3. Preview functionality that stops working (new preview builds only)

| Stage | Stops working in previews | How it fails (checked in code on main 71546c3) |
|---|---|---|
| 1 | Live Plaid (real bank data) | Previews switch to Plaid sandbox (`PLAID_SECRET_SANDBOX`, sandbox.plaid.com). Proven 4/4 again in 047 with `check-plaid-selection.mjs`. |
| 2 | YouTube token refresh, the OAuth connect callback, the status-page token recovery and the manual sync | **Correction:** 046 said the token refresh was the only use. The key is used in 4 files: `api/ops.js` (`_refreshYoutubeToken`), `api/youtube/callback.js`, `api/youtube/status.js` and `api/youtube/sync.js`. Google refuses the request without the secret. The status page reports "recoverable retry" and writes nothing. A preview sync adds one error row to `youtube_sync_logs`. **No production YouTube connection row is changed.** |
| 3a | All paid AI and media generation: Anthropic (generate and the Task Generator model step), ElevenLabs voice, HeyGen render, Runway, Submagic captions | Each handler refuses cleanly (`*_not_configured`, or `ok:false`). The Task Generator falls back to its deterministic extraction (tested). |

Production keeps all of these.

## 4. Correction: existing preview deployments keep the old values

- Vercel bakes variables into each deployment when it is built.
- 87 preview deployments are READY (built 2026-09-19 to 2026-11-01, 39 branches). They keep the current preview secrets until they are removed or expire.
- They sit behind Vercel preview login (SSO), so this is not public exposure. But stages 1–3a fully take effect only for **new** preview builds.
- Optional follow-up (a separate CEO decision, irreversible): delete old preview deployments, or set a deployment retention policy. Not part of stages 1–3a.

## 5. Apply procedure (per stage, after CEO approval)

1. Record the before-state: names and targets only.
2. Apply the one stage through the Vercel API or dashboard.
   - The records are encrypted or sensitive. Their values cannot be read and are never needed.
   - If a target edit is refused, stop and report. Never re-enter a value.
3. Health checks:
   - production deployment still READY, the same ID;
   - anonymous verifier 19/19 (17 reads plus 2 public pages);
   - `vercel env ls` shows production on every record;
   - stage 1: Finance status shows production mode;
   - stage 2: the next daily YouTube autosync run succeeds;
   - stage 3a: one production read of the Task Generator status.
4. Preview check (optional): a new preview build of a docs-only branch logs the expected "not configured" or sandbox results.

## 6. Rollback (per stage, about 1 minute, no redeploy needed for production)

- **Stage 1:** PATCH both records back to `["preview","production"]` and delete the new preview-only PLAID_ENV.
- **Stages 2 and 3a:** PATCH the targets back to `["preview","production"]`.
- Production is never affected by the change, so rollback only restores previews. New preview builds pick it up.

## 7. Stage 4 (separately gated, unchanged)

`SUPABASE_SERVICE_KEY` still reaches Preview, so previews write to the production database. Removing it needs a non-production database, which has a cost. That is a separate CEO decision.

## 8. Readiness

**READY TO APPLY** on CEO approval. Exact approval wording:

> "Approve preview-secret stages 1, 2 and 3a: remove the Preview target from PLAID_SECRET, PLAID_ENV (with a Preview-only PLAID_ENV=sandbox), YOUTUBE_CLIENT_SECRET, ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, HEYGEN_API_KEY, RUNWAY_API_KEY and SUBMAGIC_API_KEY. Production values unchanged."
