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

## 10. QC / regeneration model
- **Technical checks (automatic, $0):** aspect ratio, dimensions, not a degenerate/blank image, no leftover magenta key.
- **Semantic/identity checks (automatic, low cost):** ask Claude (already-approved Anthropic vendor, already used for the Brain's proposer) to look at the generated image and confirm: no rendered text/numbers, no people/faces, matches the one-sentence visual objective, doesn't resemble stock/generic AI imagery, doesn't imitate a named benchmark's exact artwork. Reject → regenerate (bounded retries) → fall back to template family (§4). This uses no new vendor.
- **Never silent acceptance:** a rejected image never reaches a viewer; the video renders with the safe template fallback instead, and the rejection is logged for a human to review later (not blocking that video).

## 11. Business economics (estimates — flagged as unmeasured assumptions; no real cadence/reuse data exists yet)
Ideogram $0.03/image (no character reference), Claude vision QC call ≈ $0.01–0.02/image, retry factor assumed 1.3× (based on this session's ~1-in-4 to 1-in-3 asset issues needing a redo, e.g. keying/artifact reruns seen earlier in this project).

| | cold start (no reuse yet) | mature library (steady state) |
|---|---|---|
| Short (≈1 new asset) | ≈$0.03–0.04 gen + $0.015–0.02 QC × 1.3 ≈ **$0.06–0.08** | most topics reused → **≈$0–0.02** |
| Long (≈2–3 new assets, rest templated) | 2.5 × same ≈ **$0.15–0.20** | **≈$0.02–0.06** |

- **ElevenLabs, chunked rendering, Anthropic Brain calls:** unchanged — this layer only touches the background-art source, not narration length or chunk count.
- **Monthly, current cadence:** cadence not known to this session (no production history to read); using a placeholder of ~8 Shorts + 4 Longs/month for illustration only: cold-start month ≈ 8×$0.07 + 4×$0.18 ≈ **$1.28**; at steady state, well under $0.50/month. **This placeholder cadence must be replaced with real numbers before any budget decision.**
- **2× cadence:** roughly double the above; still trivial against existing Ideogram/Anthropic/ElevenLabs spend already approved.
- **Existing subscriptions cover this:** yes — Ideogram and Anthropic are both already-provisioned, pay-per-call; no new recurring line item.
- **VA/manual workload:** one one-time "confirm reusable" click per *new* asset, not per video; shrinks toward ~0 clicks/video as the library matures. No manual art direction per video is required by this design (see §16 stop condition).
- **Production time per video:** +1 Ideogram call (~10–20s) plus one Claude vision QC call (~2–5s) per newly-needed asset; negligible against the existing multi-minute chunked build times measured in this project (Long ≈ 5–7.5 min, Short ≈ 2–3 min).
- **Scalability bottleneck:** Ideogram rate limits under a bursty content calendar (untested), and a spike in simultaneously-novel topics needing human confirmation before reuse kicks in. Mitigation: pre-generate/pre-approve for known upcoming topics; not tested here.

## 12. Files / code changed for this order
- **New (design + proof, isolated):** this file; `/tmp/bench/proof/gen.mjs`, `/tmp/bench/proof/compose.mjs` (scratch, not committed — proof harness only, per "do not integrate into the lifecycle yet").
- **No changes** to `production/*`, `api/ops.js`, `public/index.html`, the Brain, or any committed renderer template.

## 13. Tests performed
No unit tests apply to a design document; the existing 51/50/14 route/production/e2e suites are untouched and were not re-run for this order (no production code changed). The proof itself was inspected visually (frame sheets + a rendered clip), not unit-tested.
