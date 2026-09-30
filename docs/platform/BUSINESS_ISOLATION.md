# MMMOS Platform Architecture: Business Isolation

**Status:** designed, implemented on branch `platform/business-isolation` and validated locally.
Not yet in production. Adopted 2026-09-29 after the 2026-09-28 shared-state data-loss incident.

## 1. The rule

MMMOS is one **platform** hosting many **businesses** (SRV Farsi, SRV English, NextWave, AI Creation Studio, SMM, Investment and future engines). A business may never overwrite, roll back or change another business. The platform provides the shared infrastructure that makes this hold automatically.

| Platform-shared (owned by the platform) | Business-owned (owned by exactly one engine) |
|---|---|
| Auth, CEO login security | Tasks |
| App shell, navigation, common UI | Packages (`packages` rows; the `engine` column) |
| Lifecycle framework (stages, cards) | Engine state (`engineState[engine]`, paused, test) |
| Deployment and release infrastructure | Test state and test records |
| State persistence (load/save, merge, guards) | Analytics and production history |
| Intentionally shared services (Plaid/finance, CDP, notifications) | Revenue and cost (`engineRevenue[engine]`, package cost) |
| | Creative and business configuration, rotation and sequence counters, lifecycle stages |

Every business-owned record must carry its engine identity: `engine` on array items, or the engine name or engine-prefixed key on maps and counters.

## 2. Release isolation

**Defect.** Production was replaced by CLI uploads (`vercel deploy --prod`) from whatever local checkout ran them. `origin/main` was stale (6a7a4e7, 2026-09-16), and production ran a NextWave feature branch (d286100). Any business branch deployed directly would roll back every other business's accepted work that it didn't contain.

**Design.** `main` is the only source of production.

```
business branch → preview (automatic on push) → validation → PR merged into main → production deploy from main
```

**Enforcement.**
1. **Release guard (fail-closed).** A production build aborts unless Vercel reports the source ref as `main`. That includes CLI uploads with no Git ref. Preview and local builds are unaffected.
   - In `vercel.json` `buildCommand`: every branch cut from main inherits it.
   - Also set as the Vercel **project** Build Command: covers existing branches whose `vercel.json` has no guard. A repo `buildCommand` overrides the project one, so both are needed.
2. **Git deployments on** (`git.deploymentEnabled: true`, production branch `main`): pushes to main deploy production, and other pushes deploy previews.
3. **Anti-rollback.** Because production can only be `main`, and `main` only moves forward by merges, a later business release always contains every earlier accepted change. Protect `main` on GitHub: no force-push, PR required.

**Rollback plan.** Vercel "Instant Rollback" / promote a previous production deployment (currently `dpl_BXxRvcbyS6MXrbnNC9dagd793hc9`, d286100). To lift the guard in an emergency, clear the project Build Command and revert the `vercel.json` line; both are single edits.

## 3. Business-state isolation

**Defect.** All businesses' mutable state is one JSON row (`app_settings.mmm_finance_v118`). Every tab saved its whole in-memory copy, last writer wins. A tab working on one business overwrote other businesses' newer state with its stale copy: tasks, engine and test state, lifecycle stages, counters. A tab that never loaded, or loaded defaults, could wipe everything (the 2026-09-28 incident).

**Design (smallest safe layer; no data migration).** The row stays where it is, and each save becomes a **3-way merge** on the server.
- The client sends `p_base` (the state as this tab last loaded or saved it) and `p_new` (what it wants to save) to `rpc/mmm_state_save`.
- The server locks the row and merges `current`, `base` and `new`:
  - Anything this tab didn't change keeps the server's current value.
  - Arrays of records merge per `(engine, id)`, so business-owned tasks are isolated even when numeric IDs collide across engines.
  - Objects merge per key: `engineState[engine]`, `*LifecycleStages[taskId]`, counters.
  - A client deleting something that someone else changed keeps the other change.
  - When two tabs of the *same* business change the *same field*, the last writer wins for that field only.
  - Top-level keys a client never sent are treated as unchanged, so older clients can't drop newer engines' keys.
- The merge contains **no engine names**. Future engines are isolated automatically.
- Guards (defence in depth):
  - Client: never save unless this tab successfully loaded the state (P0).
  - Server trigger: reject a shrink of tasks or bytes to under 25%, non-JSON writes and deletes (P0, live since 2026-09-28 14:31 UTC).
  - Server flag `mmm_platform_flags.state_merge_only`: once on, direct whole-row writes are rejected and only the merge RPC may write. The flag table has RLS with no client policies, so only server-side SQL can flip it.

**Compatibility.** The client falls back to the old write when the RPC doesn't exist yet. The server accepts old clients until `state_merge_only` is switched on. There's no data migration and no rewrite of business logic; only the platform persistence functions (`_persistFinancePayloadToSupabase`, the load path) change.

**Test isolation.** Engine test state is keyed per engine and merged per key, so one business entering or leaving test mode can't flip another engine's state or resurrect or delete another business's (test) tasks. Analytics and history are already per-row in `packages` / `youtube_videos` (business-scoped by `engine` / channel).

**Known limit.** Two tabs of the same business creating a task at the same moment can still produce the same new numeric ID (task-ID reuse). That's business-internal and is fixed by the planned immutable task identity (SRV P1). The merge keys by `(engine, id)`, so it can never cross businesses.

## 4. Standard for every future engine

1. Every business record carries `engine`. Maps and counters use the engine name or an engine-prefixed key (for example `fooEngineTaskSeq`, `fooEngineLifecycleStages`).
2. Persist only through the platform save path (`saveAppState` → `mmm_state_save`). Never write `app_settings` directly.
3. No engine code may read or write another engine's keys.
4. Ship on a business branch, validate on its preview, merge to `main`. Never deploy production from a branch.
5. Test mode is per engine (`engineState[engine] = 'test'`). Test records carry `isTest: true`.

## 5. Validation (local; production untouched)

| Suite | What | Result |
|---|---|---|
| `tests/platform/test_release_isolation.mjs` | A, B (feature branches can't deploy production), fail-closed CLI, previews allowed, C (synthetic repo: main carries both businesses; direct branch deploy would drop accepted work) | 13/13 |
| `tests/platform/test_state_isolation.mjs` | Real migrations on local Postgres 17 (PGlite): control reproduces the defect; D, E, F, G, H; enforcement, compatibility, key scope, first run, same-business conflict | 27/27 |
| `tests/platform/test_client_isolation_e2e.mjs` | The real client load/save code as two independent tabs against real Postgres: D, E, F, compatibility fallback, enforcement | 11/11 |
| `test_p0_state_guard.cjs` | P0 client guard | 8/8 |

## 6. Cutover plan (needs CEO go; production changes)

1. **Reconcile main with production:** fast-forward `main` to `d286100`, which is already live, so nothing changes in production.
2. Apply migration `platform_business_state_isolation.sql`. It's inert: flag off, and old clients are unaffected.
3. Merge `platform/business-isolation` into main. The production deploy from main is the first deploy under the new flow. Set the Vercel project Build Command to the same guard string.
4. After all open tabs have reloaded, set `state_merge_only = true`.
5. Business branches (for example `srv-farsi/va-artist-format-select`) follow the normal flow: preview → PR → main.

Separately tracked (security, not part of this change): `app_settings` grants anonymous full write; 33 tables have RLS off.
