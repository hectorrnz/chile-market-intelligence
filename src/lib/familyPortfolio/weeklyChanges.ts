// R13.8 — Weekly Changes: the complete financial contract, PURE and testable.
//
// Doc 07 Part A2 (calculations) and Part A3 (visualizations) are BINDING; this
// module implements them and nothing else. No component below computes a
// portfolio semantic of its own — every figure a chart or table renders is
// produced here first.
//
// ── THE TWO RULES THAT SHAPE EVERYTHING ────────────────────────────────────
//
// 1. WEEKLY VALUE CHANGE IS RECOMPUTED FROM TWO PUBLISHED SNAPSHOTS. It is
//    never read from the source's own `Diferencia` column (doc 07 § 6b, doc 02
//    § 4). The Stage-7 Overview legitimately shows that column because it
//    reproduces the workbook's own weekly-close presentation; Stage 8 is a
//    different measure and derives it itself, from THIS published week and the
//    IMMEDIATELY PRECEDING PUBLISHED week.
//
// 2. BELOW THE PORTFOLIO TOTAL THESE ARE VALUE CHANGES, NOT RETURNS. The
//    source carries no per-asset flows (doc 07 §§ 2, 3.2), so a node's return
//    is not derivable and must never be implied. `Impact on Portfolio Value`
//    is a node's dollar change over the portfolio's OPENING value — exact, and
//    deliberately not called a return contribution (doc 07 § 6a).
//
// Terminology is fixed by doc 07 § 4.2 and the forbidden list by § 4.3; a test
// enforces both in EN and ES.

// ---------------------------------------------------------------------------
// 0 · Inputs
// ---------------------------------------------------------------------------

/** One hierarchy row of one publication, as the read layer returns it. */
export interface WeeklyChangeInputRow {
  rowKey: string
  parentRowKey: string | null
  depth: number
  displayOrder: number
  rowType: string
  labelEs: string
  labelEn: string | null
  currency: string
  value: number | null
}

// ---------------------------------------------------------------------------
// 0b · Comparison range (R13.R1.1 §§ 13, 14)
// ---------------------------------------------------------------------------

/**
 * WEEKLY compares a week with the one published immediately before it. CUSTOM
 * compares any two normalized weeks, however far apart.
 *
 * The mode is carried, not inferred from the gap: two ADJACENT weeks chosen by
 * hand are still a custom comparison, and a weekly comparison across a
 * publication gap is still weekly. The surface titles itself from this field,
 * which is what keeps a 23-Aug-2024 → 31-Jul-2026 range from being labelled a
 * "Weekly Change" (§ 13).
 */
export type ComparisonMode = 'weekly' | 'custom'

export interface ComparisonRange<T> {
  mode: ComparisonMode
  /** The LATER endpoint — the week whose portfolio is being described. */
  current: T
  /** The EARLIER endpoint. Null only for the earliest week in weekly mode. */
  previous: T | null
}

export type ComparisonFailure = WeekPairFailure | 'from_not_found' | 'from_not_before_to'

/**
 * Resolves an arbitrary FROM → TO comparison over the scope's current
 * publications (§ 13).
 *
 * Both endpoints must be published weeks — a date the book does not hold is
 * refused rather than snapped to the nearest one (§ 12), because a range whose
 * endpoints are not the dates the user asked for is a different measurement
 * wearing the same label. `from` must be strictly earlier than `to`: an equal
 * pair would report a zero change for a period that never elapsed, and a
 * reversed pair would silently invert every sign.
 */
export function selectComparisonRange<T extends { asOfDate: string }>(
  currentPublications: readonly T[],
  from: string,
  to: string,
): { ok: true; selection: ComparisonRange<T> } | { ok: false; code: ComparisonFailure } {
  if (currentPublications.length === 0) return { ok: false, code: 'no_publications' }
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (!iso.test(from)) return { ok: false, code: 'from_not_found' }
  if (!iso.test(to)) return { ok: false, code: 'week_not_found' }
  if (!(from < to)) return { ok: false, code: 'from_not_before_to' }

  const current = currentPublications.find((p) => p.asOfDate === to) ?? null
  if (current === null) return { ok: false, code: 'week_not_found' }
  const previous = currentPublications.find((p) => p.asOfDate === from) ?? null
  if (previous === null) return { ok: false, code: 'from_not_found' }

  return { ok: true, selection: { mode: 'custom', current, previous } }
}

/** One publication's performance row (source-provided figures). */
export interface WeeklyChangePerformanceRow {
  basis: string
  metric: string
  value: number | null
  boundRowKey: string | null
}

// ---------------------------------------------------------------------------
// 1 · Week-pair selection (doc 07 § 6b)
// ---------------------------------------------------------------------------

export type WeekPairFailure = 'no_publications' | 'week_not_found'

export interface WeekPairSelection<T> {
  current: T
  /**
   * The IMMEDIATELY PRECEDING PUBLISHED week — never "seven days earlier",
   * never the workbook's own previous-week column, never an unpublished
   * upload. If published history holds 17 Jul, 24 Jul and 7 Aug, then 7 Aug's
   * previous week is 24 JUL; 31 Jul does not exist and is never fabricated.
   *
   * Null on the earliest published week: weekly-change analysis is then
   * genuinely unavailable, and no zero change is synthesised.
   */
  previous: T | null
}

/**
 * Picks the selected week and its predecessor out of the CURRENT publications
 * of a scope. Superseded revisions never reach this function — the caller
 * reads `is_current` rows only — so a rolled-back revision cannot become
 * either side of the pair.
 */
export function selectWeekPair<T extends { asOfDate: string }>(
  currentPublications: readonly T[],
  asOf: string | null,
): { ok: true; selection: WeekPairSelection<T> } | { ok: false; code: WeekPairFailure } {
  if (currentPublications.length === 0) return { ok: false, code: 'no_publications' }

  const ordered = [...currentPublications].sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : a.asOfDate > b.asOfDate ? 1 : 0))

  let currentIndex: number
  if (asOf === null) {
    currentIndex = ordered.length - 1
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return { ok: false, code: 'week_not_found' }
    currentIndex = ordered.findIndex((p) => p.asOfDate === asOf)
    if (currentIndex < 0) return { ok: false, code: 'week_not_found' }
  }

  return {
    ok: true,
    selection: {
      current: ordered[currentIndex],
      previous: currentIndex > 0 ? ordered[currentIndex - 1] : null,
    },
  }
}

// ---------------------------------------------------------------------------
// 2 · Change nodes (doc 07 §§ 6a, 6c)
// ---------------------------------------------------------------------------

export type NodeStatus = 'ok' | 'unavailable'

export type NodeUnavailableReason =
  | 'missing_current'
  | 'missing_previous'
  | 'missing_both'
  | 'currency_mismatch'

/**
 * How a node's holding period relates to the two compared weeks (§§ 5, 14).
 *
 * `new_position` and `exited_position` are asserted ONLY on definitively
 * established absence — see `buildChangeNodes`. Everything else is `ongoing`,
 * including every case where absence could not be established, so an uncertain
 * node can never reach a zero through this field.
 */
export type NodeLifecycle = 'ongoing' | 'new_position' | 'exited_position'

export interface ChangeNode {
  rowKey: string
  parentRowKey: string | null
  depth: number
  displayOrder: number
  rowType: string
  labelEs: string
  labelEn: string | null
  currency: string
  currentValue: number | null
  previousValue: number | null
  lifecycle: NodeLifecycle
  /** `this_week_value − previous_week_value`. Null whenever the node is not valid. */
  weeklyValueChange: number | null
  /** The node's OWN percentage change — secondary context, never a return. */
  ownPctChange: number | null
  /** `weekly_value_change ÷ previous_week_portfolio_total` (doc 07 § 6a). */
  impactOnPortfolioValue: number | null
  /** True when no row in either publication declares this row as its parent. */
  isLeaf: boolean
  status: NodeStatus
  unavailableReason: NodeUnavailableReason | null
}

const AGGREGATE_ROW_TYPES = new Set([
  'portfolio_subtotal',
  'portfolio_total',
  'sociedad_subtotal',
  // R13.8 D4 — the sociedad's TERMINAL total; an aggregate like the rest,
  // except that the sociedad grain deliberately SELECTS it as the one node
  // carrying its sociedad's value (see deriveDrivers).
  'sociedad_total',
])
// Label containers are never monetary contributors: a sociedad header carries
// no value (its value lives on its sociedad_total child), and the real sheet
// also carries childless title/label headers that must never surface as
// unavailable "drivers" (R13.8 D4).
const CONTAINER_ROW_TYPES = new Set(['group_header', 'sociedad_header'])
/** Rows that are not part of the value hierarchy at all. */
const NON_HIERARCHY_ROW_TYPES = new Set(['flow', 'performance'])

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Joins the selected week's rows to the previous published week's rows BY
 * `rowKey` — the parser's stable identity, never a label, a display order, or
 * a source row number.
 *
 * A node is valid only when BOTH values exist (doc 07 § 6c). A row that
 * appears in only one of the two weeks is still returned, marked
 * `unavailable`, so a position that arrived or disappeared is visible rather
 * than silently absent — and its absence surfaces later as an explicit
 * reconciliation residual instead of a fabricated zero.
 */
export function buildChangeNodes(
  currentRows: readonly WeeklyChangeInputRow[],
  previousRows: readonly WeeklyChangeInputRow[],
  previousPortfolioTotal: number | null,
): ChangeNode[] {
  const hierarchy = (r: WeeklyChangeInputRow) => !NON_HIERARCHY_ROW_TYPES.has(r.rowType)
  const cur = currentRows.filter(hierarchy)
  const prev = previousRows.filter(hierarchy)

  const prevByKey = new Map(prev.map((r) => [r.rowKey, r]))
  const curByKey = new Map(cur.map((r) => [r.rowKey, r]))

  // Leaf-ness is a property of the STRUCTURE, taken from whichever week
  // declares the row — a node with children in either week is not a leaf.
  const hasChildren = new Set<string>()
  for (const r of [...cur, ...prev]) {
    if (r.parentRowKey !== null) hasChildren.add(r.parentRowKey)
  }

  const keys: string[] = []
  for (const r of cur) keys.push(r.rowKey)
  for (const r of prev) if (!curByKey.has(r.rowKey)) keys.push(r.rowKey)

  const nodes = keys.map((key) => {
    const c = curByKey.get(key) ?? null
    const p = prevByKey.get(key) ?? null
    const shape = c ?? p!

    // --- R13.R1.1 § 14: NEW AND EXITED POSITIONS.
    //
    // A published snapshot holds exactly what the portfolio held that week: the
    // parser prunes a row with no value and no surviving descendant, and KEEPS
    // an error cell as `unavailable` (see `parseResumen`). So a row MISSING
    // from one side of the comparison is DEFINITIVELY absent — a position not
    // yet held, or since sold — and its value that week was economically ZERO.
    //
    // Only that establishes the zero. A row that is PRESENT with an unusable
    // value stays `unavailable` through the branches below and is never
    // converted, which is the § 5 rule that an uncertain node must not be read
    // as an absent one.
    const arrived = c !== null && finite(c.value) && p === null
    const departed = p !== null && finite(p.value) && c === null
    const lifecycle: NodeLifecycle = arrived ? 'new_position' : departed ? 'exited_position' : 'ongoing'

    let status: NodeStatus = 'ok'
    let reason: NodeUnavailableReason | null = null
    if (arrived || departed) {
      // Settled: one side is a real figure, the other a confirmed zero.
    } else if (c === null && p === null) {
      status = 'unavailable'
      reason = 'missing_both'
    } else if (c === null || !finite(c.value)) {
      status = 'unavailable'
      reason = p === null || !finite(p.value) ? 'missing_both' : 'missing_current'
    } else if (p === null || !finite(p.value)) {
      status = 'unavailable'
      reason = 'missing_previous'
    } else if (c.currency !== p.currency) {
      // Never net two different currencies into one change (instruction 10 —
      // no conversion rule is authorised for this surface).
      status = 'unavailable'
      reason = 'currency_mismatch'
    }

    const currentValue = c !== null && finite(c.value) ? c.value : departed ? 0 : null
    const previousValue = p !== null && finite(p.value) ? p.value : arrived ? 0 : null
    const change = status === 'ok' ? (currentValue as number) - (previousValue as number) : null

    return {
      rowKey: key,
      parentRowKey: shape.parentRowKey,
      depth: shape.depth,
      displayOrder: shape.displayOrder,
      rowType: shape.rowType,
      labelEs: shape.labelEs,
      labelEn: shape.labelEn,
      currency: shape.currency,
      currentValue,
      previousValue,
      lifecycle,
      weeklyValueChange: change,
      // A new position has no opening value to divide by, so it has no
      // percentage change — an "infinite" or 100 % figure would be an artefact
      // of the zero, not a measurement. The dollar change carries it instead.
      ownPctChange:
        change !== null && previousValue !== null && previousValue !== 0
          ? change / Math.abs(previousValue)
          : null,
      impactOnPortfolioValue:
        change !== null && finite(previousPortfolioTotal) && previousPortfolioTotal !== 0
          ? change / previousPortfolioTotal
          : null,
      isLeaf: !hasChildren.has(key),
      status,
      unavailableReason: reason,
    } satisfies ChangeNode
  })

  return nodes.sort((a, b) => a.displayOrder - b.displayOrder)
}

// ---------------------------------------------------------------------------
// 2b · Reclassification candidates (R13.R1.1 § 7)
// ---------------------------------------------------------------------------

export interface ReclassificationCandidate {
  /** Normalized label the two nodes share. */
  label: string
  exitedRowKey: string
  exitedParentRowKey: string | null
  arrivedRowKey: string
  arrivedParentRowKey: string | null
  exitedValue: number | null
  arrivedValue: number | null
}

/**
 * Nodes that look like ONE asset moved rather than two independent events (§ 7).
 *
 * A `row_key` is the normalized label PATH, so re-parenting an asset — a new
 * sociedad, a different asset class — necessarily changes its key, and the
 * comparison then reads one Exited and one New position. Economically that is
 * a transfer, not a purchase and a sale, and § 7 requires the difference to be
 * identifiable rather than presented as investment performance.
 *
 * THIS REPORTS; IT NEVER MERGES. The two nodes keep their own identities and
 * their own value changes, so no total shifts and nothing is netted on a guess.
 * Merging would be unsafe here — two sociedades genuinely holding the same fund
 * is the NORMAL shape of this book (`Trinity Alps` sits under three at once),
 * so an identical label across parents is evidence of a possible move, never
 * proof of one. An administrator confirms; the system only surfaces.
 *
 * A label that exits more than once or arrives more than once in the same
 * comparison is deliberately NOT reported: the pairing would be a guess among
 * several, which § 6 requires to fail visibly rather than resolve silently.
 */
export function detectReclassifications(nodes: readonly ChangeNode[]): ReclassificationCandidate[] {
  const key = (n: ChangeNode) => normalize(n.labelEs)
  const exited = nodes.filter((n) => n.lifecycle === 'exited_position')
  const arrived = nodes.filter((n) => n.lifecycle === 'new_position')

  const count = (list: readonly ChangeNode[]) => {
    const m = new Map<string, number>()
    for (const n of list) m.set(key(n), (m.get(key(n)) ?? 0) + 1)
    return m
  }
  const exitedCount = count(exited)
  const arrivedCount = count(arrived)

  const out: ReclassificationCandidate[] = []
  for (const e of exited) {
    const label = key(e)
    if (exitedCount.get(label) !== 1 || arrivedCount.get(label) !== 1) continue
    const a = arrived.find((n) => key(n) === label)
    if (!a || a.parentRowKey === e.parentRowKey) continue
    out.push({
      label,
      exitedRowKey: e.rowKey,
      exitedParentRowKey: e.parentRowKey,
      arrivedRowKey: a.rowKey,
      arrivedParentRowKey: a.parentRowKey,
      exitedValue: e.previousValue,
      arrivedValue: a.currentValue,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// 3 · Reconciliation tolerance (doc 07 § 6d)
// ---------------------------------------------------------------------------

/**
 * The greater of `0.01` absolute or `1e-6` relative to the parent's
 * previous-week value — tight enough to catch a real structural error, loose
 * enough to absorb float representation.
 */
export function reconciliationTolerance(parentPreviousValue: number | null): number {
  const relative = finite(parentPreviousValue) ? Math.abs(parentPreviousValue) * 1e-6 : 0
  return Math.max(0.01, relative)
}

// ---------------------------------------------------------------------------
// 4 · Driver derivation (doc 07 § 6e)
// ---------------------------------------------------------------------------

export type DriverGrouping = 'top_level' | 'sociedad' | 'asset_class'

/**
 * The non-overlapping economic components of the portfolio total.
 *
 * DERIVED FROM THE NORMALIZED HIERARCHY, NEVER HARDCODED (doc 07 § 6e): a new
 * asset class, a renamed sub-asset class or a new sociedad appears
 * automatically, and hardcoding today's rows would silently drop tomorrow's.
 *
 * `top_level` walks down from the roots: a pure label container is descended
 * into, an aggregate (subtotal/total) is SKIPPED because including it beside
 * its own constituents would double-count the week, and anything else is a
 * driver. For Main that yields exactly the asset classes plus the named
 * holdings (InRetail, Chilean Equities) — doc 07 § 6e's list, obtained
 * structurally rather than by naming it.
 *
 * `sociedad` / `asset_class` are the two personal-portfolio views doc 07 § 6e
 * requires; each is a tiling of the same total at a different grain, so the
 * two are never mixed.
 */
export function deriveDrivers(nodes: readonly ChangeNode[], grouping: DriverGrouping): ChangeNode[] {
  const byParent = new Map<string | null, ChangeNode[]>()
  for (const n of nodes) {
    const list = byParent.get(n.parentRowKey)
    if (list) list.push(n)
    else byParent.set(n.parentRowKey, [n])
  }
  const childrenOfKey = (key: string | null) => byParent.get(key) ?? []

  const drivers: ChangeNode[] = []

  // `top_level`: descend containers, skip aggregates, take everything else.
  const visit = (parentKey: string | null, guard: number) => {
    if (guard > 32) return // structural cycle guard; cannot recurse forever
    for (const n of childrenOfKey(parentKey)) {
      if (AGGREGATE_ROW_TYPES.has(n.rowType)) continue
      if (CONTAINER_ROW_TYPES.has(n.rowType)) {
        visit(n.rowKey, guard + 1)
        continue
      }
      drivers.push(n)
    }
  }

  if (grouping === 'top_level') {
    visit(null, 0)
    return drivers.sort(byDisplayOrder)
  }

  // The two personal grains walk the ROOTS structurally (doc 02 § 5.4 shape):
  // a sociedad contributes through exactly one representative — its TERMINAL
  // total for the sociedad grain, its asset-class children for the asset-class
  // grain — while root named holdings (Proporcional, Staten) stay explicit
  // terminal drivers in BOTH grains (doc 07 §§ 6e, 6g: never dropped, never
  // folded, never left to a residual). Aggregates never sit beside their own
  // constituents; a sociedad with an ambiguous aggregate set fails closed to
  // its valueless header, surfacing as an honest unavailable driver.
  for (const root of childrenOfKey(null)) {
    if (root.rowType === 'sociedad_header') {
      const children = childrenOfKey(root.rowKey)
      if (grouping === 'sociedad') {
        const totals = children.filter((c) => c.rowType === 'sociedad_total')
        drivers.push(totals.length === 1 ? totals[0] : root)
      } else {
        for (const c of children) {
          if (AGGREGATE_ROW_TYPES.has(c.rowType) || CONTAINER_ROW_TYPES.has(c.rowType)) continue
          drivers.push(c)
        }
      }
      continue
    }
    if (AGGREGATE_ROW_TYPES.has(root.rowType)) continue
    if (CONTAINER_ROW_TYPES.has(root.rowType)) {
      visit(root.rowKey, 0)
      continue
    }
    drivers.push(root)
  }
  return drivers.sort(byDisplayOrder)
}

function byDisplayOrder(a: ChangeNode, b: ChangeNode): number {
  return a.displayOrder - b.displayOrder
}

// ---------------------------------------------------------------------------
// 5 · Total-level metrics and the flow / investment-result reconciliation
// ---------------------------------------------------------------------------

export interface TotalMetrics {
  basis: string
  /** The row the performance block was NUMERICALLY bound to at parse time. */
  totalRowKey: string | null
  currentValue: number | null
  previousValue: number | null
  /** NMI-recomputed from the two snapshots — never the source's own column. */
  weeklyValueChange: number | null
  weeklyReturn: number | null
  weeklyProfit: number | null
  flow: number | null
  ytdReturn: number | null
  ytdProfit: number | null
}

function boundKeyFor(performance: readonly WeeklyChangePerformanceRow[], basis: string): string | null {
  for (const p of performance) {
    if (p.basis === basis && typeof p.boundRowKey === 'string' && p.boundRowKey.length > 0) return p.boundRowKey
  }
  return null
}

function metricValue(
  performance: readonly WeeklyChangePerformanceRow[],
  basis: string,
  metric: string,
): number | null {
  const row = performance.find((p) => p.basis === basis && p.metric === metric)
  return row && finite(row.value) ? row.value : null
}

/**
 * The total-level block for one basis. Main's Weekly Changes surface binds to
 * `with_chilean_equities` — the TOTAL — because doc 07 § 6e's waterfall
 * reconciles to the portfolio total and its driver list includes Chilean
 * Equities, which sits only inside that total. A personal scope publishes a
 * single `total` basis. The basis is never inferred from row order or label.
 */
export function buildTotalMetrics(
  nodes: readonly ChangeNode[],
  performance: readonly WeeklyChangePerformanceRow[],
  basis: string,
): TotalMetrics {
  const key = boundKeyFor(performance, basis)
  const node = key !== null ? (nodes.find((n) => n.rowKey === key) ?? null) : null
  return {
    basis,
    totalRowKey: key,
    currentValue: node?.currentValue ?? null,
    previousValue: node?.previousValue ?? null,
    weeklyValueChange: node?.weeklyValueChange ?? null,
    weeklyReturn: metricValue(performance, basis, 'weekly_return'),
    weeklyProfit: metricValue(performance, basis, 'weekly_profit'),
    flow: metricValue(performance, basis, 'flow'),
    ytdReturn: metricValue(performance, basis, 'ytd_return'),
    ytdProfit: metricValue(performance, basis, 'ytd_profit'),
  }
}

/**
 * Strips the metrics that describe ONE WEEK from a total spanning many (§ 13).
 *
 * `flow`, `weekly_profit` and `weekly_return` are SOURCE-PROVIDED figures for
 * the current week alone. Over a custom range they are not merely imprecise,
 * they answer a different question — the flows of the intervening weeks are
 * nowhere in this payload — so presenting them beside a two-year change would
 * misstate the period. They are removed, and `reconcileFlowAndProfit` then
 * reports `unavailable` of its own accord rather than tying an identity out of
 * mismatched parts.
 *
 * KEPT: `currentValue`, `previousValue` and the value change, which are derived
 * from the two snapshots themselves and are correct over any span; and the YTD
 * pair, which describes the CURRENT week's year to date regardless of which
 * earlier week it is being compared with.
 */
export function suppressSingleWeekMetrics(total: TotalMetrics): TotalMetrics {
  return { ...total, flow: null, weeklyProfit: null, weeklyReturn: null }
}

/**
 * The `Impact on Portfolio Value` DENOMINATOR: the previous published week's
 * value of the row the performance block was bound to. Fails closed when the
 * bound row is missing from either week or its currency differs between them —
 * a dollar change must never be divided by an opening value in another
 * currency (§ 6c; R13.8 audit).
 */
export function resolvePreviousPortfolioTotal(
  currentRows: readonly WeeklyChangeInputRow[],
  previousRows: readonly WeeklyChangeInputRow[],
  boundRowKey: string | null,
): number | null {
  if (boundRowKey === null) return null
  const cur = currentRows.find((r) => r.rowKey === boundRowKey) ?? null
  const prev = previousRows.find((r) => r.rowKey === boundRowKey) ?? null
  if (cur === null || prev === null) return null
  if (cur.currency !== prev.currency) return null
  return finite(prev.value) ? prev.value : null
}

export interface FlowReconciliation {
  status: 'ok' | 'residual' | 'unavailable'
  previousValue: number | null
  flow: number | null
  profit: number | null
  /** `previous + flow + profit`. */
  expectedCurrent: number | null
  actualCurrent: number | null
  /** `actual − expected`. Positive means the snapshots exceed the stated parts. */
  residual: number | null
  tolerance: number
}

/**
 * `Previous Portfolio Value + Net Contributions/Withdrawals + Investment
 * Profit or Loss = Current Portfolio Value` — doc 07 § 6e's separate
 * total-level reconciliation, and the strongest genuinely-supported analytic
 * in this module (doc 07 § 5). Flow and profit are SOURCE-PROVIDED at the
 * total; they are deliberately not added as waterfall bars, because the asset
 * value changes already contain their effects.
 */
export function reconcileFlowAndProfit(total: TotalMetrics): FlowReconciliation {
  const tolerance = reconciliationTolerance(total.previousValue)
  const parts: FlowReconciliation = {
    status: 'unavailable',
    previousValue: total.previousValue,
    flow: total.flow,
    profit: total.weeklyProfit,
    expectedCurrent: null,
    actualCurrent: total.currentValue,
    residual: null,
    tolerance,
  }
  // `weeklyValueChange` null with BOTH snapshot values present means the bound
  // total's currency differs between the two weeks (§ 6c) — the identity would
  // then net two currencies, so it fails closed instead (R13.8 audit).
  if (
    !finite(total.previousValue) ||
    !finite(total.flow) ||
    !finite(total.weeklyProfit) ||
    !finite(total.currentValue) ||
    !finite(total.weeklyValueChange)
  ) {
    return parts
  }
  const expected = total.previousValue + total.flow + total.weeklyProfit
  const residual = total.currentValue - expected
  return {
    ...parts,
    expectedCurrent: expected,
    residual,
    status: Math.abs(residual) <= tolerance ? 'ok' : 'residual',
  }
}

// ---------------------------------------------------------------------------
// 6 · The waterfall (doc 07 § 6e)
// ---------------------------------------------------------------------------

export type WaterfallStepKind = 'opening' | 'driver' | 'residual' | 'closing'

export interface WaterfallStep {
  kind: WaterfallStepKind
  rowKey: string | null
  labelEs: string
  labelEn: string | null
  /** A level for opening/closing; a delta for driver/residual. */
  value: number | null
  /** Cumulative portfolio value AFTER this step. Null once it cannot be known. */
  runningTotal: number | null
  status: NodeStatus
}

export interface Waterfall {
  steps: WaterfallStep[]
  /**
   * complete    — every driver valid and the set reconciles inside tolerance
   * partial     — a driver is unavailable, or a residual step was required
   * unavailable — the total itself could not be resolved
   */
  status: 'complete' | 'partial' | 'unavailable'
  residual: number | null
  tolerance: number
  unavailableDriverCount: number
}

/**
 * `Previous Week Portfolio Value + Top-Level Portfolio Value Changes = This
 * Week Portfolio Value`.
 *
 * A shortfall becomes an EXPLICIT residual step, never an adjustment folded
 * into the largest asset class, and the period is marked partially reconciled
 * (doc 07 § 6e "When a reconciliation does not tie"). Unavailable drivers keep
 * their own status and are counted, not treated as zero.
 */
export function buildWaterfall(
  total: TotalMetrics,
  drivers: readonly ChangeNode[],
  labels: { opening: { es: string; en: string }; closing: { es: string; en: string }; residual: { es: string; en: string } },
): Waterfall {
  const tolerance = reconciliationTolerance(total.previousValue)

  // Same fail-closed rule as the flow identity: a bound total whose currency
  // differs between the two weeks (change null, both values present) must not
  // become a cross-currency waterfall (R13.8 audit).
  if (!finite(total.previousValue) || !finite(total.currentValue) || !finite(total.weeklyValueChange)) {
    return { steps: [], status: 'unavailable', residual: null, tolerance, unavailableDriverCount: 0 }
  }

  const steps: WaterfallStep[] = [
    {
      kind: 'opening',
      rowKey: null,
      labelEs: labels.opening.es,
      labelEn: labels.opening.en,
      value: total.previousValue,
      runningTotal: total.previousValue,
      status: 'ok',
    },
  ]

  let running: number | null = total.previousValue
  let sum = 0
  let unavailableDriverCount = 0

  for (const d of drivers) {
    const ok = d.status === 'ok' && finite(d.weeklyValueChange)
    if (ok) {
      sum += d.weeklyValueChange as number
      running = running !== null ? running + (d.weeklyValueChange as number) : null
    } else {
      unavailableDriverCount++
      // A driver whose change cannot be known makes every later running total
      // unknowable too — it is never treated as zero (doc 07 § 6c).
      running = null
    }
    steps.push({
      kind: 'driver',
      rowKey: d.rowKey,
      labelEs: d.labelEs,
      labelEn: d.labelEn,
      value: ok ? (d.weeklyValueChange as number) : null,
      runningTotal: running,
      status: ok ? 'ok' : 'unavailable',
    })
  }

  const expectedClosing = total.previousValue + sum
  const residual = total.currentValue - expectedClosing
  const ties = unavailableDriverCount === 0 && Math.abs(residual) <= tolerance

  if (!ties) {
    steps.push({
      kind: 'residual',
      rowKey: null,
      labelEs: labels.residual.es,
      labelEn: labels.residual.en,
      value: unavailableDriverCount === 0 ? residual : null,
      runningTotal: unavailableDriverCount === 0 ? total.currentValue : null,
      status: unavailableDriverCount === 0 ? 'ok' : 'unavailable',
    })
  }

  steps.push({
    kind: 'closing',
    rowKey: null,
    labelEs: labels.closing.es,
    labelEn: labels.closing.en,
    value: total.currentValue,
    runningTotal: total.currentValue,
    status: 'ok',
  })

  return {
    steps,
    status: ties ? 'complete' : 'partial',
    residual: unavailableDriverCount === 0 ? residual : null,
    tolerance,
    unavailableDriverCount,
  }
}

// ---------------------------------------------------------------------------
// 7 · Largest weekly value increases / decreases (doc 07 § 6f)
// ---------------------------------------------------------------------------

/** Doc 07 § 3.3 names this row explicitly; a label match is authorised here. */
const CASH_LABEL = /^caja y equivalentes$/

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** The cash node and every descendant — a leaf under Cash is still cash movement. */
export function cashSubtreeKeys(nodes: readonly ChangeNode[]): Set<string> {
  const roots = nodes.filter((n) => CASH_LABEL.test(normalize(n.labelEs)))
  const keys = new Set(roots.map((r) => r.rowKey))
  // Fixed-point descent: cheap at this row count and immune to ordering.
  for (let i = 0; i < 32; i++) {
    let grew = false
    for (const n of nodes) {
      if (n.parentRowKey !== null && keys.has(n.parentRowKey) && !keys.has(n.rowKey)) {
        keys.add(n.rowKey)
        grew = true
      }
    }
    if (!grew) break
  }
  return keys
}

export interface RankedChanges {
  increases: ChangeNode[]
  decreases: ChangeNode[]
  /** True when cash rows were withheld — drives the visible, reversible toggle. */
  cashExcluded: boolean
  cashRowCount: number
}

/**
 * Two separate ranked panels, up to five rows each.
 *
 * Ranked by ABSOLUTE DOLLAR weekly value change — never by percentage, never
 * by weight, never by source row order. Positive rows appear only in
 * increases and negative only in decreases; zero changes are excluded; only
 * leaves qualify, which is also what guarantees a parent and its own child can
 * never share a list. Fewer than five rows are shown when fewer qualify — the
 * lists are never padded.
 *
 * `Caja y Equivalentes` is excluded by default (doc 07 § 3.3): it absorbs
 * deposits before they are deployed, so ranking it would surface a transfer as
 * if it were a portfolio event. Never silently dropped — the caller renders a
 * visible, reversible toggle and this result reports what was withheld.
 */
export function rankWeeklyChanges(
  nodes: readonly ChangeNode[],
  options: { excludeCash?: boolean; limit?: number } = {},
): RankedChanges {
  const excludeCash = options.excludeCash ?? true
  const limit = options.limit ?? 5
  const cashKeys = cashSubtreeKeys(nodes)

  const eligible = nodes.filter(
    (n) =>
      n.status === 'ok' &&
      n.isLeaf &&
      !AGGREGATE_ROW_TYPES.has(n.rowType) &&
      !CONTAINER_ROW_TYPES.has(n.rowType) &&
      finite(n.weeklyValueChange) &&
      n.weeklyValueChange !== 0,
  )
  const cashRowCount = eligible.filter((n) => cashKeys.has(n.rowKey)).length
  const ranked = excludeCash ? eligible.filter((n) => !cashKeys.has(n.rowKey)) : eligible

  const increases = ranked
    .filter((n) => (n.weeklyValueChange as number) > 0)
    .sort((a, b) => (b.weeklyValueChange as number) - (a.weeklyValueChange as number))
    .slice(0, limit)

  const decreases = ranked
    .filter((n) => (n.weeklyValueChange as number) < 0)
    .sort((a, b) => (a.weeklyValueChange as number) - (b.weeklyValueChange as number))
    .slice(0, limit)

  return { increases, decreases, cashExcluded: excludeCash, cashRowCount }
}

// ---------------------------------------------------------------------------
// 8 · Hierarchical weekly change chart (doc 07 § 6g)
// ---------------------------------------------------------------------------

export interface HierarchyLevel {
  /** Null at the root level, where the drivers themselves are shown. */
  parentRowKey: string | null
  /** Root → current node, for the breadcrumb trail. */
  breadcrumb: ChangeNode[]
  bars: ChangeNode[]
  reconciliation: ChildReconciliation | null
}

export interface ChildReconciliation {
  status: 'ok' | 'residual' | 'unavailable'
  parentChange: number | null
  childSum: number | null
  residual: number | null
  tolerance: number
  unavailableChildCount: number
}

/**
 * Direct children of a node — never grandchildren, so no level double-counts.
 *
 * R13.8 D4: an AGGREGATE row is a restatement of its level, never a drill bar,
 * so aggregates are excluded from every child list. Drilling a sociedad's
 * TERMINAL total descends into the sociedad's real constituents — the
 * non-aggregate children of the header it belongs to — because the parser
 * (faithfully to the source) keeps the constituents on the HEADER, with the
 * total as their sibling.
 */
export function childrenOf(nodes: readonly ChangeNode[], parentRowKey: string): ChangeNode[] {
  const parent = nodes.find((n) => n.rowKey === parentRowKey) ?? null
  const effectiveParentKey =
    parent !== null && parent.rowType === 'sociedad_total' && parent.parentRowKey !== null
      ? parent.parentRowKey
      : parentRowKey
  return nodes
    .filter((n) => n.parentRowKey === effectiveParentKey && !AGGREGATE_ROW_TYPES.has(n.rowType))
    .sort(byDisplayOrder)
}

/** Root → node path, used for the drill-down breadcrumbs. */
export function breadcrumbFor(nodes: readonly ChangeNode[], rowKey: string): ChangeNode[] {
  const byKey = new Map(nodes.map((n) => [n.rowKey, n]))
  const trail: ChangeNode[] = []
  let cursor = byKey.get(rowKey) ?? null
  for (let i = 0; i < 32 && cursor !== null; i++) {
    trail.unshift(cursor)
    cursor = cursor.parentRowKey !== null ? (byKey.get(cursor.parentRowKey) ?? null) : null
  }
  return trail
}

/**
 * Child changes must reconcile to the parent change inside the § 6d tolerance.
 * A breach is reported as a residual, never absorbed; an unavailable child
 * makes the sum indeterminate rather than smaller.
 */
export function reconcileChildren(nodes: readonly ChangeNode[], parentRowKey: string): ChildReconciliation {
  const parent = nodes.find((n) => n.rowKey === parentRowKey) ?? null
  const children = childrenOf(nodes, parentRowKey)
  const tolerance = reconciliationTolerance(parent?.previousValue ?? null)

  const unavailableChildCount = children.filter((c) => c.status !== 'ok' || !finite(c.weeklyValueChange)).length
  if (parent === null || !finite(parent.weeklyValueChange) || children.length === 0 || unavailableChildCount > 0) {
    return {
      status: 'unavailable',
      parentChange: parent?.weeklyValueChange ?? null,
      childSum: null,
      residual: null,
      tolerance,
      unavailableChildCount,
    }
  }

  const childSum = children.reduce((a, c) => a + (c.weeklyValueChange as number), 0)
  const residual = (parent.weeklyValueChange as number) - childSum
  return {
    status: Math.abs(residual) <= tolerance ? 'ok' : 'residual',
    parentChange: parent.weeklyValueChange,
    childSum,
    residual,
    tolerance,
    unavailableChildCount: 0,
  }
}

/**
 * One level of the drill-down chart. At the root the bars are the derived
 * drivers — the same non-overlapping set the waterfall uses, so the two
 * visualizations can never disagree about what tiles the portfolio.
 */
export function buildHierarchyLevel(
  nodes: readonly ChangeNode[],
  drivers: readonly ChangeNode[],
  parentRowKey: string | null,
): HierarchyLevel {
  if (parentRowKey === null) {
    return { parentRowKey: null, breadcrumb: [], bars: [...drivers], reconciliation: null }
  }
  return {
    parentRowKey,
    breadcrumb: breadcrumbFor(nodes, parentRowKey),
    bars: childrenOf(nodes, parentRowKey),
    reconciliation: reconcileChildren(nodes, parentRowKey),
  }
}

// ---------------------------------------------------------------------------
// 9 · Historical weekly-change trend (doc 07 § 6h item 8)
// ---------------------------------------------------------------------------

export interface TrendPoint {
  date: string
  value: number
}

export interface TrendInput {
  /** Current publications, any order; each with the total row bound for ITS week. */
  publications: ReadonlyArray<{ id: string; asOfDate: string }>
  /** publicationId → the row key its performance block was bound to that week. */
  boundKeyByPublication: ReadonlyMap<string, string | null>
  /** `${publicationId}::${rowKey}` → value. */
  valueByPublicationRow: ReadonlyMap<string, number | null>
}

/**
 * The portfolio's weekly value change per published week, each point derived
 * from that week and its own immediate predecessor — through each week's OWN
 * binding, never a label match on historical rows.
 *
 * A week whose value or predecessor is missing produces NO POINT. Gaps stay
 * gaps: nothing is carried forward and nothing is zero-filled.
 */
export function buildWeeklyChangeTrend(input: TrendInput): TrendPoint[] {
  const ordered = [...input.publications].sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : a.asOfDate > b.asOfDate ? 1 : 0))
  const valueAt = (pubId: string): number | null => {
    const key = input.boundKeyByPublication.get(pubId) ?? null
    if (key === null) return null
    const v = input.valueByPublicationRow.get(`${pubId}::${key}`)
    return finite(v) ? v : null
  }

  const points: TrendPoint[] = []
  for (let i = 1; i < ordered.length; i++) {
    const cur = valueAt(ordered[i].id)
    const prev = valueAt(ordered[i - 1].id)
    if (cur === null || prev === null) continue
    points.push({ date: ordered[i].asOfDate, value: cur - prev })
  }
  return points
}

// ---------------------------------------------------------------------------
// 10 · Full changes table (doc 07 § 6h item 7)
// ---------------------------------------------------------------------------

/**
 * Every hierarchy node in display order, aggregates included — this is the
 * complete audit view behind `View All Changes`, so it deliberately shows
 * subtotals and totals alongside their constituents. It is a LISTING, never
 * an aggregate: nothing here is summed, so no double count is possible.
 */
export function buildFullChangesTable(nodes: readonly ChangeNode[]): ChangeNode[] {
  return [...nodes].sort(byDisplayOrder)
}
