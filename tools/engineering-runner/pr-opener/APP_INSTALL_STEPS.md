# H4 — GitHub App "MMMOS Runner PR Opener": review and CEO install steps (038)

## Review of the prepared manifest (`github-app-manifest.json`)

| Permission | Level | Why it is needed | Why it cannot merge or release |
|---|---|---|---|
| Contents | Read and write | Create the `runner/<task>` branch, its blobs/tree/commit in `MMMOS1406/mmmos`, and read the staging branch | Ruleset `26286416` lets no one except repository admins create/update/delete any branch other than `runner/**`. Merging is an update of `main`, so the App is refused. Ruleset `26252619` also requires a PR on `main`, with no bypass. |
| Pull requests | Read and write | Open a **draft** PR | It can comment or review, but approvals grant nothing (0 required reviews) and it still cannot update `main` |
| Metadata | Read | Mandatory for every App | — |
| Everything else | No access | Administration, Secrets, Actions, Workflows, Environments, Deployments, Checks, Pages, Members: **none** | — |

- **Webhooks:** none. **Events:** none. **Installable on:** this account only. **Repositories:** only `mmmos` and `mmmos-runner-staging`.
- GitHub has no "create PR only" permission. Branch creation requires Contents: write. **Merging is blocked by the rulesets, not by the permission list**; this is the correct server-side control.
- **Production release is impossible for the App:** production builds only from `main` (release guard), and the App cannot update `main`.

## CEO steps (about 3 minutes, on github.com while signed in as MMMOS1406)

1. Settings → Developer settings → **GitHub Apps** → **New GitHub App**.
2. **GitHub App name:** `MMMOS Runner PR Opener`. **Homepage URL:** `https://mmm-static.vercel.app`.
3. **Webhook:** untick **Active**.
4. **Repository permissions:** Contents = **Read and write**; Pull requests = **Read and write**; Metadata = Read-only (set automatically). Leave every other permission at **No access**. Account permissions: none. Subscribe to events: none.
5. **Where can this GitHub App be installed?** **Only on this account** → **Create GitHub App**.
6. On the App page: note the **App ID** (not a secret). Click **Generate a private key**.
   - A `.pem` file downloads. **Keep it offline.**
   - Do not paste it into any chat, document or field. It is not needed until the PM approves activation.
7. Left menu → **Install App** → **Only select repositories** → choose `mmmos` and `mmmos-runner-staging` → **Install**.
   - The page address ends in `/installations/<number>`. That number is the installation ID (not a secret).
8. Tell the engineering chat: "PR Opener App installed, App ID ___, installation ID ___". IDs only.

## What Claude Code verifies after installation (no private key needed)

- **Correction (039):** a normal user token cannot list App installations (GitHub returns 403 for `GET /user/installations`), so scope is verified in two ways:
  1. **Read-only, right after install:** the CEO's reply gives the App ID and installation ID. Claude Code checks with `gh api` that rulesets `26252619` and `26286416` are unchanged, with no bypass for any App.
  2. **At activation (separate PM approval):** the server mints its own installation token, and GitHub's response states the exact `permissions` and `repositories`. The controlled test refuses to continue unless they are exactly `contents:write, pull_requests:write, metadata:read` on `mmmos` and `mmmos-runner-staging`.
- Rulesets `26252619` and `26286416` are still active, with no App in any bypass list.
- The opener stays **inactive**: no `ENG_PR_*` / `ENG_RUNNER_STAGING_REPO` setting in Vercel. `open_runner_pull_request` keeps answering 503 `pr_opener_not_configured`.

## Activation (later, separate PM approval)

- The CEO adds the private key and IDs as **production-only** Vercel environment variables:
  - `ENG_PR_APP_ID`
  - `ENG_PR_APP_INSTALLATION_ID`
  - `ENG_PR_APP_PRIVATE_KEY`
  - `ENG_RUNNER_STAGING_REPO=MMMOS1406/mmmos-runner-staging`
- Claude Code then runs the controlled test:
  - one runner-authorized task;
  - branch to staging;
  - draft PR opened;
  - App merge attempt refused (expected 405/409 rule violation);
  - push to `main` refused.
- **Rollback:** delete the four environment variables (the opener is inactive again), or uninstall/delete the App.
