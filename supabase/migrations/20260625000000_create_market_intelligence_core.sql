-- Phase 5B: Chile Market Intelligence — core schema
-- Provision 11 tables covering all data domains.
-- All tables have RLS enabled; no public write policies until Phase 6 auth.
-- Generated: 2026-06-25

-- ─── Shared: updated_at trigger ──────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── 1. data_sources ─────────────────────────────────────────────────────────
-- Registry of upstream data providers (BCCh, CMF, Brain Data, static).
create table if not exists data_sources (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,
  source_type     text not null,         -- 'api' | 'scrape' | 'static' | 'manual'
  display_name    text not null,
  base_url        text,
  status          text not null default 'inactive', -- 'active' | 'inactive' | 'error'
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table data_sources enable row level security;
create policy "data_sources: anon read" on data_sources for select using (true);

create trigger data_sources_updated_at
  before update on data_sources
  for each row execute function set_updated_at();

-- ─── 2. companies ────────────────────────────────────────────────────────────
create table if not exists companies (
  id              uuid primary key default gen_random_uuid(),
  ticker          text not null unique,
  name            text not null,
  legal_name      text,
  sector          text,
  industry        text,
  exchange        text,
  currency        text default 'CLP',
  country         text not null default 'CL',
  website         text,
  cmf_rut         text,
  cmf_entity_url  text,
  active          boolean not null default true,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table companies enable row level security;
create policy "companies: anon read" on companies for select using (true);

create trigger companies_updated_at
  before update on companies
  for each row execute function set_updated_at();

create index if not exists companies_ticker_idx on companies (ticker);
create index if not exists companies_sector_idx on companies (sector);

-- ─── 3. macro_indicators ─────────────────────────────────────────────────────
create table if not exists macro_indicators (
  id                   text primary key,  -- matches macroSeries.ts id (e.g. 'tpm')
  region               text not null default 'CL',
  name                 text not null,
  short_name           text,
  category             text,
  unit                 text,
  source_provider      text,              -- 'bcch' | 'static'
  provider_series_code text,
  transformation       text,             -- 'yoy' | null
  live_enabled         boolean not null default false,
  metadata             jsonb not null default '{}',
  updated_at           timestamptz not null default now()
);

alter table macro_indicators enable row level security;
create policy "macro_indicators: anon read" on macro_indicators for select using (true);

create trigger macro_indicators_updated_at
  before update on macro_indicators
  for each row execute function set_updated_at();

-- ─── 4. macro_observations ───────────────────────────────────────────────────
create table if not exists macro_observations (
  id                  uuid primary key default gen_random_uuid(),
  indicator_id        text references macro_indicators(id) on delete set null,
  observation_date    date not null,
  value               numeric,
  source_provider     text,
  source_series_code  text,
  fetched_at          timestamptz not null default now(),
  metadata            jsonb not null default '{}'
);

alter table macro_observations enable row level security;
create policy "macro_observations: anon read" on macro_observations for select using (true);

create index if not exists macro_obs_indicator_date_idx
  on macro_observations (indicator_id, observation_date desc);

create unique index if not exists macro_obs_unique_idx
  on macro_observations (indicator_id, observation_date, source_series_code)
  where source_series_code is not null;

-- ─── 5. stock_snapshots ──────────────────────────────────────────────────────
create table if not exists stock_snapshots (
  id              uuid primary key default gen_random_uuid(),
  ticker          text not null unique,
  price           numeric,
  currency        text default 'CLP',
  day_change      numeric,
  day_change_pct  numeric,
  volume          numeric,
  avg_volume_30d  numeric,
  market_cap      numeric,
  last_updated    timestamptz,
  provider        text,
  status          text default 'ok',   -- 'ok' | 'stale' | 'error'
  metadata        jsonb not null default '{}'
);

alter table stock_snapshots enable row level security;
create policy "stock_snapshots: anon read" on stock_snapshots for select using (true);

create index if not exists stock_snapshots_ticker_idx on stock_snapshots (ticker);

-- ─── 6. stock_ohlcv ──────────────────────────────────────────────────────────
create table if not exists stock_ohlcv (
  id          uuid primary key default gen_random_uuid(),
  ticker      text not null,
  timestamp   timestamptz not null,
  open        numeric,
  high        numeric,
  low         numeric,
  close       numeric,
  volume      numeric,
  provider    text,
  metadata    jsonb not null default '{}'
);

alter table stock_ohlcv enable row level security;
create policy "stock_ohlcv: anon read" on stock_ohlcv for select using (true);

create unique index if not exists stock_ohlcv_ticker_ts_idx on stock_ohlcv (ticker, timestamp);
create index if not exists stock_ohlcv_ticker_idx on stock_ohlcv (ticker, timestamp desc);

-- ─── 7. index_snapshots ──────────────────────────────────────────────────────
create table if not exists index_snapshots (
  id              uuid primary key default gen_random_uuid(),
  index_id        text not null unique,
  name            text not null,
  country         text,
  value           numeric,
  day_change      numeric,
  day_change_pct  numeric,
  ytd_change_pct  numeric,
  last_updated    timestamptz,
  provider        text,
  metadata        jsonb not null default '{}'
);

alter table index_snapshots enable row level security;
create policy "index_snapshots: anon read" on index_snapshots for select using (true);

-- ─── 8. sector_performance ───────────────────────────────────────────────────
create table if not exists sector_performance (
  id                  uuid primary key default gen_random_uuid(),
  sector              text not null unique,
  day_change_pct      numeric,
  ytd_change_pct      numeric,
  number_of_stocks    int,
  top_contributor     text,
  worst_contributor   text,
  last_updated        timestamptz,
  provider            text,
  metadata            jsonb not null default '{}'
);

alter table sector_performance enable row level security;
create policy "sector_performance: anon read" on sector_performance for select using (true);

-- ─── 9. cmf_filings ──────────────────────────────────────────────────────────
create table if not exists cmf_filings (
  id               uuid primary key default gen_random_uuid(),
  document_number  text unique,
  filing_type      text,                  -- 'HE' | 'OE' etc.
  entity_name      text,
  ticker           text,
  rut              text,
  filing_date      date,
  filing_time      time,
  filing_datetime  timestamptz,
  subject          text,
  category         text,
  title            text,
  summary          text,
  materiality      text,                  -- 'high' | 'medium' | 'low'
  source_url       text,
  document_url     text,
  provider         text default 'cmf',
  status           text default 'ok',
  fetched_at       timestamptz,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table cmf_filings enable row level security;
create policy "cmf_filings: anon read" on cmf_filings for select using (true);

create trigger cmf_filings_updated_at
  before update on cmf_filings
  for each row execute function set_updated_at();

create index if not exists cmf_filings_ticker_idx on cmf_filings (ticker);
create index if not exists cmf_filings_date_idx on cmf_filings (filing_date desc);

-- ─── 10. documents ───────────────────────────────────────────────────────────
create table if not exists documents (
  id                  uuid primary key default gen_random_uuid(),
  external_id         text unique,
  related_type        text,               -- 'hecho' | 'earnings'
  related_id          text,
  ticker              text,
  company_name        text,
  title               text not null,
  document_type       text,
  source              text,
  source_url          text,
  document_url        text,
  file_type           text,
  local_status        text default 'external_only',
  text_status         text default 'pending',
  ai_summary_status   text default 'pending',
  ai_summary          text,
  key_points          jsonb not null default '[]',
  published_at        timestamptz,
  fetched_at          timestamptz,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table documents enable row level security;
create policy "documents: anon read" on documents for select using (true);

create trigger documents_updated_at
  before update on documents
  for each row execute function set_updated_at();

create index if not exists documents_ticker_idx on documents (ticker);
create index if not exists documents_related_idx on documents (related_type, related_id);

-- ─── 11. ingestion_runs ──────────────────────────────────────────────────────
create table if not exists ingestion_runs (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,
  job_type        text not null,
  status          text not null default 'running',  -- 'running' | 'done' | 'error'
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  rows_seen       int,
  rows_inserted   int,
  rows_updated    int,
  rows_failed     int,
  error_message   text,
  metadata        jsonb not null default '{}'
);

alter table ingestion_runs enable row level security;
create policy "ingestion_runs: anon read" on ingestion_runs for select using (true);

create index if not exists ingestion_runs_provider_idx
  on ingestion_runs (provider, started_at desc);
