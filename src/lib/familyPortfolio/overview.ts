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

// Relative `.ts` import, not the `@/` alias — this module is loaded directly by
// Node's native test runner (the standing convention for pure modules under
// test). `difference.ts` is the single home of the reconciliation tolerances
// and of the one displayed-Difference rule.
import {
  RECON_ABS_TOLERANCE,
  RECON_REL_TOLERANCE,
  resolveDisplayedDifference,
  type DifferenceReconciliation,
} from './difference.ts'

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

/** The two Main performance bases, in the One Pager's own order. */
export const MAIN_PERFORMANCE_BASES = ['ex_chilean_equities', 'with_chilean_equities'] as const

/**
 * A personal scope publishes ONE performance basis, named `total` (verified
 * against the live book: every personal publication carries exactly this basis,
 * with the same five metrics Main's bases carry). It is deliberately NOT called
 * `with_chilean_equities` — a personal portfolio has no Chilean-equities split,
 * and reusing Main's basis name would invite a reader to compare two different
 * constructions.
 */
export const PERSONAL_PERFORMANCE_BASES = ['total'] as const

/** Performance blocks for an explicit basis list, source-provided values only. */
export function extractPerformanceBlocksFor(
  performance: readonly OverviewPerformanceRow[],
  bases: readonly string[],
): PerformanceBlockValues[] {
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

/** The two Main performance blocks. Behaviour unchanged from R13.7. */
export function extractPerformanceBlocks(
  performance: readonly OverviewPerformanceRow[],
): PerformanceBlockValues[] {
  return extractPerformanceBlocksFor(performance, MAIN_PERFORMANCE_BASES)
}

export interface OverviewHero {
  /** TOTAL portfolio value — the row bound to `with_chilean_equities`. */
  totalValue: number | null
  /**
   * DERIVED: `value − previousValue` on that same row, through the shared
   * invariant — never the persisted figure passed through.
   */
  weeklyDifference: number | null
  /** Reconciliation of the derived difference against the persisted figure. */
  weeklyDifferenceStatus: DifferenceReconciliation
  weeklyReturn: number | null
  ytdReturn: number | null
  /**
   * R13.R5C.1 § 1 — the year-to-date P&L of the same basis, read from the same
   * published performance rows as `ytdReturn` through the same helper. It is a
   * READ, not a second calculation: the Weekly Performance strip already shows
   * this exact figure, and both now resolve it from one place, so the Overview
   * card and the Summary can never disagree about it.
   */
  ytdProfit: number | null
}

export function buildHero(
  s: MainStructure,
  performance: readonly OverviewPerformanceRow[],
): OverviewHero {
  const diff = resolveDisplayedDifference(
    s.totalRow?.value ?? null,
    s.totalRow?.previousValue ?? null,
    s.totalRow?.difference ?? null,
  )
  return {
    totalValue: s.totalRow?.value ?? null,
    weeklyDifference: diff.displayed,
    weeklyDifferenceStatus: diff.status,
    weeklyReturn: metricValue(performance, 'with_chilean_equities', 'weekly_return'),
    ytdReturn: metricValue(performance, 'with_chilean_equities', 'ytd_return'),
    ytdProfit: metricValue(performance, 'with_chilean_equities', 'ytd_profit'),
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
  /**
   * R13.R2 pass 4 § 2 — the SOURCE-STATED net flow for the week ending on
   * `date`, attached by the route from the same week's performance block so the
   * chart can plot a flow-adjusted path.
   *
   * Optional and never derived here: the two evolution BUILDERS below read
   * levels only. R13.R2E.1 § 2 — the flow field is a SPARSE EVENT field, so a
   * week with no stated flow keeps `null` and means NO MONEY MOVED, not
   * "unknown"; `flowUnavailable` is how a week says unknown.
   */
  flow?: number | null
  /**
   * R13.R2E.1 § 2 — true when the publication stated a flow this week that could
   * not be read as a number (error, malformed, ambiguous, explicitly
   * unavailable). Only such a week is UNKNOWN, and only such a week's step
   * cannot be flow-adjusted. No week in the current book carries it.
   */
  flowUnavailable?: boolean
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

/**
 * R13.R2C § 18 — a PERSONAL scope's single `Evolución del Patrimonio` series,
 * from that scope's OWN bound total row in each publication.
 *
 * Deliberately a separate function rather than a basis parameter on the Main
 * builder: a personal portfolio has ONE basis and it is named `total`, never a
 * Main basis name, and giving the two shapes one signature is how a caller ends
 * up rendering an Ex/Incl split that does not exist (§ 28).
 */
export function buildPersonalEvolutionSeries(input: EvolutionInput): EvolutionPoint[] {
  return seriesFor(input, 'total')
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

// ---------------------------------------------------------------------------
// 8 · Weekly snapshot figures (R13.R2 §§ 11-12)
// ---------------------------------------------------------------------------

export interface WeeklySnapshotFigures {
  beginningOfYear: number | null
  previousWeek: number | null
  thisWeek: number | null
  /** DERIVED: `thisWeek − previousWeek`, from the two figures shown above it. */
  difference: number | null
  /**
   * How the derived Difference compares with the publication's own persisted
   * figure. `mismatch` is surfaced as a visible reconciliation warning; the
   * displayed value stays the arithmetic either way.
   */
  differenceStatus: DifferenceReconciliation
}

const EMPTY_SNAPSHOT: WeeklySnapshotFigures = {
  beginningOfYear: null,
  previousWeek: null,
  thisWeek: null,
  difference: null,
  differenceStatus: 'not_comparable',
}

/**
 * The four Weekly Snapshot figures, from ONE row — the row the parser
 * numerically bound to the scope's performance basis.
 *
 * The three levels are source cells. The Difference is DERIVED from the two
 * levels actually displayed (`difference.ts`), so the card's arithmetic is
 * internally consistent by construction; the publication's persisted figure is
 * retained only as a cross-check and can never override it. A missing anchor
 * (the earliest week on record has no previous week and no year-start
 * baseline) leaves the Difference null — never 0, never carried forward, and
 * never filled in from the persisted figure.
 */
export function buildWeeklySnapshot(row: OverviewSnapshotRow | null): WeeklySnapshotFigures {
  if (row === null) return { ...EMPTY_SNAPSHOT }
  const finite = (v: number | null) => (v !== null && Number.isFinite(v) ? v : null)
  const thisWeek = finite(row.value)
  const previousWeek = finite(row.previousValue)
  const diff = resolveDisplayedDifference(thisWeek, previousWeek, row.difference)
  return {
    beginningOfYear: finite(row.beginningOfYearValue),
    previousWeek,
    thisWeek,
    difference: diff.displayed,
    differenceStatus: diff.status,
  }
}

// ---------------------------------------------------------------------------
// 9 · Personal-scope composition (R13.R2 § 10)
// ---------------------------------------------------------------------------

export interface PersonalStructure {
  /** The row bound to the scope's own `total` performance basis. */
  totalRow: OverviewSnapshotRow | null
  /** The allocation constituents: asset classes plus top-level named holdings. */
  constituentRows: OverviewSnapshotRow[]
}

/**
 * Identifies a PERSONAL scope's spine. Same discipline as
 * `identifyMainStructure`: the total is the row the parser NUMERICALLY BOUND to
 * the scope's performance basis at publish time, never a label match and never
 * "the row typed portfolio_total" — a personal scope routinely carries several
 * such rows (verified live: 1, 2 and 3 across the three personal scopes), so
 * picking by type alone would be ambiguous and would sometimes be wrong.
 *
 * THE CONSTITUENT SET IS `asset_class` + `named_holding`, AND THAT IS A
 * MEASURED RESULT, NOT AN ASSUMPTION. Against the live book, over three
 * separate weeks and all three personal scopes, those rows sum to the bound
 * total with a relative gap of 0 — exactly, but for one reading of 2e-16, i.e.
 * floating point. `asset_class` ALONE does not tie for two of the three scopes:
 * they hold named positions outside the asset-class spine, exactly as Main
 * holds INRETAIL outside it. `sociedad_total` and `sociedad_subtotal` are
 * excluded because they aggregate those same asset classes (§ 15's parent +
 * child double count), and `sub_asset_class` because those are children of the
 * asset classes. A structure that does not tie is reported by `buildBasis` as a
 * VISIBLE residual — never silently absorbed.
 */
export function identifyPersonalStructure(
  rows: readonly OverviewSnapshotRow[],
  performance: readonly OverviewPerformanceRow[],
): PersonalStructure {
  const ordered = [...rows].sort((a, b) => a.displayOrder - b.displayOrder)

  const boundKey = boundKeyFor(performance, 'total')
  const aggregateTypes = new Set(['portfolio_total', 'portfolio_subtotal'])
  const totalRow =
    boundKey !== null
      ? (ordered.find((r) => r.rowKey === boundKey && aggregateTypes.has(r.rowType)) ?? null)
      : null

  const constituentRows = ordered.filter(
    (r) => r.rowType === 'asset_class' || r.rowType === 'named_holding',
  )

  return { totalRow, constituentRows }
}

/**
 * A personal scope's SINGLE allocation basis. Personal portfolios have no
 * Chilean-equities split, so there is one denominator and one constituent set —
 * presenting three bases here would fabricate distinctions the source does not
 * make. Built through the same `buildBasis` the Main bases use, so the
 * partial / residual / unavailable semantics are identical.
 */
export function buildPersonalAllocation(s: PersonalStructure): AllocationBasis[] {
  return [buildBasis('total', s.totalRow, s.constituentRows)]
}

/**
 * A personal scope's hero figures, from its own bound total row and its own
 * `total` performance basis. It can never read a Main row: the caller passes
 * only that scope's rows, and no Main basis name is consulted here.
 */
export function buildPersonalHero(
  s: PersonalStructure,
  performance: readonly OverviewPerformanceRow[],
): OverviewHero {
  // Same shared invariant as Main's hero — one field, one display semantic.
  const diff = resolveDisplayedDifference(
    s.totalRow?.value ?? null,
    s.totalRow?.previousValue ?? null,
    s.totalRow?.difference ?? null,
  )
  return {
    totalValue: s.totalRow?.value ?? null,
    weeklyDifference: diff.displayed,
    weeklyDifferenceStatus: diff.status,
    weeklyReturn: metricValue(performance, 'total', 'weekly_return'),
    ytdReturn: metricValue(performance, 'total', 'ytd_return'),
    ytdProfit: metricValue(performance, 'total', 'ytd_profit'),
  }
}

/**
 * A personal scope's Weekly-close rows: the constituents in display order, then
 * the bound total — the same flattened presentation Main's comparison uses.
 * Null when the total could not be identified: fail closed rather than render a
 * partial table that implies a total nothing established.
 */
export function buildPersonalComparisonRows(s: PersonalStructure): OverviewSnapshotRow[] | null {
  if (!s.totalRow) return null
  return [...s.constituentRows, s.totalRow].map(flatten)
}
