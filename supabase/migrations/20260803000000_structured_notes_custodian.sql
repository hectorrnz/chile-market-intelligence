-- R7.1B.1 - custodian is a note-level fact.
--
-- Forward-only and additive. This migration adds one nullable column and
-- updates comments. No existing column is dropped, renamed, or rewritten.
-- No existing row is modified.
--
-- Apply through the Supabase CLI migration workflow:
--   supabase migration list
--   supabase db push --dry-run
--   supabase db push
--
-- Every account allocation of a given structured note is traded through the
-- same custodian. The custodian varies from note to note, not from account to
-- account within one note. Custody therefore belongs on the note and is
-- captured once.
--
-- structured_note_allocations.custodian was added by the Phase 9A foundation
-- migration but was never exposed for user input. It is superseded and is not
-- dropped because this project's migrations are additive and the column may
-- exist in deployed databases.
--
-- Nothing should read or write the allocation-level custodian field after
-- R7.1B.1. Exposure calculations and note editing use
-- structured_notes.custodian.
--
-- The new field is nullable and has no default. A term sheet cannot identify
-- Nevada's custodian because custody is not a product term. Custodian remains
-- unavailable until a user records it. It is never derived from the issuer,
-- dealer, allocation entity, or clearing system.

do $$
begin
  if to_regclass('public.structured_notes') is null then
    raise exception
      'public.structured_notes not found - apply the Phase 9A structured-notes foundation migration first';
  end if;
end $$;

alter table public.structured_notes
  add column if not exists custodian text;

comment on column public.structured_notes.custodian is
  'Institution holding Nevada''s position in this note. User-entered portfolio data; never extracted from a term sheet or derived from the issuer, dealer, calculation agent, or clearing system. Euroclear and Clearstream are settlement infrastructure, not custodians. Null means not yet recorded.';

comment on column public.structured_note_allocations.custodian is
  'SUPERSEDED by structured_notes.custodian in R7.1B.1. All accounts of a note share one custodian. Retained for migration safety and no longer read or written.';