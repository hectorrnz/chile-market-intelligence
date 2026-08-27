-- R13.4 — Alternatives holdings and events (doc 05 § 5.4, doc 08 Stage 4).
--
-- Forward-only and idempotent, in the style of 20260806/07/08000000. Every
-- guarantee is re-asserted by postcondition blocks that `raise exception`.
--
-- SCOPE. Alternatives are SHARED: doc 05 § 2.3's access matrix gives every
-- principal — and the administrator — the `alternatives` scope. Both tables
-- therefore carry a fixed `scope = 'alternatives'` and read through the same
-- R13.1 helper as every other R13 table, so the entitlement model has exactly
-- one implementation. A caller with no scopes at all still sees nothing.
--
-- CURRENCY IS PART OF THE GRAIN, NOT A LABEL (doc 03 § 2.1). The sheet is
-- multi-currency and `Real Assets` appears three times in three currencies, so
-- `(category, currency)` is the grouping key. `currency` is NOT NULL precisely
-- so a row can never lose the denomination of its own amounts, and no
-- cross-currency total can be assembled by accident (doc 03 § 4.2).

do $$
begin
  if to_regprocedure('public.nmi_can_access_scope(text)') is null then
    raise exception 'public.nmi_can_access_scope(text) is missing — apply R13.1 before R13.4';
  end if;
  if to_regclass('public.portfolio_publications') is null then
    raise exception 'public.portfolio_publications is missing — apply R13.3 before R13.4';
  end if;
end $$;

-- ── 1. Holdings — grain is (investment × sociedad) (doc 03 § 2.2) ─────────────
create table if not exists public.alternatives_holdings (
  id                    uuid primary key default gen_random_uuid(),
  publication_id        uuid not null references public.portfolio_publications(id) on delete cascade,
  scope                 text not null default 'alternatives' check (scope = 'alternatives'),
  as_of_date            date not null,
  category              text not null,
  currency              text not null,
  investment_name       text not null,
  sociedad              text not null,
  capital_committed     numeric,
  contributions         numeric,
  unfunded              numeric,
  last_statement_date   date,
  -- Column G may carry the literal `Inversión Inicial` instead of a date; it is
  -- preserved verbatim rather than coerced into a fabricated date.
  last_statement_label  text,
  last_valuation        numeric,
  flow_since_statement  numeric,
  current_value         numeric,
  reported_irr          numeric,
  -- Cached source value only. Excel's IRR is an iterative solver and is never
  -- re-run server-side in R13 (doc 03 § 4.1).
  calculated_irr        numeric,
  source_sheet          text not null,
  source_row            int  not null,
  source_cell           text not null,
  metadata              jsonb not null default '{}'::jsonb,
  constraint alternatives_holdings_grain_key
    unique (publication_id, category, currency, investment_name, sociedad)
);

create index if not exists alternatives_holdings_group_idx
  on public.alternatives_holdings (publication_id, category, currency);

comment on table public.alternatives_holdings is
  'R13.4 — alternatives master data at (investment x sociedad) grain. `currency` is part of the '
  'grouping key and is NOT NULL: amounts are denominated in their category header''s currency, never '
  'USD, and no cross-currency total is ever derived (doc 03 § 4.2).';

-- ── 2. Events — the coloured timeline (doc 03 § 3) ────────────────────────────
--
-- `raw_fill` preserves the fill EXACTLY as stored (`rgb:FF002060`,
-- `theme:3@0.4`) alongside the resolved hex, so a future re-classification can
-- be re-derived from the source rather than from our interpretation of it.
create table if not exists public.alternatives_events (
  id                     uuid primary key default gen_random_uuid(),
  publication_id         uuid not null references public.portfolio_publications(id) on delete cascade,
  holding_id             uuid references public.alternatives_holdings(id) on delete cascade,
  scope                  text not null default 'alternatives' check (scope = 'alternatives'),
  event_date             date not null,
  amount                 numeric not null,
  currency               text not null,
  event_type             text not null check (event_type in
                           ('aporte','dividendo','distribucion','unclassified')),
  raw_fill               text,
  resolved_hex           text,
  classification_method  text check (classification_method in
                           ('legend_exact','legend_family','administrator')),
  source_sheet           text not null,
  source_cell            text not null,
  source_row             int  not null,
  metadata               jsonb not null default '{}'::jsonb,
  -- An unclassified event has, by definition, no classification method yet; any
  -- classified event must record HOW it was classified, so provenance can never
  -- be silently absent.
  constraint alternatives_events_method_check check (
    (event_type = 'unclassified' and classification_method is null)
    or (event_type <> 'unclassified' and classification_method is not null)
  )
);

create index if not exists alternatives_events_holding_idx
  on public.alternatives_events (holding_id, event_date);
create index if not exists alternatives_events_unclassified_idx
  on public.alternatives_events (publication_id) where event_type = 'unclassified';

comment on table public.alternatives_events is
  'R13.4 — timeline cash-flow events classified from the workbook''s own legend. '
  'event_type = unclassified blocks publication of that holding''s event history until an '
  'administrator classifies it (doc 03 § 3.4); it is never silently assigned a type.';

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
alter table public.alternatives_holdings enable row level security;
alter table public.alternatives_events   enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('alternatives_holdings','alternatives_events')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "alternatives_holdings_scope_select"
  on public.alternatives_holdings
  for select to authenticated
  using (public.nmi_can_access_scope(scope));

create policy "alternatives_events_scope_select"
  on public.alternatives_events
  for select to authenticated
  using (public.nmi_can_access_scope(scope));

revoke all privileges on table public.alternatives_holdings from public, anon, authenticated;
revoke all privileges on table public.alternatives_events   from public, anon, authenticated;
grant select on table public.alternatives_holdings to authenticated;
grant select on table public.alternatives_events   to authenticated;
grant all privileges on table public.alternatives_holdings to service_role;
grant all privileges on table public.alternatives_events   to service_role;

-- ── 4. Postconditions ─────────────────────────────────────────────────────────

do $$
declare
  def text;
begin
  if to_regclass('public.alternatives_holdings') is null
     or to_regclass('public.alternatives_events') is null then
    raise exception 'the R13.4 tables were not created';
  end if;

  -- Currency must be mandatory on BOTH tables: a nullable currency would let a
  -- row lose its denomination and make a cross-currency sum possible.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('alternatives_holdings','alternatives_events')
      and column_name = 'currency' and is_nullable = 'YES'
  ) then
    raise exception 'currency must be NOT NULL — a row must never lose its denomination';
  end if;

  -- Provenance is mandatory.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'alternatives_events'
      and column_name in ('source_sheet','source_cell') and is_nullable = 'YES'
  ) then
    raise exception 'alternatives_events provenance columns must be NOT NULL';
  end if;

  select pg_get_constraintdef(oid) into def
  from pg_catalog.pg_constraint
  where conrelid = 'public.alternatives_events'::regclass
    and contype = 'c' and pg_get_constraintdef(oid) like '%event_type%'
    and pg_get_constraintdef(oid) like '%aporte%';
  if def is null then
    raise exception 'the event_type CHECK is missing';
  end if;
  if def not like '%unclassified%' then
    raise exception 'event_type must be able to represent unclassified: %', def;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'alternatives_holdings_grain_key' and contype = 'u'
  ) then
    raise exception 'the (investment x sociedad) grain constraint is missing — a holding could be ingested twice';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'alternatives_events_method_check'
  ) then
    raise exception 'the classification-method constraint is missing — a classified event could lack provenance';
  end if;
end $$;

do $$
declare
  t    text;
  n    int;
  q    text;
  priv text;
begin
  foreach t in array array['alternatives_holdings','alternatives_events'] loop
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
      raise exception 'a non-SELECT policy exists on % — ingestion must remain service-role only', t;
    end if;

    select qual into q from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = t limit 1;
    if q is null or q not like '%nmi_can_access_scope%' then
      raise exception '%''s read policy does not use nmi_can_access_scope: %', t, coalesce(q, '(null)');
    end if;

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
      raise exception 'service_role cannot INSERT into %', t;
    end if;
  end loop;
end $$;

-- Earlier stages' posture is untouched.
do $$
begin
  if has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE') then
    raise exception 'authenticated gained UPDATE on user_profiles — R13.1 posture broken';
  end if;
  if has_table_privilege('authenticated', 'public.portfolio_snapshot_rows', 'INSERT') then
    raise exception 'authenticated gained INSERT on portfolio_snapshot_rows — R13.3 posture broken';
  end if;
end $$;
