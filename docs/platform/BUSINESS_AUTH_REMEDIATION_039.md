# Business-engine authentication remediation plan (039)

Read-only analysis of the 50 write-like actions flagged in audit 038. Nothing was changed or deployed.

## Method and verified exclusions

- **Static review of `api/ops.js` on main `e69367b`.** For each action: the handler body, the tables it writes, paid external APIs, delete calls, app callers (`public/index.html`), and callers in other server files. Per-action data: `SECURITY_AUDIT_039_business_actions.json`.
- **Verified protected and excluded:**
  - every publishing action is behind the router `_publishGate`, which is in **enforce** mode (VA PIN set, no override);
  - TikTok publishing is frozen in code;
  - platform connections check `ceo_authorization_required` in the handler;
  - `engineering_task_agent_claim` checks a per-task token.
- **Gate hints re-checked:** for `generate_package`, `nextwave_v2_generate_scene_package`, `heygen_render_status` and `seed_memory`, the hint came from prompt text or names. There is no real check, so they are **genuinely unprotected**.
- **Not probed in production** (the order and safety rules forbid writes).

## Classification (all 50 genuinely without a login check)

| Category | Count | Actions |
|---|---|---|
| Paid generation (AI/media APIs) | 10 | generate_package, nextwave_v2_generate_scene_package, nextwave_v2_generate_visual_plan, sm_video_production_generate, srv_build_package, srv_english_regen_caption, farsi_regen_caption, heygen_render_status, save_heygen_execution, save_suno_execution |
| Deletion | 2 | delete_asset, delete_memory_item |
| Approvals | 2 | approve, reject (`approvals` table) |
| Publishing | 0 | (all publishing is gated) |
| Other state changes | 36 | operator tasks, assets/pipeline/upload queue, notifications, memory, client service plans, business brain, CDP, analytics, roadmap, optimization |

Callers:
- **42** are called by the app (CEO or VA screens).
- **1** (`analytics_auto_run`) is called by the YouTube autosync cron.
- **7** have no caller outside the router: cdp_create, cdp_record_learning, roadmap_update_phase, save_performance, srv_english_build, va_task_queue_generate, publishing_router_resolve.

## Shared fix pattern (same as engineering 033/034)

Add a check in the router, or at the top of the handler, using the **existing** identity helpers:
- **CEO-only actions:** `requireCeoSession`.
- **CEO-or-VA actions:** `_publisherFromRequest`, which already returns `ceo` or the VA operator session. The VA PIN is set, so VA screens hold a session token.
- **Cron caller:** verify Vercel's cron `Authorization: Bearer $CRON_SECRET` (`CRON_SECRET` would be a new production-only setting, no cost) or move the call in-process.
- **Unused actions:** CEO-only, or remove after confirming no caller.

Then change the app's calls to send the session (`_ceoAuthedFetch`, or the VA session helper), plus tests.

## Plan per business (each one PR, each its own release decision)

1. **Operator / VA task system (shared core).**
   - Actions: create_task, update_task, update_task_execution, approve, reject, create_notification, create_notification_table, mark_all_read, mark_notification_read, add_to_upload_queue, update_upload_status.
   - Gate: CEO-or-VA.
   - Risk: approvals and task state can be forged.
   - Tests: anonymous → 401; VA and CEO keep working; VA cannot approve unless that is the business rule today; isolation suites.
   - **Shared system → CEO decision**, because it changes VA flows.
2. **Production assets and pipeline (AI Creation Studio / SMM production).**
   - Actions: create_asset, update_asset, delete_asset, save_task_asset, create_pipeline_item, update_pipeline_stage, heygen_render_status, save_heygen_execution, save_suno_execution.
   - Gate: CEO-or-VA. `delete_asset` gets CEO-only plus a confirmation.
   - Risk: paid HeyGen polling and chaining, asset deletion.
3. **NextWave (V1 engine and V2 work, separately).**
   - Actions: generate_package (V1), nextwave_v2_generate_scene_package, nextwave_v2_generate_visual_plan, save_memory_item, delete_memory_item, seed_memory, save_performance.
   - Gate: CEO-only (V2 generation, memory delete/seed); CEO-or-VA where VA screens use them.
   - Risk: paid generation, memory deletion.
   - Must not touch the Finance Pilot design.
4. **SRV Farsi / SRV English.**
   - Actions: srv_build_package, srv_english_build, srv_english_regen_caption, srv_english_render_status, farsi_regen_caption, youtube_sync_performance.
   - Gate: CEO-or-VA.
   - Risk: paid generation.
   - SRV Studio V2 actions are already gated.
5. **SMM / client operations.**
   - Actions: sm_va_task_generate_package, sm_video_production_generate, sync_marketing_work_items, business_operations_curate_asset, business_operations_update_schedule_prefs, business_operations_update_service_plan, business_brain_create.
   - Gate: CEO-or-VA.
   - Risk: paid generation, client plan changes.
6. **CEO decision / analytics / platform (MMMOS).**
   - Actions: cdp_create, cdp_generate_recommendations, cdp_record_learning, analytics_auto_run (cron), analytics_sync_status, optimization_toggle_auto, roadmap_update_phase, publishing_router_resolve, va_task_queue_generate.
   - Gate: CEO-only; the cron one gets a cron secret.

**Order of work:** paid generation first, then deletion and approvals, then the rest. Every PR follows the 033/034 pattern:
- a router or handler gate;
- app calls updated;
- anonymous-refusal tests per action;
- positive tests per role;
- preservation harness;
- isolation suites;
- post-release live anonymous probes (reads only; writes verified in the stand-in).
