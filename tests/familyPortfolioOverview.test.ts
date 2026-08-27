// R13.7 — generated Overview (One Pager): behavioural tests over the pure
// composition rules, the benchmark gate, and the Stage-7 surface (docs 06, 07
// § 7.1, 08 Stage 7).
//
// Fixtures are SYNTHETIC and structurally faithful — round numbers chosen so
// every identity is hand-checkable; no real portfolio value appears anywhere.
//
// Run with: npm test  (Node 24 strips the TS types natively — no toolchain)

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import { formatRatioPct, formatWeightPct } from '../src/lib/formatters.ts'
import {
  identifyMainStructure,
  buildComparisonRows,
  buildAllocation,
  buildHero,
  extractPerformanceBlocks,
  inretailImpact,
  buildEvolutionSeries,
  alignWeeklyClose,
  weeklyPriceReturn,
  fixedIncomeAverage,
  benchmarkWeeklyReturn,
  type OverviewSnapshotRow,
  type OverviewPerformanceRow,
} from '../src/lib/familyPortfolio/overview.ts'
import {
  ONE_PAGER_BENCHMARKS,
  FIXED_INCOME_COMPONENT_IDS,
} from '../src/config/onePagerBenchmarks.ts'
import { resolveOverviewMarketContext } from '../src/lib/familyPortfolio/overviewMarket.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const OVERVIEW_ROUTE = 'src/app/api/family-portfolio/overview/[scope]/route.ts'
const OVERVIEW_PAGE = 'src/app/family-portfolio/page.tsx'
const READ_REPO = 'src/lib/db/repositories/familyPortfolioReadRepository.ts'
const MARKET_RESOLVER = 'src/lib/familyPortfolio/overviewMarket.ts'

// ═══════════════════════════════════════════════════════════════════════════
// Fixture — synthetic Main publication mirroring the doc 02 § 5.3 spine
// ═══════════════════════════════════════════════════════════════════════════

let ORDER = 0
function row(partial: Partial<OverviewSnapshotRow> & { rowKey: string; rowType: string; labelEs: string }): OverviewSnapshotRow {
  return {
    parentRowKey: null,
    depth: 0,
    displayOrder: ORDER++,
    labelEn: null,
    currency: 'USD',
    value: null,
    valueClass: 'source_value',
    previousValue: null,
    beginningOfYearValue: null,
    difference: null,
    differenceClass: null,
    ...partial,
  }
}

function mainFixture(): OverviewSnapshotRow[] {
  ORDER = 0
  return [
    row({ rowKey: 'main.portafolio_liquido', rowType: 'group_header', labelEs: 'PORTAFOLIO LIQUIDO' }),
    row({ rowKey: 'main.portafolio_liquido.caja_y_equivalentes', parentRowKey: 'main.portafolio_liquido', depth: 1, rowType: 'asset_class', labelEs: 'Caja y Equivalentes', value: 100, previousValue: 90, beginningOfYearValue: 80, difference: 10, differenceClass: 'nmi_calculated' }),
    row({ rowKey: 'main.portafolio_liquido.renta_fija', parentRowKey: 'main.portafolio_liquido', depth: 1, rowType: 'asset_class', labelEs: 'Renta Fija', value: 200, previousValue: 210, beginningOfYearValue: 190, difference: -10, differenceClass: 'nmi_calculated' }),
    row({ rowKey: 'main.portafolio_liquido.renta_fija.investment_grade', parentRowKey: 'main.portafolio_liquido.renta_fija', depth: 2, rowType: 'sub_asset_class', labelEs: 'Investment Grade', value: 120 }),
    row({ rowKey: 'main.alternativos', rowType: 'group_header', labelEs: 'ALTERNATIVOS' }),
    row({ rowKey: 'main.alternativos.inmobiliario', parentRowKey: 'main.alternativos', depth: 1, rowType: 'asset_class', labelEs: 'Inmobiliario', value: 300, previousValue: 295, beginningOfYearValue: 280, difference: 5, differenceClass: 'nmi_calculated' }),
    row({ rowKey: 'main.portfolio_liquido_alternativos', rowType: 'portfolio_subtotal', labelEs: 'PORTFOLIO LÍQUIDO + ALTERNATIVOS', value: 600, previousValue: 595 }),
    row({ rowKey: 'main.inretail_peru_corp', rowType: 'named_holding', labelEs: 'INRETAIL PERU CORP', value: 150, previousValue: 140, beginningOfYearValue: 130, difference: 10, differenceClass: 'nmi_calculated' }),
    row({ rowKey: 'main.subtotal', rowType: 'portfolio_subtotal', labelEs: 'SUBTOTAL', value: 750, previousValue: 735, beginningOfYearValue: 700, difference: 15, differenceClass: 'nmi_calculated' }),
    row({ rowKey: 'main.acciones_chilenas_usd', rowType: 'named_holding', labelEs: 'ACCIONES CHILENAS (USD)', value: 250, previousValue: 245, beginningOfYearValue: 250, difference: 5, differenceClass: 'nmi_calculated' }),
    row({ rowKey: 'main.total', rowType: 'portfolio_total', labelEs: 'TOTAL', value: 1000, previousValue: 980, beginningOfYearValue: 950, difference: 20, differenceClass: 'nmi_calculated' }),
  ]
}

function perf(basis: string, boundRowKey: string, values: Record<string, number>): OverviewPerformanceRow[] {
  return Object.entries(values).map(([metric, value]) => ({
    basis,
    metric,
    value,
    valueClass: metric === 'flow' ? 'source_provided_flow' : 'source_provided_return',
    boundRowKey,
  }))
}

function mainPerformance(): OverviewPerformanceRow[] {
  return [
    ...perf('ex_chilean_equities', 'main.subtotal', {
      flow: 5, weekly_return: 0.01, weekly_profit: 7, ytd_return: 0.05, ytd_profit: 30,
    }),
    ...perf('with_chilean_equities', 'main.total', {
      flow: 5, weekly_return: 0.012, weekly_profit: 12, ytd_return: 0.06, ytd_profit: 50,
    }),
  ]
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Structure identification
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7 · identifyMainStructure', () => {
  test('resolves SUBTOTAL and TOTAL through the parse-time performance bindings', () => {
    const s = identifyMainStructure(mainFixture(), mainPerformance())
    assert.equal(s.subtotalRow?.rowKey, 'main.subtotal')
    assert.equal(s.totalRow?.rowKey, 'main.total')
    assert.equal(s.spineAggregateRow?.rowKey, 'main.portfolio_liquido_alternativos')
    assert.deepEqual(s.assetClassRows.map((r) => r.labelEs), ['Caja y Equivalentes', 'Renta Fija', 'Inmobiliario'])
    assert.deepEqual(s.holdingsBeforeSubtotal.map((r) => r.labelEs), ['INRETAIL PERU CORP'])
    assert.deepEqual(s.holdingsBetween.map((r) => r.labelEs), ['ACCIONES CHILENAS (USD)'])
  })

  test('a missing binding fails closed — no label-match fallback', () => {
    const s = identifyMainStructure(mainFixture(), perf('with_chilean_equities', 'main.total', { weekly_return: 0.012 }))
    assert.equal(s.subtotalRow, null)
    assert.equal(buildComparisonRows(s), null)
  })

  test('an ambiguous spine (two leftover subtotals) fails closed to null', () => {
    const rows = [...mainFixture(), row({ rowKey: 'main.extra_subtotal', rowType: 'portfolio_subtotal', labelEs: 'SUBTOTAL EXTRA', value: 1 })]
    const s = identifyMainStructure(rows, mainPerformance())
    assert.equal(s.spineAggregateRow, null)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Comparison rows
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7 · buildComparisonRows', () => {
  test('produces exactly the One Pager row set, in order, flattened', () => {
    const rows = buildComparisonRows(identifyMainStructure(mainFixture(), mainPerformance()))
    assert.ok(rows)
    assert.deepEqual(rows.map((r) => r.labelEs), [
      'Caja y Equivalentes', 'Renta Fija', 'Inmobiliario', 'INRETAIL PERU CORP',
      'SUBTOTAL', 'ACCIONES CHILENAS (USD)', 'TOTAL',
    ])
    // Group headers, sub-asset detail and the spine aggregate never appear.
    assert.ok(!rows.some((r) => r.rowType === 'group_header' || r.rowType === 'sub_asset_class'))
    assert.ok(!rows.some((r) => r.rowKey === 'main.portfolio_liquido_alternativos'))
    // Flat presentation.
    assert.ok(rows.every((r) => r.depth === 0 && r.parentRowKey === null))
    // All four dated values ride through untouched.
    const total = rows.find((r) => r.rowKey === 'main.total')!
    assert.equal(total.value, 1000)
    assert.equal(total.previousValue, 980)
    assert.equal(total.beginningOfYearValue, 950)
    assert.equal(total.difference, 20)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Allocation — three bases, denominators, honesty
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7 · buildAllocation', () => {
  test('three bases with the contract denominators and exact hand-checked weights', () => {
    const bases = buildAllocation(identifyMainStructure(mainFixture(), mainPerformance()))
    assert.deepEqual(bases.map((b) => b.id), ['total', 'ex_chilean', 'ex_chilean_ex_inretail'])

    const total = bases[0]
    assert.equal(total.denominatorRowKey, 'main.total')
    assert.equal(total.denominatorValue, 1000)
    assert.equal(total.status, 'ok')
    assert.equal(total.residual, null) // 100+200+300+150+250 = 1000 exactly
    assert.deepEqual(
      total.entries.map((e) => [e.labelEs, e.weight]),
      [
        ['Caja y Equivalentes', 0.1],
        ['Renta Fija', 0.2],
        ['Inmobiliario', 0.3],
        ['INRETAIL PERU CORP', 0.15],
        ['ACCIONES CHILENAS (USD)', 0.25],
      ],
    )

    const ex = bases[1]
    assert.equal(ex.denominatorRowKey, 'main.subtotal')
    assert.equal(ex.denominatorValue, 750)
    assert.equal(ex.status, 'ok')
    assert.equal(ex.residual, null) // 100+200+300+150 = 750 exactly
    assert.equal(ex.entries.length, 4)
    assert.equal(ex.entries.find((e) => e.labelEs === 'INRETAIL PERU CORP')?.weight, 150 / 750)

    const exEx = bases[2]
    assert.equal(exEx.denominatorRowKey, 'main.portfolio_liquido_alternativos')
    assert.equal(exEx.denominatorValue, 600)
    assert.equal(exEx.status, 'ok')
    assert.equal(exEx.residual, null) // 100+200+300 = 600 exactly
    // The third basis is asset classes ONLY — INRETAIL is structurally excluded.
    assert.ok(!exEx.entries.some((e) => /INRETAIL/.test(e.labelEs)))
    assert.equal(exEx.entries.find((e) => e.labelEs === 'Inmobiliario')?.weight, 0.5)
  })

  test('no basis ever mixes a denominator into its own constituents (double-count guard)', () => {
    const bases = buildAllocation(identifyMainStructure(mainFixture(), mainPerformance()))
    for (const b of bases) {
      assert.ok(!b.entries.some((e) => e.rowKey === b.denominatorRowKey), b.id)
      // Nor any aggregate row at all: constituents are leaves of this basis.
      assert.ok(!b.entries.some((e) => /subtotal|total$/.test(e.rowKey)), b.id)
    }
  })

  test('a genuine tie-out failure surfaces a residual — never silently absorbed', () => {
    const rows = mainFixture().map((r) => (r.rowKey === 'main.subtotal' ? { ...r, value: 800 } : r))
    const bases = buildAllocation(identifyMainStructure(rows, mainPerformance()))
    const ex = bases.find((b) => b.id === 'ex_chilean')!
    assert.equal(ex.status, 'ok')
    assert.ok(ex.residual !== null)
    assert.ok(Math.abs(ex.residual! - (750 - 800)) < 1e-9)
  })

  test('a null constituent makes the basis partial: weight null, tie-out indeterminate, never zero-filled', () => {
    const rows = mainFixture().map((r) =>
      r.rowKey === 'main.portafolio_liquido.caja_y_equivalentes' ? { ...r, value: null } : r,
    )
    const bases = buildAllocation(identifyMainStructure(rows, mainPerformance()))
    const ex = bases.find((b) => b.id === 'ex_chilean')!
    assert.equal(ex.status, 'partial')
    assert.equal(ex.entries.find((e) => e.labelEs === 'Caja y Equivalentes')?.weight, null)
    assert.equal(ex.residual, null)
  })

  test('a null denominator makes the whole basis unavailable', () => {
    const rows = mainFixture().map((r) => (r.rowKey === 'main.total' ? { ...r, value: null } : r))
    const bases = buildAllocation(identifyMainStructure(rows, mainPerformance()))
    const total = bases.find((b) => b.id === 'total')!
    assert.equal(total.status, 'unavailable')
    assert.ok(total.entries.every((e) => e.weight === null))
  })

  test('an unidentified spine aggregate makes only the third basis unavailable', () => {
    const rows = [...mainFixture(), row({ rowKey: 'main.extra_subtotal', rowType: 'portfolio_subtotal', labelEs: 'SUBTOTAL EXTRA', value: 1 })]
    const bases = buildAllocation(identifyMainStructure(rows, mainPerformance()))
    assert.equal(bases.find((b) => b.id === 'ex_chilean_ex_inretail')?.status, 'unavailable')
    assert.equal(bases.find((b) => b.id === 'ex_chilean')?.status, 'ok')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Hero, performance blocks, InRetail impact
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7 · hero and blocks', () => {
  test('hero reads the bound TOTAL row and the with-Chilean performance block', () => {
    const s = identifyMainStructure(mainFixture(), mainPerformance())
    const hero = buildHero(s, mainPerformance())
    // R13.R2 defensive repair: `weeklyDifference` is now DERIVED as
    // `value − previousValue` through the shared invariant rather than passed
    // through from the persisted figure, and carries the reconciliation
    // verdict. The fixture's row satisfies the identity, so the derived value
    // is unchanged (20) and the verdict is `reconciled` — which is exactly the
    // no-numerical-change property the repair was required to have.
    assert.deepEqual(hero, {
      totalValue: 1000,
      weeklyDifference: 20,
      weeklyDifferenceStatus: 'reconciled',
      weeklyReturn: 0.012,
      ytdReturn: 0.06,
      // R13.R5C.1 § 1 — YTD P&L, read from the SAME basis as `ytdReturn`
      // through the same helper, for the Overview card.
      ytdProfit: 50,
    })
  })

  test('performance blocks carry the five source-provided metrics; a missing metric stays null', () => {
    const blocks = extractPerformanceBlocks(mainPerformance())
    assert.deepEqual(blocks.map((b) => b.basis), ['ex_chilean_equities', 'with_chilean_equities'])
    assert.deepEqual(blocks[0], {
      basis: 'ex_chilean_equities', flow: 5, weeklyReturn: 0.01, weeklyProfit: 7, ytdReturn: 0.05, ytdProfit: 30,
    })
    const sparse = extractPerformanceBlocks(perf('with_chilean_equities', 'main.total', { weekly_return: 0.012 }))
    assert.equal(sparse[0].flow, null)
    assert.equal(sparse[0].ytdProfit, null)
  })

  test('InRetail impact is the holding row\'s own NMI-derived difference; absent holding → unavailable', () => {
    const s = identifyMainStructure(mainFixture(), mainPerformance())
    assert.deepEqual(inretailImpact(s), { rowKey: 'main.inretail_peru_corp', value: 10 })
    const without = mainFixture().filter((r) => r.rowKey !== 'main.inretail_peru_corp')
    const s2 = identifyMainStructure(without, mainPerformance())
    assert.deepEqual(inretailImpact(s2), { rowKey: null, value: null })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Evolution series
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7 · buildEvolutionSeries', () => {
  const publications = [
    { id: 'p3', asOfDate: '2026-08-07' },
    { id: 'p1', asOfDate: '2026-07-24' },
    { id: 'p2', asOfDate: '2026-07-31' },
  ]
  const bindings = [
    { publicationId: 'p1', basis: 'ex_chilean_equities', boundRowKey: 'main.subtotal' },
    { publicationId: 'p1', basis: 'with_chilean_equities', boundRowKey: 'main.total' },
    { publicationId: 'p2', basis: 'ex_chilean_equities', boundRowKey: 'main.subtotal' },
    { publicationId: 'p2', basis: 'with_chilean_equities', boundRowKey: 'main.total' },
    // p3 has NO ex binding, and its with-value is null.
    { publicationId: 'p3', basis: 'with_chilean_equities', boundRowKey: 'main.total' },
  ]
  const boundValues = [
    { publicationId: 'p1', rowKey: 'main.subtotal', value: 700 },
    { publicationId: 'p1', rowKey: 'main.total', value: 950 },
    { publicationId: 'p2', rowKey: 'main.subtotal', value: 750 },
    { publicationId: 'p2', rowKey: 'main.total', value: 1000 },
    { publicationId: 'p3', rowKey: 'main.total', value: null },
  ]

  test('one point per publication per basis, sorted by date, resolved through each week\'s own binding', () => {
    const series = buildEvolutionSeries({ publications, bindings, boundValues })
    assert.deepEqual(series.exChilean, [
      { date: '2026-07-24', value: 700 },
      { date: '2026-07-31', value: 750 },
    ])
    assert.deepEqual(series.withChilean, [
      { date: '2026-07-24', value: 950 },
      { date: '2026-07-31', value: 1000 },
    ])
  })

  test('a missing binding or a null value is a GAP — never carried forward, never zero', () => {
    const series = buildEvolutionSeries({ publications, bindings, boundValues })
    // p3 (2026-08-07) appears in NEITHER series: no ex binding, null with-value.
    assert.ok(!series.exChilean.some((p) => p.date === '2026-08-07'))
    assert.ok(!series.withChilean.some((p) => p.date === '2026-08-07'))
    assert.ok(!series.withChilean.some((p) => p.value === 0))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Weekly-close alignment and benchmark arithmetic (doc 06 §§ 3.1, 4.4)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7 · market alignment', () => {
  const bars = [
    { date: '2026-07-27', close: 100 },
    { date: '2026-07-29', close: 102 },
    { date: '2026-07-31', close: 104 },
    { date: '2026-08-05', close: 106 },
  ]

  test('takes the LAST close on or before the week date', () => {
    assert.deepEqual(alignWeeklyClose(bars, '2026-07-31'), { date: '2026-07-31', close: 104 })
    assert.deepEqual(alignWeeklyClose(bars, '2026-08-01'), { date: '2026-07-31', close: 104 })
  })

  test('never looks past the 5-calendar-day window, never uses a future bar', () => {
    // 2026-08-06: window is 08-01..08-06 → 08-05 qualifies.
    assert.deepEqual(alignWeeklyClose(bars, '2026-08-06'), { date: '2026-08-05', close: 106 })
    // 2026-08-11: window is 08-06..08-11 → the 08-05 bar is 6 days back → null.
    assert.equal(alignWeeklyClose(bars, '2026-08-11'), null)
    // A future bar can never serve an earlier week.
    assert.deepEqual(alignWeeklyClose(bars, '2026-07-28'), { date: '2026-07-27', close: 100 })
    // Malformed week date → null, not a guess.
    assert.equal(alignWeeklyClose(bars, 'not-a-date'), null)
  })

  test('weekly price return math and degenerate inputs', () => {
    assert.ok(Math.abs(weeklyPriceReturn(104, 100)! - 0.04) < 1e-12)
    assert.equal(weeklyPriceReturn(null, 100), null)
    assert.equal(weeklyPriceReturn(104, null), null)
    assert.equal(weeklyPriceReturn(104, 0), null)
    assert.equal(weeklyPriceReturn(104, -1), null)
  })

  test('fixed-income mean requires ALL THREE components — a partial mean is refused', () => {
    assert.ok(Math.abs(fixedIncomeAverage([0.01, 0.02, 0.03])! - 0.02) < 1e-12)
    assert.equal(fixedIncomeAverage([0.01, null, 0.03]), null)
    assert.equal(fixedIncomeAverage([0.01, 0.02]), null)
    assert.equal(fixedIncomeAverage([0.01, 0.02, 0.03, 0.04]), null)
  })

  test('benchmarkWeeklyReturn: ok path discloses both observation dates; gaps are unavailable', () => {
    const ok = benchmarkWeeklyReturn(bars, '2026-08-06', '2026-07-31')
    assert.equal(ok.status, 'ok')
    assert.ok(Math.abs(ok.value! - (106 - 104) / 104) < 1e-12)
    assert.equal(ok.observationDate, '2026-08-05')
    assert.equal(ok.previousObservationDate, '2026-07-31')
    // A pre-R13.6 publication with no recorded previous-week date → unavailable.
    assert.equal(benchmarkWeeklyReturn(bars, '2026-08-06', null).status, 'unavailable')
    // No bar in the previous week's window → unavailable, never nearest-match.
    assert.equal(benchmarkWeeklyReturn(bars, '2026-08-06', '2026-07-20').status, 'unavailable')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Benchmark config and the verified-symbol gate
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7 · benchmark gate', () => {
  test('the config carries exactly the five doc 06 § 4.1 instruments, each with its verification metadata', () => {
    assert.deepEqual(ONE_PAGER_BENCHMARKS.map((b) => b.id).sort(), ['acwi', 'aggg', 'cemb', 'ghyg', 'inretc1'])
    for (const b of ONE_PAGER_BENCHMARKS) {
      assert.equal(b.expectedCurrency, 'USD')
      if (b.verified) {
        // A verified entry must carry the evidence that verified it.
        assert.match(b.verifiedAt ?? '', /^\d{4}-\d{2}-\d{2}$/, `${b.id} must record its verification date`)
        assert.ok(b.venue, `${b.id} must record the venue it resolved to`)
        // THE CURRENCY GATE (doc 06 §§ 4.3, 4.5): a symbol may not be verified
        // on inference about its quote currency. This is exactly what keeps
        // INRETC1.LM — whose venue reports no currency at all — unverified.
        assert.equal(b.observedCurrency, 'USD',
          `${b.id} may only be verified with its quote currency CONFIRMED by the provider`)
        assert.match(b.notes, /VERIFIED/)
      } else {
        assert.equal(b.verifiedAt, null, `${b.id} is unverified and must not claim a verification date`)
      }
    }
    assert.deepEqual([...FIXED_INCOME_COMPONENT_IDS], ['aggg', 'ghyg', 'cemb'])
    // The four unused reference instruments are deliberately NOT mapped.
    const cfg = read('src/config/onePagerBenchmarks.ts')
    assert.ok(!/candidateSymbol:\s*'(SPX|\^GSPC|EZU|URTH|EEM)'/.test(cfg),
      'SPX/EZU/URTH/EEM are unused reference data and must not be mapped')
    // The private reference values used to verify must never appear here.
    assert.ok(!/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?/.test(cfg),
      'no reference price or portfolio value may be recorded in the benchmark config')
  })

  test('BEHAVIOURAL: the resolver fetches every VERIFIED symbol and never an unverified one', async () => {
    const fetched: string[] = []
    const spy = async (symbol: string) => {
      fetched.push(symbol)
      return { ok: false as const }
    }
    const ctx = await resolveOverviewMarketContext('2026-08-07', '2026-07-31', spy)

    for (const b of ONE_PAGER_BENCHMARKS) {
      if (b.verified) {
        assert.ok(fetched.includes(b.candidateSymbol), `verified ${b.id} must be fetched`)
      } else {
        assert.ok(!fetched.includes(b.candidateSymbol), `unverified ${b.id} must NEVER be fetched`)
      }
    }
    // INRETC1 is unverified, so both its metrics report unverified with no value
    // — never a number, and never a fetch that is merely hidden afterwards.
    assert.equal(ctx.inretailPrice.status, 'unverified')
    assert.equal(ctx.inretailVariation.status, 'unverified')
    assert.equal(ctx.inretailPrice.value, null)
    assert.equal(ctx.inretailVariation.value, null)
  })

  test('BEHAVIOURAL: a verified symbol whose fetch fails degrades to unavailable, never to a value', async () => {
    const ctx = await resolveOverviewMarketContext('2026-08-07', '2026-07-31', async () => ({ ok: false as const }))
    assert.equal(ctx.globalEquity.status, 'unavailable')
    assert.equal(ctx.globalEquity.value, null)
    assert.equal(ctx.globalFixedIncome.status, 'unavailable')
    assert.equal(ctx.globalFixedIncome.value, null)
  })

  test('BEHAVIOURAL: the fixed-income mean needs all three legs even when all three are verified', async () => {
    // ACWI and two legs return real bars; the third returns none. The composite
    // must stay unavailable rather than quietly become a two-leg average.
    const bars = [
      { date: '2026-07-31', close: 100 },
      { date: '2026-08-07', close: 110 },
    ]
    const partial = async (symbol: string) =>
      symbol === 'CEMB' ? { ok: true as const, closes: [] } : { ok: true as const, closes: bars }
    const ctx = await resolveOverviewMarketContext('2026-08-07', '2026-07-31', partial)
    assert.equal(ctx.globalEquity.status, 'ok')
    assert.ok(Math.abs((ctx.globalEquity.value ?? 0) - 0.1) < 1e-12)
    assert.equal(ctx.globalFixedIncome.status, 'unavailable')
    assert.equal(ctx.globalFixedIncome.value, null)
  })

  test('the resolver gates on verified === true before any fetch, structurally too', () => {
    const src = read(MARKET_RESOLVER)
    assert.match(src, /if \(benchmark\.verified !== true\) return null/)
    // Global equity is ACWI alone — the resolver never averages equity instruments.
    assert.ok(!/urth|eem|ezu|spx/i.test(codeOf(src)))
  })

  test('the discovery script exists, is registered, uses the production arithmetic, and never edits the config', () => {
    assert.ok(existsSync(join(ROOT, 'scripts/discover/onePagerBenchmarks.ts')))
    assert.match(read('package.json'), /"discover:onepager-benchmarks": "node scripts\/discover\/onePagerBenchmarks\.ts"/)
    const script = read('scripts/discover/onePagerBenchmarks.ts')
    assert.match(script, /alignWeeklyClose|weeklyPriceReturn/)
    assert.match(script, /fixedIncomeAverage/)
    assert.ok(!/writeFileSync|appendFileSync/.test(script), 'the script reports; the OPERATOR flips verified')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Route, repository, page — authorization, honesty, disclosure
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7 · overview route and reads', () => {
  test('authorization ladder: guard → entitlement → canReadScope → admissible scope → database', () => {
    const src = read(OVERVIEW_ROUTE)
    const guard = src.indexOf('guardPrivateApi()')
    const ent = src.indexOf('getFamilyPortfolioEntitlement()')
    const scopeCheck = src.indexOf('canReadScope(')
    // R13.R2 § 10 widened the composition from main-only to main + the three
    // personal scopes, so the fourth rung is no longer literally
    // `scope !== 'main'`. The RUNG ITSELF is unchanged and is what matters:
    // the scope-admissibility 404 still sits AFTER the entitlement decision,
    // so an unentitled caller is refused before learning which scopes have a
    // composition at all, and BEFORE any database read.
    const admissible = src.indexOf("if (!isMain && !isPersonal) return fail('not_found', 404)")
    const db = src.indexOf('listCurrentPublications(')
    assert.ok(guard > 0 && ent > guard && scopeCheck > ent && admissible > scopeCheck && db > admissible)
    // `alternatives` and `admin` are not portfolios with a weekly close, so
    // they stay 404 — asserted through the admissibility predicate itself.
    assert.match(src, /const isPersonal = scope === 'jaime' \|\| scope === 'andres' \|\| scope === 'pablo'/)
    assert.match(src, /const isMain = scope === 'main'/)
    // Every financial read is filtered to the REQUESTED scope, so a personal
    // response can never carry a Main row.
    assert.match(src, /getSnapshotRowsForScope\(selected\.id, scope\)/)
    assert.match(src, /getPerformanceRowsForScope\(selected\.id, scope\)/)
    assert.match(src, /export const runtime = 'nodejs'/)
    assert.match(src, /no-store/)
    const code = codeOf(src)
    assert.ok(!/SERVICE_ROLE|service_role/.test(code))
    assert.ok(!/\berror\.message\b/.test(code))
  })

  test('current publications only; the latest week; no draft surface anywhere', () => {
    const src = read(OVERVIEW_ROUTE)
    assert.match(src, /selectPublicationWeek\(spine\.publications, null\)/)
    assert.ok(!src.includes('portfolioPublicationRepository'))
    assert.ok(!src.includes('draftReview'))
    assert.ok(!src.includes('loadDraft'))
  })

  test('commentary is the live revision, generically attributed — the author id never leaves the server', () => {
    const repo = read(READ_REPO)
    assert.match(repo, /\.is\('superseded_by', null\)/)
    assert.match(repo, /select\('body, revision, updated_at'\)/)
    assert.ok(!/select\([^)]*author/.test(repo), 'the author column must never be selected for members')
    // Word-bounded: `not_authorized` legitimately appears; the `author`
    // column/field never may.
    assert.ok(!/\bauthor\b/.test(codeOf(read(OVERVIEW_ROUTE))))
    assert.ok(!/\bauthor\b/.test(codeOf(read(OVERVIEW_PAGE))))
  })

  test('the R13.7 reads go through the user-session client under RLS', () => {
    const repo = read(READ_REPO)
    // Bounded at the R13.9 Alternatives block, which follows it in the file —
    // those reads carry the same discipline, asserted by their own suite.
    const from = repo.indexOf('R13.7 — Overview reads')
    const to = repo.indexOf('R13.9 — Alternatives reads')
    const r137 = repo.slice(from, to > from ? to : undefined)
    assert.ok(r137.length > 0)
    // PASS 4 § 2 added a fifth: the per-week published NET FLOW the evolution
    // chart subtracts. It is a portfolio amount and reads under RLS exactly like
    // the level it is subtracted from — which is the property this counts.
    assert.equal((r137.match(/getSupabaseUserClient\(\)/g) ?? []).length, 5,
      'performance rows, bindings, flows, bound values and commentary all read as the caller')
    assert.ok(!r137.includes('getSupabaseAdminClient'))
  })

  test('the alternatives spine is consulted only behind its own scope check, for freshness only', () => {
    const src = read(OVERVIEW_ROUTE)
    const altAt = src.indexOf("listCurrentPublications('alternatives')")
    const gateAt = src.indexOf("canReadScope(entitlement.input, 'alternatives')")
    assert.ok(gateAt > 0 && altAt > gateAt)
    // Only dates leave: no alternatives holdings/events table is touched.
    assert.ok(!/alternatives_holdings|alternatives_events/.test(src))
  })

  test('the page renders the mandatory provisional-price disclaimer and dual freshness', () => {
    const page = read(OVERVIEW_PAGE)
    assert.match(page, /provisionalDisclaimer/)
    assert.match(page, /DualFreshnessBadge/)
    assert.match(page, /freshnessPortfolio/)
    assert.match(page, /freshnessAlternatives/)
    for (const lang of ['en', 'es'] as const) {
      assert.ok(dict[lang].fp.overview.provisionalDisclaimer.length > 20)
      assert.ok(!/bloomberg/i.test(dict[lang].fp.overview.provisionalDisclaimer),
        'the disclaimer must not claim a Bloomberg relationship')
    }
  })

  test('commentary and market states are honest: real-or-empty, pending note, distinct states', () => {
    const page = read(OVERVIEW_PAGE)
    // R13.R2 § 25 replaced "hide the card entirely" with a RESTRAINED EMPTY
    // STATE — the section is a titled region either way, and an absent note
    // now says so instead of vanishing. The honesty invariant is unchanged and
    // is what is asserted: the body is rendered only from the published
    // commentary, and the empty branch prints a fixed i18n string, never a
    // generated or inferred note.
    // R13.R2C §§ 8-12 turned the single note into a LIST of independent notes,
    // each with its own identity, edit and withdrawal. The honesty invariant
    // did not change with it and is asserted at both ends: the page hands the
    // panel the published notes and nothing else, and the panel renders a body
    // only for a note that exists — never a generated, inferred or placeholder
    // one, and never as markup.
    assert.match(page, /notes=\{data\.weeklyNotes \?\? \[\]\}/)
    const panel = read('src/components/familyPortfolio/WeeklyNotesPanel.tsx')
    assert.match(panel, /\{notes\.map\(\(note\) =>/)
    assert.match(panel, /\{note\.body\}/)
    assert.ok(!/dangerouslySetInnerHTML=/.test(panel), 'a note is text, never markup')
    assert.match(page, /o\.notesEmpty/)
    for (const lang of ['en', 'es'] as const) {
      assert.ok(dict[lang].fp.overview.notesEmpty.length > 0, lang)
      // The empty state must not imply a note exists or promise one later.
      assert.ok(!/coming soon|pr[óo]ximamente|generat/i.test(dict[lang].fp.overview.notesEmpty), lang)
    }
    assert.match(page, /benchmarksPending/)
    assert.match(page, /noPublication/)
    assert.match(page, /loadError/)
    assert.match(page, /notAuthorized/)
    assert.match(page, /evolutionEmpty/)
  })

  test('the fp.overview labels avoid forbidden attribution vocabulary in both languages', () => {
    const FORBIDDEN = /performance attribution|performance contribution|contribution to return|selection effect|allocation effect|active return|\balpha\b/i
    for (const lang of ['en', 'es'] as const) {
      assert.ok(!FORBIDDEN.test(JSON.stringify(dict[lang].fp.overview)))
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9 · Formatters and documentation
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7 · formatters and docs', () => {
  test('formatRatioPct: signed percent from a ratio; unavailable stays an em dash', () => {
    assert.equal(formatRatioPct(0.0123), '+1,23%')
    assert.equal(formatRatioPct(-0.005), '-0,50%')
    assert.equal(formatRatioPct(null), '—')
    assert.equal(formatRatioPct(Number.NaN), '—')
  })

  test('formatWeightPct: unsigned percent from a ratio; unavailable stays an em dash', () => {
    assert.equal(formatWeightPct(0.423), '42,3%')
    assert.equal(formatWeightPct(0), '0,0%')
    assert.equal(formatWeightPct(null), '—')
  })

  test('data_source_status records the benchmark status and the four deliberately-unsurfaced instruments', () => {
    const doc = read('docs/data_source_status.md')
    assert.match(doc, /Overview benchmarks \(R13\.7/)
    assert.match(doc, /onePagerBenchmarks\.ts/)
    for (const unused of ['SPX INDEX', 'EZU US EQUITY', 'URTH US EQUITY', 'EEM US EQUITY']) {
      assert.ok(doc.includes(unused), `${unused} must be recorded as unused reference data`)
    }
  })
})
