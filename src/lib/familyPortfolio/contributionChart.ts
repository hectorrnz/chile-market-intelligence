// R13.R3C — CONTRIBUTORS AND DETRACTORS OF PORTFOLIO VALUE CHANGE.
//
// PURE MODULE. No Next.js, Supabase, environment, filesystem or clock import.
// It shapes an already-computed set of value changes into the ordering, the
// omissions, the shares and the axis a zero-centred bar chart needs — and
// nothing else. Every figure it handles was produced by `weeklyChanges.ts`
// from two published snapshots; this module never derives a portfolio
// semantic of its own.
//
// ── WHAT THIS MEASURES, AND WHAT IT DOES NOT ──────────────────────────────
//
// A "contribution" here is a node's ACTUAL VALUE CHANGE between the two
// compared publications: `closing_value − opening_value`. Below the portfolio
// total the source carries no per-asset flows, so a node's investment RETURN
// is not derivable and is never implied — a holding that grew only because
// money was moved into it contributes exactly as much as one that grew on
// performance, and the surface says so. This is the same measure the retired
// bridge drew; only the drawing changed.
//
// ── THE ORDERING IS DELIBERATE, AND IT IS A DEPARTURE ─────────────────────
//
// The bridge preserved the BOOK'S OWN order, because a bridge reads as a
// running story from opening to closing and reordering it would have broken
// the narrative. A contributors-and-detractors chart answers a different
// question — WHICH POSITIONS MOVED THE PORTFOLIO, AND BY HOW MUCH — so it is
// ranked: descending by signed value, i.e. contributors first largest to
// smallest, then detractors smallest to largest, so the whole set reads as one
// descending profile. Nothing is dropped by the ranking; every
// available component is present, so the set still tiles the total no matter
// where a bar sits.
//
// ── EXACT-ZERO COMPONENTS ARE OMITTED, NEVER HIDDEN ───────────────────────
//
// A component whose value did not move contributes a zero-height bar and one
// more x-axis label for no information. It is removed from the plot AND
// reported on `omittedZero`, so the surface can state how many were withheld.
// An UNAVAILABLE component is a different thing entirely and is never treated
// as a zero: it has no bar because it has no number, and it is reported
// separately so the set can be marked as not tiling the total.
//
// ── THE SET MUST STILL RECONCILE ──────────────────────────────────────────
//
// `Σ components + residual = closing − opening`, inside the § 6d tolerance.
// A shortfall becomes an EXPLICIT residual item, never an adjustment folded
// into the largest component and never closed by dropping a row. This mirrors
// `buildWaterfall` exactly — deliberately, so the chart and any reconciliation
// statement beside it can never disagree — and the suite asserts the two agree
// on the same inputs.

import type { ChangeNode, NodeLifecycle, NodeUnavailableReason } from './weeklyChanges.ts'
import { reconciliationTolerance } from './weeklyChanges.ts'

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

// ---------------------------------------------------------------------------
// 1 · The plotted set
// ---------------------------------------------------------------------------

export type ContributionDirection = 'contributor' | 'detractor'

export interface ContributionItem {
  /** The hierarchy row this bar is. Null ONLY for the reconciliation residual. */
  rowKey: string | null
  labelEs: string
  labelEn: string | null
  /** The node's value change over the compared endpoints. Always finite. */
  value: number
  direction: ContributionDirection
  kind: 'component' | 'residual'
  /**
   * `value ÷ net portfolio value change`. Null when the net change is zero or
   * unknown — a share of nothing is not 0 %, it is unanswerable, and printing
   * a number there would invent one.
   *
   * The sign is meaningful and is NOT normalised away: over a period when the
   * portfolio fell, a positive component shows a negative share because it
   * offset the decline rather than caused it.
   */
  shareOfNet: number | null
  /** True only when the source publishes a decomposition below this node. */
  drillable: boolean
  lifecycle: NodeLifecycle | null
  /** Valueless label containers this node was reached through, outer → inner. */
  groupPath: string[]
}

export interface OmittedComponent {
  rowKey: string
  labelEs: string
  labelEn: string | null
}

export interface UnavailableComponent extends OmittedComponent {
  reason: NodeUnavailableReason | null
}

export interface ContributionSet {
  /** Descending by signed value: contributors largest→smallest, then detractors smallest→largest. */
  items: ContributionItem[]
  openingValue: number | null
  closingValue: number | null
  /** `closing − opening`. The figure every share divides by. */
  netChange: number | null
  /** `netChange ÷ opening`. Null off a non-positive opening — never infinite. */
  netChangeRatio: number | null
  /** Components that moved by exactly nothing, withheld from the plot. */
  omittedZero: OmittedComponent[]
  /** Components with no usable figure. Never plotted, never read as zero. */
  unavailable: UnavailableComponent[]
  /**
   * How many plotted components were absent from the OPENING publication, so
   * § 14 read their opening value as an economic zero. Reported because it is
   * the usual reason a residual appears over a long window: the parent existed
   * at the opening with a value its present-day components cannot account for.
   */
  newPositionCount: number
  residual: number | null
  tolerance: number
  /**
   * complete    — every component available and the set ties inside tolerance
   * partial     — a component is unavailable, or a residual was required
   * unavailable — the endpoints themselves could not be resolved
   */
  status: 'complete' | 'partial' | 'unavailable'
}

export interface ContributionInput {
  openingValue: number | null
  closingValue: number | null
  /** The non-overlapping tiling of the subject. Order is irrelevant; this ranks. */
  components: ReadonlyArray<{ node: ChangeNode; groupPath?: string[] }>
  /** Asked once per component; the ONLY thing that earns a drill affordance. */
  isDrillable: (rowKey: string) => boolean
  residualLabel: { es: string; en: string }
}

const EMPTY: Omit<ContributionSet, 'openingValue' | 'closingValue' | 'tolerance'> = {
  items: [],
  netChange: null,
  netChangeRatio: null,
  omittedZero: [],
  unavailable: [],
  newPositionCount: 0,
  residual: null,
  status: 'unavailable',
}

/**
 * Ranked, reconciled, omission-aware — the whole plotted set in one pass.
 *
 * Fails closed on either endpoint: without both a real opening and a real
 * closing value there is no change to decompose, and a chart drawn anyway
 * would be describing a period it cannot measure.
 */
export function buildContributionSet(input: ContributionInput): ContributionSet {
  const tolerance = reconciliationTolerance(input.openingValue)
  const base = { openingValue: input.openingValue, closingValue: input.closingValue, tolerance }

  if (!finite(input.openingValue) || !finite(input.closingValue)) {
    return { ...EMPTY, ...base }
  }

  const netChange = input.closingValue - input.openingValue
  const omittedZero: OmittedComponent[] = []
  const unavailable: UnavailableComponent[] = []
  const plotted: Array<{ node: ChangeNode; groupPath: string[]; value: number }> = []

  for (const c of input.components) {
    const n = c.node
    if (n.status !== 'ok' || !finite(n.weeklyValueChange)) {
      unavailable.push({
        rowKey: n.rowKey,
        labelEs: n.labelEs,
        labelEn: n.labelEn,
        reason: n.unavailableReason,
      })
      continue
    }
    if (n.weeklyValueChange === 0) {
      omittedZero.push({ rowKey: n.rowKey, labelEs: n.labelEs, labelEn: n.labelEn })
      continue
    }
    plotted.push({ node: n, groupPath: c.groupPath ?? [], value: n.weeklyValueChange })
  }

  // Omitting a zero from the PLOT never omits it from the RECONCILIATION: a
  // zero adds nothing to the sum by definition, so the sum over the plotted
  // components is the sum over every available one.
  const availableSum = plotted.reduce((a, p) => a + p.value, 0)
  const residual = netChange - availableSum
  const ties = unavailable.length === 0 && Math.abs(residual) <= tolerance

  const share = (v: number) => (netChange !== 0 ? v / netChange : null)

  const items: ContributionItem[] = plotted.map((p) => ({
    rowKey: p.node.rowKey,
    labelEs: p.node.labelEs,
    labelEn: p.node.labelEn,
    value: p.value,
    direction: p.value > 0 ? ('contributor' as const) : ('detractor' as const),
    kind: 'component' as const,
    shareOfNet: share(p.value),
    drillable: input.isDrillable(p.node.rowKey),
    lifecycle: p.node.lifecycle,
    groupPath: p.groupPath,
  }))

  // The residual joins the ranking as an ordinary signed magnitude, so the
  // chart reads left to right by size with no special case — but it keeps its
  // own `kind`, because it is an unattributed remainder rather than a holding
  // that moved, and the surface colours and labels it differently.
  //
  // A subject with NO components at all gets none. The source publishes
  // nothing beneath a leaf — a directly-held position such as Proporcional
  // Otras Sociedades, or a named holding on Main — so there is no tiling for a
  // remainder to be the remainder OF, and a lone bar equal to the subject's
  // entire change would be a decomposition that decomposes nothing. The
  // status still reports `partial`, which is the honest reading: an empty
  // component set does not account for the change.
  if (!ties && unavailable.length === 0 && residual !== 0 && input.components.length > 0) {
    items.push({
      rowKey: null,
      labelEs: input.residualLabel.es,
      labelEn: input.residualLabel.en,
      value: residual,
      direction: residual > 0 ? 'contributor' : 'detractor',
      kind: 'residual',
      shareOfNet: share(residual),
      drillable: false,
      lifecycle: null,
      groupPath: [],
    })
  }

  return {
    ...base,
    items: rankContributions(items),
    netChange,
    // A non-positive opening level cannot carry a meaningful percentage; null,
    // never a sign-flipped or infinite ratio.
    netChangeRatio: input.openingValue > 0 ? netChange / input.openingValue : null,
    omittedZero,
    unavailable,
    newPositionCount: plotted.filter((p) => p.node.lifecycle === 'new_position').length,
    residual: unavailable.length === 0 ? residual : null,
    status: ties ? 'complete' : 'partial',
  }
}

/**
 * R13.R3C.2 — DESCENDING BY SIGNED VALUE, which is exactly the owner's rule:
 * contributors first, largest to smallest, then detractors from the smallest
 * to the largest (`+10, +7, +2, −1, −4, −9`).
 *
 * It is expressed as one comparator rather than two branches because the two
 * are the same statement: no plotted value is ever zero (an exact zero is
 * omitted from the set), so every contributor sorts above every detractor by
 * construction, and the direction grouping falls out of the magnitude order
 * instead of being imposed on top of it.
 *
 * The R13.R3C ordering ran detractors by DESCENDING magnitude, which put the
 * two extremes at the outer edges and the small movers in the middle. Reading
 * the same set as one monotonically descending profile — biggest gain on the
 * left, biggest loss on the right — puts the two answers the reader came for
 * at the ends and makes the crossing of the zero line the chart's own divider.
 *
 * Ties break on label so the order is deterministic across renders and
 * independent of any locale's own collation.
 */
export function rankContributions(items: readonly ContributionItem[]): ContributionItem[] {
  return [...items].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value
    return a.labelEs < b.labelEs ? -1 : a.labelEs > b.labelEs ? 1 : 0
  })
}

// ---------------------------------------------------------------------------
// 2 · The value axis
// ---------------------------------------------------------------------------

export interface ContributionAxis {
  /**
   * Always ≤ 0 and ≤ every plotted value, and derived from the DEEPEST
   * DETRACTOR alone — exactly 0 when nothing fell. Never mirrored off `max`.
   */
  min: number
  /**
   * Always ≥ 0 and ≥ every plotted value, and derived from the LARGEST
   * CONTRIBUTOR alone — exactly 0 when nothing rose. Never mirrored off `min`.
   */
  max: number
  /** The interval between gridlines. 0 only when there is nothing to plot. */
  step: number
  /** Ascending, always containing exactly 0. */
  ticks: number[]
}

/**
 * A gridline interval is always 1, 2 or 5 × a power of ten. Nothing else is
 * ever printed on this axis, at any magnitude.
 */
const NICE_MULTIPLES = [1, 2, 5] as const

/**
 * The plotted range must occupy at least this much of the domain the axis
 * draws. Below it the chart is mostly empty gridlines, and the bars that carry
 * the answer are squeezed into a fraction of the height they were given.
 */
export const AXIS_MIN_FILL = 0.8

/** Gridline budget. At most this many intervals across the whole domain. */
export const AXIS_MAX_INTERVALS = 8

/** Below this an "axis" is a bare pair of bounds rather than a readable scale. */
export const AXIS_MIN_INTERVALS = 2

/**
 * R13.R3C.3 — AN ASYMMETRIC FIT.
 *
 * Zero is fixed, and the two sides are bounded INDEPENDENTLY: the positive
 * bound rounds outward from the largest contributor, the negative bound rounds
 * outward from the deepest detractor, and neither is derived from the other or
 * from the total span. A period of +22M against −2M therefore stops just below
 * zero rather than sinking to −10M because the upside happened to be large.
 *
 * ── WHY THE OLD ONE WASTED THE SMALL SIDE ─────────────────────────────────
 *
 * The step used to come from `span / 4`, where `span` measured across zero, so
 * a large upside inflated the interval that the small downside then had to
 * round out to — one step of dead space, but a step sized by the OTHER side's
 * magnitude. It compounded: the multiple was chosen by rounding the raw
 * interval UP (`normalized <= m`), which pushed both bounds further out again.
 * On the real book that printed a −10M gridline under a −2M bar.
 *
 * ── HOW THE STEP IS CHOSEN NOW ────────────────────────────────────────────
 *
 * Every nice step near the data is costed, not just one derived arithmetically:
 * for each, both bounds are rounded outward and the resulting FILL is measured
 * — how much of the drawn domain the plotted range actually occupies. The axis
 * takes the FEWEST gridlines that still fill it, so a well-fitting coarse scale
 * always beats a finer one and the chart is never denser than it needs to be.
 * If nothing inside the gridline budget reaches the floor (a set spanning three
 * orders of magnitude around zero cannot), the best available fill wins rather
 * than a fixed formula's answer.
 *
 * ── WHY A ROUNDED STEP IS ALLOWED HERE AT ALL ─────────────────────────────
 *
 * This project bans invented round numbers on the Portfolio Evolution axis,
 * where the ticks must come off the plotted series itself: that chart draws
 * LEVELS, and a rounded domain would move the line relative to its own scale.
 * This chart draws CHANGES around a fixed, meaningful zero. Its gridlines are
 * a scale annotation only — every bar still starts at exact zero and ends at
 * its exact value — and both bounds are always widened OUTWARD, never inward,
 * so a rounded axis can never crop, clip or rescale a real figure. That
 * invariant (`min ≤ every value ≤ max`) is asserted by the suite, on both
 * sides, for every representative shape.
 */
export function contributionAxis(values: readonly number[]): ContributionAxis {
  const usable = values.filter((v) => Number.isFinite(v))
  const lo = Math.min(0, ...usable)
  const hi = Math.max(0, ...usable)
  const span = hi - lo

  // Nothing moved, or nothing to draw: one gridline at zero, no invented scale.
  if (!(span > 0)) return { min: 0, max: 0, step: 0, ticks: [0] }

  const step = chooseAxisStep(hi, -lo, span)
  const max = roundToStep(stepsOutward(hi, step) * step, step)
  const min = roundToStep(-stepsOutward(-lo, step) * step, step)

  const ticks: number[] = []
  const count = Math.round((max - min) / step)
  for (let i = 0; i <= count && i <= 64; i++) ticks.push(roundToStep(min + i * step, step))

  // Floating-point drift can leave zero as `-1e-12`; the zero gridline is the
  // one line that must be exactly zero, because every bar is anchored to it.
  const zeroAt = ticks.findIndex((t) => Math.abs(t) < step * 1e-9)
  if (zeroAt >= 0) ticks[zeroAt] = 0

  return { min, max, step, ticks }
}

/**
 * How many whole steps one side needs to clear its own extreme — never fewer,
 * so a bar can never be cropped, and never a second one for a value that
 * already lands exactly on a gridline (the epsilon absorbs binary drift, so
 * `3 × step` does not become four intervals because it stored as `3.0000004`).
 *
 * A side with nothing on it takes NO steps: an all-contributors period stops
 * the axis at exact zero instead of inventing an empty negative region.
 */
function stepsOutward(magnitude: number, step: number): number {
  if (!(magnitude > 0)) return 0
  return Math.max(1, Math.ceil(magnitude / step - 1e-9))
}

/** The fewest gridlines that still fill the plot; failing that, the best fit. */
function chooseAxisStep(hi: number, absLo: number, span: number): number {
  const decade = Math.floor(Math.log10(span))
  const candidates: Array<{ step: number; intervals: number; fill: number }> = []

  for (let n = decade - 2; n <= decade + 1; n++) {
    for (const m of NICE_MULTIPLES) {
      const step = m * Math.pow(10, n)
      if (!Number.isFinite(step) || step <= 0) continue
      const intervals = stepsOutward(hi, step) + stepsOutward(absLo, step)
      if (intervals < AXIS_MIN_INTERVALS || intervals > AXIS_MAX_INTERVALS) continue
      candidates.push({ step, intervals, fill: span / (intervals * step) })
    }
  }

  // Unreachable for any finite span — halving a step at most doubles the
  // interval count, so the budget cannot be stepped over — but a scale with no
  // candidate must still produce a nice number rather than a raw quotient.
  if (candidates.length === 0) return niceStepAtLeast(span / AXIS_MAX_INTERVALS)

  // Coarsest first, so a scale that fits with fewer gridlines always wins.
  candidates.sort((a, b) => a.intervals - b.intervals || b.step - a.step)
  const fitted = candidates.find((c) => c.fill >= AXIS_MIN_FILL)
  if (fitted !== undefined) return fitted.step

  // Nothing inside the budget fills the plot: take the fullest, then the
  // coarsest among equals. Deterministic, and still a nice number.
  let best = candidates[0]
  for (const c of candidates) {
    if (c.fill > best.fill + 1e-12) best = c
  }
  return best.step
}

/** The smallest 1 / 2 / 5 × 10ⁿ that is not below `raw`. */
function niceStepAtLeast(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const normalized = raw / magnitude
  const multiple = NICE_MULTIPLES.find((m) => normalized <= m) ?? 10
  return magnitude * multiple
}

/** Kills binary-representation drift so a 0.3 step does not print 0.30000000000000004. */
function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(step)) + 2))
  const factor = Math.pow(10, decimals)
  const scaled = Math.round(value * factor) / factor
  return Object.is(scaled, -0) ? 0 : scaled
}
