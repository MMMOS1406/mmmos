# NextWave V2 production route — integration of the accepted Creative Production Standard

Standard frozen from benchmark commit `fa34eb0` (Phase 1C accepted by PM). This is an INTEGRATION into the existing lifecycle, not a rebuild.
Status: engineering-complete, **feature-flagged OFF**, not deployed, nothing published.

## Route
approved script → guarded semantic Storyboard Brain (frozen) → **PASS / NEEDS_REVIEW / BLOCK** → asset plan (reuse-first) →
ElevenLabs narration + character alignment → V2 renderer (chunked) → thumbnail → automated factual/visual QC → existing Review/Approve.

| Brain result | Route behaviour |
|---|---|
| `clean` → PASS | narration → render → QC → `ready_for_review` |
| `needs_review` | STOP before any narration/asset/render spend; exception to VA Production / Product QC |
| `blocked` (or Brain error, unknown status, unsupported treatment) | STOP; engineering triage. Fails closed. |

## Code
* `lib/nextwaveV2Renderer/` — renderer library (was `lib/nextwaveBench`): `core, props*, sets, scenes, motion, captions, render, assets, qc`.
* `lib/nextwaveV2Renderer/production/` — `timing` (scene/reveal placement from the spoken word stream), `templates` (one accepted-standard template per Brain
  treatment: avatar_panel, money_flow, day_cards, stock_chart, share_compare[bar|chips], calc_card), `compose` (storyboard → frame function; refuses non-clean),
  `qc` (numbers actually painted vs verified storyboard, occupancy, idle windows, caption safe zone), `thumbnails` (concept-first, from verified values),
  `route` (gate, asset plan, start/chunk/finish, state persistence).
* `api/ops.js` — additive actions `nextwave_v2_route_{config,set_enabled,status,start,chunk,finish}`; lazy `import()` of the library.
* `public/index.html` — additive client block + ONE changed line (Build-stage branch condition).
* Reference only: `reference/candidates/*` (the hand-built benchmark videos), `tools/*` (dry-run, credential page, bench Ideogram ledger).

## Flag / release
`app_settings.nextwave_v2_route_enabled` = `{"enabled":true}` (CEO-gated `nextwave_v2_route_set_enabled`; nothing calls it). Default OFF: with it off no existing path changes.
Release dependencies (NOT changed here): `@napi-rs/canvas` runtime dependency (added Phase 1, lockfile updated); `vercel.json` is write-protected in this environment, so
assets are referenced with literal `join(process.cwd(),'api','assets',...)` paths (same pattern as `SMM_FONT_PATH`) rather than via `includeFiles`; the deployed
ffmpeg build is old (Defect #21) — the route uses only long-standing flags (rawvideo pipe, libx264, concat demuxer, aac, `-af apad -t`).

## Retired / not revived
Phase 5.3 custom illustrated renderer and the HeyGen hybrid (avatar clips + Submagic captions) remain in the file untouched and reachable only through the flag-OFF
Build UI; the V2 route never calls them and has no HeyGen fallback. The bench Ideogram ledger, first-generation thumbnails and superseded candidates were removed.

## Known scope limits (by design, inherited from the guarded Brain)
The two benchmark scripts are outside the Brain's supported structures: the Short (purchasing-power at two horizons) is BLOCKED (`visual_semantic_mismatch`), the
Long (contribution split / catch-up payment) is NEEDS_REVIEW. Those hand-built videos remain the quality reference; the route renders what the Brain can verify.

## Technical debt (renderer 1.8)
* Multi-topic closing caption: the frozen Brain's closing `contextCaption` calls back to the FIRST comparison's gap. The renderer replaces it with a per-comparison recap (`production/narrative.mjs` drawRecap) and suppresses the Brain caption when >1 comparison exists (`templates.mjs`). A bounded Brain fix would remove the workaround; not done (Brain frozen).
* Brain output is not deterministic across runs for the same script (a fee comparison came back once as a chart, once as bars); the renderer handles either.
* QC low-information check reads pixel edge density; it does not detect a scene that is busy but uninformative.

## Asset vocabulary (renderer 2.0) and known defects
* 16 Ideogram assets added ($0.48): carriers (sacks, chest, piggy, home), props (house, toll booth, piggy bank), terrains (coast, neighbourhood, finance plaza — wide + tall — and a dusk road). Selection rules: `production/vocab.mjs`.
* Observed Brain nondeterminism: one script returned NEEDS_REVIEW (`stated_value_not_reproduced`) then PASS on a re-run; a weekly-cadence script returned BLOCK. The route never retries automatically.
* FIXED (2.1): topic precedence — savings/deposit evidence no longer becomes "loan" because of the word "rate"; bare rate/interest is ambiguous and inherits the neighbouring topic (tests in test_nextwave_v2_production_route.mjs).
* Not exercised on the real route: sacks/chest carriers, dusk road, toll booth, coast, orchard-in-Short, paired wagons with the vocabulary (verified locally on stills only).
