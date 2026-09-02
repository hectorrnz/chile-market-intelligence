// R13.7 — THE canonical contractual event engine for Structured Notes.
//
// PURE MODULE. No Supabase, no provider, no Next.js imports — directly
// testable under plain `node --test`.
//
// WHY THIS MODULE EXISTS
// ──────────────────────
// Before R13.7 the contractual tests were spread across the parsers (which
// decided what an observation *was*), monitoring.ts (which decided what it
// *meant*), and the detail page (which decided how it *looked*). The three
// disagreed, and the disagreement was invisible: a note whose autocall
// condition was contractually satisfied on 2026-08-28 was persisted as a
// coupon-only observation, evaluated only against the 65% coupon barrier, and
// rendered as a green "Eligible" — while the 100% call test was never run at
// all (R13.7 § 1).
//
// From here, ONE function evaluates each contractual condition and every
// consumer — note status, Observation Schedule, Current Levels, distance
// metrics, chart reference lines, notifications, cron — formats that single
// result. Presentation never re-derives contract logic (§ 17).
//
// AGGREGATION: ALL-UNDERLYINGS, EACH AGAINST ITS OWN LEVEL
// ────────────────────────────────────────────────────────
// Confirmed from the issuer's own term-sheet language for the families in
// production:
//
//   Coupon Barrier Level    For each Underlying, 65.00% of its respective Initial Level
//   Autocall Barrier Level  For each Underlying, 100.00% of its respective Initial Level
//
// "For each Underlying … its respective Initial Level" is an ALL condition
// evaluated per underlying against that underlying's OWN level. Two indices
// are NEVER compared to each other by raw price — SPX at 7711 and RTY at 2972
// say nothing about relative performance; only each level's relationship to
// its own threshold does. The binding ("worst-of") underlying is the one with
// the smallest normalized cushion, never the smallest absolute price.
//
// No ANY/OR aggregation exists here. None of the production contracts uses
// one, and speculative architecture for a structure this book does not hold
// would be untested surface (§ 8).

import type { StructuredNoteUnderlying } from './types.ts'

/** Returns n only if it is a finite real number, else null. */
function finite(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * The outcome of a contractual test.
 *
 * `unknown` is a first-class result, not an error: a missing valuation-date
 * close must never collapse into "not met" (§ 9). A note is not "not called"
 * because the data was unavailable — it is UNDETERMINED, and a human decides.
 */
export type EventOutcome = 'met' | 'not_met' | 'unknown'

/** Which contractual test a result belongs to. */
export type ContractualEventKind = 'coupon' | 'autocall' | 'knock_in' | 'final'

export type LegUnavailableReason = 'missing_close' | 'missing_threshold'

/** One underlying's contribution to a contractual test. */
export interface LegEvaluation {
  underlyingOrder: number
  underlyingName: string
  close: number | null
  threshold: number | null
  /** null when the leg could not be determined — never coerced to false. */
  met: boolean | null
  /**
   * `close / threshold - 1`. How far the level sits ABOVE (+) or BELOW (−) the
   * threshold, as a fraction. This is the CUSHION, and it is the only
   * cross-underlying comparable quantity (§ 15 metric A).
   */
  relativeToThresholdPct: number | null
  /**
   * `threshold / close - 1`. The market MOVE from here to the threshold.
   * Negative when the level must FALL to reach the threshold (§ 15 metric B).
   *
   * Deliberately NOT the negation of `relativeToThresholdPct` — they have
   * different denominators and differ in magnitude (for XS3164820824's SPX:
   * +1.9359% vs −1.8992%). Conflating them is the labelling bug § 15 targets.
   */
  moveToThresholdPct: number | null
  unavailableReason: LegUnavailableReason | null
}

export interface ContractualEventEvaluation {
  kind: ContractualEventKind
  outcome: EventOutcome
  legs: LegEvaluation[]
  /**
   * The binding underlying: the smallest `relativeToThresholdPct` among legs
   * with data — i.e. the weakest normalized cushion, the leg that decides an
   * ALL condition. Null when no leg has data.
   */
  bindingLeg: LegEvaluation | null
  /** Legs that could not be determined; empty when `outcome` is not `unknown`. */
  undeterminedLegs: LegEvaluation[]
}

/** Which contractual level a test compares against, read off the underlying. */
export type ThresholdSelector = (u: StructuredNoteUnderlying) => number | null

export const COUPON_THRESHOLD: ThresholdSelector = (u) => u.couponBarrierLevel
export const AUTOCALL_THRESHOLD: ThresholdSelector = (u) => u.autocallBarrierLevel
export const KNOCK_IN_THRESHOLD: ThresholdSelector = (u) => u.knockInBarrierLevel

/** Cushion: `close / threshold - 1`. Null when either side is missing or the threshold is zero. */
export function relativeToThreshold(close: number | null, threshold: number | null): number | null {
  const c = finite(close)
  const t = finite(threshold)
  if (c === null || t === null || t === 0) return null
  const v = c / t - 1
  return Number.isFinite(v) ? v : null
}

/** Required market move: `threshold / close - 1`. Null when either side is missing or the close is zero. */
export function moveToThreshold(close: number | null, threshold: number | null): number | null {
  const c = finite(close)
  const t = finite(threshold)
  if (c === null || t === null || c === 0) return null
  const v = t / c - 1
  return Number.isFinite(v) ? v : null
}

/**
 * Evaluates one leg against its own contractual threshold.
 *
 * The comparison is `close >= threshold`, inclusive, because the contracts in
 * production say "equal to or greater than its respective … Level". An exact
 * touch of the level SATISFIES the condition.
 */
export function evaluateLeg(u: StructuredNoteUnderlying, close: number | null, threshold: number | null): LegEvaluation {
  const c = finite(close)
  const t = finite(threshold)
  const base = {
    underlyingOrder: u.underlyingOrder,
    underlyingName: u.underlyingName,
    close: c,
    threshold: t,
    relativeToThresholdPct: relativeToThreshold(c, t),
    moveToThresholdPct: moveToThreshold(c, t),
  }
  if (t === null) return { ...base, met: null, unavailableReason: 'missing_threshold' }
  if (c === null) return { ...base, met: null, unavailableReason: 'missing_close' }
  return { ...base, met: c >= t, unavailableReason: null }
}

/**
 * The ALL-underlyings (worst-of) contractual condition.
 *
 * OUTCOME RULES, in order:
 *   1. Any leg DEFINITIVELY below its own threshold  → `not_met`.
 *      This is a real determination, not a data gap: an ALL condition is
 *      already broken by one confirmed failure, whatever the other legs did.
 *      Short-circuiting here is what lets a partially-priced observation still
 *      reach a correct negative answer instead of a spurious `unknown`.
 *   2. Otherwise any leg undetermined              → `unknown`.
 *      Never `not_met`. A missing close is the § 9 trap: it must never be
 *      reported as "not called" or "not breached".
 *   3. Otherwise (every leg present and at/above)   → `met`.
 *
 * `closesByOrder` maps `underlyingOrder` → the level to test. The caller
 * decides what that level IS (the valuation-date official close for a
 * contractual observation; the latest close for a T-1 projection) — this
 * function never reaches for a price itself, which is exactly why the same
 * code can serve both without one silently using the other's data.
 */
export function evaluateAllUnderlyingCondition(
  underlyings: StructuredNoteUnderlying[],
  closesByOrder: ReadonlyMap<number, number | null>,
  threshold: ThresholdSelector,
  kind: ContractualEventKind,
): ContractualEventEvaluation {
  const legs = underlyings.map((u) => evaluateLeg(u, closesByOrder.get(u.underlyingOrder) ?? null, threshold(u)))

  const withData = legs.filter((l) => l.relativeToThresholdPct !== null)
  const bindingLeg = withData.length > 0
    ? withData.reduce((worst, l) => (l.relativeToThresholdPct! < worst.relativeToThresholdPct! ? l : worst))
    : null
  const undeterminedLegs = legs.filter((l) => l.met === null)

  let outcome: EventOutcome
  if (underlyings.length === 0) outcome = 'unknown'
  else if (legs.some((l) => l.met === false)) outcome = 'not_met'
  else if (undeterminedLegs.length > 0) outcome = 'unknown'
  else outcome = 'met'

  return { kind, outcome, legs, bindingLeg, undeterminedLegs: outcome === 'unknown' ? undeterminedLegs : [] }
}

/** Contingent coupon: every underlying at/above ITS OWN coupon barrier. */
export function evaluateCouponEvent(underlyings: StructuredNoteUnderlying[], closesByOrder: ReadonlyMap<number, number | null>): ContractualEventEvaluation {
  return evaluateAllUnderlyingCondition(underlyings, closesByOrder, COUPON_THRESHOLD, 'coupon')
}

/**
 * Autocall / Mandatory Early Redemption: every underlying at/above ITS OWN
 * autocall barrier (100% of its initial level for the families in production).
 *
 * A CONTRACTUALLY DISTINCT TEST from the coupon, even when the two valuation
 * dates coincide. Collapsing them is the R13.7 root cause.
 */
export function evaluateAutocallEvent(underlyings: StructuredNoteUnderlying[], closesByOrder: ReadonlyMap<number, number | null>): ContractualEventEvaluation {
  return evaluateAllUnderlyingCondition(underlyings, closesByOrder, AUTOCALL_THRESHOLD, 'autocall')
}

/**
 * Knock-in / barrier test at final observation.
 *
 * Reported in the SAME polarity as every other event: `met` means every
 * underlying is at/above its knock-in level, i.e. the protection HELD. A
 * barrier EVENT is therefore `outcome === 'not_met'` — and `unknown` stays
 * unknown rather than becoming "no breach" (§ 9).
 */
export function evaluateKnockInEvent(underlyings: StructuredNoteUnderlying[], closesByOrder: ReadonlyMap<number, number | null>): ContractualEventEvaluation {
  return evaluateAllUnderlyingCondition(underlyings, closesByOrder, KNOCK_IN_THRESHOLD, 'knock_in')
}

/** True when a knock-in evaluation is a genuine barrier event; null when undetermined — never false-on-missing-data. */
export function isBarrierEvent(knockIn: ContractualEventEvaluation): boolean | null {
  if (knockIn.outcome === 'unknown') return null
  return knockIn.outcome === 'not_met'
}

// ── Lifecycle derivation ─────────────────────────────────────────────────────

/**
 * Settlement of a called note (§ 11–12).
 *
 * `pending`  — the autocall condition is contractually satisfied, but the
 *              Mandatory Early Redemption Date has not arrived: the position
 *              is no longer exposed to the underlyings, yet the money is still
 *              at the issuer. Notional is STILL OUTSTANDING.
 * `settled`  — the redemption date has passed; proceeds are treated as paid
 *              and the notional leaves the book.
 * `unknown`  — the contract's redemption date is unrecorded, so the platform
 *              cannot assert settlement either way. Treated as `pending` for
 *              exposure purposes, which is the conservative direction: it
 *              keeps issuer exposure visible rather than silently erasing it.
 */
export type SettlementStatus = 'pending' | 'settled' | 'unknown'

export function deriveSettlementStatus(redemptionDate: string | null, asOf: string): SettlementStatus {
  if (!redemptionDate) return 'unknown'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(redemptionDate) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return 'unknown'
  return asOf >= redemptionDate ? 'settled' : 'pending'
}

/** One evaluated contractual observation, in the shape lifecycle derivation needs. */
export interface EvaluatedObservationSummary {
  valuationDate: string
  /** The Mandatory Early Redemption / payment date tied to THIS observation. */
  redemptionDate: string | null
  coupon: ContractualEventEvaluation | null
  autocall: ContractualEventEvaluation | null
  final: ContractualEventEvaluation | null
}

export interface NoteLifecycle {
  /** `autocalled` once an autocall condition is met; otherwise unchanged from the live state. */
  status: 'active' | 'autocalled' | 'matured'
  /** The contractual valuation date on which the call/maturity occurred. Null while live. */
  effectiveDate: string | null
  /** The Mandatory Early Redemption date tied to the calling observation. Null while live or unrecorded. */
  redemptionDate: string | null
  settlement: SettlementStatus
  /** Valuation dates strictly after `effectiveDate` — no longer live observations (§ 11). */
  voidedAfter: string | null
}

/**
 * Derives lifecycle state from evaluated observations, with EXPLICIT precedence.
 *
 * PRECEDENCE
 *   1. The EARLIEST autocall whose condition is `met` terminates the note.
 *      Earliest, not latest: once called, the note ceased to exist, so a later
 *      observation is not a live contractual event at all. Every observation
 *      after that date is voided.
 *   2. Otherwise, a `final` observation that has been evaluated matures it.
 *   3. Otherwise the note is live.
 *
 * `unknown` NEVER terminates a note and never keeps it alive on its own — an
 * undetermined observation simply does not participate, and is surfaced for
 * review by the caller instead.
 *
 * A call is TERMINAL: this function derives status from contractual events
 * only, so a later price move cannot "uncall" a note — there is no input
 * through which it could (§ 11).
 */
export function deriveNoteLifecycle(observations: EvaluatedObservationSummary[], asOf: string): NoteLifecycle {
  const sorted = [...observations].sort((a, b) => (a.valuationDate < b.valuationDate ? -1 : a.valuationDate > b.valuationDate ? 1 : 0))

  const called = sorted.find((o) => o.autocall?.outcome === 'met') ?? null
  if (called) {
    return {
      status: 'autocalled',
      effectiveDate: called.valuationDate,
      redemptionDate: called.redemptionDate,
      settlement: deriveSettlementStatus(called.redemptionDate, asOf),
      voidedAfter: called.valuationDate,
    }
  }

  const matured = sorted.find((o) => o.final !== null && o.final.outcome !== 'unknown') ?? null
  if (matured) {
    return {
      status: 'matured',
      effectiveDate: matured.valuationDate,
      redemptionDate: matured.redemptionDate,
      settlement: deriveSettlementStatus(matured.redemptionDate, asOf),
      voidedAfter: matured.valuationDate,
    }
  }

  return { status: 'active', effectiveDate: null, redemptionDate: null, settlement: 'unknown', voidedAfter: null }
}

/** True when an observation's valuation date falls strictly after a terminal event and is therefore no longer a live contractual observation. */
export function isVoidedByLifecycle(valuationDate: string, lifecycle: NoteLifecycle): boolean {
  if (lifecycle.voidedAfter === null) return false
  return valuationDate > lifecycle.voidedAfter
}
