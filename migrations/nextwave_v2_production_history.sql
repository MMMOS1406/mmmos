-- NextWave V2 — production history / anti-repetition memory
-- Prepared as part of the NextWave V2 final-production-standard integration PR.
-- NOT YET APPLIED to any environment — review before running.
--
-- Mirrors the field set the local prototype actually needed to make a real
-- anti-repetition comparison (proven out in production_history.json against
-- two genuinely distinct local candidates — see
-- nextwave-v2-visualdna/NEXTWAVE_V2_PRODUCTION_STANDARD.txt section 4 for the
-- schema rationale and the comparison method: exact-match on topic, word-
-- overlap on hook text, set-overlap on visual-mechanic sequence, exact-match
-- overlap on calculation formulas).
--
-- This becomes the permanent NextWave-side source of truth the local
-- production_history.json was always meant to be superseded by — it is not a
-- second/competing memory system.

create table if not exists nextwave_production_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  topic text not null,
  angle text not null,
  viewer_problem text,

  hook_text text not null,
  hook_architecture text,
  narrative_architecture text,

  examples_used jsonb not null default '[]'::jsonb,
  calculations_used jsonb not null default '[]'::jsonb,

  title text not null,
  title_structure text,
  thumbnail_concept text,
  thumbnail_composition text,

  visual_mechanics_sequence jsonb not null default '[]'::jsonb,
  character_object_combinations jsonb not null default '[]'::jsonb,
  opening_composition text,
  ending_composition text,

  cta_wording text,
  cta_structure text,
  conclusion_structure text
);

create index if not exists idx_nextwave_production_history_topic
  on nextwave_production_history (topic);
create index if not exists idx_nextwave_production_history_created_at
  on nextwave_production_history (created_at desc);
