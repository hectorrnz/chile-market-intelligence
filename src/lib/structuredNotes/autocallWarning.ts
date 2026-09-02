// R13.7 § 19–24 — T-1 POTENTIAL AUTOCALL WARNING (pure logic).
//
// PURE MODULE. No Supabase, no provider, no Next.js — directly testable.
//
// WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT
// ─────────────────────────────────────────────
// A forward-looking heads-up, evaluated on the trading session BEFORE a
// contractual autocall valuation date: "if today's closing relationship to the
// call levels repeats tomorrow, this note would be called."
//
// It NEVER calls the note. A call is a contractual event that happens on its
// own valuation date, determined by that date's closes — the T0 path
// (`monitoring.ts` + the snapshot cron) is the only thing that may transition a
// note to `autocalled`, and it must do so from T0 data. A T-1 warning firing is
// not evidence of anything at T0 (§ 18); the market can move overnight, which
// is precisely why the warning quantifies the cushion.
//
// TIMING (§ 19)
// ─────────────
// The warning belongs to the PRIOR TRADING SESSION, not calendar D-1: a Monday
// valuation date warns on the preceding Friday. Weekends are handled
// structurally by `previousTradingDay`; holidays only when a calendar is
// supplied — and an unsupplied holiday degrades safely, because a session with
// no fresh close produces `deferred_stale_data` rather than a warning computed
// on stale levels.

import type { StructuredNote, StructuredNoteObservation } from './types.ts'
import { ARCHIVED_STATUSES } from './types.ts'
import {
  evaluateAutocallEvent,
  type ContractualEventEvaluation,
  type LegEvaluation,
} from './contractualEvents.ts'
import { toCloseMap, type ResolvedValuationClose } from './valuationClose.ts'
import { previousTradingDay } from './marketDate.ts'

/** The distinct event identities this subsystem emits (§ 24). Stable, and deliberately separate so a warning can never be mistaken for a confirmation. */
export type StructuredNoteEventType = 'potential_autocall' | 'autocall_confirmed'

/**
 * Why a note did not produce a warning. Every non-warning outcome is named, so
 * "nothing happened" is always explainable rather than silent.
 */
export type WarningSkipReason =
  | 'note_not_live'
  | 'no_upcoming_autocall_observation'
  | 'not_the_prior_trading_session'
  | 'deferred_stale_data'
  | 'condition_not_currently_satisfied'
  | 'already_warned'

export interface PotentialAutocallWarning {
  noteId: string
  isin: string | null
  issuerDisplayName: string | null
  /** The contractual autocall valuation date this warns about. */
  valuationDate: string
  /** The mandatory early redemption date tied to that observation, when recorded. */
  redemptionDate: string | null
  /** The trading session whose closes were used (the prior session). */
  sessionDate: string
  observationId: string | undefined
  event: ContractualEventEvaluation
  legs: LegEvaluation[]
  /** The leg with the smallest cushion — the one that decides the ALL condition. */
  bindingLeg: LegEvaluation | null
}

export type PotentialAutocallResult =
  | { warn: true; warning: PotentialAutocallWarning }
  | { warn: false; reason: WarningSkipReason; valuationDate: string | null }

/**
 * The next contractual AUTOCALL observation strictly after `asOf`.
 *
 * Autocall-typed only: a coupon observation on the same date is a different
 * contractual test and cannot trigger an early redemption. Before R13.7 no
 * autocall-typed observation existed at all, which is why this returned nothing
 * to warn about even when a call was imminent.
 */
export function findNextAutocallObservation(
  observations: StructuredNoteObservation[],
  asOf: string,
): StructuredNoteObservation | null {
  return observations
    .filter((o) => o.observationType === 'autocall' && o.status === 'scheduled' && o.valuationDate > asOf)
    .sort((a, b) => a.valuationDate.localeCompare(b.valuationDate))[0] ?? null
}

/** True when `sessionDate` is the trading session immediately preceding `valuationDate`. */
export function isPriorTradingSession(valuationDate: string, sessionDate: string, holidays: ReadonlySet<string> = new Set()): boolean {
  return previousTradingDay(valuationDate, holidays) === sessionDate
}

/**
 * Cushion to the call level, as a positive fraction, for an underlying that is
 * currently AT OR ABOVE its threshold: how far it could fall before reaching it.
 *
 * Derived from `moveToThresholdPct` (`threshold/close - 1`), which is the
 * MARKET MOVE metric — not from `relativeToThresholdPct` (`close/threshold - 1`),
 * which measures the same gap against a different denominator and gives a
 * different number (§ 15). Using the wrong one here would misstate the headline
 * figure in an administrator's email by roughly the square of the cushion.
 */
export function downsideCushionPct(leg: LegEvaluation): number | null {
  if (leg.moveToThresholdPct === null) return null
  return leg.moveToThresholdPct <= 0 ? Math.abs(leg.moveToThresholdPct) : null
}

/**
 * The binding underlying for a warning: the smallest cushion among the legs
 * that must all satisfy the condition.
 *
 * Compared on NORMALIZED cushion, never on raw price — SPX at 7711 and RTY at
 * 2972 are not comparable quantities, and their absolute magnitudes say nothing
 * about which is closer to its own call level.
 */
export function bindingCushionLeg(legs: LegEvaluation[]): LegEvaluation | null {
  const withCushion = legs.filter((l) => downsideCushionPct(l) !== null)
  if (withCushion.length === 0) return null
  return withCushion.reduce((worst, l) => (downsideCushionPct(l)! < downsideCushionPct(worst)! ? l : worst))
}

export interface PotentialAutocallInput {
  note: Pick<StructuredNote, 'id' | 'isin' | 'issuerDisplayName' | 'status' | 'underlyings' | 'observations'>
  /** Closes for `sessionDate` — the prior trading session. */
  sessionCloses: readonly ResolvedValuationClose[]
  sessionDate: string
  holidays?: ReadonlySet<string>
  /** Valuation dates already warned for this note, so a repeated run stays silent (§ 24). */
  alreadyWarned?: ReadonlySet<string>
}

/**
 * Decides whether a note warrants a T-1 potential-autocall warning.
 *
 * Every gate must pass (§ 20). The ORDER matters for explainability: the
 * cheapest, most structural checks come first so the reported reason is the
 * most informative one available.
 */
export function evaluatePotentialAutocall(input: PotentialAutocallInput): PotentialAutocallResult {
  const { note, sessionCloses, sessionDate, holidays = new Set(), alreadyWarned = new Set() } = input

  if (note.status !== 'active' || ARCHIVED_STATUSES.includes(note.status)) {
    return { warn: false, reason: 'note_not_live', valuationDate: null }
  }

  const next = findNextAutocallObservation(note.observations, sessionDate)
  if (!next) return { warn: false, reason: 'no_upcoming_autocall_observation', valuationDate: null }

  if (!isPriorTradingSession(next.valuationDate, sessionDate, holidays)) {
    return { warn: false, reason: 'not_the_prior_trading_session', valuationDate: next.valuationDate }
  }

  if (alreadyWarned.has(next.valuationDate)) {
    return { warn: false, reason: 'already_warned', valuationDate: next.valuationDate }
  }

  // § 20/§ 25 — the condition must be assessed on FRESH official closes for the
  // session. An unresolved close defers the warning rather than producing one
  // from partial data; a half-priced basket cannot support "all underlyings".
  if (sessionCloses.length === 0 || sessionCloses.some((c) => c.close === null)) {
    return { warn: false, reason: 'deferred_stale_data', valuationDate: next.valuationDate }
  }

  const event = evaluateAutocallEvent(note.underlyings, toCloseMap(sessionCloses))
  if (event.outcome !== 'met') {
    // `unknown` also lands here deliberately: an undetermined condition is not
    // a reason to alarm anyone, and it is separately visible as a data issue.
    return {
      warn: false,
      reason: event.outcome === 'unknown' ? 'deferred_stale_data' : 'condition_not_currently_satisfied',
      valuationDate: next.valuationDate,
    }
  }

  return {
    warn: true,
    warning: {
      noteId: note.id ?? '',
      isin: note.isin,
      issuerDisplayName: note.issuerDisplayName,
      valuationDate: next.valuationDate,
      redemptionDate: next.redemptionDate ?? next.paymentDate ?? null,
      sessionDate,
      observationId: next.id,
      event,
      legs: event.legs,
      bindingLeg: bindingCushionLeg(event.legs),
    },
  }
}

/** Formats a fraction as a percentage string with the given precision. Null-safe: an unknown value renders an em dash, never `NaN%`. */
export function formatPct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

/**
 * The in-platform notification copy (§ 22).
 *
 * Names the actual valuation date rather than "tomorrow" — the warning may be
 * read the next morning, and a stated date cannot go stale. Underlyings are
 * always taken from the note; nothing here hardcodes SPX/RTY.
 */
export function buildPotentialAutocallMessage(w: PotentialAutocallWarning): { title: string; body: string } {
  const label = w.isin ?? w.issuerDisplayName ?? w.noteId
  const title = `Potential autocall — valuation ${w.valuationDate}: ${label}`
  const binding = w.bindingLeg
  const bindingText = binding
    ? `${binding.underlyingName} is the binding underlying, with approximately ${formatPct(downsideCushionPct(binding))} of downside cushion to its call level.`
    : 'The binding underlying could not be identified from the available closes.'
  const legText = w.legs
    .map((l) => `${l.underlyingName}: close ${l.close ?? '—'} vs call level ${l.threshold ?? '—'} (${formatPct(downsideCushionPct(l))} cushion)`)
    .join('; ')
  const body =
    `${label} has a contractual autocall valuation date on ${w.valuationDate}. ` +
    `Based on the official closes of ${w.sessionDate}, its autocall condition is currently satisfied: ${legText}. ` +
    `${bindingText} ` +
    `If the contractual condition remains satisfied at the ${w.valuationDate} valuation close, the note is expected to be called. ` +
    `This is a PRE-VALUATION warning — the note has not been called, and no early redemption has occurred. ` +
    `Monitoring estimate, not an official calculation-agent determination.`
  return { title, body }
}
