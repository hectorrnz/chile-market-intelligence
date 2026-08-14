// R13.R2 OWNER REVIEW PASS 4 § 2 — the flow-adjusted Portfolio Evolution path.
// R13.R2E.1 §§ 2-3 — corrected to the owner-authoritative SPARSE-EVENT flow rule.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import, and no
// clock — every boundary comes from the observations handed in.
//
// THE PROBLEM THIS SOLVES. The evolution series are portfolio VALUE LEVELS, so
// a contribution or a withdrawal moves the line exactly as far as a gain of the
// same size. A week in which the family moved money produces a step that looks
// like performance and is not: Jaime's line jumps 22.97% of its own level in the
// week to 2024-10-11, and that step is entirely capital.
//
// THE CONSTRUCTION, IN ONE LINE.
//
//     adjusted[anchor] = value[anchor]
//     adjusted[i]      = value[i] − Σ netFlow[anchor+1 … i]
//
// which is the same thing as the step-wise form in R13.R2E.1 § 3,
//
//     adjusted[i] = adjusted[i−1] + (value[i] − value[i−1] − netFlow[i])
//
// by induction, and is preferred only because summing the flows once keeps the
// arithmetic exact instead of accumulating a rounding error per step. Nothing is
// modelled, smoothed, interpolated or rebased to an index: every plotted point
// is a real published level with real published flows subtracted from it.
//
// ── THE SPARSE-EVENT FLOW RULE (owner-authoritative, R13.R2E.1 § 2) ───────────
//
// Contributions and withdrawals are UNUSUAL EVENTS, so the flow field is a
// SPARSE EVENT FIELD and its normal state is empty:
//
//     a BLANK flow cell means NO contribution or withdrawal occurred → 0
//     a NUMERIC flow cell means that flow actually occurred          → the value
//
// This holds INDEPENDENTLY of whether the neighbouring performance metrics
// (Weekly Return, Weekly P&L, YTD Return, YTD P&L) were maintained that week. An
// unmaintained performance block says nothing about whether money moved; it says
// only that nobody computed the return. Reading "the block is empty" as "the
// flow is unknown" is what previously truncated Main's Including-Chilean-Equities
// history to its final 32 weeks.
//
// The rule is not a convenience. It is what the source does, verified directly
// in the reference workbook across all five flow rows × 102 week columns:
// 510 cells, of which 477 are GENUINELY BLANK and 33 are non-zero numbers —
// not one literal zero, not one error cell, not one text cell. And it is
// validated against independent evidence 394 times: every explicit zero now in
// the book originated as a blank cell, and every one of them reconciles exactly
// against the source's OWN published weekly P&L (worst relative deviation
// 8.87e-13 across 427 basis-weeks).
//
// WHAT IS *NOT* ZERO (R13.R2E.1 § 2). Blank-means-zero applies to a genuinely
// empty sparse-event cell and to nothing else. A flow the source published as
// malformed, errored, ambiguous or explicitly unavailable is UNKNOWN, and an
// unknown flow makes its step unadjustable — see `flowUnavailable` below. The
// distinction has no instance in the current book; it exists so that the day one
// appears it cannot be silently read as "no money moved".
//
// WEEKLY P&L IS A VALIDATION FIELD, NOT AN INPUT (R13.R2E.1 § 3). The path is
// built from published LEVELS and published FLOWS alone. Where the source also
// states a weekly P&L, the publication contract guarantees — and the live book
// confirms across 427 basis-weeks (worst relative deviation 5.24e-15) —
//
//     value[i] − value[i−1]  =  weekly_profit[i] + netFlow[i]
//
// so this path's own step equals the source's OWN stated profit or loss for that
// week. That is a CHECK on the construction, and its absence in a week never
// prevents that week from being adjusted.
//
// WHAT IT IS NOT. It is not a time-weighted return, not an index, and not a
// claim about what the portfolio "would have been worth": returns earned ON a
// contribution after it arrives are still in the line, because they are real
// gains on real money. It is a LEVEL in the portfolio's own currency, and the
// interface names it a flow-adjusted VALUE for that reason.
//
// INTERNAL TRADING IS NOT AN EXTERNAL FLOW (R13.R2E.1 § 7). Buying, selling or
// reallocating INSIDE the portfolio is not a contribution or a withdrawal, and
// this module never tries to infer one from a holdings change. The source itself
// draws that line: in the one week where it states a flow on both Main bases at
// once with a movement in the non-Chilean sleeve, it states the total-portfolio
// flow as exactly ZERO (2026-01-02) — money crossing between sleeves is not
// money entering or leaving the portfolio.

export interface FlowObservation {
  /** ISO `YYYY-MM-DD` — the source column's own header date. */
  date: string
  /** The published portfolio level at that date. */
  value: number
  /**
   * The source's stated net flow for the week ENDING on `date`.
   *
   * A number is that stated flow. `null` or absent is a BLANK sparse-event cell
   * and therefore ZERO — no contribution or withdrawal occurred — per the
   * owner-authoritative rule above. To say a flow is UNKNOWN rather than zero,
   * set `flowUnavailable`; leaving this null will never mean "unknown".
   */
  flow?: number | null
  /**
   * True when the source published a flow that could not be read as a number —
   * an error cell, a malformed or ambiguous value, or one the publication marked
   * explicitly unavailable. Such a week's flow is UNKNOWN, never zero, and its
   * step cannot be adjusted.
   */
  flowUnavailable?: boolean
}

export interface FlowAdjustedSeries {
  /** The plotted path. Empty when no step could be adjusted at all. */
  points: Array<{ date: string; value: number }>
  /** True when at least one step was adjusted, i.e. the path is genuinely flow-adjusted. */
  adjusted: boolean
  /** The observation the path is anchored at — its value is the real published level. */
  anchorDate: string | null
  /** Observations dropped from the FRONT because their incoming step's flow was UNKNOWN. */
  omittedLeading: number
  /**
   * The anchor date when — and only when — leading observations were dropped,
   * so a surface can say "flow-adjusted history begins here" instead of quietly
   * showing a shorter line. Null in the ordinary case, which is now every series
   * in the book: a blank flow is zero, so nothing is dropped for blankness.
   */
  adjustableFrom: string | null
  /** Net flow removed across the plotted span; null when nothing was plotted. */
  netFlowExcluded: number | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const EMPTY: FlowAdjustedSeries = {
  points: [],
  adjusted: false,
  anchorDate: null,
  omittedLeading: 0,
  adjustableFrom: null,
  netFlowExcluded: null,
}

function ordered(points: readonly FlowObservation[]): FlowObservation[] {
  return [...points]
    .filter((p) => typeof p.date === 'string' && ISO_DATE.test(p.date) && Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * The week's net external flow under the sparse-event rule, or `null` when it is
 * genuinely UNKNOWN and the step therefore cannot be adjusted.
 *
 * The two are deliberately different returns rather than one nullable number
 * with a comment: "no money moved" and "we do not know whether money moved" lead
 * to opposite plotting decisions, and collapsing them is the exact error
 * R13.R2E.1 § 2 forbids.
 */
export function netFlowOf(observation: FlowObservation): number | null {
  if (observation.flowUnavailable === true) return null
  const stated = observation.flow
  // A blank sparse-event cell — `null`, `undefined`, and nothing else.
  if (stated === null || stated === undefined) return 0
  // A value that is present but not a usable number is malformed, not empty.
  return Number.isFinite(stated) ? stated : null
}

/**
 * The flow-adjusted path over the observations given.
 *
 * Anchored at the FIRST observation, because under the sparse-event rule every
 * week's net flow is known: it is the stated figure where one is stated and zero
 * where the cell is blank. The anchor moves forward only for a genuinely UNKNOWN
 * flow, which no series in the current book has.
 *
 * The caller passes the observations for the WHOLE RECORD, not the displayed
 * window: the series is constructed once from its own deterministic anchor and
 * range controls SLICE it (R13.R2E.1 § 4), so a given date holds the same
 * adjusted value under every range selection. Re-anchoring per window is what
 * made the same endpoint report five different values across the five ranges.
 */
export function buildFlowAdjustedSeries(
  points: readonly FlowObservation[],
): FlowAdjustedSeries {
  const series = ordered(points)
  if (series.length === 0) return EMPTY
  if (series.length === 1) {
    // One observation is a level, not a path: there is no step to adjust, and
    // reporting it as "flow-adjusted" would claim work that was not done.
    return {
      points: [{ date: series[0].date, value: series[0].value }],
      adjusted: false,
      anchorDate: series[0].date,
      omittedLeading: 0,
      adjustableFrom: null,
      netFlowExcluded: null,
    }
  }

  // The longest COVERED SUFFIX: walk back from the newest observation while each
  // step's own flow is KNOWN, and stop at the first one that is not. With no
  // unknown flow anywhere — the ordinary case — this lands on index 0 and the
  // whole record is plotted.
  let anchor = series.length - 1
  for (let i = series.length - 1; i >= 1; i--) {
    if (netFlowOf(series[i]) === null) break
    anchor = i - 1
  }

  if (anchor === series.length - 1) {
    // Not one step is adjustable. Returning the raw levels here would silently
    // hand back exactly the un-adjusted line this module exists to replace, so
    // the caller is told plainly that there is nothing to plot.
    return { ...EMPTY, adjustableFrom: null }
  }

  const out: Array<{ date: string; value: number }> = [
    { date: series[anchor].date, value: series[anchor].value },
  ]
  let cumulative = 0
  for (let i = anchor + 1; i < series.length; i++) {
    // Non-null for every i past the anchor, by the suffix walk above.
    cumulative += netFlowOf(series[i]) as number
    out.push({ date: series[i].date, value: series[i].value - cumulative })
  }

  return {
    points: out,
    adjusted: true,
    anchorDate: series[anchor].date,
    omittedLeading: anchor,
    adjustableFrom: anchor > 0 ? series[anchor].date : null,
    netFlowExcluded: cumulative,
  }
}

/**
 * Pairs published levels with published flows by DATE.
 *
 * The evolution observation and the performance block are two different tables
 * keyed by the same week, so a level whose week published no flow row is a BLANK
 * sparse-event cell and carries zero flow. Matching on the exact ISO date is
 * deliberate: a nearest-date match would attach one week's capital movement to
 * another week's level.
 *
 * `unavailableDates` carries the weeks whose flow the publication could not
 * state as a number. They are the only ones that come back UNKNOWN; everything
 * absent from both maps is simply a week in which no money moved.
 */
export function attachFlows(
  points: ReadonlyArray<{ date: string; value: number }>,
  flowByDate: ReadonlyMap<string, number>,
  unavailableDates: ReadonlySet<string> = new Set(),
): FlowObservation[] {
  return points.map((p) => {
    if (unavailableDates.has(p.date)) {
      return { date: p.date, value: p.value, flow: null, flowUnavailable: true }
    }
    const flow = flowByDate.get(p.date)
    return { date: p.date, value: p.value, flow: Number.isFinite(flow as number) ? (flow as number) : null }
  })
}
