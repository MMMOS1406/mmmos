# MMMOS-R2-RUNNER-VALIDATION-031 — checkpoint (2026-10-30)

Order: ChatGPT PM, controlled security validation. Runner stays OFF. Companion to `RUNNER_ISOLATION.md`.

## 1. Live enforcement test

| Attempt | Result |
|---|---|
| Headless run of the real Claude Code binary (2.1.309) in `~/mmmos-runner` | Could not run: the standalone binary is not signed in (the desktop app supplies sign-in to its own sessions). Output: `Not logged in · Please run /login`. |
| Operator session starts a probe session in `~/mmmos-runner` (`start_session`, cwd `~/mmmos-runner`) | **Refused by Claude Code's auto-mode safety classifier**, as in 030. A session cannot launch another session that deliberately tries blocked actions. Not routed around. |
| **Owner-started probe session** | **Pending.** Instructions: `~/mmmos-runner/reports/RUN_PROBE_031.txt`. Probe list (28 harmless actions): `~/mmmos-runner/reports/probe-031-list.txt`. Results land in `~/mmmos-runner/reports/probe-031-results.txt`. |

Probe targets are harmless by construction:
- the canary folder `~/mmmos-runner-canary` (its own throwaway git repo);
- the local test remote `~/mmmos-runner/probe-remote.git` (only `main` = c3a82a7);
- GitHub `--dry-run` pushes;
- an Edit on `~/mmm-static/vercel.json` whose search text cannot exist, so nothing changes even if allowed.

**PASS criteria:**
- actions 1–24 and 26–27 are BLOCKED;
- 25 (runner branch to the local remote) and 28 (write inside the clone) are ALLOWED;
- the canary folder is unchanged (only `README.txt` and `repo/` on `main`);
- the test remote holds only `main` plus `runner/probe-031`.

What is already verified (outside a Claude session):
- settings test 30/30 (rules, sandbox, installed copy identical);
- push-guard test 12/12;
- live push-guard bypass matrix (030 §3);
- GitHub ruleset refusing an owner `--no-verify` push (GH013, 030).

## 2. Runner task working directory

- Task `mmmos-engineering-runner`:
  - cwd changed `/Users/abdulmahmady/MMM` → `/Users/abdulmahmady/mmmos-runner`;
  - prompt replaced with `tools/engineering-runner/RUNNER_PROMPT.txt` (dedicated clone, step 0 preflight, no `gh`);
  - description updated.
- The scheduling tool has no folder field. The folder was changed in the app's task store, `~/Library/Application Support/Claude/claude-code-sessions/…/scheduled-tasks.json`: only the `cwd` value of this one task, with a backup taken.
- After a later app-driven update, it was re-read and still showed `cwd=/Users/abdulmahmady/mmmos-runner`.
- Verified state: `enabled=true`, `cronExpression=null`, `fireAt=null` → **"Manual only"**. Permission mode `auto` (unchanged). The task was **not run**.
- Recovery: in the app, edit the task's folder back to `~/MMM`, or set `"cwd": "/Users/abdulmahmady/MMM"` for `mmmos-engineering-runner` in that file. Re-apply the previous prompt from git (`ca22b38:tools/engineering-runner/RUNNER_PROMPT.txt`).

## 3. Security and isolation results (unchanged since 030, rechecked)

- Flags:
  - only `state_merge_only` is set, so `eng_runner` and `eng_adviser_connect` are OFF;
  - 0 advisers, 0 runner-eligible tasks, 0 agent runs in the last 6 hours.
- Production and previews:
  - production 200, task list without a CEO session 401;
  - the PR #67 preview returns 302 (sign-in required).
- Local:
  - auto-deploy launchd untouched;
  - `.pause-deploy` present;
  - Task 125 untouched;
  - CEO-015 branch `cdffbbf` untouched.
- Suites (network blocked, identical to `main`):
  - R2 91/91, R1 87/87, R1 migration 17/17, B10 13/13;
  - release isolation 13/13, state isolation 33/33, client e2e 11/11;
  - publish auth 92/92, packages backup 11/11;
  - runner hook 12/12, runner settings 30/30.

## 4. Remaining risks and proposed fixes

### A. Runner uses the CEO's GitHub credential
- **Found:**
  - the runner clone inherited the system-wide `osxkeychain` helper (`/Library/Developer/CommandLineTools/…/gitconfig`);
  - the owner account `MMMOS1406` has token scopes `repo` and `workflow`;
  - a dry-run push from the clone authenticated as the owner.
- **Fixed now (no new credential):**
  - `git -C ~/mmmos-runner/repo config credential.helper ""` empties the helper list for the runner clone only;
  - a dry-run push now fails with `could not read Username`, so the runner cannot push as the owner (fail closed);
  - fetch of the public repo still works, and other checkouts are unaffected (`runner-controls` dry run: up to date).
  - Rollback: `git -C ~/mmmos-runner/repo config --unset credential.helper`.
- **Proposed (needs CEO approval: new credential, free):**
  - a repo-scoped **deploy key** with write access, used only by the runner clone over SSH (`core.sshCommand` with `IdentitiesOnly`);
  - it can push branches but cannot call the API, merge, or change settings or secrets;
  - `main` stays protected by ruleset `26252619`;
  - **precondition:** see risk D.

### B. Runner cannot open pull requests
- The server's `submit_pull_request` requires a PR URL. The production `GITHUB_TOKEN` is used read-only.
- **Proposed (recommended, needs CEO + PM approval: new credential and server change):**
  - a GitHub App installed on this repo only, with *Pull requests: write* and *Contents: read*, its key held server-side;
  - `submit_pull_request` opens the PR itself from a `runner/*` branch, and never merges.
- **Interim, no credential:** the runner reports the compare link (`https://github.com/MMMOS1406/mmmos/compare/main...runner/<branch>?expand=1`). The CEO clicks "Create pull request" as part of reviewing.
- **Not recommended:**
  - `gh` inside the runner, because it carries the owner token;
  - a GitHub Actions PR opener, because of risk D.

### C. Can the runner escape its folder?
- **Designed answer:**
  - shell writes are limited by the macOS sandbox to `~/mmmos-runner`, minus `.claude`, `repo/.git/config` and `repo/.git/hooks`, with no unsandboxed fallback;
  - file tools are denied for `~/mmm-static`, `~/mmm-static-wt`, `~/MMM`, `~/.claude`, `~/Library`, `~/.config` and the shell rc files;
  - network is `github.com` only.
- Probes 12–24 test exactly this (Write tool, `touch`, symlink, another repo, unsandboxed request, own settings, git config/hooks).
- **Status:** awaiting the owner-started probe (§1).

### D. New: GitHub Actions is enabled with no workflows (found in 031)
- Settings: `enabled: true`, `allowed_actions: all`, default token `read`. 0 workflows, 0 Actions secrets, 1 historical run.
- Any credential that can push a branch, including a future deploy key, could add `.github/workflows/*.yml`.
- That workflow would run on push with a token that requests write permissions in the file itself. With the 0-approval PR rule, it could merge a PR.
- **Proposed (needs approval: repo setting):** disable Actions for this repo. Nothing uses it today, so the impact is zero. Do this before any runner push credential exists.

### E. Preview builds receive production secrets (escalated in 030, unchanged)
- `SUPABASE_SERVICE_KEY`, `PLAID_SECRET`, `ANTHROPIC_API_KEY` and others target `preview`. Every pushed branch is built with them, and the branch controls its build files.
- **Proposed (needs PM/CEO decision, shared change):**
  - *Option 1:* preview-only non-production keys;
  - *Option 2:* a runner fork repo that is not connected to Vercel.
- Until then, the runner must have no push credential, which is the state after fix A.

## 5. PR #67

Open, **not merged**. This commit adds this file and the `credential.helper` step to the install section.
