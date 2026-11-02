# Authentication remediation, priority 2 (047) — plan only, nothing deployed

## Corrected count

The 039 plan said "50 actions / 36 other". The per-action audit file (`SECURITY_AUDIT_039_business_actions.json`) and the per-business plan both list **49** actions, so priority 2 is **35** actions:

- 14 handled first: 11 in PR #76, plus 3 in the SRV package.
- 35 remaining: 32 non-SRV here, plus 3 SRV-owned in `SRV_AUTH_REMEDIATION_PACKAGE_047.md`.

All 35 were re-verified on main 71546c3: dispatched by the router, with no gate.

## Groups (one PR each, each its own release decision)

| # | Group | Actions | App call sites | Proposed gate | Notes |
|---|---|---|---|---|---|
| P2-1 | Operator / VA task core (shared) | create_task, update_task, update_task_execution, create_notification, create_notification_table, mark_all_read, mark_notification_read, add_to_upload_queue, update_upload_status (9) | 18 | CEO or VA (`_publishGate`) | Shared VA flows, so a CEO decision is needed. Highest call-site count, so the biggest compatibility surface. |
| P2-2 | Production assets / pipeline | create_asset, update_asset, save_task_asset, create_pipeline_item, update_pipeline_stage (5) | 6 | CEO or VA | Same pattern as PR #76's pipeline group. |
| P2-3 | NextWave V1/V2 memory | save_memory_item, seed_memory, save_performance (3) | 2 | CEO-only for seed_memory; CEO or VA for the others | Must not touch the Finance Pilot. |
| P2-4 | SMM / client operations | sm_va_task_generate_package, sync_marketing_work_items, business_operations_curate_asset, business_operations_update_schedule_prefs, business_operations_update_service_plan, business_brain_create (6) | 6 | CEO or VA | sm_va_task_generate_package is paid generation, so do it first in this group. |
| P2-5 | CEO analytics / platform (MMMOS) | cdp_create, cdp_generate_recommendations, cdp_record_learning, analytics_auto_run, analytics_sync_status, optimization_toggle_auto, roadmap_update_phase, publishing_router_resolve, va_task_queue_generate (9) | 3 | CEO-only (`requireCeoSession`) | `analytics_auto_run` is called by the YouTube autosync cron, so it needs the Vercel cron secret (a new production-only setting, no cost, which is a separate CEO approval) or an in-process call. |

Suggested order: P2-4 (paid generation), then P2-2, P2-3, P2-5, and P2-1 last (largest VA surface).

## Pattern (proven in PR #76)

- Router gate reusing `_publishGate` or `requireCeoSession`, with no change to handler bodies.
- App calls changed to `_publishFetch` or `_ceoAuthedFetch`, one for one.
- Tests per group:
  - anonymous and forged callers refused, with no table change;
  - CEO passes; VA passes via the real sign-in where VA is allowed;
  - no plain fetch left;
  - publishing gate byte-identical to main.
- Full suite comparison with main, browser checks, preservation harness.
- Post-release: anonymous production probes (reads only).

## Known compatibility points (all groups)

- The legacy `public/index_staging.html` is still served (HTTP 200) but not linked. Its calls to gated actions are refused after each release.
- An expired 12-hour session makes a gated action fail until the user signs in again. The app shows the raw `session_required` text. A friendly message can be added in P2-1.

## Status

NOT STARTED. Needs a PM order per group. No deployment.
