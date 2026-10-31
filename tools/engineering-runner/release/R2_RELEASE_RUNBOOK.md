# R2 security release runbook — PR #68 then PR #67 (H1, prepared in 035)

Run only after the CEO writes: "Approve PR #68 release to production and merge of PR #67".

| Step | Action | Check | Rollback point |
|---|---|---|---|
| 0 | `git fetch`; confirm `main` = `c3a82a7` (or rerun all suites on the new main) | both PRs CLEAN, checks green | — |
| 1 | `gh pr ready 68` then `gh pr merge 68 --merge --match-head-commit <head>` | merge commit on `main` | RP1: production still `dpl_FLAa1VzaexmJYMcsdaF1wLneAo6m` |
| 2 | Vercel builds `main` → production | build log `MMMOS RELEASE GUARD: env=production ref=main`; READY | RP2: promote `dpl_FLAa1Vza…` |
| 3 | `sh tools/engineering-runner/release/verify-anonymous-denied.sh` | RESULT PASS (17 reads 401, public 200) | RP2 |
| 4 | CEO-session check in the browser (Claude Code): Engineering Brain, Engineering Review, home card load | no errors | RP2 |
| 5 | Business smoke: production routes 200; `.pause-deploy`, Task 125 untouched; isolation suites on new `main` | identical to before | RP2 |
| 6 | `gh pr merge 67 --merge --match-head-commit <head>` | tooling only; no runtime change | RP3: revert merge commit |
| 7 | Record evidence in the checkpoint (commit, deployment id, verifier output) | — | — |

There are **no migrations** in either PR, so no migration ordering applies. Switches stay OFF throughout. A failure at step 3 or 4 means: promote `dpl_FLAa1Vza…`, report, stop.
