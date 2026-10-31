# MMMOS-R2-READINESS-035 (2026-10-31)

Issued by: ChatGPT CEO Adviser / PM. Executed by: Claude Code.

**Branches:**
- `mmmos-eng/r2-readiness-035`, stacked on PR #68 (`mmmos-eng/r2-master-033` @ `77811dc`). Draft PR, base #68. See the manifest `R2_READINESS_035.sha256` for the commit.
- PR #67 @ `a25dc08`.
- `main` @ `c3a82a7` (unchanged).

Nothing was merged, deployed, migrated, switched on, revoked, purchased or credentialed. No repository setting was changed.

---

## 1. PASS / FAIL

| Item | Result | Evidence |
|---|---|---|
| `main` unchanged; #67 and #68 CLEAN with green checks | **PASS** | `gh pr view` |
| 035 branch, all 48 suites (network blocked) | **PASS** | §1a |
| H4 PR opener | **PASS** | `test_engineering_pr_opener_035.mjs` 28/28 (§3) |
| Preservation harness | **PASS (same as 034)** | 141 checks; differences identical to 034 (intended request change + old file-scope checks) |
| Browser | **PASS** | 26/26, 9/9 |
| H1 post-release verifier | **Pre-release baseline FAIL, as expected** | §2 |
| H5 archive tool, H6 probe grader | **NOT TESTED** | prepared files only; their tests were not completed in this cycle |
| Live runner enforcement probe | **NOT RUN** | needs H6 authorization |
| ChatGPT connection | **NOT RUN** | H8 on hold |

### 1a. Suite detail

- 43 suites identical to `main`.
- 4 new suites, all green: PR opener 28/28, 034 auth 12/12, 033 35/35, UI 24/24.
- 1 expected difference: `test_youtube_oauth_reliability`, whose "diff scope" self-check fails on any branch touching files outside `api/youtube`.
- R2 91/91, R1 87/87, B10 13/13.
- Isolation: release 13/13, state 33/33, client e2e 11/11.

---

## 2. H1 — release preparation (conditional acceptance)

- **Compatibility:**
  - #67 and #68 share no files, and a trial merge of both onto `main` is clean (034);
  - #68 + 035 ran all suites (§1).
- **Migration ordering:** none; neither PR has a migration.
- **Runbook:** `tools/engineering-runner/release/R2_RELEASE_RUNBOOK.md`. Seven steps, three rollback points:
  - RP1: before merge;
  - RP2: promote `dpl_FLAa1VzaexmJYMcsdaF1wLneAo6m`;
  - RP3: revert #67's merge.
- **Anonymous-denial verifier:** `tools/engineering-runner/release/verify-anonymous-denied.sh`.
  - It is read-only: 17 anonymous read requests, plus public pages that must still answer.
  - Today's production baseline is **RESULT FAIL**: 14 reads return 200 (`engineering_task_home_list` and 13 `brain_v2_*`), and 3 already return 401.
  - After the release, every line must PASS.
- **Fail-closed behaviour:** proven in the stand-in:
  - runner stopped when the switch is OFF (033 M11–M15; 035 P25);
  - PR opener inert without settings (035 P1–P4).

## 3. H4 — PR opener (preparation approved; implemented and tested, not installed)

New gateway op `open_runner_pull_request`, on the 035 branch:
- **Who may call it:** only a runner-claimed, CEO runner-authorized task, while `eng_runner` is ON. The branch must be the task's own (`runner/<id8>-…`), and `base_sha` must be a commit already on `main`.
- **Without settings:** without `ENG_RUNNER_STAGING_REPO`, `ENG_PR_APP_ID`, `ENG_PR_APP_INSTALLATION_ID` and `ENG_PR_APP_PRIVATE_KEY`, it returns 503 `pr_opener_not_configured`, makes **no** GitHub call, and audits the refusal. A staging repo equal to the canonical repo also counts as not configured.
- **Token:**
  - the App's JWT is RS256, about 10 minutes long, and issued by the App id;
  - the installation token is narrowed at mint time to the two repositories and to contents/pull_requests/metadata.
- **Sequence:**
  1. Check the base commit is on `main`.
  2. Compare the staging branch.
  3. Check **every path**, including a rename's old path, against the business allowlist and denied files. This happens **before** anything is written to the canonical repo.
  4. Copy blobs, and refuse if a copied blob's id differs from the staging blob.
  5. Build the tree on the base commit, make one commit, create the `runner/*` ref, and open a **draft** PR (`maintainer_can_modify: false`).
  6. Record evidence and audit.
- **Idempotent:** a second call returns the same PR with no GitHub calls.
- **No merge:** the code has no merge call, no PUT, and nothing to call one (test P27).
- **Tests:** 28/28 against a simulated GitHub with a per-run test RSA key (not a credential), covering the happy path, all refusals, and who may call it.
- **Installation:** requires H3 + H4 CEO approval. The App design is in `prepared-032/github-app-pr-opener.json`; the ruleset in `prepared-032/ruleset-runner-refs.json` stops the App from writing outside `runner/**`. The local connector will need one new tool to call this op; that's a small follow-up.

## 4. H2 — GitHub Actions (conditional acceptance)

- Plan: `tools/engineering-runner/release/ACTIONS_DISABLE_PLAN.md`.
- Inventory: one stale-branch workflow, no secrets, no webhooks.
- Dependencies: none. Vercel uses its own GitHub App; no required check uses Actions.
- Change: one repository-only setting. Verify, then roll back if needed. Not changed.

## 5. H3 — staging isolation (preparation approved)

- Configuration: `tools/engineering-runner/staging/staging-config.json`.
- The staging repo is private, with Actions off, never connected to Vercel.
- The SSH deploy key works on staging only and has no API access.
- In the runner clone, fetch comes from the public main repo, push goes to staging, the credential helper is empty, and SSH is restricted to that one key.
- Implementation tests and rollback are listed. Nothing created.

## 6. H5 — checkpoint archive (isolated preparation)

- Task spec: `tools/engineering-runner/archive/archive-task-spec.json`. Manual worker only, artifacts only, files limited to checkpoint reports and manifests.
- Tool: `tools/engineering-runner/archive/archive-checkpoint.mjs`. It uses only the existing gateway ops (create upload, PUT, register with SHA-256), and counts a file as stored only when the server's returned checksum equals the local one.
- Recovery check: the CEO downloads one file from Engineering Review, and its SHA-256 must equal the manifest.
- **The tool's own automated test was not completed this cycle.** The server side it relies on is tested (033 C1–C6).
- No production record created.

## 7. H6 — runner enforcement probe (controlled test preparation)

- Probe: `probe-031-list.txt`, 28 harmless actions (on PR #67).
- Run procedure: `tools/engineering-runner/probe/RUNNER_PROBE_RUN_PROMPT.txt`. Claude Code swaps the runner task's prompt for one run, with the runner OFF, then restores it.
- Grader: `tools/engineering-runner/probe/evaluate-probe.mjs`. Per-action PASS/FAIL plus side-effect checks on the canary folder and the test remote. **Not yet tested.**
- Not run.

## 8. H7 — the 12 worker authorizations (review; nothing revoked)

All 12 were authorized by `ceo`, have a boundary, and have no runner scope.
- **Worker:**
  - 9 were claimed by `worker:Cowork — Primary Engineering Worker` (`2bc9385c`, active, last seen 2026-10-30 21:14 during R2 validation);
  - 1 by `cowork-engineering-agent`;
  - 2 never claimed.
- **Leases:** every lease expired in August 2026.

**Proposed revocation list: revoke all 12.** Revoking removes only the task's agent authorization. The task, its history and its evidence stay. Keep the worker credential `2bc9385c`, which the runner design uses.

| Task | Status | Engine | Authorized / last activity | Reason |
|---|---|---|---|---|
| d53dcc73 | done (CEO approved) | MMMOS | 08-18 / 08-18 | Finished; grant no longer needed |
| cfb2338e | done (CEO approved) | Frontend | 08-24 / 08-25 | Finished |
| 26fe348a | open | Production Pipeline (SMM) | 08-20 / never claimed (10-27 entries are denied R1 release probes) | Unused grant |
| 1051d55e | open | CDP | 08-22 / never | Unused grant (Decision #16 release, superseded) |
| 4c7daae5 | open | Brain v2 | 08-25 / never | Unused grant |
| d77ece4e | open | Engineering Tasks | 08-23 / 08-23 | Abandoned claim |
| 8c96e688 | open | AI Creation Studio | 08-24 / 08-24 | Abandoned claim (business work: re-authorize if resumed) |
| ffcb20d6 | open | Frontend (SMM video) | 08-25 / 08-25 | Abandoned claim (business defect may still matter: re-authorize if resumed) |
| f94a57aa | open | Brain v2 | 08-25 / 08-25 | Abandoned claim (follow-up of ffcb20d6) |
| a1a5b99e | open | Brain v2 | 08-25 / 08-25 | Superseded: run_id gateway fix shipped in R1 |
| c6ccdc1d | open | Engineering Tasks | 08-25 / 08-25 | Superseded by the R2 runner/PR design |
| 3d3ea190 | open | Engineering Tasks | 08-25 / 08-25 | Superseded by the R2 runner/PR design |

**Dependencies:**
- none of the 12 has an active lease or a runner scope;
- the runner path already excludes them;
- revoking does not affect the worker credential, other tasks, or any business engine.

## 9. H8 — ChatGPT Business (hold)

No purchase, no subscription change, no adviser activation. Compatibility is preserved:
- the MCP connector, OAuth endpoints and GPT Actions schema are unchanged;
- the adviser tests still pass (R1 87/87, R2 91/91);
- the business enum picks up new businesses (H9) automatically.

## 10. H9 — NextWave Finance Pilot (design approved)

`docs/platform/NEXTWAVE_FINANCE_PILOT_DESIGN.md` gives the pilot:
- its own business key `nextwave_finance_pilot`, folders, task history and private artifact path;
- separation from NextWave V1 and the V2 key/task `2e17bd23`;
- the exact server change and tests;
- a review flow with separate publishing authorization.

No registration, no credentials.

## 11. Protection of businesses

- No business engine, `lib/`, business API folder, migration or `vercel.json` changed on any branch.
- Task 125 untouched. `.pause-deploy` present. CEO-015 `cdffbbf` untouched.
- Flags ON: only `state_merge_only`. 0 advisers, 0 runner-eligible tasks, 0 artifacts.
- Runner task: `~/mmmos-runner`, manual only.

## 12. Ordered implementation plan, with rollback points

1. **H1:** release #68 (+035 if accepted), then merge #67, per the runbook. Rollback: RP2.
2. **H2:** turn Actions off. Rollback: re-enable.
3. **H7:** revoke the 12. Rollback: re-authorize individual tasks.
4. **H6:** one probe run, graded by the grader. Rollback: restore the runner prompt.
5. **H5:** create, authorize and claim the archive task; archive the checkpoints; CEO downloads one to check recovery.
6. **H3:** staging repo and deploy key; run the implementation tests. Rollback: delete the key and repo.
7. **H4:** create the App, install settings in production env only, apply the ruleset, add the connector tool, then a controlled end-to-end runner → staging → PR test with `eng_runner` ON for that one task only. Rollback: uninstall the App and remove the settings (the op fails closed again).
8. **H9:** Finance Pilot server change, as its own PR.
9. **H8:** later, as a separate business decision.

## 13. Unresolved blockers

- Production is exposed until H1.
- The live enforcement probe needs H6.
- Staging, identity and the PR opener need H3 and H4.
- ChatGPT needs H8.
- Archive and grader tests are still to be finished, as routine engineering in the next cycle.

## 14. Minimum CEO decisions

> I approve:
> - **H1:** release PR #68 (with the 035 additions) to production, then merge PR #67.
> - **H2:** disable GitHub Actions for MMMOS1406/mmmos.
> - **H7:** revoke the 12 listed authorizations.
> - **H6:** one runner probe run with the runner OFF.
> - **H5:** one checkpoint-archive task.
> - **H3/H4:** create the staging repo, its deploy key, the PR-opener GitHub App and the runner-refs ruleset as specified.
>
> H8 stays on hold.

## 15. NEXT ACTION and OWNER

- **PM:** review this checkpoint.
- **CEO:** the decisions in §14.
- **Claude Code:** execute §12 in order and report once.
