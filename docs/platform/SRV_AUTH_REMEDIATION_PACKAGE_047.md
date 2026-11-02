# SRV authentication remediation package (047) — specification only

**PREPARED ONLY.** No SRV code, SRV test, SRV setting or SRV data was changed. This is the brief for an SRV-workstream order. It needs its own PR, its own tests and its own CEO release decision.

## Scope: 6 SRV actions (3 deferred from PR #76 + 3 SRV-owned priority-2 actions)

| Action | Server handler (`api/ops.js` on main 71546c3) | App caller (`public/index.html`) | Why it matters |
|---|---|---|---|
| `srv_build_package` | `srvBuildPackage` (line 7380) | `srvBuildPackage()` (line 24627, call at 24649) | builds an SRV package (generation) |
| `srv_english_regen_caption` | `srvEnglishRegenCaption` (line 4957) | `_srvEnglishV2RegenCaption()` (call at 16582) | paid model call |
| `farsi_regen_caption` | `farsiRegenCaption` (line 4867) | `_farsisaveEdit()` (call at 19900) | paid model call on every Farsi save |
| `srv_english_build` | router only, no app caller | — | render pipeline |
| `srv_english_render_status` | router | 1 app call site | render polling |
| `youtube_sync_performance` | router | 1 app call site | writes performance data |

All 6 are still unprotected on main (verified 047: none is in `PUBLISH_GATED_ACTIONS`, all are dispatched by the router).

## Fix (same as PR #76; no new role policy)

1. Add the 6 actions to a session gate in the router that reuses `_publishGate` (CEO or VA session; enforce mode while the VA PIN is set). The simplest path is to add them to `SESSION_GATED_ACTIONS` once PR #76 is released.
2. Change the 4 app call sites to `_publishFetch(` (same arguments, plus the session). `srv_english_build` has no app caller, so it stays server-only and refuses unsigned callers.
3. Leave the SRV Studio V2 actions that are already gated unchanged.

## Why it was deferred: SRV-owned tests that must change in the same PR

| Test | What breaks | Required change (SRV workstream) |
|---|---|---|
| `tests/srv/test_srv_studio_v2_lifecycle.cjs` | It runs slices of `public/index.html` in a sandbox (`vm`). After the change, `_srvEnglishV2RegenCaption` calls `_publishFetch`, which is not in the sandbox, so it throws a ReferenceError. | Add `_publishAuthedFetch`, `_publishFetch`, `_ceoGetSessionToken` and `_operatorGetSessionToken` to the extracted code (or a stub that forwards to the sandbox `fetch`). Keep the existing check that the caption request body carries title and lyrics; add a check that it also carries the session. |
| `tests/srv/test_srv_studio_v2_isolation.mjs` (F-3) | It requires the `farsi_regen_caption` dispatcher line to sit at the same line number as main (`lineOf`). Any router addition above it moves the line. | Compare the dispatcher line's text, not its line number, and keep the byte-identity check on `farsiRegenCaption`. |
| `tests/srv/studio-v2-preview/server.mjs` and `fixture.mjs` | The local preview stand-in answers `srv_english_regen_caption` without a session. | Accept and ignore the session field. Optionally refuse requests without it, matching production. |
| `test_srv_farsi_short_publish.cjs` ("other businesses byte-identical") | It flags any change to non-SRV app functions. | No change. An SRV-only PR does not trip it. |

## Tests the SRV PR must add

- anonymous and forged callers refused (401 `session_required`) for all 6, with no table change;
- CEO session passes; VA session (real `operator_login`) passes;
- no plain `fetch('/api/ops?action=<srv action>'` left in the app;
- `farsiRegenCaption`, `srvEnglishRegenCaption` and `srvBuildPackage` handler bodies are byte-identical to main (gate only);
- full SRV suites (`tests/srv/*`), the preservation harness and the isolation suites, compared with main.

## Release and rollback

- Release: one PR, merged to main by the CEO's approval, then production checks (verifier, plus an anonymous probe of each of the 6 refused).
- Rollback: revert the merge commit (a new deployment) or promote the previous production deployment.

## Owner

SRV workstream (by PM order). MMMOS engineering (Claude Code) can build it in an isolated branch if the PM assigns it, touching only the 6 router entries, the 4 SRV call sites and the SRV tests above.
