-- R13.3 — Family Portfolio snapshot, performance and publication spine.
--
-- Creates the three tables doc 08 Stage 3 names: `portfolio_publications`
-- (doc 05 § 5.1), `portfolio_snapshot_rows` (§ 5.2) and
-- `portfolio_performance_rows` (§ 5.3).
--
-- Forward-only and idempotent, in the style of 20260806000000 / 20260807000000.
-- Every guarantee is re-asserted by postcondition blocks that `raise exception`.
--
-- POSTURE — this is the FIRST R13 table set that carries client-visible
-- financial data, so the scope predicate matters more here than anywhere else:
--
--   * `portfolio_snapshot_rows` and `portfolio_performance_rows` each carry
--     `scope`, and their SELECT policy resolves it through the R13.1 helper
--     `public.nmi_can_access_scope(scope)`. A caller therefore sees Main plus
--     their OWN principal's rows and nothing else — enforced by PostgreSQL, not
--     by a route filter (doc 05 § 2.1 layer 1).
--   * No insert/update/delete policy exists for `authenticated` on any of the
--     three tables. Publication is a service-role operation performed after a
--     server-side administrator check.
--   * `portfolio_publications` is administrator-read only: it is operational
--     metadata (who published what, when, which revision), not portfolio data.
--
-- ATOMICITY (doc 05 § 6): exactly one `is_current` publication per
-- (upload_kind, as_of_date), enforced by a PARTIAL UNIQUE INDEX. Readers
-- resolve rows through `is_current`, so an in-progress write is invisible and a
-- published week is never partially replaced. Rollback flips the flag;
-- NOTHING IS EVER DELETED.

-- ── Guard: R13.1 and R13.2 must already be applied ────────────────────────────
do $$
begin
  if to_regprocedure('public.nmi_can_access_scope(text)') is null then
    raise exception 'public.nmi_can_access_scope(text) is missing — apply the R13.1 entitlement migration before R13.3';
  end if;
  if to_regclass('public.portfolio_source_uploads') is null then
    raise exception 'public.portfolio_source_uploads is missing — apply the R13.2 upload migration before R13.3';
  end if;
end $$;

-- ── 1. Publications (doc 05 § 5.1) ────────────────────────────────────────────
create table if not exists public.portfolio_publications (
  id             uuid primary key default gen_random_uuid(),
  upload_id      uuid        not null references public.portfolio_source_uploads(id) on delete restrict,
  upload_kind    text        not null check (upload_kind in ('portfolio', 'alternatives')),
  as_of_date     date        not null,
  revision       int         not null default 1 check (revision >= 1),
  published_by   uuid        not null references auth.users(id) on delete restrict,
  published_at   timestamptz not null default now(),
  is_current     boolean     not null default true,
  superseded_by  uuid        references public.portfolio_publications(id) on delete restrict,
  admin_note     text,
  -- The parser build that produced this publication's rows. REQUIRED: a later
  -- parser change must be attributable, and two publications of the same week
  -- produced by different parser versions must be distinguishable.
  parser_version text        not null,
  metadata       jsonb       not null default '{}'::jsonb,
  constraint portfolio_publications_revision_key unique (upload_kind, as_of_date, revision)
);

-- Additive for a re-run against a database created before parser_version existed.
alter table public.portfolio_publications
  add column if not exists parser_version text;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'portfolio_publications'
      and column_name = 'parser_version' and is_nullable = 'YES'
  ) then
    update public.portfolio_publications set parser_version = 'unknown' where parser_version is null;
    alter table public.portfolio_publications alter column parser_version set not null;
  end if;
end $$;

-- Exactly one current publication per (kind, date). A partial unique index is
-- what makes "atomic swap" possible without a transaction across statements.
create unique index if not exists portfolio_publications_current_idx
  on public.portfolio_publications (upload_kind, as_of_date)
  where is_current;

comment on table public.portfolio_publications is
  'R13.3 — immutable publication ledger. Exactly one is_current row per (upload_kind, as_of_date); '
  'a re-publish creates a new revision and supersedes the prior one. Nothing is ever deleted.';

-- ── 2. Snapshot rows (doc 05 § 5.2) ───────────────────────────────────────────
--
-- Beginning-of-year / previous / this-week / difference are deliberately NOT
-- columns. Each published week is its own snapshot and the four-column view is
-- assembled at read time from up to three snapshots plus one NMI-derived
-- difference — which is what lets the historical-week selector work with no
-- reshaping.
--
-- `value` is NULL when genuinely unavailable, NEVER 0 (doc 02 § 9). A leaf with
-- no beginning-of-year baseline is unavailable, not zero, and a zero would
-- produce a meaningless or infinite YTD return.
create table if not exists public.portfolio_snapshot_rows (
  id              uuid primary key default gen_random_uuid(),
  publication_id  uuid not null references public.portfolio_publications(id) on delete cascade,
  scope           text not null check (scope in ('main', 'jaime', 'andres', 'pablo')),
  as_of_date      date not null,
  row_key         text not null,
  parent_row_key  text,
  depth           int  not null check (depth >= 0),
  display_order   int  not null,
  row_type        text not null check (row_type in
                    ('group_header','asset_class','sub_asset_class','sociedad_header',
                     'individual_asset','sociedad_subtotal','portfolio_subtotal','portfolio_total',
                     'named_holding','flow','performance')),
  label_es        text not null,
  label_en        text,
  currency        text not null default 'USD',
  value           numeric,
  value_class     text not null check (value_class in
                    ('source_value','source_provided_return','source_provided_flow',
                     'nmi_calculated','unavailable','not_reproducible')),
  source_sheet    text not null,
  source_cell     text not null,
  metadata        jsonb not null default '{}'::jsonb,
  constraint portfolio_snapshot_rows_key_unique unique (publication_id, scope, row_key)
);

create index if not exists portfolio_snapshot_rows_scope_idx
  on public.portfolio_snapshot_rows (scope, as_of_date);
create index if not exists portfolio_snapshot_rows_publication_idx
  on public.portfolio_snapshot_rows (publication_id);

comment on column public.portfolio_snapshot_rows.row_key is
  'Stable slug derived from the normalized LABEL PATH, never the source row number — an inserted row '
  'must not re-key every sibling and destroy week-over-week comparability. The observed source row is '
  'kept in metadata for audit only.';

comment on column public.portfolio_snapshot_rows.value is
  'NULL means genuinely unavailable and is never 0. A leaf with no beginning-of-year baseline stays '
  'NULL so its YTD comparison is suppressed rather than computed off a fabricated zero.';

-- ── 3. Performance rows (doc 05 § 5.3) ────────────────────────────────────────
--
-- Stored as SOURCE-PROVIDED values. NMI's independent recomputation lives
-- alongside in `metadata` as a cross-check and NEVER replaces the source figure
-- (doc 04 § 7: a source_provided_return is never silently recomputed and shown
-- as though NMI derived it).
create table if not exists public.portfolio_performance_rows (
  id              uuid primary key default gen_random_uuid(),
  publication_id  uuid not null references public.portfolio_publications(id) on delete cascade,
  scope           text not null check (scope in ('main', 'jaime', 'andres', 'pablo')),
  as_of_date      date not null,
  basis           text not null check (basis in ('ex_chilean_equities','with_chilean_equities','total')),
  metric          text not null check (metric in
                    ('flow','weekly_profit','weekly_return','ytd_profit','ytd_return')),
  value           numeric,
  value_class     text not null check (value_class in
                    ('source_value','source_provided_return','source_provided_flow',
                     'nmi_calculated','unavailable','not_reproducible')),
  source_sheet    text not null,
  source_cell     text not null,
  metadata        jsonb not null default '{}'::jsonb,
  constraint portfolio_performance_rows_unique unique (publication_id, scope, basis, metric)
);

create index if not exists portfolio_performance_rows_scope_idx
  on public.portfolio_performance_rows (scope, as_of_date);

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
alter table public.portfolio_publications      enable row level security;
alter table public.portfolio_snapshot_rows     enable row level security;
alter table public.portfolio_performance_rows  enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('portfolio_publications','portfolio_snapshot_rows','portfolio_performance_rows')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- Scope-filtered read. Both authorization dimensions are read from the caller's
-- OWN profile row inside the helper, so the database reaches the same verdict as
-- the server with no trust in anything the client sends. A caller with no
-- profile row is denied by construction.
create policy "portfolio_snapshot_rows_scope_select"
  on public.portfolio_snapshot_rows
  for select to authenticated
  using (public.nmi_can_access_scope(scope));

create policy "portfolio_performance_rows_scope_select"
  on public.portfolio_performance_rows
  for select to authenticated
  using (public.nmi_can_access_scope(scope));

-- Operational metadata: administrators only.
create policy "portfolio_publications_admin_select"
  on public.portfolio_publications
  for select to authenticated
  using (public.nmi_is_administrator());

revoke all privileges on table public.portfolio_publications     from public, anon, authenticated;
revoke all privileges on table public.portfolio_snapshot_rows    from public, anon, authenticated;
revoke all privileges on table public.portfolio_performance_rows from public, anon, authenticated;
grant select on table public.portfolio_publications     to authenticated;
grant select on table public.portfolio_snapshot_rows    to authenticated;
grant select on table public.portfolio_performance_rows to authenticated;
grant all privileges on table public.portfolio_publications     to service_role;
grant all privileges on table public.portfolio_snapshot_rows    to service_role;
grant all privileges on table public.portfolio_performance_rows to service_role;

-- ── 5. Postconditions ─────────────────────────────────────────────────────────

-- 5a. Tables and the atomicity index exist.
do $$
declare
  def text;
begin
  if to_regclass('public.portfolio_publications') is null
     or to_regclass('public.portfolio_snapshot_rows') is null
     or to_regclass('public.portfolio_performance_rows') is null then
    raise exception 'one or more R13.3 tables were not created';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'portfolio_publications_current_idx'
  ) then
    raise exception 'the partial unique index enforcing one current publication is missing — '
                    'a week could be published twice concurrently';
  end if;

  -- Provenance and parser attribution are NOT optional.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'portfolio_publications'
      and column_name = 'parser_version' and is_nullable = 'YES'
  ) then
    raise exception 'portfolio_publications.parser_version must be NOT NULL';
  end if;

  for def in
    select unnest(array['source_sheet','source_cell'])
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'portfolio_snapshot_rows'
        and column_name = def and is_nullable = 'YES'
    ) then
      raise exception 'portfolio_snapshot_rows.% must be NOT NULL — provenance is mandatory', def;
    end if;
  end loop;
end $$;

-- 5a-bis. The schema must be able to REPRESENT the full documented hierarchy
-- and both Main performance bases. A CHECK that silently omits one of these
-- would make a correct parser unpersistable.
do $$
declare
  def text;
begin
  select pg_get_constraintdef(oid) into def
  from pg_catalog.pg_constraint
  where conrelid = 'public.portfolio_snapshot_rows'::regclass
    and contype = 'c' and pg_get_constraintdef(oid) like '%row_type%';
  if def is null then
    raise exception 'the row_type CHECK is missing';
  end if;
  if def not like '%sub_asset_class%' then
    raise exception 'row_type CHECK cannot represent sub_asset_class: %', def;
  end if;
  if def not like '%sociedad_header%' or def not like '%individual_asset%' then
    raise exception 'row_type CHECK cannot represent the alternatives hierarchy: %', def;
  end if;

  select pg_get_constraintdef(oid) into def
  from pg_catalog.pg_constraint
  where conrelid = 'public.portfolio_performance_rows'::regclass
    and contype = 'c' and pg_get_constraintdef(oid) like '%basis%';
  if def is null then
    raise exception 'the performance basis CHECK is missing';
  end if;
  if def not like '%ex_chilean_equities%' or def not like '%with_chilean_equities%' or def not like '%total%' then
    raise exception 'the basis CHECK cannot represent both Main bases plus total: %', def;
  end if;
end $$;

-- 5b. RLS on, read-only policies, and the scope predicate actually used.
do $$
declare
  t   text;
  n   int;
  bad text;
begin
  foreach t in array array['portfolio_publications','portfolio_snapshot_rows','portfolio_performance_rows'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'row level security is not enabled on %', t;
    end if;

    select count(*) into n from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = t;
    if n <> 1 then
      raise exception 'expected exactly one policy on %, found %', t, n;
    end if;

    if exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = t and cmd <> 'SELECT'
    ) then
      raise exception 'a non-SELECT policy exists on % — publication must remain service-role only', t;
    end if;
  end loop;

  -- The data tables MUST filter by scope, not merely by administrator status:
  -- a principal-scoped read is the entire point of the entitlement model.
  for t in select unnest(array['portfolio_snapshot_rows','portfolio_performance_rows']) loop
    select qual into bad from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = t limit 1;
    if bad is null or bad not like '%nmi_can_access_scope%' then
      raise exception '%''s read policy does not use nmi_can_access_scope: %', t, coalesce(bad, '(null)');
    end if;
  end loop;
end $$;

-- 5c. Effective privileges.
do $$
declare
  t    text;
  priv text;
begin
  foreach t in array array['portfolio_publications','portfolio_snapshot_rows','portfolio_performance_rows'] loop
    foreach priv in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('authenticated', format('public.%I', t), priv) then
        raise exception 'authenticated holds EFFECTIVE % on %', priv, t;
      end if;
    end loop;
    foreach priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege('anon', format('public.%I', t), priv) then
        raise exception 'anon holds EFFECTIVE % on %', priv, t;
      end if;
    end loop;
    if not has_table_privilege('service_role', format('public.%I', t), 'INSERT') then
      raise exception 'service_role cannot INSERT into % — publication would fail closed', t;
    end if;
  end loop;
end $$;

-- 5d. R13.1/R13.2 posture untouched.
do $$
begin
  if has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE') then
    raise exception 'authenticated gained UPDATE on user_profiles — self-elevation must remain impossible';
  end if;
  if has_table_privilege('authenticated', 'public.portfolio_source_uploads', 'INSERT') then
    raise exception 'authenticated gained INSERT on portfolio_source_uploads — R13.2 posture broken';
  end if;
end $$;
