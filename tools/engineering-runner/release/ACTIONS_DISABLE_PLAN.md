# GitHub Actions disablement plan (H2, prepared in 035)

Inventory (031–034):
- 106 branches scanned. The only workflow is `.github/workflows/decision18-materialize.yml` on stale branch `decision18-materialize` (push trigger on that branch only, `contents: write`, pushes only to its own branch; one run 2026-08-25, failed).
- 0 Actions secrets, 0 webhooks, auto-merge off, `can_approve_pull_request_reviews: false`.
- Dependencies: none. Vercel builds through its GitHub App (not Actions). Releases are PR merges. No status check depends on Actions.

Change (after CEO approval): `gh api -X PUT repos/MMMOS1406/mmmos/actions/permissions --input prepared-032/actions-disable.json` (`{"enabled":false}`).
Verify: `gh api repos/MMMOS1406/mmmos/actions/permissions` shows `enabled:false`; PR #67/#68 checks still green (Vercel only).
Rollback: `gh api -X PUT repos/MMMOS1406/mmmos/actions/permissions -F enabled=true -f allowed_actions=all`.
