-- Phase 9D — Structured Notes: scheduled price snapshots + observation-event automation.
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.
--
-- The scheduled monitoring cron runs with NO authenticated user session — it
-- writes via the service-role admin client, which bypasses RLS entirely but
-- does NOT satisfy `default auth.uid()` (that Postgres function reads a JWT
-- claim that simply isn't present under the service role, so it evaluates
-- NULL). `structured_note_price_snapshots.user_id` was `not null default
-- auth.uid()` from Phase 9A, back when the module was per-user; the Phase 9B
-- shared-book migration already redefined `user_id` as "an upload/audit stamp,
-- not an ownership mechanism" for these tables, so making it nullable here is
-- consistent with that model, not a new exception to it.

alter table structured_note_price_snapshots alter column user_id drop not null;

-- ── Observation evaluation columns (populated by the monitoring cron) ───────────
-- Distinct from the fields set at import time (coupon_due_pct, autocall_barrier_pct,
-- coupon_barrier_pct, status): these record what the monitoring job actually
-- OBSERVED when the valuation date arrived (or was checked), with its own
-- provenance — never conflated with the extraction-time terms.
alter table structured_note_observations
  add column if not exists observed_at timestamptz,
  add column if not exists observed_source text,
  add column if not exists observed_source_symbol text,
  add column if not exists observed_levels jsonb,
  add column if not exists worst_performer_ticker text,
  add column if not exists worst_performer_return numeric,
  add column if not exists coupon_eligible boolean,
  add column if not exists autocall_eligible boolean,
  add column if not exists final_barrier_breached boolean,
  add column if not exists review_required boolean not null default false,
  add column if not exists review_reason text;

-- ── Monitoring run audit log ─────────────────────────────────────────────────────
-- System-level audit trail for the scheduled monitoring job, mirroring the
-- module's own structured_note_extraction_runs precedent (a dedicated
-- audit table, not a shared generic one) — no user_id column, since a
-- monitoring run isn't "owned" by any one user any more than a note itself
-- is in the shared-book model.
create table if not exists structured_note_monitoring_runs (
  id                   uuid primary key default gen_random_uuid(),
  run_type             text not null check (run_type in ('scheduled_snapshot', 'manual_refresh', 'observation_check', 'backfill')),
  status               text not null check (status in ('running', 'success', 'partial_success', 'failed')),
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  active_note_count    integer,
  underlying_count     integer,
  prices_requested     integer,
  prices_succeeded     integer,
  prices_failed        integer,
  observations_checked integer,
  observations_updated integer,
  notes_updated        integer,
  warnings             jsonb not null default '[]',
  errors               jsonb not null default '[]',
  metadata             jsonb not null default '{}',
  created_at           timestamptz not null default now()
);

create index if not exists sn_monitoring_runs_started_idx on structured_note_monitoring_runs (started_at desc);

alter table structured_note_monitoring_runs enable row level security;
drop policy if exists "sn_monitoring_runs_select" on structured_note_monitoring_runs;
create policy "sn_monitoring_runs_select" on structured_note_monitoring_runs for select using (auth.uid() is not null);
-- No insert/update/delete policy for regular (anon-key) clients — writes come
-- only from the cron route's service-role admin client, which bypasses RLS.
-- There is no user-facing write path to this table at all.
