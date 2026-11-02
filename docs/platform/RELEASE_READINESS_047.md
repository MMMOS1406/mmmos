# Release readiness, final review (047): PR #75 and PR #76

Read-only review. Nothing was merged or deployed. Both PRs are still drafts. Base: main 71546c3. Production: dpl_6jmdF5CErnssMvYTbVEVNMyZFuhj.

## PR #75: NextWave Finance Pilot registration (head 02abc3c)

- **Diff vs current main:** 8 files, +107 −5. Branch based on current main; merge state CLEAN; checks SUCCESS.
- **Server change (`api/ops.js`), lists only:**
  - `nextwave_finance_pilot` added to `ENG_BUSINESSES`;
  - its 3 folders added to `ENG_BUSINESS_PATHS`;
  - "NextWave Finance Pilot" added to the Task Generator component list.
- **App change:** `_engBusinessLabel` shows "Name (key)" in two Engineering screens.
- **New files:** `projects/`, `tests/projects/` and `docs/projects/nextwave-finance-pilot/`, all README or config only.
- **Isolation (17/17):**
  - pilot tasks are confined to the pilot folders;
  - NextWave V2 code and tests, other businesses and `api/ops.js` are refused;
  - V2 tasks cannot touch pilot folders;
  - artifacts are stored under `nextwave_finance_pilot/`.
- **Unchanged:** no shared lifecycle change, no handler body change, no new action. The "nextwave" (V2) key and folders are byte-identical.
- **Not enabled:** paid generation and publishing are `enabled:false` in `pilot.config.json`. Nothing reads that config yet; no generation or publishing code exists for the pilot.
- **Deployment impact:**
  - one production build, with no migration, no environment change and no data change;
  - Engineering screens show business names with keys;
  - adviser schema lists the new key (adviser connection stays OFF).
- **Release:** mark ready, merge to main, then:
  - production deployment READY;
  - verifier;
  - one CEO-session read of the Engineering artifacts screen.
- **Rollback:** promote dpl_6jmdF5CE (instant), or revert the merge commit.

## PR #76: authentication remediation P1 (head dc4c1c6)

- **Diff vs current main:** 3 files, +111 −17 (after the 047 test commit). Based on current main; merge state CLEAN; checks SUCCESS.
- **11 actions, rechecked:**
  - approve, reject;
  - heygen_render_status, save_heygen_execution, save_suno_execution, delete_asset;
  - generate_package, nextwave_v2_generate_scene_package, nextwave_v2_generate_visual_plan, delete_memory_item;
  - sm_video_production_generate.
- **Gate:** reuses `_publishGate` (CEO or VA session; enforce mode, because the VA PIN is set and there is no mode row). No handler body changed.
- **Proof (16/16 on the real code):**
  - anonymous callers refused (401) for all 11, with no table change;
  - forged CEO and VA tokens refused for all 11;
  - a CEO session passes for all 11;
  - **new in 047:** a VA session from the real `operator_login` passes for all 11, and a wrong PIN is refused;
  - **new in 047:** `PUBLISH_GATED_ACTIONS` and the publishing gate code are byte-identical to main.
- **App call sites:** **17** (not 14 as reported in 046), each a one-for-one change from `fetch(` to `_publishFetch(`. One visual-plan call already used `_ceoAuthedFetch`. `_publishFetch` sends the CEO token, or the VA token when there is no CEO session.
- **Other callers:** no server code, cron or other tracked file calls the 11 over HTTP.
  - Root `index.html` (stale v16.28.0) has 14 calls, but it is not served; production serves `public/index.html` v16.66.0.
  - Legacy `public/index_staging.html` is served (200) but not linked; its 9 calls will be refused.
- **Cross-business:** only `api/ops.js` (router gate), `public/index.html` (call sites) and one test change. The SRV group of 3 stays deferred (`SRV_AUTH_REMEDIATION_PACKAGE_047.md`).
- **Compatibility risks (low):**
  - a user whose 12-hour session expired sees "session_required" until they sign in again;
  - a VA on an old legacy local-PIN state (no server session) is refused until they sign in through the server VA login;
  - the legacy staging page is refused.
- **Release:** mark ready, merge, then:
  - production deployment READY;
  - verifier plus anonymous POST probes of the 11 (each must be 401 `session_required`, with no write);
  - one CEO-session read of the approvals screen.
- **Rollback:** promote dpl_6jmdF5CE, or the deployment of the PR #75 merge if #75 is released first; or revert the merge commit.

## Both PRs together

- They merge cleanly with each other and with main (combined build 7ab36ad).
- **Recommended order:** #75 first (lowest risk), then #76. Each gets its own production check, so each rollback point is one deployment.
- **Combined test results:** see `tests-2026-11-01-047-combined.txt`.
