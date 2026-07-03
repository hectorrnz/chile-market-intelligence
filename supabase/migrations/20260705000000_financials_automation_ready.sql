-- Phase 8C (automation-first upgrade) — provenance + supersession columns on
-- the 4 financials tables added in 20260704000000_financials_foundation.sql.
--
-- DESIGN — Automation-first source architecture
-- ===============================================================
-- Manual CSV (source_type = 'manual_csv') is an INTERIM BRIDGE, not the
-- architecture. Every row on every financials table carries the same
-- provenance columns regardless of how it arrived, so a future automated
-- provider (CMF/FECU parser, XBRL parser, a licensed vendor feed, a broker
-- feed, or a document-ingestion pipeline reading filed PDFs) writes into
-- these exact same tables through the exact same repository upsert
-- functions — no schema change, no new table, no UI rewrite.
--
-- Supported source_type values (enforced via CHECK, union of what's already
-- persisted under the original Phase 8C migration + the automation-ready set):
--   manual_csv         — interim bridge (today's only writer)
--   cmf_fecu            — future: automated CMF FECU filing parser
--   xbrl                — future: automated XBRL parser
--   vendor_feed         — future: licensed financial-data vendor
--   broker_feed         — future: broker-supplied statements
--   document_ingestion  — future: PDF/filing text-extraction pipeline
--   static_seed         — reference/seed data, not a live ingestion source
--   derived             — computed by this app from other rows in these tables
--
-- source_priority (higher = more authoritative) lets a later, more reliable
-- source outrank an earlier manual entry for the same logical period without
-- deleting history. Suggested (not enforced) convention for future ingestion
-- authors: static_seed=10, derived=50, manual_csv=100 (default), document_
-- ingestion=120, broker_feed=140, vendor_feed=150, cmf_fecu=200, xbrl=210.
--
-- is_superseded / superseded_by mark a row as no longer canonical once a
-- higher-priority source supplies the same logical period. superseded_by is
-- a logical pointer (not FK-enforced, matching upstream spec) to avoid a
-- delete-cascade footgun between two independently-written rows. The
-- read path (src/lib/db/repositories/financialsRepository.ts) always
-- filters `is_superseded = false` and, when duplicates exist for the same
-- logical key, prefers the highest source_priority — so the UI reads one
-- canonical answer per period regardless of how many sources have supplied
-- data for it over time.
--
-- ingestion_run_id ties every row back to the ingestion_runs row that wrote
-- it (already used by macro/market ingestion) — the same audit trail applies
-- to financials regardless of source.
--
-- source_file stores a bare filename only (e.g. "sqm_q1_2025.csv"), never a
-- local absolute path — this column is served in public read APIs, so no
-- machine-specific or private path segments belong here.

-- ─── company_reporting_periods ────────────────────────────────────────────────
alter table company_reporting_periods add column if not exists source_file text;
alter table company_reporting_periods add column if not exists source_as_of timestamptz;
alter table company_reporting_periods add column if not exists ingestion_run_id uuid references ingestion_runs(id) on delete set null;
alter table company_reporting_periods add column if not exists source_priority integer not null default 100;
alter table company_reporting_periods add column if not exists is_superseded boolean not null default false;
alter table company_reporting_periods add column if not exists superseded_by uuid;

do $$ begin
  alter table company_reporting_periods add constraint company_reporting_periods_source_type_check
    check (source_type in ('manual_csv', 'cmf_fecu', 'xbrl', 'vendor_feed', 'broker_feed', 'document_ingestion', 'static_seed', 'derived'));
exception when duplicate_object then null;
end $$;

create index if not exists company_reporting_periods_ingestion_run_idx on company_reporting_periods (ingestion_run_id);
create index if not exists company_reporting_periods_source_type_idx on company_reporting_periods (source_type);
create index if not exists company_reporting_periods_canonical_idx on company_reporting_periods (ticker, fiscal_year, fiscal_period, period_type) where not is_superseded;

-- ─── financial_statement_items ───────────────────────────────────────────────
alter table financial_statement_items add column if not exists source_name text;
alter table financial_statement_items add column if not exists source_url text;
alter table financial_statement_items add column if not exists source_file text;
alter table financial_statement_items add column if not exists source_as_of timestamptz;
alter table financial_statement_items add column if not exists ingestion_run_id uuid references ingestion_runs(id) on delete set null;
alter table financial_statement_items add column if not exists source_priority integer not null default 100;
alter table financial_statement_items add column if not exists is_superseded boolean not null default false;

do $$ begin
  alter table financial_statement_items add constraint financial_statement_items_source_type_check
    check (source_type in ('manual_csv', 'cmf_fecu', 'xbrl', 'vendor_feed', 'broker_feed', 'document_ingestion', 'static_seed', 'derived'));
exception when duplicate_object then null;
end $$;

-- statement_type union: keep the original short codes already persisted
-- (income/cash/balance/returns) and add the automation-ready long-form codes
-- (segment/other) as additional allowed values — never rename what's already
-- live, per the "no destructive schema change" rule.
do $$ begin
  alter table financial_statement_items add constraint financial_statement_items_statement_type_check2
    check (statement_type in ('income', 'cash', 'balance', 'returns', 'income_statement', 'balance_sheet', 'cash_flow', 'segment', 'other'));
exception when duplicate_object then null;
end $$;

create index if not exists financial_statement_items_ingestion_run_idx on financial_statement_items (ingestion_run_id);
create index if not exists financial_statement_items_source_type_idx on financial_statement_items (source_type);

-- ─── financial_metrics ────────────────────────────────────────────────────────
alter table financial_metrics add column if not exists source_name text;
alter table financial_metrics add column if not exists source_url text;
alter table financial_metrics add column if not exists source_file text;
alter table financial_metrics add column if not exists source_as_of timestamptz;
alter table financial_metrics add column if not exists ingestion_run_id uuid references ingestion_runs(id) on delete set null;
alter table financial_metrics add column if not exists source_priority integer not null default 100;
alter table financial_metrics add column if not exists is_superseded boolean not null default false;

do $$ begin
  alter table financial_metrics add constraint financial_metrics_source_type_check
    check (source_type in ('manual_csv', 'cmf_fecu', 'xbrl', 'vendor_feed', 'broker_feed', 'document_ingestion', 'static_seed', 'derived'));
exception when duplicate_object then null;
end $$;

create index if not exists financial_metrics_ingestion_run_idx on financial_metrics (ingestion_run_id);
create index if not exists financial_metrics_source_type_idx on financial_metrics (source_type);

-- ─── earnings_events ──────────────────────────────────────────────────────────
alter table earnings_events add column if not exists source_file text;
alter table earnings_events add column if not exists source_as_of timestamptz;
alter table earnings_events add column if not exists ingestion_run_id uuid references ingestion_runs(id) on delete set null;
alter table earnings_events add column if not exists source_priority integer not null default 100;
alter table earnings_events add column if not exists is_superseded boolean not null default false;
alter table earnings_events add column if not exists superseded_by uuid;

do $$ begin
  alter table earnings_events add constraint earnings_events_source_type_check
    check (source_type in ('manual_csv', 'cmf_fecu', 'xbrl', 'vendor_feed', 'broker_feed', 'document_ingestion', 'static_seed', 'derived'));
exception when duplicate_object then null;
end $$;

create index if not exists earnings_events_ingestion_run_idx on earnings_events (ingestion_run_id);
create index if not exists earnings_events_source_type_idx on earnings_events (source_type);
create index if not exists earnings_events_canonical_idx on earnings_events (ticker, fiscal_year, fiscal_period) where not is_superseded;
