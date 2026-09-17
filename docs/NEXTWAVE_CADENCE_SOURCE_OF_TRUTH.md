# NextWave Cadence — Source of Truth (Phase 1 item D)

No functional code changed for this item. This document records what was actually
found reading the live code, so the two competing "cadence" numbers in the system are
not mistaken for each other.

## What actually controls NextWave's publish cadence today

NextWave's real production/publish schedule is driven entirely by hardcoded client-side
constants and self-contained date math in `public/index.html` — nothing in this path
reads from the database:

- **How many packages/week**: `ENGINES_CONFIG` entry for NextWave
  (`public/index.html`, id `nextwave`) hardcodes `weeklyCapacity:3`. Every place that
  enforces a weekly cap (`_engineWeeklyTasksThisWeek`, the various `cap=...weeklyCapacity`
  checks used by task auto-assignment, e.g. around lines 4680, 4930, 5018, 10385, 14086,
  14141, 14306, 14499, 14547, 14575, 14602, 14699, 14824) reads this same static `3` —
  never a database value.
- **Which days**: `_nextWaveNextPublishDate(isLong)` and `_weeklyPublishDates()`
  (`public/index.html`, ~lines 11095–11142) contain hardcoded day-of-week numbers:
  Long → Friday (`targetDay=5`), Short → Saturday/Sunday (`targetDay` 6 or 0, alternating
  via `D.nextWaveTaskSeq`). This matches the `ENGINES_CONFIG.longFormDay:"Wednesday"`
  comment convention (production happens Mon–Thu, publish happens Fri/Sat/Sun) but is
  implemented as plain arithmetic on `new Date()`, not read from any config or table.

**Conclusion: `ENGINES_CONFIG.weeklyCapacity` + `_nextWaveNextPublishDate`/
`_weeklyPublishDates` are the authoritative cadence mechanism for NextWave today.**

## The `channel_strategy` table — read, but not authoritative

The prior read-only audit's note that `channel_strategy` "does not appear to be read by
this code path at all" is **not quite accurate** — it is read, but only as informational
context inside the content-generation prompt, and it does **not** feed the scheduling
functions above. Specifically:

- `public/index.html`'s `getPackageMemory(engine)` (~line 19092) calls
  `_psFetchChannelStrategy(engine)` (~line 19012), which does
  `GET channel_strategy?engine=eq.NextWave`, and folds `cadence_per_week` (along with
  `status`, `mode_weights`, `promoted_categories`, `reduced_categories`) into a
  `strategyEntry` that becomes part of the `recentPackages` memory array sent to
  `/api/generate` on every package generation.
- `api/ops.js`'s `generatePackage()` (~line 2195–2203) reads that same entry back out and
  writes a line straight into the Claude prompt: `TARGET CADENCE: <cadence_per_week>
  videos/week`. This is advisory text shown to the model — it does not change how many
  tasks get created, which days they're scheduled for, or anything else that actually
  executes.
- The only writer of `channel_strategy` is `strategyRecompute()` (`api/ops.js`
  ~line 7475), invoked exclusively by `ytStrategyRecompute()` — a **manual** button
  ("🧬 Recompute Strategy", `public/index.html` ~line 3010) an operator clicks. It is not
  called by `analyticsAutoRun()` (the function the daily `/api/youtube/autosync` cron
  chains into) or by any other automatic trigger found in this codebase.

## Why this matters

Today the NextWave row in `channel_strategy` (`cadence_per_week=3`, per the CEO's brief)
happens to match `ENGINES_CONFIG.weeklyCapacity=3`, so there's no visible contradiction.
But the two are **not wired together**: if a future manual "Recompute Strategy" click (or
any other writer) ever sets NextWave's `channel_strategy.cadence_per_week` to something
else — e.g. `strategyRecompute()`'s own `scale`/`reduce`/`pause` logic proposes 5, 1.5, or
0 videos/week for a channel — nothing in the actual scheduling path would change. NextWave
would keep generating exactly 3/week on Fri/Sat/Sun, while the generation prompt would
simultaneously tell Claude "TARGET CADENCE: 5 videos/week" (or whatever the stale row
says) with no operator-visible warning of the mismatch and no enforcement either way.

**Bottom line:** `channel_strategy` for NextWave is not fully vestigial (it is read and
does influence prompt text), but it is **not the source of truth for actual cadence** and
has no functional connection to `ENGINES_CONFIG.weeklyCapacity` or the publish-date
functions. Treating `ENGINES_CONFIG` + `_nextWaveNextPublishDate`/`_weeklyPublishDates` as
authoritative, and `channel_strategy.cadence_per_week` as an informational/advisory value
only, reflects the code as it actually runs today. Reconciling the two (e.g. having
`weeklyCapacity` itself read from `channel_strategy`) is a Phase 2+ decision, not made
here — this document only records the current, real wiring.
