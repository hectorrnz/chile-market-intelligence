// POST-R13.8 FOLLOW-UP D — CUSTOM-PERIOD PERFORMANCE SEMANTICS.
//
// PURE. Nothing here reads the database or the network.
//
// ── THE OWNER CORRECTION THIS MODULE IMPLEMENTS ────────────────────────────
//
// Compare mode is NOT a weekly view. Comparing 2026-04-30 with 2026-09-04 is a
// PERIOD, and a period's flows and result are cumulative across every reporting
// interval inside it. Before this module the surface withheld flow, profit and
// return entirely over a custom range (`suppressSingleWeekMetrics`) — honest,
// because the single week's stated figures describe the wrong interval, but it
// left the reader with a value change and no way to tell earnings from deposits.
//
// ── THE HALF-OPEN INTERVAL IS THE WHOLE POINT ──────────────────────────────
//
// Weekly metrics are stated FOR the week ENDING on their reporting date. The
// FROM week's own flow already moved the portfolio to the FROM closing value the
// comparison opens at, so counting it again would double-count it. The window is
// therefore
//
//     (FROM, TO]   — every reporting interval AFTER FROM and THROUGH TO
//
// so the FROM week's flow is excluded and the TO week's flow is included.
//
// ── THE IDENTITY ───────────────────────────────────────────────────────────
//
//     Period Value Change = To value − From value
//     Period Net Flows    = Σ weekly flow over (FROM, TO]
//     Period P&L          = To value − From value − Period Net Flows
//
//     ⇒  From value + Period P&L + Period Net Flows = To value
//
// P&L is DERIVED from the identity rather than summed from the source, so it
// reconciles by construction. The source's own weekly profits are then summed
// independently as a CROSS-CHECK: if the two disagree beyond tolerance the
// module says so, rather than quietly preferring whichever number is convenient.
//
// ── RETURN IS TIME-LINKED, NEVER P&L ÷ OPENING ─────────────────────────────
//
//     Period Return = Π(1 + weekly_return_i) − 1  over (FROM, TO]
//
// A period with flows has no single denominator: money that arrived in week 12
// was not at risk in week 1. Chain-linking the source's own weekly returns is
// the standard answer and is what the workbook's weekly returns are for.
// `pnl / opening` is computed nowhere in this file — for Jaime over
// 2026-04-30 → 2026-09-04 it reads 2.88% against a true 2.75%, and the gap is
// entirely a mid-period contribution.
//
// ── INCOMPLETE HISTORY IS UNAVAILABLE, NEVER PARTIAL ───────────────────────
//
// A sum over a window missing one week is not "approximately right", it is
// wrong by exactly the week it lost — and nothing on screen would show which.
// Every aggregate here therefore requires a stated value at EVERY interval in
// the window or returns null. Main's `with_chilean_equities` performance block
// only begins at 2026-01-02, so a Main range opening before that legitimately
// has no period flows, and says so.

/** One source-stated weekly metric at one reporting date. */
export interface PeriodMetricPoint {
  observationDate: string
  value: number | null
}

export interface PeriodPerformanceInput {
  /** The opening endpoint. Its own week's metrics are EXCLUDED. */
  fromDate: string
  /** The closing endpoint. Its own week's metrics are INCLUDED. */
  toDate: string
  /**
   * Every reporting date the source closed for this scope, ascending. The
   * window is derived from this spine, so a week the book holds but this
   * payload lacks is a genuine gap rather than an invisible omission.
   */
  reportingDates: readonly string[]
  /** Total-level portfolio value at `fromDate`. */
  openingValue: number | null
  /** Total-level portfolio value at `toDate`. */
  closingValue: number | null
  /** Source-stated weekly net flows, by reporting date. */
  flows: readonly PeriodMetricPoint[]
  /** Source-stated weekly profit, by reporting date. Cross-check only. */
  profits: readonly PeriodMetricPoint[]
  /** Source-stated weekly return as a ratio, by reporting date. */
  returns: readonly PeriodMetricPoint[]
}

/**
 * Why a period aggregate could not be produced. Never a silent null.
 *
 * `incomplete_history` — at least one interval in the window has no stated
 * value for that metric. `no_intervals` — the two endpoints are adjacent in the
 * reporting spine with nothing between them, or the window is empty.
 */
export type PeriodUnavailableReason = 'incomplete_history' | 'no_intervals' | 'endpoints_missing'

export interface PeriodPerformance {
  fromDate: string
  toDate: string
  /** Every reporting date in (FROM, TO], ascending. The window, made explicit. */
  intervals: string[]
  openingValue: number | null
  closingValue: number | null
  /** `closing − opening`. Null when either endpoint is unavailable. */
  valueChange: number | null
  /** Σ weekly flow over (FROM, TO]. Null when any interval lacks one. */
  netFlows: number | null
  /** `closing − opening − netFlows`. Null when any term is null. */
  profit: number | null
  /** Σ source weekly profit over the same window — the independent check. */
  sourceProfitSum: number | null
  /** `profit − sourceProfitSum`. Null when either side is null. */
  profitCrossCheckDelta: number | null
  /**
   * `ok` — the two agree inside tolerance.
   * `mismatch` — they do not, and the surface must say so.
   * `unavailable` — one side could not be produced, so nothing was compared.
   */
  profitCrossCheck: 'ok' | 'mismatch' | 'unavailable'
  /** Absolute tolerance the cross-check was judged against. */
  tolerance: number
  /** Π(1 + weekly return) − 1 over the window. Null when any interval lacks one. */
  periodReturn: number | null
  /** Why `netFlows` is null, when it is. */
  flowsUnavailableReason: PeriodUnavailableReason | null
  /** Why `profit` is null, when it is — a missing endpoint or a missing flow. */
  profitUnavailableReason: PeriodUnavailableReason | null
  /** Why `periodReturn` is null, when it is. */
  returnUnavailableReason: PeriodUnavailableReason | null
}

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * The reconciliation tolerance, scaled to the size of the book.
 *
 * The same shape `reconcileFlowAndProfit` uses: a fixed cent tolerance would
 * flag ordinary floating-point noise on a nine-figure portfolio, and a fixed
 * ratio would swallow a real error on a small one.
 */
export function periodTolerance(openingValue: number | null): number {
  if (!finite(openingValue) || openingValue === 0) return 0.01
  return Math.max(0.01, Math.abs(openingValue) * 1e-9)
}

/**
 * Sums a metric over the window, requiring EVERY interval to carry a number.
 *
 * A missing interval returns null rather than a shorter sum. The alternative —
 * skipping it — produces a figure that looks complete and is not.
 */
function sumOverWindow(
  points: readonly PeriodMetricPoint[],
  window: readonly string[],
): { total: number | null; reason: PeriodUnavailableReason | null } {
  if (window.length === 0) return { total: null, reason: 'no_intervals' }
  const byDate = new Map<string, number | null>()
  for (const p of points) byDate.set(p.observationDate, p.value)
  let total = 0
  for (const d of window) {
    const v = byDate.get(d)
    if (!finite(v)) return { total: null, reason: 'incomplete_history' }
    total += v
  }
  return { total, reason: null }
}

/**
 * Chain-links weekly returns over the window, requiring every interval.
 *
 * A single missing week makes the product describe a shorter period than the
 * one on screen, so it degrades to null rather than compounding what it has.
 */
function compoundOverWindow(
  points: readonly PeriodMetricPoint[],
  window: readonly string[],
): { total: number | null; reason: PeriodUnavailableReason | null } {
  if (window.length === 0) return { total: null, reason: 'no_intervals' }
  const byDate = new Map<string, number | null>()
  for (const p of points) byDate.set(p.observationDate, p.value)
  let growth = 1
  for (const d of window) {
    const v = byDate.get(d)
    if (!finite(v)) return { total: null, reason: 'incomplete_history' }
    growth *= 1 + v
  }
  const result = growth - 1
  return Number.isFinite(result) ? { total: result, reason: null } : { total: null, reason: 'incomplete_history' }
}

/**
 * The reporting intervals in (FROM, TO] — the window every aggregate sums over.
 *
 * Exported because the route reports it and the tests assert directly on it:
 * the FROM week's exclusion and the TO week's inclusion are the two rules most
 * worth being able to see rather than infer.
 */
export function periodIntervals(
  reportingDates: readonly string[],
  fromDate: string,
  toDate: string,
): string[] {
  return [...reportingDates].sort().filter((d) => d > fromDate && d <= toDate)
}

/**
 * Builds the whole period reconciliation.
 *
 * Every figure is derived here, once, so the ledger on screen and the identity
 * it claims to satisfy cannot be computed two different ways.
 */
export function buildPeriodPerformance(input: PeriodPerformanceInput): PeriodPerformance {
  const intervals = periodIntervals(input.reportingDates, input.fromDate, input.toDate)
  const tolerance = periodTolerance(input.openingValue)

  const opening = finite(input.openingValue) ? input.openingValue : null
  const closing = finite(input.closingValue) ? input.closingValue : null
  const endpointsKnown = opening !== null && closing !== null
  const valueChange = opening !== null && closing !== null ? closing - opening : null

  const flows = sumOverWindow(input.flows, intervals)
  const returns = compoundOverWindow(input.returns, intervals)
  const profits = sumOverWindow(input.profits, intervals)

  const profit =
    valueChange !== null && finite(flows.total) ? valueChange - flows.total : null

  const crossDelta =
    profit !== null && finite(profits.total) ? profit - profits.total : null

  const profitCrossCheck: PeriodPerformance['profitCrossCheck'] =
    crossDelta === null ? 'unavailable' : Math.abs(crossDelta) <= tolerance ? 'ok' : 'mismatch'

  return {
    fromDate: input.fromDate,
    toDate: input.toDate,
    intervals,
    openingValue: opening,
    closingValue: closing,
    valueChange,
    netFlows: flows.total,
    profit,
    sourceProfitSum: profits.total,
    profitCrossCheckDelta: crossDelta,
    profitCrossCheck,
    tolerance,
    periodReturn: returns.total,
    flowsUnavailableReason: flows.reason,
    // A null P&L has two distinct causes and they are reported apart: the two
    // endpoints could not be resolved, or the window's flows are incomplete.
    // Collapsing them would tell a reader the history is missing when in fact
    // the portfolio total is.
    profitUnavailableReason:
      profit !== null ? null : !endpointsKnown ? 'endpoints_missing' : flows.reason,
    returnUnavailableReason: returns.reason,
  }
}
