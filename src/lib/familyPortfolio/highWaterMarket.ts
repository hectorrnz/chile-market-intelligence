// R13.R2 owner review §§ 15-20 — the High Water Market reference.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import, and NO
// CLOCK — the reference is derived from the observations handed to it, never
// from "today".
//
// THE VISIBLE TERM IS THE OWNER'S: "High Water Market" (§ 15). It is not
// silently corrected to "High Water Mark", "Peak Portfolio Value" or
// "Historical Peak Value" anywhere in the interface. The naming is settled;
// what must NOT drift is the semantic underneath it, which this module fixes:
//
//   High Water Market = the maximum ACTUAL OBSERVED PORTFOLIO VALUE in the
//   eligible displayed source history.
//
// It is computed over the portfolio VALUE (AUM) series. It is explicitly NOT:
//   · a flow-adjusted investment-performance high-water mark
//   · a return index
//   · a fee-calculation HWM
//   · a synthetic, smoothed or interpolated maximum
//
// Because the visible name can be read as a performance HWM by someone who
// knows the fee-calculation term, the interface pairs it with an explicit
// explanation (§ 17) rather than leaving the distinction to a footnote.
//
// NOTHING IS FABRICATED. The returned date is the date of a REAL observation
// in the array passed in — the maximum is a point that exists, never an
// interpolated crest between two weeks. On a tie the EARLIEST date wins: the
// honest answer to "when was the high set" is when it was first reached.

export interface EvolutionObservation {
  date: string
  value: number
}

export interface HighWaterMarket {
  /** The maximum observed value — always one of the input observations. */
  value: number
  /** The date that observation carries. Never derived, never interpolated. */
  date: string
  /** True when the high is the most recent observation shown. */
  isCurrent: boolean
}

/**
 * The maximum observed portfolio value in `points`, or null when there is
 * nothing real to report.
 *
 * Non-finite values are skipped rather than treated as zero — an unavailable
 * observation must never be able to depress or define a maximum. An empty or
 * entirely non-finite series yields null, and the caller draws no line: a
 * reference with no observation behind it would be a fabricated one.
 */
export function highWaterMarket(
  points: readonly EvolutionObservation[],
): HighWaterMarket | null {
  let best: EvolutionObservation | null = null
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue
    // Strictly greater, so the EARLIEST attainment of a tied maximum is kept.
    if (best === null || p.value > best.value) best = p
  }
  if (best === null) return null
  const last = [...points].reverse().find((p) => Number.isFinite(p.value)) ?? null
  return {
    value: best.value,
    date: best.date,
    isCurrent: last !== null && last.date === best.date,
  }
}

/** How an administrator may govern the reference line (§ 18). */
export const REFERENCE_LINE_MODES = ['auto', 'hidden'] as const
export type ReferenceLineMode = (typeof REFERENCE_LINE_MODES)[number]

export function isReferenceLineMode(v: unknown): v is ReferenceLineMode {
  return typeof v === 'string' && (REFERENCE_LINE_MODES as readonly string[]).includes(v)
}

export const DEFAULT_REFERENCE_LINE_MODE: ReferenceLineMode = 'auto'

/**
 * The owner-required default behaviour (§ 18), in one place so the chart, the
 * page and the tests cannot disagree:
 *
 *   ALL + a single series  → shown automatically
 *   Compare (two series)   → hidden; two reference lines are clutter
 *   1M / 3M / YTD / 1Y     → NOT shown automatically
 *
 * The automatic reveal is tied specifically to ALL, where "the maximum in the
 * displayed history" and "the all-time maximum on record" coincide and the
 * reference is unambiguous. On a windowed period the same line would mean "the
 * high within this window", a materially different and easily-misread claim.
 *
 * `mode: 'hidden'` suppresses it everywhere; there is deliberately no 'always',
 * which could only be used to contradict the two rules above.
 */
export function shouldShowHighWaterMarket(input: {
  period: string
  seriesCount: number
  mode?: ReferenceLineMode
}): boolean {
  const mode = input.mode ?? DEFAULT_REFERENCE_LINE_MODE
  if (mode === 'hidden') return false
  if (input.seriesCount !== 1) return false
  return input.period === 'ALL'
}
