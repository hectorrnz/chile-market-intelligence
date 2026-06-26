-- Phase 5C: macro_observations unique constraint + missing rate indicators
-- Run this in Supabase Dashboard → SQL Editor BEFORE running npm run ingest:bcch-macro.

-- ─── 1. Add missing rate indicators ─────────────────────────────────────────
-- BTU 5Y, Cámara Swap 2Y/1Y are verified BCCh series but were not in the
-- initial seed (they live in chileanRates.json, not macroIndicators.json).
-- The BCCh ingestion writes macro_observations rows with these indicator_ids.
insert into macro_indicators (id, region, name, short_name, category, unit, source_provider, live_enabled, metadata)
values
  ('btu5',   'CL', 'Tasa de Referencia BTU 5 años',   'BTU 5Y',         'Rates', '%', 'bcch', false, '{"static_mvp": true}'),
  ('swap2y',  'CL', 'Cámara Swap 2 años',              'Cámara Swap 2Y', 'Rates', '%', 'bcch', false, '{"static_mvp": true}'),
  ('swap1y',  'CL', 'Cámara Swap 1 año',               'Cámara Swap 1Y', 'Rates', '%', 'bcch', false, '{"static_mvp": true}')
on conflict (id) do nothing;

-- ─── 2. Replace partial unique index with concrete unique constraint ──────────
-- PostgREST upserts with onConflict require a concrete UNIQUE constraint,
-- not a partial index. PostgreSQL treats NULLs as distinct in UNIQUE
-- constraints (multiple NULL source_series_code rows are allowed), so the
-- semantics are equivalent to the old partial index for all our data.
alter table macro_observations
  add constraint macro_obs_unique_key
  unique (indicator_id, observation_date, source_series_code);

drop index if exists macro_obs_unique_idx;
