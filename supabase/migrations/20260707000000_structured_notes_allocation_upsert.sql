-- Phase 9B.1 — Structured Notes: upsert allocations by entity.
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.
--
-- The allocation-by-entity grid sets one notional per (note, entity). A unique
-- constraint on (note_id, entity_name) lets the app upsert (set/overwrite the
-- amount for an entity) instead of accumulating duplicate rows.

do $$ begin
  alter table structured_note_allocations
    add constraint structured_note_allocations_note_entity_key unique (note_id, entity_name);
exception when duplicate_object then null; end $$;
