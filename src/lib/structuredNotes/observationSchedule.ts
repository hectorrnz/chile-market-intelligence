// R13.7B2.2 § 2 — PRESENTATION aggregation for the Observation Schedule.
//
// PURE MODULE. No Supabase, no provider, no Next.js, no i18n — directly
// testable under plain `node --test`. It returns display TOKENS, never
// localized strings, so the language layer stays in the component.
//
// WHY THIS MODULE EXISTS
// ──────────────────────
// R13.7 established that a contingent-coupon test and an autocall test are two
// DIFFERENT contractual conditions that merely share a valuation date, and
// `dedupeObservationsByDate` was fixed to stop collapsing them (its key is now
// `(valuationDate, observationType)`). That repair is correct and must not be
// undone — but the detail page then rendered one <tr> per canonical row, so a
// single contractual date appeared twice:
//
//     1  COUPON    2026-08-28  …
//     1  AUTOCALL  2026-08-28  …
//
// which exposes the internal event model instead of the contract. A term sheet
// has ONE Observation Date carrying both tests.
//
// THE SEPARATION THIS MODULE ENFORCES
// ───────────────────────────────────
//   contractual/economic  — a date carries a coupon test AND a call test.
//   canonical/persistence — two rows, two ids, two statuses. UNCHANGED. This
//                           module only READS them; nothing here merges,
//                           rewrites or drops a persisted observation.
//   presentation          — one row per valuation date, with the two outcomes
//                           side by side.
//
// So the canonical model keeps the ability to represent both outcomes (a coupon
// can be paid ON the date the note is called — the § 1 finding), while the
// owner sees the schedule the way the term sheet states it.

import type { StructuredNoteObservation, ObservationType } from './types.ts'

/**
 * The outcome of ONE contractual test on ONE valuation date, as displayed.
 *
 * `none` means the test does not exist on this date at all — which is a real
 * and important state today: production's observations were persisted without
 * any autocall rows (the R13.7 defect), so the call test genuinely never ran.
 * Rendering that as `—` is honest; rendering it as "not eligible" would not be.
 */
export type ScheduleOutcome =
  | 'paid'
  | 'missed'
  | 'called'
  | 'eligible'
  | 'not_eligible'
  | 'observed'
  | 'scheduled'
  | 'void'
  | 'none'

/** The lifecycle state of a whole valuation date. */
export type ScheduleRowState = 'called' | 'void' | 'matured' | 'observed' | 'scheduled'

export interface ScheduleRow {
  /** Stable React key — the valuation date is unique per row by construction. */
  key: string
  /** 1-based sequential index over the displayed rows, in date order. */
  displayNumber: number
  valuationDate: string
  /** Payment / Mandatory Early Redemption date for this date's events. */
  paymentDate: string | null
  couponBarrierPct: number | null
  autocallBarrierPct: number | null
  couponDuePct: number | null
  state: ScheduleRowState
  coupon: ScheduleOutcome
  autocall: ScheduleOutcome
  /** True when a `final` observation falls on this date (maturity valuation). */
  hasFinal: boolean
  reviewRequired: boolean
  reviewReason: string | null
  /** Audit trail: which canonical observation types this display row covers. */
  sourceTypes: ObservationType[]
}

/** First non-null value across a group — never overwrites a present value. */
function firstNonNull<T>(values: (T | null | undefined)[]): T | null {
  for (const v of values) if (v !== null && v !== undefined) return v
  return null
}

/**
 * The contractual call date: the EARLIEST valuation date carrying an
 * observation whose persisted status is `autocalled`.
 *
 * Earliest, not latest — once called the note ceased to exist, so a later
 * observation was never a live contractual event. Mirrors
 * `deriveNoteLifecycle`'s own precedence rule so the schedule and the lifecycle
 * can never disagree about which date ended the note.
 */
export function findCallDate(observations: StructuredNoteObservation[]): string | null {
  const called = observations
    .filter((o) => o.status === 'autocalled')
    .map((o) => o.valuationDate)
    .sort()
  return called[0] ?? null
}

/** Outcome of the coupon test on a date, from that date's canonical rows. */
function couponOutcome(group: StructuredNoteObservation[], voided: boolean): ScheduleOutcome {
  // The coupon condition lives on the coupon row; a `final` observation also
  // carries a coupon barrier for the maturity test.
  const o = group.find((x) => x.observationType === 'coupon') ?? group.find((x) => x.observationType === 'final')
  if (!o) return 'none'
  if (voided) return 'void'
  if (o.status === 'coupon_paid') return 'paid'
  if (o.status === 'coupon_missed') return 'missed'
  if (o.status === 'cancelled') return 'void'
  if (o.couponEligible === true) return 'eligible'
  if (o.couponEligible === false) return 'not_eligible'
  if (o.status !== 'scheduled') return 'observed'
  return 'scheduled'
}

/** Outcome of the autocall test on a date, from that date's canonical rows. */
function autocallOutcome(group: StructuredNoteObservation[], voided: boolean): ScheduleOutcome {
  const o = group.find((x) => x.observationType === 'autocall')
  // A note can also be recorded as called on a non-autocall-typed row (legacy
  // data, or a coupon row carrying the terminal status). Honour that rather
  // than reporting `none` for a date that demonstrably ended the note.
  if (!o) {
    if (group.some((x) => x.status === 'autocalled')) return 'called'
    // R13.7B2.2.1 § 3 — after a call, NOTHING on a later date is tested, and
    // that is the accurate reason to show: a final-valuation date that carries
    // no autocall row is void because the note was called, not merely because
    // the test was never scheduled. Before a call, a missing autocall row stays
    // `none` — the honest "never ran" state production is in today.
    return voided ? 'void' : 'none'
  }
  if (o.status === 'autocalled') return 'called'
  if (voided || o.status === 'cancelled') return 'void'
  if (o.autocallEligible === true) return 'eligible'
  if (o.autocallEligible === false) return 'not_eligible'
  if (o.status !== 'scheduled') return 'observed'
  return 'scheduled'
}

/**
 * Collapses canonical observations into ONE display row per valuation date.
 *
 * INPUT is expected to be already de-duplicated by
 * `dedupeObservationsByDate` (same date + same type collapsed); passing raw
 * rows still works — a repeated type simply contributes its first non-null
 * fields, exactly as the de-duplicator does.
 *
 * Never mutates, merges or drops a canonical observation: the return value is a
 * separate view, and `sourceTypes` records what each row was built from.
 */
export function buildScheduleRows(observations: StructuredNoteObservation[]): ScheduleRow[] {
  const callDate = findCallDate(observations)

  const byDate = new Map<string, StructuredNoteObservation[]>()
  for (const o of observations) {
    const list = byDate.get(o.valuationDate)
    if (list) list.push(o)
    else byDate.set(o.valuationDate, [o])
  }

  const dates = [...byDate.keys()].sort()
  return dates.map((valuationDate, i) => {
    const group = byDate.get(valuationDate)!
    // Strictly after the call — the call date itself is a live contractual
    // event (it is the one that ended the note), never void.
    const voided = callDate !== null && valuationDate > callDate
    const isCalled = group.some((o) => o.status === 'autocalled')

    let state: ScheduleRowState
    if (isCalled) state = 'called'
    else if (voided) state = 'void'
    else if (group.some((o) => o.status === 'matured')) state = 'matured'
    else if (group.every((o) => o.status === 'scheduled')) state = 'scheduled'
    else state = 'observed'

    const reviewRow = group.find((o) => o.reviewRequired === true) ?? null

    return {
      key: valuationDate,
      displayNumber: i + 1,
      valuationDate,
      paymentDate: firstNonNull(group.map((o) => o.paymentDate ?? o.redemptionDate)),
      couponBarrierPct: firstNonNull(group.map((o) => o.couponBarrierPct)),
      autocallBarrierPct: firstNonNull(group.map((o) => o.autocallBarrierPct)),
      couponDuePct: firstNonNull(group.map((o) => o.couponDuePct)),
      state,
      coupon: couponOutcome(group, voided),
      autocall: autocallOutcome(group, voided),
      hasFinal: group.some((o) => o.observationType === 'final'),
      reviewRequired: reviewRow !== null,
      reviewReason: reviewRow?.reviewReason ?? null,
      sourceTypes: [...new Set(group.map((o) => o.observationType))],
    }
  })
}
