// R13.R3B / R13.R3C — period selection for the Summary tab's PORTFOLIO VALUE
// CHANGE card.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import, and —
// like `evolutionRange.ts`, whose boundary arithmetic it reuses — NO CLOCK.
// Every boundary is computed from the SPINE'S OWN latest published week, never
// from `Date.now()`: a viewer opening the page months after the last upload
// must still see the last real week as the closing endpoint, not an empty
// range ending today.
//
// ── WHY THIS EXISTS SEPARATELY FROM `evolutionRange.ts` ────────────────────
//
// The Evolution chart selects a window over OBSERVATIONS — a list of levels it
// then draws. This selects a PAIR OF PUBLISHED WEEKS, because a value-change
// decomposition is a comparison of two snapshots and the API that produces it
// (`GET /api/family-portfolio/weekly-changes/[scope]?from=&asOf=`) takes
// exactly two endpoint dates. Those are different outputs from the same
// question, so the boundary arithmetic — end-of-month-clamped calendar-month
// shifts, and YTD taken from the ENDPOINT's year rather than the viewer's — is
// IMPORTED from that module rather than restated here, and the suite asserts
// the two agree on the window they select for the same inputs.
//
// ── THE ENDPOINTS ARE REAL PUBLISHED WEEKS, ALWAYS ─────────────────────────
//
// A boundary is a logical date; it is never fetched as one. The opening
// endpoint is the FIRST PUBLISHED WEEK ON OR AFTER the boundary — the very
// rule `selectEvolutionRange` applies — so the window never reaches back past
// the period the reader asked for, and the two cards standing side by side on
// Summary describe the same span. No date is interpolated, snapped to a
// nearest week, or invented.
//
// ── FAIL CLOSED ───────────────────────────────────────────────────────────
//
// A period that resolves to fewer than two published weeks cannot express a
// change at all. It reports `single_week` and the surface says so, rather than
// requesting a range the API would refuse (`from_not_before_to`) or — far
// worse — showing a zero change, which would read as "flat".

import { periodBoundary } from './evolutionRange.ts'

/**
 * The five periods the Summary contributors chart offers — now exactly the
 * Evolution rail's own set, so the two cards standing side by side name the
 * same spans.
 *
 * R13.R3B deliberately excluded `1M`, on the reasoning that a month of a
 * weekly book is four or five steps and therefore a weekly-changes question.
 * R13.R3B.1 retired the weekly waterfall, so there is no longer a surface for
 * that question to belong to, and R13.R3C reinstates `1M` at the owner's
 * direction. It resolves to a real multi-week window like every other period
 * (five published weeks over the current record) and duplicates nothing.
 */
export const VALUE_CHANGE_PERIODS = ['1M', '3M', 'YTD', '1Y', 'ALL'] as const

export type ValueChangePeriod = (typeof VALUE_CHANGE_PERIODS)[number]

export function isValueChangePeriod(value: unknown): value is ValueChangePeriod {
  return typeof value === 'string' && (VALUE_CHANGE_PERIODS as readonly string[]).includes(value)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** One published week, as the spine reports it. */
export interface PublishedWeek {
  asOfDate: string
}

export type ValueChangeRangeState =
  /** Two distinct published weeks resolved — the comparison can be requested. */
  | 'ok'
  /** The spine is empty; nothing has ever been published for this scope. */
  | 'no_publications'
  /**
   * The period resolves to a single published week, so there is no earlier
   * endpoint to compare against. Honest emptiness — never a zero change.
   */
  | 'single_week'

export interface ValueChangeRange {
  period: ValueChangePeriod
  /** The OPENING endpoint — a real published week, or null when unresolved. */
  fromDate: string | null
  /** The CLOSING endpoint — a real published week, or null when unresolved. */
  toDate: string | null
  /**
   * The computed logical boundary, retained for disclosure: when it is EARLIER
   * than `fromDate`, the book simply has no publication there, and the surface
   * can say so rather than implying the period began on the boundary. Null for
   * `ALL`, which has no boundary.
   */
  boundary: string | null
  /**
   * True when the requested period reaches further back than the record — the
   * window was clipped by the start of the history, not by missing weeks.
   */
  truncatedByHistory: boolean
  /**
   * How many published weeks the window contains, both endpoints included.
   * Null when no range resolved. Reported so the surface can disclose the real
   * span rather than let the period label imply one.
   */
  weekCount: number | null
  state: ValueChangeRangeState
}

function orderedDates(weeks: readonly PublishedWeek[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of weeks) {
    if (typeof w?.asOfDate !== 'string' || !ISO_DATE.test(w.asOfDate)) continue
    if (seen.has(w.asOfDate)) continue
    seen.add(w.asOfDate)
    out.push(w.asOfDate)
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

const EMPTY: Omit<ValueChangeRange, 'period'> = {
  fromDate: null,
  toDate: null,
  boundary: null,
  truncatedByHistory: false,
  weekCount: null,
  state: 'no_publications',
}

/**
 * THE range selector. The closing endpoint is the spine's own latest published
 * week; the opening endpoint is the first published week on or after the
 * period boundary.
 *
 * `endpointOverride` exists for one legitimate case: pinning the comparison to
 * a week the caller already resolved elsewhere. It cannot invent a week — a
 * value the spine does not hold is ignored, and a value later than the last
 * published week cannot extend the record.
 */
export function selectValueChangeRange(
  weeks: readonly PublishedWeek[],
  period: ValueChangePeriod,
  endpointOverride?: string | null,
): ValueChangeRange {
  const dates = orderedDates(weeks)
  if (dates.length === 0) return { period, ...EMPTY }

  const endpoint =
    typeof endpointOverride === 'string' && dates.includes(endpointOverride)
      ? endpointOverride
      : dates[dates.length - 1]

  const boundary = periodBoundary(endpoint, period)
  // Real publications only, on or after the boundary and not past the
  // endpoint. Never the boundary date itself unless a week happens to fall on
  // it, and never a week synthesised to sit there.
  const within = dates.filter((d) => (boundary === null || d >= boundary) && d <= endpoint)

  // The history begins after the boundary — the range is as long as the record
  // allows, which is a different statement from "weeks are missing".
  const truncatedByHistory = boundary !== null && dates[0] > boundary

  if (within.length < 2) {
    return {
      period,
      fromDate: null,
      toDate: within.length === 1 ? within[0] : null,
      boundary,
      truncatedByHistory,
      weekCount: within.length > 0 ? within.length : null,
      state: 'single_week',
    }
  }

  return {
    period,
    fromDate: within[0],
    toDate: within[within.length - 1],
    boundary,
    truncatedByHistory,
    weekCount: within.length,
    state: 'ok',
  }
}
