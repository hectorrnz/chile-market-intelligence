-- Phase 9A — Structured Notes Foundation
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.
--
-- Internal/private structured-note tracking (replaces the legacy
-- "NUEVA BASE - Notas Estructuradas.xlsx" operating model). All tables are
-- strictly user-scoped (no org model exists yet) — no public read/write.
-- Notes, underlyings, barriers, coupon/autocall schedules, internal
-- allocations, live-price snapshots, and PDF-extraction provenance.
--
-- Automation-first: the note carries source_type/provenance/confidence so an
-- automated PDF-extraction pipeline (Phase 9A+) is the primary write path;
-- manual entry is only an interim/override bridge.

-- ── structured_notes ────────────────────────────────────────────────────────────
create table if not exists structured_notes (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,
  isin                   text,
  product_name           text not null,
  issuer_name            text,
  issuer_display_name    text,
  guarantor_name         text,
  structure_type         text not null,
  payoff_type            text,
  currency               text not null default 'USD',
  issue_size             numeric,
  denomination           numeric,
  issue_price_pct        numeric,
  trade_date             date,
  issue_date             date,
  initial_valuation_date date,
  final_valuation_date   date,
  maturity_date          date,
  redemption_date        date,
  coupon_frequency       text,
  coupon_rate_periodic   numeric,
  coupon_rate_annualized numeric,
  memory_coupon          boolean not null default false,
  principal_protection   boolean not null default false,
  knock_in_barrier_pct   numeric,
  coupon_barrier_pct     numeric,
  autocall_barrier_pct   numeric,
  status                 text not null default 'active',
  source_type            text not null default 'pdf_extraction',
  source_name            text,
  source_file_name       text,
  source_file_hash       text,
  source_url             text,
  extraction_run_id      uuid,
  confidence_score       numeric,
  metadata               jsonb not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- ISIN is unique per user (two users could each track the same ISIN)
  unique (user_id, isin)
);

do $$ begin
  alter table structured_notes
    add constraint structured_notes_status_check
    check (status in ('active','autocalled','matured','defaulted','cancelled','draft'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table structured_notes
    add constraint structured_notes_source_type_check
    check (source_type in ('pdf_extraction','manual','vendor_feed','import'));
exception when duplicate_object then null; end $$;

-- ── structured_note_underlyings ─────────────────────────────────────────────────
create table if not exists structured_note_underlyings (
  id                     uuid primary key default gen_random_uuid(),
  note_id                uuid not null references structured_notes(id) on delete cascade,
  user_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,
  underlying_order       integer not null,
  underlying_name        text not null,
  source_ticker          text,
  bloomberg_ticker       text,
  yahoo_symbol           text,
  asset_class            text not null default 'index',
  initial_level          numeric,
  strike_level           numeric,
  knock_in_barrier_level numeric,
  coupon_barrier_level   numeric,
  autocall_barrier_level numeric,
  knock_in_barrier_pct   numeric,
  coupon_barrier_pct     numeric,
  autocall_barrier_pct   numeric,
  metadata               jsonb not null default '{}',
  created_at             timestamptz not null default now(),
  unique (note_id, underlying_order)
);

-- ── structured_note_observations ────────────────────────────────────────────────
create table if not exists structured_note_observations (
  id                  uuid primary key default gen_random_uuid(),
  note_id             uuid not null references structured_notes(id) on delete cascade,
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  observation_number  integer not null,
  observation_type    text not null,
  valuation_date      date not null,
  payment_date        date,
  redemption_date     date,
  coupon_due_pct      numeric,
  autocall_barrier_pct numeric,
  coupon_barrier_pct  numeric,
  status              text not null default 'scheduled',
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (note_id, observation_type, observation_number)
);

do $$ begin
  alter table structured_note_observations
    add constraint sn_observation_type_check
    check (observation_type in ('coupon','autocall','final'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table structured_note_observations
    add constraint sn_observation_status_check
    check (status in ('scheduled','observed','coupon_paid','coupon_missed','autocalled','matured','cancelled'));
exception when duplicate_object then null; end $$;

-- ── structured_note_allocations (internal — never from PDF) ──────────────────────
create table if not exists structured_note_allocations (
  id              uuid primary key default gen_random_uuid(),
  note_id         uuid not null references structured_notes(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity_name     text not null,
  custodian       text,
  notional_amount numeric not null,
  currency        text not null default 'USD',
  active          boolean not null default true,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── structured_note_price_snapshots (Yahoo overlay — replaces Bloomberg BDP) ─────
create table if not exists structured_note_price_snapshots (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references structured_notes(id) on delete cascade,
  underlying_id uuid not null references structured_note_underlyings(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  price_date    date not null,
  price         numeric,
  source        text not null,
  source_symbol text,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  unique (underlying_id, price_date, source)
);

-- ── structured_note_extraction_runs ─────────────────────────────────────────────
create table if not exists structured_note_extraction_runs (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_name             text,
  file_hash             text,
  parser_version        text,
  status                text not null,
  extracted_note_id     uuid references structured_notes(id) on delete set null,
  confidence_score      numeric,
  fields_seen           integer,
  fields_extracted      integer,
  fields_low_confidence integer,
  warnings              jsonb not null default '[]',
  errors                jsonb not null default '[]',
  extracted_payload     jsonb,
  provenance            jsonb not null default '{}',
  created_at            timestamptz not null default now()
);

-- ── structured_note_extracted_fields ────────────────────────────────────────────
create table if not exists structured_note_extracted_fields (
  id                uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references structured_note_extraction_runs(id) on delete cascade,
  note_id           uuid references structured_notes(id) on delete cascade,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  field_path        text not null,
  extracted_value   text,
  normalized_value  text,
  confidence        numeric,
  source_page       integer,
  source_section    text,
  raw_excerpt       text,
  warning           text,
  created_at        timestamptz not null default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────────
create index if not exists structured_notes_user_idx              on structured_notes (user_id);
create index if not exists structured_notes_isin_idx              on structured_notes (isin);
create index if not exists structured_notes_status_idx            on structured_notes (status);
create index if not exists sn_underlyings_note_idx                on structured_note_underlyings (note_id);
create index if not exists sn_underlyings_user_idx                on structured_note_underlyings (user_id);
create index if not exists sn_observations_note_idx               on structured_note_observations (note_id);
create index if not exists sn_observations_user_idx               on structured_note_observations (user_id);
create index if not exists sn_observations_valdate_idx            on structured_note_observations (valuation_date);
create index if not exists sn_allocations_note_idx                on structured_note_allocations (note_id);
create index if not exists sn_allocations_user_idx                on structured_note_allocations (user_id);
create index if not exists sn_price_snapshots_underlying_idx      on structured_note_price_snapshots (underlying_id);
create index if not exists sn_price_snapshots_user_idx            on structured_note_price_snapshots (user_id);
create index if not exists sn_extraction_runs_user_idx            on structured_note_extraction_runs (user_id);
create index if not exists sn_extracted_fields_run_idx            on structured_note_extracted_fields (extraction_run_id);
create index if not exists sn_extracted_fields_user_idx           on structured_note_extracted_fields (user_id);

-- ── updated_at triggers (reuses set_updated_at() from the 6A migration) ─────────
drop trigger if exists set_structured_notes_updated_at on structured_notes;
create trigger set_structured_notes_updated_at
  before update on structured_notes
  for each row execute function set_updated_at();

drop trigger if exists set_sn_observations_updated_at on structured_note_observations;
create trigger set_sn_observations_updated_at
  before update on structured_note_observations
  for each row execute function set_updated_at();

drop trigger if exists set_sn_allocations_updated_at on structured_note_allocations;
create trigger set_sn_allocations_updated_at
  before update on structured_note_allocations
  for each row execute function set_updated_at();

-- ── Ownership-guard trigger for child tables ────────────────────────────────────
-- RLS checks the row's own user_id; this trigger additionally verifies the
-- referenced parent note belongs to the same user (RLS can't validate a
-- cross-table FK). Mirrors the 6D check_portfolio_ownership() pattern.
create or replace function check_structured_note_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select user_id into owner from structured_notes where id = new.note_id;
  if owner is null then
    raise exception 'structured note % not found', new.note_id;
  end if;
  if owner <> new.user_id then
    raise exception 'structured note % does not belong to user %', new.note_id, new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists guard_sn_underlyings_owner on structured_note_underlyings;
create trigger guard_sn_underlyings_owner
  before insert or update on structured_note_underlyings
  for each row execute function check_structured_note_ownership();

drop trigger if exists guard_sn_observations_owner on structured_note_observations;
create trigger guard_sn_observations_owner
  before insert or update on structured_note_observations
  for each row execute function check_structured_note_ownership();

drop trigger if exists guard_sn_allocations_owner on structured_note_allocations;
create trigger guard_sn_allocations_owner
  before insert or update on structured_note_allocations
  for each row execute function check_structured_note_ownership();

drop trigger if exists guard_sn_price_snapshots_owner on structured_note_price_snapshots;
create trigger guard_sn_price_snapshots_owner
  before insert or update on structured_note_price_snapshots
  for each row execute function check_structured_note_ownership();

-- ── RLS ─────────────────────────────────────────────────────────────────────────
alter table structured_notes                 enable row level security;
alter table structured_note_underlyings      enable row level security;
alter table structured_note_observations     enable row level security;
alter table structured_note_allocations      enable row level security;
alter table structured_note_price_snapshots  enable row level security;
alter table structured_note_extraction_runs  enable row level security;
alter table structured_note_extracted_fields enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'structured_notes','structured_note_underlyings','structured_note_observations',
    'structured_note_allocations','structured_note_price_snapshots',
    'structured_note_extraction_runs','structured_note_extracted_fields'
  ]
  loop
    execute format('drop policy if exists "sn_own_select" on %I', t);
    execute format('drop policy if exists "sn_own_insert" on %I', t);
    execute format('drop policy if exists "sn_own_update" on %I', t);
    execute format('drop policy if exists "sn_own_delete" on %I', t);
    execute format('create policy "sn_own_select" on %I for select using (auth.uid() = user_id)', t);
    execute format('create policy "sn_own_insert" on %I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "sn_own_update" on %I for update using (auth.uid() = user_id)', t);
    execute format('create policy "sn_own_delete" on %I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;
