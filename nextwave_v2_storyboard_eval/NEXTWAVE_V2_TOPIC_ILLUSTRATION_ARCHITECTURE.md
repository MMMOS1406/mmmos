# NextWave V2 — Topic-Specific Illustration Production Layer (design + bounded proof)

Status: **design + one bounded visual proof only**. Nothing here is wired into the production route (`lib/nextwaveV2Renderer/production/*`, `api/ops.js`). No lifecycle change. No new vendor. No production/publish action.

## 1. Architecture inspection (what exists today, renderer 2.1)
`stock_chart`/comparison beats render through a fixed template family (`physical.mjs`: race / paired wagons / orchard) selected from Brain semantics, drawn from a small reusable prop+environment library (`sets.mjs`, `props*.mjs`, 24 Ideogram assets). This is deterministic, cheap ($0 marginal once an asset exists) and safe, but composition is always "pick a template, place library pieces in it" — it cannot invent a scene that specifically visualizes a topic's meaning, so it plateaus at "template + object + label."

## 2. Proposed hybrid architecture
```
guarded Brain (unchanged)
   -> Scene Spec (new, derived, non-authoritative)
        -> ASSET DECISION: reuse (library match) | generate (Ideogram, topic-specific) | programmatic-only
        -> COMPOSE: background art (reused or generated) + programmatic evidence/camera/captions (existing renderer)
        -> QC gate (Claude vision, existing Anthropic vendor) -> accept / regenerate / fall back to template family
   -> existing chunked render / ElevenLabs / lifecycle (unchanged)
```
The Brain and its PASS/NEEDS_REVIEW/BLOCK output are untouched inputs. Nothing about verified numbers ever comes from the image.

## 3. Scene Spec (derived, not a Brain change)
One record per major beat, computed downstream from the Brain's existing `scenes[]`/`values[]`/`entity_ids` (all fields already exist in the storyboard; nothing new is asked of the Brain):
```
{ id, format, narration_span, topic, relationship,          // relationship: delay | loan | fee_drag | purchasing_power | savings_split | ...
  takeaway,                                                   // one sentence, derived from the Brain's own narration text
  evidence: [{ entity_id, display, value, kind }],            // straight from storyboard.values — authoritative
  visual_objective,                                           // one sentence: "show two lives of the same choice diverging"
  required_subjects, environment_hint, metaphor_action,       // derived from topic/relationship (same rules as vocab.mjs)
  composition: 'wide-establishing'|'vertical-single-idea'|...,
  camera_intent: ['establish','push','reveal-gap','widen'],
  reveal_steps,                                                // word-anchored, from timing.mjs (unchanged)
  overlays: [...],                                             // programmatic: tags, brackets, captions — never in the image
  asset_plan: { reuse_key | generate_prompt, style_ref } }
```
This is a plain object built by a new derivation function; it requires no Brain fields that do not already exist.

## 4. Reusable vs generated — decision rule
1. Host, captions, brand mark, UI evidence (tags/brackets/tickers), verified numbers/percentages/labels: **always programmatic**, never in a generated image, no exception.
2. Minor bridge/transition beats (<3.6s, per the existing merge rule): **always reuse** an existing vector metaphor (hourglass/jar/tree) — never worth generating.
3. Major beats (the ones currently hitting `physical.mjs`/comparison templates): look up the asset library by `(topic, relationship, format)`.
   - Match with quality_rating >= threshold and usage_count above a minimum sample → **reuse**.
   - No match, or the topic is novel/rare → **generate** one topic-specific illustration, run it through the QC gate (§10), then register it.
4. If Ideogram generation or QC fails twice → **fall back to the existing template family** (renderer 2.1). The system never blocks a video on an illustration.

## 5. Visual generation approach (Ideogram capability inspection, §6 of the order)
Confirmed via the v3 API reference (already-approved vendor, no new integration):
- `aspect_ratio`: both 16:9 and 9:16 supported directly (already used).
- `character_reference_images`: single reference, host-consistency (already used for the 5 poses); **not needed for topic scenes**, since the host stays a separate reusable overlay per §7 of the order — keeps generation at $0.03/image, not $0.10.
- `style_reference_images` **(new to this session, tested in the proof)**: pass a prior generated image as a style reference for a new generation → confirmed it holds palette, lighting and motif across a 16:9→9:16 pair (see proof). This is the mechanism for "Short is never a crop of the Long": generate both independently, same style reference, different composition.
- `style_codes`/`seed`: available for tighter reuse (e.g., regenerating a near-duplicate variant) — not exercised in the proof, noted as available.
- No video/motion capability. Motion must come from the existing renderer (confirmed sufficient, see §8).
**Gap found:** Ideogram has no reliable multi-region layout control — asking for "two distinct paths converging on one city" produced a plausible but literal mirror/split-screen composition rather than one unified scene (see `wide.png`/`tall.png`). Usable for this proof; a production system would need either prompt iteration, a second QC-triggered regeneration, or compositing two separately generated halves programmatically. This is a prompt-engineering/QC-loop problem, not a missing capability — no new vendor is implicated.

## 6. Short vs Long production model
- **Long (16:9):** per major beat (typically 3–5), either a reused template scene or one generated establishing illustration; Ken Burns camera (establish → push to first subject → reveal → push to second subject → reveal → widen on gap) exactly as demonstrated in the proof; host used only at hook/transition/conclusion (§7).
- **Short (9:16):** one dominant illustration for the single central idea, generated natively vertical (not cropped — proof used an independent vertical prompt with a style reference to the Long's image), faster reveal cadence, at most two evidence beats before the gap.
- Both share the same evidence/camera/overlay engine already in the renderer; only the background source (template composite vs. generated art) and the composition brief differ.

## 7. Thumbnail model
Unchanged direction from renderer 2.1 (`thumbnails.mjs`): derive from the strongest verified comparison/number, evidence-first, no avatar-first composition, no AI-rendered text. A generated topic scene, when one exists for that video, becomes the thumbnail's backdrop; the number/label overlay stays fully programmatic exactly as today.

## 8. Motion model (§8 of the order)
The proof demonstrates the intended default: one static illustration + Ken Burns camera (pan/zoom, clamped so the frame never leaves the art) + programmatic reveals, using the existing `renderVideo`/`stillFrame` pipeline and `core.mjs` primitives — zero new tooling, zero video-generation vendor. This reads as real progression in the proof stills and the short clip. Recommendation: this is sufficient; do not evaluate Runway or any video model.

## 9. Asset memory / reuse layer (design; not implemented in the proof)
Same storage pattern already used for route build state (`app_settings` key/value, see `api/ops.js` `nwv2rPutState`): a new namespaced key per asset, e.g. `nwv2_asset_<hash>`, value = `{ topic, relationship, format, prompt, style_ref_of, image_url, quality: {auto, human}, created_at, uses: [] }`. Lookup by `(topic, relationship, format)` is a simple filter over the small (initially) row set — no new database, no new vendor. A first use of a newly generated asset requires one human "looks right, reusable" confirmation (a single click, same pattern as the existing VA acceptance steps elsewhere in the lifecycle) before its `quality.human` flag allows automatic reuse; after that, reuse is silent. This is designed, not built — building it is lifecycle integration, out of scope for this order.

## 10. QC / regeneration model (revised per PM correction — 2026-09-27)
Illustrated human subjects are a valid, sometimes-required part of a Scene Spec (e.g., "two people at different life stages," "a family reviewing a mortgage"). QC never rejects a scene merely for containing people; it rejects a scene for not matching what the Scene Spec asked for.
- **Technical checks (automatic, $0):** correct aspect ratio/dimensions for the target format, not a degenerate/blank image, no leftover magenta key artifact.
- **Semantic/identity checks (automatic, low cost — Claude vision, already-approved Anthropic vendor, already used for the Brain's proposer):** show the generated image the Scene Spec's `visual_objective` and `required_subjects`, and confirm:
  - the scene matches the visual objective and the narration it will accompany;
  - the required subjects/relationships specified by the Scene Spec are actually present (including illustrated people, when the spec called for them);
  - the composition supports the narration rather than fighting it (e.g., the two things being compared are both legible, not one hidden);
  - no AI-generated authoritative financial text, numbers, currency symbols, or chart-like UI appears anywhere in the image (all such content stays programmatic, drawn by the renderer, never trusted from the image);
  - no misleading financial relationship is implied by the composition itself (e.g., the visually "bigger" side must not contradict which side is actually larger in the verified evidence);
  - no obvious generation artifacts (mirrored/duplicated geometry, warped anatomy, broken linework, inconsistent style);
  - correct format/composition for the target (native vertical for Short, not a cropped Long, and vice versa);
  - visual compatibility with NextWave identity (palette/line-style family, not a generic stock-AI look, does not imitate a named benchmark's artwork/characters/branding);
  - the frame leaves safe, uncluttered placement for the programmatic evidence/caption overlays that will be drawn on top;
  - when the Scene Spec calls for the reusable NextWave host, the generated scene respects that (leaves the host as a separate overlay, per §7) rather than inventing a conflicting second character.
  - Reject on any of the above → regenerate (bounded retries) → fall back to the existing template family (§4). This uses no new vendor.
- **Never silent acceptance:** a rejected image never reaches a viewer; the video renders with the safe template fallback instead, and the rejection is logged for a human to review later (not blocking that video).

## 11. Business economics (real cadence evidence, read 2026-09-27)
Ideogram $0.03/image (no character reference), Claude vision QC call ≈ $0.01–0.02/image, retry factor assumed 1.3× (based on this session's ~1-in-4 to 1-in-3 asset issues needing a redo, e.g. keying/artifact reruns seen earlier in this project). This retry factor is still an estimate — untested at production scale.

| | cold start (no reuse yet) | mature library (steady state) |
|---|---|---|
| Short (≈1 new asset) | ≈$0.03–0.04 gen + $0.015–0.02 QC × 1.3 ≈ **$0.06–0.08** | most topics reused → **≈$0–0.02** |
| Long (≈2–3 new assets, rest templated) | 2.5 × same ≈ **$0.15–0.20** | **≈$0.02–0.06** |

**CONFIGURED cadence** (`public/index.html`, `ENGINES_CONFIG`, NextWave entry, `weeklyCapacity:3, cadenceDays:["Monday","Tuesday","Wednesday","Thursday"]`, with the shipped comment "Fri=Long/Sat=Short/Sun=Short" — i.e. production Mon–Thu, publish 3 slots Fri–Sun): **1 Long + 2 Shorts per week**, ≈ 4.35 weeks/month → **≈4.3 Longs + ≈8.7 Shorts per month**. This is the app's own configuration, read directly, not assumed.

**ACTUAL recent cadence** (queried directly from the live `packages` table for `engine ilike '%nextwave%'`, 2026-09-27):
- 36 NextWave rows total, spanning 2026-05-24 to 2026-09-23 (122 days ≈ 4.0 months): 7 Long-like (`Long`/`Long Script`), 15 Short-like (`Short`/`Short Script`), 14 untyped/legacy.
- That is ≈ **1.7 Longs/month and ≈ 3.7 Shorts/month actually generated** — well below the configured 4.3/8.7 split.
- **Every one of these 36 rows has `performance_status = 'generated'` and `published_at IS NULL`.** NextWave has never actually published a finished video in this database. So there is no "actual finished-video cadence" to compare against — only a package/script-generation rate. This absence of a real production track record is itself a fact worth flagging, not something to paper over with the configured number.
- **Authoritative source:** the CONFIGURED weeklyCapacity is the intended target and the only number with a defined publish rhythm; the ACTUAL rate is what has really happened at the generate stage so far, at roughly 40–43% of the configured rate, with zero completions. Both are reported because they disagree; neither alone would be honest.

**Recalculated monthly illustration cost, both bases:**

| basis | cold-start month | mature-library month |
|---|---|---|
| CONFIGURED (4.3 Long + 8.7 Short) | 4.3×$0.18 + 8.7×$0.07 ≈ **$1.38** | 4.3×$0.04 + 8.7×$0.01 ≈ **$0.26** |
| CONFIGURED × 2 | ≈ **$2.76** | ≈ **$0.52** |
| ACTUAL (1.7 Long + 3.7 Short) | 1.7×$0.18 + 3.7×$0.07 ≈ **$0.57** | 1.7×$0.04 + 3.7×$0.01 ≈ **$0.11** |
| ACTUAL × 2 | ≈ **$1.14** | ≈ **$0.22** |

Every basis is well under one dollar a month at steady state, and under three dollars a month even cold-start at 2× the configured rate. This is not a material spending decision on its own; the material decision is elsewhere (see closing note).
- **ElevenLabs, chunked rendering, Anthropic Brain calls:** unchanged — this layer only touches the background-art source, not narration length or chunk count.
- **Existing subscriptions cover this:** yes — Ideogram and Anthropic are both already-provisioned, pay-per-call; no new recurring line item.
- **VA/manual workload:** one one-time "confirm reusable" click per *new* asset, not per video; shrinks toward ~0 clicks/video as the library matures. No manual art direction per video is required by this design (see §16 stop condition).
- **Production time per video:** +1 Ideogram call (~10–20s) plus one Claude vision QC call (~2–5s) per newly-needed asset; negligible against the existing multi-minute chunked build times measured in this project (Long ≈ 5–7.5 min, Short ≈ 2–3 min).
- **Scalability bottleneck:** Ideogram rate limits under a bursty content calendar (untested), and a spike in simultaneously-novel topics needing human confirmation before reuse kicks in. Mitigation: pre-generate/pre-approve for known upcoming topics; not tested here.

## 12. Files / code changed for this order
- **New (design + proof, isolated):** this file (revised 2026-09-27: QC language corrected per PM, cadence section replaced with real data); `/tmp/bench/proof/gen.mjs`, `/tmp/bench/proof/compose.mjs` (scratch, not committed — proof harness only, per "do not integrate into the lifecycle yet").
- **No changes** to `production/*`, `api/ops.js`, `public/index.html`, the Brain, or any committed renderer template. The cadence data was obtained read-only (`ENGINES_CONFIG` in `public/index.html`, and a read-only SQL query against the live `packages` table) — nothing was written to production.

## 14. Business-relevant fact surfaced (not a spending decision, reported for completeness)
NextWave has zero published packages in the production database as of this reading — every one of its 36 generated packages since 2026-05-24 stopped at `performance_status='generated'`. Whatever cadence NextWave eventually runs at, there is currently no track record of a finished, published NextWave video to validate any economics or quality assumption against in the real world. This is a fact for Business/Monetization to have, not something this order asked to be fixed.

## 13. Tests performed
No unit tests apply to a design document; the existing 51/50/14 route/production/e2e suites are untouched and were not re-run for this order (no production code changed). The proof itself was inspected visually (frame sheets + a rendered clip), not unit-tested.
