# NEXTWAVE V2 — BENCHMARK PRODUCTION PLAN (Wealth Logic production class)

Owner: Claude Code (Engineering & Research). Report to: ChatGPT / PMO. CEO action: none.
Scope: reconcile what exists against the benchmark and define the path. No media generated; no lifecycle, Brain or other-engine changes.
Honest caveat: every render produced in the Brain validation used a dummy avatar/audio and no illustrated backgrounds. Those frames prove SEMANTICS and layout, not production polish.

## 1. Current visual system architecture
- Brain (frozen, guarded): script -> meaning units -> verified storyboard spec (treatment, renderer params, provenance). PASS renders; NEEDS_REVIEW/BLOCK stop.
- Two renderer families in `api/ops.js`, both FFmpeg (drawbox/drawtext/overlay, no external motion tool):
  - Short (9:16): full-frame HeyGen avatar hook/close + white-canvas card / illustration scenes (`nextwaveV2CompositeFullFrameRender`, `...WhiteMotionRender`, `nwv2White*`).
  - Long (1920x1080): `nwv2Long*` primitives - AvatarPanel, CalcCard, MoneyFlow, StockChart (single / multi-series / milestones / delay marker / y-scale), ShareCompare (chips + bars + delta + note), DayCards, Timeline, Comparison, Illustration; camera push; logo mark.
- Assets: Ideogram objects / poses / scene backgrounds with a reuse-first banked library (`production_assets_library`), chroma-key of objects, programmatic text only (AI pseudo-text fails QC).
- Narration: ElevenLabs master track with character-level alignment; `nwv2FindMeaningEventTime` times reveals to spoken phrases.
- Thumbnails: `nextwaveV2GenerateThumbnail` / `GenerateLongThumbnail` (programmatic headline + from/to values).

## 2. What already meets benchmark MECHANISM
Script -> meaning units -> timed visual events -> composition (approved permanent order); verified numbers on screen with provenance; data primitives that build progressively (bars grow, lines draw, markers/milestones attach to their points); safe-framing rules for character scenes; reuse-first asset bank; programmatic text (no gibberish); synchronized reveal timing; zero-cost re-render.

## 3. What is visibly BELOW benchmark (candid)
1. Data scenes are clean but flat: cards, bars and icons on cream - closer to "good infographic" than "illustrated storytelling". Frame occupancy of cards is ~50% of the frame; no environment.
2. No recurring character inside data scenes (avatar only at hook/close). Benchmark keeps a host/objects in the scene while numbers build.
3. Illustration is sparse: icons + one background per scene; no large purposeful custom objects that the numbers are attached to (ledger, jar, house, easel).
4. Motion is limited to progressive reveals + slow camera push; no reframing between focus regions, no object animation, no transitions with intent.
5. Captions: no polished word-synchronized caption system in Long; narration text appears in the avatar panel only.
6. Typography is a single bold face with fitted sizes; hierarchy is correct but not brand-designed.
7. Pacing: scene durations are fixed by the renderer (5-9 s) rather than derived from narration beats + a minimum reading time.
8. Thumbnails: functional headline + two values; no illustrated storytelling, no A/B system.

## 4. Exact improvements required
Renderer (reuse primitives; add, don't rebuild):
- Scene ENVIRONMENT layer: every factual scene gets a full-frame illustrated environment (bg asset) with the data panel INSIDE it (props carry the numbers: ledger for calc card, easel for chart, scale for comparison). Target frame occupancy >=75%.
- Object anchors: numbers attach to illustrated objects (value tag pinned to an object), driven by the same entity ids the validator already checks.
- Camera: reframing between focus regions (pan/scale between object A -> B) using the existing subject-safe framing rules; ease curves; hold time >= reading time.
- Progressive scene development: keep the "one environment, information changes inside it" rule; add 3-5 sub-states per scene from `reveal_steps` (already emitted by the Brain).
- Caption engine: word-synced captions from ElevenLabs alignment (2-line, safe area, emphasis on numbers), one style, Short + Long.
- Typography: two-face brand system (display + numerals), numerals tabular; color roles fixed (gold = headline value, navy = host/text, teal = comparison, red = loss).
- Pacing engine: scene duration = max(narration span, reading time of on-screen text, animation time); minimum dwell rules; pattern-interrupt cadence for Long.
- Motion library: small set of eased primitives (count-up, bar grow, line draw, object pop, wipe, push, pan) shared by all treatments; FFmpeg-safe expressions only (production build is older linux-x64: no `t` in scale/crop/pad options).
Illustration:
- Object/environment library keyed by the Brain's semantic tags (loan/house, retirement/nest egg, tax/ledger, inflation/basket, fees/leak, debt/anchor, time/hourglass, growth/tree...) so any finance topic maps to existing assets.
Brain -> renderer contract:
- Add an optional `environment_tag` and `object_anchors` to scene spec (Brain emits from existing tags/roles; no Brain redesign).

## 5. Asset-generation strategy
- Bank-first: ~60 reusable environment backgrounds + ~120 objects covering the finance topic taxonomy, generated once with Ideogram (no required text in any asset), chroma-keyed objects, QC'd, stored in `production_assets_library`; per-video generation only for genuinely new concepts.
- Style lock: one prompt style guide (palette, line weight, lighting) + seed/reference conditioning; every asset passes automated pseudo-text detection + human Creative QC.
- Consistency fallback: vector/programmatic props for anything that must be exact (arrows, tags, panels).

## 6. Character strategy
- Keep the HeyGen avatar (Raul) for hook/close presence (approved, full-frame, safe-framed).
- For in-scene presence choose ONE (PMO decision, no spend now): (a) one-time commissioned modular 2D NextWave host pack (poses: neutral, point L/R, think, warn, win, present-card) composited by the renderer - best consistency, one-time cost; (b) Ideogram pose generation with reference conditioning - cheapest, consistency risk over hundreds of videos.
- Original identity only: navy blazer, gold accent, glasses; visually distinct from Wealth Logic / John's Money Adventures.

## 7. Thumbnail strategy
- Template family (3-4 layouts): big verified number/contrast + one illustrated object + host pose + <=4 words. Generated from the Brain's headline entities (numbers already verified).
- Production: programmatic composite (existing generator) over banked illustrations; 2-3 variants per video for A/B; brand-safe contrast/legibility checks at 168 px.

## 8. Short-format standard (9:16)
Hook <=3 s with a specific number/consequence; 6-9 scenes, 4-7 s each, one idea per scene; environment + progressive numbers; captions always on; safe zones for platform UI; avatar only at hook/close; loopable close; 45-60 s.

## 9. Long-format standard (16:9)
Cold-open hook -> promise -> 5-9 chaptered sections; a visual event every 3-6 s; pattern interrupt (new environment/reframe) every 20-30 s; on-screen evidence for every number; recap card; 8-12 min target; chapters/metadata from the storyboard.

## 10. Quality-control rubric (score 0-2 each; pass = no 0 in the gate items and >=80%)
GATE items: numbers verified + provenanced; no pseudo-text; subject-safe framing; no clipping/collision; mute test communicates the point.
SCORED: frame occupancy (>=75% purposeful), object scale, hierarchy, scenario distinction, environment richness, progressive development, motion appropriateness, pacing/dwell, caption polish, typography, synchronization, brand consistency, "not slideshow / not generic AI".
Process: automated (validator + framing + text/pseudo-text + contrast + caption-safe checks) -> Product QC frame review of EVERY factual scene -> VA Production pass. NEEDS_REVIEW exceptions belong to VA/Product QC, never the CEO.

## 11. Tool / vendor requirements and expected incremental cost
No new recurring vendor required for the plan. Observed unit costs: Ideogram ~$0.03/asset (bank build ~180 assets ~ $5.40; x2 for retries ~ $11 one-time); ElevenLabs ~$0.50-1.00/video; semantic Brain ~$0.03-0.05/script; HeyGen only for hook/close as today. Optional one-time: commissioned character pack (quote needed; PMO/CEO procurement decision, not authorized here). Steady-state incremental per video: ~$1-2 with a warm asset bank.

## 12. Reusability across arbitrary finance topics
Everything is driven by semantic roles and tags the Brain already emits (roles, metrics, intents, basis), not by topic scripts: environment/object selection = tag lookup; numbers = verified entities; unsupported topics fail safe to NEEDS_REVIEW. New topic = add tags/assets, not code.

## 13. Implementation sequence (each step internal, gated by ChatGPT/PM + Creative Quality)
1. Freeze contract: `environment_tag`, `object_anchors`, `reveal_steps` timing schema (Brain additive fields only).
2. Style guide + asset taxonomy + automated pseudo-text/QC tooling (no generation yet).
3. Motion library + pacing engine + caption engine (local, dummy media, zero vendor cost).
4. Environment-hosted versions of the 6 factual treatments (card, bars, chart/milestones/delay, flow, timeline, comparison).
5. Small asset-bank build (~30 assets, ~$1-2) for ONE new benchmark script; Creative QC of every frame.
6. ONE integrated candidate (Short + Long cut) on a genuinely new script; internal gates (rubric, VA Production); only then a CEO review.
7. Scale the bank; thumbnail template family; document the exception-rate KPI loop.
