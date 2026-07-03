-- Phase 8C: Financial-statement ingestion foundation (manual CSV first).
-- 4 tables: company_reporting_periods, financial_statement_items,
-- financial_metrics, earnings_events. Public read, no public write — same
-- pattern as macro_indicators/stock_snapshots/cmf_filings (Phase 5B core
-- migration): only the admin/service-role client (bypasses RLS) can write,
-- via scripts/ingest/financialsCsv.ts. Reuses the shared set_updated_at()
-- trigger function defined in 20260625000000_create_market_intelligence_core.sql.

-- ─── 1. company_reporting_periods ────────────────────────────────────────────
-- One row per (ticker, fiscal_year, fiscal_period, period_type, source_type) —
-- the reporting "shell" that statement items / metrics / earnings events hang off.
create table if not exists company_reporting_periods (
  id                uuid primary key default gen_random_uuid(),
  ticker            text not null references companies(ticker) on delete cascade,
  fiscal_year       integer not null,
  fiscal_period     text not null,        -- 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'FY'
  period_type       text not null,        -- 'quarterly' | 'annual' | 'ttm'
  period_end_date   date not null,
  report_date       date,
  currency          text not null default 'CLP',
  source_type       text not null,        -- 'manual_csv' | 'cmf_fecu' | 'xbrl' (future)
  source_name       text,
  source_url        text,
  filing_id         uuid references cmf_filings(id) on delete set null,
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint company_reporting_periods_fiscal_year_check check (fiscal_year between 1990 and 2100),
  constraint company_reporting_periods_period_type_check check (period_type in ('quarterly', 'annual', 'ttm')),
  unique (ticker, fiscal_year, fiscal_period, period_type, source_type)
);

alter table company_reporting_periods enable row level security;
create policy "company_reporting_periods: anon read" on company_reporting_periods for select using (true);

create trigger company_reporting_periods_updated_at
  before update on company_reporting_periods
  for each row execute function set_updated_at();

create index if not exists company_reporting_periods_ticker_idx on company_reporting_periods (ticker);
create index if not exists company_reporting_periods_period_end_idx on company_reporting_periods (ticker, period_end_date desc);

-- ─── 2. financial_statement_items ────────────────────────────────────────────
-- Line-item-level detail (revenue, EBITDA, net income, EPS, cash, debt, ...).
create table if not exists financial_statement_items (
  id                    uuid primary key default gen_random_uuid(),
  reporting_period_id   uuid not null references company_reporting_periods(id) on delete cascade,
  ticker                text not null references companies(ticker) on delete cascade,
  statement_type        text not null,    -- 'income' | 'cash' | 'balance' | 'returns'
  line_item_code        text not null,    -- e.g. 'revenue', 'ebitda', 'net_income', 'eps'
  line_item_name        text not null,
  value                 numeric,
  unit                  text not null default 'CLP',
  scale                 text,             -- 'unit' | 'thousands' | 'millions'
  source_type           text not null,    -- 'manual_csv' | 'cmf_fecu' | 'xbrl' (future)
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  constraint financial_statement_items_statement_type_check check (statement_type in ('income', 'cash', 'balance', 'returns')),
  unique (reporting_period_id, statement_type, line_item_code, source_type)
);

alter table financial_statement_items enable row level security;
create policy "financial_statement_items: anon read" on financial_statement_items for select using (true);

create index if not exists financial_statement_items_ticker_idx on financial_statement_items (ticker);
create index if not exists financial_statement_items_period_idx on financial_statement_items (reporting_period_id);
create index if not exists financial_statement_items_code_idx on financial_statement_items (ticker, line_item_code);

-- ─── 3. financial_metrics ─────────────────────────────────────────────────────
-- Derived/calculated ratios (EBITDA margin, FCF, etc.) tied to a reporting period.
create table if not exists financial_metrics (
  id                    uuid primary key default gen_random_uuid(),
  reporting_period_id   uuid not null references company_reporting_periods(id) on delete cascade,
  ticker                text not null references companies(ticker) on delete cascade,
  metric_code           text not null,    -- e.g. 'ebitda_margin', 'fcf', 'revenue_yoy'
  metric_name           text not null,
  value                 numeric,
  unit                  text,             -- '%' | 'CLP' | 'x' | null
  source_type           text not null,    -- 'manual_csv' | 'derived'
  calculation_method    text,             -- e.g. 'ebitda / revenue' — set when source_type = 'derived'
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  unique (reporting_period_id, metric_code, source_type)
);

alter table financial_metrics enable row level security;
create policy "financial_metrics: anon read" on financial_metrics for select using (true);

create index if not exists financial_metrics_ticker_idx on financial_metrics (ticker);
create index if not exists financial_metrics_period_idx on financial_metrics (reporting_period_id);
create index if not exists financial_metrics_code_idx on financial_metrics (ticker, metric_code);

-- ─── 4. earnings_events ───────────────────────────────────────────────────────
-- One row per reporting event (upcoming or reported) — replaces earnings.json.
create table if not exists earnings_events (
  id                    uuid primary key default gen_random_uuid(),
  ticker                text not null references companies(ticker) on delete cascade,
  fiscal_year           integer,
  fiscal_period         text,
  period_type           text,
  report_date           date,
  event_date            date,
  status                text not null default 'reported', -- 'expected' | 'reported' | 'preliminary' | 'missing'
  revenue               numeric,
  ebitda                numeric,
  net_income            numeric,
  eps                   numeric,
  currency              text default 'CLP',
  source_type           text not null,    -- 'manual_csv' | 'cmf_fecu'
  source_name           text,
  source_url            text,
  reporting_period_id   uuid references company_reporting_periods(id) on delete set null,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint earnings_events_status_check check (status in ('expected', 'reported', 'preliminary', 'missing')),
  unique (ticker, fiscal_year, fiscal_period, source_type)
);

alter table earnings_events enable row level security;
create policy "earnings_events: anon read" on earnings_events for select using (true);

create trigger earnings_events_updated_at
  before update on earnings_events
  for each row execute function set_updated_at();

create index if not exists earnings_events_ticker_idx on earnings_events (ticker);
create index if not exists earnings_events_report_date_idx on earnings_events (report_date desc);
create index if not exists earnings_events_status_idx on earnings_events (status);
