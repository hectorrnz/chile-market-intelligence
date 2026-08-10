// R13.8 — Weekly Changes financial contract (doc 07 Parts A2/A3).
//
// Every figure here is hand-checkable. The Main fixture is built so the
// portfolio's weekly value change is exactly +100 and its four moving
// top-level drivers are +60, +30, +20 and −10 — the reconciliation example the
// stage brief calls for — with a fifth driver flat at 0 to prove a zero
// contributor neither breaks the tie-out nor enters a ranked list.
//
// No private portfolio value appears anywhere: the fixtures are synthetic
// round numbers chosen for arithmetic legibility.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  selectWeekPair,
  buildChangeNodes,
  deriveDrivers,
  buildTotalMetrics,
  reconcileFlowAndProfit,
  buildWaterfall,
  rankWeeklyChanges,
  cashSubtreeKeys,
  childrenOf,
  breadcrumbFor,
  reconcileChildren,
  buildHierarchyLevel,
  buildWeeklyChangeTrend,
  buildFullChangesTable,
  reconciliationTolerance,
  resolvePreviousPortfolioTotal,
  type WeeklyChangeInputRow,
  type WeeklyChangePerformanceRow,
  type ChangeNode,
} from '../src/lib/familyPortfolio/weeklyChanges.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures — synthetic, hand-checkable
// ═══════════════════════════════════════════════════════════════════════════

interface Spec {
  key: string
  parent: string | null
  type: string
  label: string
  prev: number | null
  cur: number | null
  currency?: string
}

// prev → cur, so every change below is readable at a glance.
const MAIN: Spec[] = [
  { key: 'g.liquid', parent: null, type: 'group_header', label: 'LIQUIDO', prev: null, cur: null },
  { key: 'ac.cash', parent: 'g.liquid', type: 'asset_class', label: 'Caja y Equivalentes', prev: 100, cur: 160 }, // +60
  { key: 'leaf.cash1', parent: 'ac.cash', type: 'individual_asset', label: 'Cuenta Corriente', prev: 100, cur: 160 },
  { key: 'ac.fi', parent: 'g.liquid', type: 'asset_class', label: 'Renta Fija', prev: 200, cur: 230 }, // +30
  { key: 'leaf.fi1', parent: 'ac.fi', type: 'individual_asset', label: 'Bono A', prev: 120, cur: 140 }, // +20
  { key: 'leaf.fi2', parent: 'ac.fi', type: 'individual_asset', label: 'Bono B', prev: 80, cur: 90 }, // +10
  { key: 'ac.eq', parent: 'g.liquid', type: 'asset_class', label: 'Renta Variable', prev: 300, cur: 320 }, // +20
  { key: 'leaf.eq1', parent: 'ac.eq', type: 'individual_asset', label: 'Fondo X', prev: 300, cur: 320 },
  { key: 'nh.inretail', parent: null, type: 'named_holding', label: 'INRETAIL PERU CORP', prev: 150, cur: 140 }, // −10
  { key: 'sub.total', parent: null, type: 'portfolio_subtotal', label: 'SUBTOTAL', prev: 750, cur: 850 },
  { key: 'nh.chile', parent: null, type: 'named_holding', label: 'ACCIONES CHILENAS (USD)', prev: 250, cur: 250 }, // 0
  { key: 'tot', parent: null, type: 'portfolio_total', label: 'TOTAL', prev: 1000, cur: 1100 }, // +100
]

function rowsOf(specs: Spec[], side: 'prev' | 'cur'): WeeklyChangeInputRow[] {
  return specs.map((s, i) => ({
    rowKey: s.key,
    parentRowKey: s.parent,
    depth: s.parent === null ? 0 : 1,
    displayOrder: i,
    rowType: s.type,
    labelEs: s.label,
    labelEn: null,
    currency: s.currency ?? 'USD',
    value: side === 'prev' ? s.prev : s.cur,
  }))
}

const PERF: WeeklyChangePerformanceRow[] = [
  { basis: 'with_chilean_equities', metric: 'flow', value: 70, boundRowKey: 'tot' },
  { basis: 'with_chilean_equities', metric: 'weekly_profit', value: 30, boundRowKey: 'tot' },
  { basis: 'with_chilean_equities', metric: 'weekly_return', value: 0.03, boundRowKey: 'tot' },
  { basis: 'with_chilean_equities', metric: 'ytd_return', value: 0.06, boundRowKey: 'tot' },
  { basis: 'with_chilean_equities', metric: 'ytd_profit', value: 55, boundRowKey: 'tot' },
]

const mainNodes = (specs: Spec[] = MAIN) => buildChangeNodes(rowsOf(specs, 'cur'), rowsOf(specs, 'prev'), 1000)
const byKey = (nodes: ChangeNode[], key: string) => nodes.find((n) => n.rowKey === key)!

const LABELS = {
  opening: { es: 'Valor Semana Anterior', en: 'Previous Week Portfolio Value' },
  closing: { es: 'Valor Esta Semana', en: 'This Week Portfolio Value' },
  residual: { es: 'Residuo de Conciliación', en: 'Reconciliation Residual' },
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Week-pair selection (doc 07 § 6b)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · week pair', () => {
  const pubs = [{ asOfDate: '2026-07-17' }, { asOfDate: '2026-07-24' }, { asOfDate: '2026-08-07' }]

  test('the previous week is the immediately PRECEDING PUBLISHED week, never seven days earlier', () => {
    const r = selectWeekPair(pubs, '2026-08-07')
    assert.ok(r.ok)
    assert.equal(r.selection.current.asOfDate, '2026-08-07')
    // 31 Jul was never published; it must not be fabricated.
    assert.equal(r.selection.previous?.asOfDate, '2026-07-24')
  })

  test('unsorted input and a default selection both resolve to the latest published week', () => {
    const shuffled = [pubs[2], pubs[0], pubs[1]]
    const r = selectWeekPair(shuffled, null)
    assert.ok(r.ok)
    assert.equal(r.selection.current.asOfDate, '2026-08-07')
    assert.equal(r.selection.previous?.asOfDate, '2026-07-24')
  })

  test('the earliest published week has NO previous week — never a zero change', () => {
    const r = selectWeekPair(pubs, '2026-07-17')
    assert.ok(r.ok)
    assert.equal(r.selection.previous, null)
  })

  test('an unknown or malformed week is not found, and an empty history has no publications', () => {
    assert.deepEqual(selectWeekPair(pubs, '2026-07-31'), { ok: false, code: 'week_not_found' })
    assert.deepEqual(selectWeekPair(pubs, 'last-week'), { ok: false, code: 'week_not_found' })
    assert.deepEqual(selectWeekPair([], null), { ok: false, code: 'no_publications' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Change nodes (doc 07 §§ 6a, 6c)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · change nodes', () => {
  test('weekly value change is recomputed from the two snapshots, with exact hand-checked values', () => {
    const n = mainNodes()
    assert.equal(byKey(n, 'ac.cash').weeklyValueChange, 60)
    assert.equal(byKey(n, 'ac.fi').weeklyValueChange, 30)
    assert.equal(byKey(n, 'ac.eq').weeklyValueChange, 20)
    assert.equal(byKey(n, 'nh.inretail').weeklyValueChange, -10)
    assert.equal(byKey(n, 'nh.chile').weeklyValueChange, 0)
    assert.equal(byKey(n, 'tot').weeklyValueChange, 100)
  })

  test('impact on portfolio value is the dollar change over the OPENING portfolio total', () => {
    const n = mainNodes()
    // −10 ÷ 1000 = −1 %. Deliberately not a return: the node's flows are unknown.
    assert.equal(byKey(n, 'nh.inretail').impactOnPortfolioValue, -0.01)
    assert.equal(byKey(n, 'ac.cash').impactOnPortfolioValue, 0.06)
    // The node's OWN percentage change is a different, secondary figure.
    assert.ok(Math.abs((byKey(n, 'nh.inretail').ownPctChange ?? 0) - -10 / 150) < 1e-12)
  })

  test('a NULL value on either side makes the node unavailable — never zero', () => {
    const specs = MAIN.map((s) => (s.key === 'leaf.fi2' ? { ...s, cur: null } : s))
    const node = byKey(mainNodes(specs), 'leaf.fi2')
    assert.equal(node.status, 'unavailable')
    assert.equal(node.unavailableReason, 'missing_current')
    assert.equal(node.weeklyValueChange, null)
    assert.notEqual(node.weeklyValueChange, 0)
    assert.equal(node.impactOnPortfolioValue, null)
  })

  test('a row present in only one week is surfaced as unavailable, not silently dropped', () => {
    const cur = rowsOf(MAIN, 'cur')
    const prev = rowsOf(MAIN, 'prev').filter((r) => r.rowKey !== 'leaf.fi2')
    const arrived = buildChangeNodes(cur, prev, 1000)
    assert.equal(byKey(arrived, 'leaf.fi2').unavailableReason, 'missing_previous')

    const disposed = buildChangeNodes(
      cur.filter((r) => r.rowKey !== 'leaf.fi2'),
      rowsOf(MAIN, 'prev'),
      1000,
    )
    const gone = byKey(disposed, 'leaf.fi2')
    assert.equal(gone.status, 'unavailable')
    assert.equal(gone.currentValue, null)
    assert.equal(gone.previousValue, 80)
  })

  test('two different currencies are never netted into one change', () => {
    const cur = rowsOf(MAIN, 'cur').map((r) => (r.rowKey === 'leaf.eq1' ? { ...r, currency: 'CLP' } : r))
    const node = byKey(buildChangeNodes(cur, rowsOf(MAIN, 'prev'), 1000), 'leaf.eq1')
    assert.equal(node.status, 'unavailable')
    assert.equal(node.unavailableReason, 'currency_mismatch')
    assert.equal(node.weeklyValueChange, null)
  })

  test('leaf detection is structural — containers and aggregates are never leaves', () => {
    const n = mainNodes()
    assert.equal(byKey(n, 'leaf.fi1').isLeaf, true)
    assert.equal(byKey(n, 'nh.inretail').isLeaf, true)
    assert.equal(byKey(n, 'ac.fi').isLeaf, false)
    assert.equal(byKey(n, 'g.liquid').isLeaf, false)
  })

  test('flow and performance rows never enter the value hierarchy', () => {
    const withNoise = [
      ...rowsOf(MAIN, 'cur'),
      { rowKey: 'f.1', parentRowKey: null, depth: 0, displayOrder: 99, rowType: 'flow', labelEs: 'Aportes', labelEn: null, currency: 'USD', value: 70 },
      { rowKey: 'p.1', parentRowKey: null, depth: 0, displayOrder: 100, rowType: 'performance', labelEs: 'Retorno', labelEn: null, currency: 'USD', value: 0.03 },
    ]
    const n = buildChangeNodes(withNoise, rowsOf(MAIN, 'prev'), 1000)
    assert.ok(!n.some((x) => x.rowKey === 'f.1'))
    assert.ok(!n.some((x) => x.rowKey === 'p.1'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Drivers and the waterfall (doc 07 § 6e)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · drivers and waterfall', () => {
  test('drivers are the non-overlapping top-level set — no aggregate, no container, no child', () => {
    const drivers = deriveDrivers(mainNodes(), 'top_level')
    assert.deepEqual(
      drivers.map((d) => d.rowKey),
      ['ac.cash', 'ac.fi', 'ac.eq', 'nh.inretail', 'nh.chile'],
    )
    // The SUBTOTAL and the TOTAL are excluded: including either beside its own
    // constituents would count the week twice.
    assert.ok(!drivers.some((d) => d.rowKey === 'sub.total' || d.rowKey === 'tot'))
    // Children of an asset class are one level down, never in the driver set.
    assert.ok(!drivers.some((d) => d.rowKey.startsWith('leaf.')))
    // And the group header itself is a label, not a driver.
    assert.ok(!drivers.some((d) => d.rowType === 'group_header'))
  })

  test('the driver set tiles the portfolio: +60 +30 +20 −10 +0 = +100', () => {
    const drivers = deriveDrivers(mainNodes(), 'top_level')
    const sum = drivers.reduce((a, d) => a + (d.weeklyValueChange ?? 0), 0)
    assert.equal(sum, 100)
    assert.equal(byKey(mainNodes(), 'tot').weeklyValueChange, sum)
  })

  test('the waterfall reconciles previous + Σ drivers = current, with no residual step', () => {
    const nodes = mainNodes()
    const total = buildTotalMetrics(nodes, PERF, 'with_chilean_equities')
    const w = buildWaterfall(total, deriveDrivers(nodes, 'top_level'), LABELS)

    assert.equal(w.status, 'complete')
    assert.equal(w.unavailableDriverCount, 0)
    assert.ok(Math.abs(w.residual ?? 1) <= w.tolerance)
    assert.ok(!w.steps.some((s) => s.kind === 'residual'))

    assert.equal(w.steps[0].kind, 'opening')
    assert.equal(w.steps[0].value, 1000)
    const closing = w.steps[w.steps.length - 1]
    assert.equal(closing.kind, 'closing')
    assert.equal(closing.value, 1100)
    // Running totals walk 1000 → 1060 → 1090 → 1110 → 1100 → 1100.
    assert.deepEqual(
      w.steps.filter((s) => s.kind === 'driver').map((s) => s.runningTotal),
      [1060, 1090, 1110, 1100, 1100],
    )
  })

  test('an incomplete contributor set surfaces an EXPLICIT residual — never absorbed into a driver', () => {
    const nodes = mainNodes()
    const total = buildTotalMetrics(nodes, PERF, 'with_chilean_equities')
    // Drop one +30 driver: the set now explains only +70 of the +100 move.
    const partial = deriveDrivers(nodes, 'top_level').filter((d) => d.rowKey !== 'ac.fi')
    const w = buildWaterfall(total, partial, LABELS)

    assert.equal(w.status, 'partial')
    assert.equal(w.residual, 30)
    const residualStep = w.steps.find((s) => s.kind === 'residual')
    assert.ok(residualStep, 'a visible residual step is required')
    assert.equal(residualStep!.value, 30)
    // The surviving drivers keep their own values — nothing was adjusted.
    assert.equal(w.steps.find((s) => s.rowKey === 'ac.cash')!.value, 60)
    assert.equal(w.steps.find((s) => s.rowKey === 'ac.eq')!.value, 20)
  })

  test('an unavailable driver makes the waterfall partial and is never treated as zero', () => {
    const specs = MAIN.map((s) => (s.key === 'ac.eq' ? { ...s, cur: null } : s))
    const nodes = mainNodes(specs)
    const total = buildTotalMetrics(nodes, PERF, 'with_chilean_equities')
    const w = buildWaterfall(total, deriveDrivers(nodes, 'top_level'), LABELS)

    assert.equal(w.status, 'partial')
    assert.equal(w.unavailableDriverCount, 1)
    const step = w.steps.find((s) => s.rowKey === 'ac.eq')!
    assert.equal(step.status, 'unavailable')
    assert.equal(step.value, null)
    // Once a driver is unknown the running total is unknowable, not carried on.
    assert.equal(step.runningTotal, null)
    assert.equal(w.residual, null)
  })

  test('an unresolvable total makes the whole waterfall unavailable', () => {
    const nodes = mainNodes()
    const w = buildWaterfall(
      buildTotalMetrics(nodes, [], 'with_chilean_equities'),
      deriveDrivers(nodes, 'top_level'),
      LABELS,
    )
    assert.equal(w.status, 'unavailable')
    assert.deepEqual(w.steps, [])
  })

  test('flows and profit are NOT waterfall bars — the drivers are asset value changes only', () => {
    const nodes = mainNodes()
    const w = buildWaterfall(
      buildTotalMetrics(nodes, PERF, 'with_chilean_equities'),
      deriveDrivers(nodes, 'top_level'),
      LABELS,
    )
    const driverKeys = w.steps.filter((s) => s.kind === 'driver').map((s) => s.rowKey)
    assert.equal(driverKeys.length, 5)
    assert.ok(!driverKeys.some((k) => k === null))
    // 70 (flow) and 30 (profit) exist as total-level figures but appear as no bar.
    assert.ok(!w.steps.some((s) => s.value === 70 && s.kind === 'driver'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Total metrics and the flow / investment-result reconciliation
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · total-level reconciliation', () => {
  test('the total binds through the performance row key, not a label', () => {
    const total = buildTotalMetrics(mainNodes(), PERF, 'with_chilean_equities')
    assert.equal(total.totalRowKey, 'tot')
    assert.equal(total.previousValue, 1000)
    assert.equal(total.currentValue, 1100)
    assert.equal(total.weeklyValueChange, 100)
    assert.equal(total.weeklyReturn, 0.03)
    assert.equal(total.flow, 70)
  })

  test('ΔValue = flow + profit holds exactly at the total', () => {
    const r = reconcileFlowAndProfit(buildTotalMetrics(mainNodes(), PERF, 'with_chilean_equities'))
    assert.equal(r.status, 'ok')
    assert.equal(r.expectedCurrent, 1100)
    assert.equal(r.actualCurrent, 1100)
    assert.equal(r.residual, 0)
  })

  test('a broken identity reports a residual rather than adjusting a figure', () => {
    const perf = PERF.map((p) => (p.metric === 'flow' ? { ...p, value: 60 } : p))
    const r = reconcileFlowAndProfit(buildTotalMetrics(mainNodes(), perf, 'with_chilean_equities'))
    assert.equal(r.status, 'residual')
    assert.equal(r.expectedCurrent, 1090)
    assert.equal(r.residual, 10)
  })

  test('a missing source-provided part makes the reconciliation unavailable, not zero', () => {
    const perf = PERF.filter((p) => p.metric !== 'flow')
    const r = reconcileFlowAndProfit(buildTotalMetrics(mainNodes(), perf, 'with_chilean_equities'))
    assert.equal(r.status, 'unavailable')
    assert.equal(r.flow, null)
    assert.equal(r.residual, null)
  })

  test('the tolerance is max(0.01, 1e-6 × previous parent value)', () => {
    assert.equal(reconciliationTolerance(null), 0.01)
    assert.equal(reconciliationTolerance(1000), 0.01)
    assert.equal(reconciliationTolerance(50_000_000), 50)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Ranked panels (doc 07 § 6f)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · largest weekly value increases and decreases', () => {
  test('cash is excluded by default and reported, never silently dropped', () => {
    const nodes = mainNodes()
    const keys = cashSubtreeKeys(nodes)
    assert.ok(keys.has('ac.cash') && keys.has('leaf.cash1'), 'the cash subtree includes its children')

    const r = rankWeeklyChanges(nodes)
    assert.equal(r.cashExcluded, true)
    assert.equal(r.cashRowCount, 1)
    assert.ok(!r.increases.some((n) => n.rowKey === 'leaf.cash1'))
  })

  test('the toggle reversibly includes cash, which then ranks first', () => {
    const r = rankWeeklyChanges(mainNodes(), { excludeCash: false })
    assert.equal(r.increases[0].rowKey, 'leaf.cash1')
    assert.equal(r.increases[0].weeklyValueChange, 60)
  })

  test('ranking is by absolute dollar change, leaves only, signs separated', () => {
    const r = rankWeeklyChanges(mainNodes())
    // +20, +20, +10 — ties hold display order; no asset class or subtotal.
    assert.deepEqual(r.increases.map((n) => n.rowKey), ['leaf.fi1', 'leaf.eq1', 'leaf.fi2'])
    assert.ok(r.increases.every((n) => (n.weeklyValueChange as number) > 0))
    assert.deepEqual(r.decreases.map((n) => n.rowKey), ['nh.inretail'])
    assert.ok(r.decreases.every((n) => (n.weeklyValueChange as number) < 0))
    assert.ok(!r.increases.some((n) => n.rowType === 'asset_class' || n.rowType === 'portfolio_subtotal'))
  })

  test('a parent and its own child never appear in the same list', () => {
    const r = rankWeeklyChanges(mainNodes(), { excludeCash: false })
    const listed = new Set([...r.increases, ...r.decreases].map((n) => n.rowKey))
    for (const n of [...r.increases, ...r.decreases]) {
      assert.ok(n.parentRowKey === null || !listed.has(n.parentRowKey), `${n.rowKey} shares a list with its parent`)
    }
  })

  test('zero changes are excluded and fewer than five rows are never padded', () => {
    const r = rankWeeklyChanges(mainNodes())
    assert.ok(!r.increases.some((n) => n.rowKey === 'nh.chile'))
    assert.equal(r.decreases.length, 1)
    assert.ok(r.increases.length < 5)
  })

  test('top five is the binding default — a sixth qualifying leaf is cut, not the fifth', () => {
    const many: Spec[] = [
      ...MAIN,
      ...[1, 2, 3, 4, 5, 6].map((i) => ({
        key: `leaf.extra${i}`,
        parent: 'ac.eq',
        type: 'individual_asset',
        label: `Extra ${i}`,
        prev: 100,
        cur: 100 + i, // +1 … +6
      })),
    ]
    const r = rankWeeklyChanges(mainNodes(many))
    assert.equal(r.increases.length, 5)
    assert.deepEqual(r.increases.map((n) => n.weeklyValueChange), [20, 20, 10, 6, 5])
  })

  test('an unavailable node never enters a ranked list', () => {
    const specs = MAIN.map((s) => (s.key === 'leaf.fi1' ? { ...s, prev: null } : s))
    const r = rankWeeklyChanges(mainNodes(specs))
    assert.ok(!r.increases.some((n) => n.rowKey === 'leaf.fi1'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Hierarchy drill-down (doc 07 § 6g)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · hierarchy', () => {
  test('the root level shows the drivers, so the chart and the waterfall agree', () => {
    const nodes = mainNodes()
    const drivers = deriveDrivers(nodes, 'top_level')
    const level = buildHierarchyLevel(nodes, drivers, null)
    assert.deepEqual(level.bars.map((b) => b.rowKey), drivers.map((d) => d.rowKey))
    assert.equal(level.reconciliation, null)
  })

  test('drilling in shows direct children only, and they reconcile to the parent', () => {
    const nodes = mainNodes()
    const level = buildHierarchyLevel(nodes, deriveDrivers(nodes, 'top_level'), 'ac.fi')
    assert.deepEqual(level.bars.map((b) => b.rowKey), ['leaf.fi1', 'leaf.fi2'])
    // +20 and +10 reconcile to the parent's +30.
    assert.equal(level.reconciliation?.status, 'ok')
    assert.equal(level.reconciliation?.childSum, 30)
    assert.equal(level.reconciliation?.parentChange, 30)
    assert.equal(level.reconciliation?.residual, 0)
  })

  test('a parent is never added to its own children — the level is one generation deep', () => {
    const kids = childrenOf(mainNodes(), 'ac.fi')
    assert.ok(!kids.some((k) => k.rowKey === 'ac.fi'))
    assert.ok(!kids.some((k) => k.rowKey === 'g.liquid'))
  })

  test('breadcrumbs walk root → node', () => {
    assert.deepEqual(breadcrumbFor(mainNodes(), 'leaf.fi1').map((n) => n.rowKey), ['g.liquid', 'ac.fi', 'leaf.fi1'])
  })

  test('a genuine child/parent mismatch is reported as a residual, never absorbed', () => {
    // Break one child so the children explain only +25 of the parent's +30.
    const specs = MAIN.map((s) => (s.key === 'leaf.fi2' ? { ...s, cur: 85 } : s))
    const r = reconcileChildren(mainNodes(specs), 'ac.fi')
    assert.equal(r.status, 'residual')
    assert.equal(r.childSum, 25)
    assert.equal(r.parentChange, 30)
    assert.equal(r.residual, 5)
  })

  test('an unavailable child makes the sum indeterminate, not smaller', () => {
    const specs = MAIN.map((s) => (s.key === 'leaf.fi2' ? { ...s, cur: null } : s))
    const r = reconcileChildren(mainNodes(specs), 'ac.fi')
    assert.equal(r.status, 'unavailable')
    assert.equal(r.childSum, null)
    assert.equal(r.unavailableChildCount, 1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Personal scopes (doc 07 §§ 6e, 6g)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · personal hierarchy (D4 — the verified doc 02 § 5.4 shape)', () => {
  // The corrected normalized shape: each sociedad = header → asset classes
  // (one with a nested sub-asset) → intermediate SUBTOTAL (Sociedad B uses the
  // verified Vanglor-form bare `TOTAL`) → a value-bearing Alternativos line →
  // the sociedad's TERMINAL total; plus root named/proportional holdings and
  // the final personal total. All amounts synthetic and hand-checkable.
  const PERSONAL: Spec[] = [
    { key: 's.a', parent: null, type: 'sociedad_header', label: 'Watermill', prev: null, cur: null },
    { key: 's.a.cash', parent: 's.a', type: 'asset_class', label: 'Caja y Equivalentes', prev: 40, cur: 30 }, // −10
    { key: 's.a.cash.l', parent: 's.a.cash', type: 'individual_asset', label: 'Caja USD', prev: 40, cur: 30 },
    { key: 's.a.fi', parent: 's.a', type: 'asset_class', label: 'Renta Fija', prev: 100, cur: 130 }, // +30
    { key: 's.a.fi.s', parent: 's.a.fi', type: 'sub_asset_class', label: 'Investment Grade', prev: 100, cur: 130 },
    { key: 's.a.sub', parent: 's.a', type: 'sociedad_subtotal', label: 'SUBTOTAL Watermill', prev: 140, cur: 160 },
    { key: 's.a.alt', parent: 's.a', type: 'asset_class', label: 'Alternativos', prev: 50, cur: 60 }, // +10
    { key: 's.a.tot', parent: 's.a', type: 'sociedad_total', label: 'TOTAL Watermill', prev: 190, cur: 220 }, // +30
    { key: 's.b', parent: null, type: 'sociedad_header', label: 'Dubai', prev: null, cur: null },
    { key: 's.b.eq', parent: 's.b', type: 'asset_class', label: 'Renta Variable', prev: 200, cur: 190 }, // −10
    { key: 's.b.eq.l', parent: 's.b.eq', type: 'individual_asset', label: 'Fondo Y', prev: 200, cur: 190 },
    { key: 's.b.bare', parent: 's.b', type: 'sociedad_subtotal', label: 'TOTAL', prev: 200, cur: 190 },
    { key: 's.b.alt', parent: 's.b', type: 'asset_class', label: 'Alternativos', prev: 10, cur: 30 }, // +20
    { key: 's.b.tot', parent: 's.b', type: 'sociedad_total', label: 'TOTAL Dubai', prev: 210, cur: 220 }, // +10
    { key: 'p.prop', parent: null, type: 'named_holding', label: 'Proporcional Otras Sociedades', prev: 60, cur: 70 }, // +10
    { key: 'p.staten', parent: null, type: 'named_holding', label: 'Staten Capital (1/3)', prev: 40, cur: 30 }, // −10
    { key: 'p.tot', parent: null, type: 'portfolio_total', label: 'TOTAL más Staten', prev: 500, cur: 540 }, // +40
  ]
  const personalNodes = (specs: Spec[] = PERSONAL) =>
    buildChangeNodes(rowsOf(specs, 'cur'), rowsOf(specs, 'prev'), 500)
  const PERSONAL_PERF: WeeklyChangePerformanceRow[] = [
    { basis: 'total', metric: 'flow', value: 15, boundRowKey: 'p.tot' },
    { basis: 'total', metric: 'weekly_profit', value: 25, boundRowKey: 'p.tot' },
  ]

  test('the sociedad view: one driver per sociedad (its TERMINAL total) plus the root named holdings', () => {
    const nodes = personalNodes()
    const drivers = deriveDrivers(nodes, 'sociedad')
    assert.deepEqual(drivers.map((d) => d.rowKey), ['s.a.tot', 's.b.tot', 'p.prop', 'p.staten'])
    // +30 +10 +10 −10 = +40 = the portfolio change. No intermediate subtotal
    // beside its own superset, no header, and NO residual from a lost node.
    assert.equal(drivers.reduce((a, d) => a + (d.weeklyValueChange ?? 0), 0), 40)
    assert.ok(!drivers.some((d) => d.rowType === 'sociedad_subtotal' || d.rowType === 'sociedad_header'))
    const w = buildWaterfall(buildTotalMetrics(nodes, PERSONAL_PERF, 'total'), drivers, LABELS)
    assert.equal(w.status, 'complete')
    assert.ok(!w.steps.some((s) => s.kind === 'residual'))
  })

  test('the asset-class view tiles the SAME +40 at a different grain — never mixed, never summed with the other view', () => {
    const nodes = personalNodes()
    const drivers = deriveDrivers(nodes, 'asset_class')
    assert.deepEqual(
      drivers.map((d) => d.rowKey),
      ['s.a.cash', 's.a.fi', 's.a.alt', 's.b.eq', 's.b.alt', 'p.prop', 'p.staten'],
    )
    // −10 +30 +10 −10 +20 +10 −10 = +40 — the same portfolio change,
    // independently reconciled by an entirely different driver grouping.
    assert.equal(drivers.reduce((a, d) => a + (d.weeklyValueChange ?? 0), 0), 40)
    assert.ok(!drivers.some((d) => d.rowType === 'sociedad_total' || d.rowType === 'sociedad_subtotal'))
    // Each terminal enters exactly once across the view.
    const keys = drivers.map((d) => d.rowKey)
    assert.equal(new Set(keys).size, keys.length)
  })

  test('root named holdings appear in BOTH views exactly once — never dropped, never left to residual', () => {
    const nodes = personalNodes()
    for (const grouping of ['sociedad', 'asset_class'] as const) {
      const keys = deriveDrivers(nodes, grouping).map((d) => d.rowKey)
      assert.equal(keys.filter((k) => k === 'p.prop').length, 1, `${grouping}: Proporcional once`)
      assert.equal(keys.filter((k) => k === 'p.staten').length, 1, `${grouping}: Staten once`)
    }
  })

  test('the total-level flow / investment-result identity reconciles exactly on this shape', () => {
    const recon = reconcileFlowAndProfit(buildTotalMetrics(personalNodes(), PERSONAL_PERF, 'total'))
    assert.equal(recon.status, 'ok') // 500 + 15 + 25 = 540
    assert.equal(recon.expectedCurrent, 540)
  })

  test('drill-down: a sociedad TOTAL descends into its constituents; aggregates are never drill bars', () => {
    const nodes = personalNodes()
    // Multi-level sociedad: constituents, then a nested sub-asset level.
    assert.deepEqual(childrenOf(nodes, 's.a.tot').map((n) => n.rowKey), ['s.a.cash', 's.a.fi', 's.a.alt'])
    assert.deepEqual(childrenOf(nodes, 's.a.fi').map((n) => n.rowKey), ['s.a.fi.s'])
    // Simpler sociedad drills too — the bare-TOTAL intermediate never blocks it.
    assert.deepEqual(childrenOf(nodes, 's.b.tot').map((n) => n.rowKey), ['s.b.eq', 's.b.alt'])
    // The level reconciles: +30 parent vs (−10 +30 +10) children.
    const recon = reconcileChildren(nodes, 's.a.tot')
    assert.equal(recon.status, 'ok')
    assert.equal(recon.parentChange, 30)
    assert.equal(recon.childSum, 30)
    // Round trip through the hierarchy level model.
    const drivers = deriveDrivers(nodes, 'sociedad')
    const level = buildHierarchyLevel(nodes, drivers, 's.a.tot')
    assert.deepEqual(level.bars.map((b) => b.rowKey), ['s.a.cash', 's.a.fi', 's.a.alt'])
    assert.equal(level.reconciliation?.status, 'ok')
    assert.deepEqual(breadcrumbFor(nodes, 's.a.tot').map((n) => n.rowKey), ['s.a', 's.a.tot'])
  })

  test('ranking is leaf-only: sociedad totals/subtotals never appear in top movers', () => {
    // Final-integration guard (R13.8): the +30 TOTAL Watermill would otherwise
    // be the single largest increase — an aggregate masquerading as an asset.
    const ranked = rankWeeklyChanges(personalNodes(), { excludeCash: false })
    const all = [...ranked.increases, ...ranked.decreases]
    assert.ok(all.length > 0)
    assert.ok(
      !all.some(
        (n) =>
          n.rowType === 'sociedad_total' ||
          n.rowType === 'sociedad_subtotal' ||
          n.rowType === 'sociedad_header',
      ),
    )
    assert.ok(!all.some((n) => n.rowKey === 's.a.tot' || n.rowKey === 's.b.tot'))
  })

  test('cash inside a sociedad is still withheld from rankings by default — but never from the tilings', () => {
    const nodes = personalNodes()
    const ranked = rankWeeklyChanges(nodes, { excludeCash: true })
    assert.ok(!ranked.decreases.some((n) => n.rowKey === 's.a.cash.l'))
    assert.ok(ranked.cashRowCount > 0)
    assert.ok(deriveDrivers(nodes, 'asset_class').some((d) => d.rowKey === 's.a.cash'))
  })

  test('an unavailable contributor stays unavailable — the waterfall goes partial, never zero', () => {
    const specs = PERSONAL.map((s) => (s.key === 's.b.alt' ? { ...s, cur: null } : s))
    const nodes = personalNodes(specs)
    const drivers = deriveDrivers(nodes, 'asset_class')
    const gone = drivers.find((d) => d.rowKey === 's.b.alt')!
    assert.equal(gone.status, 'unavailable')
    assert.equal(gone.weeklyValueChange, null)
    const w = buildWaterfall(buildTotalMetrics(nodes, PERSONAL_PERF, 'total'), drivers, LABELS)
    assert.equal(w.status, 'partial')
    assert.equal(w.unavailableDriverCount, 1)
  })

  test('an ambiguous sociedad aggregate set fails CLOSED to an unavailable driver — never a guess', () => {
    const specs = [
      ...PERSONAL.slice(0, 14),
      { key: 's.b.tot2', parent: 's.b', type: 'sociedad_total', label: 'TOTAL Dubai (bis)', prev: 210, cur: 220 },
      ...PERSONAL.slice(14),
    ]
    const nodes = personalNodes(specs)
    const drivers = deriveDrivers(nodes, 'sociedad')
    // Sociedad B cannot pick between two terminal totals: its header stands in,
    // valueless, so the waterfall reports partial instead of double-counting.
    assert.ok(drivers.some((d) => d.rowKey === 's.b' && d.status === 'unavailable'))
    assert.ok(!drivers.some((d) => d.rowKey === 's.b.tot' || d.rowKey === 's.b.tot2'))
    const w = buildWaterfall(buildTotalMetrics(nodes, PERSONAL_PERF, 'total'), drivers, LABELS)
    assert.equal(w.status, 'partial')
  })

  test('a personal scope is never forced into the Main shape — sociedades stay explicit', () => {
    const nodes = personalNodes()
    assert.ok(nodes.some((n) => n.rowType === 'sociedad_header'))
    assert.ok(nodes.some((n) => n.rowType === 'sociedad_subtotal'))
    assert.ok(nodes.some((n) => n.rowType === 'sociedad_total'))
    // Its total binds through the `total` basis, not Main's two bases.
    assert.equal(buildTotalMetrics(nodes, PERSONAL_PERF, 'total').totalRowKey, 'p.tot')
    assert.equal(buildTotalMetrics(nodes, PERSONAL_PERF, 'with_chilean_equities').totalRowKey, null)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Trend and full table
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · trend and full table', () => {
  test('each trend point is a week minus its own predecessor, resolved through that week\'s binding', () => {
    const points = buildWeeklyChangeTrend({
      publications: [
        { id: 'p1', asOfDate: '2026-07-17' },
        { id: 'p2', asOfDate: '2026-07-24' },
        { id: 'p3', asOfDate: '2026-08-07' },
      ],
      boundKeyByPublication: new Map([['p1', 'tot'], ['p2', 'tot'], ['p3', 'totRenamed']]),
      valueByPublicationRow: new Map([
        ['p1::tot', 900],
        ['p2::tot', 1000],
        ['p3::totRenamed', 1100],
      ]),
    })
    assert.deepEqual(points, [
      { date: '2026-07-24', value: 100 },
      { date: '2026-08-07', value: 100 },
    ])
  })

  test('a missing value produces NO point — gaps stay gaps, never zero', () => {
    const points = buildWeeklyChangeTrend({
      publications: [
        { id: 'p1', asOfDate: '2026-07-17' },
        { id: 'p2', asOfDate: '2026-07-24' },
        { id: 'p3', asOfDate: '2026-08-07' },
      ],
      boundKeyByPublication: new Map([['p1', 'tot'], ['p2', null], ['p3', 'tot']]),
      valueByPublicationRow: new Map([['p1::tot', 900], ['p3::tot', 1100]]),
    })
    assert.deepEqual(points, [])
  })

  test('the full table lists every node in display order, including aggregates', () => {
    const table = buildFullChangesTable(mainNodes())
    assert.equal(table.length, MAIN.length)
    assert.deepEqual(table.map((r) => r.rowKey), MAIN.map((s) => s.key))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9 · Terminology (doc 07 §§ 4.2, 4.3)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · terminology boundary', () => {
  const FORBIDDEN = [
    'performance attribution',
    'performance contribution',
    'top performance contributors',
    'top performance detractors',
    'security return contribution',
    'contribution to return',
    'atribución',
    'contribución al retorno',
    'alpha',
    'selection effect',
    'allocation effect',
    'active return',
    'efecto selección',
    'efecto asignación',
    'retorno activo',
  ]

  test('the pure module never names a below-total figure with a forbidden term', () => {
    const src = read('src/lib/familyPortfolio/weeklyChanges.ts').toLowerCase()
    for (const term of FORBIDDEN) {
      // The module may DOCUMENT that a term is forbidden; it may never use one
      // as a label. Every occurrence here must sit in a prohibition sentence.
      const idx = src.indexOf(term)
      if (idx < 0) continue
      const context = src.slice(Math.max(0, idx - 220), idx + term.length + 60)
      assert.ok(
        /never|not a|forbidden|deliberately not|must never/.test(context),
        `"${term}" appears outside a prohibition: …${context.slice(0, 180)}…`,
      )
    }
  })

  test('the module is written against the doc 07 § 4.2 vocabulary', () => {
    // The user-facing strings live in i18n; what this asserts is that the
    // calculation module names its own measures with the contract's terms, so
    // a later renderer cannot pick up a different vocabulary from the API.
    const src = read('src/lib/familyPortfolio/weeklyChanges.ts')
    assert.match(src, /weekly value change/i)
    assert.match(src, /Impact on Portfolio Value/i)
    // The waterfall's own step labels are supplied BY THE CALLER, so this
    // module holds no user-facing string at all — the reason its vocabulary
    // check is about field names rather than display text.
    assert.ok(!/labelEs: '/.test(src), 'the calculation module must hold no display string')
    // The exported field names carry the same meaning, so no consumer has to
    // invent a label: `weeklyValueChange`, `impactOnPortfolioValue`.
    assert.match(src, /weeklyValueChange: number \| null/)
    assert.match(src, /impactOnPortfolioValue: number \| null/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// R13.8 financial-integrity audit — waterfall partition, cash-vs-waterfall,
// currency fail-closed guards, and the Impact denominator resolver
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 audit · waterfall economic partition', () => {
  // The audit fixture: aggregate parents, a nested child, terminal assets, a
  // named holding, cash, AND an unavailable terminal (missing this week).
  const AUDIT: Spec[] = [
    ...MAIN,
    { key: 'leaf.eq2', parent: 'ac.eq', type: 'individual_asset', label: 'Fondo Y', prev: 10, cur: null },
  ]

  test('the driver set is exactly the non-overlapping top-level partition — nothing enters twice', () => {
    const nodes = mainNodes(AUDIT)
    const drivers = deriveDrivers(nodes, 'top_level')
    // EXACT set, in display order: the asset classes inside the container plus
    // the named holdings — never an aggregate, never a container, never a
    // terminal that already lives inside an included driver.
    assert.deepEqual(
      drivers.map((d) => d.rowKey),
      ['ac.cash', 'ac.fi', 'ac.eq', 'nh.inretail', 'nh.chile'],
    )
    for (const d of drivers) {
      assert.ok(!['portfolio_subtotal', 'portfolio_total', 'sociedad_subtotal'].includes(d.rowType))
      assert.ok(d.rowType !== 'group_header', 'a container must never be a monetary driver')
    }
    // No driver is an ancestor or descendant of another driver.
    const keys = new Set(drivers.map((d) => d.rowKey))
    for (const d of drivers) {
      for (const a of breadcrumbFor(nodes, d.rowKey).slice(0, -1)) {
        assert.ok(!keys.has(a.rowKey), `${d.rowKey} and its ancestor ${a.rowKey} must not both drive`)
      }
    }
  })

  test('the unavailable terminal is neither a driver nor a zero — it stays an explicit unavailable node', () => {
    const nodes = mainNodes(AUDIT)
    const drivers = deriveDrivers(nodes, 'top_level')
    assert.ok(!drivers.some((d) => d.rowKey === 'leaf.eq2'))
    const gone = byKey(nodes, 'leaf.eq2')
    assert.equal(gone.status, 'unavailable')
    assert.equal(gone.unavailableReason, 'missing_current')
    assert.equal(gone.weeklyValueChange, null)
  })

  test('the drivers tie exactly: previous + Σ drivers = current, flows and profit never bars', () => {
    const nodes = mainNodes(AUDIT)
    const total = buildTotalMetrics(nodes, PERF, 'with_chilean_equities')
    const wf = buildWaterfall(total, deriveDrivers(nodes, 'top_level'), LABELS)
    assert.equal(wf.status, 'complete')
    assert.ok(!wf.steps.some((s) => s.kind === 'residual'))
    // +60 +30 +20 −10 +0 = +100 over an opening of 1000.
    assert.equal(wf.steps[0].value, 1000)
    assert.equal(wf.steps[wf.steps.length - 1].value, 1100)
    // The source-provided flow (70) and profit (30) are NOT steps — the asset
    // changes already contain their effects (doc 07 § 6e).
    assert.equal(wf.steps.filter((s) => s.kind === 'driver').length, 5)
    assert.ok(!wf.steps.some((s) => s.value === 70 && s.kind === 'driver' && s.rowKey === null))
  })

  test('the cash toggle scopes to the RANKINGS only — the waterfall keeps its cash driver', () => {
    const nodes = mainNodes(AUDIT)
    const wf = buildWaterfall(
      buildTotalMetrics(nodes, PERF, 'with_chilean_equities'),
      deriveDrivers(nodes, 'top_level'),
      LABELS,
    )
    // Caja y Equivalentes IS a waterfall driver — excluding it would misstate
    // the week's economics...
    assert.ok(wf.steps.some((s) => s.kind === 'driver' && s.rowKey === 'ac.cash'))
    // ...while the ranked panels withhold the cash SUBTREE by default and
    // report what was withheld.
    const ranked = rankWeeklyChanges(nodes, { excludeCash: true })
    assert.ok(!ranked.increases.some((n) => n.rowKey === 'leaf.cash1'))
    assert.ok(ranked.cashRowCount > 0)
    const included = rankWeeklyChanges(nodes, { excludeCash: false })
    assert.ok(included.increases.some((n) => n.rowKey === 'leaf.cash1'))
    // deriveDrivers/buildWaterfall expose no cash option at all.
    assert.equal(deriveDrivers.length, 2)
    assert.equal(buildWaterfall.length, 3)
  })
})

describe('R13.8 audit · currency fail-closed guards', () => {
  // The bound TOTAL changes currency between the two weeks: both values exist,
  // so only the § 6c currency rule stands between the identity and a
  // cross-currency netting.
  const mismatched = () => {
    const cur = rowsOf(MAIN, 'cur').map((r) => (r.rowKey === 'tot' ? { ...r, currency: 'EUR' } : r))
    return buildChangeNodes(cur, rowsOf(MAIN, 'prev'), 1000)
  }

  test('the flow / investment-result identity refuses to net two currencies', () => {
    const nodes = mismatched()
    const total = buildTotalMetrics(nodes, PERF, 'with_chilean_equities')
    assert.equal(byKey(nodes, 'tot').unavailableReason, 'currency_mismatch')
    assert.equal(total.weeklyValueChange, null)
    const recon = reconcileFlowAndProfit(total)
    assert.equal(recon.status, 'unavailable')
    assert.equal(recon.residual, null)
    assert.equal(recon.expectedCurrent, null)
  })

  test('the waterfall refuses to span two currencies', () => {
    const nodes = mismatched()
    const total = buildTotalMetrics(nodes, PERF, 'with_chilean_equities')
    const wf = buildWaterfall(total, deriveDrivers(nodes, 'top_level'), LABELS)
    assert.equal(wf.status, 'unavailable')
    assert.equal(wf.steps.length, 0)
  })

  test('resolvePreviousPortfolioTotal: same currency → the previous value; anything else fails closed', () => {
    const prev = rowsOf(MAIN, 'prev')
    const cur = rowsOf(MAIN, 'cur')
    assert.equal(resolvePreviousPortfolioTotal(cur, prev, 'tot'), 1000)
    // Currency changed between weeks → never a cross-currency denominator.
    const eurCur = cur.map((r) => (r.rowKey === 'tot' ? { ...r, currency: 'EUR' } : r))
    assert.equal(resolvePreviousPortfolioTotal(eurCur, prev, 'tot'), null)
    // Bound row absent from a week, or no binding at all → null.
    assert.equal(resolvePreviousPortfolioTotal(cur, prev.filter((r) => r.rowKey !== 'tot'), 'tot'), null)
    assert.equal(resolvePreviousPortfolioTotal(cur, prev, null), null)
    // A null previous value on the bound row → null denominator, never 0.
    const nullPrev = prev.map((r) => (r.rowKey === 'tot' ? { ...r, value: null } : r))
    assert.equal(resolvePreviousPortfolioTotal(cur, nullPrev, 'tot'), null)
  })
})
