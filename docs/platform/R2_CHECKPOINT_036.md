# MMMOS-R2-CHECKPOINT-036 (2026-10-31)

Authority: CEO (bounded H1–H7 from Checkpoint 035). H8 on hold. Executed by: Claude Code.

## A. Executive outcome and production health

**The security release is live and verified.**
- Production is `dpl_8HGJvLgayKZ2ZwKyVh4NQmTUB8s6` on `main` `663d6aa` (PR #68 + #69, then PR #67).
- All 17 anonymous engineering reads now return 401. Public pages answer 200. The worker credential still works.
- The only runtime warning is the old Node `url.parse()` deprecation notice.

**Also done:**
- GitHub Actions disabled for `MMMOS1406/mmmos`.
- Private staging repo with a staging-only deploy key, tested.
- A corrected runner-refs ruleset applied.

**Not done, and not claimed:**
- **H5 (archive), H6 (probe), H7 (revocations)** each need a CEO session or a CEO-started action. The exact steps are in §L.
- **The H4 GitHub App** needs creation in GitHub's web UI. The PR opener stays inactive (fails closed) until then.

**Release 2 is not fully integrated:** `eng_runner` and `eng_adviser_connect` are OFF, and the ChatGPT connection is on hold (H8).

## B. Status H1–H7

| | Status | Evidence |
|---|---|---|
| H1 Security remediation | **COMPLETE** | §C, §D: verifier PASS on production |
| PR #67 runner safeguards | **COMPLETE** | merged `663d6aa`; tests and live checks §D |
| H2 GitHub Actions | **COMPLETE** | `enabled:false`; workflow file preserved on `decision18-materialize` |
| H3 Staging + runner identity | **COMPLETE** | repo, key and tests in §I |
| H4 PR opener | **PARTIAL: mechanism live but inactive; ruleset applied; App not created** | 503 until configured; App creation needs the CEO in GitHub (§L3) |
| H5 Checkpoint archive | **BLOCKED (needs CEO session)** | creating and authorizing a task are CEO-session actions (§L1) |
| H6 Runner probe | **BLOCKED (platform)** | the safety classifier refused changing the runner task prompt, so the run was not started (§L2) |
| H7 Stale authorizations | **BLOCKED (needs CEO session + control)** | no app control called the CEO-gated revoke; prepared PR #70 (§L4) |

## C. PRs, commits, deployments, migrations

| Item | Value |
|---|---|
| Baseline | `main` `c3a82a7`, production `dpl_FLAa1VzaexmJYMcsdaF1wLneAo6m` |
| PR #69 → #68 branch | merge `362f9bc` (tree identical to the tested 035 head `6426b3a`) |
| PR #68 → main | merge `54f5e9735e471c9bb2d5566b237c13f2b6883e6e`, production `dpl_HaeJiHGogBDSjYXe1YshBXsf65Ym`, build log `MMMOS RELEASE GUARD: env=production ref=main` |
| PR #67 → main | merge `663d6aa61848e0b391c4a00a07be4b0ebd4f37f6`, production `dpl_8HGJvLgayKZ2ZwKyVh4NQmTUB8s6` |
| PR #70 (draft) | H7 revoke control, branch `mmmos-eng/r2-revoke-control-036` |
| Migrations | **none** (last applied is still `20261030211025`) |
| GitHub | Actions OFF (before: `{"enabled":true,"allowed_actions":"all"}`, saved in `release/actions-settings-before-036.json`). Rulesets: `26252619` main (deletion, non_fast_forward, pull_request; no bypass); **new `26286416` runner-app-refs-only** (creation/update/deletion on everything except `runner/**`; admins bypass) |

## D. Test evidence

| Test | Result |
|---|---|
| Live anonymous-denial verifier (`release/verify-postrelease-2026-10-31.txt`) | **PASS**: 17/17 reads 401; `/` and OAuth metadata 200 (before release: 14 reads were 200) |
| Live worker credential (`eb_worker_list_authorized_tasks`) | **PASS**: returns its 12 tasks |
| Live runtime errors after release | **PASS**: only the pre-existing deprecation warning |
| `main` + #67 trial: runner guard-denied 3/3, settings 30/30, push hook 12/12, R2 91/91, 033 35/35, PR opener 28/28 | **PASS** |
| Live runner controls | **PASS**: `claude sandbox status` enabled/strict from settings; clone credential helper empty; hooks path bound; `mmmos.runner=true` |
| H3 push tests | **PASS**: runner branch → staging allowed; main → staging refused by the guard; key against `MMMOS1406/mmmos` refused by GitHub ("denied to deploy key"); HTTPS without credential fails; no Vercel deployment from staging |
| Ruleset 26286416 owner check | **PASS**: owner can still create and delete a feature branch; `main` still PR-only |
| H7 control (PR #70) | **PASS** 10/10; platform suites 43 identical + all new green; browser 26/26, 9/9 |
| Live CEO-session screens | **NOT RUN**: needs a CEO sign-in (covered by stand-in tests S8–S12, 034) |
| H6 probe | **NOT RUN** |

## E. Security and cross-business isolation

- Changes on `main` are the engineering/brain routes in `api/ops.js`, Engineering UI code, engineering tests, docs and `tools/engineering-runner/`.
- No business-engine code, `lib/`, migrations or `vercel.json` changed.
- Isolation suites unchanged: release 13/13, state 33/33, client e2e 11/11.
- Task 125 untouched. `.pause-deploy` present. CEO-015 `cdffbbf` untouched.
- No NextWave V1/V2/Finance Pilot, SRV Farsi, SRV Studio, AI Creation Studio or SMM change.
- No publishing, no uploads, no spending. The staging repo is a free private repo.

## F. Switches

`mmm_platform_flags`: only `state_merge_only` = true. **`eng_runner` OFF, `eng_adviser_connect` OFF.**
- 0 advisers, 0 runner-eligible tasks, 0 leases, 0 agent runs in 3 hours.
- Runner task: cwd `~/mmmos-runner`, no cron, no fire time, never run. Its prompt is unchanged (sha256 `3ac2205bb257b166…`).

## G. Durable archive

- **MMMOS archive: not created (H5 blocked).** The bucket `engineering-artifacts` holds 0 objects. Nothing is claimed as stored in MMMOS.
- **Versioned repository archive:** checkpoints 027–035 are on `main` (`docs/platform/`), merged with #67/#68. This checkpoint and its manifest are on branch `mmmos-eng/r2-checkpoint-036` (pushed), with manifest `docs/platform/R2_CHECKPOINT_036.sha256`.
- **Note:** the repository is public, so it is versioned, but it is not private storage.

## H. Fresh-session recovery

- Repository: any fresh clone of `MMMOS1406/mmmos` at `663d6aa` holds checkpoints 027–035. This checkpoint is on `mmmos-eng/r2-checkpoint-036`. Verify with `shasum -a 256 -c` against the `.sha256` manifests (paths are listed per commit).
- MMMOS recovery: **not proven** (H5 blocked).

## I. Credential scope and revocation audit

| Credential | Scope | Can't | Revoke |
|---|---|---|---|
| Deploy key `168324989` (ed25519, SHA256:A9hswUzi…, `~/mmmos-runner-keys/id_ed25519`, mode 600, never printed) | write to `MMMOS1406/mmmos-runner-staging` only | API, the canonical repo, merges, settings, secrets, deploys (staging has no Vercel link) | `gh api -X DELETE repos/MMMOS1406/mmmos-runner-staging/keys/168324989`; `rm -rf ~/mmmos-runner-keys` |
| GitHub SSH host key | `~/mmmos-runner-keys/known_hosts`, checked against GitHub's published ed25519 fingerprint | — | delete the file |
| Runner clone | fetch: public HTTPS (no credential); push: staging over SSH with the key above; `credential.helper` empty | use your GitHub login | `git -C ~/mmmos-runner/repo remote set-url --push origin https://github.com/MMMOS1406/mmmos.git` |
| PR-opener App | **not created** | — | — |
| 12 task authorizations | still live; no leases; manual-worker path only | runner path excludes them | §L4 |

- Your personal GitHub login is not used by the runner.
- The staging repo's default branch is `runner/h3-036-keytest` (the first push to an empty repo). It holds a copy of public `main`.

## J. Rollback and residual risks

- **Production:** promote `dpl_FLAa1VzaexmJYMcsdaF1wLneAo6m` (pre-release), or revert merge `54f5e97` (and `663d6aa`).
- **Actions:** `gh api -X PUT repos/MMMOS1406/mmmos/actions/permissions -F enabled=true -f allowed_actions=all`.
- **Ruleset:** `gh api -X DELETE repos/MMMOS1406/mmmos/rulesets/26286416`.
- **Staging:** delete key `168324989`, delete the repo, restore the push URL as above.

**Residual risks:**
1. Preview builds still receive production secrets. They matter only for branches pushed to the canonical repo, which the runner cannot do.
2. The PR opener stays inactive until the App exists.
3. The live in-session probe has not run.
4. The 12 grants are live until §L4.
5. The connector tools `eb_create_task`, `eb_update_task` and `eb_load_task` have been refused since B10.
6. Business-engine actions have not had a login audit.

## K. PM decisions

1. Approve releasing PR #70 (the H7 control). It's a UI change only, using the existing CEO-gated revoke.
2. Accept H5/H6 as CEO-session steps (§L1–L2), or keep them deferred.
3. Schedule the business-engine authentication audit (read-only) as its own order.

## L. CEO actions (only these need you)

1. **H5 archive task (about 2 minutes, in MMMOS):** sign in as CEO, then:
   - In Engineering Brain → Task Generator, paste: *"Decision: create one MMMOS engineering task 'Checkpoint archive' (business: mmmos). Scope: store engineering checkpoint reports and their SHA-256 manifests as private artifacts only. No repository changes, no runner, no deployment."*
   - In Engineering Review, click **Authorize** on that task (manual, not runner).

   Claude Code then claims it and archives the checkpoints, with server-verified SHA-256 for each.
2. **H6 probe (about 1 minute):** start a new Claude Code session with folder `/Users/abdulmahmady/mmmos-runner` and paste the one line from `~/mmmos-runner/reports/RUN_PROBE_031.txt` (marked withdrawn in 032; re-instated for H6). Claude Code grades the result with `tools/engineering-runner/probe/evaluate-probe.mjs`.
3. **H4 App (about 3 minutes, GitHub):** create the GitHub App from `tools/engineering-runner/pr-opener/github-app-manifest.json` (private; contents/PR write, metadata read; no webhooks), and install it on `mmmos` and `mmmos-runner-staging` only. Keep its private key yourself until the PM approves activating the opener. **No key in chat.**
4. **H7:** after PR #70 is released, open Engineering Review → **Unused agent authorizations (12)** → **Revoke all 12** → confirm.

## M. NEXT ACTION and OWNER

- **PM:** decisions in §K.
- **CEO:** §L1–L4, whenever convenient.
- **Claude Code:** after each CEO step, completes and verifies H5 (archive with checksums and recovery), H6 (graded probe), H7 (revocation check, worker access intact) and H4 (App installed; opener still inactive until the PM approves), then reports once.
