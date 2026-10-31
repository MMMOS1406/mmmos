# NextWave Finance Pilot — isolated business architecture (H9, design only, 035)

Status: **design approved by the PM; nothing created.** No credentials, no production tasks, and no change to NextWave V1 or to the earlier NextWave V2 work.

## 1. Three things that must stay separate

| | NextWave V1 (live engine) | NextWave V2 (earlier work) | **NextWave Finance Pilot (new)** |
|---|---|---|---|
| Runner business key | — (production engine) | `nextwave` → `lib/nextwaveV2`, `nextwave_v2_storyboard_eval/`, `test_nextwave` | **`nextwave_finance_pilot`** |
| Open tasks | live pipeline tasks | `2e17bd23` (HeyGen avatar rendering) | own tasks, `packet.business = nextwave_finance_pilot` |
| Code folders | live NextWave code | as above | `projects/nextwave-finance-pilot/`, `tests/projects/nextwave-finance-pilot/`, `docs/projects/nextwave-finance-pilot/` |
| Artifacts | — | — | `engineering-artifacts/nextwave_finance_pilot/<task>/<run>/` (private) |
| Publishing | existing approved channels | none | **none until a separate CEO authorization per video** |

## 2. Exact server change (to build after H1 is released; a PR of its own)

- `ENG_BUSINESSES`: add `'nextwave_finance_pilot'`.
- `ENG_BUSINESS_PATHS.nextwave_finance_pilot = ['projects/nextwave-finance-pilot/', 'tests/projects/nextwave-finance-pilot/', 'docs/projects/nextwave-finance-pilot/']`.
- Adviser MCP/OpenAPI business enum: add it automatically (both are generated from `ENG_BUSINESSES`).
- Engineering Review: a label "NextWave Finance Pilot", so it is never shown as "NextWave".
- No database migration. Business is a value inside `packet`, and storage paths are already task-scoped.

**Tests to add:**
- a runner on a Finance Pilot task cannot touch `lib/nextwaveV2*`, the live NextWave files or `api/ops.js` (unless shared access is granted);
- a `nextwave` task cannot touch Finance Pilot folders;
- adviser results for a Finance Pilot task never include V2 evidence;
- artifact paths stay under `nextwave_finance_pilot/`.

## 3. Media and review flow

1. The runner (or a manual worker) renders outputs, then uploads MP4s, thumbnails, scripts, narration, source files and QA reports as artifacts. Kinds `video`, `thumbnail`, `script`, `narration`, `source` and `qa_report` all exist from 033.
2. Integrity:
   - files up to 25 MB are hashed by the server;
   - larger renders carry the uploader's SHA-256 and are re-verified by downloading.
3. Private previews: Engineering Review and adviser results give short-lived signed links. Nothing goes to the public `srv-assets` bucket.
4. The PM reviews through adviser results and posts follow-ups. Corrections loop on the same task.
5. CEO final creative acceptance is `engineering_task_ceo_approve` on the task. That approves the creative work only.
6. Publishing is a separate CEO decision per video, carried out through the existing approved publishing path. The runner never has YouTube credentials or network access.

## 4. Prerequisites and order

H1 released → this server change (branch, tests, PR, CEO release) → the first Finance Pilot task is created by the CEO or the adviser (H8) → the runner path after H3/H4/H6.
