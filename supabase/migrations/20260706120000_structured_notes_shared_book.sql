-- Phase 9B — Structured Notes: shared internal book (org-wide visibility).
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.
--
-- Phase 9A shipped structured notes user-scoped (each user saw only their own
-- uploads). For an internal family-office terminal the structured-notes tab is
-- a single shared book: every authenticated user must see the same positions —
-- how many are live, in/out of the money, about to autocall, total exposure —
-- exactly like the legacy shared workbook. This migration converts the RLS from
-- per-user to "any authenticated user", keeps `user_id` only as an
-- upload/audit stamp (who added the row), and removes the ownership-guard
-- triggers (which enforced per-user isolation and would block shared editing).

-- ── Drop per-user ownership-guard triggers (isolation no longer applies) ────────
drop trigger if exists guard_sn_underlyings_owner      on structured_note_underlyings;
drop trigger if exists guard_sn_observations_owner     on structured_note_observations;
drop trigger if exists guard_sn_allocations_owner      on structured_note_allocations;
drop trigger if exists guard_sn_price_snapshots_owner  on structured_note_price_snapshots;
drop function if exists check_structured_note_ownership();

-- ── ISIN uniqueness is global for the shared book (not per user) ────────────────
do $$ begin
  alter table structured_notes drop constraint if exists structured_notes_user_id_isin_key;
exception when undefined_object then null; end $$;
-- (the original UNIQUE (user_id, isin) is auto-named structured_notes_user_id_isin_key)
create unique index if not exists structured_notes_isin_unique
  on structured_notes (isin) where isin is not null;

-- ── Replace per-user RLS with shared "any authenticated user" RLS ───────────────
do $$
declare t text;
begin
  foreach t in array array[
    'structured_notes','structured_note_underlyings','structured_note_observations',
    'structured_note_allocations','structured_note_price_snapshots',
    'structured_note_extraction_runs','structured_note_extracted_fields'
  ]
  loop
    -- Drop the Phase 9A own-row policies.
    execute format('drop policy if exists "sn_own_select" on %I', t);
    execute format('drop policy if exists "sn_own_insert" on %I', t);
    execute format('drop policy if exists "sn_own_update" on %I', t);
    execute format('drop policy if exists "sn_own_delete" on %I', t);
    -- Shared book: any signed-in user can read/write; anon (public) still blocked.
    execute format('drop policy if exists "sn_shared_select" on %I', t);
    execute format('drop policy if exists "sn_shared_insert" on %I', t);
    execute format('drop policy if exists "sn_shared_update" on %I', t);
    execute format('drop policy if exists "sn_shared_delete" on %I', t);
    execute format('create policy "sn_shared_select" on %I for select using (auth.uid() is not null)', t);
    execute format('create policy "sn_shared_insert" on %I for insert with check (auth.uid() is not null)', t);
    execute format('create policy "sn_shared_update" on %I for update using (auth.uid() is not null)', t);
    execute format('create policy "sn_shared_delete" on %I for delete using (auth.uid() is not null)', t);
  end loop;
end $$;
