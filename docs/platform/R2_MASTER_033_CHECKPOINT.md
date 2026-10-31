# MMMOS-R2-MASTER-033 — consolidated checkpoint (2026-10-31)

Issued by: ChatGPT CEO Adviser / PM. Executed by: Claude Code.

**Code branch:** `mmmos-eng/r2-master-033`, based on `main` `c3a82a7`.
- See the PR for the final commit.
- Preview `dpl_BUicswShXJLmzAjWaSnYaS4Zcvt6` is sign-in protected: every path returns 302.

**Runner tooling:** PR #67, branch `mmmos-eng/runner-login-controls` @ `04705b4`.

**Earlier records:**
- `RUNNER_ISOLATION.md` (030)
- `RUNNER_VALIDATION_031.md` (031)
- `SECURITY_RESOLUTION_032.md` (032)
- `tools/engineering-runner/prepared-032/`

Nothing was deployed, merged, migrated, activated or purchased. No credential was created.

---

## A. Executive summary

1. **Security hole found and fixed on the branch (not yet released).**
   - Six older engineering actions required no login:
     - `engineering_task_home_list`, a read; production returns 10 open tasks with their problem text to anyone;
     - five writes: `engineering_task_create`, `_create_from_decision` (also spends Anthropic credit), `_update`, `engineering_brain_save` and `_seed`.
   - All six now require the CEO session.
   - No sign of abuse: one task created in 60 days (task generator), and no unexpected edits to the engineering notes.
2. **Runner fail-closed gaps fixed (branch):**
   - switching `eng_runner` OFF now also stops a runner that already holds a claim;
   - runner branches must carry their task id;
   - build/install config files and the runner's own tooling can never be changed by the runner.
3. **Durable evidence:**
   - the server computes SHA-256 for artifacts up to 25 MB and refuses a wrong claimed checksum;
   - large media keep the uploader's checksum, marked unverified;
   - video kinds added (thumbnail, script, narration);
   - the adviser reads checksums back.
4. **UI:**
   - one lifecycle vocabulary (Draft / Authorized / Running / Blocked / PM Review / CEO Review / Approved / Closed);
   - the Engineering Brain task list is now fully escaped.
5. **Tests:**
   - new suites 35/35 and 24/24; R2 91/91; R1 87/87;
   - 43 of 46 suites identical to `main`; browser 26/26 and 9/9;
   - preservation differences are only the intended request change and the old file-scope checks.
6. **Still not verified:**
   - the live in-session Claude permission test (Desktop safety boundary);
   - the ChatGPT connection and full end-to-end, which need ChatGPT Business.
7. **CEO decisions:** consolidated in §H. Release of this branch, Actions off, staging repo + deploy key, PR-opener App, ChatGPT Business, stale authorizations, NextWave Finance Pilot identity.

---

## B. Current architecture (verified live)

| Layer | State |
|---|---|
| Production | `dpl_FLAa1VzaexmJYMcsdaF1wLneAo6m` = `main` `c3a82a7` (R2). Rollback target `dpl_3BExoDybimfC8SkwYTPTo3YnMNpE`. |
| Switches | Only `state_merge_only` is ON, so `eng_runner` and `eng_adviser_connect` are OFF. |
| Advisers | 0 credentials. |
| Tasks | 73 rows with 9 status spellings (`open`, `in_progress`, `testing`, `blocked`, `ready_for_ceo`, `done`, `complete`, `completed`, …). 0 runner-eligible. 12 old tasks still hold worker authorizations (no lease). 0 agent runs in 24 hours. |
| DB exposure (public key, live) | `engineering_tasks`, `engineering_advisers`, `brain_evidence`, `brain_agent_runs`, `engineering_workspace_files`: permission denied. `engineering_workers`, `engineering_worker_pairing_requests`, `ceo_auth_config`, `mmm_platform_flags`: 0 rows (RLS, no policies). `engineering_brain`: public by design. |
| Server exposure (live) | `engineering_task_home_list` readable without login (**fixed on branch**). Writes without login exist (not probed in production; **fixed on branch**). |
| Artifacts | Private bucket `engineering-artifacts` (500 MB/file limit). **0 objects**: never used in production. `srv-assets` is public (SRV business, untouched). |
| Evidence | `brain_evidence`: note 2, test_result 2, commit_sha 1, execution_plan 1, engineering_checkpoint 1. |
| Adviser / MCP (live) | OAuth metadata 200, protected-resource 200, OpenAPI 200; `/api/mcp` 401 with the correct challenge; client registration 201 (stateless, no DB write); approval page switched off. |
| GitHub | Ruleset `26252619` on `main`: no delete, no force push, PR required, no bypass. Actions enabled, but the only workflow is on stale branch `decision18-materialize`. 0 webhooks, 0 Actions secrets, auto-merge off. |
| Vercel | Hobby. Previews require Vercel sign-in (029). Previews get production secrets. A branch's `vercel.json` overrides project build settings. `gitForkProtection` on. One automation-bypass secret exists. |
| Runner (local) | `~/mmmos-runner` (independent clone, no owner credential, sandbox strict per `claude sandbox status`). Task `mmmos-engineering-runner`: cwd `~/mmmos-runner`, manual only, never run. |
| NextWave | Engine key `nextwave` maps to NextWave V2 code (`lib/nextwaveV2…`). Open V2 task `2e17bd23` ("NextWave currently produces all videos through HeyGen…"). There is no Finance Pilot identity yet. |

---

## C. Workstream classification

| # | Workstream | Classification |
|---|---|---|
| 1 | System audit | **COMPLETE AND VERIFIED** (§B, live reads only) |
| 2 | Runner security and isolation | **IMPLEMENTED, AWAITING RELEASE** (server fail-closed, branch binding, denied files, self-protection) + **BLOCKED WITH EVIDENCE** (live in-session Claude test, §F4) |
| 3 | GitHub and PR workflow | **IMPLEMENTED, AWAITING RELEASE** (task-bound branches, PR validation) + **PREPARED, AWAITING CEO AUTHORIZATION** (staging repo, deploy key, PR-opener App, Actions off: `prepared-032/`) |
| 4 | Staging and preview security | **PREPARED, AWAITING CEO AUTHORIZATION** (§F5, staging design). Preview protection itself is **COMPLETE AND VERIFIED** (302 on all paths of the new preview). |
| 5 | ChatGPT / MMMOS communication | Backend **VERIFIED** (local suites + live switched-off behaviour). MCP protocol **VERIFIED** (locally against the real handler; live discovery and 401 challenge). ChatGPT connection **BLOCKED WITH EVIDENCE** (needs ChatGPT Business). End-to-end **NOT STARTED** (depends on the previous item). |
| 6 | Durable institutional memory | **IMPLEMENTED, AWAITING RELEASE** (checksums, video kinds, recovery read-back tested). Storing this checkpoint *inside MMMOS* is **BLOCKED WITH EVIDENCE**: artifact upload needs a CEO-authorized task (§J). |
| 7 | Engineering UI | **IMPLEMENTED, AWAITING RELEASE** (lifecycle chips, escaping, authenticated calls) |
| 8 | Full QA | **COMPLETE AND VERIFIED** for everything runnable (§E) |
| 9 | Cost and operations | **COMPLETE** (§I) |
| 10 | NextWave readiness | **PREPARED, AWAITING CEO AUTHORIZATION** (§K) |

---

## D. Code and UI changes prepared (branch `mmmos-eng/r2-master-033`)

**`api/ops.js`**
- CEO session gate (`ceo_session_required`) on six actions:
  - `engineering_task_home_list`, `engineering_task_create`, `engineering_task_create_from_decision`;
  - `engineering_task_update`, `engineering_brain_save`, `engineering_brain_seed`.
- Gateway:
  - a `runner:` claim is refused with 409 `runner_disabled` (audited) when `eng_runner` is OFF;
  - manual `worker:` claims are unaffected.
- `submit_pull_request`: a runner task's branch must match `runner/<task id8>(-name)`, otherwise 400 `branch_not_bound_to_task` (audited).
- `ENG_DENIED_PATHS` adds:
  - `vercel.ts`, `vercel.mjs`, `.vercelignore`;
  - `.npmrc`, `.nvmrc`, `.node-version`, `.yarnrc`, `.yarnrc.yml`;
  - yarn/pnpm/bun lockfiles and workspace files;
  - `middleware.js/ts`;
  - `tools/engineering-runner/`, `tools/engineering-agent/`.
- `mmmos` runner scope no longer includes `tools/engineering-runner/`.
- `submit_artifact`:
  - optional `sha256`, which must be 64 hex characters;
  - server SHA-256 for objects up to 25 MB; a mismatch returns 409 `artifact_checksum_mismatch` (audited);
  - metadata `sha256`, `sha256_verified`;
  - new kinds `thumbnail`, `script`, `narration`.
- Adviser results include `sha256` and `sha256_verified` per artifact.

**`public/index.html`**
- The five callers of the gated actions use `_ceoAuthedFetch` (POST plus session token; never a token in a URL).
- New `_engLifecycle()` and `_engLifecycleChip()`, with a chip on every Engineering Brain task.
- Task list: `escHTML`/`_engAttr` on problem, engine, priority, expected result, criteria, knowledge title/content, protocol and checklist items, and every id inside an `onclick`/`onchange` handler.

**Tests**
- `tests/platform/test_engineering_r2_master_033.mjs` (35)
- `tests/platform/test_engineering_ui_lifecycle_033.mjs` (24)
- R2 fixtures moved to task-bound branch names.
- The harness gained object download.

**Lifecycle mapping** (derived only from existing fields; no schema change):

| Label | Rule |
|---|---|
| Closed | status `done` / `complete` / `completed` / `closed` / `rejected` / `cancelled` |
| Blocked | `blocked` |
| CEO Review | `ready_for_ceo` |
| Approved | status `approved` or `ceo_decision=approved` |
| PM Review | `testing` |
| Running | live lease, or `in_progress` |
| Authorized | authorized and not revoked |
| Draft | everything else |

PM Review has no dedicated status yet, so `testing` stands in for it. A real `pm_review` status would be a later schema/workflow decision.

---

## E. Actual tests and evidence

Network blocked except localhost (`netguard`). Branch versus `main` (`main` tree = `mmmos-eng-r2` worktree, identical to `c3a82a7`).

| Suite | Branch | Main |
|---|---|---|
| test_engineering_r2_master_033 (new) | **35/35** | n/a |
| test_engineering_ui_lifecycle_033 (new) | **24/24** | n/a |
| test_engineering_integration_r2 | 91/91 | 91/91 |
| test_engineering_integration_r1 | 87/87 | 87/87 |
| R1 migration / B10 | 17/17 / 13/13 | same |
| Isolation: release / state / client e2e | 13/13 / 33/33 / 11/11 | same |
| publish auth / packages backup | 92/92 / 11/11 | same |
| All 46 runnable suites | 43 identical to `main`; 2 new; 1 differs | — |
| Differs: test_youtube_oauth_reliability | "diff scope" self-check (fails on any branch touching files outside `api/youtube`) | 25/25 |
| Pre-existing failures, identical on `main` | `test_automatic_git_commit_capture_fix`, `test_nextwave_v2_production_route`, `test_p0_state_guard`, 7 × `test_srv_studio_v2_*` | same |
| Browser: engineering-review-escaping / r2-screens | 26/26 / 9/9 | — |
| Preservation harness (141 checks) | 12 differ from baseline vs 5 on `main` | — |

Preservation detail:
- **Intended differences:**
  - the home-list request changed from GET to POST with session (admin/family/va "same set of requests" and "distinct write requests"), while the page hashes are unchanged;
  - the two old CEO-008 file-scope checks.
- **Same as `main`:** the other 5.

Runner tooling (PR #67): settings 30/30, push hook 12/12.

**Not run, and not claimed:**
- the live Claude in-session refusal test (§F4);
- ChatGPT → MMMOS live;
- a production artifact round-trip (needs an authorized task).

---

## F. Security findings and fixes

1. **Unauthenticated engineering actions (HIGH).**
   - Verified live for the read (`home_list`: 10 tasks with problem text).
   - The writes are code-verified and were not probed in production.
   - Fixed on the branch; tests S1–S12.
   - Releasing it is a CEO decision (H1).
2. **Emergency stop did not stop a runner already holding a claim (MEDIUM, not exploitable today: runner OFF).** Fixed, tests M11–M15.
3. **Runner could target build/install config or its own tooling (MEDIUM).** Fixed, tests M9, M10, M10b. Pushes still reach Vercel before the server check, which the staging design closes (F5).
4. **Live in-session permission test (OPEN).**
   - Blocked by Claude Desktop: agent sessions may not start sessions that try blocked actions.
   - Evidence instead:
     - `claude sandbox status` (runner folder: enabled/strict from settings; `~/MMM`: off);
     - `claude doctor` clean;
     - settings 30/30;
     - git and GitHub layers proven in 030/031.
   - Proposed: the probe as the runner task's first manual run with `eng_runner` OFF (H6).
5. **Preview builds receive production secrets; a branch's `vercel.json` overrides build settings (HIGH for any push credential).**
   - Today no runner can push (031).
   - Fix: staging repo + server-checked promotion (H3/H4).
6. **GitHub Actions enabled with no workflows (MEDIUM).** A pushed workflow can grant itself write access. Fix: repo-only disable (H2).
7. **12 stale worker authorizations (LOW).** Manual-worker path only; the runner excludes them. Recommend CEO revocation from Engineering Review (H7).
8. **`/oauth/register` issues sealed client ids while the adviser switch is OFF (INFO).** Stateless; approval is refused while OFF. No change.

---

## G. Remaining blockers

1. **ChatGPT Business** (CEO spending decision): gates the ChatGPT connection test and end-to-end.
2. **Live in-session Claude test:** needs the H6 authorization.
3. **Staging repo, deploy key, PR-opener App:** need CEO credential/repo decisions. Until then the runner cannot push or open PRs, by design.
4. **Durable checkpoint inside MMMOS:** needs one CEO-authorized archive task (H5).

---

## H. Consolidated CEO decisions

| # | Decision | Effect | Cost | Rollback |
|---|---|---|---|---|
| H1 | Release branch `mmmos-eng/r2-master-033` (normal PR → merge → production) | Closes the anonymous engineering actions; runner fail-closed; checksums; UI | none | promote `dpl_FLAa1Vza…` |
| H2 | Turn GitHub Actions off for `MMMOS1406/mmmos` (`prepared-032/actions-disable.json`) | Removes workflow-from-branch privilege | none | re-enable |
| H3 | Create private repo `MMMOS1406/mmmos-runner-staging` + runner deploy key (`prepared-032/runner-deploy-key.md.txt`) | Runner identity with no API, no main-repo access | none | delete key/repo |
| H4 | Create GitHub App "MMMOS Runner PR Opener" + ruleset `runner-app-refs-only` (`prepared-032/`) + build `open_runner_pull_request` | MMMOS opens checked PRs; only the CEO merges | none | uninstall App, delete ruleset |
| H5 | Authorize one MMMOS "checkpoint archive" engineering task | Lets Claude Code store checkpoints/artifacts in the private bucket with checksums, and prove recovery in production | none | revoke task |
| H6 | Allow one manual start of the runner task with the probe prompt, `eng_runner` still OFF | First live in-session enforcement evidence | none | n/a |
| H7 | Revoke the 12 stale worker authorizations | Removes dormant manual-worker grants | none | re-authorize |
| H8 | ChatGPT Business workspace | Enables the ChatGPT MCP connection, then `eng_adviser_connect` ON for testing | §I | cancel |
| H9 | NextWave Finance Pilot as a separate business key (§K) | Separate history, artifacts and runner scope | none | remove key |

---

## I. Exact cost implications

| Item | One-time | Monthly |
|---|---|---|
| Everything in H1–H7 and H9 | $0 | $0 (GitHub free private repo, deploy key, App and rulesets; Vercel Hobby unchanged; Supabase Pro unchanged) |
| Artifact storage | $0 | Inside Supabase Pro's included 100 GB storage / 250 GB egress; beyond that Supabase's metered rates. Video projects of a few GB per month stay within the included amounts. |
| ChatGPT Business (H8) | $0 | $25/seat/month monthly or $20/seat/month annual, 2-seat minimum: **$50/month, or $480/year** (prices as researched in R2; confirm at purchase) |
| Not recommended: separate non-production Supabase project for previews | $0 | Additional compute for a second project (around $10/month at the smallest size; confirm on the Supabase pricing page) plus key management |

Operations:
- Credentials to manage after H3/H4: one deploy key and one App private key (production env only). Rotate yearly or on any incident.
- Manual intervention: CEO decisions per task (authorize, accept, merge) only.
- Failure recovery: flags OFF is the emergency stop (now stops in-flight runners); revoke per task; revoke the adviser; delete the deploy key.

---

## J. Durable storage and recovery proof

- **Repository (verified):** this file and the 030/031/032 records on branches that have been pushed to GitHub (`mmmos-eng/r2-master-033`, `mmmos-eng/runner-login-controls`, `mmmos-eng/r2-post-release-027`).
- **MMMOS artifact storage:**
  - the mechanism is implemented and tested in the stand-in: upload, register with server SHA-256, mismatch refused, adviser read-back with a private signed link (tests C1–C6);
  - **not exercised in production**: the bucket holds 0 objects, and an upload needs a CEO-authorized task (H5);
  - nothing is claimed to be stored in MMMOS.
- **Local originals:** untouched. Nothing deleted.

---

## K. NextWave Finance Pilot onboarding (ready to execute after H9)

1. **Identity:**
   - new business key `nextwave_finance_pilot` in `ENG_BUSINESSES` and `ENG_BUSINESS_PATHS`, with its own folders (proposed `projects/nextwave-finance-pilot/`, `docs/projects/nextwave-finance-pilot/`, `tests/projects/nextwave-finance-pilot/`);
   - never `nextwave` (that key is NextWave V2 code and task `2e17bd23`);
   - never the live NextWave engine.
2. **Separate history:**
   - tasks carry `packet.business = nextwave_finance_pilot`;
   - adviser results are already business-scoped;
   - artifacts live under `engineering-artifacts/nextwave_finance_pilot/<task>/<run>/`, enforced by `_engArtifactPathBelongsToTask`.
3. **Media:**
   - MP4s, thumbnails, scripts, narration and source files are uploaded as artifacts (kinds added in 033), with SHA-256 (server-verified up to 25 MB; uploader checksum for larger renders);
   - never in database rows.
4. **Private previews:** CEO and PM open signed, short-lived links from Engineering Review and adviser results. Nothing public, and nothing in `srv-assets`.
5. **Reviews:**
   - the PM reviews through `engineering_adviser_get_results` / follow-ups;
   - the CEO's creative acceptance is `engineering_task_ceo_approve` on the task.
6. **Publishing:**
   - a separate, explicit CEO authorization per video;
   - the runner has no YouTube credentials or network access (sandbox allowlist is `github.com` only);
   - publishing stays with the existing approved publishing paths, after acceptance.
7. **Work required:** a small server change (business key + paths + UI label) on a branch with tests, then release (H1-style). No new infrastructure.

---

## L. Remaining work, by priority

1. H1 release (closes a live anonymous read and anonymous writes).
2. H2 Actions off.
3. H3 + H4 staging, identity and PR opener (then build `open_runner_pull_request` with tests).
4. H6 live enforcement probe.
5. H5 archive task, then a production artifact round-trip and checksum proof.
6. H8 ChatGPT Business, then the ChatGPT connection test, then end-to-end (adviser → task → CEO authorization → runner → PR → evidence → PM).
7. H9 NextWave Finance Pilot key.
8. A `pm_review` status, if the PM wants PM Review distinct from `testing`.
9. Connector: send `sha256` for large uploads (local connector, versioned on the 027 branch).

---

## M. NEXT ACTION and OWNER

- **PM:** review this checkpoint and PR, then issue one consolidated order for H1–H9.
- **CEO:** decide H1–H9 (H1 and H2 first).
- **Claude Code:** execute each approved item and report evidence.
