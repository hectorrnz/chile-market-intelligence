// Phase 9A — Structured Notes calculations (pure functions).
//
// Formula parity with the legacy workbook (see
// docs/structured_notes_workbook_mapping.md). No Next.js/Supabase imports —
// directly unit-testable under plain `node --test`.
//
// Hard rules (enforced by tests):
//   - Never returns NaN or Infinity — every guard funnels bad input to null.
//   - Missing market data yields `unavailable`/null, never a fabricated number.
//   - Worst-of logic: a note's status is driven by its weakest underlying.

import type {
  StructuredNote,
  StructuredNoteUnderlying,
  StructuredNoteObservation,
  StructuredNoteAllocation,
  UnderlyingPrice,
  RiskStatus,
} from './types.ts'

/** Returns n only if it is a finite real number, else null. */
function finite(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Barrier level = strike (or initial) × barrier pct. Workbook R28/R29: `=+strike*EKI`. */
export function calculateBarrierLevel(strikeOrInitial: number | null, barrierPct: number | null): number | null {
  const s = finite(strikeOrInitial)
  const p = finite(barrierPct)
  if (s === null || p === null) return null
  const v = s * p
  return Number.isFinite(v) ? v : null
}

/** Barrier pct = barrier level / strike. Inverse of the above. */
export function calculateBarrierPct(barrierLevel: number | null, strikeLevel: number | null): number | null {
  const b = finite(barrierLevel)
  const s = finite(strikeLevel)
  if (b === null || s === null || s === 0) return null
  const v = b / s
  return Number.isFinite(v) ? v : null
}

/**
 * Distance to barrier ("Caída a la Barrera"). Workbook R60/R62:
 * `=+barrierLevel/currentLevel - 1`. Negative when the current level is above
 * the barrier (i.e. the level must fall by |value| to reach the barrier).
 */
export function calculateDistanceToBarrier(currentLevel: number | null, barrierLevel: number | null): number | null {
  const c = finite(currentLevel)
  const b = finite(barrierLevel)
  if (c === null || b === null || c === 0) return null
  const v = b / c - 1
  return Number.isFinite(v) ? v : null
}

/** Performance = current / initial − 1. */
export function calculateUnderlyingPerformance(currentLevel: number | null, initialLevel: number | null): number | null {
  const c = finite(currentLevel)
  const i = finite(initialLevel)
  if (c === null || i === null || i === 0) return null
  const v = c / i - 1
  return Number.isFinite(v) ? v : null
}

/** Coupon annualized = periodic × frequency-per-year. Workbook R21: `=periodic*4`. */
export function calculateCouponAnnualized(periodic: number | null, periodsPerYear: number | null): number | null {
  const p = finite(periodic)
  const f = finite(periodsPerYear)
  if (p === null || f === null) return null
  const v = p * f
  return Number.isFinite(v) ? v : null
}

/** Maps a coupon frequency label to periods per year. Unknown → null. */
export function frequencyToPeriodsPerYear(frequency: string | null): number | null {
  if (!frequency) return null
  const f = frequency.toLowerCase()
  if (/quarter|trimestr/.test(f)) return 4
  if (/semi|semestr/.test(f)) return 2
  if (/month|mensual/.test(f)) return 12
  if (/annual|anual|year|yearly/.test(f)) return 1
  return null
}

export interface PerformanceRow {
  underlyingOrder: number
  underlyingName: string
  performance: number | null // current/initial − 1
}

/**
 * Worst performer = the underlying with the lowest (current/initial) performance
 * among those with available prices. Returns null if none are available.
 */
export function calculateWorstPerformer(
  underlyings: StructuredNoteUnderlying[],
  prices: UnderlyingPrice[],
): PerformanceRow | null {
  const rows: PerformanceRow[] = []
  for (const u of underlyings) {
    const price = prices.find((p) => p.underlyingOrder === u.underlyingOrder)
    const perf = calculateUnderlyingPerformance(price?.price ?? null, u.initialLevel)
    if (perf !== null) rows.push({ underlyingOrder: u.underlyingOrder, underlyingName: u.underlyingName, performance: perf })
  }
  if (rows.length === 0) return null
  return rows.reduce((worst, r) => (r.performance! < worst.performance! ? r : worst))
}

/** All underlyings at/above their coupon barrier level → coupon eligible. Missing data → null (unknown), never false. */
export function calculateCouponEligibility(
  underlyings: StructuredNoteUnderlying[],
  prices: UnderlyingPrice[],
): boolean | null {
  if (underlyings.length === 0) return null
  for (const u of underlyings) {
    const price = finite(prices.find((p) => p.underlyingOrder === u.underlyingOrder)?.price ?? null)
    const barrier = finite(u.couponBarrierLevel)
    if (price === null || barrier === null) return null
    if (price < barrier) return false
  }
  return true
}

/** All underlyings at/above their autocall barrier level → would autocall. Missing data → null. */
export function calculateAutocallEligibility(
  underlyings: StructuredNoteUnderlying[],
  prices: UnderlyingPrice[],
): boolean | null {
  if (underlyings.length === 0) return null
  for (const u of underlyings) {
    const price = finite(prices.find((p) => p.underlyingOrder === u.underlyingOrder)?.price ?? null)
    const barrier = finite(u.autocallBarrierLevel)
    if (price === null || barrier === null) return null
    if (price < barrier) return false
  }
  return true
}

export interface RedemptionEstimate {
  perNotePct: number | null // fraction of denomination expected back (1.0 = par)
  barrierEvent: boolean | null
  worstReturn: number | null
}

/**
 * Estimated redemption at maturity per the sample family's payoff:
 *   - If no Barrier Event (worst final level ≥ its knock-in barrier): par (100%).
 *   - If Barrier Event: par + worst-performing underlying's return (i.e. tracks the worst final level).
 * `finalLevels` maps underlyingOrder → final level. Missing data → nulls.
 */
export function calculateMaturityRedemptionAmount(
  note: Pick<StructuredNote, 'underlyings'>,
  finalLevels: Map<number, number>,
): RedemptionEstimate {
  const underlyings = note.underlyings
  if (underlyings.length === 0) return { perNotePct: null, barrierEvent: null, worstReturn: null }

  let barrierEvent: boolean | null = false
  let worstReturn: number | null = null

  for (const u of underlyings) {
    const finalLevel = finite(finalLevels.get(u.underlyingOrder) ?? null)
    const ki = finite(u.knockInBarrierLevel)
    const ret = calculateUnderlyingPerformance(finalLevel ?? null, u.strikeLevel ?? u.initialLevel)
    if (finalLevel === null || ki === null || ret === null) return { perNotePct: null, barrierEvent: null, worstReturn: null }
    if (finalLevel < ki) barrierEvent = true
    if (worstReturn === null || ret < worstReturn) worstReturn = ret
  }

  if (barrierEvent === false) return { perNotePct: 1, barrierEvent: false, worstReturn }
  const perNotePct = worstReturn === null ? null : Math.max(0, 1 + worstReturn)
  return { perNotePct: finite(perNotePct), barrierEvent, worstReturn }
}

/**
 * Live risk status from current levels. Worst-of: driven by the weakest
 * underlying. `watchBand` is how close (as a fraction above the coupon barrier)
 * still counts as "watch" rather than "safe" (default 5%).
 */
export function calculateCurrentRiskStatus(
  note: Pick<StructuredNote, 'underlyings' | 'status'>,
  prices: UnderlyingPrice[],
  watchBand = 0.05,
): RiskStatus {
  if (note.status === 'autocalled') return 'autocallable'
  if (note.status === 'matured' || note.status === 'cancelled') return 'unavailable'
  if (note.underlyings.length === 0) return 'unavailable'

  const autocall = calculateAutocallEligibility(note.underlyings, prices)
  if (autocall === true) return 'autocallable'

  let anyBreached = false
  let anyWatch = false
  let anyKnown = false
  for (const u of note.underlyings) {
    const price = finite(prices.find((p) => p.underlyingOrder === u.underlyingOrder)?.price ?? null)
    const couponBarrier = finite(u.couponBarrierLevel)
    if (price === null || couponBarrier === null || couponBarrier === 0) continue
    anyKnown = true
    if (price <= couponBarrier) anyBreached = true
    else if (price / couponBarrier - 1 <= watchBand) anyWatch = true
  }
  if (!anyKnown) return 'unavailable'
  if (anyBreached) return 'breached'
  if (anyWatch) return 'watch'
  return 'safe'
}

/** Next scheduled observation (valuation date strictly after asOf), earliest first. */
export function calculateNextObservation(
  observations: StructuredNoteObservation[],
  asOfDate: string,
): StructuredNoteObservation | null {
  const asOf = Date.parse(asOfDate)
  if (Number.isNaN(asOf)) return null
  const upcoming = observations
    .filter((o) => o.status === 'scheduled')
    .filter((o) => {
      const d = Date.parse(o.valuationDate)
      return !Number.isNaN(d) && d > asOf
    })
    .sort((a, b) => Date.parse(a.valuationDate) - Date.parse(b.valuationDate))
  return upcoming[0] ?? null
}

/** Whole days from asOf to the next observation's valuation date. Null if none. */
export function calculateDaysToNextObservation(
  observations: StructuredNoteObservation[],
  asOfDate: string,
): number | null {
  const next = calculateNextObservation(observations, asOfDate)
  if (!next) return null
  const asOf = Date.parse(asOfDate)
  const d = Date.parse(next.valuationDate)
  if (Number.isNaN(asOf) || Number.isNaN(d)) return null
  return Math.round((d - asOf) / 86_400_000)
}

/** Sum of active allocations. Workbook R51 `=SUM(...)`. */
export function calculateAllocationTotal(allocations: StructuredNoteAllocation[]): number {
  let total = 0
  for (const a of allocations) {
    if (!a.active) continue
    const n = finite(a.notionalAmount)
    if (n !== null) total += n
  }
  return total
}

/**
 * Current notional at risk. Workbook R52 `=IF(status="llamada",0,Total)`.
 * Called/matured/cancelled → 0; otherwise the active-allocation total.
 */
export function calculateCurrentNotional(
  note: Pick<StructuredNote, 'status'>,
  allocations: StructuredNoteAllocation[],
): number {
  if (note.status === 'autocalled' || note.status === 'matured' || note.status === 'cancelled') return 0
  return calculateAllocationTotal(allocations)
}

export interface IssuerExposure {
  issuer: string
  notional: number
  noteCount: number
}

/**
 * Exposure grouped by issuer display name. Workbook R66–R73:
 * `SUMIF(issuer, Monto Vigente)`. Uses each note's current notional.
 */
export function calculateIssuerExposure(
  notes: { issuerDisplayName: string | null; status: StructuredNote['status']; allocations: StructuredNoteAllocation[] }[],
): IssuerExposure[] {
  const byIssuer = new Map<string, IssuerExposure>()
  for (const n of notes) {
    const issuer = (n.issuerDisplayName ?? 'Unknown').trim() || 'Unknown'
    const notional = calculateCurrentNotional(n, n.allocations)
    const cur = byIssuer.get(issuer) ?? { issuer, notional: 0, noteCount: 0 }
    cur.notional += notional
    cur.noteCount += 1
    byIssuer.set(issuer, cur)
  }
  return [...byIssuer.values()].sort((a, b) => b.notional - a.notional)
}

export interface EntityExposure {
  entityName: string
  notional: number
  noteCount: number
}

/** Exposure grouped by internal entity/sociedad across all notes' active allocations. */
export function calculateEntityExposure(
  notes: { status: StructuredNote['status']; allocations: StructuredNoteAllocation[] }[],
): EntityExposure[] {
  const byEntity = new Map<string, EntityExposure>()
  for (const n of notes) {
    if (n.status === 'autocalled' || n.status === 'matured' || n.status === 'cancelled') continue
    for (const a of n.allocations) {
      if (!a.active) continue
      const amt = finite(a.notionalAmount)
      if (amt === null) continue
      const key = a.entityName.trim() || 'Unknown'
      const cur = byEntity.get(key) ?? { entityName: key, notional: 0, noteCount: 0 }
      cur.notional += amt
      cur.noteCount += 1
      byEntity.set(key, cur)
    }
  }
  return [...byEntity.values()].sort((a, b) => b.notional - a.notional)
}

/** Tenor in whole months between two ISO dates. Null if unparseable. */
export function calculateTenorMonths(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null
  const s = new Date(startDate)
  const e = new Date(endDate)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth())
  return months >= 0 ? months : null
}
