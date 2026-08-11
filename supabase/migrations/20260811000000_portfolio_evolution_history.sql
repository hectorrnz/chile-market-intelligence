-- R13.R1 § 9/§ 16 — weekly Portfolio Evolution history.
--
-- FORWARD-ONLY. The five deployed R13 migrations (20260806…20260810) are never
-- edited; this is the first migration after them and it only adds.
--
-- WHY A TABLE AND NOT A READ-TIME PARSE (§ 16 asks for the justification):
--
--   * The source of the history is a STAGED UPLOAD — a transient artifact in a
--     private bucket. Publications are the durable record; deriving a member-
--     facing chart from an upload on every request would make the chart depend
--     on an object nobody promised to keep.
--   * Re-reading and re-parsing a ~450 KB workbook on every Summary request is
--     not production-grade. Persisted, the whole history is 204 narrow rows.
--   * Provenance has to survive. Each observation records the exact cell it was
--     read from, the upload it came from, and the extractor + parser versions,
--     so a figure on the chart can be traced back two years later.
--
-- WHY NOT A PUBLICATION PER WEEK: R13.R1's inventory established that only the
-- most recent handful of historical columns produce a clean full-row parse,
-- while the two evolution rows carry a value in EVERY historical column. The
-- publication lifecycle stays the authority for row-level weeks (and § 10
-- backfills the weeks that genuinely qualify); this table carries only the
-- total-level series, which is complete and entirely source-backed.
--
-- POSTURE — these are PORTFOLIO VALUES, so the read policy is the same
-- scope-filtered predicate `portfolio_snapshot_rows` uses. There is no
-- insert/update/delete policy for `authenticated`: writes are service-role only,
-- performed after a server-side administrator check, exactly like publication.

-- ── Guard: the R13 entitlement + upload migrations must already be applied ─────
do $$
begin
  if to_regprocedure('public.nmi_can_access_scope(text)') is null then
    raise exception 'public.nmi_can_access_scope(text) is missing — apply the R13.1 entitlement migration first';
  end if;
  if to_regclass('public.portfolio_source_uploads') is null then
    raise exception 'public.portfolio_source_uploads is missing — apply the R13.2 upload migration first';
  end if;
end $$;

-- ── 1. Observations ───────────────────────────────────────────────────────────
create table if not exists public.portfolio_evolution_observations (
  id                uuid primary key default gen_random_uuid(),
  scope             text not null check (scope in ('main','jaime','andres','pablo')),
  -- The same vocabulary the performance rows use (doc 05 § 5.3), so a series can
  -- never be stored under a basis name no reader recognises.
  basis             text not null check (basis in
                      ('ex_chilean_equities','with_chilean_equities','total')),
  -- The SOURCE column's own header date. Never a server clock, never inferred
  -- from a neighbouring week.
  observation_date  date not null,
  -- NOT NULL by design: an observation exists only where the source carried a
  -- usable number. A missing week is an ABSENT ROW — a gap — never a null value
  -- and never a zero (doc 02 § 9).
  value             numeric not null,
  currency          text not null default 'USD',
  source_upload_id  uuid not null references public.portfolio_source_uploads(id) on delete restrict,
  source_sheet      text not null,
  source_cell       text not null,
  source_row_label  text not null,
  parser_version    text not null,
  extractor_version text not null,
  ingested_by       uuid references auth.users(id) on delete set null,
  ingested_at       timestamptz not null default now(),
  metadata          jsonb not null default '{}'::jsonb,
  -- One value per (scope, basis, week). A re-ingest of the same workbook, or an
  -- ingest of a later workbook that restates a historical week, UPDATES the row
  -- rather than accumulating a second observation for the same date — which is
  -- what makes the ingest idempotent.
  constraint portfolio_evolution_observations_key unique (scope, basis, observation_date)
);

create index if not exists portfolio_evolution_observations_series_idx
  on public.portfolio_evolution_observations (scope, basis, observation_date);

-- ── 2. RLS ────────────────────────────────────────────────────────────────────
alter table public.portfolio_evolution_observations enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'portfolio_evolution_observations'
  loop
    execute format('drop policy %I on public.portfolio_evolution_observations', pol.policyname);
  end loop;
end $$;

-- Scope-filtered read through the R13.1 helper — the identical predicate
-- `portfolio_snapshot_rows` uses, so an evolution point can never be visible to
-- a caller who could not see the snapshot row it was read from.
create policy "portfolio_evolution_observations_scope_select"
  on public.portfolio_evolution_observations
  for select to authenticated
  using (public.nmi_can_access_scope(scope));

revoke all privileges on table public.portfolio_evolution_observations from public, anon, authenticated;
grant select on table public.portfolio_evolution_observations to authenticated;
grant all privileges on table public.portfolio_evolution_observations to service_role;

-- ── 3. Postconditions ─────────────────────────────────────────────────────────

-- 3a. Table, uniqueness and index exist.
do $$
begin
  if to_regclass('public.portfolio_evolution_observations') is null then
    raise exception 'portfolio_evolution_observations was not created';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'portfolio_evolution_observations_key'
      and conrelid = 'public.portfolio_evolution_observations'::regclass
  ) then
    raise exception 'the (scope, basis, observation_date) uniqueness constraint is missing — ingest could not be idempotent';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'portfolio_evolution_observations_series_idx'
  ) then
    raise exception 'portfolio_evolution_observations_series_idx is missing';
  end if;
end $$;

-- 3b. `value` must stay NOT NULL — a nullable value column would let a gap be
-- stored as a row, which is exactly the "unavailable is not zero" failure this
-- table is shaped to prevent.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'portfolio_evolution_observations'
      and column_name = 'value' and is_nullable = 'YES'
  ) then
    raise exception 'portfolio_evolution_observations.value must be NOT NULL';
  end if;
end $$;

-- 3c. RLS is on, the read policy resolves through the scope helper, and no
-- write policy exists for any non-service role.
do $$
declare
  v_rls   boolean;
  v_using text;
  v_writes int;
begin
  select c.relrowsecurity into v_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'portfolio_evolution_observations';
  if not coalesce(v_rls, false) then
    raise exception 'row level security is not enabled on portfolio_evolution_observations';
  end if;

  select qual into v_using from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'portfolio_evolution_observations'
     and policyname = 'portfolio_evolution_observations_scope_select';
  if v_using is null or v_using not like '%nmi_can_access_scope%' then
    raise exception 'the evolution read policy does not resolve through nmi_can_access_scope';
  end if;

  select count(*) into v_writes from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'portfolio_evolution_observations'
     and cmd <> 'SELECT';
  if v_writes > 0 then
    raise exception 'portfolio_evolution_observations must have no write policy — writes are service-role only';
  end if;
end $$;

-- 3d. `authenticated` holds SELECT and nothing more.
do $$
declare
  priv text;
begin
  foreach priv in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('authenticated', 'public.portfolio_evolution_observations', priv) then
      raise exception 'authenticated must not hold % on portfolio_evolution_observations', priv;
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.portfolio_evolution_observations', 'SELECT') then
    raise exception 'authenticated must hold SELECT on portfolio_evolution_observations';
  end if;
  if has_table_privilege('anon', 'public.portfolio_evolution_observations', 'SELECT') then
    raise exception 'anon must not hold SELECT on portfolio_evolution_observations';
  end if;
end $$;
