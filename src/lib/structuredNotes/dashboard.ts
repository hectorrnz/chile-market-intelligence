// Phase 9B — Structured Notes dashboard aggregation (pure).
//
// Given the shared book of notes + a symbol→price map (fetched once), compute
// per-note live status/metrics and a book-level summary — the same view the
// legacy workbook gave (how many live, in/out of the money, about to autocall,
// exposure by issuer). No Supabase/Yahoo imports here → directly testable.
//
// Never fabricates: a note with no available prices reports `unavailable`,
// never a fake status or distance.

import type { StructuredNote, UnderlyingPrice, RiskStatus } from './types.ts'
import {
  calculateCurrentRiskStatus,
  calculateWorstPerformer,
  calculateCurrentNotional,
  calculateNextObservation,
  calculateDaysToNextObservation,
  calculateDistanceToBarrier,
  calculateIssuerExposure,
  calculateEntityExposure,
} from './calculations.ts'
import { ARCHIVED_STATUSES } from './types.ts'

export interface NoteDashboardMetrics {
  noteId: string | undefined
  riskStatus: RiskStatus
  worstPerformer: { underlyingName: string; performance: number | null } | null
  /** Smallest headroom to a coupon barrier across underlyings (closest to breaching). Null if no prices. */
  minDistanceToCouponBarrier: number | null
  currentNotional: number
  currency: string
  nextObservationDate: string | null
  daysToNextObservation: number | null
  pricesAvailable: boolean
}

export interface BookSummary {
  totalNotes: number
  activeNotes: number
  calledNotes: number // status autocalled/matured/etc — archived off the live book
  autocallableNotes: number // all underlyings ≥ autocall barrier → would call on next date
  safeNotes: number
  watchNotes: number
  breachedNotes: number
  unavailableNotes: number
  totalCurrentNotional: number // in the dominant currency; mixed currencies flagged
  currency: string
  mixedCurrency: boolean
  issuerExposure: { issuer: string; notional: number; noteCount: number }[]
  entityExposure: { entityName: string; notional: number; noteCount: number }[]
  pricesAsOf: string | null
}

/** Builds one UnderlyingPrice[] for a note from the shared price map. */
function pricesForNote(note: StructuredNote, priceMap: Map<string, number>, asOf: string | null): UnderlyingPrice[] {
  return note.underlyings.map((u): UnderlyingPrice => {
    const sym = u.yahooSymbol
    const price = sym ? priceMap.get(sym) ?? null : null
    return {
      underlyingOrder: u.underlyingOrder,
      yahooSymbol: sym,
      price: price !== null && Number.isFinite(price) ? price : null,
      source: price !== null ? 'yahoo-finance' : 'unavailable',
      sourceSymbol: sym,
      asOf: price !== null ? asOf : null,
    }
  })
}

export function computeNoteMetrics(note: StructuredNote, priceMap: Map<string, number>, asOf: string | null, today: string): NoteDashboardMetrics {
  const prices = pricesForNote(note, priceMap, asOf)
  const riskStatus = calculateCurrentRiskStatus(note, prices)
  const worst = calculateWorstPerformer(note.underlyings, prices)

  let minDist: number | null = null
  for (const u of note.underlyings) {
    const p = prices.find((x) => x.underlyingOrder === u.underlyingOrder)?.price ?? null
    const d = calculateDistanceToBarrier(p, u.couponBarrierLevel)
    // distance is negative when price is above barrier (headroom); the value
    // closest to 0 (or positive) is the most at-risk underlying.
    if (d !== null && (minDist === null || d > minDist)) minDist = d
  }

  const next = calculateNextObservation(note.observations, today)
  return {
    noteId: note.id,
    riskStatus,
    worstPerformer: worst ? { underlyingName: worst.underlyingName, performance: worst.performance } : null,
    minDistanceToCouponBarrier: minDist,
    currentNotional: calculateCurrentNotional(note, note.allocations),
    currency: note.currency,
    nextObservationDate: next?.valuationDate ?? null,
    daysToNextObservation: calculateDaysToNextObservation(note.observations, today),
    pricesAvailable: prices.some((p) => p.price !== null),
  }
}

export function buildBookDashboard(
  notes: StructuredNote[],
  priceMap: Map<string, number>,
  asOf: string | null,
  today: string,
): { metrics: NoteDashboardMetrics[]; summary: BookSummary } {
  const metrics = notes.map((n) => computeNoteMetrics(n, priceMap, asOf, today))

  const active = notes.filter((n) => n.status === 'active')
  const currencies = new Set(active.map((n) => n.currency))
  const dominant = active[0]?.currency ?? 'USD'
  let totalNotional = 0
  for (const n of active) totalNotional += calculateCurrentNotional(n, n.allocations)

  const count = (s: RiskStatus) => metrics.filter((m) => m.riskStatus === s).length

  const summary: BookSummary = {
    totalNotes: notes.length,
    activeNotes: active.length,
    calledNotes: notes.filter((n) => ARCHIVED_STATUSES.includes(n.status)).length,
    autocallableNotes: count('autocallable'),
    safeNotes: count('safe'),
    watchNotes: count('watch'),
    breachedNotes: count('breached'),
    unavailableNotes: count('unavailable'),
    totalCurrentNotional: totalNotional,
    currency: dominant,
    mixedCurrency: currencies.size > 1,
    issuerExposure: calculateIssuerExposure(notes.map((n) => ({ issuerDisplayName: n.issuerDisplayName, status: n.status, allocations: n.allocations }))),
    entityExposure: calculateEntityExposure(notes.map((n) => ({ status: n.status, allocations: n.allocations }))),
    pricesAsOf: asOf,
  }
  return { metrics, summary }
}
