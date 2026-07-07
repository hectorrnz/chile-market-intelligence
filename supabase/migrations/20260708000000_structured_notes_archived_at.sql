-- Phase 9B.2 — Structured Notes: track when a note was archived (called).
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.
--
-- The "Called" checkbox marks a note archived; the Archived view shows the
-- date the user actually checked it, not the note's original trade/maturity
-- date. `archived_at` is set by the app when status transitions into an
-- ARCHIVED_STATUSES value, and cleared back to null when un-archived.

alter table structured_notes add column if not exists archived_at timestamptz;
