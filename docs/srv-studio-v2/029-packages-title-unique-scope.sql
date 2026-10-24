-- SRV-STUDIO-V2-029 — allow repeated song titles for SRV Studio (engine 'SRV English') only.
--
-- NOT APPLIED. Apply only with the CEO's production-release authorization for 029, BEFORE the 029 code is live
-- (the code works either way: with the old rule still in place, a repeated SRV Studio title is refused with a clear
-- message and nothing is lost).
--
-- Why: public.packages has UNIQUE (engine, title). A promotional Short must carry its Long's exact song title, and
-- different Long songs may share a title. Identity is the task id / package_id / YouTube video id — never the title.
-- No code upserts on (engine, title); every package write uses on_conflict=package_id.
--
-- Scope: every other business (SRV Farsi, NextWave, AI Studio, '' engine rows) keeps exactly the same uniqueness
-- rule as today — the replacement is a partial unique index on the same columns that excludes only 'SRV English'.
-- NULL-engine rows were never constrained (NULLs are distinct) and still are not.
--
-- Pre-check (read-only), 2026-10-24: constraint packages_engine_title_unique = UNIQUE (engine, title); per-engine
-- rows = distinct titles for every engine (247 SRV Farsi, 110 SRV English, 62 AI Studio, 56 '', 54 NextWave).

begin;
set local lock_timeout = '5s';
-- 1) new rule first, so non-SRV-Studio uniqueness is never absent
create unique index if not exists packages_engine_title_unique_non_srv_studio
  on public.packages (engine, title)
  where engine <> 'SRV English';
-- 2) then drop the old engine-wide rule (also drops its backing index)
alter table public.packages drop constraint if exists packages_engine_title_unique;
commit;

-- Verify:
--   select conname from pg_constraint where conrelid = 'public.packages'::regclass;     -- no packages_engine_title_unique
--   select indexdef from pg_indexes where indexname = 'packages_engine_title_unique_non_srv_studio';

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Only possible while SRV English has no repeated titles. Check first:
--   select title, count(*) from public.packages where engine = 'SRV English' group by title having count(*) > 1;
-- If that returns rows, those packages must be retitled (or the rollback skipped: the 029 code does not need the
-- old rule). Then:
--   begin;
--   alter table public.packages add constraint packages_engine_title_unique unique (engine, title);
--   drop index if exists public.packages_engine_title_unique_non_srv_studio;
--   commit;
