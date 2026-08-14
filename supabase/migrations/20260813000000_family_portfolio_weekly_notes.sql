-- R13.R2C §§ 8-11 — MULTIPLE Weekly Notes per published week.
--
-- FORWARD-ONLY. Every deployed R13 migration is left untouched; this only adds.
--
-- WHY A NEW TABLE AND NOT `portfolio_commentary` (§ 9 asks for the audit).
-- `portfolio_commentary` is, by construction, ONE COMMENTARY DOCUMENT PER
-- (publication, scope):
--
--     create unique index portfolio_commentary_current_idx
--       on public.portfolio_commentary (publication_id, scope)
--       where superseded_by is null;
--
-- Exactly one live row per week and scope, with every earlier row retained as a
-- SUPERSEDED REVISION of that same document. Representing several simultaneous
-- notes there would mean either dropping that index — destroying the
-- one-live-revision guarantee the publication ledger depends on — or reusing
-- revision rows as sibling notes, which would make "revision 3" mean
-- "note 3 of 4" in some weeks and "the third edit" in others. Both corrupt the
-- audit semantics the model exists for. The commentary model is therefore left
-- exactly as it is, and multiple notes get their own structure.
--
-- MAIN ONLY IS A PRODUCT RULE, NOT A SCHEMA RULE. The owner wants notes on the
-- Main portfolio and explicitly does not want them invented for the personal
-- scopes (§ 7). The column is CHECK-constrained to the same scope vocabulary
-- every other portfolio table uses so a stray write cannot land under a scope
-- nobody reads, and the API refuses anything but `main`; widening later is a
-- one-line product change rather than a migration.
--
-- SOFT DELETE (§ 11). A note removed by an administrator is TOMBSTONED, never
-- erased: `deleted_at`/`deleted_by` are stamped and the row leaves every member
-- read. Hard deletion would destroy the record that a note existed and was
-- withdrawn — the same reason the commentary chain supersedes instead of
-- updating in place.
--
-- POSTURE. Identical to `portfolio_commentary` and
-- `portfolio_evolution_observations`: RLS on, a scope-filtered SELECT policy for
-- `authenticated`, NO write policy at all, and writes performed by service_role
-- behind a server-side administrator check.

-- ── Guard: the entitlement + publication migrations must already be applied ────
do $$
begin
  if to_regprocedure('public.nmi_can_access_scope(text)') is null then
    raise exception 'public.nmi_can_access_scope(text) is missing — apply the R13.1 entitlement migration first';
  end if;
  if to_regclass('public.portfolio_publications') is null then
    raise exception 'public.portfolio_publications is missing — apply the R13.5 publication migration first';
  end if;
end $$;

-- ── 1. Notes ──────────────────────────────────────────────────────────────────
create table if not exists public.family_portfolio_weekly_notes (
  id              uuid primary key default gen_random_uuid(),
  -- The WEEK the note belongs to. `on delete cascade` mirrors
  -- `portfolio_commentary`: a publication that is deleted takes its annotations
  -- with it, because they describe that week's figures and nothing else.
  publication_id  uuid not null references public.portfolio_publications(id) on delete cascade,
  scope           text not null check (scope in ('main','jaime','andres','pablo','alternatives')),
  body            text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  -- Deterministic ordering (§ 10). Ties break on `created_at` then `id`, so two
  -- notes written in the same second still have ONE stable order.
  display_order   int  not null default 0,
  created_by      uuid not null references auth.users(id) on delete restrict,
  updated_by      uuid references auth.users(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Tombstone (§ 11). Both stamped together or neither.
  deleted_at      timestamptz,
  deleted_by      uuid references auth.users(id) on delete restrict,
  metadata        jsonb not null default '{}'::jsonb,
  constraint family_portfolio_weekly_notes_deletion_pair
    check ((deleted_at is null) = (deleted_by is null))
);

-- The read index: every member read is "the live notes of this week and scope,
-- in order".
create index if not exists family_portfolio_weekly_notes_live_idx
  on public.family_portfolio_weekly_notes (publication_id, scope, display_order, created_at)
  where deleted_at is null;

comment on table public.family_portfolio_weekly_notes is
  'R13.R2C — multiple administrator-authored notes per (publication, scope). NMI-authored content: '
  'nothing in the RESUMEN workbook feeds it and no code path generates it. Deletion is a tombstone, '
  'never a row removal.';

-- ── 2. updated_at ─────────────────────────────────────────────────────────────
create or replace function public.nmi_touch_weekly_note()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists family_portfolio_weekly_notes_touch on public.family_portfolio_weekly_notes;
create trigger family_portfolio_weekly_notes_touch
  before update on public.family_portfolio_weekly_notes
  for each row execute function public.nmi_touch_weekly_note();

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
alter table public.family_portfolio_weekly_notes enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_weekly_notes'
  loop
    execute format('drop policy %I on public.family_portfolio_weekly_notes', pol.policyname);
  end loop;
end $$;

-- A note is portfolio content, so it reads through the SAME scope predicate as
-- the rows it annotates — AND a tombstoned note is invisible to every reader
-- here, not merely filtered by the application (§ 11).
create policy "family_portfolio_weekly_notes_scope_select"
  on public.family_portfolio_weekly_notes
  for select to authenticated
  using (public.nmi_can_access_scope(scope) and deleted_at is null);

revoke all privileges on table public.family_portfolio_weekly_notes from public, anon, authenticated;
grant select on table public.family_portfolio_weekly_notes to authenticated;
grant all privileges on table public.family_portfolio_weekly_notes to service_role;

-- ── 4. Postconditions ─────────────────────────────────────────────────────────
do $$
declare
  n int;
begin
  if to_regclass('public.family_portfolio_weekly_notes') is null then
    raise exception 'family_portfolio_weekly_notes was not created';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'family_portfolio_weekly_notes' and c.relrowsecurity
  ) then
    raise exception 'row level security is not enabled on family_portfolio_weekly_notes';
  end if;

  select count(*) into n from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'family_portfolio_weekly_notes';
  if n <> 1 then
    raise exception 'expected exactly one policy on family_portfolio_weekly_notes, found %', n;
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_weekly_notes' and cmd <> 'SELECT'
  ) then
    raise exception 'a non-SELECT policy exists on family_portfolio_weekly_notes — writes are service-role only';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_weekly_notes'
      and qual like '%nmi_can_access_scope%'
  ) then
    raise exception 'family_portfolio_weekly_notes does not read through the scope predicate';
  end if;

  -- The tombstone must be enforced in the POLICY, not only in application code.
  --
  -- MATCHED CASE-INSENSITIVELY, AND THAT IS LOAD-BEARING. `pg_policies.qual` is
  -- not the text this file was written in — it is the expression DEPARSED by
  -- `pg_get_expr`, and the deparser emits SQL keywords in upper case
  -- (`ruleutils.c` writes the literal " IS NULL" for a NullTest node). A
  -- lower-case LIKE therefore cannot match the policy it is checking, and this
  -- guard would fail the migration for a table that is in fact correct. The
  -- regex tolerates either rendering and any run of whitespace, so it asserts
  -- the PROPERTY rather than one particular spelling of it.
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_weekly_notes'
      and qual ~* 'deleted_at\s+is\s+null'
  ) then
    raise exception 'a deleted note is still readable — the tombstone is not enforced by RLS';
  end if;

  if has_table_privilege('authenticated', 'public.family_portfolio_weekly_notes', 'INSERT')
     or has_table_privilege('authenticated', 'public.family_portfolio_weekly_notes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.family_portfolio_weekly_notes', 'DELETE') then
    raise exception 'authenticated can write family_portfolio_weekly_notes';
  end if;

  if has_table_privilege('anon', 'public.family_portfolio_weekly_notes', 'SELECT') then
    raise exception 'anon can read family_portfolio_weekly_notes';
  end if;

  -- `portfolio_commentary` is left untouched: its one-live-revision index is the
  -- guarantee this table exists in order NOT to break.
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'portfolio_commentary_current_idx'
  ) then
    raise exception 'the one-live-revision index on portfolio_commentary is missing';
  end if;
end $$;
