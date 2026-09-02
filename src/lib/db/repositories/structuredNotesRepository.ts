// Phase 9A — Structured Notes repository (user-scoped; RLS enforced at the DB).
//
// Route handlers pass a user-session client (getSupabaseUserClient()). Per the
// established pattern (watchlist/portfolio), user_id is NEVER set explicitly in
// an insert — the column default `auth.uid()` establishes ownership, and RLS +
// the ownership-guard trigger enforce it. Type inference for user-scoped tables
// is unreliable at TS depth limits, so queries use `q(client)`.

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  StructuredNoteRow as DbNote,
  StructuredNoteUnderlyingRow as DbUnderlying,
  StructuredNoteObservationRow as DbObs,
  StructuredNoteAllocationRow as DbAlloc,
} from '../../supabase/database.types.ts'
import { ARCHIVED_STATUSES } from '../../structuredNotes/types.ts'
import { normalizeCustodianName, custodianKey } from '../../structuredNotes/calculations.ts'
import type {
  StructuredNote,
  StructuredNoteUnderlying,
  StructuredNoteObservation,
  StructuredNoteAllocation,
  NoteStatus,
} from '../../structuredNotes/types.ts'

type Client = SupabaseClient<Database>

// User-scoped tables exceed TS inference depth (see watchlistRepository/CLAUDE.md).
// A single typed escape hatch keeps every call site clean.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any
function q(client: Client): { from: (table: string) => AnyQuery } {
  return client as unknown as { from: (table: string) => AnyQuery }
}

// ─── Mappers (db row → domain) ────────────────────────────────────────────────

function mapUnderlying(r: DbUnderlying): StructuredNoteUnderlying {
  return {
    id: r.id,
    underlyingOrder: r.underlying_order,
    underlyingName: r.underlying_name,
    sourceTicker: r.source_ticker,
    bloombergTicker: r.bloomberg_ticker,
    yahooSymbol: r.yahoo_symbol,
    assetClass: (r.asset_class as StructuredNoteUnderlying['assetClass']) ?? 'index',
    initialLevel: r.initial_level,
    strikeLevel: r.strike_level,
    knockInBarrierLevel: r.knock_in_barrier_level,
    couponBarrierLevel: r.coupon_barrier_level,
    autocallBarrierLevel: r.autocall_barrier_level,
    knockInBarrierPct: r.knock_in_barrier_pct,
    couponBarrierPct: r.coupon_barrier_pct,
    autocallBarrierPct: r.autocall_barrier_pct,
  }
}

function mapObservation(r: DbObs): StructuredNoteObservation {
  return {
    id: r.id,
    observationNumber: r.observation_number,
    observationType: r.observation_type as StructuredNoteObservation['observationType'],
    valuationDate: r.valuation_date,
    paymentDate: r.payment_date,
    redemptionDate: r.redemption_date,
    couponDuePct: r.coupon_due_pct,
    autocallBarrierPct: r.autocall_barrier_pct,
    couponBarrierPct: r.coupon_barrier_pct,
    status: r.status as StructuredNoteObservation['status'],
    observedAt: r.observed_at,
    observedSource: r.observed_source,
    observedSourceSymbol: r.observed_source_symbol,
    observedLevels: r.observed_levels as Record<string, number | null> | null,
    worstPerformerTicker: r.worst_performer_ticker,
    worstPerformerReturn: r.worst_performer_return,
    couponEligible: r.coupon_eligible,
    autocallEligible: r.autocall_eligible,
    finalBarrierBreached: r.final_barrier_breached,
    reviewRequired: r.review_required,
    reviewReason: r.review_reason,
  }
}

function mapAllocation(r: DbAlloc): StructuredNoteAllocation {
  return {
    id: r.id,
    entityName: r.entity_name,
    custodian: r.custodian,
    notionalAmount: Number(r.notional_amount),
    currency: r.currency,
    active: r.active,
  }
}

function mapNote(r: DbNote, children?: { underlyings?: DbUnderlying[]; observations?: DbObs[]; allocations?: DbAlloc[] }): StructuredNote {
  return {
    id: r.id,
    isin: r.isin,
    productName: r.product_name,
    issuerName: r.issuer_name,
    issuerDisplayName: r.issuer_display_name,
    // `?? null` keeps the domain type honest while the additive R7.1B.1
    // migration is still pending on an environment: reads use `select('*')`,
    // so a missing column yields undefined rather than an error, and every
    // note simply classifies as "Custodian unavailable" until it is applied.
    custodian: r.custodian ?? null,
    guarantorName: r.guarantor_name,
    structureType: r.structure_type,
    payoffType: r.payoff_type,
    currency: r.currency,
    issueSize: r.issue_size,
    denomination: r.denomination,
    issuePricePct: r.issue_price_pct,
    tradeDate: r.trade_date,
    issueDate: r.issue_date,
    initialValuationDate: r.initial_valuation_date,
    finalValuationDate: r.final_valuation_date,
    maturityDate: r.maturity_date,
    redemptionDate: r.redemption_date,
    couponFrequency: r.coupon_frequency,
    couponRatePeriodic: r.coupon_rate_periodic,
    couponRateAnnualized: r.coupon_rate_annualized,
    memoryCoupon: r.memory_coupon,
    principalProtection: r.principal_protection,
    knockInBarrierPct: r.knock_in_barrier_pct,
    couponBarrierPct: r.coupon_barrier_pct,
    autocallBarrierPct: r.autocall_barrier_pct,
    status: r.status as NoteStatus,
    sourceType: r.source_type as StructuredNote['sourceType'],
    sourceName: r.source_name,
    sourceFileName: r.source_file_name,
    confidenceScore: r.confidence_score,
    archivedAt: r.archived_at,
    underlyings: (children?.underlyings ?? []).map(mapUnderlying).sort((a, b) => a.underlyingOrder - b.underlyingOrder),
    observations: (children?.observations ?? []).map(mapObservation),
    allocations: (children?.allocations ?? []).map(mapAllocation),
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** All of the user's notes (list view) with children joined. */
export async function listStructuredNotes(client: Client): Promise<StructuredNote[]> {
  const notesRes = await q(client).from('structured_notes').select('*').order('trade_date', { ascending: false, nullsFirst: false })
  const notes = notesRes.data as DbNote[] | null
  if (notesRes.error || !notes || notes.length === 0) return []
  const ids = notes.map((n) => n.id)
  const [uRes, oRes, aRes] = await Promise.all([
    q(client).from('structured_note_underlyings').select('*').in('note_id', ids),
    q(client).from('structured_note_observations').select('*').in('note_id', ids),
    q(client).from('structured_note_allocations').select('*').in('note_id', ids),
  ])
  const us = (uRes.data ?? []) as DbUnderlying[]
  const os = (oRes.data ?? []) as DbObs[]
  const as = (aRes.data ?? []) as DbAlloc[]
  return notes.map((n) =>
    mapNote(n, {
      underlyings: us.filter((x) => x.note_id === n.id),
      observations: os.filter((x) => x.note_id === n.id),
      allocations: as.filter((x) => x.note_id === n.id),
    }),
  )
}

export async function getStructuredNoteById(client: Client, id: string): Promise<StructuredNote | null> {
  const noteRes = await q(client).from('structured_notes').select('*').eq('id', id).single()
  const note = noteRes.data as DbNote | null
  if (noteRes.error || !note) return null
  const [uRes, oRes, aRes] = await Promise.all([
    q(client).from('structured_note_underlyings').select('*').eq('note_id', id),
    q(client).from('structured_note_observations').select('*').eq('note_id', id).order('observation_number', { ascending: true }),
    q(client).from('structured_note_allocations').select('*').eq('note_id', id),
  ])
  return mapNote(note, {
    underlyings: (uRes.data ?? []) as DbUnderlying[],
    observations: (oRes.data ?? []) as DbObs[],
    allocations: (aRes.data ?? []) as DbAlloc[],
  })
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export interface ImportResult {
  ok: boolean
  noteId?: string
  error?: string
}

/**
 * Persists a full note payload (note + underlyings + observations). Allocations
 * are NOT imported here — they are internal and added separately. The note's
 * status defaults to 'active' on import (parser produces 'draft').
 */
export async function importStructuredNote(
  client: Client,
  note: StructuredNote,
  provenance: { extractionRunId?: string | null; sourceFileHash?: string | null } = {},
): Promise<ImportResult> {
  const noteInsert = {
    isin: note.isin,
    product_name: note.productName,
    issuer_name: note.issuerName,
    issuer_display_name: note.issuerDisplayName,
    // Custody is never part of an imported term sheet — it stays null until a
    // user records it on the note.
    guarantor_name: note.guarantorName,
    structure_type: note.structureType,
    payoff_type: note.payoffType,
    currency: note.currency,
    issue_size: note.issueSize,
    denomination: note.denomination,
    issue_price_pct: note.issuePricePct,
    trade_date: note.tradeDate,
    issue_date: note.issueDate,
    initial_valuation_date: note.initialValuationDate,
    final_valuation_date: note.finalValuationDate,
    maturity_date: note.maturityDate,
    redemption_date: note.redemptionDate,
    coupon_frequency: note.couponFrequency,
    coupon_rate_periodic: note.couponRatePeriodic,
    coupon_rate_annualized: note.couponRateAnnualized,
    memory_coupon: note.memoryCoupon,
    principal_protection: note.principalProtection,
    knock_in_barrier_pct: note.knockInBarrierPct,
    coupon_barrier_pct: note.couponBarrierPct,
    autocall_barrier_pct: note.autocallBarrierPct,
    status: note.status === 'draft' ? 'active' : note.status,
    source_type: note.sourceType,
    source_name: note.sourceName,
    source_file_name: note.sourceFileName,
    source_file_hash: provenance.sourceFileHash ?? null,
    extraction_run_id: provenance.extractionRunId ?? null,
    confidence_score: note.confidenceScore,
  }
  const noteRes = await q(client).from('structured_notes').insert(noteInsert).select('id').single()
  if (noteRes.error || !noteRes.data) return { ok: false, error: sanitize(noteRes.error?.message) }
  const noteId = noteRes.data.id as string

  if (note.underlyings.length > 0) {
    const rows = note.underlyings.map((u) => ({
      note_id: noteId,
      underlying_order: u.underlyingOrder,
      underlying_name: u.underlyingName,
      source_ticker: u.sourceTicker,
      bloomberg_ticker: u.bloombergTicker,
      yahoo_symbol: u.yahooSymbol,
      asset_class: u.assetClass,
      initial_level: u.initialLevel,
      strike_level: u.strikeLevel,
      knock_in_barrier_level: u.knockInBarrierLevel,
      coupon_barrier_level: u.couponBarrierLevel,
      autocall_barrier_level: u.autocallBarrierLevel,
      knock_in_barrier_pct: u.knockInBarrierPct,
      coupon_barrier_pct: u.couponBarrierPct,
      autocall_barrier_pct: u.autocallBarrierPct,
    }))
    const uRes = await q(client).from('structured_note_underlyings').insert(rows)
    if (uRes.error) return { ok: false, noteId, error: sanitize(uRes.error.message) }
  }

  if (note.observations.length > 0) {
    const rows = note.observations.map((o) => ({
      note_id: noteId,
      observation_number: o.observationNumber,
      observation_type: o.observationType,
      valuation_date: o.valuationDate,
      payment_date: o.paymentDate,
      redemption_date: o.redemptionDate,
      coupon_due_pct: o.couponDuePct,
      autocall_barrier_pct: o.autocallBarrierPct,
      coupon_barrier_pct: o.couponBarrierPct,
      status: o.status,
    }))
    const oRes = await q(client).from('structured_note_observations').insert(rows)
    if (oRes.error) return { ok: false, noteId, error: sanitize(oRes.error.message) }
  }

  return { ok: true, noteId }
}

export async function updateStructuredNote(
  client: Client,
  id: string,
  patch: Partial<Pick<StructuredNote, 'status' | 'issuerDisplayName' | 'productName' | 'sourceName' | 'custodian'>>,
): Promise<boolean> {
  const dbPatch: Record<string, unknown> = {}
  if (patch.status !== undefined) {
    dbPatch.status = patch.status
    // Stamp when the note actually entered an archived state (Called/matured/etc.),
    // and clear it if a user reverses that (e.g. un-checks "Called").
    dbPatch.archived_at = ARCHIVED_STATUSES.includes(patch.status) ? new Date().toISOString() : null
  }
  if (patch.issuerDisplayName !== undefined) dbPatch.issuer_display_name = patch.issuerDisplayName
  if (patch.productName !== undefined) dbPatch.product_name = patch.productName
  if (patch.sourceName !== undefined) dbPatch.source_name = patch.sourceName
  // R7.1B.1 — note-level custody. Normalized on the way in (whitespace/casing
  // preserved as the user typed the legal name); an explicit null clears it.
  if (patch.custodian !== undefined) dbPatch.custodian = normalizeCustodianName(patch.custodian)
  if (Object.keys(dbPatch).length === 0) return true
  const res = await q(client).from('structured_notes').update(dbPatch).eq('id', id)
  return !res.error
}

export type DeleteNoteResult = 'ok' | 'not_found' | 'delete_failed'

/**
 * Permanently removes a note. HARD delete — the repository has no soft-delete
 * convention for structured notes (`archived_at`/`status` model the note being
 * CALLED, a real lifecycle event, and archived notes stay fully visible in the
 * Archived view; reusing them to mean "deleted" would corrupt that meaning).
 *
 * R7.1B — dependent records, classified explicitly against the declared
 * foreign keys in 20260706000000_structured_notes_foundation.sql (this is the
 * documented, tested contract, not incidental database behavior):
 *
 *   delete with note      structured_note_underlyings        (note_id, cascade)
 *                         structured_note_observations       (note_id, cascade)
 *                         structured_note_allocations        (note_id, cascade)
 *                         structured_note_price_snapshots    (note_id, cascade)
 *                         structured_note_extracted_fields   (note_id, cascade)
 *   preserve but detach   structured_note_extraction_runs    (extracted_note_id
 *                         → SET NULL: the upload/extraction audit trail must
 *                         survive the record it produced)
 *   preserve, shared      structured_note_monitoring_runs    (book-level, no
 *                         note FK — one run covers every note)
 *
 * Nothing shared is destroyed: entities and custodians are text attributes of
 * the allocation rows, not shared records, and this module owns no document
 * store. One statement, so the cascade is a single atomic database operation —
 * a partial delete is not reachable.
 */
export async function deleteStructuredNote(client: Client, id: string): Promise<DeleteNoteResult> {
  const existing = await q(client).from('structured_notes').select('id').eq('id', id).maybeSingle()
  if (existing.error) return 'delete_failed'
  if (existing.data == null) return 'not_found'
  const res = await q(client).from('structured_notes').delete().eq('id', id)
  return res.error ? 'delete_failed' : 'ok'
}

// ─── Allocations (internal — never from PDF) ──────────────────────────────────

/**
 * Sets the notional allocated to one entity for a note (upsert by
 * note_id + entity_name). A notional of 0 (or less) removes the allocation so
 * the grid can clear an entity by zeroing it.
 */
export type UpsertAllocationResult = 'ok' | 'invalid_entity' | 'write_failed'

/**
 * R7.1B.1 — allocations carry an account and its notional ONLY. Custody is a
 * note-level fact (all of a note's accounts trade through one custodian), so
 * it is neither read nor written here; the superseded
 * `structured_note_allocations.custodian` column is left untouched and empty.
 */
export async function upsertAllocation(
  client: Client,
  noteId: string,
  alloc: { entityName: string; notionalAmount: number; currency?: string; active?: boolean },
): Promise<UpsertAllocationResult> {
  const entity = alloc.entityName.trim()
  if (!entity) return 'invalid_entity'
  if (!(alloc.notionalAmount > 0)) {
    const res = await q(client).from('structured_note_allocations').delete().eq('note_id', noteId).eq('entity_name', entity)
    return res.error ? 'write_failed' : 'ok'
  }
  const res = await q(client).from('structured_note_allocations').upsert(
    {
      note_id: noteId,
      entity_name: entity,
      notional_amount: alloc.notionalAmount,
      currency: alloc.currency ?? 'USD',
      active: alloc.active ?? true,
    },
    { onConflict: 'note_id,entity_name' },
  )
  return res.error ? 'write_failed' : 'ok'
}

/**
 * R7.1B.1 — the distinct custodians already recorded across the book, for the
 * note form's suggestion list. This IS the custodian registry: it is built
 * from values users actually entered on their notes, so the app never ships a
 * guessed roster of institutions and never auto-merges two distinct legal
 * entities.
 */
export async function getKnownCustodians(client: Client): Promise<string[]> {
  const res = await q(client).from('structured_notes').select('custodian')
  if (res.error || !res.data) return []
  const byKey = new Map<string, string>()
  for (const row of res.data as { custodian: string | null }[]) {
    const name = normalizeCustodianName(row.custodian)
    if (name === null) continue
    const key = custodianKey(name)
    if (key !== null && !byKey.has(key)) byKey.set(key, name)
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}

export async function deleteAllocation(client: Client, allocationId: string): Promise<boolean> {
  const res = await q(client).from('structured_note_allocations').delete().eq('id', allocationId)
  return !res.error
}

// ─── Extraction-run audit ─────────────────────────────────────────────────────

export async function recordExtractionRun(
  client: Client,
  run: {
    fileName: string | null
    fileHash: string | null
    parserVersion: string
    status: string
    confidenceScore: number
    fieldsSeen: number
    fieldsExtracted: number
    fieldsLowConfidence: number
    warnings: unknown[]
    errors: unknown[]
    extractedPayload: unknown
  },
): Promise<string | null> {
  const res = await q(client)
    .from('structured_note_extraction_runs')
    .insert({
      file_name: run.fileName,
      file_hash: run.fileHash,
      parser_version: run.parserVersion,
      status: run.status,
      confidence_score: run.confidenceScore,
      fields_seen: run.fieldsSeen,
      fields_extracted: run.fieldsExtracted,
      fields_low_confidence: run.fieldsLowConfidence,
      warnings: run.warnings,
      errors: run.errors,
      extracted_payload: run.extractedPayload,
    })
    .select('id')
    .single()
  if (res.error || !res.data) return null
  return res.data.id as string
}

function sanitize(msg: string | undefined): string {
  if (!msg) return 'database error'
  return msg.replace(/eyJ[A-Za-z0-9_.\-]{20,}/g, '***').slice(0, 200)
}

// ─── Phase 9D — scheduled monitoring ───────────────────────────────────────────
//
// These functions are called from two contexts:
//   - the authenticated monitoring-status route (a normal user-session client)
//   - the cron snapshot route (the service-role ADMIN client — no user
//     session exists for a scheduled job). Every function here accepts
//     whatever Client it's given; the admin client bypasses RLS, the user
//     client is bound by the Phase 9B shared-book policies. Neither path ever
//     hands the service-role key to a browser — the admin client is only ever
//     constructed server-side inside the cron route itself.

/** Notes eligible for scheduled monitoring (status='active'), with children joined — same shape as listStructuredNotes but filtered at the DB level. */
export async function getActiveNotesForMonitoring(client: Client): Promise<StructuredNote[]> {
  const notesRes = await q(client).from('structured_notes').select('*').eq('status', 'active')
  const notes = notesRes.data as DbNote[] | null
  if (notesRes.error || !notes || notes.length === 0) return []
  const ids = notes.map((n) => n.id)
  const [uRes, oRes, aRes] = await Promise.all([
    q(client).from('structured_note_underlyings').select('*').in('note_id', ids),
    q(client).from('structured_note_observations').select('*').in('note_id', ids),
    q(client).from('structured_note_allocations').select('*').in('note_id', ids),
  ])
  const us = (uRes.data ?? []) as DbUnderlying[]
  const os = (oRes.data ?? []) as DbObs[]
  const as = (aRes.data ?? []) as DbAlloc[]
  return notes.map((n) =>
    mapNote(n, {
      underlyings: us.filter((x) => x.note_id === n.id),
      observations: os.filter((x) => x.note_id === n.id),
      allocations: as.filter((x) => x.note_id === n.id),
    }),
  )
}

export interface PriceSnapshotInsert {
  noteId: string
  underlyingId: string
  priceDate: string
  price: number | null
  source: string
  sourceSymbol: string | null
  /**
   * Phase 9E quote-quality metadata (provider id, source type, as-of
   * timestamp, quality level/reasons, staleness, warning, raw provider
   * fields). Written into the existing `metadata jsonb` column — no
   * migration needed, this column has existed since the Phase 9A schema.
   */
  metadata?: Record<string, unknown>
}

/**
 * Persists one row per underlying per monitoring run. Upserts on the
 * existing `(underlying_id, price_date, source)` unique constraint so a
 * cron re-run for the same day never creates a duplicate — it just
 * refreshes the price.
 */
export async function insertStructuredNotePriceSnapshots(client: Client, rows: PriceSnapshotInsert[]): Promise<{ ok: boolean; error?: string }> {
  if (rows.length === 0) return { ok: true }
  const payload = rows
    .filter((r) => r.underlyingId) // an underlying with no id can't be linked — skip rather than fail the whole batch
    .map((r) => ({
      note_id: r.noteId,
      underlying_id: r.underlyingId,
      price_date: r.priceDate,
      price: r.price,
      source: r.source,
      source_symbol: r.sourceSymbol,
      metadata: r.metadata ?? {},
    }))
  if (payload.length === 0) return { ok: true }
  const res = await q(client).from('structured_note_price_snapshots').upsert(payload, { onConflict: 'underlying_id,price_date,source' })
  return res.error ? { ok: false, error: sanitize(res.error.message) } : { ok: true }
}

export interface LatestSnapshot {
  underlyingId: string
  priceDate: string
  price: number | null
  source: string
  sourceSymbol: string | null
  metadata: Record<string, unknown>
}

/** The most recent snapshot row per underlying, across the given notes. */
export async function getLatestStructuredNotePriceSnapshots(client: Client, noteIds: string[]): Promise<Map<string, LatestSnapshot>> {
  const out = new Map<string, LatestSnapshot>()
  if (noteIds.length === 0) return out
  const res = await q(client)
    .from('structured_note_price_snapshots')
    .select('*')
    .in('note_id', noteIds)
    .order('price_date', { ascending: false })
  const rows = (res.data ?? []) as { underlying_id: string; price_date: string; price: number | null; source: string; source_symbol: string | null; metadata: Record<string, unknown> | null }[]
  for (const r of rows) {
    if (!out.has(r.underlying_id)) {
      out.set(r.underlying_id, { underlyingId: r.underlying_id, priceDate: r.price_date, price: r.price, source: r.source, sourceSymbol: r.source_symbol, metadata: r.metadata ?? {} })
    }
  }
  return out
}

/**
 * R13.7 § 24 — DELIVERY STATE, kept separate from event detection.
 *
 * The event identity is `(note_id, event_type, valuation_date)`. The
 * observation row already IS that identity for a given note and date, so the
 * delivery record lives in its existing `metadata jsonb` under `notifications`
 * — no migration, and the same "reuse the metadata column" pattern Phases
 * 9D/9E used for their own diagnostics.
 *
 * Detection is pure and re-runnable; only this marker decides whether an alert
 * has already gone out. That separation is what lets a failed delivery be
 * retried without the detector having to remember anything.
 */
export async function getObservationNotificationState(
  client: Client,
  observationId: string,
): Promise<Record<string, unknown>> {
  const res = await q(client)
    .from('structured_note_observations')
    .select('metadata')
    .eq('id', observationId)
    .maybeSingle()
  const meta = (res.data as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}
  const notifications = meta['notifications']
  return (notifications && typeof notifications === 'object') ? notifications as Record<string, unknown> : {}
}

/**
 * R13.7B2 § 6 — CONCURRENCY.
 *
 * A read-then-write delivery marker is NOT idempotent under concurrent workers:
 * two crons firing together both read "absent", both send, both mark sent. Two
 * Vercel cron slots plus a manual invocation make that a real arrangement, not
 * a theoretical one.
 *
 * The fix is a compare-and-swap CLAIM, taken before delivery, expressed as a
 * SINGLE conditional UPDATE. Under Postgres READ COMMITTED, concurrent updates
 * to one row serialize: the loser blocks, then re-evaluates its WHERE predicate
 * against the winner's committed version, finds it no longer matches, and
 * updates zero rows. Exactly one worker can claim. This needs no migration and
 * no RPC — only a filter on the existing `metadata jsonb`, verified live
 * against the production schema before it was relied upon.
 *
 * Claim states, all inside `metadata.notifications[eventType]`:
 *   absent                     → claimable
 *   { claimToken, claimedAt }  → in flight (reclaimable once stale)
 *   { ..., notifiedAt }        → delivered, terminal
 */
export const NOTIFICATION_CLAIM_STALE_MS = 15 * 60 * 1000

/** Why a claim attempt did not yield the right to send. */
export type ClaimRefusal = 'already_delivered' | 'claim_in_flight' | 'lost_race' | 'not_found'

export type NotificationClaim =
  | { claimed: true; token: string }
  | { claimed: false; reason: ClaimRefusal; existing: Record<string, unknown> | null }

/**
 * Event types are interpolated into a PostgREST JSON path, so they are
 * restricted to a plain identifier. This can therefore never become an
 * injection vector, and a typo fails loudly instead of silently addressing the
 * wrong key.
 */
function assertEventKey(eventType: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(eventType)) throw new Error(`Unsafe notification event type: ${eventType}`)
}

function readClaimRecord(meta: Record<string, unknown>, eventType: string): Record<string, unknown> | null {
  const notifications = meta['notifications']
  if (!notifications || typeof notifications !== 'object') return null
  const rec = (notifications as Record<string, unknown>)[eventType]
  return rec && typeof rec === 'object' ? rec as Record<string, unknown> : null
}

/**
 * Attempts to become the single worker responsible for delivering `eventType`
 * for this observation. Returns a token that `completeObservationNotification`
 * or `releaseObservationNotification` must present.
 *
 * A stale claim (a worker that crashed between claiming and delivering) is
 * reclaimed by compare-and-swap on its token, so a crash costs at most one
 * cron interval rather than the alert entirely.
 */
export async function claimObservationNotification(
  client: Client,
  observationId: string,
  eventType: string,
  now: Date = new Date(),
  staleMs: number = NOTIFICATION_CLAIM_STALE_MS,
): Promise<NotificationClaim> {
  assertEventKey(eventType)

  const cur = await q(client)
    .from('structured_note_observations')
    .select('metadata')
    .eq('id', observationId)
    .maybeSingle()
  if (!cur.data) return { claimed: false, reason: 'not_found', existing: null }

  const meta = ((cur.data as { metadata?: Record<string, unknown> }).metadata ?? {}) as Record<string, unknown>
  const existing = readClaimRecord(meta, eventType)

  if (existing && existing['notifiedAt']) return { claimed: false, reason: 'already_delivered', existing }

  const priorToken = typeof existing?.['claimToken'] === 'string' ? existing['claimToken'] as string : null
  if (existing && priorToken) {
    const claimedAt = Date.parse(String(existing['claimedAt'] ?? ''))
    const fresh = Number.isFinite(claimedAt) && now.getTime() - claimedAt < staleMs
    if (fresh) return { claimed: false, reason: 'claim_in_flight', existing }
  }

  const token = `${now.toISOString()}#${Math.random().toString(36).slice(2, 10)}`
  const notifications = ((meta['notifications'] && typeof meta['notifications'] === 'object') ? meta['notifications'] : {}) as Record<string, unknown>
  const next = { ...meta, notifications: { ...notifications, [eventType]: { claimToken: token, claimedAt: now.toISOString() } } }

  // The compare-and-swap. Which predicate applies is decided by what the read
  // above saw: an absent record swaps on "still absent"; a stale record swaps
  // on "still carrying the token I saw". Either way a competing worker that
  // committed first invalidates the predicate and this update touches 0 rows.
  let update = q(client)
    .from('structured_note_observations')
    .update({ metadata: next })
    .eq('id', observationId)
  update = priorToken
    ? update.eq(`metadata->notifications->${eventType}->>claimToken`, priorToken)
    : update.is(`metadata->notifications->${eventType}`, null)

  const res = await update.select('id')
  if (res.error) return { claimed: false, reason: 'lost_race', existing }
  const rows = (res.data ?? []) as unknown[]
  return rows.length === 1 ? { claimed: true, token } : { claimed: false, reason: 'lost_race', existing }
}

/** Marks a claimed event as delivered. Compare-and-swaps on the claim token so a reclaimed slot is never overwritten by the worker that lost it. */
export async function completeObservationNotification(
  client: Client,
  observationId: string,
  eventType: string,
  token: string,
  detail: Record<string, unknown>,
  now: Date = new Date(),
): Promise<boolean> {
  assertEventKey(eventType)
  const cur = await q(client)
    .from('structured_note_observations')
    .select('metadata')
    .eq('id', observationId)
    .maybeSingle()
  const meta = ((cur.data as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>
  const notifications = ((meta['notifications'] && typeof meta['notifications'] === 'object') ? meta['notifications'] : {}) as Record<string, unknown>
  const next = {
    ...meta,
    notifications: { ...notifications, [eventType]: { ...detail, claimToken: token, notifiedAt: now.toISOString() } },
  }
  const res = await q(client)
    .from('structured_note_observations')
    .update({ metadata: next })
    .eq('id', observationId)
    .eq(`metadata->notifications->${eventType}->>claimToken`, token)
    .select('id')
  return !res.error && ((res.data ?? []) as unknown[]).length === 1
}

/**
 * Gives a claim back after a failed delivery, so the next run retries rather
 * than the alert being lost to a marker that was written optimistically.
 * Compare-and-swaps on the token for the same reason as completion.
 */
export async function releaseObservationNotification(
  client: Client,
  observationId: string,
  eventType: string,
  token: string,
): Promise<boolean> {
  assertEventKey(eventType)
  const cur = await q(client)
    .from('structured_note_observations')
    .select('metadata')
    .eq('id', observationId)
    .maybeSingle()
  const meta = ((cur.data as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>
  const notifications = { ...((meta['notifications'] && typeof meta['notifications'] === 'object') ? meta['notifications'] : {}) as Record<string, unknown> }
  delete notifications[eventType]
  const res = await q(client)
    .from('structured_note_observations')
    .update({ metadata: { ...meta, notifications } })
    .eq('id', observationId)
    .eq(`metadata->notifications->${eventType}->>claimToken`, token)
    .select('id')
  return !res.error && ((res.data ?? []) as unknown[]).length === 1
}

/**
 * R13.7 § 9 — snapshots recorded FOR specific market dates, for one note.
 *
 * The evidence tier that lets a contractual observation be evaluated against
 * the close of its OWN valuation date instead of whatever the run happened to
 * fetch. Deliberately date-scoped: there is no variant that returns "the most
 * recent" row, because substituting a nearby date is exactly the failure this
 * exists to prevent.
 */
export async function getStructuredNotePriceSnapshotsForDates(
  client: Client,
  noteId: string,
  priceDates: string[],
): Promise<{ underlyingId: string; priceDate: string; price: number | null; source: string }[]> {
  if (!noteId || priceDates.length === 0) return []
  const res = await q(client)
    .from('structured_note_price_snapshots')
    .select('underlying_id, price_date, price, source')
    .eq('note_id', noteId)
    .in('price_date', [...new Set(priceDates)])
  const rows = (res.data ?? []) as { underlying_id: string; price_date: string; price: number | null; source: string }[]
  return rows.map((r) => ({ underlyingId: r.underlying_id, priceDate: r.price_date, price: r.price, source: r.source }))
}

export interface MonitoringRunInput {
  runType: 'scheduled_snapshot' | 'manual_refresh' | 'observation_check' | 'backfill'
}

/** Creates a `running` monitoring-run row and returns its id. Always uses the admin client (called only from the cron route). */
export async function createStructuredNoteMonitoringRun(client: Client, input: MonitoringRunInput): Promise<string | null> {
  const res = await q(client)
    .from('structured_note_monitoring_runs')
    .insert({ run_type: input.runType, status: 'running' })
    .select('id')
    .single()
  if (res.error || !res.data) return null
  return res.data.id as string
}

export interface MonitoringRunResult {
  status: 'success' | 'partial_success' | 'failed'
  activeNoteCount: number
  underlyingCount: number
  pricesRequested: number
  pricesSucceeded: number
  pricesFailed: number
  observationsChecked: number
  observationsUpdated: number
  notesUpdated: number
  warnings: string[]
  errors: string[]
  metadata?: Record<string, unknown>
}

export async function completeStructuredNoteMonitoringRun(client: Client, runId: string, result: MonitoringRunResult): Promise<boolean> {
  const res = await q(client)
    .from('structured_note_monitoring_runs')
    .update({
      status: result.status,
      completed_at: new Date().toISOString(),
      active_note_count: result.activeNoteCount,
      underlying_count: result.underlyingCount,
      prices_requested: result.pricesRequested,
      prices_succeeded: result.pricesSucceeded,
      prices_failed: result.pricesFailed,
      observations_checked: result.observationsChecked,
      observations_updated: result.observationsUpdated,
      notes_updated: result.notesUpdated,
      warnings: result.warnings,
      errors: result.errors,
      metadata: result.metadata ?? {},
    })
    .eq('id', runId)
  return !res.error
}

export interface ObservationResultUpdate {
  status: StructuredNoteObservation['status']
  observedAt: string | null
  observedSource: string | null
  observedSourceSymbol?: string | null
  observedLevels: Record<string, unknown> | null
  worstPerformerTicker: string | null
  worstPerformerReturn: number | null
  couponEligible: boolean | null
  autocallEligible: boolean | null
  finalBarrierBreached: boolean | null
  reviewRequired: boolean
  reviewReason: string | null
  /** Structured review-reason codes (see monitoring.ts's ReviewRequiredReason) plus any other Phase 9E quote-quality diagnostics, written into the existing `metadata jsonb` column — no migration needed. */
  metadata?: Record<string, unknown>
}

/**
 * Writes a monitoring job's evaluation of one observation. Never touches
 * extraction-time fields (couponDuePct, autocallBarrierPct, couponBarrierPct).
 *
 * R13.7B2 § 6 — when `expectStatus` is supplied the write becomes a conditional
 * state transition (`WHERE id = ? AND status = ?`) and the return value means
 * "THIS worker performed the transition". Two concurrent crons that both read
 * an observation as `scheduled` therefore cannot both process it: one updates a
 * row, the other updates none. Omitting `expectStatus` preserves the original
 * unconditional behaviour exactly.
 */
export async function updateObservationResult(
  client: Client,
  observationId: string,
  result: ObservationResultUpdate,
  expectStatus?: StructuredNoteObservation['status'],
): Promise<boolean> {
  if (expectStatus !== undefined) {
    const guarded = await q(client)
      .from('structured_note_observations')
      .update({
        status: result.status,
        observed_at: result.observedAt,
        observed_source: result.observedSource,
        observed_source_symbol: result.observedSourceSymbol ?? null,
        observed_levels: result.observedLevels,
        worst_performer_ticker: result.worstPerformerTicker,
        worst_performer_return: result.worstPerformerReturn,
        coupon_eligible: result.couponEligible,
        autocall_eligible: result.autocallEligible,
        final_barrier_breached: result.finalBarrierBreached,
        review_required: result.reviewRequired,
        review_reason: result.reviewReason,
        ...(result.metadata ? { metadata: result.metadata } : {}),
      })
      .eq('id', observationId)
      .eq('status', expectStatus)
      .select('id')
    return !guarded.error && ((guarded.data ?? []) as unknown[]).length === 1
  }
  const res = await q(client)
    .from('structured_note_observations')
    .update({
      status: result.status,
      observed_at: result.observedAt,
      observed_source: result.observedSource,
      observed_source_symbol: result.observedSourceSymbol ?? null,
      observed_levels: result.observedLevels,
      worst_performer_ticker: result.worstPerformerTicker,
      worst_performer_return: result.worstPerformerReturn,
      coupon_eligible: result.couponEligible,
      autocall_eligible: result.autocallEligible,
      final_barrier_breached: result.finalBarrierBreached,
      review_required: result.reviewRequired,
      review_reason: result.reviewReason,
      ...(result.metadata ? { metadata: result.metadata } : {}),
    })
    .eq('id', observationId)
  return !res.error
}

/** Updates a note's status as a result of a scheduled-monitoring decision (e.g. autocalled). Reuses updateStructuredNote so archived_at stamping stays in one place. */
export async function updateNoteStatusFromObservation(client: Client, noteId: string, status: NoteStatus): Promise<boolean> {
  return updateStructuredNote(client, noteId, { status })
}

export interface MonitoringStatusSummary {
  latestRun: {
    id: string
    runType: string
    status: string
    startedAt: string
    completedAt: string | null
    activeNoteCount: number | null
    pricesSucceeded: number | null
    pricesFailed: number | null
    observationsUpdated: number | null
    notesUpdated: number | null
    warnings: unknown[]
    errors: unknown[]
    /** Phase 9E quote-quality summary (providerSummary, unsupportedSymbols, staleSymbols, reviewRequiredObservations, fallbackProviderUsed, providerDisagreement) — read straight from the run's existing `metadata jsonb` column. */
    metadata: Record<string, unknown>
  } | null
  activeNoteCount: number
  unsupportedUnderlyingCount: number
  latestSnapshotDate: string | null
}

/** Read-only monitoring summary for the authenticated GET /monitoring-status route. */
export async function getStructuredNoteMonitoringStatus(client: Client): Promise<MonitoringStatusSummary> {
  const [runRes, notesRes, snapRes] = await Promise.all([
    q(client).from('structured_note_monitoring_runs').select('*').order('started_at', { ascending: false }).limit(1),
    q(client).from('structured_notes').select('id').eq('status', 'active'),
    q(client).from('structured_note_price_snapshots').select('price_date').order('price_date', { ascending: false }).limit(1),
  ])
  const runRow = (runRes.data ?? [])[0] as
    | {
        id: string; run_type: string; status: string; started_at: string; completed_at: string | null
        active_note_count: number | null; prices_succeeded: number | null; prices_failed: number | null
        observations_updated: number | null; notes_updated: number | null; warnings: unknown[]; errors: unknown[]
        metadata: Record<string, unknown> | null
      }
    | undefined
  const activeNotes = (notesRes.data ?? []) as { id: string }[]

  let unsupportedUnderlyingCount = 0
  if (activeNotes.length > 0) {
    const uRes = await q(client)
      .from('structured_note_underlyings')
      .select('yahoo_symbol')
      .in('note_id', activeNotes.map((n) => n.id))
    unsupportedUnderlyingCount = ((uRes.data ?? []) as { yahoo_symbol: string | null }[]).filter((u) => !u.yahoo_symbol).length
  }

  return {
    latestRun: runRow
      ? {
          id: runRow.id, runType: runRow.run_type, status: runRow.status, startedAt: runRow.started_at, completedAt: runRow.completed_at,
          activeNoteCount: runRow.active_note_count, pricesSucceeded: runRow.prices_succeeded, pricesFailed: runRow.prices_failed,
          observationsUpdated: runRow.observations_updated, notesUpdated: runRow.notes_updated, warnings: runRow.warnings, errors: runRow.errors,
          metadata: runRow.metadata ?? {},
        }
      : null,
    activeNoteCount: activeNotes.length,
    unsupportedUnderlyingCount,
    latestSnapshotDate: ((snapRes.data ?? [])[0] as { price_date: string } | undefined)?.price_date ?? null,
  }
}
