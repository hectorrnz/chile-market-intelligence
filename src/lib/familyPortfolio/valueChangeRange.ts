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
// A boundary is a logical date; it is never fetched as one. For 3M / YTD / 1Y
// the opening endpoint is the FIRST PUBLISHED WEEK ON OR AFTER the boundary —
// the very rule `selectEvolutionRange` applies — so the window never reaches
// back past the period the reader asked for, and the two cards standing side
// by side on Summary describe the same span. No date is interpolated, snapped
// to a nearest week, or invented.
//
// ── 1M IS FOUR REPORTING INTERVALS, AND WILL NOT APPROXIMATE ──────────────
//
// 1M cannot use the on-or-after rule, and the first real catch-up import proved
// it. R13.8's architecture is ONE UPLOAD → N EVOLUTION HISTORY POINTS → ONE
// NEW PUBLICATION, so a catch-up week is a real reporting week with NO
// publication of its own. After the 2026-09-04 import the publication spine
// jumps 2026-07-31 → 2026-09-04 while the REPORTING spine holds 08-07, 08-14,
// 08-21 and 08-28 in between. "First publication on or after the boundary" is
// then 2026-09-04 itself: one week, no comparison.
//
// The first fix reached BACKWARD instead, opening at the last publication at or
// before the boundary. That produced 2026-07-31 → 2026-09-04 and called it a
// month. It is five intervals, not four, and the owner rejected it: a window
// that CONTAINS the period is still not the period.
//
// So 1M now resolves its opening endpoint EXACTLY, by counting four reporting
// steps back on the spine the source actually closed (`openingByIntervals`).
// For 2026-09-04 that is 2026-08-07 and nothing else. If that week carries no
// publication, this module says so through `opening_not_published` and names
// the date — it does not widen the window, does not snap to a neighbour, and
// does not invent a snapshot. An honest refusal beats a plausible wrong number.
//
// 3M / YTD / 1Y / ALL are DELIBERATELY UNTOUCHED. They are CALENDAR spans, not
// interval counts, and over this spine each still resolves to many publications.
// Redefining them here would change periods
// nobody reported a problem with.
//
// ── FAIL CLOSED ───────────────────────────────────────────────────────────
//
// A period that resolves to fewer than two published weeks cannot express a
// change at all. It reports `single_week` and the surface says so, rather than
// requesting a range the API would refuse (`from_not_before_to`) or — far
// worse — showing a zero change, which would read as "flat".

import {
  openingByIntervals,
  periodBoundary,
  TRAILING_MONTH_INTERVALS,
} from './evolutionRange.ts'

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
  /**
   * 1M ONLY. The exact opening week the period names is a real reporting week
   * the book HAS — it is in the evolution history — but it carries no
   * publication, so the row-level decomposition this card draws cannot be built
   * from it. `requiredOpeningDate` names that week.
   *
   * This is the state that refuses to approximate. The alternatives were to
   * widen the window to an earlier publication (measuring five intervals under
   * a four-interval label) or to synthesise a snapshot for the week (inventing
   * financial history). Saying which week is missing is the only honest third
   * option.
   */
  | 'opening_not_published'

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
  /**
   * 1M ONLY, and only when the window could not be built: the exact reporting
   * week the period requires as its opening endpoint. Non-null exactly when the
   * state is `opening_not_published`, so the surface can name the missing week
   * instead of showing an empty card with no explanation.
   */
  requiredOpeningDate: string | null
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
  requiredOpeningDate: null,
  state: 'no_publications',
}

/**
 * THE range selector.
 *
 * The closing endpoint is the spine's own latest published week. The opening
 * endpoint depends on the KIND of period:
 *
 *   * 1M counts FOUR REPORTING INTERVALS back on `reportingWeeks` — the source's
 *     own weekly spine, which after a catch-up import holds weeks that carry no
 *     publication. That opening week is then required to be published; if it is
 *     not, the range refuses with `opening_not_published` rather than widening.
 *
 *   * every other period is a CALENDAR span and opens at the first published
 *     week on or after its boundary, exactly as before.
 *
 * `reportingWeeks` is the evolution history's dates. Omitting it falls back to
 * the publication dates, which is correct whenever the two spines agree and is
 * what every pre-existing caller and fixture already assumed — so a caller that
 * never read the history keeps its previous behaviour instead of being given a
 * silently different window.
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
  reportingWeeks?: readonly string[] | null,
): ValueChangeRange {
  const dates = orderedDates(weeks)
  if (dates.length === 0) return { period, ...EMPTY }

  const endpoint =
    typeof endpointOverride === 'string' && dates.includes(endpointOverride)
      ? endpointOverride
      : dates[dates.length - 1]

  const boundary = periodBoundary(endpoint, period)

  // The REPORTING spine — every week the source closed, published or not. The
  // publication spine stands in when the caller supplied none; it is a subset,
  // so the fallback can only ever count intervals over fewer weeks, never over
  // weeks that do not exist.
  //
  // The ENDPOINT is unioned in. It is a real published week by construction, so
  // adding it invents nothing — but a reporting series that does not carry it
  // (a scope whose evolution basis is shorter than its publication spine) would
  // otherwise make the count start one step too early and reach five intervals
  // back under a four-interval label. The union makes the count exact whatever
  // the two spines disagree about.
  const spine =
    Array.isArray(reportingWeeks) && reportingWeeks.length > 0
      ? [
          ...new Set([
            ...reportingWeeks.filter((d) => typeof d === 'string' && ISO_DATE.test(d)),
            endpoint,
          ]),
        ].sort()
      : dates

  if (period === '1M') {
    const required = openingByIntervals(spine, endpoint, TRAILING_MONTH_INTERVALS)
    if (required === null) {
      // The record is shorter than four intervals. Truncated, and reported as
      // the single-week emptiness it is rather than as a shorter "month".
      return {
        period,
        fromDate: null,
        toDate: dates.includes(endpoint) ? endpoint : null,
        boundary,
        truncatedByHistory: true,
        weekCount: dates.includes(endpoint) ? 1 : null,
        requiredOpeningDate: null,
        state: 'single_week',
      }
    }
    if (!dates.includes(required)) {
      // The week exists in the book's history but was never published, so no
      // row-level snapshot can open the window. Named, never approximated.
      return {
        period,
        fromDate: null,
        toDate: endpoint,
        boundary,
        truncatedByHistory: false,
        weekCount: null,
        requiredOpeningDate: required,
        state: 'opening_not_published',
      }
    }
    const within = dates.filter((d) => d >= required && d <= endpoint)
    return {
      period,
      fromDate: required,
      toDate: endpoint,
      boundary,
      truncatedByHistory: false,
      weekCount: within.length,
      requiredOpeningDate: null,
      state: 'ok',
    }
  }

  // Real publications only, and never a week synthesised to sit on a boundary.
  const opening = dates.find((d) => (boundary === null || d >= boundary) && d <= endpoint) ?? null
  const within = opening === null ? [] : dates.filter((d) => d >= opening && d <= endpoint)

  // The history begins after the boundary — the range is as long as the record
  // allows, which is a different statement from "weeks are missing".
  const truncatedByHistory = boundary !== null && dates[0] > boundary

  if (within.length < 2) {
    // Whatever single week the period could reach, for the surface to name.
    const lone = within.length === 1 ? within[0] : dates.includes(endpoint) ? endpoint : null
    return {
      period,
      fromDate: null,
      toDate: lone,
      boundary,
      truncatedByHistory,
      weekCount: lone === null ? null : 1,
      requiredOpeningDate: null,
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
    requiredOpeningDate: null,
    state: 'ok',
  }
}
