// R13.3 — the four performance definitions (doc 04 § 4.2).
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// These four were established NUMERICALLY against the workbook's own hardcoded
// results across all five performance blocks — not assumed from their Spanish
// labels. Two of them are counter-intuitive, and both naive readings are wrong
// in ways that look plausible:
//
//   (a) PROFIT IS FLOW-ADJUSTED. `Utilidad de la semana` is
//       `ΔValue − flow`, not `ΔValue`. Verified exactly against the source's own
//       stated profit for Main-with-Chilean-equities; reading ΔValue alone is
//       wrong by the entire flow. Figures: doc 04 § 4.2 finding (a).
//
//   (b) ANNUAL RETURN IS CHAIN-LINKED, NOT A RATIO. `Utilidad del Año ÷
//       value(BoY)` FAILS for Main-con-CL and for Jaime. Compounding the weekly
//       returns reproduces the stated figure to < 1e-9 for all five blocks.
//       This is a genuine flow-adjusted time-weighted return, and it is the
//       reason doc 07 can defend Level 3 attribution at portfolio-total level.
//       Figures: doc 04 § 4.2 finding (b).
//
// The verification figures deliberately stay in doc 04 rather than being copied
// here: that document already carries the minimum representative values needed
// to prove the contract, and application source is read far more widely.
//
// The RETURN DENOMINATOR IS NOT FLOW-ADJUSTED (verified): it is
// `value(previousWeek)` exactly, not `previousWeek + flow`.
//
// NMI recomputes these and CROSS-CHECKS them against the source's own stated
// values. A residual beyond tolerance raises `performance_definition_mismatch`
// as a WARNING — it protects against the source silently changing methodology,
// and it never overwrites the source's stated figure (doc 04 § 7: a
// `source_provided_return` is never silently replaced by an NMI derivation).

/** Residual tolerance for the identity cross-checks (doc 08 Stage 3: < 1e-6). */
export const PERFORMANCE_TOLERANCE = 1e-6

/** Tolerance for the chain-linked annual return, verified to < 1e-9. */
export const RETURN_TOLERANCE = 1e-9

export interface WeeklyObservation {
  /** ISO date of the week. */
  date: string
  /** Portfolio value at the close of that week. */
  value: number
  /**
   * Contribution/withdrawal recorded for that week.
   *
   * Doc 02 § 8: an EMPTY flow cell means ZERO flow, not missing data —
   * confirmed because the source's own profit identity balances exactly when
   * the blank is treated as 0. Callers pass 0, never null, for an empty cell.
   */
  flow: number
}

/**
 * `Utilidad de la semana` = `value(thisWeek) − value(previousWeek) − flow(thisWeek)`.
 *
 * Returns null when either value is unavailable — never 0, which would be
 * indistinguishable from a genuinely flat week.
 */
export function weeklyProfit(
  thisWeekValue: number | null,
  previousWeekValue: number | null,
  flow: number,
): number | null {
  if (thisWeekValue === null || previousWeekValue === null) return null
  if (!Number.isFinite(thisWeekValue) || !Number.isFinite(previousWeekValue) || !Number.isFinite(flow)) return null
  return thisWeekValue - previousWeekValue - flow
}

/**
 * `Retorno de la semana` = `weeklyProfit ÷ value(previousWeek)`.
 *
 * The denominator is deliberately NOT flow-adjusted — verified against all five
 * blocks. A zero or non-finite base yields null rather than Infinity/NaN.
 */
export function weeklyReturn(profit: number | null, previousWeekValue: number | null): number | null {
  if (profit === null || previousWeekValue === null) return null
  if (!Number.isFinite(previousWeekValue) || previousWeekValue === 0) return null
  const r = profit / previousWeekValue
  return Number.isFinite(r) ? r : null
}

/**
 * `Utilidad del Año` = Σ of the weekly profits since BoY
 *                    ≡ `value − value(BoY) − Σ flows`.
 *
 * Both forms are equivalent by construction; the closed form is used so a
 * single missing intermediate week does not silently truncate the sum.
 */
export function annualProfit(
  currentValue: number | null,
  beginningOfYearValue: number | null,
  flowsSinceBoY: number[],
): number | null {
  if (currentValue === null || beginningOfYearValue === null) return null
  if (!Number.isFinite(currentValue) || !Number.isFinite(beginningOfYearValue)) return null
  let sum = 0
  for (const f of flowsSinceBoY) {
    if (!Number.isFinite(f)) return null
    sum += f
  }
  return currentValue - beginningOfYearValue - sum
}

/**
 * `Retorno del Año` = `Π(1 + weeklyReturn) − 1` over every week since BoY.
 *
 * NOT `annualProfit ÷ value(BoY)` — that ratio is verifiably wrong against the
 * source (see finding (b) in the file header).
 *
 * `observations` must be ordered ascending by date and must START at the
 * Beginning-of-Year observation, whose own return is not part of the product
 * (there is no prior week inside the year to measure it against).
 */
export function chainLinkedAnnualReturn(observations: WeeklyObservation[]): number | null {
  if (observations.length < 2) return null
  let product = 1
  for (let i = 1; i < observations.length; i++) {
    const prev = observations[i - 1]
    const cur = observations[i]
    const profit = weeklyProfit(cur.value, prev.value, cur.flow)
    const r = weeklyReturn(profit, prev.value)
    if (r === null) return null
    product *= 1 + r
  }
  const out = product - 1
  return Number.isFinite(out) ? out : null
}

// ---------------------------------------------------------------------------
// Cross-check against the source's own stated figures
// ---------------------------------------------------------------------------

export type PerformanceMetric =
  | 'weekly_profit'
  | 'weekly_return'
  | 'annual_profit'
  | 'annual_return'

export interface PerformanceCrossCheck {
  metric: PerformanceMetric
  /** The source's own stored figure. Authoritative for display. */
  sourceValue: number | null
  /** NMI's independent recomputation. A cross-check only. */
  recomputed: number | null
  residual: number | null
  /** True when both are present and agree within tolerance. */
  agrees: boolean
  /** True when a comparison could not be made at all. */
  indeterminate: boolean
}

/**
 * Compares one recomputed metric against the source's stated value.
 *
 * A missing figure on either side is INDETERMINATE, never a mismatch — absence
 * of evidence must not be reported as a methodology change.
 */
export function crossCheck(
  metric: PerformanceMetric,
  sourceValue: number | null,
  recomputed: number | null,
): PerformanceCrossCheck {
  const tolerance = metric.endsWith('return') ? RETURN_TOLERANCE : PERFORMANCE_TOLERANCE
  if (sourceValue === null || recomputed === null || !Number.isFinite(sourceValue) || !Number.isFinite(recomputed)) {
    return { metric, sourceValue, recomputed, residual: null, agrees: false, indeterminate: true }
  }
  const residual = Math.abs(recomputed - sourceValue)
  // Returns are compared absolutely; money amounts are scaled by magnitude so a
  // 143-million-dollar total is not judged against an absolute 1e-6 epsilon.
  const scale = metric.endsWith('return') ? 1 : Math.max(1, Math.abs(sourceValue))
  return {
    metric,
    sourceValue,
    recomputed,
    residual,
    agrees: residual / scale <= tolerance,
    indeterminate: false,
  }
}
