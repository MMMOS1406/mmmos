# MMMOS-R2-CONSOLIDATED-034 (2026-10-31)

Issued by: ChatGPT CEO Adviser / PM. Executed by: Claude Code.

**Sources:**
- `main` `c3a82a7` (unchanged since R2).
- PR #67 `mmmos-eng/runner-login-controls` @ `a25dc08`.
- PR #68 `mmmos-eng/r2-master-033` @ the commit holding this file.
- Checksums: `docs/platform/R2_CONSOLIDATED_034.sha256`.
- Earlier records: `R2_MASTER_033_CHECKPOINT.md` (#68); `RUNNER_ISOLATION.md`, `RUNNER_VALIDATION_031.md`, `SECURITY_RESOLUTION_032.md` (#67).

Nothing was merged, deployed, migrated, switched on, revoked, purchased or credentialed. GitHub Actions settings are unchanged.

---

## 1. PASS / FAIL results

| Check | Result | Evidence |
|---|---|---|
| `main` unchanged; both PRs mergeable, CLEAN, Vercel checks green | **PASS** | `gh pr view` 67/68 |
| PR #67 and #68 share no files; trial merge of both onto `main` is clean | **PASS** | merge into a detached worktree, then removed |
| Combined merge, all 50 suites, network blocked | **PASS** (43 identical to `main`; 6 new suites all green; 1 expected difference) | see §1a |
| 033 auth fix: 6 engineering actions refuse anonymous callers | **PASS** | 033 suite S1–S12 |
| **034 auth fix: all 25 `brain_v2_*` actions refuse anonymous callers, write nothing** | **PASS** | `test_engineering_auth_034.mjs` 12/12 |
| Fail-closed runner stop (in-flight claim refused when `eng_runner` OFF; manual claims unaffected) | **PASS** | 033 M11–M15 |
| Task-bound runner branches | **PASS** | 033 M4–M8 |
| Build/install files and runner tooling denied (server) and in the local guard | **PASS** | 033 M9–M10b; `test_runner_guard_denied.mjs` 3/3 |
| Artifact SHA-256 (server hash ≤ 25 MB, mismatch refused, large media unverified, adviser read-back) | **PASS** | 033 C1–C6 |
| Lifecycle UI + task-list escaping | **PASS** | UI suite 24/24; browser 26/26, 9/9 |
| Preservation harness | **PASS with intended differences** | see §1a |
| Runner tooling (settings, push hook) | **PASS** | 30/30, 12/12 |
| PR previews protected | **PASS** | `dpl_CsuTMT3fSFg383Upys3WRxwRt8Bm`: 302 on `/` and on `brain_v2_get_agent_runs` |
| Production still exposed until release | **FAIL (open, needs H1)** | prod `engineering_task_home_list` 200 with 10 tasks; `brain_v2_get_agent_runs` 200 with 43 audit rows (anonymous, counts only) |
| Live in-session Claude permission test | **NOT RUN** (Desktop boundary) | 032 §1 |
| ChatGPT connection / end-to-end | **NOT RUN** (needs ChatGPT Business) | — |
| Production artifact round-trip | **NOT RUN** (needs H5) | bucket holds 0 objects |

### 1a. Suite and harness detail

**Combined merge:**
- New suites, all green: 034 auth 12/12, 033 35/35, UI 24/24, guard-denied 3/3, push hook 12/12, settings 30/30.
- R2 91/91, R1 87/87.
- The 1 expected difference is `test_youtube_oauth_reliability`, whose "diff scope" self-check fails on any branch that touches files outside `api/youtube`.
- Pre-existing failures are identical on `main`: `test_automatic_git_commit_capture_fix`, `test_nextwave_v2_production_route`, `test_p0_state_guard`, and seven `test_srv_studio_v2_*` suites.

**Preservation harness (141 checks):**
- 12 differ, against 5 on `main`.
- The 7 extra are intended:
  - the home-list request is now a POST with the session, which changes the "same set of requests" and "distinct write requests" checks (DOM hashes unchanged);
  - the two old CEO-008 file-scope checks.
- Engineering Brain v2 tabs are not in the baseline.

---

## 2. Routine fixes completed in 034

1. **HIGH: 25 Engineering Brain v2 actions required no login.**
   - Includes `brain_v2_get_agent_runs`, which serves the audit trail B10b made CEO-only.
   - Production also serves deployments, lessons, health and per-engine business metrics/ROI, plus 15 write actions.
   - Fixed with one router gate (`brain_v2_*` needs the CEO session); the 13 app calls now use `_ceoAuthedFetch`.
   - PR #68 commit `81484db`.
2. Task status change refused by the server was shown as saved. It now reports "Status not saved" and re-renders.
3. Refusal text is now readable ("Sign in as CEO…") and escaped where inserted as HTML.
4. The PR #67 local runner guard now denies everything the server denies, enforced by `test_runner_guard_denied.mjs` (parser fixed to ignore code comments). Installed guard sha256 `93bc02c6a9b3754b…`.

---

## 3. Findings recorded (no change made)

- **Connector regression since B10 (LOW, security-safe).**
  - The local `mmm-engineering-brain` connector writes `engineering_tasks` directly with the publishable key; it is not a service key (verified by key type only).
  - Since B10 that key has no rights on the table (verified via grants), so `eb_create_task`, `eb_update_task` and `eb_load_task` are refused.
  - Recommendation: retire those three tools or route them through CEO-gated server actions (connector change, PM decision).
- **Wider app audit (MEDIUM, not done).**
  - Only the `engineering_*`, `brain_*`, `brain_v2_*`, `agent_*` and `ceo_*` action families were audited.
  - Business-engine actions (finance, SMM, SRV, NextWave…) were out of scope by order.
  - Recommendation: a separate, read-only authentication audit of every `api/ops.js` action, by business.
- **12 stale worker authorizations** (manual worker path only; the runner excludes them): H7.
- **GitHub Actions** still enabled (only workflow on stale branch `decision18-materialize`): H2.

---

## 4. PR review conclusions

- **PR #68 — recommended for release (H1).** It now closes 31 anonymous engineering actions in production (6 in 033, 25 in 034) and adds runner fail-closed, task-bound branches, denied build files, artifact checksums and the lifecycle UI.
  - Deployment implications: the Engineering Brain home card and v2 tabs need a CEO login, so VA/family no longer receive engineering data (intended). No schema, flag or engine change.
  - Rollback: promote `dpl_FLAa1VzaexmJYMcsdaF1wLneAo6m`.
- **PR #67 — recommended for merge after #68 (part of H1).** Runner tooling and records only, with no runtime effect on production: tools/docs/tests are not served code.
  - Merge order: #68 first, then #67. Either order is conflict-free; the trial merge was clean.

---

## 5. Decisions H1–H9

| # | Current status | Evidence | Risk if not done | Recommendation | Exact CEO approval | Depends on |
|---|---|---|---|---|---|---|
| **H1** Release #68, then merge #67 | Ready, tested | §1 | Live anonymous read of tasks, agent audit trail and business metrics; anonymous writes | Approve | "Approve PR #68 release to production and merge of PR #67" | — |
| **H2** Turn Actions off (repo only) | Prepared (`prepared-032/actions-disable.json`) | 032 §2 | Any future push credential could run a self-granted write token | Approve | "Disable GitHub Actions for MMMOS1406/mmmos" | — |
| **H3** Staging repo + runner deploy key | Designed (`prepared-032/runner-deploy-key.md.txt`) | 031/032 | The runner cannot push at all (safe, but no workflow) | Approve after H2 | "Create private repo mmmos-runner-staging and a write deploy key for it" | H2 |
| **H4** PR-opener App + ruleset + `open_runner_pull_request` | Designed (`prepared-032/`) | 032 §4 | The runner cannot open PRs | Approve | "Create GitHub App 'MMMOS Runner PR Opener' (Contents+PR write, two repos) and ruleset runner-app-refs-only; approve the server change" | H1, H3 |
| **H5** MMMOS archive task | Not created | bucket holds 0 objects | No production proof of artifact storage/recovery | Approve | "Authorize one engineering task 'Checkpoint archive' for artifact upload (no runner)" | H1 (checksums) |
| **H6** One probe run of the runner task, runner OFF | Probe ready (`probe/probe-031-list.txt`) | 032 §1 | No live in-session enforcement evidence | Approve | "Allow one manual run of the runner task with the probe prompt" | — |
| **H7** Revoke 12 stale worker authorizations | 12 live, no leases | SQL count | Dormant manual-worker grants | Approve | "Revoke agent authorization on the 12 stale tasks" (list in Engineering Review) | — |
| **H8** ChatGPT Business | Undecided | R2 research | No ChatGPT connection or end-to-end | CEO business choice | "Purchase ChatGPT Business ($50/month or $480/year, 2 seats)" | H1 |
| **H9** NextWave Finance Pilot key | Plan ready (033 §K) | 033 | Finance Pilot work would mix with NextWave V2/live engine | Approve | "Register business nextwave_finance_pilot (server change, separate folders)" | H1 |

---

## 6. Phased execution plan (after approval)

1. **Production security remediation (H1).** Mark #68 ready, merge, and check that production builds from `main`. Then verify live, anonymously:
   - `engineering_task_home_list` → 401;
   - `brain_v2_get_agent_runs` → 401;
   - and with a CEO session, that the Engineering screens load.

   Then merge #67. Rollback: promote `dpl_FLAa1Vza…`.
2. **GitHub Actions exposure (H2).** Apply `actions-disable.json`, then verify `enabled:false`.
3. **Staging repo isolation (H3).** Create the private repo (Actions off). Clone verification: no Vercel link.
4. **Runner deploy-key permissions (H3).**
   - Install the deploy key outside the runner write area and set the runner push URL to staging.
   - Test: staging `runner/*` push OK; push to the main repo refused; API with the key impossible.
5. **PR-opening mechanism (H4).** Create the App and the ruleset, then build `open_runner_pull_request` on a branch with stand-in tests (gates, allowlist before promotion, idempotency, audit). Release like H1.
6. **MMMOS archive task (H5).** Upload this checkpoint and its manifest as artifacts, read them back with checksums, and record the evidence.
7. **Isolated runner enforcement test (H6).** Run the probe once with `eng_runner` OFF, record PASS/FAIL per action, and check the canary folder.
8. **Stale worker authorization review (H7).** Revoke the 12 and verify the count is 0.
9. **Optional ChatGPT Business (H8).** Connect the MCP connector, then switch `eng_adviser_connect` ON for a controlled test: submit, then results, then follow-up. Then end-to-end with the runner, after H3–H6.
10. **NextWave Finance Pilot registration (H9).** Add the business key and folders with tests, release, then onboard per 033 §K.

---

## 7. Business protection

- PR #68 changes only `api/ops.js` engineering/brain routes, Engineering UI code in `public/index.html`, and engineering tests/docs.
- PR #67 changes only `tools/engineering-runner/`, runner tests and docs.
- No `lib/`, business API folders, migrations, `vercel.json` or business-engine code.
- Task 125 untouched. `.pause-deploy` present (untracked, unchanged). CEO-015 `cdffbbf` untouched.
- Isolation suites pass: release 13/13, state 33/33, client e2e 11/11.
- Live state:
  - flags ON: only `state_merge_only`;
  - 0 advisers, 0 runner-eligible tasks, 0 agent runs in 24 hours, 0 artifacts;
  - runner task cwd `~/mmmos-runner`, manual only;
  - ruleset unchanged; Actions unchanged.

---

## 8. Rollback plan

| Change | Rollback |
|---|---|
| #68 (after release) | Promote `dpl_FLAa1VzaexmJYMcsdaF1wLneAo6m`, or revert the merge commit |
| #67 (after merge) | Revert the merge commit (no runtime effect) |
| Local guard reinstall (034) | `git -C ~/mmm-static-wt/runner-controls show 04705b4:tools/engineering-runner/runner-guard.mjs > ~/MMM/engineering-agent/runner-guard.mjs` |
| H2–H9 | Per row in §5 and `prepared-032/` |

---

## 9. NEXT ACTION and OWNER

- **CEO:** approve the package below.
- **Claude Code:** execute phases 1→10 in order, reporting once.

**Recommended single CEO approval package:**

> I approve: H1 (release PR #68, then merge PR #67), H2 (disable GitHub Actions for MMMOS1406/mmmos), H6 (one probe run of the runner task with the runner OFF), H7 (revoke the 12 stale worker authorizations), H5 (one checkpoint-archive task). H3, H4 and H9 approved for preparation and creation as specified. H8 (ChatGPT Business) decided separately.
