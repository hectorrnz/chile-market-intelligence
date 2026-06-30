-- Phase 4C.2 — Market snapshot persistence: add date/type columns and update unique constraints.
-- Fully idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS,
-- and DO $$ blocks guard against duplicate constraint creation.

-- ─── stock_snapshots ─────────────────────────────────────────────────────────────

ALTER TABLE stock_snapshots ADD COLUMN IF NOT EXISTS snapshot_date date;
ALTER TABLE stock_snapshots ADD COLUMN IF NOT EXISTS snapshot_type text;
ALTER TABLE stock_snapshots ADD COLUMN IF NOT EXISTS ytd_change_pct numeric;
ALTER TABLE stock_snapshots ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE stock_snapshots DROP CONSTRAINT IF EXISTS stock_snapshots_ticker_key;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_snapshots_snapshot_unique'
  ) THEN
    ALTER TABLE stock_snapshots ADD CONSTRAINT stock_snapshots_snapshot_unique
      UNIQUE (ticker, snapshot_date, snapshot_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS stock_snapshots_date_idx
  ON stock_snapshots (ticker, snapshot_date DESC);

-- ─── index_snapshots ─────────────────────────────────────────────────────────────

ALTER TABLE index_snapshots ADD COLUMN IF NOT EXISTS snapshot_date date;
ALTER TABLE index_snapshots ADD COLUMN IF NOT EXISTS snapshot_type text;
ALTER TABLE index_snapshots ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE index_snapshots ADD COLUMN IF NOT EXISTS proxy_of text;

ALTER TABLE index_snapshots DROP CONSTRAINT IF EXISTS index_snapshots_index_id_key;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'index_snapshots_snapshot_unique'
  ) THEN
    ALTER TABLE index_snapshots ADD CONSTRAINT index_snapshots_snapshot_unique
      UNIQUE (index_id, snapshot_date, snapshot_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS index_snapshots_date_idx
  ON index_snapshots (index_id, snapshot_date DESC);

-- ─── sector_performance ──────────────────────────────────────────────────────────

ALTER TABLE sector_performance ADD COLUMN IF NOT EXISTS snapshot_date date;
ALTER TABLE sector_performance ADD COLUMN IF NOT EXISTS snapshot_type text;
ALTER TABLE sector_performance ADD COLUMN IF NOT EXISTS top_contributor_pct numeric;
ALTER TABLE sector_performance ADD COLUMN IF NOT EXISTS worst_contributor_pct numeric;

ALTER TABLE sector_performance DROP CONSTRAINT IF EXISTS sector_performance_sector_key;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sector_performance_snapshot_unique'
  ) THEN
    ALTER TABLE sector_performance ADD CONSTRAINT sector_performance_snapshot_unique
      UNIQUE (sector, snapshot_date, snapshot_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sector_performance_date_idx
  ON sector_performance (sector, snapshot_date DESC);
