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
  calculateCurrentRiskStatus,
  calculateWorstPerformer,
} from './calculations.ts'
import {
  evaluateCouponEvent,
  evaluateAutocallEvent,
  evaluateKnockInEvent,
  isBarrierEvent,
  type ContractualEventEvaluation,
  type EventOutcome,
} from './contractualEvents.ts'
import {
  toCloseMap,
  CLOSE_DISAGREEMENT_TOLERANCE,
  type ResolvedValuationClose,
} from './valuationClose.ts'
import { isQuoteStale, STALE_THRESHOLD_OBSERVATION_DAYS, type QuoteQualityReason } from './marketData/quoteQuality.ts'

// ── Observation QA — review-required reason vocabulary (Phase 9E) ───────────
//
// Every observation evaluation reports WHY it needs a human's eyes, using a
// fixed, structured vocabulary rather than an ad-hoc string, so the API/UI can
// filter and count reasons instead of pattern-matching free text. The
// human-readable `reviewReason` string (kept for backward compatibility) is
// derived FROM this list, never authored independently of it.
export type ReviewRequiredReason =
  | 'missing_price'
  | 'stale_price'
  | 'unsupported_symbol'
  | 'provider_error'
  | 'large_price_move_warning'
  | 'provider_disagreement'
  | 'market_not_settled'
  | 'final_observation_requires_official_verification'
  | 'non_trading_day_or_unavailable_close'
  | 'ambiguous_underlying_mapping'

/** Per-symbol quote metadata a caller (the monitoring cron route) can optionally supply so evaluators can distinguish "why" a price is missing/suspect, instead of only knowing that it is. Omitting this param preserves the exact pre-9E behavior (reasons collapse to missing_price/ambiguous_underlying_mapping only). */
export interface QuoteMetaEntry {
  asOf: string | null
  supported: boolean
  providerError: boolean
  /** Quality reasons already computed upstream (e.g. by resolveStructuredNoteQuotes / classifyQuoteQuality) for this symbol. */
  qualityReasons?: QuoteQualityReason[]
  /** Set when the provider/caller has positive evidence the valuation date was a non-trading day or the close is otherwise structurally unavailable (distinct from a plain provider miss). */
  nonTradingDay?: boolean
}

const REVIEW_REASON_TEXT: Record<ReviewRequiredReason, string> = {
  missing_price: 'one or more underlying prices unavailable',
  stale_price: 'one or more underlying prices are stale (older than the observation freshness threshold)',
  unsupported_symbol: 'one or more underlyings have no supported/verified market-data symbol',
  provider_error: 'the market-data provider returned an error for one or more underlyings',
  large_price_move_warning: 'one or more underlyings moved further than the large-move threshold since the prior snapshot — verify before trusting',
  provider_disagreement: 'multiple providers disagreed on a price beyond the configured threshold',
  market_not_settled: 'one or more underlyings have a market session not yet confirmed closed, or a closing print too recent to trust — waiting for a settled close',
  final_observation_requires_official_verification: 'final redemption is a legal determination — verify against an official calculation-agent or closing-price source before treating as final',
  non_trading_day_or_unavailable_close: 'the valuation-date close is unavailable (non-trading day, provider gap, or no snapshot recorded for that date)',
  ambiguous_underlying_mapping: 'one or more underlyings have no resolved market-data symbol (ambiguous or unverified mapping)',
}

function reasonsToText(reasons: ReviewRequiredReason[]): string | null {
  if (reasons.length === 0) return null
  return reasons.map((r) => REVIEW_REASON_TEXT[r]).join('; ')
}

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
  /** Phase 9E quote-quality metadata (provider, sourceType, quality level/reasons, staleness, warning) — written into the price snapshot's existing `metadata jsonb` column. */
  metadata?: Record<string, unknown>
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
 * observation by more than a trading week. `quoteMeta` (optional, Phase 9E)
 * carries the quality classification computed at fetch time so it can be
 * persisted alongside the price without a second lookup.
 */
export function calculateStructuredNoteSnapshot(
  note: Pick<StructuredNote, 'id' | 'underlyings'>,
  latestPrices: Map<string, number>,
  asOf: string,
  quoteMeta?: Map<string, QuoteMetaEntry>,
): PriceSnapshotRow[] {
  if (!note.id) return []
  return note.underlyings.map((u) => {
    const price = priceForUnderlying(u, latestPrices)
    const meta = u.yahooSymbol ? quoteMeta?.get(u.yahooSymbol) : undefined
    return {
      noteId: note.id!,
      underlyingId: u.id ?? '',
      underlyingOrder: u.underlyingOrder,
      priceDate: asOf,
      price,
      source: price !== null ? 'yahoo-finance' : 'unavailable',
      sourceSymbol: u.yahooSymbol,
      metadata: meta
        ? {
            provider: MONITORING_METADATA_PROVIDER_ID,
            sourceType: 'free_monitoring_estimate',
            asOf: meta.asOf,
            supported: meta.supported,
            providerError: meta.providerError,
            qualityReasons: meta.qualityReasons ?? [],
          }
        : undefined,
    }
  })
}

/** Matches yahooStructuredNoteProvider's YAHOO_PROVIDER_ID — duplicated here (not imported) to keep this pure module free of any provider-implementation import. */
const MONITORING_METADATA_PROVIDER_ID = 'yahoo-finance'

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
//
// R13.7 — REWRITTEN. Two structural changes:
//
//  1. Every contractual test now runs through the canonical engine in
//     `contractualEvents.ts`. Previously each evaluator re-implemented its own
//     comparison, and the coupon evaluator hardcoded `autocallEligible: null`
//     — so a coupon-typed observation could never report the call test even in
//     principle.
//
//  2. Prices arrive as CLOSES FOR THE OBSERVATION'S OWN VALUATION DATE, keyed
//     by `underlyingOrder`, not as a symbol-keyed map of whatever the run just
//     fetched. The old signature accepted `latestPrices` and used it for any
//     due observation regardless of age, so a missed run silently decided a
//     past contractual date with a later day's price. That input no longer
//     exists here, which makes the mistake unrepresentable rather than merely
//     corrected (see `valuationClose.ts`).

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
  /** Structured reason codes underlying `reviewReason` — see ReviewRequiredReason. Empty when reviewRequired is false. */
  reviewReasons: ReviewRequiredReason[]
  /** R13.7 — the canonical event result this evaluation was derived from, so a caller never has to re-derive contract logic to render it. */
  event: ContractualEventEvaluation | null
  /** R13.7 — the binding (worst-cushion) underlying for this test, by normalized distance to its own threshold. */
  bindingUnderlying: string | null
  bindingCushionPct: number | null
}

/** `outcome` → the tri-state boolean the persistence layer and UI already speak. `unknown` stays null — never coerced to false. */
function outcomeToBoolean(outcome: EventOutcome): boolean | null {
  if (outcome === 'met') return true
  if (outcome === 'not_met') return false
  return null
}

function observedLevelsFromResolved(resolved: readonly ResolvedValuationClose[]): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const r of resolved) out[r.underlyingName] = r.close
  return out
}

/** Describes where the evaluated levels came from, so a persisted observation records its own evidence tier rather than a generic provider label. */
function observedSourceFor(resolved: readonly ResolvedValuationClose[], suffix = ''): string {
  const tiers = new Set(resolved.map((r) => r.source))
  const base = tiers.has('persisted_snapshot') && tiers.has('provider_history')
    ? 'valuation-date close (persisted snapshot + provider history)'
    : tiers.has('persisted_snapshot')
      ? 'valuation-date close (persisted snapshot)'
      : tiers.has('provider_history')
        ? 'valuation-date close (provider history)'
        : 'valuation-date close unavailable'
  // The provenance disclaimer is part of the string itself so a persisted
  // observation can never be read as an official determination.
  return base + ' — monitoring estimate' + suffix
}

/**
 * Worst performer by PERFORMANCE vs initial level — retained unchanged for the
 * existing `worst_performer_*` columns. Note this is a different question from
 * the binding leg of a specific test (which measures cushion to THAT test's
 * threshold); both are reported because they answer different things.
 */
function worstPerformerFromResolved(
  underlyings: StructuredNoteUnderlying[],
  resolved: readonly ResolvedValuationClose[],
): { ticker: string | null; ret: number | null } {
  const prices: UnderlyingPrice[] = underlyings.map((u) => {
    const r = resolved.find((x) => x.underlyingOrder === u.underlyingOrder)
    return {
      underlyingOrder: u.underlyingOrder,
      yahooSymbol: u.yahooSymbol,
      price: r?.close ?? null,
      source: r?.close != null ? 'valuation-date-close' : 'unavailable',
      sourceSymbol: u.yahooSymbol,
      asOf: null,
    }
  })
  const worst = calculateWorstPerformer(underlyings, prices)
  return { ticker: worst?.underlyingName ?? null, ret: worst?.performance ?? null }
}

/**
 * Structured review reasons for a DUE observation, derived from how each
 * underlying's valuation-date close actually resolved.
 *
 * A missing close is `non_trading_day_or_unavailable_close` rather than
 * `missing_price`: for a past contractual date the question is not "is today's
 * quote stale" but "does a close for THAT date exist at all". Cross-source
 * disagreement beyond tolerance is surfaced as `provider_disagreement` so a
 * mismatch forces human review instead of a silent pick-one.
 */
function reviewReasonsForResolved(
  resolved: readonly ResolvedValuationClose[],
  quoteMeta: Map<string, QuoteMetaEntry> | undefined,
  underlyings: StructuredNoteUnderlying[],
  liveQuoteDate?: string,
): ReviewRequiredReason[] {
  const reasons = new Set<ReviewRequiredReason>()
  for (const r of resolved) {
    const u = underlyings.find((x) => x.underlyingOrder === r.underlyingOrder)
    const meta = u?.yahooSymbol ? quoteMeta?.get(u.yahooSymbol) : undefined

    if (r.close === null) {
      if (r.unavailableReason === 'unsupported_symbol' || meta?.supported === false) reasons.add('unsupported_symbol')
      else if (meta?.providerError) reasons.add('provider_error')
      else reasons.add('non_trading_day_or_unavailable_close')
      continue
    }

    // A cross-source mismatch is never resolved by silently picking a tier.
    if (r.disagreementPct !== null && r.disagreementPct > CLOSE_DISAGREEMENT_TOLERANCE) reasons.add('provider_disagreement')

    // LIVE-QUOTE quality applies only to a close that IS the live quote — i.e.
    // an observation whose valuation date is the date `quoteMeta` describes.
    // This is what keeps § 25 honest: when the run fires before the session has
    // settled, TODAY'S observation is flagged `market_not_settled` and defers
    // rather than being decided on an intraday level. For a PAST valuation date
    // the close comes from a recorded snapshot or provider history, so today's
    // freshness says nothing about it and must not be attached.
    const describesThisClose = liveQuoteDate === undefined || r.valuationDate === liveQuoteDate
    if (meta && describesThisClose) {
      if (isQuoteStale(meta.asOf, new Date().toISOString(), STALE_THRESHOLD_OBSERVATION_DAYS)) reasons.add('stale_price')
      if (meta.qualityReasons?.includes('large_price_move_warning')) reasons.add('large_price_move_warning')
      if (meta.qualityReasons?.includes('provider_disagreement')) reasons.add('provider_disagreement')
      if (meta.qualityReasons?.includes('market_not_settled')) reasons.add('market_not_settled')
    }
  }
  for (const u of underlyings) {
    if (!u.yahooSymbol) reasons.add('ambiguous_underlying_mapping')
  }
  return [...reasons]
}

/** Shared skeleton for every observation evaluator — one place that assembles the persisted shape from a canonical event result. */
function baseEvaluation(
  note: Pick<StructuredNote, 'underlyings'>,
  observation: StructuredNoteObservation,
  resolved: readonly ResolvedValuationClose[],
  event: ContractualEventEvaluation,
  reasons: ReviewRequiredReason[],
  sourceSuffix = '',
): Omit<ObservationEvaluation, 'couponEligible' | 'autocallEligible' | 'finalBarrierBreached' | 'reviewRequired' | 'reviewReason' | 'reviewReasons'> {
  const { ticker, ret } = worstPerformerFromResolved(note.underlyings, resolved)
  void reasons
  return {
    observationId: observation.id,
    observationType: observation.observationType,
    due: true,
    observedAt: new Date().toISOString(),
    observedSource: observedSourceFor(resolved, sourceSuffix),
    observedLevels: observedLevelsFromResolved(resolved),
    worstPerformerTicker: ticker,
    worstPerformerReturn: ret,
    event,
    bindingUnderlying: event.bindingLeg?.underlyingName ?? null,
    bindingCushionPct: event.bindingLeg?.relativeToThresholdPct ?? null,
  }
}

/** Contingent coupon: every underlying at/above ITS OWN coupon barrier on the valuation date. */
export function evaluateCouponObservation(
  note: Pick<StructuredNote, 'underlyings'>,
  observation: StructuredNoteObservation,
  resolved: readonly ResolvedValuationClose[],
  quoteMeta?: Map<string, QuoteMetaEntry>,
  liveQuoteDate?: string,
): ObservationEvaluation {
  const event = evaluateCouponEvent(note.underlyings, toCloseMap(resolved))
  const reasons = reviewReasonsForResolved(resolved, quoteMeta, note.underlyings, liveQuoteDate)
  const eligible = outcomeToBoolean(event.outcome)
  const reviewRequired = reasons.length > 0 || eligible === null
  return {
    ...baseEvaluation(note, observation, resolved, event, reasons),
    observationType: 'coupon',
    couponEligible: eligible,
    autocallEligible: null,
    finalBarrierBreached: null,
    reviewRequired,
    reviewReason: reviewRequired ? (reasonsToText(reasons) ?? 'coupon eligibility could not be determined') : null,
    reviewReasons: reasons,
  }
}

/**
 * Autocall / Mandatory Early Redemption: every underlying at/above ITS OWN
 * call level on the valuation date.
 *
 * This is the observation type allowed to drive an automatic status
 * transition (see shouldUpdateNoteStatus) — and only when `reviewRequired` is
 * false, i.e. every leg resolved cleanly from a valuation-date close.
 */
export function evaluateAutocallObservation(
  note: Pick<StructuredNote, 'underlyings'>,
  observation: StructuredNoteObservation,
  resolved: readonly ResolvedValuationClose[],
  quoteMeta?: Map<string, QuoteMetaEntry>,
  liveQuoteDate?: string,
): ObservationEvaluation {
  const event = evaluateAutocallEvent(note.underlyings, toCloseMap(resolved))
  const reasons = reviewReasonsForResolved(resolved, quoteMeta, note.underlyings, liveQuoteDate)
  const eligible = outcomeToBoolean(event.outcome)
  const reviewRequired = reasons.length > 0 || eligible === null
  return {
    ...baseEvaluation(note, observation, resolved, event, reasons),
    observationType: 'autocall',
    couponEligible: null,
    autocallEligible: eligible,
    finalBarrierBreached: null,
    reviewRequired,
    reviewReason: reviewRequired ? (reasonsToText(reasons) ?? 'autocall eligibility could not be determined') : null,
    reviewReasons: reasons,
  }
}

/**
 * Final/maturity observation: estimates the barrier outcome from the
 * valuation-date closes, but ALWAYS flags `reviewRequired` — the app has no
 * official calculation-agent feed, so the legal redemption amount can never be
 * treated as final here. Unchanged policy from Phase 9D.
 */
export function evaluateFinalObservation(
  note: Pick<StructuredNote, 'underlyings'>,
  observation: StructuredNoteObservation,
  resolved: readonly ResolvedValuationClose[],
  quoteMeta?: Map<string, QuoteMetaEntry>,
  liveQuoteDate?: string,
): ObservationEvaluation {
  const event = evaluateKnockInEvent(note.underlyings, toCloseMap(resolved))
  const reasons = reviewReasonsForResolved(resolved, quoteMeta, note.underlyings, liveQuoteDate)
  reasons.push('final_observation_requires_official_verification')
  return {
    ...baseEvaluation(note, observation, resolved, event, reasons, ', not an official calculation-agent close'),
    observationType: 'final',
    couponEligible: null,
    autocallEligible: null,
    // `met` means protection held, so a barrier EVENT is the negation.
    // `unknown` stays null rather than becoming "no breach" (§ 9).
    finalBarrierBreached: isBarrierEvent(event),
    reviewRequired: true,
    reviewReason: reasonsToText(reasons),
    reviewReasons: reasons,
  }
}

/**
 * Dispatches to the correct evaluator for an observation that is due (its
 * valuation date is on or before `asOf`) and still `scheduled`. Returns null
 * for an observation that isn't due yet or has already been finalized.
 *
 * `resolved` MUST be the closes for `observation.valuationDate` — build it
 * with `resolveValuationCloses(...)`, which is the only supported way to
 * obtain one.
 */
export function evaluateObservation(
  note: Pick<StructuredNote, 'underlyings'>,
  observation: StructuredNoteObservation,
  resolved: readonly ResolvedValuationClose[],
  asOf: string,
  quoteMeta?: Map<string, QuoteMetaEntry>,
): ObservationEvaluation | null {
  if (observation.status !== 'scheduled') return null
  const valDate = Date.parse(observation.valuationDate)
  const asOfDate = Date.parse(asOf)
  if (Number.isNaN(valDate) || Number.isNaN(asOfDate) || valDate > asOfDate) return null

  if (observation.observationType === 'coupon') return evaluateCouponObservation(note, observation, resolved, quoteMeta, asOf)
  if (observation.observationType === 'autocall') return evaluateAutocallObservation(note, observation, resolved, quoteMeta, asOf)
  return evaluateFinalObservation(note, observation, resolved, quoteMeta, asOf)
}

// ── Status transitions ───────────────────────────────────────────────────────

export interface NoteStatusUpdate {
  newStatus: NoteStatus
  reason: string
}

/**
 * Whether a note's status should transition as a result of an observation
 * evaluation. Conservative by design:
 *   - Autocall eligible + every leg resolved from a valuation-date close ->
 *     'autocalled'. The barrier math is exact and a settled close is an
 *     adequate signal for a binary "at/above the level" check.
 *   - Final observation with a barrier breach is NEVER auto-transitioned to
 *     'matured' — the legal payoff requires manual verification.
 *   - An already-archived note is never touched.
 *
 * TERMINAL: a call derives from a contractual event on a fixed date, so no
 * later price movement can reverse it — there is no input here through which
 * it could (§ 11).
 */
export function shouldUpdateNoteStatus(
  note: Pick<StructuredNote, 'status'>,
  observationResult: ObservationEvaluation,
): NoteStatusUpdate | null {
  if (ARCHIVED_STATUSES.includes(note.status)) return null
  if (observationResult.observationType === 'autocall' && observationResult.autocallEligible === true && !observationResult.reviewRequired) {
    return { newStatus: 'autocalled', reason: 'Autocall condition met on the contractual autocall valuation date (all underlyings at or above their respective call levels, evaluated on that date’s closes).' }
  }
  return null
}

/**
 * Maps an observation evaluation to its resulting `ObservationStatus`. Only
 * transitions away from `scheduled` when the outcome is deterministic and
 * complete; anything reviewRequired (an unresolved valuation-date close, or
 * any final/maturity observation) lands on `observed` — evaluated, but not
 * finalized — never silently left at `scheduled` (which would look untouched)
 * nor jumped to a terminal status the app cannot vouch for.
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
