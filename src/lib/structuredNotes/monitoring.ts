// Phase 9D — Structured Notes scheduled monitoring (pure functions).
//
// Turns the compute-on-request dashboard (Phase 9B) into scheduled,
// persisted monitoring: price snapshots, observation-status evaluation, and
// conservative note-status transitions. No Supabase/Yahoo imports here —
// directly unit-testable under plain `node --test`.
//
// MONITORING DATA POLICY (see docs/structured_notes_design.md):
//   - Current underlying levels are MONITORING INPUTS, sourced from a free
//     provider (Yahoo). They are never represented as an official
//     calculation-agent determination.
//   - Missing/unsupported prices -> `unavailable`, never a fabricated level.
//   - Coupon/autocall eligibility on a DUE observation can be evaluated
//     deterministically from available prices (the barrier math itself is
//     exact) and DOES drive an automatic status transition for autocall —
//     the note is either called or it isn't, and Yahoo's regular-market
//     price is an adequate signal for that binary threshold check.
//   - FINAL/maturity payoff is always flagged `reviewRequired` — the exact
//     redemption amount is a legal determination this app cannot make
//     without an official closing/calculation-agent source, so it is
//     reported as an ESTIMATE, never an authoritative final figure.
//   - A note archived by a user (or already in a terminal ARCHIVED_STATUSES
//     state) is NEVER reactivated by scheduled monitoring.

import type {
  StructuredNote,
  StructuredNoteObservation,
  StructuredNoteUnderlying,
  UnderlyingPrice,
  RiskStatus,
  NoteStatus,
} from './types.ts'
import { ARCHIVED_STATUSES } from './types.ts'
import {
  calculateCouponEligibility,
  calculateAutocallEligibility,
  calculateCurrentRiskStatus,
  calculateWorstPerformer,
  calculateMaturityRedemptionAmount,
} from './calculations.ts'

/** Returns n only if it is a finite real number, else null. */
function finite(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// ── Scope selection ──────────────────────────────────────────────────────────

/**
 * Notes eligible for scheduled monitoring: `active` only. A note a user has
 * archived (autocalled/matured/defaulted/cancelled) is never reprocessed —
 * scheduled monitoring must not reactivate or overwrite a manually-set
 * terminal state.
 */
export function getActiveStructuredNotesForMonitoring(notes: StructuredNote[]): StructuredNote[] {
  return notes.filter((n) => n.status === 'active' && !ARCHIVED_STATUSES.includes(n.status))
}

/** Distinct Yahoo symbols across every underlying of the given (already-filtered) notes. */
export function getUniqueUnderlyingSymbols(notes: StructuredNote[]): string[] {
  const set = new Set<string>()
  for (const n of notes) for (const u of n.underlyings) if (u.yahooSymbol) set.add(u.yahooSymbol)
  return [...set]
}

// ── Price snapshots ──────────────────────────────────────────────────────────

export interface PriceSnapshotRow {
  noteId: string
  underlyingId: string
  underlyingOrder: number
  priceDate: string // YYYY-MM-DD
  price: number | null
  source: string // 'yahoo-finance' | 'unavailable'
  sourceSymbol: string | null
}

function priceForUnderlying(u: StructuredNoteUnderlying, latestPrices: Map<string, number>): number | null {
  if (!u.yahooSymbol) return null
  const p = latestPrices.get(u.yahooSymbol)
  return finite(p)
}

/**
 * Builds one snapshot row per underlying for a note, ready for persistence.
 * `priceDate` is the calendar date the monitoring run executed (not the
 * underlying market's own trading-day calendar) — see detectStalePrice() for
 * how a caller should treat a snapshot that predates a note's next
 * observation by more than a trading week.
 */
export function calculateStructuredNoteSnapshot(
  note: Pick<StructuredNote, 'id' | 'underlyings'>,
  latestPrices: Map<string, number>,
  asOf: string,
): PriceSnapshotRow[] {
  if (!note.id) return []
  return note.underlyings.map((u) => {
    const price = priceForUnderlying(u, latestPrices)
    return {
      noteId: note.id!,
      underlyingId: u.id ?? '',
      underlyingOrder: u.underlyingOrder,
      priceDate: asOf,
      price,
      source: price !== null ? 'yahoo-finance' : 'unavailable',
      sourceSymbol: u.yahooSymbol,
    }
  })
}

/** True when a snapshot's price_date is more than `maxAgeDays` before `asOf` — i.e. monitoring hasn't refreshed recently. Never treats a missing snapshot as fresh. */
export function detectStalePrice(
  snapshot: { priceDate: string | null; price: number | null } | null | undefined,
  asOf: string,
  maxAgeDays = 4,
): boolean {
  if (!snapshot || snapshot.price === null || !snapshot.priceDate) return true
  const snapDate = Date.parse(snapshot.priceDate)
  const asOfDate = Date.parse(asOf)
  if (Number.isNaN(snapDate) || Number.isNaN(asOfDate)) return true
  const ageDays = (asOfDate - snapDate) / 86_400_000
  return ageDays > maxAgeDays
}

// ── Risk classification (thin, monitoring-aware wrapper) ────────────────────

function pricesForNote(underlyings: StructuredNoteUnderlying[], latestPrices: Map<string, number>, asOf: string | null): UnderlyingPrice[] {
  return underlyings.map((u): UnderlyingPrice => {
    const price = priceForUnderlying(u, latestPrices)
    return {
      underlyingOrder: u.underlyingOrder,
      yahooSymbol: u.yahooSymbol,
      price,
      source: price !== null ? 'yahoo-finance' : 'unavailable',
      sourceSymbol: u.yahooSymbol,
      asOf: price !== null ? asOf : null,
    }
  })
}

/** Same severity model as the Phase 9B dashboard (breached > autocallable > watch > safe > unavailable), reused here so scheduled monitoring and the on-demand dashboard never disagree. */
export function classifyStructuredNoteRisk(
  note: Pick<StructuredNote, 'underlyings' | 'status'>,
  latestPrices: Map<string, number>,
  asOf: string,
): RiskStatus {
  return calculateCurrentRiskStatus(note, pricesForNote(note.underlyings, latestPrices, asOf))
}

// ── Observation evaluation ───────────────────────────────────────────────────

export interface ObservationEvaluation {
  observationId: string | undefined
  observationType: StructuredNoteObservation['observationType']
  due: boolean // valuationDate <= asOf
  observedAt: string | null
  observedSource: string | null
  observedLevels: Record<string, number | null> | null
  worstPerformerTicker: string | null
  worstPerformerReturn: number | null
  couponEligible: boolean | null
  autocallEligible: boolean | null
  finalBarrierBreached: boolean | null
  reviewRequired: boolean
  reviewReason: string | null
}

function observedLevelsFor(underlyings: StructuredNoteUnderlying[], latestPrices: Map<string, number>): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const u of underlyings) out[u.underlyingName] = priceForUnderlying(u, latestPrices)
  return out
}

function worstPerformerFields(underlyings: StructuredNoteUnderlying[], latestPrices: Map<string, number>): { ticker: string | null; ret: number | null } {
  const prices = pricesForNote(underlyings, latestPrices, null)
  const worst = calculateWorstPerformer(underlyings, prices)
  return { ticker: worst?.underlyingName ?? null, ret: worst?.performance ?? null }
}

/** Coupon observation: eligible iff every underlying is at/above its coupon barrier level. Missing prices -> null (unknown), never a fabricated eligibility. */
export function evaluateCouponObservation(
  note: Pick<StructuredNote, 'underlyings'>,
  observation: StructuredNoteObservation,
  latestPrices: Map<string, number>,
): ObservationEvaluation {
  const eligible = calculateCouponEligibility(note.underlyings, pricesForNote(note.underlyings, latestPrices, null))
  const { ticker, ret } = worstPerformerFields(note.underlyings, latestPrices)
  const anyMissing = note.underlyings.some((u) => priceForUnderlying(u, latestPrices) === null)
  return {
    observationId: observation.id,
    observationType: 'coupon',
    due: true,
    observedAt: new Date().toISOString(),
    observedSource: 'yahoo-finance (monitoring estimate)',
    observedLevels: observedLevelsFor(note.underlyings, latestPrices),
    worstPerformerTicker: ticker,
    worstPerformerReturn: ret,
    couponEligible: eligible,
    autocallEligible: null,
    finalBarrierBreached: null,
    reviewRequired: anyMissing || eligible === null,
    reviewReason: anyMissing || eligible === null ? 'one or more underlying prices unavailable — coupon eligibility could not be determined' : null,
  }
}

/** Autocall observation: eligible iff every underlying is at/above its autocall barrier level. This is the one observation type allowed to drive an automatic status transition (see shouldUpdateNoteStatus). */
export function evaluateAutocallObservation(
  note: Pick<StructuredNote, 'underlyings'>,
  observation: StructuredNoteObservation,
  latestPrices: Map<string, number>,
): ObservationEvaluation {
  const eligible = calculateAutocallEligibility(note.underlyings, pricesForNote(note.underlyings, latestPrices, null))
  const { ticker, ret } = worstPerformerFields(note.underlyings, latestPrices)
  const anyMissing = note.underlyings.some((u) => priceForUnderlying(u, latestPrices) === null)
  return {
    observationId: observation.id,
    observationType: 'autocall',
    due: true,
    observedAt: new Date().toISOString(),
    observedSource: 'yahoo-finance (monitoring estimate)',
    observedLevels: observedLevelsFor(note.underlyings, latestPrices),
    worstPerformerTicker: ticker,
    worstPerformerReturn: ret,
    couponEligible: null,
    autocallEligible: eligible,
    finalBarrierBreached: null,
    reviewRequired: anyMissing || eligible === null,
    reviewReason: anyMissing || eligible === null ? 'one or more underlying prices unavailable — autocall eligibility could not be determined' : null,
  }
}

/**
 * Final/maturity observation: estimates the barrier-breach outcome from
 * current monitoring prices, but ALWAYS flags `reviewRequired` — the app has
 * no official calculation-agent or verified closing-price feed, so the
 * legal redemption amount can never be treated as final here.
 */
export function evaluateFinalObservation(
  note: Pick<StructuredNote, 'underlyings'>,
  observation: StructuredNoteObservation,
  latestPrices: Map<string, number>,
): ObservationEvaluation {
  const finalLevels = new Map<number, number>()
  for (const u of note.underlyings) {
    const p = priceForUnderlying(u, latestPrices)
    if (p !== null) finalLevels.set(u.underlyingOrder, p)
  }
  const estimate = calculateMaturityRedemptionAmount(note, finalLevels)
  const { ticker, ret } = worstPerformerFields(note.underlyings, latestPrices)
  const anyMissing = note.underlyings.some((u) => priceForUnderlying(u, latestPrices) === null)
  return {
    observationId: observation.id,
    observationType: 'final',
    due: true,
    observedAt: new Date().toISOString(),
    observedSource: 'yahoo-finance (monitoring estimate, not an official calculation-agent close)',
    observedLevels: observedLevelsFor(note.underlyings, latestPrices),
    worstPerformerTicker: ticker,
    worstPerformerReturn: ret,
    couponEligible: null,
    autocallEligible: null,
    finalBarrierBreached: estimate.barrierEvent,
    reviewRequired: true, // final/maturity payoff always requires manual verification in this phase
    reviewReason: anyMissing
      ? 'one or more underlying prices unavailable — final redemption estimate is incomplete'
      : 'final redemption is a legal determination — verify against an official calculation-agent or closing-price source before treating as final',
  }
}

/**
 * Dispatches to the correct evaluator for an observation that is due (its
 * valuation date is on or before `asOf`) and still `scheduled`. Returns null
 * for an observation that isn't due yet or has already been finalized.
 */
export function evaluateObservation(
  note: Pick<StructuredNote, 'underlyings'>,
  observation: StructuredNoteObservation,
  latestPrices: Map<string, number>,
  asOf: string,
): ObservationEvaluation | null {
  if (observation.status !== 'scheduled') return null
  const valDate = Date.parse(observation.valuationDate)
  const asOfDate = Date.parse(asOf)
  if (Number.isNaN(valDate) || Number.isNaN(asOfDate) || valDate > asOfDate) return null

  if (observation.observationType === 'coupon') return evaluateCouponObservation(note, observation, latestPrices)
  if (observation.observationType === 'autocall') return evaluateAutocallObservation(note, observation, latestPrices)
  return evaluateFinalObservation(note, observation, latestPrices)
}

// ── Status transitions ───────────────────────────────────────────────────────

export interface NoteStatusUpdate {
  newStatus: NoteStatus
  reason: string
}

/**
 * Whether a note's status should transition as a result of an observation
 * evaluation. Conservative by design:
 *   - Autocall eligible + no missing prices -> 'autocalled' (deterministic:
 *     the barrier math is exact and Yahoo's regular-market price is an
 *     adequate signal for a binary "at/above the level" check).
 *   - Final observation with a barrier breach is NEVER auto-transitioned to
 *     'matured' — the legal payoff requires manual verification (see
 *     evaluateFinalObservation) — the note keeps its current status and the
 *     observation is left flagged reviewRequired for a human to close out.
 *   - A note the user has already archived is never touched (the caller is
 *     expected to only invoke this for notes returned by
 *     getActiveStructuredNotesForMonitoring, but this guard is defense in
 *     depth in case of a stale in-memory list).
 */
export function shouldUpdateNoteStatus(
  note: Pick<StructuredNote, 'status'>,
  observationResult: ObservationEvaluation,
): NoteStatusUpdate | null {
  if (ARCHIVED_STATUSES.includes(note.status)) return null
  if (observationResult.observationType === 'autocall' && observationResult.autocallEligible === true && !observationResult.reviewRequired) {
    return { newStatus: 'autocalled', reason: 'Autocall barrier met on the scheduled autocall observation date (monitoring estimate).' }
  }
  return null
}

/**
 * Maps an observation evaluation to its resulting `ObservationStatus`. Only
 * transitions away from `scheduled` when the outcome is deterministic and
 * complete; anything reviewRequired (missing prices, or any final/maturity
 * observation) lands on `observed` — evaluated, but not finalized — never
 * silently left at `scheduled` (which would look untouched) nor jumped
 * straight to a terminal status the app cannot actually vouch for.
 */
export function deriveObservationStatus(evaluation: ObservationEvaluation): StructuredNoteObservation['status'] {
  if (evaluation.reviewRequired) return 'observed'
  if (evaluation.observationType === 'coupon') return evaluation.couponEligible ? 'coupon_paid' : 'coupon_missed'
  if (evaluation.observationType === 'autocall') return evaluation.autocallEligible ? 'autocalled' : 'observed'
  return 'observed'
}

// ── Dashboard aggregation (monitoring-specific counters) ─────────────────────

export interface MonitoringDashboardAggregates {
  activeNoteCount: number
  staleCount: number
  unsupportedSymbolCount: number
  reviewRequiredCount: number
  dueSoonCount: number // next observation within `dueSoonDays`
}

export interface NoteMonitoringInput {
  note: Pick<StructuredNote, 'status' | 'underlyings' | 'observations'>
  latestSnapshotDate: string | null
  latestSnapshotHasPrice: boolean
  reviewRequired: boolean
  daysToNextObservation: number | null
}

/** Book-level monitoring counters, built from per-note monitoring inputs (already-fetched snapshot/observation state — no I/O here). */
export function calculateDashboardAggregates(notes: NoteMonitoringInput[], asOf: string, dueSoonDays = 7): MonitoringDashboardAggregates {
  const active = notes.filter((n) => n.note.status === 'active')
  let staleCount = 0
  let unsupportedSymbolCount = 0
  let reviewRequiredCount = 0
  let dueSoonCount = 0

  for (const n of active) {
    if (detectStalePrice({ priceDate: n.latestSnapshotDate, price: n.latestSnapshotHasPrice ? 1 : null }, asOf)) staleCount += 1
    if (n.note.underlyings.some((u) => !u.yahooSymbol)) unsupportedSymbolCount += 1
    if (n.reviewRequired) reviewRequiredCount += 1
    if (n.daysToNextObservation !== null && n.daysToNextObservation >= 0 && n.daysToNextObservation <= dueSoonDays) dueSoonCount += 1
  }

  return {
    activeNoteCount: active.length,
    staleCount,
    unsupportedSymbolCount,
    reviewRequiredCount,
    dueSoonCount,
  }
}
