# NextWave Finance Pilot — preview-only registration and validation plan (045)

**Status: PLAN ONLY.** Nothing is registered, activated, deployed or published. Every step below needs a separate authorization.

## 1. Verified isolation today (2026-11-01, read-only)

- **No business key.** `ENG_BUSINESSES` on main `71546c3` has no `nextwave_finance_pilot`.
- **No folders, no tasks.** No Finance Pilot folder exists (`projects/`, `docs/projects/`, `tests/projects/nextwave-finance-pilot/` are all absent). No engineering task mentions the Finance Pilot.
- **NextWave V1:** 3 completed lifecycle tasks (`62e3728c`, `0e6d5d8d`, `13ba9951`). No live agent grant.
- **NextWave V2:** task `2e17bd23` is open, with no live agent grant. Runner key `nextwave` maps only to `lib/nextwaveV2`, `nextwave_v2_storyboard_eval/` and `test_nextwave`.
- **Risk if nothing changes:** any task labelled with the engine "NextWave" resolves to business `nextwave`. Its artifacts would then sit beside V2 work under `nextwave/…`. **The Finance Pilot therefore needs its own key before its first task.**

## 2. Important constraint: previews use the production database

Preview builds receive `SUPABASE_SERVICE_KEY` (see `PREVIEW_SECRETS_PLAN_039.md`). So "preview-only" means **the code runs only in a protected preview**. It does **not** mean an isolated database: creating a Finance Pilot task in a preview would write to production.

The plan therefore validates the registration in the stand-in test suite, and uses the preview only for read-only and refusal checks.

## 3. Registration change (one PR, preview first)

1. **Business key:** add `nextwave_finance_pilot` to `ENG_BUSINESSES`.
2. **Folders:** set `ENG_BUSINESS_PATHS.nextwave_finance_pilot = ['projects/nextwave-finance-pilot/', 'tests/projects/nextwave-finance-pilot/', 'docs/projects/nextwave-finance-pilot/']`.
3. **Labels:** in Engineering Review and Stored artifacts, show "NextWave Finance Pilot", never "NextWave".
4. **Task Generator:** "business: nextwave_finance_pilot" (released in 043 and 044) then stores the key automatically.
5. **Unchanged:** no migration, no schema or RLS change, no new storage, no credentials.

## 4. Validation (stand-in tests, then the protected preview)

**Stand-in tests:**
- a runner on a Finance Pilot task cannot touch `lib/nextwaveV2*`, the NextWave V1 files, `api/ops.js` (unless that file is granted) or any other business's folders;
- a `nextwave` (V2) task cannot touch Finance Pilot folders;
- Finance Pilot artifacts land under `nextwave_finance_pilot/<task>/<run>/`;
- the Artifacts view and adviser results never mix Finance Pilot rows with V2 rows;
- a decision with "business: nextwave_finance_pilot" produces a task with that key;
- all existing suites, isolation suites, browser tests and the preservation harness stay identical to `main`.

**Protected preview:** Vercel sign-in, with read-only checks only:
- anonymous refusal of all engineering actions;
- the page loads.

No task is created in the preview.

## 5. After validation (each step a separate CEO decision)

1. Release the registration PR.
2. The CEO creates the first Finance Pilot task with "business: nextwave_finance_pilot" and authorizes it (manual).
3. Media is stored as private artifacts with SHA-256. Previews are reviewed through Stored artifacts.
4. Creative acceptance by the CEO.
5. Publishing is a separate, per-video CEO authorization through the existing approved path. It is never done by the runner.

## 6. Rollback

- Before release: close the PR.
- After release: revert the merge. No data migration to undo. Existing tasks keep their recorded `packet.business`.
