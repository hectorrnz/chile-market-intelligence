// R13.7 — pure Overview (One Pager) composition rules (docs 06 §§ 2-5, 07 § 7.1).
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import — every
// financial derivation on the generated Overview lives here so it is directly
// unit-testable against fixtures, and the API route is reduced to fetch +
// compose + serialize.
//
// STRUCTURAL IDENTIFICATION, NEVER LABEL GUESSING. The One Pager's rows are
// identified through the publication's own verified structure:
//
//   * The `SUBTOTAL` row (portfolio ex Chilean equities) is the row the
//     parser NUMERICALLY BOUND to the `ex_chilean_equities` performance block
//     at publish time (`boundRowKey`), and `TOTAL` is the row bound to
//     `with_chilean_equities`. These bindings were proven against the source's
//     own arithmetic when the draft was parsed — far stronger evidence than
//     matching a label at read time.
//   * Main's remaining top-level `portfolio_subtotal` is the spine aggregate
//     `PORTFOLIO LÍQUIDO + ALTERNATIVOS` = the sum of the asset classes =
//     SUBTOTAL − INRETAIL (doc 02 § 5.3) — which is EXACTLY the third
//     allocation denominator (`Sin Acc Chile Sin Inretail`, doc 06 § 2.3).
//   * The one deliberate label match is the INRETAIL holding, because the
//     contract itself defines the concept by that name (`líquido ex INRETC1`);
//     when no such row exists the dependent metrics are unavailable.
//
// UNAVAILABLE IS NEVER ZERO, and a missing piece degrades ONLY what depends on
// it. Ambiguity (two candidate rows, a missing binding) fails closed to
// unavailable rather than guessing.

// ---------------------------------------------------------------------------
// Input shapes (structurally compatible with the read repository's outputs —
// declared here so this module imports nothing impure)
// ---------------------------------------------------------------------------

export interface OverviewSnapshotRow {
  rowKey: string
  parentRowKey: string | null
  depth: number
  displayOrder: number
  rowType: string
  labelEs: string
  labelEn: string | null
  currency: string
  value: number | null
  valueClass: string
  previousValue: number | null
  beginningOfYearValue: number | null
  difference: number | null
  differenceClass: string | null
}

export interface OverviewPerformanceRow {
  basis: string
  metric: string
  value: number | null
  valueClass: string
  boundRowKey: string | null
}

// ---------------------------------------------------------------------------
// 1 · Main-structure identification
// ---------------------------------------------------------------------------

export interface MainStructure {
  /** Bound to `ex_chilean_equities` — the One Pager's SUBTOTAL. */
  subtotalRow: OverviewSnapshotRow | null
  /** Bound to `with_chilean_equities` — the One Pager's TOTAL. */
  totalRow: OverviewSnapshotRow | null
  /** The remaining top-level portfolio_subtotal — `LÍQUIDO + ALTERNATIVOS`. */
  spineAggregateRow: OverviewSnapshotRow | null
  /** The asset-class rows, in display order. */
  assetClassRows: OverviewSnapshotRow[]
  /** Named holdings before SUBTOTAL (INRETAIL PERU CORP), display order. */
  holdingsBeforeSubtotal: OverviewSnapshotRow[]
  /** Named holdings between SUBTOTAL and TOTAL (ACCIONES CHILENAS). */
  holdingsBetween: OverviewSnapshotRow[]
}

function boundKeyFor(performance: readonly OverviewPerformanceRow[], basis: string): string | null {
  for (const p of performance) {
    if (p.basis === basis && typeof p.boundRowKey === 'string' && p.boundRowKey.length > 0) {
      return p.boundRowKey
    }
  }
  return null
}

/**
 * Identifies Main's spine from one publication's rows + performance bindings.
 * Every piece resolves independently and fails closed to null/empty — a
 * malformed structure degrades the dependent Overview elements to
 * unavailable, it never guesses.
 */
export function identifyMainStructure(
  rows: readonly OverviewSnapshotRow[],
  performance: readonly OverviewPerformanceRow[],
): MainStructure {
  const ordered = [...rows].sort((a, b) => a.displayOrder - b.displayOrder)

  const exKey = boundKeyFor(performance, 'ex_chilean_equities')
  const withKey = boundKeyFor(performance, 'with_chilean_equities')

  const aggregateTypes = new Set(['portfolio_subtotal', 'portfolio_total'])
  const subtotalRow =
    exKey !== null
      ? (ordered.find((r) => r.rowKey === exKey && aggregateTypes.has(r.rowType)) ?? null)
      : null
  const totalRow =
    withKey !== null
      ? (ordered.find((r) => r.rowKey === withKey && aggregateTypes.has(r.rowType)) ?? null)
      : null

  // The spine aggregate is the ONE remaining top-level portfolio_subtotal.
  // Zero or several remaining candidates → ambiguous → null (fail closed).
  const otherSubtotals = ordered.filter(
    (r) =>
      r.rowType === 'portfolio_subtotal' &&
      r.rowKey !== subtotalRow?.rowKey &&
      r.rowKey !== totalRow?.rowKey,
  )
  const spineAggregateRow = otherSubtotals.length === 1 ? otherSubtotals[0] : null

  const assetClassRows = ordered.filter((r) => r.rowType === 'asset_class')

  const holdings = ordered.filter((r) => r.rowType === 'named_holding')
  const holdingsBeforeSubtotal =
    subtotalRow !== null ? holdings.filter((h) => h.displayOrder < subtotalRow.displayOrder) : []
  const holdingsBetween =
    subtotalRow !== null && totalRow !== null
      ? holdings.filter(
          (h) =>
            h.displayOrder > subtotalRow.displayOrder && h.displayOrder < totalRow.displayOrder,
        )
      : []

  return {
    subtotalRow,
    totalRow,
    spineAggregateRow,
    assetClassRows,
    holdingsBeforeSubtotal,
    holdingsBetween,
  }
}

// ---------------------------------------------------------------------------
// 2 · Comparison table (doc 06 § 2.1 — Cierre Semanal)
// ---------------------------------------------------------------------------

function flatten(row: OverviewSnapshotRow): OverviewSnapshotRow {
  // The comparison presents the spine as a flat summary — original depths came
  // from the full hierarchy (asset classes sit under their group headers,
  // which the One Pager does not show).
  return { ...row, depth: 0, parentRowKey: null }
}

/**
 * The One Pager's Cierre Semanal rows, derived structurally: the asset-class
 * lines and INRETAIL, then SUBTOTAL, then ACCIONES CHILENAS, then TOTAL —
 * exactly doc 06 § 2.1's row set, in the publication's own display order.
 * Null when the structure could not be identified.
 */
export function buildComparisonRows(s: MainStructure): OverviewSnapshotRow[] | null {
  if (!s.subtotalRow || !s.totalRow) return null
  const before = [...s.assetClassRows, ...s.holdingsBeforeSubtotal].sort(
    (a, b) => a.displayOrder - b.displayOrder,
  )
  return [...before, s.subtotalRow, ...s.holdingsBetween, s.totalRow].map(flatten)
}

// ---------------------------------------------------------------------------
// 3 · Allocation on three bases (doc 06 §§ 2.3, 5 element 12)
// ---------------------------------------------------------------------------

export type AllocationBasisId = 'total' | 'ex_chilean' | 'ex_chilean_ex_inretail'

export interface AllocationEntry {
  rowKey: string
  labelEs: string
  labelEn: string | null
  value: number | null
  /** value ÷ denominator; null when either side is unavailable. */
  weight: number | null
}

export interface AllocationBasis {
  id: AllocationBasisId
  denominatorRowKey: string | null
  denominatorLabelEs: string | null
  denominatorLabelEn: string | null
  denominatorValue: number | null
  entries: AllocationEntry[]
  /**
   * ok        — every constituent present; weights computed
   * partial   — a constituent value is unavailable; its weight is null and the
   *             tie-out is indeterminate
   * unavailable — no denominator (or structure unidentified); no weights
   */
  status: 'ok' | 'partial' | 'unavailable'
  /**
   * Σ constituents − denominator when all values are present and the gap
   * exceeds the § 6d-style tolerance — surfaced as a visible reconciliation
   * warning, NEVER silently absorbed. Null when it ties or is indeterminate.
   */
  residual: number | null
}

const RECON_ABS_TOLERANCE = 0.01
const RECON_REL_TOLERANCE = 1e-6

function buildBasis(
  id: AllocationBasisId,
  denominator: OverviewSnapshotRow | null,
  constituents: readonly OverviewSnapshotRow[],
): AllocationBasis {
  const denomValue =
    denominator !== null && denominator.value !== null && Number.isFinite(denominator.value)
      ? denominator.value
      : null

  if (denominator === null || denomValue === null || denomValue === 0 || constituents.length === 0) {
    return {
      id,
      denominatorRowKey: denominator?.rowKey ?? null,
      denominatorLabelEs: denominator?.labelEs ?? null,
      denominatorLabelEn: denominator?.labelEn ?? null,
      denominatorValue: denomValue,
      entries: constituents.map((c) => ({
        rowKey: c.rowKey,
        labelEs: c.labelEs,
        labelEn: c.labelEn,
        value: c.value,
        weight: null,
      })),
      status: 'unavailable',
      residual: null,
    }
  }

  let anyNull = false
  let sum = 0
  const entries: AllocationEntry[] = constituents.map((c) => {
    const v = c.value !== null && Number.isFinite(c.value) ? c.value : null
    if (v === null) anyNull = true
    else sum += v
    return {
      rowKey: c.rowKey,
      labelEs: c.labelEs,
      labelEn: c.labelEn,
      value: v,
      weight: v === null ? null : v / denomValue,
    }
  })

  let residual: number | null = null
  if (!anyNull) {
    const gap = sum - denomValue
    const tolerance = Math.max(RECON_ABS_TOLERANCE, Math.abs(denomValue) * RECON_REL_TOLERANCE)
    if (Math.abs(gap) > tolerance) residual = gap
  }

  return {
    id,
    denominatorRowKey: denominator.rowKey,
    denominatorLabelEs: denominator.labelEs,
    denominatorLabelEn: denominator.labelEn,
    denominatorValue: denomValue,
    entries,
    status: anyNull ? 'partial' : 'ok',
    residual,
  }
}

/**
 * The three allocation bases, each with its OWN structurally-derived
 * denominator and constituent set (weights over unlike sets is exactly the
 * double-counting the contract forbids):
 *
 *   total                  — TOTAL;              asset classes + all named holdings
 *   ex_chilean             — SUBTOTAL;           asset classes + INRETAIL
 *   ex_chilean_ex_inretail — LÍQUIDO+ALTERNATIVOS (spine aggregate);
 *                            asset classes only
 *
 * A parent row is never a constituent of its own basis, and no constituent set
 * mixes a subtotal with that subtotal's own components.
 */
export function buildAllocation(s: MainStructure): AllocationBasis[] {
  const beforeSubtotal = [...s.assetClassRows, ...s.holdingsBeforeSubtotal].sort(
    (a, b) => a.displayOrder - b.displayOrder,
  )
  return [
    buildBasis('total', s.totalRow, [...beforeSubtotal, ...s.holdingsBetween]),
    buildBasis('ex_chilean', s.subtotalRow, beforeSubtotal),
    buildBasis('ex_chilean_ex_inretail', s.spineAggregateRow, s.assetClassRows),
  ]
}

// ---------------------------------------------------------------------------
// 4 · Hero and performance blocks (doc 06 §§ 2.2, 5 elements 4-11)
// ---------------------------------------------------------------------------

export interface PerformanceBlockValues {
  basis: string
  flow: number | null
  weeklyReturn: number | null
  weeklyProfit: number | null
  ytdReturn: number | null
  ytdProfit: number | null
}

function metricValue(
  performance: readonly OverviewPerformanceRow[],
  basis: string,
  metric: string,
): number | null {
  const row = performance.find((p) => p.basis === basis && p.metric === metric)
  return row && row.value !== null && Number.isFinite(row.value) ? row.value : null
}

/** The two Main performance blocks, source-provided values only. */
export function extractPerformanceBlocks(
  performance: readonly OverviewPerformanceRow[],
): PerformanceBlockValues[] {
  const bases = ['ex_chilean_equities', 'with_chilean_equities']
  return bases
    .filter((b) => performance.some((p) => p.basis === b))
    .map((basis) => ({
      basis,
      flow: metricValue(performance, basis, 'flow'),
      weeklyReturn: metricValue(performance, basis, 'weekly_return'),
      weeklyProfit: metricValue(performance, basis, 'weekly_profit'),
      ytdReturn: metricValue(performance, basis, 'ytd_return'),
      ytdProfit: metricValue(performance, basis, 'ytd_profit'),
    }))
}

export interface OverviewHero {
  /** TOTAL portfolio value — the row bound to `with_chilean_equities`. */
  totalValue: number | null
  /** NMI-derived thisWeek − previousWeek on that same row. */
  weeklyDifference: number | null
  weeklyReturn: number | null
  ytdReturn: number | null
}

export function buildHero(
  s: MainStructure,
  performance: readonly OverviewPerformanceRow[],
): OverviewHero {
  return {
    totalValue: s.totalRow?.value ?? null,
    weeklyDifference: s.totalRow?.difference ?? null,
    weeklyReturn: metricValue(performance, 'with_chilean_equities', 'weekly_return'),
    ytdReturn: metricValue(performance, 'with_chilean_equities', 'ytd_return'),
  }
}

// ---------------------------------------------------------------------------
// 5 · InRetail portfolio impact (doc 06 § 3.3 row 46)
// ---------------------------------------------------------------------------

const INRETAIL_PATTERN = /inretail|inretc1/i

/**
 * `Mayor o menor valor en el portafolio` — the week-over-week change of the
 * INRETAIL PERU CORP portfolio line. A PORTFOLIO VALUE delta from published
 * snapshots (the row's own NMI-derived difference), requiring no market feed
 * (doc 06 § 3.3). Unavailable when no such holding exists in the publication.
 */
export function inretailImpact(s: MainStructure): {
  rowKey: string | null
  value: number | null
} {
  const row = s.holdingsBeforeSubtotal.find((h) => INRETAIL_PATTERN.test(h.labelEs)) ?? null
  return { rowKey: row?.rowKey ?? null, value: row?.difference ?? null }
}

// ---------------------------------------------------------------------------
// 6 · Evolution series (doc 06 §§ 2.4, 5 element 13)
// ---------------------------------------------------------------------------

export interface EvolutionPoint {
  date: string
  value: number
}

export interface EvolutionInput {
  publications: ReadonlyArray<{ id: string; asOfDate: string }>
  /** Per-publication performance bindings for scope main. */
  bindings: ReadonlyArray<{ publicationId: string; basis: string; boundRowKey: string | null }>
  /** Values of the bound rows, per publication. */
  boundValues: ReadonlyArray<{ publicationId: string; rowKey: string; value: number | null }>
}

function seriesFor(input: EvolutionInput, basis: string): EvolutionPoint[] {
  const points: EvolutionPoint[] = []
  const ordered = [...input.publications].sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : 1))
  for (const pub of ordered) {
    const binding = input.bindings.find(
      (b) => b.publicationId === pub.id && b.basis === basis && b.boundRowKey !== null,
    )
    if (!binding) continue // no binding → no point; NEVER carried forward
    const row = input.boundValues.find(
      (v) => v.publicationId === pub.id && v.rowKey === binding.boundRowKey,
    )
    if (!row || row.value === null || !Number.isFinite(row.value)) continue
    points.push({ date: pub.asOfDate, value: row.value })
  }
  return points
}

/**
 * The two `Evolución del Patrimonio` series across the FULL published history
 * — one point per current publication, from that publication's own bound
 * SUBTOTAL (sin acciones chilenas) and TOTAL (con acciones chilenas) rows. A
 * week whose binding or value is missing contributes no point: gaps stay
 * gaps, nothing is interpolated or carried forward.
 */
export function buildEvolutionSeries(input: EvolutionInput): {
  exChilean: EvolutionPoint[]
  withChilean: EvolutionPoint[]
} {
  return {
    exChilean: seriesFor(input, 'ex_chilean_equities'),
    withChilean: seriesFor(input, 'with_chilean_equities'),
  }
}

// ---------------------------------------------------------------------------
// 7 · Weekly-close alignment and benchmark arithmetic (doc 06 §§ 3.1, 4.4)
// ---------------------------------------------------------------------------

export interface BenchmarkBar {
  /** ISO date, YYYY-MM-DD. */
  date: string
  close: number
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Days since the UTC epoch for an ISO date string; null when malformed. */
function isoToEpochDays(iso: string): number | null {
  const m = ISO_DATE.exec(iso)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null
}

/**
 * Doc 06 § 4.4: for a publication week `W`, an instrument's observation is its
 * LAST available close on or before `W`, within a 5-calendar-day lookback.
 * Outside the window → null. Never interpolate, never carry forward beyond
 * the window, never substitute another instrument.
 */
export function alignWeeklyClose(
  bars: readonly BenchmarkBar[],
  weekDate: string,
  lookbackDays = 5,
): BenchmarkBar | null {
  const week = isoToEpochDays(weekDate)
  if (week === null) return null
  let best: BenchmarkBar | null = null
  let bestDays = -Infinity
  for (const bar of bars) {
    if (!Number.isFinite(bar.close)) continue
    const d = isoToEpochDays(bar.date)
    if (d === null) continue
    if (d > week || d < week - lookbackDays) continue
    if (d > bestDays) {
      bestDays = d
      best = bar
    }
  }
  return best
}

/** Weekly price return `(this − prev) ÷ prev`; null on any missing/degenerate input. */
export function weeklyPriceReturn(
  thisClose: number | null,
  prevClose: number | null,
): number | null {
  if (thisClose === null || prevClose === null) return null
  if (!Number.isFinite(thisClose) || !Number.isFinite(prevClose) || prevClose <= 0) return null
  return (thisClose - prevClose) / prevClose
}

/**
 * `Promedio Renta Fija` = the arithmetic mean of the AGGG, GHYG and CEMB
 * weekly returns — and ONLY when all three are present. The source itself
 * yields an error when a component is missing (doc 06 § 4.6); a partial mean
 * would be a different metric wearing the same label.
 */
export function fixedIncomeAverage(returns: ReadonlyArray<number | null>): number | null {
  if (returns.length !== 3) return null
  if (returns.some((r) => r === null || !Number.isFinite(r))) return null
  return (returns as number[]).reduce((a, b) => a + b, 0) / 3
}

export interface BenchmarkWeeklyResult {
  status: 'ok' | 'unavailable'
  /** Return ratio (0.0123 = +1.23%). */
  value: number | null
  observationDate: string | null
  previousObservationDate: string | null
}

/**
 * One instrument's aligned weekly return between the publication's own two
 * column dates. A missing previous-week date (a pre-R13.6 publication) or a
 * close outside either 5-day window → unavailable.
 */
export function benchmarkWeeklyReturn(
  bars: readonly BenchmarkBar[],
  thisWeekDate: string,
  previousWeekDate: string | null,
): BenchmarkWeeklyResult {
  if (previousWeekDate === null) {
    return { status: 'unavailable', value: null, observationDate: null, previousObservationDate: null }
  }
  const thisBar = alignWeeklyClose(bars, thisWeekDate)
  const prevBar = alignWeeklyClose(bars, previousWeekDate)
  const value = weeklyPriceReturn(thisBar?.close ?? null, prevBar?.close ?? null)
  if (value === null) {
    return {
      status: 'unavailable',
      value: null,
      observationDate: thisBar?.date ?? null,
      previousObservationDate: prevBar?.date ?? null,
    }
  }
  return {
    status: 'ok',
    value,
    observationDate: thisBar!.date,
    previousObservationDate: prevBar!.date,
  }
}
