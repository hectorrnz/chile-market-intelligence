// R13.R4A.1 — the Alternatives refinement pass: period selection, monthly
// aggregation, the two drill-downs, and the presentation invariants that must
// survive a purely visual refinement.
//
// The behavioural half runs the PURE module directly — every period boundary,
// every subtotal and every partition below is a real financial decision, and
// none of them is a rendering concern. The structural half reads the page
// sources and asserts only what a restyle must NOT change: which control
// exists, which figure is emphasised, which disclosure is present, and that no
// forbidden metric or colour ever appears.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import {
  annualCashFlows,
  applyEventFilter,
  applyHoldingFilter,
  cashFlowYears,
  currencyLabel,
  eventsInPeriod,
  filterOptions,
  periodBreakdown,
  commitmentDrawn,
  periodColumns,
  recentEvents,
  undrawnCommitments,
  EMPTY_FILTER,
  type AlternativesEventRead,
  type AlternativesHoldingRead,
} from '../src/lib/familyPortfolio/alternativesView.ts'

import {
  clampTooltipLeft,
  tooltipMaxWidth,
  TIP_EDGE_PX,
} from '../src/lib/familyPortfolio/alternatives/chartTooltipPosition.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const LAYOUT = 'src/app/family-portfolio/alternatives/layout.tsx'
const DASHBOARD = 'src/app/family-portfolio/alternatives/page.tsx'
const HOLDINGS = 'src/app/family-portfolio/alternatives/holdings/page.tsx'
const CASHFLOWS = 'src/app/family-portfolio/alternatives/cash-flows/page.tsx'
const FILTERS = 'src/components/familyPortfolio/AlternativesFilters.tsx'
const CHART = 'src/components/familyPortfolio/AlternativesCashFlowChart.tsx'
const DRILLDOWNS = 'src/components/familyPortfolio/AlternativesDrilldowns.tsx'
const VIEW = 'src/lib/familyPortfolio/alternativesView.ts'
const TOOLTIP = 'src/components/fable/chart/ChartTooltip.tsx'
const ROUTES = 'src/lib/familyPortfolio/alternativesRoutes.ts'

/** Charts that share the tooltip surface but were out of R13.R4A.4's scope. */
const OTHER_CHARTS = [
  'src/components/charts/LineChart.tsx',
  'src/components/charts/CompareChart.tsx',
  'src/components/charts/FundamentalsChart.tsx',
  'src/components/charts/YieldCurveChart.tsx',
  'src/components/familyPortfolio/ContributionChart.tsx',
  'src/components/familyPortfolio/PortfolioEvolutionChart.tsx',
]

/** Everything R13.R4A.1 added or touched on the front end. */
const R4A1_FILES = [DASHBOARD, HOLDINGS, CASHFLOWS, FILTERS, CHART, DRILLDOWNS]

/** Source with comments stripped, so a doc reference never satisfies a check. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
}

// ---------------------------------------------------------------------------
// Fixtures — shaped like the real workbook's awkward cases: two currencies with
// DIFFERENT recorded windows, a gap year, a December→January span, a month
// inside the window with no movement, a genuinely-zero unfunded, a negative
// (over-drawn) unfunded, and an unfunded the source simply does not carry.
// ---------------------------------------------------------------------------

function holding(over: Partial<AlternativesHoldingRead> & { id: string }): AlternativesHoldingRead {
  return {
    category: 'Private Equity',
    currency: 'dolares',
    investmentName: 'Fund A',
    sociedad: 'WATERMILL',
    capitalCommitted: 1000,
    contributions: 400,
    unfunded: 600,
    lastStatementDate: '2026-03-31',
    lastStatementLabel: null,
    lastValuation: 500,
    flowSinceStatement: 10,
    currentValue: 510,
    reportedIrr: null,
    calculatedIrr: null,
    ...over,
  }
}

function event(over: Partial<AlternativesEventRead>): AlternativesEventRead {
  return {
    holdingId: 'h1',
    eventDate: '2024-06-30',
    amount: -100,
    currency: 'dolares',
    eventType: 'aporte',
    ...over,
  }
}

const HOLDINGS_FIXTURE: AlternativesHoldingRead[] = [
  holding({ id: 'h1', unfunded: 600 }),
  holding({ id: 'h2', sociedad: 'DUBAI', unfunded: 900 }),
  // Fully drawn — a real zero, which is NOT the same as an absent figure.
  holding({ id: 'h3', sociedad: 'STATEN', unfunded: 0 }),
  // Over-drawn. Excluded from the undrawn list, but it still lands in the
  // position subtotal, which is why the two totals are separate figures.
  holding({ id: 'h4', sociedad: 'NEVADA', unfunded: -50 }),
  // The source carries no unfunded figure — never reconstructed from
  // committed − contributed (which would be 1000 − 400 = 600).
  holding({ id: 'h5', sociedad: 'RETBOY', unfunded: null }),
  // A different currency entirely; must never join the dollar figures.
  holding({
    id: 'h6',
    currency: 'euros',
    investmentName: 'Fund E',
    sociedad: 'COVAL',
    capitalCommitted: 500,
    contributions: 100,
    unfunded: 400,
  }),
]

const EVENTS_FIXTURE: AlternativesEventRead[] = [
  // USD window: 2022-11 → 2024-03. 2023 is present; there is NO 2021.
  event({ holdingId: 'h1', eventDate: '2022-11-30', amount: -100 }),
  event({ holdingId: 'h1', eventDate: '2022-12-31', amount: -200 }),
  event({ holdingId: 'h2', eventDate: '2023-01-31', amount: -300 }),
  event({ holdingId: 'h1', eventDate: '2023-06-30', amount: 40, eventType: 'dividendo' }),
  event({ holdingId: 'h2', eventDate: '2023-06-30', amount: 60, eventType: 'distribucion' }),
  event({ holdingId: 'h2', eventDate: '2023-09-30', amount: 25, eventType: 'unclassified' }),
  event({ holdingId: 'h1', eventDate: '2024-03-31', amount: -400 }),
  // EUR window: 2025-05 → 2025-07 only — a different window entirely.
  event({ holdingId: 'h6', eventDate: '2025-05-31', amount: -500, currency: 'euros' }),
  event({ holdingId: 'h6', eventDate: '2025-07-31', amount: 220, currency: 'euros', eventType: 'distribucion' }),
]

// ===========================================================================
// 1 · Year selection — dynamic, source-backed, never a generated range
// ===========================================================================

describe('R13.R4A.1 · year selection', () => {
  test('years come from the events, newest first, distinct', () => {
    assert.deepEqual(cashFlowYears(EVENTS_FIXTURE, 'dolares'), ['2024', '2023', '2022'])
    assert.deepEqual(cashFlowYears(EVENTS_FIXTURE, 'euros'), ['2025'])
  })

  test('a currency with no recorded event offers no year at all', () => {
    assert.deepEqual(cashFlowYears(EVENTS_FIXTURE, 'pesos'), [])
    assert.deepEqual(cashFlowYears([], 'dolares'), [])
  })

  test('no gap year is generated between the endpoints', () => {
    const sparse = [
      event({ eventDate: '2019-01-31' }),
      event({ eventDate: '2026-01-31' }),
    ]
    // A range would have produced eight years; the source records two.
    assert.deepEqual(cashFlowYears(sparse, 'dolares'), ['2026', '2019'])
  })

  test('omitting the currency spans every currency, still newest first', () => {
    assert.deepEqual(cashFlowYears(EVENTS_FIXTURE), ['2025', '2024', '2023', '2022'])
  })

  test('filterOptions exposes the same descending source-backed years', () => {
    const o = filterOptions(HOLDINGS_FIXTURE, EVENTS_FIXTURE)
    assert.deepEqual(o.years, ['2025', '2024', '2023', '2022'])
    // Deterministic regardless of the order the events arrive in.
    assert.deepEqual(filterOptions(HOLDINGS_FIXTURE, [...EVENTS_FIXTURE].reverse()).years, o.years)
  })

  test('a year is read off the ISO string, never through a Date', () => {
    // 1 January in a negative-offset timezone would slip to the prior year if
    // the value were parsed rather than sliced.
    const jan1 = [event({ eventDate: '2024-01-01' })]
    assert.deepEqual(cashFlowYears(jan1, 'dolares'), ['2024'])
    assert.equal(codeOf(read(VIEW)).includes('new Date('), false)
  })

  test('per-currency year lists are independent', () => {
    const usd = cashFlowYears(EVENTS_FIXTURE, 'dolares')
    const eur = cashFlowYears(EVENTS_FIXTURE, 'euros')
    assert.equal(usd.some((y) => eur.includes(y)), false)
  })
})

// ===========================================================================
// 2 · Period columns — the monthly/annual aggregation
// ===========================================================================

describe('R13.R4A.1 · period aggregation', () => {
  test('no year selected gives one column per recorded year, oldest first', () => {
    const cols = periodColumns(EVENTS_FIXTURE, 'dolares', [])
    assert.deepEqual(cols.map((c) => c.period), ['2022', '2023', '2024'])
    assert.equal(cols.every((c) => c.unit === 'year'), true)
    assert.equal(cols.every((c) => c.hasEvents), true)
  })

  test('the annual columns match the published annualCashFlows exactly', () => {
    const published = annualCashFlows(EVENTS_FIXTURE).find((c) => c.currency === 'dolares')
    assert.ok(published)
    const cols = periodColumns(EVENTS_FIXTURE, 'dolares', [])
    assert.deepEqual(cols.map((c) => c.period), published.years.map((y) => y.year))
    for (const [i, y] of published.years.entries()) {
      assert.equal(cols[i].calls, y.calls)
      assert.equal(cols[i].distributions, y.distributions)
      assert.equal(cols[i].unclassified, y.unclassified)
      assert.equal(cols[i].net, y.net)
    }
  })

  test('a year gives contiguous month columns bounded by the currency window', () => {
    // The USD window opens 2022-11, so 2022 yields November and December only —
    // never ten fabricated blanks in front of them.
    assert.deepEqual(
      periodColumns(EVENTS_FIXTURE, 'dolares', ['2022']).map((c) => c.period),
      ['2022-11', '2022-12'],
    )
    // It closes 2024-03, so 2024 stops there.
    assert.deepEqual(
      periodColumns(EVENTS_FIXTURE, 'dolares', ['2024']).map((c) => c.period),
      ['2024-01', '2024-02', '2024-03'],
    )
    // A year fully inside the window gets all twelve.
    const y2023 = periodColumns(EVENTS_FIXTURE, 'dolares', ['2023'])
    assert.equal(y2023.length, 12)
    assert.deepEqual(y2023.map((c) => c.period).slice(0, 2), ['2023-01', '2023-02'])
    assert.equal(y2023[11].period, '2023-12')
    assert.equal(y2023.every((c) => c.unit === 'month'), true)
  })

  test('a silent month inside the window is marked, not printed as a figure', () => {
    const feb = periodColumns(EVENTS_FIXTURE, 'dolares', ['2023']).find((c) => c.period === '2023-02')
    assert.ok(feb)
    assert.equal(feb.hasEvents, false)
    assert.equal(feb.events, 0)
    assert.equal(feb.calls, 0)
    assert.equal(feb.distributions, 0)
    assert.deepEqual(feb.byType, {})
  })

  test('no month is ever emitted outside the recorded window', () => {
    for (const y of cashFlowYears(EVENTS_FIXTURE, 'dolares')) {
      for (const c of periodColumns(EVENTS_FIXTURE, 'dolares', [y])) {
        assert.equal(c.period >= '2022-11', true, `${c.period} precedes the window`)
        assert.equal(c.period <= '2024-03', true, `${c.period} follows the window`)
      }
    }
  })

  test('a year outside the currency window yields no columns at all', () => {
    assert.deepEqual(periodColumns(EVENTS_FIXTURE, 'dolares', ['2019']), [])
    assert.deepEqual(periodColumns(EVENTS_FIXTURE, 'dolares', ['2030']), [])
  })

  test('a currency with no events yields no columns in either mode', () => {
    assert.deepEqual(periodColumns(EVENTS_FIXTURE, 'pesos', []), [])
    assert.deepEqual(periodColumns(EVENTS_FIXTURE, 'pesos', ['2023']), [])
  })

  test('month columns sum back to their year, exactly', () => {
    for (const y of cashFlowYears(EVENTS_FIXTURE, 'dolares')) {
      const months = periodColumns(EVENTS_FIXTURE, 'dolares', [y])
      const year = periodColumns(EVENTS_FIXTURE, 'dolares', []).find((c) => c.period === y)
      assert.ok(year)
      assert.equal(months.reduce((s, c) => s + c.calls, 0), year.calls)
      assert.equal(months.reduce((s, c) => s + c.distributions, 0), year.distributions)
      assert.equal(months.reduce((s, c) => s + c.unclassified, 0), year.unclassified)
      assert.equal(months.reduce((s, c) => s + c.events, 0), year.events)
    }
  })

  test('a December→January span rolls the year over correctly', () => {
    const dec = periodColumns(EVENTS_FIXTURE, 'dolares', ['2022']).find((c) => c.period === '2022-12')
    const jan = periodColumns(EVENTS_FIXTURE, 'dolares', ['2023']).find((c) => c.period === '2023-01')
    assert.equal(dec?.calls, -200)
    assert.equal(jan?.calls, -300)
  })

  test('a window spanning a year boundary emits contiguous months across it', () => {
    const spanning = [
      event({ eventDate: '2023-11-30', amount: -10 }),
      event({ eventDate: '2024-02-29', amount: -20 }),
    ]
    assert.deepEqual(
      periodColumns(spanning, 'dolares', ['2023']).map((c) => c.period),
      ['2023-11', '2023-12'],
    )
    assert.deepEqual(
      periodColumns(spanning, 'dolares', ['2024']).map((c) => c.period),
      ['2024-01', '2024-02'],
    )
  })

  test('dividendo and distribucion stay two classes, never one invented colour', () => {
    const y2023 = periodColumns(EVENTS_FIXTURE, 'dolares', []).find((c) => c.period === '2023')
    assert.ok(y2023)
    assert.equal(y2023.byType['dividendo'], 40)
    assert.equal(y2023.byType['distribucion'], 60)
    assert.equal(y2023.distributions, 100)
  })

  test('unclassified is carried separately and excluded from net', () => {
    const y2023 = periodColumns(EVENTS_FIXTURE, 'dolares', []).find((c) => c.period === '2023')
    assert.ok(y2023)
    assert.equal(y2023.unclassified, 25)
    assert.equal(y2023.net, y2023.calls + y2023.distributions)
    assert.equal(y2023.net, -300 + 100)
  })

  test('one currency never leaks into another currency’s columns', () => {
    const usd = periodColumns(EVENTS_FIXTURE, 'dolares', [])
    assert.equal(usd.some((c) => c.period === '2025'), false)
    const eur = periodColumns(EVENTS_FIXTURE, 'euros', [])
    assert.deepEqual(eur.map((c) => c.period), ['2025'])
    assert.equal(eur[0].calls, -500)
    assert.equal(eur[0].distributions, 220)
  })

  test('a non-finite amount is skipped, never summed into a NaN column', () => {
    const dirty = [...EVENTS_FIXTURE, event({ eventDate: '2023-04-30', amount: Number.NaN })]
    for (const c of periodColumns(dirty, 'dolares', ['2023'])) {
      assert.equal(Number.isFinite(c.calls), true)
      assert.equal(Number.isFinite(c.net), true)
    }
    const apr = periodColumns(dirty, 'dolares', ['2023']).find((c) => c.period === '2023-04')
    assert.equal(apr?.hasEvents, false)
  })

  test('eventsInPeriod matches on the date prefix and passes null straight through', () => {
    assert.equal(eventsInPeriod(EVENTS_FIXTURE, '2023').length, 4)
    assert.equal(eventsInPeriod(EVENTS_FIXTURE, '2023-06').length, 2)
    assert.equal(eventsInPeriod(EVENTS_FIXTURE, null).length, EVENTS_FIXTURE.length)
    assert.equal(eventsInPeriod(EVENTS_FIXTURE, '2099').length, 0)
  })
})

// ===========================================================================
// 3 · The period drill-down
// ===========================================================================

describe('R13.R4A.1 · period breakdown', () => {
  test('a breakdown reconciles exactly with the column that opened it', () => {
    for (const currency of ['dolares', 'euros']) {
      const periods = [
        ...periodColumns(EVENTS_FIXTURE, currency, []),
        ...cashFlowYears(EVENTS_FIXTURE, currency).flatMap((y) =>
          periodColumns(EVENTS_FIXTURE, currency, [y]),
        ),
      ]
      for (const col of periods) {
        const b = periodBreakdown(EVENTS_FIXTURE, HOLDINGS_FIXTURE, currency, col.period)
        assert.equal(b.calls.amount, col.calls, `${currency} ${col.period} calls`)
        assert.equal(b.distributions.amount, col.distributions, `${currency} ${col.period} distributions`)
        assert.equal(b.unclassified.amount, col.unclassified, `${currency} ${col.period} unclassified`)
        assert.equal(b.net, col.net, `${currency} ${col.period} net`)
        assert.equal(b.events.length, col.events, `${currency} ${col.period} count`)
      }
    }
  })

  test('it never leaks another currency or another period', () => {
    const b = periodBreakdown(EVENTS_FIXTURE, HOLDINGS_FIXTURE, 'dolares', '2023')
    assert.equal(b.events.every((e) => e.currency === 'dolares'), true)
    assert.equal(b.events.every((e) => e.eventDate.startsWith('2023')), true)
    const m = periodBreakdown(EVENTS_FIXTURE, HOLDINGS_FIXTURE, 'dolares', '2023-06')
    assert.equal(m.events.every((e) => e.eventDate.startsWith('2023-06')), true)
    assert.equal(m.events.length, 2)
  })

  test('rows are newest first and resolve to their holding', () => {
    const b = periodBreakdown(EVENTS_FIXTURE, HOLDINGS_FIXTURE, 'dolares', '2023')
    for (let i = 1; i < b.events.length; i += 1) {
      assert.equal(b.events[i - 1].eventDate >= b.events[i].eventDate, true)
    }
    assert.equal(b.events.every((e) => e.investmentName !== null), true)
    assert.equal(b.events.every((e) => e.sociedad !== null), true)
  })

  test('an unlinked event survives with an honest unknown rather than a guess', () => {
    const orphan = [...EVENTS_FIXTURE, event({ holdingId: null, eventDate: '2023-02-28', amount: -5 })]
    const b = periodBreakdown(orphan, HOLDINGS_FIXTURE, 'dolares', '2023-02')
    assert.equal(b.events.length, 1)
    assert.equal(b.events[0].investmentName, null)
    assert.equal(b.events[0].sociedad, null)
  })

  test('an empty period returns zeroed totals and no rows, never null', () => {
    const b = periodBreakdown(EVENTS_FIXTURE, HOLDINGS_FIXTURE, 'dolares', '2023-02')
    assert.deepEqual(b.events, [])
    assert.equal(b.calls.amount, 0)
    assert.equal(b.calls.count, 0)
    assert.equal(b.distributions.amount, 0)
    assert.equal(b.net, 0)
    assert.equal(b.period, '2023-02')
    assert.equal(b.currency, 'dolares')
  })

  test('classification is the source’s: an unclassified row is never folded into net', () => {
    const b = periodBreakdown(EVENTS_FIXTURE, HOLDINGS_FIXTURE, 'dolares', '2023-09')
    assert.equal(b.unclassified.count, 1)
    assert.equal(b.unclassified.amount, 25)
    assert.equal(b.net, 0)
  })
})

// ===========================================================================
// 4 · Undrawn commitments
// ===========================================================================

describe('R13.R4A.1 · undrawn commitments', () => {
  test('only a positive source unfunded figure is listed', () => {
    const u = undrawnCommitments(HOLDINGS_FIXTURE, 'dolares')
    assert.deepEqual(u.holdings.map((h) => h.id), ['h2', 'h1'])
    assert.equal(u.holdings.every((h) => h.unfunded > 0), true)
  })

  test('every row is accounted for exactly once', () => {
    const u = undrawnCommitments(HOLDINGS_FIXTURE, 'dolares')
    assert.equal(u.ofHoldings, 5)
    assert.equal(u.holdings.length, 2)
    // h3 (zero) and h4 (over-drawn) are drawn; h5 has no figure at all.
    assert.equal(u.fullyDrawn, 2)
    assert.equal(u.unavailable, 1)
    assert.equal(u.holdings.length + u.fullyDrawn + u.unavailable, u.ofHoldings)
  })

  test('a missing unfunded figure is disclosed, never reconstructed', () => {
    const u = undrawnCommitments(HOLDINGS_FIXTURE, 'dolares')
    assert.equal(u.holdings.some((h) => h.id === 'h5'), false)
    // committed − contributions would have been 600 — the exact number a
    // derivation would have invented for that row.
    assert.equal(u.listedTotal, 1500)
  })

  test('listedTotal sums exactly the listed rows', () => {
    const u = undrawnCommitments(HOLDINGS_FIXTURE, 'dolares')
    assert.equal(u.listedTotal, u.holdings.reduce((s, h) => s + h.unfunded, 0))
  })

  test('listedTotal is deliberately NOT the position subtotal', () => {
    // The position subtotal counts the over-drawn −50 as well, so the two
    // figures legitimately differ and must never be presented as one.
    const subtotal = HOLDINGS_FIXTURE.filter((h) => h.currency === 'dolares')
      .map((h) => h.unfunded)
      .filter((v): v is number => v !== null)
      .reduce((s, v) => s + v, 0)
    assert.equal(subtotal, 1450)
    assert.notEqual(undrawnCommitments(HOLDINGS_FIXTURE, 'dolares').listedTotal, subtotal)
  })

  test('largest remaining commitment first, then investment, then sociedad', () => {
    const tied = [
      holding({ id: 'a', sociedad: 'ZULU', investmentName: 'Fund B', unfunded: 100 }),
      holding({ id: 'b', sociedad: 'ALPHA', investmentName: 'Fund B', unfunded: 100 }),
      holding({ id: 'c', sociedad: 'ALPHA', investmentName: 'Fund A', unfunded: 100 }),
      holding({ id: 'd', sociedad: 'ALPHA', investmentName: 'Fund A', unfunded: 900 }),
    ]
    assert.deepEqual(undrawnCommitments(tied, 'dolares').holdings.map((h) => h.id), ['d', 'c', 'b', 'a'])
  })

  test('a non-finite unfunded is unavailable, not a listed row', () => {
    const dirty = [holding({ id: 'x', unfunded: Number.NaN })]
    const u = undrawnCommitments(dirty, 'dolares')
    assert.equal(u.holdings.length, 0)
    assert.equal(u.unavailable, 1)
  })

  test('currencies are fenced from one another', () => {
    const eur = undrawnCommitments(HOLDINGS_FIXTURE, 'euros')
    assert.equal(eur.ofHoldings, 1)
    assert.equal(eur.listedTotal, 400)
    assert.equal(eur.holdings.every((h) => h.investmentName === 'Fund E'), true)
    const none = undrawnCommitments(HOLDINGS_FIXTURE, 'pesos')
    assert.equal(none.ofHoldings, 0)
    assert.equal(none.listedTotal, 0)
    assert.deepEqual(none.holdings, [])
  })
})

// ===========================================================================
// 5 · The year filter narrows events only
// ===========================================================================

describe('R13.R4A.1 · year filter', () => {
  test('EMPTY_FILTER carries an unset year', () => {
    // R13.R4A.5 — "unset" is now the EMPTY SET rather than null: every
    // dimension became multi-select, and the empty set is the single spelling
    // of "all". The property under test is unchanged — an unnarrowed filter —
    // only its representation.
    assert.deepEqual(EMPTY_FILTER.year, [])
    assert.equal(EMPTY_FILTER.year.length, 0)
  })

  test('a year narrows events and leaves every holding standing', () => {
    const f = { ...EMPTY_FILTER, year: ['2023'] }
    const events = applyEventFilter(EVENTS_FIXTURE, HOLDINGS_FIXTURE, f)
    assert.equal(events.length, 4)
    assert.equal(events.every((e) => e.eventDate.startsWith('2023')), true)
    // A year in which a fund recorded no movement says nothing about whether
    // the position exists — so holdings are untouched.
    assert.equal(applyHoldingFilter(HOLDINGS_FIXTURE, f).length, HOLDINGS_FIXTURE.length)
  })

  test('it composes with the other dimensions', () => {
    const both = applyEventFilter(EVENTS_FIXTURE, HOLDINGS_FIXTURE, {
      ...EMPTY_FILTER,
      year: ['2023'],
      eventType: ['aporte'],
    })
    assert.equal(both.length, 1)
    assert.equal(both[0].eventDate, '2023-01-31')

    const byCurrency = applyEventFilter(EVENTS_FIXTURE, HOLDINGS_FIXTURE, {
      ...EMPTY_FILTER,
      year: ['2025'],
      currency: ['euros'],
    })
    assert.equal(byCurrency.length, 2)

    const bySociedad = applyEventFilter(EVENTS_FIXTURE, HOLDINGS_FIXTURE, {
      ...EMPTY_FILTER,
      year: ['2023'],
      sociedad: ['DUBAI'],
    })
    assert.equal(bySociedad.length, 3)
  })

  test('a year with no events yields an empty result, not everything', () => {
    const f = { ...EMPTY_FILTER, year: ['2099'] }
    assert.equal(applyEventFilter(EVENTS_FIXTURE, HOLDINGS_FIXTURE, f).length, 0)
  })
})

// ===========================================================================
// 6 · Presentation invariants a restyle must not break
// ===========================================================================

describe('R13.R4A.1 · Dashboard presentation', () => {
  test('every currency card carries its own year selector', () => {
    const src = read(DASHBOARD)
    // R13.R4A.5 — the same shared control, now multi-select.
    assert.match(src, /AlternativesMultiSelect/)
    assert.match(src, /allLabel=\{t\.allYears\}/)
    assert.match(src, /options=\{years\}/)
    // Per card, not per page: the state lives inside the card component.
    assert.match(codeOf(src), /function CurrencyCard[\s\S]*?useState<string \| null>\(null\)/)
  })

  test('the years offered are the source’s own, through the pure module', () => {
    assert.match(read(DASHBOARD), /cashFlowYears\(ownEvents\)/)
    assert.equal(read(DASHBOARD).includes('cashFlowYears(events)'), false)
  })

  test('the current value renders at hero scale', () => {
    assert.match(read(DASHBOARD), /ui-kpi-hero|ui-capsule-value/)
    assert.match(codeOf(read(DASHBOARD)), /function CurrentValueHero/)
  })

  test('commitment drawn is present, emphasised, and opens the undrawn list', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /fundingLabel/)
    assert.match(code, /formatWeightPct\(drawn\.ratio\)/)
    assert.match(code, /undrawnCommitments\(/)
    assert.match(code, /onInspectUndrawn/)
    assert.match(code, /UndrawnCommitmentsModal/)
    // A real button, so it is keyboard-operable — never a hover-only reveal.
    assert.match(code, /<button[\s\S]{0,400}onClick=\{onInspect\}/)
  })

  test('the drawn ratio keeps its population disclosure', () => {
    // R13.R4A.2 replaced the bare `34/38 holdings` with a labelled basis — the
    // disclosure is still required, but it must now say what it counts.
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /fill\(t\.drawnBasis, \{ n: drawn\.holdings, total: drawn\.ofHoldings \}\)/)
  })

  test('a clicked column opens the period drill-down', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /onSelectPeriod/)
    assert.match(code, /periodBreakdown\(/)
    assert.match(code, /PeriodBreakdownModal/)
    assert.match(code, /periodColumns\(/)
  })

  test('the page lays its cards beside recent activity responsively', () => {
    // R13.R4A.3 moved the multi-year block to the Cash Flows view, so the
    // second track beside the currency cards is now the activity feed alone.
    // What this test guards is unchanged: the region composes through
    // breakpoints rather than at one fixed width.
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /recentTitle/)
    assert.match(code, /(sm|md|lg|xl):(grid-)?cols-\d+/)
    assert.match(code, /(sm|md|lg|xl):col-span-\d+/)
  })

  test('one currency order governs the whole page', () => {
    // Every currency block on the page is driven by `positions` in the order
    // the module publishes it — the lead card and the tail stack read off the
    // same list, so the same currencies can never be sequenced two ways on one
    // screen.
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /const \[lead, \.\.\.secondary\] = positions/)
    assert.match(code, /secondary\.map\(\(p\) =>/)
  })

  test('both disclosures still close the page', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /basisNote/)
    assert.match(code, /noRatioNote/)
    assert.match(code, /coverageNote/)
  })
})

describe('R13.R4A.1 · Holdings presentation', () => {
  test('the numeric columns are centred, none left right-aligned', () => {
    const code = codeOf(read(HOLDINGS))
    assert.equal(code.includes('text-right'), false)
    // The two identifier columns stay left; everything else is centred.
    assert.equal((code.match(/text-center/g) ?? []).length >= 10, true)
    assert.equal((code.match(/text-left/g) ?? []).length >= 3, true)
  })

  test('all eleven source columns survive the restyle', () => {
    const code = codeOf(read(HOLDINGS))
    for (const col of [
      'colInvestment', 'colSociedad', 'colCommitted', 'colContributions', 'colUnfunded',
      'colLastStatement', 'colLastValuation', 'colFlowSince', 'colCurrentValue',
      'colReportedIrr', 'colCalculatedIrr',
    ]) {
      assert.match(code, new RegExp(`a\\.${col}\\b`), `${col} missing`)
    }
  })

  test('the band subtotal is distinguished from an ordinary row', () => {
    // Reversed twice, deliberately. R13.R4A.3 took it off SIZE (it was `text-sm`
    // semibold, which out-shouted the category label opening the band) onto
    // rules plus the tinted band. R13.R4A.4 took the tint away too, on owner
    // direction: the category must be the ONLY row type that reads as
    // highlighted, so the subtotal is now structure alone — rules above and
    // below, at row scale. Still unmistakably a closing line.
    const code = codeOf(read(HOLDINGS))
    const row = /<tr className="[^"]*border-t[^"]*border-border-strong[^"]*"/.exec(code)
    assert.ok(row, 'subtotal row keeps its strong top rule')
    assert.match(row[0], /border-b-2/)
    assert.equal(/bg-surface-2/.test(row[0]), false, 'no tint competes with the category')
  })

  test('the subtotal still discloses partiality and names its currency', () => {
    const code = codeOf(read(HOLDINGS))
    assert.match(code, /subtotalPartialNote/)
    assert.match(code, /currencyLabel\(group\.currency\)/)
  })
})

describe('R13.R4A.1 · Cash Flows presentation', () => {
  // R13.R4A.4 reversed this deliberately: the ledger carries no year filter at
  // all now, so what has to hold is that it reads EVERY recorded year. The
  // full contract is asserted in the R13.R4A.4 section below.
  test('the ledger reads every recorded year, with no year control', () => {
    assert.equal(/showYear/.test(read(CASHFLOWS)), false)
    assert.equal(/options=\{options\.years\}/.test(read(FILTERS)), false)
    assert.match(codeOf(read(CASHFLOWS)), /\{ \.\.\.filter, year: \[\] \}/)
  })

  test('the year control is a real labelled control, not a bespoke dropdown', () => {
    // R13.R4A.5 — the control became a popover checklist, so the native
    // <select> this once pinned is gone. What it was PROTECTING is not: the
    // control must still be a real, named, keyboard-operable one. Asserted
    // here against the platform elements the popover is built from, which is a
    // stronger claim than the old three lines made.
    const code = codeOf(read(FILTERS))
    // Every option is a real checkbox — Tab reaches it, Space toggles it, and
    // a screen reader announces its state without any of it re-implemented.
    assert.match(code, /<input\s+type="checkbox"/)
    // The trigger is a disclosure with an accessible name built from the
    // visible field label plus the current summary.
    assert.match(code, /aria-haspopup="true"/)
    assert.match(code, /aria-expanded=\{open\}/)
    assert.match(code, /aria-labelledby=\{`\$\{id\}-label \$\{id\}-summary`\}/)
    // The panel is a named group, not an anonymous div of controls.
    assert.match(code, /role="group"/)
    // Escape closes it and hands focus back.
    assert.match(code, /e\.key === 'Escape'/)
    assert.match(code, /trigger\(\)\?\.focus\(\)/)
  })

  test('the per-currency section heading is set above the row scale', () => {
    const code = codeOf(read(CASHFLOWS))
    const heading = /<span className="[^"]*"[^>]*>\s*\{currencyLabel\(c\.currency\)\}/.exec(code)
    assert.ok(heading, 'the currency heading is still rendered')
    assert.match(heading[0], /ui-capsule-value|ui-card-value|text-base|text-lg|ui-kpi-hero/)
  })

  test('currency fencing and the unclassified callout are untouched', () => {
    const code = codeOf(read(CASHFLOWS))
    assert.match(code, /currencyCashFlows\(visibleEvents\)/)
    assert.match(code, /role="status"/)
    assert.match(code, /unclassifiedTitle/)
    assert.match(code, /signNote/)
  })
})

// ===========================================================================
// 7 · Chart and drill-down contracts
// ===========================================================================

describe('R13.R4A.1 · chart and drill-down contracts', () => {
  test('the chart is driven by period columns and reports a click', () => {
    const code = codeOf(read(CHART))
    assert.match(code, /columns: readonly PeriodColumn\[\]/)
    assert.match(code, /onSelectPeriod\?: \(period: string\) => void/)
  })

  test('a column with nothing recorded cannot be opened', () => {
    const code = codeOf(read(CHART))
    assert.match(code, /const clickable = c\.hasEvents && onSelectPeriod !== undefined/)
    assert.match(code, /disabled=\{!clickable\}/)
  })

  test('the tooltip is compact and says so when nothing moved', () => {
    const code = codeOf(read(CHART))
    assert.match(code, /ChartTooltip/)
    assert.match(code, /compact="unit"/)
    assert.match(code, /noMovementRecorded/)
    // Hover AND focus, so a keyboard reader gets the same information.
    assert.match(code, /onMouseEnter=/)
    assert.match(code, /onFocus=/)
  })

  test('the chart keeps its accessible text alternative', () => {
    assert.match(codeOf(read(CHART)), /className="sr-only"/)
  })

  test('the drill-downs render full amounts through the guarded path', () => {
    const code = codeOf(read(DRILLDOWNS))
    assert.match(code, /ModalShell/)
    assert.match(code, /MaskedAmount/)
    // Full length inside a drill-down; the compact form belongs on the axis.
    assert.equal(code.includes('compact'), false)
    assert.match(code, /TableSourceFooter/)
  })

  test('the undrawn dialog names all three categories and its source', () => {
    const code = codeOf(read(DRILLDOWNS))
    assert.match(code, /undrawnWithLabel/)
    assert.match(code, /undrawnFullyDrawnLabel/)
    assert.match(code, /undrawnUnreportedLabel/)
    assert.match(code, /undrawnPopulationLabel/)
    assert.match(code, /undrawnSourceNote/)
    assert.match(code, /undrawnListedTotal/)
  })

  test('every drill-down amount is masked and every table header is scoped', () => {
    const code = codeOf(read(DRILLDOWNS))
    assert.equal((code.match(/scope="col"/g) ?? []).length >= 10, true)
    // No amount is ever formatted outside MaskedAmount.
    assert.equal(/formatUsd\(/.test(code), false)
  })
})

// ===========================================================================
// 8 · Tokens, responsiveness, and the standing prohibitions
// ===========================================================================

describe('R13.R4A.1 · tokens and responsiveness', () => {
  test('no raw hex and no Tailwind colour scale anywhere in the touched surface', () => {
    for (const file of R4A1_FILES) {
      const code = codeOf(read(file))
      assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(code), false, `${file} carries a raw hex`)
      assert.equal(
        /\b(bg|text|border|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(code),
        false,
        `${file} carries a Tailwind colour scale`,
      )
    }
  })

  test('event colours only ever arrive through the shared helper', () => {
    for (const file of [DASHBOARD, CHART, DRILLDOWNS]) {
      const code = codeOf(read(file))
      if (code.includes('--alt-event')) {
        assert.match(code, /altEventColorVar|altEventChipStyle/, `${file} reads a token directly`)
      }
    }
  })

  test('every view composes responsively and no table drops its own scroller', () => {
    // Each view narrows by the mechanism its content needs, and must carry at
    // least one: a multi-region page flows through breakpoints, while a page
    // that is one dense table narrows by scrolling INSIDE its card. What must
    // never happen is a view with neither, which is what scrolls the page.
    for (const file of [DASHBOARD, HOLDINGS, CASHFLOWS]) {
      const code = codeOf(read(file))
      assert.equal(
        /(sm|md|lg|xl):/.test(code) || /minWidth=\{\d+\}/.test(code),
        true,
        `${file} neither reflows nor scrolls in-card`,
      )
    }
    assert.match(codeOf(read(DASHBOARD)), /(sm|md|lg|xl):(grid-)?cols-\d+/)
    assert.match(codeOf(read(HOLDINGS)), /minWidth=\{\d+\}/)
    assert.match(codeOf(read(CASHFLOWS)), /minWidth=\{\d+\}/)
    assert.match(codeOf(read(CHART)), /overflow-x-auto/)
    assert.match(codeOf(read(DRILLDOWNS)), /overflow-x-auto/)
  })

  test('no unsupported LP ratio is computed anywhere in the module', () => {
    for (const file of [...R4A1_FILES, VIEW]) {
      const code = codeOf(read(file))
      assert.equal(/\b(DPI|TVPI|RVPI|MOIC)\b/.test(code), false, `${file} names an unsupported ratio`)
      assert.equal(/\bxirr\b|\birrSolve\b|\bnewtonRaphson\b/i.test(code), false, `${file} solves an IRR`)
    }
  })

  test('no cross-currency total and no FX rate is introduced', () => {
    for (const file of [...R4A1_FILES, VIEW]) {
      const code = codeOf(read(file))
      assert.equal(
        /grandTotal|portfolioTotal|combinedTotal|allCurrenciesTotal|crossCurrency(Sum|Total)/.test(code),
        false,
        `${file} builds a grand total`,
      )
      assert.equal(/exchangeRate|fxRate|convertCurrency|toUsd\(/.test(code), false, `${file} converts a currency`)
    }
  })

  test('no view reaches past the API for its data', () => {
    for (const file of [DASHBOARD, HOLDINGS, CASHFLOWS, DRILLDOWNS, CHART]) {
      const code = codeOf(read(file))
      assert.equal(/supabase|Repository|createClient/i.test(code), false, `${file} touches the data layer`)
    }
  })

  test('no wall clock decides what a member sees', () => {
    for (const file of [...R4A1_FILES, VIEW]) {
      const code = codeOf(read(file))
      assert.equal(/new Date\(\)|Date\.now\(\)/.test(code), false, `${file} reads the clock`)
    }
  })
})

// ===========================================================================
// 9 · Vocabulary
// ===========================================================================

describe('R13.R4A.1 · i18n', () => {
  const NEW_KEYS = [
    'filterYear', 'allYears', 'monthlyTitle', 'annualFlowTitle', 'chartClickHint',
    'noFlowInPeriod', 'noMovementRecorded', 'periodCallsLabel', 'periodDistLabel',
    'breakdownTitle', 'breakdownEmpty', 'breakdownCount',
    'undrawnTitle', 'undrawnOpen', 'undrawnEmpty', 'undrawnListedTotal',
    'undrawnCount', 'undrawnSourceNote',
    // R13.R4A.2 — the three categories, each named for what it counts.
    'undrawnWithLabel', 'undrawnFullyDrawnLabel', 'undrawnUnreportedLabel',
    'undrawnPopulationLabel', 'undrawnUnreportedNote',
    'drawnBasis', 'drawnBasisTitle', 'drawnBasisNote',
  ] as const

  test('every new key exists in both languages and neither is blank', () => {
    for (const key of NEW_KEYS) {
      const en = (dict.en.fp.alternatives as Record<string, string>)[key]
      const es = (dict.es.fp.alternatives as Record<string, string>)[key]
      assert.equal(typeof en, 'string', `en.${key} missing`)
      assert.equal(typeof es, 'string', `es.${key} missing`)
      assert.equal(en.trim().length > 0, true, `en.${key} blank`)
      assert.equal(es.trim().length > 0, true, `es.${key} blank`)
    }
  })

  test('the two dictionaries stay structurally identical', () => {
    assert.deepEqual(
      Object.keys(dict.en.fp.alternatives).sort(),
      Object.keys(dict.es.fp.alternatives).sort(),
    )
  })

  test('placeholders match between the languages', () => {
    for (const key of ['breakdownCount', 'undrawnCount', 'drawnBasis'] as const) {
      const of = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
      assert.deepEqual(
        of((dict.en.fp.alternatives as Record<string, string>)[key]),
        of((dict.es.fp.alternatives as Record<string, string>)[key]),
        `${key} placeholders differ`,
      )
    }
  })

  test('the undrawn note names the source column rather than a derivation', () => {
    assert.match(dict.en.fp.alternatives.undrawnSourceNote, /Unfunded/)
    assert.match(dict.en.fp.alternatives.undrawnSourceNote, /never derived/i)
    assert.match(dict.es.fp.alternatives.undrawnSourceNote, /Unfunded/)
  })

  test('an unfiltered surface never blames a filter for an absent figure', () => {
    // The Dashboard applies no filter, so its empty states must state the
    // real cause — the source records nothing — not a selection that is not there.
    const code = codeOf(read(DASHBOARD))
    assert.equal(/timelineEmpty|cashFlowsEmpty/.test(code), false)
    assert.match(code, /noRecordedEvents|noFlowInPeriod/)
    assert.match(dict.en.fp.alternatives.noFlowInPeriod, /source/i)
    assert.match(dict.en.fp.alternatives.noRecordedEvents, /source/i)
  })

  test('no view-visible string is hardcoded in place of the dictionary', () => {
    for (const file of R4A1_FILES) {
      const code = codeOf(read(file))
      // A bare sentence inside JSX text would show up as a >3-word run between
      // tags; every label in these files must come from `a.`/`t.`.
      const stray = code.match(/>\s*[A-Z][a-z]+(?: [a-z]+){3,}[.?]?\s*</g) ?? []
      assert.deepEqual(stray, [], `${file} hardcodes ${stray[0]}`)
    }
  })
})

// ===========================================================================
// 10 · Nothing outside this pass moved
// ===========================================================================

describe('R13.R4A.1 · boundaries', () => {
  test('the API contract is unchanged — no new field, no new query parameter', () => {
    const route = read('src/app/api/family-portfolio/alternatives/route.ts')
    assert.equal(/periodColumns|undrawnCommitments|cashFlowYears|periodBreakdown/.test(route), false)
    assert.equal(/searchParams|nextUrl\.search/.test(route), false)
  })

  test('the authorization ladder is intact', () => {
    const route = read('src/app/api/family-portfolio/alternatives/route.ts')
    assert.match(route, /guardPrivateApi/)
    assert.match(route, /canReadScope/)
    assert.match(route, /listCurrentPublications/)
  })

  test('every view is protected by the default-deny allowlist', async () => {
    const { requiresApprovedSession, classifyPath } = await import('../src/lib/auth/accessPolicy.ts')
    for (const path of [
      '/family-portfolio/alternatives',
      '/family-portfolio/alternatives/holdings',
      '/family-portfolio/alternatives/cash-flows',
    ]) {
      assert.equal(requiresApprovedSession(path), true, `${path} is not gated`)
      assert.equal(classifyPath(path), 'private_page', `${path} is not a private page`)
    }
  })

  test('no migration and no schema change came with this pass', () => {
    for (const file of [...R4A1_FILES, VIEW]) {
      const code = codeOf(read(file))
      assert.equal(/create table|alter table|drop table/i.test(code), false, `${file} carries DDL`)
    }
  })

  test('the currency vocabulary is unchanged', () => {
    assert.equal(currencyLabel('dolares'), 'USD')
    assert.equal(currencyLabel('euros'), 'EUR')
    assert.equal(currencyLabel('uf'), 'UF')
    assert.equal(currencyLabel('pesos'), 'CLP')
  })
})

// ===========================================================================
// 11 · R13.R4A.2 — commitment-drawn semantic clarity
// ===========================================================================
//
// The owner read "84,7% · 34/38 holdings" as thirty-four holdings drawn and
// four undrawn. It is not: it is how many holdings the PERCENTAGE was computed
// from. The tests below pin the two things that let that happen — an unlabelled
// basis count, and a three-way partition that was only ever summarised — and
// pin the fact that the two figures come from different columns over
// measurably different rows, which is why neither may borrow the other's words.

describe('R13.R4A.2 · commitment-drawn basis is labelled, never a category count', () => {
  test('the ratio counts holdings it was COMPUTED FROM, not holdings that are drawn', () => {
    // h1 and h2 report both operands; h3 reports neither; h4 and h5 report a
    // commitment but no contribution. So the ratio is computed from 2 of 5 —
    // and NONE of that says how many of the five are drawn.
    const rows = [
      holding({ id: 'h1', capitalCommitted: 1000, contributions: 400, unfunded: 600 }),
      holding({ id: 'h2', capitalCommitted: 1000, contributions: 600, unfunded: 400 }),
      holding({ id: 'h3', capitalCommitted: null, contributions: null, unfunded: 100 }),
      holding({ id: 'h4', capitalCommitted: 500, contributions: null, unfunded: 0 }),
      holding({ id: 'h5', capitalCommitted: 500, contributions: null, unfunded: null }),
    ]
    const drawn = commitmentDrawn(rows, 'dolares')
    assert.ok(drawn)
    // The figure is exactly "rows carrying both operands" — asserted against
    // the predicate itself, not against a memorised number.
    const withBothOperands = rows.filter(
      (h) => h.capitalCommitted !== null && h.contributions !== null,
    )
    assert.equal(drawn.holdings, withBothOperands.length)
    assert.equal(drawn.holdings, 2)
    assert.equal(drawn.ofHoldings, rows.length)
    assert.equal(drawn.ratio, 1000 / 2000)

    // And it is NOT any of the three categories of the undrawn partition —
    // asserted on the SETS, because two unrelated counts can coincide by luck
    // and a test that leans on that would pass for the wrong reason.
    const u = undrawnCommitments(rows, 'dolares')
    assert.equal(u.holdings.length, 3)
    assert.equal(u.fullyDrawn, 1)
    assert.equal(u.unavailable, 1)

    const ratioBasis = new Set(withBothOperands.map((h) => h.id))
    const undrawnRows = new Set(u.holdings.map((h) => h.id))
    const unreportedRows = new Set(u.unreported.map((h) => h.id))
    // h3 has no operands yet a positive unfunded: it is undrawn but outside the
    // ratio. h1/h2 are inside the ratio and also undrawn. So neither set
    // contains the other — they answer different questions.
    assert.equal([...ratioBasis].every((id) => undrawnRows.has(id)), true)
    assert.equal([...undrawnRows].every((id) => ratioBasis.has(id)), false)
    assert.equal([...ratioBasis].some((id) => unreportedRows.has(id)), false)
  })

  test('the two exclusion sets are different rows, not just different sizes', () => {
    // h4 is excluded from the ratio (no contribution) but HAS an unfunded
    // figure; h6 is in the ratio but has NO unfunded figure. Neither exclusion
    // predicts the other — the real workbook shows the same shape.
    const rows = [
      holding({ id: 'h1', capitalCommitted: 1000, contributions: 400, unfunded: 600 }),
      holding({ id: 'h4', capitalCommitted: 500, contributions: null, unfunded: 250 }),
      holding({ id: 'h6', capitalCommitted: 800, contributions: 300, unfunded: null }),
    ]
    const drawn = commitmentDrawn(rows, 'dolares')
    const u = undrawnCommitments(rows, 'dolares')
    assert.equal(drawn?.holdings, 2)
    assert.equal(u.unavailable, 1)
    // Same count of excluded rows, different rows.
    assert.equal(drawn!.ofHoldings - drawn!.holdings, u.unavailable)
    assert.deepEqual(u.unreported.map((h) => h.id), ['h6'])
  })

  test('the dashboard labels the basis and never prints a bare ratio of counts', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /drawnBasis/)
    assert.match(code, /title=\{t\.drawnBasisTitle\}/)
    // The pre-R4A.2 form — two counts and the bare word "holdings" — is gone.
    assert.equal(/\{drawn\.holdings\}\/\{drawn\.ofHoldings\}/.test(code), false)
    assert.equal(/drawn\.holdings\}[^}]*\{t\.holdingsWord/.test(code), false)
  })

  test('the basis wording says what it is a count of, in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const s = (dict[lang].fp.alternatives as Record<string, string>)
      assert.match(s.drawnBasis, /\{n\}/)
      assert.match(s.drawnBasis, /\{total\}/)
      // It must carry a verb of CALCULATION, so the count reads as a basis.
      assert.match(s.drawnBasis, lang === 'en' ? /Calculated from/i : /Calculado sobre/i)
      // And it must not read as a category of holdings.
      assert.equal(/\bdrawn holdings\b|\bposiciones desembolsadas\b/i.test(s.drawnBasis), false)
      assert.match(s.drawnBasisTitle, /not a count|No es un conteo/i)
    }
  })
})

describe('R13.R4A.2 · the three categories partition the population', () => {
  test('they are mutually exclusive and cover every holding in the currency', () => {
    const u = undrawnCommitments(HOLDINGS_FIXTURE, 'dolares')
    const listed = new Set(u.holdings.map((h) => h.id))
    const unreported = new Set(u.unreported.map((h) => h.id))
    // No row can be in two categories.
    for (const id of listed) assert.equal(unreported.has(id), false, `${id} is in two categories`)
    // And the three counts cover the whole population exactly.
    assert.equal(u.holdings.length + u.fullyDrawn + u.unavailable, u.ofHoldings)
    assert.equal(
      u.ofHoldings,
      HOLDINGS_FIXTURE.filter((h) => h.currency === 'dolares').length,
    )
  })

  test('the partition holds for every currency, including empty ones', () => {
    for (const currency of ['dolares', 'euros', 'pesos', 'unknown-token']) {
      const u = undrawnCommitments(HOLDINGS_FIXTURE, currency)
      assert.equal(
        u.holdings.length + u.fullyDrawn + u.unavailable,
        u.ofHoldings,
        `${currency} does not reconcile`,
      )
      assert.equal(u.unavailable, u.unreported.length, `${currency} count and list disagree`)
    }
  })

  test('every category is decided by the source’s own unfunded column alone', () => {
    const rows = HOLDINGS_FIXTURE.filter((h) => h.currency === 'dolares')
    const u = undrawnCommitments(HOLDINGS_FIXTURE, 'dolares')
    for (const h of rows) {
      const listed = u.holdings.some((x) => x.id === h.id)
      const unreported = u.unreported.some((x) => x.id === h.id)
      if (h.unfunded === null || !Number.isFinite(h.unfunded)) {
        assert.equal(unreported, true, `${h.id} has no figure but is not unreported`)
        assert.equal(listed, false)
      } else if (h.unfunded > 0) {
        assert.equal(listed, true, `${h.id} has a positive figure but is not listed`)
        assert.equal(unreported, false)
      } else {
        assert.equal(listed, false, `${h.id} is not positive but is listed`)
        assert.equal(unreported, false, `${h.id} has a figure but is called unreported`)
      }
    }
  })

  test('an unreported row carries NO unfunded field at all', () => {
    const u = undrawnCommitments(HOLDINGS_FIXTURE, 'dolares')
    assert.equal(u.unreported.length, 1)
    // Not null, not zero — absent, so nothing downstream can read a number.
    assert.equal('unfunded' in u.unreported[0], false)
    assert.equal(u.unreported[0].id, 'h5')
  })

  test('an unreported amount is never derived from commitments minus contributions', () => {
    // h5 reports committed 1000 and contributions 400 — a derivation would have
    // produced exactly 600, and would have put the row in the listed category.
    const u = undrawnCommitments(HOLDINGS_FIXTURE, 'dolares')
    assert.equal(u.holdings.some((h) => h.id === 'h5'), false)
    assert.equal(u.listedTotal, 1500)
    assert.notEqual(u.listedTotal, 2100)

    // The worse case: a derivation of exactly zero would have read as FULLY
    // DRAWN — a positive claim the source never made.
    const wouldBeZero = [
      holding({ id: 'z', capitalCommitted: 500, contributions: 500, unfunded: null }),
    ]
    const z = undrawnCommitments(wouldBeZero, 'dolares')
    assert.equal(z.fullyDrawn, 0)
    assert.equal(z.unavailable, 1)
  })

  test('unreported rows are ordered by identity, never by an invented amount', () => {
    const rows = [
      holding({ id: 'b', investmentName: 'Fund B', sociedad: 'ALPHA', unfunded: null }),
      holding({ id: 'c', investmentName: 'Fund A', sociedad: 'ZULU', unfunded: null }),
      holding({ id: 'a', investmentName: 'Fund A', sociedad: 'ALPHA', unfunded: null }),
    ]
    assert.deepEqual(undrawnCommitments(rows, 'dolares').unreported.map((h) => h.id), ['a', 'c', 'b'])
  })
})

describe('R13.R4A.2 · the modal shows the partition and the reported amounts', () => {
  test('every listed amount is the workbook’s own reported unfunded value', () => {
    const u = undrawnCommitments(HOLDINGS_FIXTURE, 'dolares')
    const byId = new Map(HOLDINGS_FIXTURE.map((h) => [h.id, h]))
    for (const row of u.holdings) {
      assert.equal(row.unfunded, byId.get(row.id)?.unfunded, `${row.id} amount was altered`)
      assert.equal(row.capitalCommitted, byId.get(row.id)?.capitalCommitted ?? null)
      assert.equal(row.contributions, byId.get(row.id)?.contributions ?? null)
    }
    assert.equal(u.listedTotal, u.holdings.reduce((s, h) => s + h.unfunded, 0))
  })

  test('the dialog renders all three counts and the population from the module', () => {
    const code = codeOf(read(DRILLDOWNS))
    assert.match(code, /\{undrawn\.holdings\.length\}/)
    assert.match(code, /\{undrawn\.fullyDrawn\}/)
    assert.match(code, /\{undrawn\.unavailable\}/)
    assert.match(code, /\{undrawn\.ofHoldings\}/)
    // Nothing is hardcoded — no bare category count anywhere in the file.
    assert.equal(/>\s*(21|11|38)\s*</.test(code), false)
  })

  test('the unreported rows are listed, not just counted', () => {
    const code = codeOf(read(DRILLDOWNS))
    assert.match(code, /undrawn\.unreported\.map/)
    assert.match(code, /undrawnUnreportedNote/)
    // Their unfunded cell is a real null, so it can never render as a zero.
    assert.match(code, /<MaskedAmount value=\{null\}/)
  })

  test('the dialog states that it and the percentage use different bases', () => {
    assert.match(codeOf(read(DRILLDOWNS)), /drawnBasisNote/)
    for (const lang of ['en', 'es'] as const) {
      const s = dict[lang].fp.alternatives as Record<string, string>
      assert.match(s.drawnBasisNote, lang === 'en' ? /different columns/i : /columnas distintas/i)
      assert.match(s.undrawnUnreportedNote, lang === 'en' ? /Neither drawn nor undrawn/i : /Ni desembolsadas ni por desembolsar/i)
    }
  })

  test('no category is ever described with the other’s word', () => {
    const s = dict.en.fp.alternatives as Record<string, string>
    // The unreported label must not claim either state.
    assert.equal(/\bdrawn\b/i.test(s.undrawnUnreportedLabel), false)
    assert.equal(/\bundrawn\b/i.test(s.undrawnUnreportedLabel), false)
    // And the population label must not either.
    assert.equal(/\bdrawn\b/i.test(s.undrawnPopulationLabel), false)
  })
})

// ===========================================================================
// 12 · R13.R4A.3 — header simplification, dashboard recomposition, the
//      fixed-capacity feed, the reordered dialog, and the relocated by-year
//      block
// ===========================================================================
//
// The owner's brief here was layout, but three of the six items carry a
// contract underneath the pixels: a feed that never scrolls is a feed whose
// CAPACITY is fixed and whose oldest rows roll off; a block that moves between
// two pages must arrive reading the same events its new neighbours read; and a
// dialog that leads with what it could not assess must keep leading with it.
// Those are what the tests below pin. Weights, gaps and column spans are left
// free — a later visual pass must be able to move them without failing.

describe('R13.R4A.3 · the header says the module name once', () => {
  test('the as-of label no longer repeats the page title', () => {
    // It read "Alternatives as of" beside a title reading "Alternatives",
    // under a rail whose active pill also reads "Alternatives".
    assert.equal(/alternatives/i.test(dict.en.fp.alternatives.asOfLabel), false)
    assert.equal(/alternativos/i.test(dict.es.fp.alternatives.asOfLabel), false)
    // Still a real as-of label, not an empty string.
    assert.match(dict.en.fp.alternatives.asOfLabel, /as of/i)
    assert.equal(dict.es.fp.alternatives.asOfLabel.trim().length > 0, true)
  })

  test('the header carries the title and the date, and no module eyebrow', () => {
    const code = codeOf(read(LAYOUT))
    assert.match(code, /<PageHeader/)
    assert.match(code, /title=\{a\.title\}/)
    assert.match(code, /a\.asOfLabel/)
    assert.match(code, /formatIsoDateLabel\(asOfDate\)/)
    // The eyebrow duplicated the module rail sitting directly above it.
    assert.equal(/eyebrow=/.test(code), false)
  })

  test('the date is the emphasised half of the pair', () => {
    // The label is the quiet part; the DATE is the fact, so it carries the
    // weight and the full-contrast token rather than the muted meta tone.
    const code = codeOf(read(LAYOUT))
    const stamp = /<span className="([^"]*)"[^>]*>\s*\{formatIsoDateLabel\(asOfDate\)\}/.exec(code)
    assert.ok(stamp, 'the as-of date is still rendered in its own span')
    assert.match(stamp[1], /font-semibold|font-bold|ui-capsule-value|ui-card-value/)
    assert.match(stamp[1], /text-foreground/)
  })

  test('the module still states its OWN as-of, never the portfolio’s', () => {
    const code = codeOf(read(LAYOUT))
    assert.match(code, /data\?\.publication\?\.asOfDate/)
    assert.equal(/weekly|portfolio\?\./i.test(code), false)
  })
})

describe('R13.R4A.3 · the Dashboard composes around a lead currency', () => {
  test('the lead is read off the data — no currency is named in code', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /const \[lead, \.\.\.secondary\] = positions/)
    // Neither a display code nor a source token may decide the layout.
    assert.equal(
      /'(USD|CLP|EUR|UF|dolares|euros|pesos|unidades de fomento)'/i.test(code),
      false,
      'a currency literal reached the Dashboard',
    )
  })

  test('a card is laid out by an explicit placement, not by its index', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /layout: 'lead' \| 'secondary'/)
    assert.match(code, /layout="lead"/)
    assert.match(code, /layout="secondary"/)
  })

  test('both placements render the SAME regions from the same functions', () => {
    // The regions are composed once and placed twice; two literal copies would
    // be two chances for one currency to drift from its neighbours.
    const code = codeOf(read(DASHBOARD))
    for (const region of ['positionRegion', 'flowRegion', 'chartRegion']) {
      assert.match(code, new RegExp(`const ${region} =`), `${region} missing`)
    }
    assert.equal((code.match(/const positionRegion =/g) ?? []).length, 1)
    // Every card still gets its own selector, its own columns and its own
    // drill-downs — the placement changed, the contract did not.
    assert.match(code, /cashFlowYears\(ownEvents\)/)
    assert.match(code, /periodColumns\(ownEvents, position\.currency, selectedYears\)/)
    assert.match(code, /undrawnCommitments\(holdings, position\.currency\)/)
  })

  test('the secondary currencies share their row with the feed responsively', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /secondary\.length > 0/)
    assert.match(code, /xl:grid-cols-12/)
    assert.match(code, /xl:col-span-\d+/)
    // A one-currency book has no tail, so the feed must not be left beside an
    // empty track.
    assert.match(code, /\) : \(\s*(\/\/[^\n]*\n\s*)*activity\s*\)/)
  })

  test('the relocated by-year block is gone from the Dashboard', () => {
    const code = codeOf(read(DASHBOARD))
    assert.equal(/annualTitle/.test(code), false)
    assert.equal(/annualCashFlows|annualOrdered/.test(code), false)
  })

  test('both closing disclosures survive the recomposition', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /basisNote/)
    assert.match(code, /noRatioNote/)
    assert.match(code, /coverageNote/)
  })
})

describe('R13.R4A.3 · recent activity is a fixed-capacity rolling feed', () => {
  test('the newest movements fill the capacity and the rest roll off', () => {
    const cap = 3
    const before = recentEvents(EVENTS_FIXTURE, HOLDINGS_FIXTURE, cap)
    assert.equal(before.length, cap)

    // A newer publication enters at the top; the count does not move.
    const later = [...EVENTS_FIXTURE, event({ holdingId: 'h1', eventDate: '2027-01-31', amount: -5 })]
    const after = recentEvents(later, HOLDINGS_FIXTURE, cap)
    assert.equal(after.length, cap, 'capacity changed when the source grew')
    assert.equal(after[0].eventDate, '2027-01-31')
    // …and the oldest of the three visible rows is the one that left.
    assert.equal(after.includes(before[before.length - 1]), false)
  })

  test('a short book renders short — capacity is never padded', () => {
    const few = recentEvents(EVENTS_FIXTURE.slice(0, 2), HOLDINGS_FIXTURE, 20)
    assert.equal(few.length, 2)
  })

  test('the feed is ordered newest first across every currency', () => {
    const all = recentEvents(EVENTS_FIXTURE, HOLDINGS_FIXTURE, 50)
    for (let i = 1; i < all.length; i += 1) {
      assert.equal(all[i - 1].eventDate >= all[i].eventDate, true, 'feed is out of order')
    }
    // Both currencies in the fixture reach it — this is a book-wide feed, not
    // a view of the currencies it happens to sit beside.
    assert.equal(new Set(all.map((e) => e.currency)).size > 1, true)
  })

  test('the panel never scrolls: its capacity IS its height', () => {
    const code = codeOf(read(DASHBOARD))
    const card = /function RecentActivityCard[\s\S]*?\n}/.exec(code)
    assert.ok(card, 'the feed is its own component')
    assert.equal(/maxHeight/.test(card[0]), false, 'the feed grew a height cap')
    assert.equal(/overflow-y|overflow-auto|overflow-scroll/.test(card[0]), false)
    // A fixed capacity, stated once, passed to the pure function.
    assert.match(code, /const RECENT_LIMIT = \d+/)
    assert.match(code, /recentEvents\(events, holdings, RECENT_LIMIT\)/)
  })

  test('the feed says it covers every currency, and shows each row’s own', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /recentAllCurrencies/)
    assert.match(code, /currencyLabel\(e\.currency\)/)
    for (const lang of ['en', 'es'] as const) {
      const s = (dict[lang].fp.alternatives as Record<string, string>).recentAllCurrencies
      assert.equal(typeof s === 'string' && s.trim().length > 0, true, `${lang} missing`)
    }
  })
})

describe('R13.R4A.3 · the undrawn dialog leads with what it could not assess', () => {
  test('“unfunded not reported” comes first in the summary strip', () => {
    const code = codeOf(read(DRILLDOWNS))
    const strip = /<dl className="flex flex-wrap items-baseline[\s\S]*?<\/dl>/.exec(code)
    assert.ok(strip, 'the reconciling strip is still rendered')
    const at = (k: string) => strip[0].indexOf(k)
    assert.equal(at('undrawnUnreportedLabel') > -1, true)
    assert.equal(
      at('undrawnUnreportedLabel') < at('undrawnWithLabel'),
      true,
      'the unreported count no longer leads the strip',
    )
    assert.equal(at('undrawnUnreportedLabel') < at('undrawnFullyDrawnLabel'), true)
    // The population still closes the line — it is what the three add to.
    assert.equal(at('undrawnPopulationLabel') > at('undrawnFullyDrawnLabel'), true)
  })

  test('the unreported rows are listed before the undrawn commitments', () => {
    const code = codeOf(read(DRILLDOWNS))
    assert.equal(
      code.indexOf('undrawn.unreported.map') < code.indexOf('undrawn.holdings.map'),
      true,
      'the caveat still trails the finding it qualifies',
    )
    // And each population keeps its own heading, so neither reads as a
    // continuation of the other.
    const headings = code.match(/<h3 className="ui-label[^"]*"[^>]*>\s*\{a\.(\w+)\}/g) ?? []
    assert.equal(headings.length >= 2, true, 'the two sections are not both headed')
  })

  test('the dialog states BOTH bases with their own figures in the sentence', () => {
    const code = codeOf(read(DRILLDOWNS))
    assert.match(code, /fill\(a\.drawnBasisNote, \{[\s\S]*?drawn: drawn\.holdings/)
    assert.match(code, /total: drawn\.ofHoldings/)
    assert.match(code, /unreported: undrawn\.unavailable/)
    // Rendered only when the ratio exists — never an invented basis.
    assert.match(code, /drawn !== null &&/)
  })

  test('the note carries all three placeholders in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const s = (dict[lang].fp.alternatives as Record<string, string>).drawnBasisNote
      for (const p of ['{drawn}', '{total}', '{unreported}']) {
        assert.equal(s.includes(p), true, `${lang}.drawnBasisNote is missing ${p}`)
      }
    }
    const of = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
    assert.deepEqual(of(dict.en.fp.alternatives.drawnBasisNote), of(dict.es.fp.alternatives.drawnBasisNote))
  })

  test('the counts it prints still come from the module, never a literal', () => {
    const code = codeOf(read(DRILLDOWNS))
    assert.match(code, /\{undrawn\.unavailable\}/)
    assert.match(code, /\{undrawn\.holdings\.length\}/)
    assert.match(code, /\{undrawn\.fullyDrawn\}/)
    assert.match(code, /\{undrawn\.ofHoldings\}/)
    assert.equal(/>\s*(21|11|38|34|6)\s*</.test(code), false, 'a count is hardcoded')
  })

  test('reordering changed nothing about the partition itself', () => {
    // The categories are still decided by the source's own column, still
    // mutually exclusive, and still reconcile — the dialog reordered, the
    // calculation did not.
    const u = undrawnCommitments(HOLDINGS_FIXTURE, 'dolares')
    assert.equal(u.holdings.length + u.fullyDrawn + u.unavailable, u.ofHoldings)
    assert.equal(u.unavailable, u.unreported.length)
    assert.equal('unfunded' in u.unreported[0], false)
  })
})

describe('R13.R4A.3 · cash flow by year moved to the Cash Flows view', () => {
  test('it renders there, between the subtotals and the ledger', () => {
    const code = codeOf(read(CASHFLOWS))
    assert.match(code, /a\.annualTitle/)
    assert.match(code, /AlternativesCashFlowChart/)
    // Order on the page: tiles → by-year → ledger.
    assert.equal(code.indexOf('currencyCashFlows(visibleEvents)') < code.indexOf('a.annualTitle'), true)
    assert.equal(code.indexOf('a.annualTitle') < code.indexOf('a.cashFlowsTitle'), true)
  })

  test('it reads the SAME filtered events as the tiles and the ledger', () => {
    // A chart drawn from the whole publication beside tiles drawn from a
    // narrowed one would be two answers to one question on one screen.
    const code = codeOf(read(CASHFLOWS))
    assert.match(code, /periodColumns\(visibleEvents, c\.currency, \[\]\)/)
    assert.equal(/periodColumns\(events,/.test(code), false)
    assert.match(code, /periodBreakdown\(visibleEvents, holdings,/)
  })

  test('its drill-down is the same dialog the Dashboard opens', () => {
    const code = codeOf(read(CASHFLOWS))
    assert.match(code, /PeriodBreakdownModal/)
    assert.match(code, /onSelectPeriod=\{\(period\) => setDrilldown\(/)
  })

  test('it keeps the currency fence and both flow disclosures', () => {
    const code = codeOf(read(CASHFLOWS))
    assert.match(code, /noCrossCurrencyNote/)
    assert.match(code, /signNote/)
    assert.match(code, /currencyLabel\(c\.currency\)/)
  })

  test('the subtotal tiles fill their row for any currency count', () => {
    const code = codeOf(read(CASHFLOWS))
    assert.match(code, /TILE_COLUMNS/)
    assert.match(code, /TILE_COLUMNS\[totals\.length\] \?\? TILE_COLUMNS_MANY/)
    // Whole literal class strings — Tailwind scans source text, so a
    // template-built class name would not survive the build.
    assert.equal(/grid-cols-\$\{/.test(code), false)
    for (const n of [1, 2, 3]) {
      assert.match(code, new RegExp(`^\\s*${n}: 'grid-cols-1`, 'm'), `no column rule for ${n} currencies`)
    }
  })

  // R13.R4A.4: the relocated block now spans the WHOLE history, because the
  // year filter that used to narrow it is gone — a year narrowing applied to a
  // chart whose columns ARE the years collapsed it to a single column.
  test('the relocated block spans every year the source records', () => {
    const code = codeOf(read(CASHFLOWS))
    assert.equal(/showYear/.test(read(CASHFLOWS)), false)
    assert.match(code, /periodColumns\(visibleEvents, c\.currency, \[\]\)/)
    assert.match(code, /\{ \.\.\.filter, year: \[\] \}/)
  })
})

describe('R13.R4A.3 · Holdings leads with the category, closes with the subtotal', () => {
  test('the category label is set above the rows it introduces', () => {
    const code = codeOf(read(HOLDINGS))
    const label = /<span className="([^"]*)"[^>]*>\{group\.category\}<\/span>/.exec(code)
    assert.ok(label, 'the category label is still rendered')
    assert.match(label[1], /ui-card-value|ui-capsule-value|text-sm|text-base/)
  })

  test('the subtotal no longer outweighs it', () => {
    const code = codeOf(read(HOLDINGS))
    const row = /<tr className="([^"]*border-b-2[^"]*)"/.exec(code)
    assert.ok(row, 'the subtotal row keeps its closing rule')
    assert.equal(/text-sm|text-base|text-lg|font-semibold|font-bold/.test(row[1]), false,
      'the subtotal is still emphasised by size')
    // R13.R4A.4: RULES ALONE. The tint went with the accent spine, so the
    // category opener is the only row wearing a highlight.
    assert.match(row[1], /border-t/)
    assert.match(row[1], /border-border-strong/)
    assert.equal(/bg-surface-2/.test(row[1]), false, 'no tint on the subtotal')
  })

  test('every source-backed field and disclosure survives', () => {
    const code = codeOf(read(HOLDINGS))
    for (const col of [
      'colInvestment', 'colSociedad', 'colCommitted', 'colContributions', 'colUnfunded',
      'colLastStatement', 'colLastValuation', 'colFlowSince', 'colCurrentValue',
      'colReportedIrr', 'colCalculatedIrr',
    ]) {
      assert.match(code, new RegExp(`a\\.${col}\\b`), `${col} missing`)
    }
    assert.match(code, /subtotalPartialNote/)
    assert.match(code, /irrSourceNote/)
    assert.match(code, /noCrossCurrencyNote/)
    // The owner asked for centred numerics; nothing may quietly right-align.
    assert.equal(code.includes('text-right'), false)
  })
})

describe('R13.R4A.3 · the whole surface still composes and discloses', () => {
  test('every touched view reflows or scrolls in-card at every width', () => {
    for (const file of [DASHBOARD, HOLDINGS, CASHFLOWS]) {
      const code = codeOf(read(file))
      assert.equal(
        /(sm|md|lg|xl):/.test(code) || /minWidth=\{\d+\}/.test(code),
        true,
        `${file} neither reflows nor scrolls in-card`,
      )
    }
    assert.match(codeOf(read(DASHBOARD)), /(lg|xl):grid-cols-\d+/)
    assert.match(codeOf(read(HOLDINGS)), /minWidth=\{\d+\}/)
    assert.match(codeOf(read(CASHFLOWS)), /minWidth=\{\d+\}/)
  })

  test('no raw hex and no Tailwind colour scale entered the surface', () => {
    for (const file of [...R4A1_FILES, LAYOUT]) {
      const code = codeOf(read(file))
      assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(code), false, `${file} carries a raw hex`)
      assert.equal(
        /\b(bg|text|border|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(code),
        false,
        `${file} carries a Tailwind colour scale`,
      )
    }
  })

  test('no unsupported ratio, no cross-currency total, no wall clock', () => {
    for (const file of [...R4A1_FILES, LAYOUT, VIEW]) {
      const code = codeOf(read(file))
      assert.equal(/\b(DPI|TVPI|RVPI|MOIC)\b/.test(code), false, `${file} names an unsupported ratio`)
      assert.equal(
        /grandTotal|portfolioTotal|combinedTotal|allCurrenciesTotal|crossCurrency(Sum|Total)/.test(code),
        false,
        `${file} builds a grand total`,
      )
      assert.equal(/exchangeRate|fxRate|convertCurrency|toUsd\(/.test(code), false, `${file} converts a currency`)
      assert.equal(/new Date\(\)|Date\.now\(\)/.test(code), false, `${file} reads the clock`)
    }
  })

  test('every amount on the surface still goes through the masked path', () => {
    for (const file of [DASHBOARD, HOLDINGS, CASHFLOWS, DRILLDOWNS, CHART]) {
      const code = codeOf(read(file))
      assert.equal(/formatUsd\(/.test(code), false, `${file} formats an amount directly`)
    }
  })

  test('the two dictionaries stay structurally identical', () => {
    assert.deepEqual(
      Object.keys(dict.en.fp.alternatives).sort(),
      Object.keys(dict.es.fp.alternatives).sort(),
    )
  })
})

// ===========================================================================
// R13.R4A.4 · owner-review refinements
// ===========================================================================

describe('R13.R4A.4 · the chart tooltip is bounded, not estimated', () => {
  test('the clamp keeps both edges inside the box', () => {
    // A wide box: the tooltip follows its column exactly.
    assert.equal(clampTooltipLeft({ center: 300, boxWidth: 800, tipWidth: 160 }), 300)
    // First column: centring on it would push the left edge out, so it stops.
    assert.equal(clampTooltipLeft({ center: 20, boxWidth: 800, tipWidth: 160 }), 84)
    // Last column: the same, mirrored.
    assert.equal(clampTooltipLeft({ center: 790, boxWidth: 800, tipWidth: 160 }), 716)
  })

  test('a tooltip wider than its box centres and is capped rather than clipped', () => {
    // No position satisfies both bounds, so it centres — and the ceiling makes
    // the text wrap inside the box instead of running out of the card.
    assert.equal(clampTooltipLeft({ center: 10, boxWidth: 200, tipWidth: 400 }), 100)
    assert.equal(tooltipMaxWidth(200), 200 - 2 * TIP_EDGE_PX)
  })

  test('the box is never given a negative ceiling', () => {
    assert.equal(tooltipMaxWidth(0), 0)
    assert.equal(tooltipMaxWidth(4), 0)
    assert.ok(tooltipMaxWidth(360) > 0)
  })

  test('an unmeasured tooltip is still bounded by the box', () => {
    // Width 0 is the frame before measurement lands; it must still resolve to a
    // position inside the box, never to a raw out-of-range column centre.
    for (const center of [-50, 0, 123, 900]) {
      const left = clampTooltipLeft({ center, boxWidth: 400, tipWidth: 0 })
      assert.ok(left >= 0 && left <= 400, center + ' produced ' + left)
    }
  })

  test('the tooltip renders outside the plot scroll container', () => {
    const code = codeOf(read(CHART))
    const tip = code.indexOf('<ChartTooltip')
    const scroll = code.indexOf('overflow-x-auto')
    assert.ok(tip > 0 && scroll > 0, 'both the tooltip and the plot are still rendered')
    assert.ok(tip < scroll, 'the tooltip must not sit inside the scrolling plot')
    // The clamp box is positioned, and is NOT itself a scroll container.
    assert.match(code, /<div ref=\{boxRef\} className="relative min-w-0">/)
  })

  test('it is positioned from the clamp, never from a raw column offset', () => {
    const code = codeOf(read(CHART))
    assert.match(code, /left=\{tipLeft\}/)
    assert.match(code, /maxWidth=\{tipMax\}/)
    assert.equal(/left: el\.offsetLeft/.test(code), false, 'the unbounded offset is gone')
    assert.match(code, /getBoundingClientRect\(\)/)
    assert.match(code, /clampTooltipLeft\(/)
    assert.match(code, /tooltipMaxWidth\(/)
  })

  test('the shared tooltip keeps its unbounded default for every other chart', () => {
    const code = codeOf(read(TOOLTIP))
    assert.match(code, /maxWidth\?: number/)
    assert.match(code, /innerRef\?: Ref<HTMLDivElement>/)
    // nowrap survives exactly when no ceiling is supplied, so the six charts
    // that pass neither prop render as they did before.
    assert.match(code, /whiteSpace: maxWidth === undefined \? 'nowrap' : 'normal'/)
    for (const f of OTHER_CHARTS) {
      assert.equal(/maxWidth=/.test(codeOf(read(f))), false, f + ' was not meant to change')
    }
  })

  test('every Alternatives chart is this one component', () => {
    // The fix lives in the component, so this is what makes it total: a second
    // chart added to the module would have to come through the same clamp.
    for (const f of [DASHBOARD, CASHFLOWS, HOLDINGS]) {
      const charts = codeOf(read(f)).match(/<[A-Z][A-Za-z]*Chart\b/g) ?? []
      for (const c of charts) {
        assert.equal(c, '<AlternativesCashFlowChart', f + ' renders an unaudited chart: ' + c)
      }
    }
  })
})

describe('R13.R4A.4 · Recent Activity links to the history it summarises', () => {
  test('the action points at the Cash Flow History section, in-app', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /CASH_FLOW_HISTORY_HREF/)
    assert.match(code, /\{a\.recentViewAll\}/)
    assert.match(code, /<Link\b/)
    assert.equal(/target="_blank"/.test(code), false, 'never a new tab')
    // The action rides the card header, so the feed's measured capacity — the
    // whole reason the panel does not scroll — keeps its height.
    const card = code.slice(code.indexOf('function RecentActivityCard'))
    assert.ok(
      card.indexOf('controls={') < card.indexOf('footer={'),
      'the action belongs to the header row, not below the feed',
    )
  })

  test('the link and its target are the same constant', () => {
    const routes = read(ROUTES)
    assert.match(routes, /export const CASH_FLOW_HISTORY_ANCHOR = 'cash-flow-history'/)
    assert.match(routes, /export const CASH_FLOW_HISTORY_HREF = /)
    // Neither side spells the hash itself.
    assert.equal(/'cash-flow-history'/.test(codeOf(read(DASHBOARD))), false)
    const flows = codeOf(read(CASHFLOWS))
    assert.match(flows, /id=\{CASH_FLOW_HISTORY_ANCHOR\}/)
    assert.equal(/id="cash-flow-history"/.test(flows), false)
  })

  test('the landing target is focusable and clears the chrome above it', () => {
    const flows = codeOf(read(CASHFLOWS))
    assert.match(flows, /tabIndex=\{-1\}/)
    assert.match(flows, /scroll-mt-/)
    assert.match(flows, /scrollIntoView\(/)
    // Motion rule: smooth scrolling ships its reduced-motion path.
    assert.match(flows, /prefers-reduced-motion/)
  })

  test('the section wraps the ledger, not the by-year block', () => {
    const flows = codeOf(read(CASHFLOWS))
    const section = flows.indexOf('id={CASH_FLOW_HISTORY_ANCHOR}')
    const byYear = flows.indexOf('{a.annualTitle}')
    const ledger = flows.indexOf('{a.cashFlowsTitle}')
    assert.ok(byYear > 0 && ledger > 0)
    assert.ok(section > byYear, 'the anchor sits below the by-year block')
    assert.ok(section < ledger, 'the anchor opens the ledger card')
  })
})

describe('R13.R4A.4 · Cash Flows always reads every recorded year', () => {
  test('no year control survives anywhere in the module', () => {
    for (const f of [CASHFLOWS, FILTERS, HOLDINGS]) {
      assert.equal(/showYear/.test(read(f)), false, f + ' still offers a year filter')
    }
    const filters = codeOf(read(FILTERS))
    assert.equal(/options\.years/.test(filters), false)
    assert.equal(/a\.allYears/.test(filters), false)
    assert.equal(/filter\.year/.test(filters), false)
  })

  test('the view clears the year itself rather than trusting a missing control', () => {
    const code = codeOf(read(CASHFLOWS))
    assert.match(code, /\{ \.\.\.filter, year: \[\] \}/)
    assert.match(code, /applyEventFilter\(events, holdings, allYears\)/)
    // All three grains read that one set — never a second, differently-narrowed one.
    assert.equal(/applyEventFilter\(events, holdings, filter\)/.test(code), false)
    assert.match(code, /currencyCashFlows\(visibleEvents\)/)
    assert.match(code, /periodColumns\(visibleEvents, c\.currency, \[\]\)/)
    assert.match(code, /buildTimeline\(visibleEvents, holdings\)/)
  })

  test('the other four narrowings are untouched', () => {
    const filters = codeOf(read(FILTERS))
    for (const k of ['filterSociedad', 'filterCategory', 'filterCurrency', 'filterEventType']) {
      assert.match(filters, new RegExp('a\\.' + k), k + ' must survive')
    }
    assert.match(codeOf(read(CASHFLOWS)), /showEventType/)
  })

  test('clearing the year genuinely returns every year, and narrows nothing else', () => {
    const both = applyEventFilter(EVENTS_FIXTURE, HOLDINGS_FIXTURE, { ...EMPTY_FILTER, year: [] })
    assert.equal(both.length, EVENTS_FIXTURE.length)
    const years = [...new Set(both.map((e) => e.eventDate.slice(0, 4)))].sort()
    assert.deepEqual(years, ['2022', '2023', '2024', '2025'])

    // A sociedad narrowing still applies with the year cleared: the removal took
    // away one dimension, not the filter.
    const dubai = applyEventFilter(EVENTS_FIXTURE, HOLDINGS_FIXTURE, {
      ...EMPTY_FILTER,
      sociedad: ['DUBAI'],
      year: [],
    })
    assert.ok(dubai.length > 0 && dubai.length < EVENTS_FIXTURE.length)
    assert.ok(dubai.every((e) => e.holdingId === 'h2'))
  })

  test('the Dashboard keeps its own per-currency year selectors', () => {
    const code = codeOf(read(DASHBOARD))
    // R13.R4A.5 — still the Dashboard's OWN per-card selector, and still the
    // shared control; multi-select now, so it reads a year SET.
    assert.match(code, /<AlternativesMultiSelect/)
    assert.match(code, /value=\{selectedYears\}/)
    assert.match(code, /label=\{t\.filterYear\}/)
    assert.match(code, /allLabel=\{t\.allYears\}/)
    assert.match(code, /cashFlowYears\(ownEvents\)/)
  })
})

describe('R13.R4A.4 · every "all" option reads as just the word', () => {
  const KEYS = [
    'allSociedades',
    'allCategories',
    'allCurrencies',
    'allEventTypes',
    'allYears',
  ] as const

  test('English says only the word', () => {
    const a = dict.en.fp.alternatives
    for (const k of KEYS) assert.equal(a[k], 'All', k + ' still repeats its field')
  })

  test('Spanish says only the word, and agrees with the noun it stands for', () => {
    const a = dict.es.fp.alternatives
    // Sociedad / categoría / moneda are feminine; tipo and año are masculine.
    assert.equal(a.allSociedades, 'Todas')
    assert.equal(a.allCategories, 'Todas')
    assert.equal(a.allCurrencies, 'Todas')
    assert.equal(a.allEventTypes, 'Todos')
    assert.equal(a.allYears, 'Todos')
  })

  test('no "all" option names the field its own label already names', () => {
    for (const lang of ['en', 'es'] as const) {
      const a = dict[lang].fp.alternatives
      for (const k of KEYS) {
        const words = String(a[k]).trim().split(/\s+/)
        assert.equal(words.length, 1, lang + '.' + k + ' is "' + a[k] + '"')
      }
    }
  })

  test('the control still offers that option, and it clears the selection', () => {
    // R13.R4A.5 — "all" was an <option value=""> under a single-select; it is
    // now the act of clearing a SET, so it is a button that writes `[]` rather
    // than a sibling option that could be checked alongside the others.
    const filters = codeOf(read(FILTERS))
    assert.match(filters, /onClick=\{\(\) => onChange\(\[\]\)\}/)
    assert.match(filters, /\{allLabel\}/)
    // It reads as selected exactly when nothing specific is.
    assert.match(filters, /aria-pressed=\{value\.length === 0\}/)
    // And there is no <option> left to disagree with it.
    assert.equal(/<option/.test(filters), false)
  })
})
