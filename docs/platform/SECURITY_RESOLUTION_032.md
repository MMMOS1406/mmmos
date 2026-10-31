# MMMOS-R2-SECURITY-RESOLUTION-032 — checkpoint (2026-10-31)

Order: ChatGPT PM. Investigation and design only. **No credential, repository setting, environment variable,
deployment policy or server privilege was created or changed.** Prepared (not applied) files are in
`tools/engineering-runner/prepared-032/`.

Governance, verified at checkpoint:
- Flags ON: only `state_merge_only` (so `eng_runner` and `eng_adviser_connect` are OFF).
- 0 advisers, 0 runner-eligible tasks, 0 agent runs in the last 24 hours.
- Runner task: `cwd=/Users/abdulmahmady/mmmos-runner`, no cron, no fire time (manual only), never run.
- Production 200. `.pause-deploy` present. Task 125 untouched. CEO-015 `cdffbbf` untouched. PR #67 open, not merged.

---

## 1. Live enforcement test

**Verified current state**

| Route | Result |
|---|---|
| Headless `claude -p` (app binary 2.1.309) in `~/mmmos-runner` | Not signed in: the desktop app supplies sign-in only to its own sessions. |
| Engineering session starts an isolated probe session (`start_session`, cwd `~/mmmos-runner`) | Refused by Claude Code's auto-mode safety classifier (twice, 030 and 031). |
| Engineering session launches a probe Claude with tools pre-allowed | Refused by the same classifier (030). |

**Exact limitation:**
- Claude Desktop's safety boundary does not let an agent session start another agent session whose purpose is to attempt blocked actions.
- It also blocks the agent from handling the sign-in credential that a headless run would need (classifier reason: "Credential Materialization").
- We did not work around either.
- The 031 owner-started probe is **withdrawn** per this order (it required the CEO to run a session).

**Non-destructive tests run instead, against the real binary and real files:**

| Test | Result |
|---|---|
| `claude sandbox status` in `~/mmmos-runner` | `enabled:true, enabledSource:"settings", strictMode:true, strictModeSource:"settings", filesystemPolicy:"strict", autoAllowBashIfSandboxed:false`, so the binary loads our sandbox settings |
| `claude sandbox status` in `~/MMM` (control) | `enabled:false, enabledSource:"off"`, so the settings apply to the runner folder only, not globally |
| `claude doctor` in `~/mmmos-runner` | No settings errors reported (only unrelated install-path warnings) |
| `tests/platform/test_runner_settings.mjs` | 30/30 (rules present, path syntax, sandbox keys, installed copy identical) |
| `tests/platform/test_runner_push_hook.mjs` | 12/12 (real git, local remotes) |
| Live push-guard matrix in the runner clone (030) | main, tag, delete refused; env override cannot disable it |
| GitHub ruleset probe (030) | owner `--no-verify` push refused, GH013 |
| Runner clone credential (031) | dry-run push fails: no credential |

**Status: NOT LIVE-PASSED.**
- What is proven: the configuration is loaded and the git and GitHub layers enforce.
- What is not yet observed: per-command refusal by Claude Code inside a model-driven session in that folder.

**Proposed solution:**
- Run the 28-action probe (`tools/engineering-runner/probe/probe-031-list.txt`) as the runner's **first manual run**, before any real task. The runner task itself is the engineering-controlled session.
- That needs PM authorization to start the runner task once with `eng_runner` still OFF:
  - the server refuses all work (409 `runner_disabled`), so no task can be claimed;
  - the prompt would be temporarily replaced with the probe list.

**Security implications:** none beyond today's state. With the switch off, the runner cannot claim, and every probe target is harmless.

**Authorization:** PM, for one manual start of the runner task with the probe prompt.

**NEXT ACTION / OWNER:** PM authorizes or declines the single probe run. Claude Code executes and records PASS/FAIL.

---

## 2. GitHub Actions

**Verified current state:**
- Settings: `enabled:true`, `allowed_actions:all`, default token `read`, `can_approve_pull_request_reviews:false`, `allow_auto_merge:false`.
- 0 webhooks. 0 Actions secrets.
- All 106 remote branches inspected. The **only** workflow is `.github/workflows/decision18-materialize.yml`, on the stale branch `decision18-materialize` (Aug 2026):
  - trigger: push to that branch;
  - permissions: `contents: write`;
  - it pushes only to its own branch;
  - it ran once (2026-08-25, failed);
  - nothing on `main` or any live branch.
- **No workflow merges pull requests.** Nothing depends on Actions.
- **Risk confirmed by that workflow:** a workflow file on any pushed branch runs on push and grants itself `contents: write`. With the 0-approval PR rule on `main`, such a token could merge a PR.

**Proposed solution (minimum safe change):** turn Actions off for this repository only. The file is `prepared-032/actions-disable.json`, i.e. `PUT /repos/MMMOS1406/mmmos/actions/permissions {"enabled":false}`. Rollback: `{"enabled":true,"allowed_actions":"all"}`.

**Security implications:** this removes the workflow-from-branch path for every push credential. It breaks nothing, because nothing uses Actions.

**Scope:** one repository setting. Account settings and other repos are untouched.

**Authorization:** separate (repository automation setting), as the order requires.

**Tests:** after applying, `GET actions/permissions` should show `enabled:false`. A test branch with a workflow should create no run.

**NEXT ACTION / OWNER:** PM/CEO authorize. Claude Code applies and verifies.

---

## 3. Runner credentials

**Verified current state:**
- Since 031 the runner clone has `credential.helper ""`, so it has no push credential at all (fail closed).
- Before that, it inherited the owner credential (`MMMOS1406`, scopes `repo`, `workflow`).

**Proposed solution:** an SSH **deploy key with write access on a new private staging repository** `MMMOS1406/mmmos-runner-staging`, **not** on `MMMOS1406/mmmos`. Design: `prepared-032/runner-deploy-key.md.txt`.
- The runner's `origin` push URL becomes the staging repo. Fetch stays on the public main repo.
- The key lives in `~/mmmos-runner-keys/`, outside the runner's writable area.
- Actions disabled on the staging repo from creation.

**Security implications** (what the identity cannot do):

| The identity cannot… | Why |
|---|---|
| Merge PRs | Deploy keys have no API access, and it has no access to the main repo at all |
| Change repository settings | Deploy keys cannot use the settings API |
| Access secrets | No API, and the staging repo has none. Vercel/Supabase are outside the sandbox network. |
| Deploy production | Production builds only from `main` of the main repo (release guard + PR-required ruleset), which the key cannot reach. The staging repo is not connected to Vercel. |
| Touch other businesses | It can only push to staging. Promotion is server-checked against the task's business allowlist (§4). |

Alternatives rejected:
- **Deploy key on the main repo:** pushes reach Vercel before any check (§5).
- **Machine-user fine-grained token:** needs a second account and has API reach.
- **The runner holding a GitHub App key:** too broad.

**Scope:** one private repo (free), one deploy key, two runner-clone config lines.

**Authorization:** CEO (new repository + new credential). **Not created.**

**Tests at implementation:**
- push of `runner/*` to staging succeeds through the sandbox (SSH via the sandbox proxy, or `ssh.github.com:443`);
- push to the main repo fails;
- any API call with the key fails.

**NEXT ACTION / OWNER:** CEO decides. Claude Code implements and tests.

---

## 4. PR creation

**Verified current state:**
- `submit_pull_request` requires an existing PR URL and only records and checks it.
- The production `GITHUB_TOKEN` is used read-only.
- The runner cannot open PRs (no `gh`, no API).

**Proposed solution:** a new gateway op `open_runner_pull_request`, run by MMMOS, never by the runner.
1. **Same gates as today:**
   - `eng_runner` ON;
   - the task has the CEO's runner gate (`scope.runner.gate=r2`);
   - a live claim whose `agent_run_id` matches;
   - the branch is exactly `runner/<task-id8>-<ts>`;
   - one PR per task (idempotent).
2. The server reads the staging branch compare against `main` (App token, Contents: read on staging).
3. **Before anything reaches the Vercel-connected repo**, it runs `_engRunnerPathCheck`:
   - the business allowlist, with no shared files unless the scope grants them;
   - the denied list extended with `.vercelignore`, `vercel.ts`, `.npmrc`, `.nvmrc`, `.node-version`, `package*.json`, `vercel.json`, `.github/`, `migrations/`;
   - any violation is refused (409) and audited.
4. It recreates the verified files on `MMMOS1406/mmmos` with the Git Data API (blobs, tree, commit, ref `runner/…`), then opens the PR.
5. Audit: `_agentGatewayAudit` (allowed/denied) plus `brain_evidence` type `pull_request` with files, head SHA and staging SHA.

**Credential:** GitHub App "MMMOS Runner PR Opener" (`prepared-032/github-app-pr-opener.json`):
- Metadata read, Contents write, Pull requests write; nothing else (no administration, secrets, actions or workflows);
- installed only on the two repos;
- key held as a Vercel **production-only** env var.

Because Contents: write could technically merge, add the prepared ruleset `prepared-032/ruleset-runner-refs.json`:
- every branch except `runner/**` can be written only by admins;
- admins only through a PR;
- so the App can write `runner/**` only and can never merge. The CEO still merges.

**Security implications:**
- MMMOS gains one narrow new privilege: create `runner/**` branches and PRs.
- Merging stays CEO-only.
- Runner code is checked before Vercel ever builds it.

**Scope:**
- one App;
- one new gateway op plus an extended denied list in `api/ops.js`;
- one ruleset;
- tests in the R2 harness (stand-in GitHub).

It ships through the normal release.

**Authorization:** CEO (App credential, ruleset changes how sessions merge) and PM (server change). **Not implemented.**

**Interim:** none needed. The runner is off and has no push credential.

**NEXT ACTION / OWNER:** PM approves the design. CEO approves the App. Claude Code builds it on a branch with tests.

---

## 5. Preview isolation

**Verified current state:**
- Vercel Git integration builds **every pushed branch** (`gitProviderOptions.createDeployments: enabled`, `vercel.json git.deploymentEnabled: true`).
- Preview builds receive production secrets (`SUPABASE_SERVICE_KEY`, `PLAID_SECRET`, `ANTHROPIC_API_KEY`, `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY`, YouTube OAuth, …). `GITHUB_TOKEN`, TikTok and the deploy hook are production-only.
- `vercel.json` at the pushed commit **overrides** project settings for `buildCommand`, `installCommand` and `ignoreCommand`, and controls `git.deploymentEnabled` (Vercel docs).
- So a pushed branch can run any build command with those secrets: build-time exfiltration, or writes to the production database.
- Preview *runtime* is behind Vercel sign-in (029), but an automation-bypass secret exists and system env vars are exposed to builds.
- `gitForkProtection: true`.
- The server denies `vercel.json`/`package*.json` only at `submit_pull_request`, which is **after** Vercel has built.

**Options compared:**

| | No-deploy strategy (runner code never reaches the Vercel-connected repo unverified) | Separate non-production environment (non-prod keys for Preview) |
|---|---|---|
| How | Staging repo + server-checked promotion (§3, §4) | New Supabase project and sandbox keys for every Preview secret |
| Stops runner build-time attacks | Yes: build files can never be promoted | Only the database; paid API keys still need replacing |
| Can the runner undo it | No: the runner never writes the main repo | No |
| Cost | Free | A second Supabase project (paid compute) plus key management: new spending |
| Effect on other businesses | None | Every business's preview validation stops using real data; broad change |
| Config-only "no deploy for `runner/*`" (`git.deploymentEnabled`, `ignoreCommand`) | **Rejected:** defeatable from the branch's own `vercel.json` | — |
| Project-wide Git deploys off | **Rejected:** stops all previews; production would depend on the deploy hook | — |

**Recommendation:** the **no-deploy staging strategy**. It is the same change as §3 and §4, so one design closes credentials, PR creation and preview exposure together, at no cost, without touching other businesses or production env vars.

**Residual risk:** after promotion, the CEO's preview test runs the reviewed runner code against production data. That is the same as any human PR today. Longer term, consider non-production Preview keys for all businesses (separate decision).

**Authorization:** covered by the §3 and §4 approvals. No env var or deployment-policy change.

**NEXT ACTION / OWNER:** PM accepts the recommendation.

---

## Rollback of everything done in 030–032

See `RUNNER_ISOLATION.md` §7 and `RUNNER_VALIDATION_031.md` §2. 032 changed nothing, so it needs no rollback.
