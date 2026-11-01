# Preview-secret reduction — stages 1–3, ready to apply (046)

**PREPARED ONLY.** No environment variable was changed, removed, rotated or read.

All 16 Preview variables are currently stored as one record each, targeting both `preview` and `production`. Every sensitive one is of type "sensitive", so values cannot be read back by anyone. Each change below edits only the **Preview target** of a record; production values are untouched. No cost.

## Stage 1 — Plaid: previews use the sandbox only

| Step | Change | Command (Vercel API, project `prj_02VlGBl7NzDWQWFsQUCchRxc7Hth`) |
|---|---|---|
| 1a | `PLAID_SECRET` (live): remove the Preview target | `PATCH /v9/projects/{id}/env/{PLAID_SECRET id eAut91…}` with `{"target":["production"]}` |
| 1b | `PLAID_ENV`: production keeps its value | `PATCH …/env/{PLAID_ENV id Or5j2q…}` with `{"target":["production"]}` |
| 1c | New Preview-only `PLAID_ENV=sandbox` | `POST /v10/projects/{id}/env` with `{"key":"PLAID_ENV","value":"sandbox","type":"encrypted","target":["preview"]}` |

- **Proof against the real code** (`check-plaid-selection.mjs`, 4/4 PASS):
  - production keeps the live secret and the production API;
  - after stage 1, previews use `PLAID_SECRET_SANDBOX` and `sandbox.plaid.com`;
  - with no sandbox secret, nothing live is used.
- **Production check after applying:** a production deployment stays READY; the Finance/Plaid status shows production mode; the verifier passes.
- **Rollback:** `PATCH` the two records back to `["preview","production"]` and delete the new Preview `PLAID_ENV` record.

## Stage 2 — YouTube: previews cannot refresh channel tokens

| Step | Change | Command |
|---|---|---|
| 2a | `YOUTUBE_CLIENT_SECRET`: remove the Preview target | `PATCH …/env/{id L8bi2r…}` with `{"target":["production"]}` |

- The only use is the OAuth token refresh in `api/ops.js`. Without it, previews log `client_secret_set: false` and cannot act on the channels. Production is unchanged.
- Publishing is already refused without a session (publishing gate, enforce mode).
- **Production check:** the YouTube autosync cron keeps succeeding; the verifier passes.
- **Rollback:** `PATCH` the target back.

## Stage 3 — paid AI/media keys: none in previews (or separate low-limit keys)

| Step | Change |
|---|---|
| 3a | Remove the Preview target from `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`, `RUNWAY_API_KEY`, `SUBMAGIC_API_KEY` |
| 3b (optional) | Add separate low-limit preview keys from each provider. This needs the CEO in each provider console: a new credential, at no cost on existing plans. |

- **Effect:** previews cannot spend on paid generation. The Task Generator falls back to its deterministic extraction in previews, which is already tested.
- **Production check:** generation in production unaffected; the verifier passes.
- **Rollback:** `PATCH` the targets back.

## Not in these stages

- `SUPABASE_SERVICE_KEY` (stage 4): previews need a non-production database. That has a cost, so it is a separate CEO decision.
- `PEXELS_API_KEY`, `YOUTUBE_API_KEY` (read-only quota keys), `APP_URL`, `PLAID_CLIENT_ID`, `PLAID_SECRET_SANDBOX`: low risk. They stay.

## Exact CEO approval needed

> "Approve preview-secret stages 1, 2 and 3a: remove the Preview target from PLAID_SECRET, PLAID_ENV (with a Preview-only PLAID_ENV=sandbox), YOUTUBE_CLIENT_SECRET, ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, HEYGEN_API_KEY, RUNWAY_API_KEY and SUBMAGIC_API_KEY. Production values unchanged."

Claude Code then applies them one stage at a time, with the production check after each stage.
