// POST-R13.8 FOLLOW-UP D â€” PERFORMANCE HISTORY + CORRECT CUSTOM-PERIOD SEMANTICS.
//
// TWO DEFECTS, ONE CAUSE. `portfolio_performance_rows` is keyed by publication,
// so the source's own weekly flow, profit and return exist only for a week the
// book PUBLISHED. That meant:
//
//   1. A custom FROM â†’ TO comparison could not tell money EARNED from money
//      MOVED, because every intervening week's flow sat in a week with no
//      publication. The surface withheld all three figures rather than state a
//      single week's number over a five-month range â€” honest, but it left the
//      reader with a value change and no way to interpret it.
//
//   2. The surface still spoke WEEKLY vocabulary in Compare mode: "Weekly Value
//      Change", "Previous Week Portfolio Value", "Weekly Return" over a range
//      spanning eighteen reporting intervals.
//
// The parser already reads every one of those metrics. This stage persists them
// beside row history, in the same transaction, and gives Compare mode its own
// period vocabulary and its own cumulative reconciliation.
//
// Sections map to the brief's test matrix:
//   Aâ€“L  custom period      Mâ€“S  performance history      Tâ€“V  weekly regression

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  buildPeriodPerformance,
  periodIntervals,
  periodTolerance,
  type PeriodMetricPoint,
} from '../src/lib/familyPortfolio/periodPerformance.ts'
import {
  planPerformanceHistory,
  performanceHistoryRequiresCorrection,
  PERFORMANCE_HISTORY_VERSION,
  type PersistedPerformanceHistoryEntry,
} from '../src/lib/familyPortfolio/performanceHistory.ts'
import {
  planWeeklyImport,
  applyImportPlan,
  rollbackImport,
  type HistoryStore,
  type PerformanceHistoryWrite,
  type SeriesObservation,
} from '../src/lib/familyPortfolio/weeklyImportPlan.ts'
import { dict } from '../src/lib/i18n.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.join(HERE, '..', rel), 'utf8')

const MIGRATION = read('supabase/migrations/20260822000000_portfolio_analytical_history.sql')
const PGTAP = read('supabase/tests/database/portfolio_analytical_history_test.sql')
const PERF_LIB = read('src/lib/familyPortfolio/performanceHistory.ts')
const PERIOD_LIB = read('src/lib/familyPortfolio/periodPerformance.ts')
const WEEKLY_ROUTE = read('src/app/api/family-portfolio/weekly-changes/[scope]/route.ts')
const WEEKLY_PAGE = read('src/app/portfolio/weekly-changes/page.tsx')
const PUBLISH_ROUTE = read('src/app/api/family-portfolio/admin/uploads/[id]/publish/route.ts')
const PREVIEW_SERVER = read('src/lib/familyPortfolio/importPreviewServer.ts')
const PREVIEW_LIB = read('src/lib/familyPortfolio/weeklyImportPreview.ts')
const READ_REPO = read('src/lib/db/repositories/familyPortfolioReadRepository.ts')
const PUB_REPO = read('src/lib/db/repositories/portfolioPublicationRepository.ts')

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Fixtures â€” the real book's shape over the brief's own regression range
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//
// The reporting spine below is the authoritative workbook's own, from the week
// the Â§12 range opens at through the week it closes at. Eighteen intervals sit
// strictly inside (2026-04-30, 2026-09-04], which is exactly what the real
// workbook carries and what the route must sum over.

const SPINE = [
  '2026-04-17',
  '2026-04-24',
  '2026-04-30',
  '2026-05-08',
  '2026-05-15',
  '2026-05-22',
  '2026-05-29',
  '2026-06-05',
  '2026-06-12',
  '2026-06-19',
  '2026-06-26',
  '2026-07-03',
  '2026-07-10',
  '2026-07-17',
  '2026-07-24',
  '2026-07-31',
  '2026-08-07',
  '2026-08-14',
  '2026-08-21',
  '2026-08-28',
  '2026-09-04',
] as const

const FROM = '2026-04-30'
const TO = '2026-09-04'
/** The eighteen intervals in (FROM, TO] â€” the window every aggregate sums over. */
const WINDOW = SPINE.filter((d) => d > FROM && d <= TO)

/** A metric series over the whole spine, so the FROM week carries one too. */
function series(valueFor: (date: string) => number | null): PeriodMetricPoint[] {
  return SPINE.map((observationDate) => ({ observationDate, value: valueFor(observationDate) }))
}

/** Every interval carries the same number; the FROM week carries a DIFFERENT one. */
function flat(inWindow: number, atFrom: number): PeriodMetricPoint[] {
  return series((d) => (d === FROM ? atFrom : inWindow))
}

const NO_FLOWS = flat(0, 0)
const NO_RETURNS = flat(0, 0)

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Aâ€“C Â· The custom range uses PERIOD semantics, and says so
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('Aâ€“C Â· custom range vocabulary', () => {
  test('A Â· the period window over 2026-04-30 â†’ 2026-09-04 is eighteen source intervals', () => {
    assert.deepEqual(periodIntervals(SPINE, FROM, TO), [...WINDOW])
    assert.equal(WINDOW.length, 18)
  })

  test('A Â· the surface titles a custom range as a Portfolio Value Change, not a weekly one', () => {
    // The headline reads the mode. `customTitle` is the period title in both
    // dictionaries and `weeklyValueChange` is the weekly one; the component must
    // choose between them rather than always printing the weekly label.
    assert.match(WEEKLY_PAGE, /label=\{isCustomRange \? w\.customTitle : w\.weeklyValueChange\}/)
    assert.equal(dict.en.fp.weeklyChanges.customTitle, 'Portfolio Value Change')
    assert.equal(dict.en.fp.weeklyChanges.weeklyValueChange, 'Weekly Value Change')
  })

  test('B Â· no period label anywhere says "week"', () => {
    const en = dict.en.fp.weeklyChanges
    for (const key of [
      'periodFromLabel',
      'periodToLabel',
      'periodProfit',
      'periodFlow',
      'periodReturn',
      'periodReconTitle',
    ] as const) {
      assert.doesNotMatch(
        en[key],
        /week/i,
        `${key} must not call a custom range a week: ${en[key]}`,
      )
    }
    const es = dict.es.fp.weeklyChanges
    for (const key of ['periodFromLabel', 'periodToLabel', 'periodProfit', 'periodFlow', 'periodReturn'] as const) {
      assert.doesNotMatch(es[key], /semanal|semana/i, `${key}: ${es[key]}`)
    }
  })

  test('C Â· the weekly ledger rows are never rendered in Compare mode', () => {
    // The ledger is built ONCE, by mode, so the weekly rows are structurally
    // unreachable when `isCustomRange` â€” not merely styled away.
    assert.match(WEEKLY_PAGE, /if \(isCustomRange\) \{[\s\S]*?w\.periodFromLabel/)
    assert.match(WEEKLY_PAGE, /w\.periodToLabel[\s\S]*?\}\s*\n\s*if \(flowRecon === null\) return null/)
    // And the weekly labels sit strictly after that early return.
    const customBranch = WEEKLY_PAGE.indexOf('if (isCustomRange) {')
    const weeklyRows = WEEKLY_PAGE.indexOf('w.previousValueLabel, value: flowRecon.previousValue')
    assert.ok(customBranch > -1 && weeklyRows > customBranch)
  })

  test('C Â· both period-mode headings exist in EN and ES', () => {
    for (const lang of ['en', 'es'] as const) {
      const w = dict[lang].fp.weeklyChanges
      assert.ok(w.periodReconTitle.length > 0)
      assert.ok(w.periodReconNote.includes('P&L'))
      assert.ok(w.periodIntervals.length > 0)
    }
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Dâ€“F Â· The half-open window
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('Dâ€“F Â· flows sum over (FROM, TO] exactly', () => {
  test('D Â· flows sum across every interval in the window', () => {
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 100,
      closingValue: 150,
      flows: flat(1000, 999_999),
      profits: NO_FLOWS,
      returns: NO_RETURNS,
    })
    assert.equal(p.netFlows, 18 * 1000)
  })

  test('E Â· the FROM weekâ€™s own flow is EXCLUDED', () => {
    // 999,999 sits on the FROM week. If it leaked into the sum the total would
    // be 1,017,999 rather than 18,000 â€” this is the double-count the half-open
    // window exists to prevent.
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 100,
      closingValue: 150,
      flows: flat(1000, 999_999),
      profits: NO_FLOWS,
      returns: NO_RETURNS,
    })
    assert.equal(p.netFlows, 18_000)
    assert.ok(!p.intervals.includes(FROM))
  })

  test('F Â· the TO weekâ€™s own flow IS included', () => {
    const flows = series((d) => (d === TO ? 500 : 0))
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 100,
      closingValue: 150,
      flows,
      profits: NO_FLOWS,
      returns: NO_RETURNS,
    })
    assert.equal(p.netFlows, 500)
    assert.ok(p.intervals.includes(TO))
    assert.equal(p.intervals[p.intervals.length - 1], TO)
  })

  test('F Â· a week strictly after TO is excluded', () => {
    const spine = [...SPINE, '2026-09-11']
    assert.ok(!periodIntervals(spine, FROM, TO).includes('2026-09-11'))
  })

  test('the repository applies the half-open window IN THE QUERY', () => {
    // Stated once, at the read, so no call site can get the exclusion wrong.
    assert.match(READ_REPO, /\.gt\('observation_date', fromDate\)/)
    assert.match(READ_REPO, /\.lte\('observation_date', toDate\)/)
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Gâ€“H Â· The identity
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('Gâ€“H Â· the period identity reconciles', () => {
  test('G Â· Period P&L = closing âˆ’ opening âˆ’ flows', () => {
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 100,
      closingValue: 150,
      // The brief's own worked example: +30 of flows inside a +50 move.
      flows: series((d) => (d === '2026-05-08' ? 30 : d === FROM ? 7 : 0)),
      profits: NO_FLOWS,
      returns: NO_RETURNS,
    })
    assert.equal(p.netFlows, 30)
    assert.equal(p.valueChange, 50)
    assert.equal(p.profit, 20)
  })

  test('H Â· opening + P&L + flows = closing, exactly', () => {
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 130_949_587.91674215,
      closingValue: 148_179_989.06346053,
      flows: series((d) => (d > FROM && d <= TO ? 66_919.0513305868 / 18 : 0)),
      profits: NO_FLOWS,
      returns: NO_RETURNS,
    })
    assert.ok(p.openingValue !== null && p.profit !== null && p.netFlows !== null)
    const rebuilt = p.openingValue + p.profit + p.netFlows
    assert.ok(
      Math.abs(rebuilt - (p.closingValue ?? 0)) <= p.tolerance,
      `identity residual ${rebuilt - (p.closingValue ?? 0)} exceeded ${p.tolerance}`,
    )
  })

  test('H Â· the identity holds when flows are NEGATIVE (a withdrawal)', () => {
    // Pablo's real shape over this range: the book fell less than it earned,
    // because 200,000 left it. A period that reported the value change as the
    // result would understate performance.
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 35_534_511.93991578,
      closingValue: 38_563_835.04970073,
      flows: series((d) => (d === '2026-06-05' ? -200_000 : 0)),
      profits: NO_FLOWS,
      returns: NO_RETURNS,
    })
    assert.equal(p.netFlows, -200_000)
    assert.ok(p.profit !== null && p.valueChange !== null)
    assert.ok(p.profit > p.valueChange, 'a withdrawal makes the result exceed the value change')
  })

  test('the identity is stated in the copy the surface prints', () => {
    assert.match(dict.en.fp.weeklyChanges.periodReconNote, /From Portfolio Value \+ Period P&L \+ Period Net Flows = To Portfolio Value/)
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Iâ€“J Â· Period return
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('Iâ€“J Â· period return', () => {
  test('I Â· complete weekly returns compound to the period return', () => {
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 100,
      closingValue: 150,
      flows: NO_FLOWS,
      profits: NO_FLOWS,
      returns: flat(0.01, 0.99),
    })
    const expected = Math.pow(1.01, 18) - 1
    assert.ok(p.periodReturn !== null)
    assert.ok(Math.abs(p.periodReturn - expected) < 1e-12)
  })

  test('I Â· the FROM weekâ€™s return is excluded from the compounding too', () => {
    // 0.99 on the FROM week would nearly double the product if it leaked in.
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 100,
      closingValue: 150,
      flows: NO_FLOWS,
      profits: NO_FLOWS,
      returns: flat(0.01, 0.99),
    })
    assert.ok((p.periodReturn ?? 0) < 0.2)
  })

  test('J Â· one missing weekly return makes the period return unavailable, not partial', () => {
    const returns = series((d) => (d === '2026-06-19' ? null : 0.01))
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 100,
      closingValue: 150,
      flows: NO_FLOWS,
      profits: NO_FLOWS,
      returns,
    })
    assert.equal(p.periodReturn, null)
    assert.equal(p.returnUnavailableReason, 'incomplete_history')
  })

  test('J Â· one missing weekly flow makes period flows AND P&L unavailable', () => {
    // A partial flow sum is not approximately right â€” it is wrong by exactly the
    // week it lost, and a P&L derived from it would silently absorb that money.
    const flows = series((d) => (d === '2026-07-03' ? null : 100))
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 100,
      closingValue: 150,
      flows,
      profits: NO_FLOWS,
      returns: NO_RETURNS,
    })
    assert.equal(p.netFlows, null)
    assert.equal(p.profit, null)
    assert.equal(p.flowsUnavailableReason, 'incomplete_history')
    assert.equal(p.profitUnavailableReason, 'incomplete_history')
    // The value change is still correct â€” it is a difference of two snapshots.
    assert.equal(p.valueChange, 50)
  })

  test('J Â· a missing endpoint is reported as a MISSING ENDPOINT, not missing history', () => {
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: null,
      closingValue: 150,
      flows: flat(10, 0),
      profits: NO_FLOWS,
      returns: NO_RETURNS,
    })
    assert.equal(p.profit, null)
    assert.equal(p.profitUnavailableReason, 'endpoints_missing')
    // The flows themselves were complete and are still reported.
    assert.equal(p.netFlows, 180)
  })

  test('J Â· the period return is NEVER P&L divided by the opening value', () => {
    // The two genuinely differ whenever money moved mid-period. Jaime's real
    // range reads 2.751% compounded against 2.878% naive.
    assert.doesNotMatch(PERIOD_LIB, /profit\s*\/\s*opening/i)
    assert.doesNotMatch(PERIOD_LIB, /periodReturn[\s\S]{0,80}\/\s*openingValue/)
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 17_348_116.131641313,
      closingValue: 19_502_983.948242493,
      flows: series((d) => (d === '2026-06-12' ? 1_655_600 : 0)),
      profits: NO_FLOWS,
      returns: series((d) => (d > FROM && d <= TO ? 0.0015091 : 0)),
    })
    const naive = (p.profit ?? 0) / (p.openingValue ?? 1)
    assert.ok(p.periodReturn !== null)
    assert.ok(
      Math.abs(p.periodReturn - naive) > 1e-4,
      'the compounded and naive returns must genuinely differ when flows land mid-period',
    )
  })

  test('J Â· the surface names the unavailable reason rather than printing a dash alone', () => {
    assert.match(WEEKLY_PAGE, /w\.periodFlowsUnavailable/)
    assert.match(WEEKLY_PAGE, /w\.periodReturnUnavailable/)
    assert.match(dict.en.fp.weeklyChanges.periodFlowsUnavailable, /understate/)
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Kâ€“L Â· The source cross-check
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('Kâ€“L Â· the independent source cross-check', () => {
  test('K Â· summed source weekly P&L agrees with the derived P&L', () => {
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 1000,
      closingValue: 1500,
      flows: series((d) => (d > FROM && d <= TO ? 10 : 0)),
      // 500 âˆ’ 180 = 320 of result, spread evenly.
      profits: series((d) => (d > FROM && d <= TO ? 320 / 18 : 0)),
      returns: NO_RETURNS,
    })
    assert.equal(p.profitCrossCheck, 'ok')
    assert.ok(Math.abs(p.profitCrossCheckDelta ?? 1) <= p.tolerance)
  })

  test('L Â· a genuine disagreement is reported, not resolved', () => {
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 1000,
      closingValue: 1500,
      flows: series((d) => (d > FROM && d <= TO ? 10 : 0)),
      profits: series((d) => (d > FROM && d <= TO ? 1 : 0)),
      returns: NO_RETURNS,
    })
    assert.equal(p.profitCrossCheck, 'mismatch')
    // BOTH numbers survive. Neither is adjusted toward the other.
    assert.equal(p.profit, 320)
    assert.equal(p.sourceProfitSum, 18)
    assert.equal(p.profitCrossCheckDelta, 302)
  })

  test('L Â· the mismatch surfaces as a warning that names both figures as reported', () => {
    assert.match(WEEKLY_PAGE, /periodPerf\?\.profitCrossCheck === 'mismatch'/)
    assert.match(WEEKLY_PAGE, /text-warning[\s\S]{0,80}periodCrossMismatch/)
    assert.match(dict.en.fp.weeklyChanges.periodCrossMismatch, /neither has been adjusted/)
  })

  test('L Â· an incomplete source series compares nothing rather than comparing wrongly', () => {
    const p = buildPeriodPerformance({
      fromDate: FROM,
      toDate: TO,
      reportingDates: SPINE,
      openingValue: 1000,
      closingValue: 1500,
      flows: series((d) => (d > FROM && d <= TO ? 10 : 0)),
      profits: series((d) => (d === '2026-07-17' ? null : 1)),
      returns: NO_RETURNS,
    })
    assert.equal(p.sourceProfitSum, null)
    assert.equal(p.profitCrossCheck, 'unavailable')
    assert.equal(p.profitCrossCheckDelta, null)
  })

  test('the tolerance scales with the book rather than being a fixed cent', () => {
    assert.ok(periodTolerance(148_179_989) > periodTolerance(1000))
    assert.ok(periodTolerance(null) > 0)
    assert.ok(periodTolerance(0) > 0)
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Mâ€“Q Â· Performance history: identity, staging, no-op, corrections
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

type Metric = {
  scope: string
  basis: string
  metric: string
  value: number | null
  value_class: string
  source_sheet: string
  source_cell: string
  metadata: { sourceRow: number }
}

const METRICS = ['flow', 'weekly_profit', 'weekly_return', 'ytd_profit', 'ytd_return'] as const

function metricsFor(scope: string, basis: string, seed: number): Metric[] {
  return METRICS.map((metric, i) => ({
    scope,
    basis,
    metric,
    value: seed + i,
    value_class: metric === 'flow' ? 'source_provided_flow' : 'source_provided_return',
    source_sheet: 'RESUMEN',
    source_cell: `DE${90 + i}`,
    metadata: { sourceRow: 90 + i },
  }))
}

/** The four scopes' metrics at one date, as the parser produces them. */
function columnAt(seed: number): Metric[] {
  return [
    ...metricsFor('main', 'ex_chilean_equities', seed),
    ...metricsFor('main', 'with_chilean_equities', seed + 100),
    ...metricsFor('jaime', 'total', seed + 200),
    ...metricsFor('andres', 'total', seed + 300),
    ...metricsFor('pablo', 'total', seed + 400),
  ]
}

function workbook(dates: readonly string[] = SPINE): Map<string, Metric[]> {
  const m = new Map<string, Metric[]>()
  dates.forEach((d, i) => m.set(d, columnAt(i)))
  return m
}

describe('Mâ€“Q Â· performance history', () => {
  test('M Â· the canonical identity is (scope, basis, metric, observation_date)', () => {
    assert.match(
      MIGRATION,
      /constraint portfolio_performance_history_key[\s\S]{0,40}unique \(scope, basis, metric, observation_date\)/,
    )
    // It MIRRORS the publication performance identity with the publication
    // replaced by the date â€” basis included, because it is genuinely part of it.
    assert.match(PERF_LIB, /it is part of the performance identity/)
  })

  test('M Â· basis is present here and deliberately absent from row history', () => {
    assert.match(MIGRATION, /`basis` IS part of that identity and is carried, unlike in row history/)
    assert.match(MIGRATION, /`basis` is deliberately ABSENT/)
  })

  test('M Â· a duplicate identity within one date refuses the whole date', () => {
    const wb = workbook(['2026-09-04'])
    const rows = wb.get('2026-09-04')!
    wb.set('2026-09-04', [...rows, rows[0]])
    const plan = planPerformanceHistory({ workbook: wb, persisted: [], parserVersion: 'p1' })
    assert.deepEqual(plan.skipped, [{ date: '2026-09-04', reason: 'duplicate_identity' }])
    assert.equal(plan.rows.length, 0)
  })

  test('N Â· the full workbook history stages cleanly as insertions', () => {
    const plan = planPerformanceHistory({ workbook: workbook(), persisted: [], parserVersion: 'p1' })
    assert.equal(plan.counts.new, SPINE.length * 25)
    assert.equal(plan.counts.gap_fill, 0)
    assert.equal(plan.counts.changed, 0)
    assert.equal(plan.datesInserted.length, SPINE.length)
    assert.equal(plan.skipped.length, 0)
    assert.equal(plan.version, PERFORMANCE_HISTORY_VERSION)
    assert.equal(performanceHistoryRequiresCorrection(plan), false)
  })

  test('N Â· a date the source never stated metrics for is SKIPPED, never zeroed', () => {
    // The authoritative workbook's earliest frozen column (2024-08-23) genuinely
    // carries no performance block. Recording zeros there would put a fabricated
    // "no money moved" into the one series a period subtracts.
    const wb = workbook(['2026-09-04'])
    wb.set('2024-08-23', [])
    const plan = planPerformanceHistory({ workbook: wb, persisted: [], parserVersion: 'p1' })
    assert.deepEqual(
      plan.skipped.filter((s) => s.date === '2024-08-23'),
      [{ date: '2024-08-23', reason: 'no_metrics' }],
    )
    assert.ok(!plan.rows.some((r) => r.observation_date === '2024-08-23'))
  })

  test('N Â· a date below the endpoint is a GAP FILL, above it is NEW', () => {
    const persisted: PersistedPerformanceHistoryEntry[] = [
      {
        scope: 'main',
        basis: 'ex_chilean_equities',
        metric: 'flow',
        observationDate: '2026-06-05',
        value: 7,
        valueClass: 'source_provided_flow',
      },
    ]
    const plan = planPerformanceHistory({ workbook: workbook(), persisted, parserVersion: 'p1' })
    assert.equal(plan.endpoint, '2026-06-05')
    const kinds = new Map(plan.rows.map((r) => [`${r.observation_date}|${r.metric}|${r.scope}|${r.basis}`, r.disposition]))
    assert.equal(kinds.get('2026-04-17|flow|main|ex_chilean_equities'), 'gap_fill')
    assert.equal(kinds.get('2026-09-04|flow|main|ex_chilean_equities'), 'new')
    // Neither needs authorization.
    assert.equal(performanceHistoryRequiresCorrection(plan), false)
  })

  test('O Â· an identical re-upload writes nothing at all', () => {
    const wb = workbook()
    const first = planPerformanceHistory({ workbook: wb, persisted: [], parserVersion: 'p1' })
    const persisted: PersistedPerformanceHistoryEntry[] = first.rows.map((r) => ({
      scope: r.scope,
      basis: r.basis,
      metric: r.metric,
      observationDate: r.observation_date,
      value: r.value,
      valueClass: r.value_class,
    }))
    const second = planPerformanceHistory({ workbook: wb, persisted, parserVersion: 'p1' })
    assert.equal(second.rows.length, 0)
    assert.equal(second.counts.new, 0)
    assert.equal(second.counts.gap_fill, 0)
    assert.equal(second.counts.changed, 0)
    assert.equal(second.counts.unchanged, SPINE.length * 25)
  })

  test('P Â· a changed historical metric is a CORRECTION carrying both amounts', () => {
    const wb = workbook()
    const base = planPerformanceHistory({ workbook: wb, persisted: [], parserVersion: 'p1' })
    const persisted: PersistedPerformanceHistoryEntry[] = base.rows.map((r) => ({
      scope: r.scope,
      basis: r.basis,
      metric: r.metric,
      observationDate: r.observation_date,
      value: r.value,
      valueClass: r.value_class,
    }))
    // The workbook now states a different flow for one settled week.
    const restated = workbook()
    const rows = restated.get('2026-06-19')!
    restated.set(
      '2026-06-19',
      rows.map((r) =>
        r.scope === 'jaime' && r.metric === 'flow' ? { ...r, value: 1_655_600 } : r,
      ),
    )
    const plan = planPerformanceHistory({ workbook: restated, persisted, parserVersion: 'p1' })
    assert.equal(plan.counts.changed, 1)
    assert.equal(performanceHistoryRequiresCorrection(plan), true)
    assert.deepEqual(plan.datesChanged, ['2026-06-19'])
    const c = plan.corrections[0]
    assert.equal(c.scope, 'jaime')
    assert.equal(c.metric, 'flow')
    assert.equal(c.afterValue, 1_655_600)
    assert.notEqual(c.beforeValue, c.afterValue)
  })

  test('P Â· the correction gate is armed by performance history alone', () => {
    const plan = planWeeklyImport({
      publishedObservations: [],
      workbookObservations: [],
      performanceHistory: {
        insertedCount: 0,
        changedCount: 1,
        datesInserted: [],
        datesChanged: ['2026-06-19'],
      },
    })
    assert.equal(plan.requiresPerformanceHistoryCorrection, true)
    assert.equal(plan.requiresHistoricalCorrection, true)
    assert.ok(plan.blockCodes.includes('historical_correction_required'))
  })

  test('P Â· authorization alone is not enough â€” a written reason is required', () => {
    const plan = planWeeklyImport({
      publishedObservations: [],
      workbookObservations: [],
      historicalCorrectionAuthorized: true,
      correctionReason: '   ',
      performanceHistory: {
        insertedCount: 0,
        changedCount: 1,
        datesInserted: [],
        datesChanged: ['2026-06-19'],
      },
    })
    assert.ok(plan.blockCodes.includes('correction_reason_required'))
  })

  test('Q Â· an unavailable metric keeps a NULL value and is never zeroed', () => {
    const wb = workbook(['2026-09-04'])
    wb.set(
      '2026-09-04',
      wb.get('2026-09-04')!.map((r) =>
        r.metric === 'ytd_profit' ? { ...r, value: null, value_class: 'unavailable' } : r,
      ),
    )
    const plan = planPerformanceHistory({ workbook: wb, persisted: [], parserVersion: 'p1' })
    const unavailable = plan.rows.filter((r) => r.value_class === 'unavailable')
    assert.equal(unavailable.length, 5)
    for (const r of unavailable) assert.equal(r.value, null)
    // The database refuses the other direction too.
    assert.match(
      MIGRATION,
      /portfolio_performance_history_unavailable_ck check \(\s*\n?\s*value_class <> 'unavailable' or value is null/,
    )
  })

  test('Q Â· an unreadable metric that stays unreadable is not a weekly correction', () => {
    const wb = workbook(['2026-09-04'])
    const unreadable = wb.get('2026-09-04')!.map((r) => ({ ...r, value: null, value_class: 'unavailable' }))
    wb.set('2026-09-04', unreadable)
    const persisted: PersistedPerformanceHistoryEntry[] = unreadable.map((r) => ({
      scope: r.scope,
      basis: r.basis,
      metric: r.metric,
      observationDate: '2026-09-04',
      value: null,
      valueClass: 'unavailable',
    }))
    const plan = planPerformanceHistory({ workbook: wb, persisted, parserVersion: 'p1' })
    assert.equal(plan.counts.changed, 0)
    assert.equal(plan.counts.unchanged, unreadable.length)
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// R Â· Atomicity and rollback
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const OBS: SeriesObservation[] = [
  { scope: 'main', basis: 'total', seriesIdentity: 'main|total', observationDate: '2026-09-04', value: 10, status: 'stated' },
]

function store(): HistoryStore {
  return {
    observations: [],
    currentPublication: { asOfDate: '2026-08-28', revision: 1, importId: 'i0' },
    publications: { '2026-08-28': { asOfDate: '2026-08-28', revision: 1, importId: 'i0' } },
    rowHistory: [],
    performanceHistory: [],
  }
}

function write(
  overrides: Partial<PerformanceHistoryWrite> = {},
): PerformanceHistoryWrite {
  return {
    scope: 'jaime',
    basis: 'total',
    metric: 'flow',
    observationDate: '2026-06-19',
    disposition: 'new',
    value: 1_655_600,
    valueClass: 'source_provided_flow',
    priorValue: null,
    priorValueClass: null,
    ...overrides,
  }
}

function appendPlan() {
  return planWeeklyImport({
    publishedObservations: [],
    workbookObservations: [{ ...OBS[0] }],
    performanceHistory: {
      insertedCount: 1,
      changedCount: 0,
      datesInserted: ['2026-06-19'],
      datesChanged: [],
    },
  })
}

describe('R Â· atomicity and rollback', () => {
  test('R Â· performance history is written by the import transaction, never after it', () => {
    // One transaction, both histories. No post-commit second write path.
    assert.match(MIGRATION, /insert into public\.portfolio_performance_history\b/)
    const importFn = MIGRATION.slice(
      MIGRATION.indexOf('create or replace function public.nmi_import_portfolio_workbook'),
      MIGRATION.indexOf('create or replace function public.nmi_rollback_portfolio_import'),
    )
    assert.ok(importFn.includes('insert into public.portfolio_performance_history'))
    assert.ok(importFn.includes('portfolio_import_performance_history_mutations'))
    // And the publish route makes exactly ONE import call.
    assert.equal((PUBLISH_ROUTE.match(/await importPortfolioWorkbook\(/g) ?? []).length, 1)
  })

  test('R Â· the apply block runs BEFORE the restatement loop, so late failures are real', () => {
    const importFn = MIGRATION.slice(
      MIGRATION.indexOf('create or replace function public.nmi_import_portfolio_workbook'),
      MIGRATION.indexOf('create or replace function public.nmi_rollback_portfolio_import'),
    )
    const perfApply = importFn.indexOf('insert into public.portfolio_performance_history\n')
    const restatement = importFn.indexOf('Historical publication corrections')
    assert.ok(perfApply > -1 && restatement > perfApply)
  })

  test('R Â· a rollback removes insertions and restores overwrites exactly', () => {
    const s = store()
    const plan = appendPlan()
    const applied = applyImportPlan(s, plan, 'i1', [], [write()])
    assert.ok(applied.ok)
    assert.equal(applied.store.performanceHistory?.length, 1)
    assert.equal(applied.record.performanceHistoryEntries.length, 1)
    assert.equal(applied.record.performanceHistoryEntries[0].priorExisted, false)

    const back = rollbackImport(applied.store, applied.record)
    assert.ok(back.ok)
    assert.equal(back.store.performanceHistory?.length, 0)
  })

  test('R Â· an overwrite is restored to its exact value, class and lineage', () => {
    const s = store()
    s.performanceHistory = [
      {
        scope: 'jaime',
        basis: 'total',
        metric: 'flow',
        observationDate: '2026-06-19',
        value: 7,
        valueClass: 'source_provided_flow',
        importId: 'i0',
      },
    ]
    const plan = appendPlan()
    const applied = applyImportPlan(s, plan, 'i1', [], [
      write({ disposition: 'changed', priorValue: 7, priorValueClass: 'source_provided_flow' }),
    ])
    assert.ok(applied.ok)
    assert.equal(applied.store.performanceHistory?.[0].value, 1_655_600)
    assert.equal(applied.store.performanceHistory?.[0].importId, 'i1')

    const back = rollbackImport(applied.store, applied.record)
    assert.ok(back.ok)
    const restored = back.store.performanceHistory?.[0]
    assert.equal(restored?.value, 7)
    assert.equal(restored?.valueClass, 'source_provided_flow')
    // Lineage comes back too â€” leaving it pointing at i1 would make a later
    // rollback of i0 refuse, believing something else had moved the metric on.
    assert.equal(restored?.importId, 'i0')
  })

  test('R Â· a stale plan is refused whole, and the book is untouched', () => {
    const s = store()
    // The identity already exists, so an INSERTION of it is a stale plan.
    s.performanceHistory = [
      {
        scope: 'jaime',
        basis: 'total',
        metric: 'flow',
        observationDate: '2026-06-19',
        value: 7,
        valueClass: 'source_provided_flow',
        importId: 'i0',
      },
    ]
    const result = applyImportPlan(s, appendPlan(), 'i1', [], [write()])
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.code, 'stale_performance_history')
    assert.equal(result.store.performanceHistory?.[0].value, 7)
  })

  test('R Â· an overwrite whose recorded value has moved is refused', () => {
    const s = store()
    s.performanceHistory = [
      {
        scope: 'jaime',
        basis: 'total',
        metric: 'flow',
        observationDate: '2026-06-19',
        value: 99,
        valueClass: 'source_provided_flow',
        importId: 'i0',
      },
    ]
    const result = applyImportPlan(s, appendPlan(), 'i1', [], [
      write({ disposition: 'changed', priorValue: 7, priorValueClass: 'source_provided_flow' }),
    ])
    assert.equal(result.ok === false && result.code, 'stale_performance_history')
  })

  test('R Â· one identity may be written at most once per import', () => {
    const result = applyImportPlan(store(), appendPlan(), 'i1', [], [write(), write()])
    assert.equal(result.ok === false && result.code, 'stale_performance_history')
  })

  test('R Â· a rollback refuses once a later import owns one of the metrics', () => {
    const s = store()
    const applied = applyImportPlan(s, appendPlan(), 'i1', [], [write()])
    assert.ok(applied.ok)
    const moved: HistoryStore = {
      ...applied.store,
      performanceHistory: (applied.store.performanceHistory ?? []).map((p) => ({ ...p, importId: 'i2' })),
    }
    const back = rollbackImport(moved, applied.record)
    assert.equal(back.ok, false)
    assert.equal(back.ok === false && back.code, 'superseded_by_later_import')
  })

  test('R Â· the database refuses a stale rollback for the same reason', () => {
    assert.match(MIGRATION, /rollback_refused_performance_history_superseded_by_later_import/)
  })

  test('R Â· appending only performance history is a real import, not a no-op', () => {
    const plan = planWeeklyImport({
      publishedObservations: [],
      workbookObservations: [],
      performanceHistory: {
        insertedCount: 2260,
        changedCount: 0,
        datesInserted: ['2026-09-04'],
        datesChanged: [],
      },
    })
    assert.equal(plan.action, 'row_history_append')
    // The route and the database say the same thing.
    assert.match(PUBLISH_ROUTE, /plan\.performanceHistory\.insertedCount === 0/)
    assert.match(MIGRATION, /and v_ph_new = 0 and v_ph_changed = 0/)
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// S Â· Security
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('S Â· family-scope authorization', () => {
  test('S Â· performance history takes the SAME scope predicate as the publication table', () => {
    assert.match(
      MIGRATION,
      /create policy "portfolio_performance_history_scope_select"[\s\S]{0,200}using \(public\.nmi_can_access_scope\(scope\)\)/,
    )
  })

  test('S Â· it is never a broad authenticated read, and never writable by a member', () => {
    assert.match(MIGRATION, /revoke all privileges on table public\.portfolio_performance_history from public, anon, authenticated/)
    assert.match(MIGRATION, /grant select on table public\.portfolio_performance_history to authenticated/)
    assert.match(
      MIGRATION,
      /has_table_privilege\('authenticated', 'public\.portfolio_performance_history', 'INSERT'\)/,
    )
  })

  test('S Â· the ledger and the relay are service-role only', () => {
    for (const t of [
      'portfolio_import_performance_history_mutations',
      'portfolio_performance_history_staging',
    ]) {
      assert.ok(
        MIGRATION.includes(`grant all privileges on table public.${t} to service_role`),
        `${t} must be granted to service_role`,
      )
      assert.ok(
        !new RegExp(`grant select on table public\\.${t} to authenticated`).test(MIGRATION),
        `${t} must never be readable by authenticated`,
      )
    }
  })

  test('S Â· the member read goes through the CALLERâ€™S session, not the admin client', () => {
    const fn = READ_REPO.slice(
      READ_REPO.indexOf('export async function getPerformanceHistoryRange'),
      READ_REPO.indexOf('type PerformanceHistoryDateSelect'),
    )
    assert.match(fn, /getSupabaseUserClient\(\)/)
    assert.doesNotMatch(fn, /getSupabaseAdminClient/)
  })

  test('S Â· performance history carries no publication lifecycle columns', () => {
    assert.match(
      MIGRATION,
      /table_name = 'portfolio_performance_history'\s*\n\s*and column_name in \('is_current','revision','superseded_by','publication_id'\)/,
    )
    const ddl = MIGRATION.slice(
      MIGRATION.indexOf('create table if not exists public.portfolio_performance_history ('),
      MIGRATION.indexOf('create index if not exists portfolio_performance_history_scope_idx'),
    )
    for (const col of ['is_current', 'superseded_by', 'publication_id', 'revision']) {
      assert.ok(!ddl.includes(col), `${col} must not exist on portfolio_performance_history`)
    }
  })

  test('S Â· the staged-set helper is stable, invoker and search-path pinned', () => {
    assert.match(
      MIGRATION,
      /create or replace function public\.nmi_staged_performance_history\(p_staging_id uuid\)[\s\S]{0,900}language sql\s*\n\s*stable\s*\n\s*set search_path = ''/,
    )
    assert.match(MIGRATION, /grant execute on function public\.nmi_staged_performance_history\(uuid\) to service_role/)
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// The relay and the 14-argument signature
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('the relay preserves the single callable import path', () => {
  test('the import RPC keeps EXACTLY fourteen arguments', () => {
    const sig = MIGRATION.slice(
      MIGRATION.indexOf('create or replace function public.nmi_import_portfolio_workbook('),
      MIGRATION.indexOf(')\nreturns jsonb'),
    )
    const args = sig.split('\n').filter((l) => /^\s+p_[a-z_]+\s+/.test(l))
    assert.equal(args.length, 14)
    assert.match(MIGRATION, /expected exactly one nmi_import_portfolio_workbook/)
  })

  test('the relay id rides in the already-versioned metadata packet', () => {
    assert.match(MIGRATION, /p_metadata->>'performanceHistoryStagingId'/)
    assert.match(MIGRATION, /p_metadata->>'performanceHistoryRowCount'/)
    assert.match(PUBLISH_ROUTE, /performanceHistoryStagingId:/)
    assert.match(PUBLISH_ROUTE, /performanceHistoryRowCount: performanceHistoryRows\.length/)
  })

  test('a lost chunk is a refusal, never a partially written history', () => {
    for (const code of [
      'import_refused_performance_history_count_missing',
      'import_refused_performance_history_staging_incomplete',
      'import_refused_performance_history_staging_missing',
      'import_refused_unknown_performance_history_disposition',
      'import_refused_stale_performance_history_identity_exists',
      'import_refused_stale_performance_history_identity_absent',
      'import_refused_stale_performance_history_value_moved',
    ]) {
      assert.ok(MIGRATION.includes(code), `${code} must be raised by the import RPC`)
    }
  })

  test('a failed import discards BOTH relays', () => {
    assert.match(PUBLISH_ROUTE, /if \(!imported\.ok && performanceHistoryRows\.length > 0\) \{\s*\n\s*await discardPerformanceHistoryStaging/)
  })

  test('a failed performance stage also discards the row-history batch', () => {
    assert.match(
      PUBLISH_ROUTE,
      /if \(rowHistoryRows\.length > 0\) await discardRowHistoryStaging\(rowHistoryStagingId\)\s*\n\s*return fail\('performance_history_stage_failed', 502\)/,
    )
  })

  test('the plan fingerprint covers performance history', () => {
    assert.match(PREVIEW_LIB, /performanceHistory\|\$\{plan\.performanceHistory\.insertedCount\}/)
  })

  test('an unreadable performance-history table FAILS the preview rather than reading empty', () => {
    assert.match(PREVIEW_SERVER, /performance_history_read_failed/)
    assert.match(PREVIEW_SERVER, /A FAILED READ IS A FAILURE/)
  })

  test('the persisted read pages on a TOTAL order so no identity is missed', () => {
    const fn = PUB_REPO.slice(
      PUB_REPO.indexOf('export async function listPersistedPerformanceHistory'),
      PUB_REPO.indexOf('export interface PerformanceHistoryStagedRow'),
    )
    for (const col of ['observation_date', 'scope', 'basis', 'metric']) {
      assert.ok(fn.includes(`.order('${col}'`), `paging must order by ${col}`)
    }
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Tâ€“V Â· Weekly-mode regression
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('Tâ€“V Â· weekly mode is unchanged', () => {
  test('T Â· the default weekly view still compares the sourceâ€™s own two weeks', () => {
    // The default remains 2026-08-28 â†’ 2026-09-04 from the publication's OWN
    // source columns, never 2026-07-31 â†’ 2026-09-04.
    assert.match(WEEKLY_ROUTE, /const sourcePreviousDate =\s*\n\s*mode === 'weekly' &&/)
    assert.match(WEEKLY_ROUTE, /hasSourceWeeklyBasis\(currentRows\.rows, current\.previousWeekDate, current\.asOfDate\)/)
  })

  test('T Â· the period reconciliation is computed ONLY in custom mode', () => {
    assert.match(WEEKLY_ROUTE, /let periodPerformance: PeriodPerformance \| null = null\s*\n\s*if \(mode === 'custom'\) \{/)
    assert.match(WEEKLY_ROUTE, /WEEKLY MODE COMPUTES NONE OF THIS/)
  })

  test('U Â· the weekly reconciliation function is untouched by this stage', () => {
    // Weekly mode still reads `flowReconciliation`, whose residual note is its
    // own. Nothing here replaces a published weekly figure with a derived one.
    assert.match(WEEKLY_PAGE, /if \(flowRecon === null\) return null/)
    assert.match(WEEKLY_PAGE, /!isCustomRange && flowRecon\?\.status === 'residual'/)
  })

  test('V Â· weekly terminology survives in non-Compare mode', () => {
    assert.match(WEEKLY_PAGE, /w\.previousValueLabel, value: flowRecon\.previousValue/)
    assert.match(WEEKLY_PAGE, /w\.endingValueLabel, value: flowRecon\.actualCurrent/)
    assert.equal(dict.en.fp.weeklyChanges.previousValueLabel, 'Previous Week Portfolio Value')
    assert.equal(dict.en.fp.weeklyChanges.endingValueLabel, 'Ending Week Portfolio Value')
    assert.equal(dict.en.fp.overview.weeklyReturn, 'Weekly Return')
  })

  test('V Â· the weekly headline still shows the sourceâ€™s own weekly return', () => {
    assert.match(WEEKLY_PAGE, /: `\$\{formatRatioPct\(total\.weeklyReturn\)\} \$\{o\.weeklyReturn\}`/)
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// The 1M contributor window is untouched
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('the rolling 1M contributor window still reads ROW history', () => {
  test('performance history does not replace row history for contributors', () => {
    // 1M opens from row-level values, which performance history does not carry.
    assert.match(WEEKLY_ROUTE, /const openingRows = await getRowHistoryForScope\(scope, rowHistoryOpening\)/)
    assert.doesNotMatch(WEEKLY_ROUTE, /getPerformanceHistoryRange[\s\S]{0,200}rowHistoryOpening/)
  })

  test('the period reconciliation never feeds the contributor decomposition', () => {
    // `periodPerformance` is a total-level reconciliation. The nodes are built
    // from the two row sets alone, exactly as before.
    assert.match(WEEKLY_ROUTE, /const nodes = buildChangeNodes\(currentRows\.rows, previousRowSet, previousTotal\)/)
  })
})

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// No table alias may shadow a declared PL/pgSQL variable
//
// CAUGHT IN CI, NOT BY REVIEW. `nmi_import_portfolio_workbook` declares `m` and
// `h` as record variables for its two loops. PL/pgSQL resolves a qualified name
// against its DECLARED VARIABLES before a query's aliases, so a statement that
// aliased `portfolio_performance_history` as `h` bound `h.scope` to the
// not-yet-assigned loop record and raised
//
//     55000: record "h" is not assigned yet
//
// at the FIRST stale-plan check — killing every import, in both pgTAP suites,
// on every path. It typechecks, it lints, and no amount of reading catches it;
// only a real PostgreSQL run does. This asserts the invariant statically so the
// next person cannot reintroduce it and wait a CI round-trip to find out.

describe('no table alias shadows a declared PL/pgSQL variable', () => {
  /** The `declare` block of one function in the migration. */
  function declaredVars(fn: string): string[] {
    const start = MIGRATION.indexOf(`create or replace function public.${fn}(`)
    assert.ok(start > -1, `${fn} must exist`)
    const body = MIGRATION.slice(start)
    const declareAt = body.indexOf('\ndeclare\n')
    const beginAt = body.indexOf('\nbegin\n')
    if (declareAt === -1 || beginAt === -1 || declareAt > beginAt) return []
    return body
      .slice(declareAt, beginAt)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('--'))
      .map((l) => l.split(/\s+/)[0])
      .filter((n) => /^[a-z_][a-z0-9_]*$/.test(n))
  }

  /** Every `<table> <alias>` and `<table> as <alias>` in one function body. */
  function aliases(fn: string): Array<{ table: string; alias: string }> {
    const start = MIGRATION.indexOf(`create or replace function public.${fn}(`)
    const rest = MIGRATION.slice(start)
    const end = rest.indexOf('\nend $$;')
    const body = rest.slice(0, end === -1 ? undefined : end)
    const out: Array<{ table: string; alias: string }> = []
    const re = /public\.([a-z_]+)\s+(?:as\s+)?([a-z][a-z0-9_]{0,3})\b/g
    let match: RegExpExecArray | null
    while ((match = re.exec(body)) !== null) {
      const alias = match[2]
      // Keywords that legitimately follow a table name are not aliases.
      if (['set', 'as', 'on', 'using', 'where', 'from', 'is'].includes(alias)) continue
      out.push({ table: match[1], alias })
    }
    return out
  }

  for (const fn of ['nmi_import_portfolio_workbook', 'nmi_rollback_portfolio_import']) {
    test(`${fn} aliases nothing it also declares`, () => {
      const declared = new Set(declaredVars(fn))
      assert.ok(declared.size > 0, `${fn} must declare variables`)
      for (const { table, alias } of aliases(fn)) {
        assert.ok(
          !declared.has(alias),
          `${fn}: alias "${alias}" for ${table} shadows the declared variable "${alias}" — ` +
            'PL/pgSQL binds the variable first and the statement raises 55000 at run time',
        )
      }
    })
  }

  test('the import declares `h` and `m`, so those two aliases stay forbidden', () => {
    // Non-vacuity: the guard above only means something if these are declared.
    const declared = new Set(declaredVars('nmi_import_portfolio_workbook'))
    assert.ok(declared.has('h'), '`h` is the restatement loop record')
    assert.ok(declared.has('m'), '`m` is the evolution loop record')
  })

  test('performance history is aliased `ph`, and never `h`', () => {
    assert.ok(!/portfolio_performance_history\s+h\b/.test(MIGRATION))
    assert.match(MIGRATION, /portfolio_performance_history ph\b/)
    // And the reason is recorded beside the declaration that forced it.
    assert.match(MIGRATION, /NOTE ON ALIASES/)
  })
})

// pgTAP coverage
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('pgTAP covers performance history against real PostgreSQL', () => {
  test('the suite exercises the table, the relay, the gate and the rollback', () => {
    for (const needle of [
      'portfolio_performance_history',
      'nmi_staged_performance_history',
      'import_refused_performance_history_staging_incomplete',
      'rollback_refused_performance_history_superseded_by_later_import',
      'portfolio_performance_history_scope_select',
    ]) {
      assert.ok(PGTAP.includes(needle), `pgTAP must cover ${needle}`)
    }
  })
})
