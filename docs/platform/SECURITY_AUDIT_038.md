# Security audit 038 (read-only, 2026-11-01)

No security policy was changed. No write action was probed in production.

## 1. Business-engine authentication (static, `api/ops.js` on main `e69367b`)

Full per-action result: `SECURITY_AUDIT_038_actions.json`.

**Totals:** 278 routed actions.
- **168 gated:** CEO session, worker/adviser credential, the publishing gate in enforce mode, or an operator/VA session in the handler.
- **110 without a recognized gate.**

**Publishing is protected.**
- `youtube_upload_video`, `set_yt_thumbnail`, `tiktok_*`, the `srv_studio_v2_*upload/playlist/mix` actions, `srv_farsi_playlists` and `sm_va_task_mark_published` all pass the router-level `_publishGate`.
- Its mode is **enforce**: the VA PIN is configured and there is no `publish_auth_mode` override, so anonymous publish calls are refused.
- TikTok publishing is also hard-frozen in code.

**50 write-like actions without a recognized gate, needing per-business review (not probed):**

| Group | Actions |
|---|---|
| Operator tasks/approvals | create_task, update_task, update_task_execution, approve, reject |
| Assets/pipeline/upload queue | create_asset, update_asset, delete_asset, create_pipeline_item, update_pipeline_stage, add_to_upload_queue, update_upload_status, save_task_asset |
| Memory/notifications | save_memory_item, delete_memory_item, seed_memory, create_notification, create_notification_table, mark_all_read, mark_notification_read |
| Business operations | business_brain_create, business_operations_curate_asset, business_operations_update_schedule_prefs, business_operations_update_service_plan |
| Generation (may spend AI/API credit) | generate_package, sm_va_task_generate_package, sm_video_production_generate, va_task_queue_generate, nextwave_v2_generate_scene_package, nextwave_v2_generate_visual_plan, srv_build_package, srv_english_build, srv_english_regen_caption, farsi_regen_caption, cdp_generate_recommendations, analytics_auto_run |
| Records/sync | save_heygen_execution, save_suno_execution, save_performance, cdp_create, cdp_record_learning, roadmap_update_phase, optimization_toggle_auto, sync_marketing_work_items, youtube_sync_performance, analytics_sync_status, heygen_render_status, srv_english_render_status, publishing_router_resolve |

**Risk.** Anyone who knows the action names could:
- write or delete business operational data (tasks, approvals, assets, memory);
- trigger paid AI generation.

This mirrors the engineering gap fixed in 033/034. Some may be protected in ways a static scan cannot see (for example, state checks).

**Recommendation.** One remediation order per business, owned by that business:
1. Confirm each action's real caller (CEO, VA or cron).
2. Gate it with the existing CEO session, VA session or publishing gate.
3. Change the app calls to send the session.
4. Ship with tests per business.

Generation actions come first (cost exposure), then delete/approve actions.

## 2. Secrets in the public repository

- **Patterns scanned:** Supabase secret/service-role keys, Anthropic/OpenAI keys, GitHub tokens, AWS keys, private-key blocks, Slack tokens, Google API keys.
- **`main` and the checkpoint branches:** 0 matches.
- **All history:** one match, a 20-character placeholder in local-only commit `c3411ed`, never pushed.
- **Result:** no exposed secret. The page's `sb_publishable_…` key is public by design.

## 3. Production secrets in previews

- **Previews receive 16 variables:** ANTHROPIC_API_KEY, APP_URL, ELEVENLABS_API_KEY, HEYGEN_API_KEY, PEXELS_API_KEY, PLAID_CLIENT_ID, PLAID_ENV, **PLAID_SECRET**, PLAID_SECRET_SANDBOX, RUNWAY_API_KEY, SUBMAGIC_API_KEY, **SUPABASE_SERVICE_KEY**, YOUTUBE_API_KEY, YOUTUBE_CLIENT_ID, **YOUTUBE_CLIENT_SECRET**, YOUTUBE_REDIRECT_URI.
- **Production only (7):** GITHUB_REPO, GITHUB_TOKEN, NEXTWAVE_V2_ROUTE_PRODUCTION, PRODUCTION_DEPLOY_HOOK_URL, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI.

**Controls today:**
- previews require Vercel sign-in (029);
- fork protection is on;
- the runner cannot push to the canonical repo (staging only).

**Residual risk:** any branch pushed to the canonical repo by any session builds with these secrets. A branch's `vercel.json` controls its build command.

**Recommendations** (each needs CEO approval; no cost):
1. Remove the live `PLAID_SECRET` from Preview; previews use `PLAID_SECRET_SANDBOX`.
2. Remove `YOUTUBE_CLIENT_SECRET` from Preview; previews cannot publish anyway.
3. Give Preview its own low-limit Anthropic/ElevenLabs/HeyGen/Runway/Submagic keys, or none.
4. Longer term: a non-production Supabase project for previews (this one has a cost).
