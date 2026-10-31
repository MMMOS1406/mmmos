# MMMOS Engineering Runner — isolation (MMMOS-R2-RUNNER-ISOLATION-030)

Status on 2026-10-30: **installed, runner OFF.** `eng_runner` and `eng_adviser_connect` have no row in
`mmm_platform_flags` (= OFF). 0 advisers, 0 runner-eligible tasks, no schedule, no new credentials.
This file is the durable record. It does not depend on any chat history.

## 1. Layout

| Path | What | Who may write |
|---|---|---|
| `~/mmmos-runner/` | Dedicated runner folder. The runner session must start here. | runner (sandboxed) |
| `~/mmmos-runner/.claude/settings.json` | Runner-only Claude Code settings (copy of `tools/engineering-runner/claude-settings.runner.json` minus `_comment`), mode 444 | nobody (deny rule + sandbox denyWrite) |
| `~/mmmos-runner/repo/` | **Independent clone** of `MMMOS1406/mmmos` (own `.git`, not a worktree of `~/mmm-static`, so it shares no refs or config with the production checkout) | runner |
| `~/mmmos-runner/repo/.git/config` | `core.hooksPath=/Users/abdulmahmady/MMM/engineering-agent/hooks`, `mmmos.runner=true`, runner author identity | nobody (sandbox mandatory + denyWrite) |
| `~/mmmos-runner/reports/` | QA reports (outside the clone so the guard does not flag them) | runner |
| `~/MMM/engineering-agent/hooks/pre-push` | Installed push guard (= `tools/engineering-runner/hooks/pre-push`) | nobody (outside the sandbox write area) |
| `~/MMM/engineering-agent/runner-guard.mjs` | Installed path/branch guard (= `tools/engineering-runner/runner-guard.mjs`) | nobody |

Checksums at install (sha256): settings `fab60a97136d581a…`, pre-push `599b86b8ce8337f8…`, runner-guard `163d49d7ec03f6fe…`.

The old 029 location `~/mmm-static-wt/runner/` (worktrees of the production checkout) is **retired**:
worktrees share refs and config with `~/mmm-static`. The 029 `core.hooksPath` on `~/mmm-static` was unset.

## 2. Layers and what each one stops

1. **Claude Code permission rules** (`permissions.deny`, enforced by Claude Code, not the model; deny beats
   any allow and any permission mode; `disableBypassPermissionsMode: disable`). Blocks `vercel`, all `gh`,
   `git push --no-verify/--force/-f/--delete/--mirror/--all/--tags`, `git push origin main`, `git -c`,
   `git config`, `git credential*`, `git remote`, `git worktree`, `/usr/bin/git`, `env`, `eval`, `sh/bash/zsh -c`,
   `launchctl`, `crontab`, `security`, `curl`, `wget`, `ssh`, `supabase`, `psql`, `.auto-deploy.sh`; reading the
   worker credential, gh/vercel/ssh config, `.env*`; editing `~/mmm-static`, `~/mmm-static-wt`, `~/MMM`,
   `~/.claude`, the runner's own `.claude`, the clone's `.git`, `~/Library`, `~/.config`, shell rc files.
   Paths use `~/…`: a single leading `/` means "relative to the settings folder" (the 027 draft had this bug).
2. **macOS sandbox** (`sandbox.enabled`, `failIfUnavailable: true`, `allowUnsandboxedCommands: false`). Every
   shell command runs sandboxed with no escape hatch. Writes only inside `~/mmmos-runner` (minus `.claude`,
   `repo/.git/config`, `repo/.git/hooks`). Network only `github.com`. So no `api.github.com` (no merges, no
   settings, no secrets through the API), no Vercel, no Supabase, no MMMOS API from the shell. Reads of the
   worker credential and gh/vercel/ssh config are denied at the OS level.
3. **Push guard** (`pre-push`). Enforced in any checkout under `~/mmmos-runner` or marked `mmmos.runner=true`.
   An environment variable can add enforcement, never remove it. Allows only `refs/heads/runner/*`; refuses
   `main`, tags, other branches, deletes and force pushes.
4. **Server side, GitHub ruleset `26252619` on `main`**: no deletion, no force push, **pull request required**
   (0 approvals). No bypass actors, so it binds the owner's own credential.
5. **Server side, MMMOS**: runner claims need `eng_runner` ON plus the CEO's per-task "Authorize for Runner"
   (`scope.runner.gate = r2`); otherwise 409 `runner_disabled`. `submit_pull_request` re-checks every changed
   file against the task's business allowlist (`_engRunnerPathCheck`).
6. **Runner guard** (`runner-guard.mjs`, run before each commit/push): inside `~/mmmos-runner/repo`, marked
   clone, `runner/` branch, files only inside the task's allowed prefixes, never `vercel.json`,
   `package.json`, `migrations/`, `.github/`, `.env`, auto-deploy files.

## 3. Requirement → evidence

| The runner cannot… | Enforced by | Evidence (030) |
|---|---|---|
| Merge pull requests | deny `gh:*`; sandbox blocks `api.github.com`; `curl` denied | settings test 30/30; live Claude probe pending (§6) |
| Deploy production | deny `vercel*`, `launchctl`, `.auto-deploy.sh`; sandbox blocks writes to `~/mmm-static/public` (watched by auto-deploy); network blocks vercel.com | settings test; `launchctl` auto-deploy untouched |
| Modify the production checkout | separate clone; deny Edit/Write `~/mmm-static/**`; sandbox write area is `~/mmmos-runner` only | runner-guard refuses in `~/mmm-static` (live check) |
| Push to main | push guard; deny rules; **GitHub ruleset PR-required** | hook test 12/12; probe ruleset refused an owner `--no-verify` push with GH013 |
| Change secrets | deny `gh secret`, `vercel env`, `supabase`; sandbox network allowlist; credential reads denied | settings test |
| Bypass task authorization | server gate (`eng_runner` OFF → 409); per-task CEO gate | R2 suite 91/91; 0 runner-eligible tasks |
| Modify another MMMOS business | runner-guard prefixes + server allowlist recheck on PR | R2 suite 91/91; isolation suites 13/13, 33/33, 11/11 |

Push guard bypass tests (local test remote, real git): normal push to main, tag, delete → refused;
`MMMOS_RUNNER_ROOT=/nonexistent` → still refused; `--no-verify`, `git -c core.hooksPath=/dev/null`,
`GIT_CONFIG_COUNT/KEY/VALUE` → **skip the client hook** (expected for any client-side hook). For the runner
these are denied by rules (`git push --no-verify`, `git -c`, `env`) and, for `main`, refused by the GitHub ruleset.

## 4. Pull request step

Inside the runner folder `gh` and the GitHub API are blocked on purpose: they are the same channel that
could merge PRs or change settings with the owner's token. The runner pushes `runner/<id8>-<ts>` and
reports the branch. **Follow-up (needs PM approval, code change):** let MMMOS open the PR server-side
in `submit_pull_request` (it already holds a production-only GitHub token) from a `runner/*` branch name.

## 5. Install (reproducible)

```sh
mkdir -p ~/mmmos-runner/.claude ~/mmmos-runner/reports
git clone https://github.com/MMMOS1406/mmmos.git ~/mmmos-runner/repo
git -C ~/mmmos-runner/repo config core.hooksPath /Users/abdulmahmady/MMM/engineering-agent/hooks
git -C ~/mmmos-runner/repo config mmmos.runner true
git -C ~/mmmos-runner/repo config user.name "MMMOS Engineering Runner"
git -C ~/mmmos-runner/repo config user.email runner@mmmos.invalid
cp tools/engineering-runner/hooks/pre-push ~/MMM/engineering-agent/hooks/pre-push && chmod 755 ~/MMM/engineering-agent/hooks/pre-push
cp tools/engineering-runner/runner-guard.mjs ~/MMM/engineering-agent/runner-guard.mjs
python3 -c "import json;d=json.load(open('tools/engineering-runner/claude-settings.runner.json'));d.pop('_comment');json.dump(d,open('$HOME/mmmos-runner/.claude/settings.json','w'),indent=2)"
chmod 444 ~/mmmos-runner/.claude/settings.json
gh api -X PUT repos/MMMOS1406/mmmos/rulesets/26252619 --input <(python3 -c "import json;d=json.load(open('tools/engineering-runner/github-ruleset-main.json'));d.pop('_comment');print(json.dumps(d))")
node tests/platform/test_runner_settings.mjs && node tests/platform/test_runner_push_hook.mjs
```

Scheduled task `mmmos-engineering-runner` (manual only): its folder must be `/Users/abdulmahmady/mmmos-runner`
and its prompt `tools/engineering-runner/RUNNER_PROMPT.txt`. Step 0 of the prompt stops the run anywhere else.

## 6. Open items at 030 checkpoint

- **Live Claude enforcement probe** (commit dbe34a4 state): a headless run of the real binary
  (`…/claude-code/2.1.309/…/claude -p … --allowedTools Bash Read Write Edit`) in `~/mmmos-runner`
  attempting 20 blocked actions was itself stopped by the operator session's safety classifier; it needs
  explicit CEO/PM approval to run. Static checks pass (settings test 30/30).
- **Scheduled task still points at `/Users/abdulmahmady/MMM` with the old prompt.** Re-pointing it was also
  stopped by the classifier; set it in the app (folder + prompt) or approve Claude Code doing it.
- **Preview builds receive production secrets** (`SUPABASE_SERVICE_KEY`, `PLAID_SECRET`, `ANTHROPIC_API_KEY`, …
  target `preview`). Any pushed branch, `runner/*` included, is built by Vercel with them, and the branch
  controls `package.json`/`vercel.json`. Previews are sign-in protected (029) but the build itself runs branch
  code. Escalated (shared-system change): options are preview-only non-production keys, a runner fork repo not
  connected to Vercel, or turning off Git deployments for `runner/*` at project level.
- **Shared GitHub identity**: git push in the sandbox uses the owner's keychain credential. Client rules deny
  reading it and the network allowlist limits it to git-over-HTTPS (ruleset-bound), but a dedicated
  repo-scoped deploy key (new credential, CEO decision) would remove the owner token from the runner entirely.

## 7. Rollback

```sh
rm -rf ~/mmmos-runner                                   # runner folder, clone, settings (nothing else depends on it)
git -C ~/mmm-static-wt/runner-controls show c3a82a7:tools/engineering-runner/runner-guard.mjs > ~/MMM/engineering-agent/runner-guard.mjs
git -C ~/mmm-static-wt/runner-controls show ca22b38:tools/engineering-runner/hooks/pre-push > ~/MMM/engineering-agent/hooks/pre-push
# GitHub: back to 029 rules (deletion + non_fast_forward) or remove entirely
gh api -X PUT repos/MMMOS1406/mmmos/rulesets/26252619 --input <(echo '{"name":"protect-main-runner-safety","target":"branch","enforcement":"active","bypass_actors":[],"conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},"rules":[{"type":"deletion"},{"type":"non_fast_forward"}]}')
gh api -X DELETE repos/MMMOS1406/mmmos/rulesets/26252619
```
Production, database, flags and business engines were not changed by 030, so nothing else needs rolling back.
