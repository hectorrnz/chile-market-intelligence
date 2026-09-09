-- R13.8E + POST-R13.8 FOLLOW-UP D -- THE SOURCE-BACKED ANALYTICAL HISTORY LAYER.
--
-- TWO HISTORIES, ONE MIGRATION, ONE TRANSACTION. Row history (section 1) stores
-- what each holding stood at on every frozen reporting date; performance history
-- (section 6) stores the source's own weekly flow, profit and return at those
-- same dates. They answer two different questions that a custom FROM -> TO
-- comparison needs at once -- which positions moved, and how much money moved
-- in or out -- and they are written by the SAME import transaction, because a
-- book holding one without the other cannot reconcile a period.
--
-- This file was extended rather than layered: it has NOT been applied to
-- Production, so Production immutability does not attach to it yet, and two
-- migrations for one analytical layer would be archaeology for no gain.
--
-- WHAT WAS MISSING (ROW HISTORY). `portfolio_snapshot_rows` is keyed by
-- `publication_id`, so a
-- row-level value exists only for a week the book PUBLISHED. The evolution
-- series and the import mutation ledger are both total-level. After a catch-up
-- import the book therefore holds 2026-08-07 as a portfolio LEVEL but has no
-- record of which holding stood at what value on that date -- and a rolling
-- four-interval Contributors/Detractors chart needs exactly that.
--
-- The parser already computes it. `parseAtFrozenPublicationColumn` builds a full
-- snapshot payload for EVERY clean frozen column while scanning for the newest
-- publishable one, then discards all but the published week's. This migration
-- gives those payloads somewhere to live.
--
-- WHAT THIS IS NOT. `portfolio_row_history` is historical analytical storage. It
-- is not a publication: no `is_current`, no revision chain, no `superseded_by`,
-- and nothing in the Holdings or Compare surfaces may select a date from it as
-- a publication. The locked R13.8 architecture is unchanged:
--
--   ONE upload -> ONE import operation -> N evolution points
--              -> N source-backed row-history dates
--              -> N source-backed performance-history dates
--              -> ONE newest full publication.
--
-- IT ALSO FIXES A REAL WRITE-PATH DEFECT (see section 6). R13.8D.1's historical
-- restatement path stamped the IMPORT ANCHOR's `previousWeekDate` onto every
-- week it restated, so 2026-06-19 through 2026-07-31 each carry
-- `previousWeekDate = 2026-08-28` -- a date after the week it claims to precede.
-- Row VALUES were never affected. From here each restated week carries its own
-- frozen column's anchor, and the database refuses an anchor that is not
-- strictly earlier than the week it belongs to.

-- ===========================================================================
-- 0. Preconditions
-- ===========================================================================
do $$
begin
  if to_regclass('public.portfolio_import_operations') is null then
    raise exception 'portfolio_import_operations is missing -- apply 20260821000000 first';
  end if;
  if to_regclass('public.portfolio_snapshot_rows') is null then
    raise exception 'portfolio_snapshot_rows is missing -- apply 20260808000000 first';
  end if;
end $$;

-- ===========================================================================
-- 1. The row-history table
-- ===========================================================================
--
-- CANONICAL IDENTITY. `portfolio_snapshot_rows` identifies a row by
-- (publication_id, scope, row_key). Row history replaces the publication with
-- the reporting date it observes, giving (scope, observation_date, row_key).
--
-- `basis` is deliberately ABSENT. It is not part of snapshot-row identity -- a
-- snapshot row belongs to a scope, and basis distinguishes only performance
-- rows and evolution series. Adding it here would invent an identity dimension
-- the row model does not have.
create table if not exists public.portfolio_row_history (
  id               uuid primary key default gen_random_uuid(),
  scope            text not null check (scope in ('main', 'jaime', 'andres', 'pablo')),
  -- The FROZEN reporting date this row was observed at. Never a publication id:
  -- most of these dates have no publication and never will.
  observation_date date not null,
  row_key          text not null,
  parent_row_key   text,
  depth            int  not null check (depth >= 0),
  display_order    int  not null,
  row_type         text not null check (row_type in
                     ('group_header','asset_class','sub_asset_class','sociedad_header',
                      'individual_asset','sociedad_subtotal','sociedad_total',
                      'portfolio_subtotal','portfolio_total',
                      'named_holding','flow','performance')),
  label_es         text not null,
  label_en         text,
  currency         text not null default 'USD',
  value            numeric,
  value_class      text not null check (value_class in
                     ('source_value','source_provided_return','source_provided_flow',
                      'nmi_calculated','unavailable','not_reproducible')),
  -- Lineage. The upload is the authoritative workbook this value came out of;
  -- the import operation is the transaction that wrote it, and is what a
  -- rollback keys on.
  source_upload_id    uuid not null references public.portfolio_source_uploads(id) on delete restrict,
  import_operation_id uuid references public.portfolio_import_operations(id) on delete restrict,
  source_sheet     text not null,
  source_cell      text not null,
  source_row       int,
  parser_version   text not null,
  metadata         jsonb not null default '{}'::jsonb,
  ingested_at      timestamptz not null default now(),
  constraint portfolio_row_history_key unique (scope, observation_date, row_key),
  -- AN UNREADABLE VALUE IS NEVER A NUMBER. The one substitution that would
  -- quietly corrupt a contributors chart is `unavailable` arriving as 0, so the
  -- database refuses it rather than trusting every caller to remember.
  constraint portfolio_row_history_unavailable_ck check (
    value_class <> 'unavailable' or value is null
  )
);

create index if not exists portfolio_row_history_scope_date_idx
  on public.portfolio_row_history (scope, observation_date);
create index if not exists portfolio_row_history_date_idx
  on public.portfolio_row_history (observation_date);
create index if not exists portfolio_row_history_import_idx
  on public.portfolio_row_history (import_operation_id);

comment on table public.portfolio_row_history is
  'R13.8E: source-backed row-level values at every frozen reporting date, including dates that '
  'carry no publication. Analytical history, NEVER a publication: no is_current, no revision '
  'chain, and never selectable as a Holdings or Compare endpoint.';
comment on column public.portfolio_row_history.observation_date is
  'The workbook''s own frozen reporting date. Most of these dates have no publication.';
comment on column public.portfolio_row_history.value is
  'NULL is a real answer. A row whose source cell is unreadable stores NULL with value_class '
  '''unavailable'' -- never 0, which would read as a real position that went to nothing.';

-- ===========================================================================
-- 2. The row-history before-image ledger
-- ===========================================================================
--
-- The same discipline as `portfolio_import_observation_mutations`, at row grain.
-- An insertion has no before-image; an overwrite must have one, or a rollback
-- could only guess. `prior_row` carries the WHOLE displaced row so a reversal
-- restores presentation and provenance exactly, not merely the number.
create table if not exists public.portfolio_import_row_history_mutations (
  id                  uuid primary key default gen_random_uuid(),
  import_operation_id uuid not null references public.portfolio_import_operations(id) on delete cascade,
  scope               text not null,
  observation_date    date not null,
  row_key             text not null,
  disposition         text not null check (disposition in ('new','gap_fill','changed')),
  prior_value         numeric,
  prior_value_class   text,
  -- WHICH import last wrote the row this one overwrote, so rollbacks chain
  -- correctly. NULL is a real answer for a row written before this migration.
  prior_import_operation_id uuid references public.portfolio_import_operations(id) on delete restrict,
  prior_row           jsonb,
  new_value           numeric,
  new_value_class     text not null,
  created_at          timestamptz not null default now(),
  constraint portfolio_import_row_history_mutations_key
    unique (import_operation_id, scope, observation_date, row_key),
  constraint portfolio_import_row_history_mutations_before_ck check (
    (disposition in ('new','gap_fill')
      and prior_value is null and prior_value_class is null and prior_row is null)
    or (disposition = 'changed' and prior_value_class is not null and prior_row is not null)
  ),
  constraint portfolio_import_row_history_mutations_unavailable_ck check (
    new_value_class <> 'unavailable' or new_value is null
  )
);

create index if not exists portfolio_import_row_history_mutations_op_idx
  on public.portfolio_import_row_history_mutations (import_operation_id);
create index if not exists portfolio_import_row_history_mutations_identity_idx
  on public.portfolio_import_row_history_mutations (scope, observation_date, row_key);

-- ===========================================================================
-- 3. The staging relay
-- ===========================================================================
--
-- WHY A RELAY AND NOT ANOTHER RPC ARGUMENT. A first backfill carries every clean
-- frozen column the authoritative workbook holds -- measured at 19,757 rows and
-- 4.2 MB of JSON for `portfolio-2026-09-04.xlsx`. Sending that as one more
-- `jsonb` argument would make the import's success depend on an HTTP body limit
-- that has nothing to do with whether the data is correct.
--
-- So the payload arrives in bounded chunks BEFORE the import, and the import
-- receives only the staging id -- which is why `nmi_import_portfolio_workbook`
-- KEEPS ITS EXACT 14-ARGUMENT SIGNATURE. There is no overload, no second
-- callable import path, and no release window in which one of two functions
-- silently omits row history.
--
-- These rows are TRANSPORT, never state. Nothing reads them but the import that
-- consumes and deletes them in the same transaction. A failed import leaves
-- chunks behind that no surface can see; the next import purges anything older
-- than a day.
create table if not exists public.portfolio_row_history_staging (
  staging_id  uuid not null,
  chunk_index int  not null check (chunk_index >= 0),
  rows        jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (staging_id, chunk_index)
);

create index if not exists portfolio_row_history_staging_created_idx
  on public.portfolio_row_history_staging (created_at);

comment on table public.portfolio_row_history_staging is
  'Transport only. Row-history chunks staged immediately before nmi_import_portfolio_workbook, '
  'consumed and deleted inside that transaction. Never read by any surface.';

-- ONE definition of the staged row shape.
--
-- The import reads this set nine times -- to count it, to validate it, to assert
-- three stale-plan conditions against the book, and to write the ledger, the
-- updates and the inserts. Materialising it into a temp table would make every
-- one of those statements unanalysable to `plpgsql_check` and to `supabase db
-- lint`, which cannot see a relation that only exists at run time. A
-- set-returning function is the same set, resolvable statically, with the column
-- list written once instead of nine times.
--
-- STABLE, not IMMUTABLE: it reads a table. SECURITY INVOKER, so it can only ever
-- see what its caller could -- and its caller is the service-role import path.
create or replace function public.nmi_staged_row_history(p_staging_id uuid)
returns table (
  scope text, observation_date date, row_key text, parent_row_key text,
  depth int, display_order int, row_type text, label_es text, label_en text,
  currency text, value numeric, value_class text,
  source_sheet text, source_cell text, source_row int, parser_version text,
  disposition text, prior_value numeric, prior_value_class text
)
language sql
stable
set search_path = ''
as $$
  select x.scope, x.observation_date, x.row_key, x.parent_row_key, x.depth,
         x.display_order, x.row_type, x.label_es, x.label_en, x.currency,
         x.value, x.value_class, x.source_sheet, x.source_cell, x.source_row,
         x.parser_version, x.disposition, x.prior_value, x.prior_value_class
    from public.portfolio_row_history_staging s
    cross join lateral jsonb_to_recordset(s.rows) as x(
      scope text, observation_date date, row_key text, parent_row_key text,
      depth int, display_order int, row_type text, label_es text, label_en text,
      currency text, value numeric, value_class text,
      source_sheet text, source_cell text, source_row int, parser_version text,
      disposition text, prior_value numeric, prior_value_class text)
   where p_staging_id is not null and s.staging_id = p_staging_id;
$$;

revoke all on function public.nmi_staged_row_history(uuid) from public, anon, authenticated;
grant execute on function public.nmi_staged_row_history(uuid) to service_role;

-- ===========================================================================
-- 4. RLS
-- ===========================================================================
--
-- `portfolio_row_history` holds portfolio VALUES, so it takes the SAME
-- scope-filtered predicate as `portfolio_snapshot_rows`: a member reads exactly
-- the scopes their own profile authorizes, re-derived by PostgreSQL rather than
-- trusted from the server. Jaime cannot read Andres's rows here any more than he
-- can read them in a publication, and an account with no portfolio principal has
-- no personal scope at all.
--
-- The ledger and the staging relay are SERVICE-ROLE ONLY: both carry values
-- across every scope at once, so exposing either to `authenticated` would bypass
-- the scope filter that guards the table they describe.
alter table public.portfolio_row_history enable row level security;
alter table public.portfolio_import_row_history_mutations enable row level security;
alter table public.portfolio_row_history_staging enable row level security;

do $$
declare
  tbl text;
  pol record;
begin
  foreach tbl in array array[
    'portfolio_row_history',
    'portfolio_import_row_history_mutations',
    'portfolio_row_history_staging'
  ] loop
    for pol in
      select policyname from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy %I on public.%I', pol.policyname, tbl);
    end loop;
  end loop;
end $$;

create policy "portfolio_row_history_scope_select"
  on public.portfolio_row_history
  for select to authenticated
  using (public.nmi_can_access_scope(scope));

revoke all privileges on table public.portfolio_row_history from public, anon, authenticated;
revoke all privileges on table public.portfolio_import_row_history_mutations
  from public, anon, authenticated;
revoke all privileges on table public.portfolio_row_history_staging
  from public, anon, authenticated;
grant select on table public.portfolio_row_history to authenticated;
grant all privileges on table public.portfolio_row_history to service_role;
grant all privileges on table public.portfolio_import_row_history_mutations to service_role;
grant all privileges on table public.portfolio_row_history_staging to service_role;

-- ===========================================================================
-- 5. Row-history coverage, for the planner
-- ===========================================================================
--
-- The planner must classify ~19,757 identities per workbook. Reading them one
-- page at a time is what the repository does; this view exists so a coverage
-- question ("which dates does row history already hold, and how many rows
-- each?") costs one small read instead of the whole table.
create or replace view public.portfolio_row_history_coverage
with (security_invoker = true) as
select scope, observation_date, count(*)::bigint as row_count
  from public.portfolio_row_history
 group by scope, observation_date;

revoke all privileges on public.portfolio_row_history_coverage from public, anon;
grant select on public.portfolio_row_history_coverage to authenticated, service_role;

-- ===========================================================================
-- 6. Performance history -- the same model, at METRIC grain
-- ===========================================================================
--
-- WHAT WAS STILL MISSING AFTER SECTION 1. Row history answers "what did each
-- holding stand at on 2026-08-07". It cannot answer "how much money moved in or
-- out between 2026-04-30 and 2026-09-04", because a flow is not a row value --
-- it is a stated weekly performance metric, and `portfolio_performance_rows` is
-- keyed by `publication_id`, so it exists only for weeks the book PUBLISHED.
--
-- A custom FROM -> TO comparison is therefore not a weekly view, and it cannot
-- be reconciled from levels alone:
--
--     Period P&L = To value - From value - SUM(weekly flow over (FROM, TO])
--
-- Every term of that sum lives in a week that mostly has no publication.
--
-- CANONICAL IDENTITY. `portfolio_performance_rows` identifies a metric by
-- (publication_id, scope, basis, metric). Performance history replaces the
-- publication with the reporting date it observes, giving
-- (scope, basis, metric, observation_date).
--
-- `basis` IS part of that identity and is carried, unlike in row history where
-- it is deliberately absent -- because it genuinely distinguishes two different
-- performance series for Main (`ex_chilean_equities` and
-- `with_chilean_equities`), while a snapshot row belongs to a scope alone. The
-- rule in both tables is the same: reuse the publication identity exactly, and
-- invent no dimension the source model does not have.
--
-- WHAT THIS IS NOT. Like row history, this is historical analytical storage: no
-- `is_current`, no revision chain, no `superseded_by`, and no date here is ever
-- selectable as a published week.
create table if not exists public.portfolio_performance_history (
  id               uuid primary key default gen_random_uuid(),
  scope            text not null check (scope in ('main', 'jaime', 'andres', 'pablo')),
  -- Identical vocabulary to `portfolio_performance_rows`. A metric name is the
  -- persisted contract every reader queries by; a second spelling here would be
  -- a silently empty series rather than an error.
  basis            text not null check (basis in
                     ('ex_chilean_equities','with_chilean_equities','total')),
  metric           text not null check (metric in
                     ('flow','weekly_profit','weekly_return','ytd_profit','ytd_return')),
  observation_date date not null,
  value            numeric,
  value_class      text not null check (value_class in
                     ('source_value','source_provided_return','source_provided_flow',
                      'nmi_calculated','unavailable','not_reproducible')),
  source_upload_id uuid not null references public.portfolio_source_uploads(id) on delete restrict,
  import_operation_id uuid references public.portfolio_import_operations(id) on delete restrict,
  source_sheet     text not null,
  source_cell      text not null,
  source_row       int,
  parser_version   text not null,
  metadata         jsonb not null default '{}'::jsonb,
  ingested_at      timestamptz not null default now(),
  constraint portfolio_performance_history_key
    unique (scope, basis, metric, observation_date),
  -- The same rule row history carries: an unreadable metric is NULL and
  -- `unavailable`, never 0. A zero flow is a real statement that no money moved,
  -- and a period sum that quietly turned absence into zero would understate it.
  constraint portfolio_performance_history_unavailable_ck check (
    value_class <> 'unavailable' or value is null
  )
);

create index if not exists portfolio_performance_history_scope_idx
  on public.portfolio_performance_history (scope, basis, metric, observation_date);
create index if not exists portfolio_performance_history_date_idx
  on public.portfolio_performance_history (observation_date);
create index if not exists portfolio_performance_history_import_idx
  on public.portfolio_performance_history (import_operation_id);

comment on table public.portfolio_performance_history is
  'Source-stated weekly performance metrics at EVERY frozen reporting date, including the many that '
  'carry no publication. Analytical history, never a publication: no is_current, no revision chain.';
comment on column public.portfolio_performance_history.value is
  'NULL is a real answer. A metric the source did not state is unavailable with no number -- never 0, '
  'which for a flow would assert that no money moved.';

-- The before-image ledger, at metric grain.
create table if not exists public.portfolio_import_performance_history_mutations (
  id                  uuid primary key default gen_random_uuid(),
  import_operation_id uuid not null references public.portfolio_import_operations(id) on delete cascade,
  scope               text not null,
  basis               text not null,
  metric              text not null,
  observation_date    date not null,
  disposition         text not null check (disposition in ('new','gap_fill','changed')),
  prior_value         numeric,
  prior_value_class   text,
  prior_import_operation_id uuid references public.portfolio_import_operations(id) on delete restrict,
  prior_row           jsonb,
  new_value           numeric,
  new_value_class     text not null,
  created_at          timestamptz not null default now(),
  constraint portfolio_import_performance_history_mutations_key
    unique (import_operation_id, scope, basis, metric, observation_date),
  constraint portfolio_import_performance_history_mutations_before_ck check (
    (disposition in ('new','gap_fill')
      and prior_value is null and prior_value_class is null and prior_row is null)
    or (disposition = 'changed' and prior_value_class is not null and prior_row is not null)
  ),
  constraint portfolio_import_performance_history_mutations_unavailable_ck check (
    new_value_class <> 'unavailable' or new_value is null
  )
);

create index if not exists portfolio_import_performance_history_mutations_op_idx
  on public.portfolio_import_performance_history_mutations (import_operation_id);
create index if not exists portfolio_import_performance_history_mutations_identity_idx
  on public.portfolio_import_performance_history_mutations
     (scope, basis, metric, observation_date);

-- The relay, mirroring section 3 exactly.
--
-- A first backfill is 2,260 metrics and ~0.85 MB -- an order of magnitude
-- smaller than row history, and it would very likely fit in one request body.
-- It travels the same way regardless: two transports for two histories written
-- by one transaction would be two failure modes to reason about, and "it still
-- fits" is not a property anyone should have to re-verify every week.
create table if not exists public.portfolio_performance_history_staging (
  staging_id  uuid not null,
  chunk_index int  not null check (chunk_index >= 0),
  rows        jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (staging_id, chunk_index)
);

create index if not exists portfolio_performance_history_staging_created_idx
  on public.portfolio_performance_history_staging (created_at);

comment on table public.portfolio_performance_history_staging is
  'Transport only. Performance-history chunks staged immediately before nmi_import_portfolio_workbook, '
  'consumed and deleted inside that transaction. Never read by any surface.';

-- ONE definition of the staged metric shape, for the same reason
-- `nmi_staged_row_history` exists: the import reads this set repeatedly and
-- every one of those statements must stay statically analysable to
-- `plpgsql_check` and `supabase db lint`.
create or replace function public.nmi_staged_performance_history(p_staging_id uuid)
returns table (
  scope text, basis text, metric text, observation_date date,
  value numeric, value_class text,
  source_sheet text, source_cell text, source_row int, parser_version text,
  disposition text, prior_value numeric, prior_value_class text
)
language sql
stable
set search_path = ''
as $$
  select x.scope, x.basis, x.metric, x.observation_date, x.value, x.value_class,
         x.source_sheet, x.source_cell, x.source_row, x.parser_version,
         x.disposition, x.prior_value, x.prior_value_class
    from public.portfolio_performance_history_staging s
    cross join lateral jsonb_to_recordset(s.rows) as x(
      scope text, basis text, metric text, observation_date date,
      value numeric, value_class text,
      source_sheet text, source_cell text, source_row int, parser_version text,
      disposition text, prior_value numeric, prior_value_class text)
   where p_staging_id is not null and s.staging_id = p_staging_id;
$$;

revoke all on function public.nmi_staged_performance_history(uuid) from public, anon, authenticated;
grant execute on function public.nmi_staged_performance_history(uuid) to service_role;

-- RLS: identical posture to section 4. Performance history holds portfolio
-- FIGURES, so it takes the same scope-filtered predicate as
-- `portfolio_performance_rows`; the ledger and the relay carry every scope at
-- once and stay service-role only.
alter table public.portfolio_performance_history enable row level security;
alter table public.portfolio_import_performance_history_mutations enable row level security;
alter table public.portfolio_performance_history_staging enable row level security;

do $$
declare
  tbl text;
  pol record;
begin
  foreach tbl in array array[
    'portfolio_performance_history',
    'portfolio_import_performance_history_mutations',
    'portfolio_performance_history_staging'
  ] loop
    for pol in
      select policyname from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy %I on public.%I', pol.policyname, tbl);
    end loop;
  end loop;
end $$;

create policy "portfolio_performance_history_scope_select"
  on public.portfolio_performance_history
  for select to authenticated
  using (public.nmi_can_access_scope(scope));

revoke all privileges on table public.portfolio_performance_history from public, anon, authenticated;
revoke all privileges on table public.portfolio_import_performance_history_mutations
  from public, anon, authenticated;
revoke all privileges on table public.portfolio_performance_history_staging
  from public, anon, authenticated;
grant select on table public.portfolio_performance_history to authenticated;
grant all privileges on table public.portfolio_performance_history to service_role;
grant all privileges on table public.portfolio_import_performance_history_mutations to service_role;
grant all privileges on table public.portfolio_performance_history_staging to service_role;

-- Coverage, for the planner -- the analogue of section 5.
create or replace view public.portfolio_performance_history_coverage
with (security_invoker = true) as
select scope, basis, observation_date, count(*)::bigint as metric_count
  from public.portfolio_performance_history
 group by scope, basis, observation_date;

revoke all privileges on public.portfolio_performance_history_coverage from public, anon;
grant select on public.portfolio_performance_history_coverage to authenticated, service_role;

-- ===========================================================================
-- 7. The import RPC -- SAME SIGNATURE, five new responsibilities
-- ===========================================================================
--
--   a. Row history is written inside the import transaction, from the staging
--      relay named in `p_metadata->>'rowHistoryStagingId'`.
--   b. Performance history is written the same way, from
--      `p_metadata->>'performanceHistoryStagingId'`, in the SAME transaction.
--      Two analytical histories, one atomic write -- never a post-commit
--      best-effort second pass.
--   c. A restated historical week carries ITS OWN previous-week anchor, not the
--      import's.
--   d. An anchor that is not strictly earlier than the week it belongs to is
--      refused outright, at either endpoint.
--   e. An overwrite of a settled performance-history metric joins the existing
--      authorization gate.
--
-- `create or replace` with the identical argument list REPLACES the deployed
-- function in place. The previous release's application code calls it with the
-- same 14 named arguments and simply carries no staging id, which behaves
-- exactly as before this migration. There is never a moment with two callable
-- import functions.
create or replace function public.nmi_import_portfolio_workbook(
  p_upload_id             uuid,
  p_as_of_date            date,
  p_published_by          uuid,
  p_parser_version        text,
  p_plan_version          text,
  p_rows                  jsonb,
  p_observations          jsonb   default '[]'::jsonb,
  p_performance           jsonb   default '[]'::jsonb,
  p_correction_authorized boolean default false,
  p_correction_reason     text    default null,
  p_counts                jsonb   default '{}'::jsonb,
  p_admin_note            text    default null,
  p_metadata              jsonb   default '{}'::jsonb,
  p_historical_publications jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_op_id     uuid := gen_random_uuid();
  v_pub_id    uuid;
  v_prev_pub  uuid;
  v_history_mutations int;
  v_publication_unchanged boolean;
  v_restatements int;
  v_reason    text := nullif(btrim(coalesce(p_correction_reason, '')), '');
  m           record;
  h           record;
  v_cur_value numeric;
  v_cur_import uuid;
  v_cur_found boolean;
  v_inserted  int := 0;
  v_updated   int := 0;
  v_restated  int := 0;
  v_hist_prev uuid;
  v_hist_pub  uuid;
  v_hist_unchanged boolean;
  -- R13.8E
  v_staging   uuid := nullif(btrim(coalesce(p_metadata->>'rowHistoryStagingId', '')), '')::uuid;
  v_declared  int  := nullif(btrim(coalesce(p_metadata->>'rowHistoryRowCount', '')), '')::int;
  v_staged    int  := 0;
  v_rh_new    int  := 0;
  v_rh_changed int := 0;
  v_anchor    date;
  -- POST-R13.8 FOLLOW-UP D
  v_perf_staging  uuid := nullif(btrim(coalesce(p_metadata->>'performanceHistoryStagingId', '')), '')::uuid;
  v_perf_declared int  := nullif(btrim(coalesce(p_metadata->>'performanceHistoryRowCount', '')), '')::int;
  v_perf_staged   int  := 0;
  v_ph_new        int  := 0;
  v_ph_changed    int  := 0;
begin
  -- Serialise the whole import path before reading anything it will assert on.
  perform public.nmi_lock_portfolio_import('portfolio');

  -- Scratch hygiene: chunks abandoned by a failed import are transport, not
  -- state, and nothing may read them. A day is generous for a call that stages
  -- and consumes within one request.
  delete from public.portfolio_row_history_staging
   where created_at < now() - interval '1 day'
     and (v_staging is null or staging_id <> v_staging);

  delete from public.portfolio_performance_history_staging
   where created_at < now() - interval '1 day'
     and (v_perf_staging is null or staging_id <> v_perf_staging);

  if p_observations is null or jsonb_typeof(p_observations) <> 'array' then
    raise exception 'import_refused_invalid_observations';
  end if;

  if p_historical_publications is null
     or jsonb_typeof(p_historical_publications) <> 'array' then
    raise exception 'import_refused_invalid_historical_publications';
  end if;

  -- R13.8E -- THE CURRENT WEEK'S OWN ANCHOR MUST PRECEDE IT.
  -- A `previousWeekDate` on or after the week it belongs to is not a weakly
  -- supported figure, it is an impossible one, and the weekly surfaces read it
  -- as a financial basis. Refuse it at the write, not only at the read.
  v_anchor := nullif(btrim(coalesce(p_metadata->>'previousWeekDate', '')), '')::date;
  if v_anchor is not null and v_anchor >= p_as_of_date then
    raise exception 'import_refused_impossible_previous_week_date';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_historical_publications)
      as x(as_of_date date, previous_week_date date)
     where x.previous_week_date is not null and x.previous_week_date >= x.as_of_date
  ) then
    raise exception 'import_refused_impossible_previous_week_date';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_historical_publications) as x(as_of_date date)
     where x.as_of_date = p_as_of_date
  ) then
    raise exception 'import_refused_historical_publication_is_current_week';
  end if;

  v_restatements := jsonb_array_length(p_historical_publications);

  select count(*) into v_history_mutations
    from jsonb_to_recordset(p_observations) as o(disposition text)
   where o.disposition in ('new','gap_fill','changed');

  -- ---- R13.8E: measure the staged row history, once, under the import lock.
  --
  -- Set-based from here on. A first backfill is ~19,757 rows; a per-row loop
  -- would be tens of thousands of round trips inside one statement timeout, for
  -- no additional safety -- `nmi_lock_portfolio_import` already serialises every
  -- writer of this table, so there is nothing a per-row `for update` could add.
  select count(*),
         count(*) filter (where r.disposition in ('new','gap_fill')),
         count(*) filter (where r.disposition = 'changed')
    into v_staged, v_rh_new, v_rh_changed
    from public.nmi_staged_row_history(v_staging) r;

  -- A STAGING ID THAT RESOLVES TO NOTHING IS A SILENT OMISSION, NOT AN EMPTY
  -- IMPORT. The caller states how many rows it staged; if the two disagree the
  -- relay lost chunks and this import would write partial history while
  -- reporting success.
  if v_staging is not null then
    if v_declared is null then
      raise exception 'import_refused_row_history_count_missing';
    end if;
    if v_declared <> v_staged then
      raise exception 'import_refused_row_history_staging_incomplete';
    end if;
  elsif v_declared is not null and v_declared > 0 then
    raise exception 'import_refused_row_history_staging_missing';
  end if;

  if exists (
    select 1 from public.nmi_staged_row_history(v_staging)
     where disposition is null or disposition not in ('new','gap_fill','changed')
  ) then
    raise exception 'import_refused_unknown_row_history_disposition';
  end if;

  -- ---- FOLLOW-UP D: the same three checks for the performance relay. A
  --      history that arrives partially is a silent omission, and a period
  --      reconciliation built on a missing week is wrong in a way no reader
  --      could detect.
  select count(*),
         count(*) filter (where p.disposition in ('new','gap_fill')),
         count(*) filter (where p.disposition = 'changed')
    into v_perf_staged, v_ph_new, v_ph_changed
    from public.nmi_staged_performance_history(v_perf_staging) p;

  if v_perf_staging is not null then
    if v_perf_declared is null then
      raise exception 'import_refused_performance_history_count_missing';
    end if;
    if v_perf_declared <> v_perf_staged then
      raise exception 'import_refused_performance_history_staging_incomplete';
    end if;
  elsif v_perf_declared is not null and v_perf_declared > 0 then
    raise exception 'import_refused_performance_history_staging_missing';
  end if;

  if exists (
    select 1 from public.nmi_staged_performance_history(v_perf_staging)
     where disposition is null or disposition not in ('new','gap_fill','changed')
  ) then
    raise exception 'import_refused_unknown_performance_history_disposition';
  end if;

  perform public.nmi_lock_publication_series('portfolio', p_as_of_date);

  select id into v_prev_pub
    from public.portfolio_publications
   where upload_kind = 'portfolio' and as_of_date = p_as_of_date and is_current;

  v_publication_unchanged := coalesce(
    public.nmi_portfolio_publication_unchanged(v_prev_pub, p_rows, p_performance), false);

  -- R13.8E widened the no-op test a fourth time: appending row history for
  -- weeks the book has never held at row level is a real durable change, even
  -- when every level and every published figure is identical. FOLLOW-UP D
  -- widens it a fifth, for performance history, on the same reasoning -- a book
  -- that gains the weekly flows of 106 weeks it never held has changed.
  if v_history_mutations = 0 and v_publication_unchanged and v_restatements = 0
     and v_rh_new = 0 and v_rh_changed = 0
     and v_ph_new = 0 and v_ph_changed = 0 then
    raise exception 'import_refused_nothing_to_append';
  end if;

  -- AN OVERWRITE OF SETTLED HISTORY REQUIRES AUTHORIZATION AND A REASON.
  -- R13.8E added the third form (a row-history identity whose value the workbook
  -- now states differently); FOLLOW-UP D adds the fourth, at metric grain.
  -- Insertions never require it, however many.
  if v_restatements > 0
     or v_rh_changed > 0
     or v_ph_changed > 0
     or exists (
       select 1 from jsonb_to_recordset(p_observations) as o(disposition text)
        where o.disposition = 'changed'
     ) then
    if not coalesce(p_correction_authorized, false) or v_reason is null then
      raise exception 'import_refused_historical_correction_required';
    end if;
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_observations) as o(new_status text)
     where o.new_status is distinct from 'stated'
  ) then
    raise exception 'import_refused_unavailable_not_representable';
  end if;

  -- ---- R13.8E: row-history stale-plan assertions, before anything mutates.
  if exists (
    select 1
      from public.nmi_staged_row_history(v_staging) s
      join public.portfolio_row_history r
        on r.scope = s.scope
       and r.observation_date = s.observation_date
       and r.row_key = s.row_key
     where s.disposition in ('new','gap_fill')
  ) then
    raise exception 'import_refused_stale_row_history_identity_exists';
  end if;

  if exists (
    select 1
      from public.nmi_staged_row_history(v_staging) s
      left join public.portfolio_row_history r
        on r.scope = s.scope
       and r.observation_date = s.observation_date
       and r.row_key = s.row_key
     where s.disposition = 'changed' and r.id is null
  ) then
    raise exception 'import_refused_stale_row_history_identity_absent';
  end if;

  if exists (
    select 1
      from public.nmi_staged_row_history(v_staging) s
      join public.portfolio_row_history r
        on r.scope = s.scope
       and r.observation_date = s.observation_date
       and r.row_key = s.row_key
     where s.disposition = 'changed'
       and (r.value is distinct from s.prior_value
            or r.value_class is distinct from s.prior_value_class)
  ) then
    raise exception 'import_refused_stale_row_history_value_moved';
  end if;

  -- ---- FOLLOW-UP D: performance-history stale-plan assertions, before
  --      anything mutates. Identical reasoning to the row-history trio above:
  --      the plan was made against a book that may have moved since.
  if exists (
    select 1
      from public.nmi_staged_performance_history(v_perf_staging) s
      join public.portfolio_performance_history h
        on h.scope = s.scope
       and h.basis = s.basis
       and h.metric = s.metric
       and h.observation_date = s.observation_date
     where s.disposition in ('new','gap_fill')
  ) then
    raise exception 'import_refused_stale_performance_history_identity_exists';
  end if;

  if exists (
    select 1
      from public.nmi_staged_performance_history(v_perf_staging) s
      left join public.portfolio_performance_history h
        on h.scope = s.scope
       and h.basis = s.basis
       and h.metric = s.metric
       and h.observation_date = s.observation_date
     where s.disposition = 'changed' and h.id is null
  ) then
    raise exception 'import_refused_stale_performance_history_identity_absent';
  end if;

  if exists (
    select 1
      from public.nmi_staged_performance_history(v_perf_staging) s
      join public.portfolio_performance_history h
        on h.scope = s.scope
       and h.basis = s.basis
       and h.metric = s.metric
       and h.observation_date = s.observation_date
     where s.disposition = 'changed'
       and (h.value is distinct from s.prior_value
            or h.value_class is distinct from s.prior_value_class)
  ) then
    raise exception 'import_refused_stale_performance_history_value_moved';
  end if;

  insert into public.portfolio_import_operations
    (id, upload_id, upload_kind, plan_version, as_of_date, previous_publication_id,
     counts, correction_authorized, correction_reason, created_by, metadata)
  values
    (v_op_id, p_upload_id, 'portfolio', p_plan_version, p_as_of_date, v_prev_pub,
     coalesce(p_counts, '{}'::jsonb), coalesce(p_correction_authorized, false), v_reason,
     p_published_by, coalesce(p_metadata, '{}'::jsonb));

  v_pub_id := public.nmi_publish_portfolio(
    p_upload_id, p_as_of_date, p_published_by, p_parser_version,
    p_rows, p_performance, p_admin_note,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('importOperationId', v_op_id::text));

  update public.portfolio_import_operations
     set publication_id = v_pub_id
   where id = v_op_id;

  -- ---- R13.8E: apply row history. Ledger FIRST, so every before-image is the
  --      state actually standing rather than one the caller asserted.
  --
  -- IT RUNS BEFORE THE RESTATEMENTS AND THE EVOLUTION LOOP DELIBERATELY. Every
  -- stale-plan assertion above already ran, so nothing here can fail on a
  -- pre-state -- and putting the row writes EARLY means the two loops that
  -- follow are genuine late failures. That is what makes the atomicity proof
  -- non-vacuous: a restatement raising on the seventh week has to roll back
  -- ~19,757 row-history rows that were really written, not zero that never were.
  if v_staged > 0 then
    insert into public.portfolio_import_row_history_mutations
      (import_operation_id, scope, observation_date, row_key, disposition,
       prior_value, prior_value_class, prior_import_operation_id, prior_row,
       new_value, new_value_class)
    select v_op_id, s.scope, s.observation_date, s.row_key, s.disposition,
           case when s.disposition = 'changed' then r.value end,
           case when s.disposition = 'changed' then r.value_class end,
           case when s.disposition = 'changed' then r.import_operation_id end,
           case when s.disposition = 'changed' then to_jsonb(r) end,
           s.value, s.value_class
      from public.nmi_staged_row_history(v_staging) s
      left join public.portfolio_row_history r
        on r.scope = s.scope
       and r.observation_date = s.observation_date
       and r.row_key = s.row_key;

    update public.portfolio_row_history r
       set parent_row_key = s.parent_row_key,
           depth = s.depth,
           display_order = s.display_order,
           row_type = s.row_type,
           label_es = s.label_es,
           label_en = s.label_en,
           currency = coalesce(s.currency, 'USD'),
           value = s.value,
           value_class = s.value_class,
           source_upload_id = p_upload_id,
           source_sheet = s.source_sheet,
           source_cell = s.source_cell,
           source_row = s.source_row,
           parser_version = s.parser_version,
           import_operation_id = v_op_id,
           ingested_at = now()
      from public.nmi_staged_row_history(v_staging) s
     where r.scope = s.scope
       and r.observation_date = s.observation_date
       and r.row_key = s.row_key
       and s.disposition = 'changed';

    insert into public.portfolio_row_history
      (scope, observation_date, row_key, parent_row_key, depth, display_order,
       row_type, label_es, label_en, currency, value, value_class,
       source_upload_id, source_sheet, source_cell, source_row, parser_version,
       import_operation_id)
    select s.scope, s.observation_date, s.row_key, s.parent_row_key, s.depth,
           s.display_order, s.row_type, s.label_es, s.label_en,
           coalesce(s.currency, 'USD'), s.value, s.value_class,
           p_upload_id, s.source_sheet, s.source_cell, s.source_row,
           s.parser_version, v_op_id
      from public.nmi_staged_row_history(v_staging) s
     where s.disposition in ('new','gap_fill');
  end if;

  -- ---- FOLLOW-UP D: apply performance history. Ledger first, same as above,
  --      and for the same reason: a before-image asserted by the caller is not
  --      evidence of what was actually standing.
  --
  -- It sits beside row history, BEFORE the restatement and evolution loops, so
  -- the two histories commit or roll back as one thing and the loops after them
  -- remain genuinely late failures.
  if v_perf_staged > 0 then
    insert into public.portfolio_import_performance_history_mutations
      (import_operation_id, scope, basis, metric, observation_date, disposition,
       prior_value, prior_value_class, prior_import_operation_id, prior_row,
       new_value, new_value_class)
    select v_op_id, s.scope, s.basis, s.metric, s.observation_date, s.disposition,
           case when s.disposition = 'changed' then h.value end,
           case when s.disposition = 'changed' then h.value_class end,
           case when s.disposition = 'changed' then h.import_operation_id end,
           case when s.disposition = 'changed' then to_jsonb(h) end,
           s.value, s.value_class
      from public.nmi_staged_performance_history(v_perf_staging) s
      left join public.portfolio_performance_history h
        on h.scope = s.scope
       and h.basis = s.basis
       and h.metric = s.metric
       and h.observation_date = s.observation_date;

    update public.portfolio_performance_history h
       set value = s.value,
           value_class = s.value_class,
           source_upload_id = p_upload_id,
           source_sheet = s.source_sheet,
           source_cell = s.source_cell,
           source_row = s.source_row,
           parser_version = s.parser_version,
           import_operation_id = v_op_id,
           ingested_at = now()
      from public.nmi_staged_performance_history(v_perf_staging) s
     where h.scope = s.scope
       and h.basis = s.basis
       and h.metric = s.metric
       and h.observation_date = s.observation_date
       and s.disposition = 'changed';

    insert into public.portfolio_performance_history
      (scope, basis, metric, observation_date, value, value_class,
       source_upload_id, source_sheet, source_cell, source_row, parser_version,
       import_operation_id)
    select s.scope, s.basis, s.metric, s.observation_date, s.value, s.value_class,
           p_upload_id, s.source_sheet, s.source_cell, s.source_row,
           s.parser_version, v_op_id
      from public.nmi_staged_performance_history(v_perf_staging) s
     where s.disposition in ('new','gap_fill');
  end if;

  -- The relays have done their job. Deleting inside the transaction means a
  -- rollback of this import also restores the chunks, so a retry finds them
  -- intact.
  if v_staging is not null then
    delete from public.portfolio_row_history_staging where staging_id = v_staging;
  end if;
  if v_perf_staging is not null then
    delete from public.portfolio_performance_history_staging where staging_id = v_perf_staging;
  end if;


  -- ---- Historical publication corrections (R13.8D.1), each now carrying its
  --      OWN anchor dates rather than the import's.
  for h in
    select * from jsonb_to_recordset(p_historical_publications) as x(
      as_of_date date, prior_publication_id uuid,
      snapshot_rows jsonb, performance_rows jsonb, difference_count int,
      previous_week_date date, beginning_of_year_date date)
    order by x.as_of_date
  loop
    if h.as_of_date is null then
      raise exception 'import_refused_historical_publication_date_missing';
    end if;

    perform public.nmi_lock_publication_series('portfolio', h.as_of_date);

    select id into v_hist_prev
      from public.portfolio_publications
     where upload_kind = 'portfolio' and as_of_date = h.as_of_date and is_current;

    if v_hist_prev is null then
      raise exception 'import_refused_historical_publication_absent';
    end if;

    if h.prior_publication_id is distinct from v_hist_prev then
      raise exception 'import_refused_stale_historical_publication';
    end if;

    v_hist_unchanged := coalesce(
      public.nmi_portfolio_publication_unchanged(
        v_hist_prev, h.snapshot_rows, h.performance_rows), false);
    if v_hist_unchanged then
      raise exception 'import_refused_historical_publication_unchanged';
    end if;

    -- R13.8E -- THE ANCHOR FIX. The import's own `previousWeekDate` and
    -- `beginningOfYearDate` describe the week being published; stamping them
    -- onto a week two months earlier produced the impossible metadata this
    -- migration exists partly to stop. They are stripped and replaced with the
    -- restated column's own anchors, and a missing anchor stays JSON null --
    -- never a fabricated date.
    v_hist_pub := public.nmi_publish_portfolio(
      p_upload_id, h.as_of_date, p_published_by, p_parser_version,
      h.snapshot_rows, h.performance_rows, p_admin_note,
      ((coalesce(p_metadata, '{}'::jsonb) - 'previousWeekDate') - 'beginningOfYearDate')
        || jsonb_build_object(
          'importOperationId', v_op_id::text,
          'historicalRestatement', true,
          'correctionReason', v_reason,
          'previousWeekDate', to_jsonb(h.previous_week_date),
          'beginningOfYearDate', to_jsonb(h.beginning_of_year_date)));

    insert into public.portfolio_import_publication_corrections
      (import_operation_id, as_of_date, publication_id, previous_publication_id, difference_count)
    values
      (v_op_id, h.as_of_date, v_hist_pub, v_hist_prev, greatest(coalesce(h.difference_count, 0), 0));

    v_restated := v_restated + 1;
  end loop;

  -- ---- Evolution history mutations, unchanged.
  for m in
    select * from jsonb_to_recordset(p_observations) as o(
      scope text, basis text, series_identity text, observation_date date,
      disposition text, new_value numeric, new_status text,
      prior_value numeric, prior_status text,
      source_sheet text, source_cell text, source_row_label text,
      currency text, parser_version text, extractor_version text)
  loop
    if m.disposition not in ('new','gap_fill','changed') then
      raise exception 'import_refused_unknown_disposition';
    end if;

    select o.value, o.import_operation_id into v_cur_value, v_cur_import
      from public.portfolio_evolution_observations o
     where o.scope = m.scope
       and o.basis = m.basis
       and o.observation_date = m.observation_date
     for update;

    v_cur_found := found;

    if m.disposition in ('new','gap_fill') then
      if v_cur_found then
        raise exception 'import_refused_stale_plan_identity_exists';
      end if;

      insert into public.portfolio_evolution_observations
        (scope, basis, observation_date, value, currency, source_upload_id,
         source_sheet, source_cell, source_row_label, parser_version,
         extractor_version, ingested_by, import_operation_id)
      values
        (m.scope, m.basis, m.observation_date, m.new_value, coalesce(m.currency, 'USD'),
         p_upload_id, m.source_sheet, m.source_cell, m.source_row_label,
         m.parser_version, m.extractor_version, p_published_by, v_op_id);
      v_inserted := v_inserted + 1;
    else
      if not v_cur_found then
        raise exception 'import_refused_stale_plan_identity_absent';
      end if;
      if m.prior_value is distinct from v_cur_value then
        raise exception 'import_refused_stale_plan_value_moved';
      end if;

      update public.portfolio_evolution_observations
         set value = m.new_value,
             currency = coalesce(m.currency, currency),
             source_upload_id = p_upload_id,
             source_sheet = m.source_sheet,
             source_cell = m.source_cell,
             source_row_label = m.source_row_label,
             parser_version = m.parser_version,
             extractor_version = m.extractor_version,
             ingested_by = p_published_by,
             ingested_at = now(),
             import_operation_id = v_op_id
       where scope = m.scope
         and basis = m.basis
         and observation_date = m.observation_date;
      v_updated := v_updated + 1;
    end if;

    insert into public.portfolio_import_observation_mutations
      (import_operation_id, scope, basis, series_identity, observation_date,
       disposition, prior_value, prior_status, prior_import_operation_id,
       new_value, new_status)
    values
      (v_op_id, m.scope, m.basis, coalesce(m.series_identity, ''), m.observation_date,
       m.disposition,
       case when m.disposition = 'changed' then v_cur_value else null end,
       case when m.disposition = 'changed' then 'stated' else null end,
       case when m.disposition = 'changed' then v_cur_import else null end,
       m.new_value, 'stated');
  end loop;

  return jsonb_build_object(
    'importOperationId', v_op_id,
    'publicationId', v_pub_id,
    'previousPublicationId', v_prev_pub,
    'inserted', v_inserted,
    'updated', v_updated,
    'historicalPublicationsCorrected', v_restated,
    'rowHistoryInserted', v_rh_new,
    'rowHistoryChanged', v_rh_changed,
    'performanceHistoryInserted', v_ph_new,
    'performanceHistoryChanged', v_ph_changed);
end $$;

-- ===========================================================================
-- 8. Reversing an import -- now including row and performance history
-- ===========================================================================
create or replace function public.nmi_rollback_portfolio_import(
  p_import_id uuid,
  p_actor_id  uuid,
  p_note      text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_op        record;
  m           record;
  c           record;
  v_removed   int := 0;
  v_restored  int := 0;
  v_demoted   int := 0;
  v_rh_removed  int := 0;
  v_rh_restored int := 0;
  v_ph_removed  int := 0;
  v_ph_restored int := 0;
begin
  perform public.nmi_lock_portfolio_import('portfolio');

  select * into v_op from public.portfolio_import_operations where id = p_import_id;
  if not found then
    raise exception 'rollback_refused_import_not_found';
  end if;
  if v_op.rolled_back_at is not null then
    raise exception 'rollback_refused_already_rolled_back';
  end if;

  if exists (
    select 1
      from public.portfolio_import_observation_mutations mm
      join public.portfolio_evolution_observations o
        on o.scope = mm.scope
       and o.basis = mm.basis
       and o.observation_date = mm.observation_date
     where mm.import_operation_id = p_import_id
       and o.import_operation_id is distinct from p_import_id
  ) then
    raise exception 'rollback_refused_superseded_by_later_import';
  end if;

  -- R13.8E -- the same ownership test at row grain. A later import that
  -- restated one of these rows now owns it; reversing to this import's
  -- before-image would silently discard that correction.
  if exists (
    select 1
      from public.portfolio_import_row_history_mutations rm
      join public.portfolio_row_history r
        on r.scope = rm.scope
       and r.observation_date = rm.observation_date
       and r.row_key = rm.row_key
     where rm.import_operation_id = p_import_id
       and r.import_operation_id is distinct from p_import_id
  ) then
    raise exception 'rollback_refused_row_history_superseded_by_later_import';
  end if;

  -- FOLLOW-UP D -- the same ownership test at metric grain.
  if exists (
    select 1
      from public.portfolio_import_performance_history_mutations pm
      join public.portfolio_performance_history h
        on h.scope = pm.scope
       and h.basis = pm.basis
       and h.metric = pm.metric
       and h.observation_date = pm.observation_date
     where pm.import_operation_id = p_import_id
       and h.import_operation_id is distinct from p_import_id
  ) then
    raise exception 'rollback_refused_performance_history_superseded_by_later_import';
  end if;

  if v_op.publication_id is not null and not exists (
    select 1 from public.portfolio_publications
     where id = v_op.publication_id and is_current
  ) then
    raise exception 'rollback_refused_publication_not_current';
  end if;

  if exists (
    select 1
      from public.portfolio_import_publication_corrections pc
      join public.portfolio_publications p on p.id = pc.publication_id
     where pc.import_operation_id = p_import_id
       and not p.is_current
  ) then
    raise exception 'rollback_refused_historical_publication_superseded';
  end if;

  for m in
    select * from public.portfolio_import_observation_mutations
     where import_operation_id = p_import_id
  loop
    if m.disposition in ('new','gap_fill') then
      delete from public.portfolio_evolution_observations
       where scope = m.scope
         and basis = m.basis
         and observation_date = m.observation_date
         and import_operation_id = p_import_id;
      v_removed := v_removed + 1;
    else
      update public.portfolio_evolution_observations
         set value = m.prior_value,
             import_operation_id = m.prior_import_operation_id,
             ingested_at = now()
       where scope = m.scope
         and basis = m.basis
         and observation_date = m.observation_date;
      v_restored := v_restored + 1;
    end if;
  end loop;

  -- R13.8E -- row history, set-based and exact. An insertion is removed; an
  -- overwrite is restored from the WHOLE displaced row, so presentation,
  -- provenance and lineage come back together with the number.
  with removed as (
    delete from public.portfolio_row_history r
     using public.portfolio_import_row_history_mutations rm
     where rm.import_operation_id = p_import_id
       and rm.disposition in ('new','gap_fill')
       and r.scope = rm.scope
       and r.observation_date = rm.observation_date
       and r.row_key = rm.row_key
       and r.import_operation_id = p_import_id
    returning 1
  )
  select count(*) into v_rh_removed from removed;

  with restored as (
    update public.portfolio_row_history r
       set parent_row_key = (rm.prior_row->>'parent_row_key'),
           depth = (rm.prior_row->>'depth')::int,
           display_order = (rm.prior_row->>'display_order')::int,
           row_type = (rm.prior_row->>'row_type'),
           label_es = (rm.prior_row->>'label_es'),
           label_en = (rm.prior_row->>'label_en'),
           currency = coalesce(rm.prior_row->>'currency', 'USD'),
           value = rm.prior_value,
           value_class = rm.prior_value_class,
           source_upload_id = (rm.prior_row->>'source_upload_id')::uuid,
           source_sheet = (rm.prior_row->>'source_sheet'),
           source_cell = (rm.prior_row->>'source_cell'),
           source_row = (rm.prior_row->>'source_row')::int,
           parser_version = (rm.prior_row->>'parser_version'),
           import_operation_id = rm.prior_import_operation_id,
           ingested_at = now()
      from public.portfolio_import_row_history_mutations rm
     where rm.import_operation_id = p_import_id
       and rm.disposition = 'changed'
       and r.scope = rm.scope
       and r.observation_date = rm.observation_date
       and r.row_key = rm.row_key
    returning 1
  )
  select count(*) into v_rh_restored from restored;

  -- FOLLOW-UP D -- performance history, set-based and exact. An insertion is
  -- removed; an overwrite is restored from the WHOLE displaced row, so the
  -- provenance and lineage come back with the number.
  with perf_removed as (
    delete from public.portfolio_performance_history h
     using public.portfolio_import_performance_history_mutations pm
     where pm.import_operation_id = p_import_id
       and pm.disposition in ('new','gap_fill')
       and h.scope = pm.scope
       and h.basis = pm.basis
       and h.metric = pm.metric
       and h.observation_date = pm.observation_date
       and h.import_operation_id = p_import_id
    returning 1
  )
  select count(*) into v_ph_removed from perf_removed;

  with perf_restored as (
    update public.portfolio_performance_history h
       set value = pm.prior_value,
           value_class = pm.prior_value_class,
           source_upload_id = (pm.prior_row->>'source_upload_id')::uuid,
           source_sheet = (pm.prior_row->>'source_sheet'),
           source_cell = (pm.prior_row->>'source_cell'),
           source_row = (pm.prior_row->>'source_row')::int,
           parser_version = (pm.prior_row->>'parser_version'),
           import_operation_id = pm.prior_import_operation_id,
           ingested_at = now()
      from public.portfolio_import_performance_history_mutations pm
     where pm.import_operation_id = p_import_id
       and pm.disposition = 'changed'
       and h.scope = pm.scope
       and h.basis = pm.basis
       and h.metric = pm.metric
       and h.observation_date = pm.observation_date
    returning 1
  )
  select count(*) into v_ph_restored from perf_restored;

  if v_op.publication_id is not null then
    update public.portfolio_publications
       set is_current = false, superseded_by = null
     where id = v_op.publication_id;
  end if;

  if v_op.previous_publication_id is not null then
    update public.portfolio_publications
       set is_current = true,
           superseded_by = null,
           metadata = metadata || jsonb_build_object(
             'rolledBackImport', p_import_id::text,
             'rolledBackBy', p_actor_id::text)
     where id = v_op.previous_publication_id;
  end if;

  for c in
    select * from public.portfolio_import_publication_corrections
     where import_operation_id = p_import_id
     order by as_of_date
  loop
    update public.portfolio_publications
       set is_current = false, superseded_by = null
     where id = c.publication_id;

    if c.previous_publication_id is not null then
      update public.portfolio_publications
         set is_current = true,
             superseded_by = null,
             metadata = metadata || jsonb_build_object(
               'rolledBackImport', p_import_id::text,
               'rolledBackBy', p_actor_id::text)
       where id = c.previous_publication_id;
    end if;

    v_demoted := v_demoted + 1;
  end loop;

  update public.portfolio_import_operations
     set rolled_back_at = now(),
         rolled_back_by = p_actor_id,
         rollback_note = p_note
   where id = p_import_id;

  if v_op.upload_id is not null then
    perform public.nmi_sync_upload_status(v_op.upload_id);
  end if;

  return jsonb_build_object(
    'importOperationId', p_import_id,
    'observationsRemoved', v_removed,
    'observationsRestored', v_restored,
    'historicalPublicationsReverted', v_demoted,
    'rowHistoryRemoved', v_rh_removed,
    'rowHistoryRestored', v_rh_restored,
    'performanceHistoryRemoved', v_ph_removed,
    'performanceHistoryRestored', v_ph_restored,
    'promotedPublicationId', v_op.previous_publication_id);
end $$;

-- ===========================================================================
-- 9. Grants
-- ===========================================================================
revoke all on function public.nmi_import_portfolio_workbook(
  uuid, date, uuid, text, text, jsonb, jsonb, jsonb, boolean, text, jsonb, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.nmi_rollback_portfolio_import(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.nmi_import_portfolio_workbook(
  uuid, date, uuid, text, text, jsonb, jsonb, jsonb, boolean, text, jsonb, text, jsonb, jsonb)
  to service_role;
grant execute on function public.nmi_rollback_portfolio_import(uuid, uuid, text)
  to service_role;

-- ===========================================================================
-- 10. Postconditions
-- ===========================================================================
do $$
declare
  n int;
  src text;
begin
  if to_regclass('public.portfolio_row_history') is null
     or to_regclass('public.portfolio_import_row_history_mutations') is null
     or to_regclass('public.portfolio_row_history_staging') is null then
    raise exception 'R13.8E tables are missing after migration';
  end if;

  -- The canonical identity, not a looser one.
  select count(*) into n
    from pg_catalog.pg_constraint
   where conrelid = 'public.portfolio_row_history'::regclass
     and conname = 'portfolio_row_history_key'
     and contype = 'u';
  if n <> 1 then
    raise exception 'portfolio_row_history is missing its (scope, observation_date, row_key) key';
  end if;

  -- Row history is NOT a publication. These columns must never appear.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'portfolio_row_history'
       and column_name in ('is_current','revision','superseded_by','publication_id')
  ) then
    raise exception 'portfolio_row_history must not carry publication lifecycle columns';
  end if;

  -- Scope isolation is enforced by PostgreSQL, not only by the server.
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'portfolio_row_history'
       and policyname = 'portfolio_row_history_scope_select'
  ) then
    raise exception 'portfolio_row_history is missing its scope-filtered read policy';
  end if;

  if has_table_privilege('authenticated', 'public.portfolio_row_history', 'INSERT')
     or has_table_privilege('authenticated', 'public.portfolio_row_history', 'UPDATE')
     or has_table_privilege('authenticated', 'public.portfolio_row_history', 'DELETE') then
    raise exception 'authenticated gained write privileges on portfolio_row_history';
  end if;

  -- The ledger and the relay carry every scope at once and stay service-role only.
  if has_table_privilege('authenticated', 'public.portfolio_import_row_history_mutations', 'SELECT')
     or has_table_privilege('authenticated', 'public.portfolio_row_history_staging', 'SELECT') then
    raise exception 'authenticated gained read on a row-history internal table';
  end if;

  -- The staged set is resolvable STATICALLY. A temp table would have made every
  -- statement that reads it invisible to `plpgsql_check` and `supabase db lint`.
  if to_regprocedure('public.nmi_staged_row_history(uuid)') is null then
    raise exception 'nmi_staged_row_history is missing';
  end if;

  -- Exactly ONE callable import function -- no overload was left behind.
  select count(*) into n
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'nmi_import_portfolio_workbook';
  if n <> 1 then
    raise exception 'expected exactly one nmi_import_portfolio_workbook, found %', n;
  end if;

  -- The import really does write row history and really does use each restated
  -- week's own anchor.
  select pg_get_functiondef(p.oid) into src
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'nmi_import_portfolio_workbook';
  if src not like '%portfolio_row_history%' then
    raise exception 'nmi_import_portfolio_workbook does not write row history';
  end if;
  if src not like '%h.previous_week_date%' then
    raise exception 'nmi_import_portfolio_workbook does not use each restated week''s own anchor';
  end if;
  if src not like '%import_refused_impossible_previous_week_date%' then
    raise exception 'nmi_import_portfolio_workbook does not refuse an impossible anchor';
  end if;

  select pg_get_functiondef(p.oid) into src
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'nmi_rollback_portfolio_import';
  if src not like '%portfolio_import_row_history_mutations%' then
    raise exception 'nmi_rollback_portfolio_import does not reverse row history';
  end if;
  if src not like '%portfolio_import_performance_history_mutations%' then
    raise exception 'nmi_rollback_portfolio_import does not reverse performance history';
  end if;

  -- ---- FOLLOW-UP D: performance history, held to the same bar.
  if to_regclass('public.portfolio_performance_history') is null
     or to_regclass('public.portfolio_import_performance_history_mutations') is null
     or to_regclass('public.portfolio_performance_history_staging') is null then
    raise exception 'performance-history tables are missing after migration';
  end if;

  -- The canonical identity mirrors the PUBLICATION performance identity with the
  -- publication replaced by the date -- basis included, because it is part of
  -- that identity.
  select count(*) into n
    from pg_catalog.pg_constraint
   where conrelid = 'public.portfolio_performance_history'::regclass
     and conname = 'portfolio_performance_history_key'
     and contype = 'u';
  if n <> 1 then
    raise exception 'portfolio_performance_history is missing its (scope, basis, metric, observation_date) key';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'portfolio_performance_history'
       and column_name in ('is_current','revision','superseded_by','publication_id')
  ) then
    raise exception 'portfolio_performance_history must not carry publication lifecycle columns';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'portfolio_performance_history'
       and policyname = 'portfolio_performance_history_scope_select'
  ) then
    raise exception 'portfolio_performance_history is missing its scope-filtered read policy';
  end if;

  if has_table_privilege('authenticated', 'public.portfolio_performance_history', 'INSERT')
     or has_table_privilege('authenticated', 'public.portfolio_performance_history', 'UPDATE')
     or has_table_privilege('authenticated', 'public.portfolio_performance_history', 'DELETE') then
    raise exception 'authenticated gained write privileges on portfolio_performance_history';
  end if;

  if has_table_privilege('authenticated', 'public.portfolio_import_performance_history_mutations', 'SELECT')
     or has_table_privilege('authenticated', 'public.portfolio_performance_history_staging', 'SELECT') then
    raise exception 'authenticated gained read on a performance-history internal table';
  end if;

  if to_regprocedure('public.nmi_staged_performance_history(uuid)') is null then
    raise exception 'nmi_staged_performance_history is missing';
  end if;

  select pg_get_functiondef(p.oid) into src
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'nmi_import_portfolio_workbook';
  if src not like '%portfolio_performance_history%' then
    raise exception 'nmi_import_portfolio_workbook does not write performance history';
  end if;
end $$;
