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
  patch: Partial<Pick<StructuredNote, 'status' | 'issuerDisplayName' | 'productName' | 'sourceName'>>,
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
  if (Object.keys(dbPatch).length === 0) return true
  const res = await q(client).from('structured_notes').update(dbPatch).eq('id', id)
  return !res.error
}

export async function deleteStructuredNote(client: Client, id: string): Promise<boolean> {
  const res = await q(client).from('structured_notes').delete().eq('id', id)
  return !res.error
}

// ─── Allocations (internal — never from PDF) ──────────────────────────────────

/**
 * Sets the notional allocated to one entity for a note (upsert by
 * note_id + entity_name). A notional of 0 (or less) removes the allocation so
 * the grid can clear an entity by zeroing it.
 */
export async function upsertAllocation(
  client: Client,
  noteId: string,
  alloc: { entityName: string; custodian?: string | null; notionalAmount: number; currency?: string; active?: boolean },
): Promise<boolean> {
  const entity = alloc.entityName.trim()
  if (!entity) return false
  if (!(alloc.notionalAmount > 0)) {
    const res = await q(client).from('structured_note_allocations').delete().eq('note_id', noteId).eq('entity_name', entity)
    return !res.error
  }
  const res = await q(client).from('structured_note_allocations').upsert(
    {
      note_id: noteId,
      entity_name: entity,
      custodian: alloc.custodian ?? null,
      notional_amount: alloc.notionalAmount,
      currency: alloc.currency ?? 'USD',
      active: alloc.active ?? true,
    },
    { onConflict: 'note_id,entity_name' },
  )
  return !res.error
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
  const rows = (res.data ?? []) as { underlying_id: string; price_date: string; price: number | null; source: string; source_symbol: string | null }[]
  for (const r of rows) {
    if (!out.has(r.underlying_id)) {
      out.set(r.underlying_id, { underlyingId: r.underlying_id, priceDate: r.price_date, price: r.price, source: r.source, sourceSymbol: r.source_symbol })
    }
  }
  return out
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
}

/** Writes a monitoring job's evaluation of one observation. Never touches extraction-time fields (couponDuePct, autocallBarrierPct, couponBarrierPct). */
export async function updateObservationResult(client: Client, observationId: string, result: ObservationResultUpdate): Promise<boolean> {
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
        }
      : null,
    activeNoteCount: activeNotes.length,
    unsupportedUnderlyingCount,
    latestSnapshotDate: ((snapRes.data ?? [])[0] as { price_date: string } | undefined)?.price_date ?? null,
  }
}
