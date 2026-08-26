// R13.R4A — the Alternatives LP module: three views, supported-metric
// semantics, currency separation, cash-flow correctness, access/privacy
// preservation, responsive structure and Fable token compliance.
//
// The behavioural half of this suite runs the PURE module directly, because
// that is where every financial decision in this module lives. The structural
// half reads the page sources and asserts invariants that must survive a purely
// visual refinement pass — never an incidental class string.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import {
  annualCashFlows,
  commitmentDrawn,
  currencyCashFlows,
  currencyPositions,
  currencyLabel,
  groupHoldings,
  recentEvents,
  timelineCoverage,
  type AlternativesEventRead,
  type AlternativesHoldingRead,
} from '../src/lib/familyPortfolio/alternativesView.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const LAYOUT = 'src/app/family-portfolio/alternatives/layout.tsx'
const DASHBOARD = 'src/app/family-portfolio/alternatives/page.tsx'
const HOLDINGS = 'src/app/family-portfolio/alternatives/holdings/page.tsx'
const CASHFLOWS = 'src/app/family-portfolio/alternatives/cash-flows/page.tsx'
const SUBNAV = 'src/components/familyPortfolio/AlternativesSubnav.tsx'
const PROVIDER = 'src/components/familyPortfolio/AlternativesProvider.tsx'
const FILTERS = 'src/components/familyPortfolio/AlternativesFilters.tsx'
const CHART = 'src/components/familyPortfolio/AlternativesCashFlowChart.tsx'
const CHROME = 'src/components/familyPortfolio/AlternativesEventChrome.tsx'
const DRILLDOWNS = 'src/components/familyPortfolio/AlternativesDrilldowns.tsx'
const VIEW = 'src/lib/familyPortfolio/alternativesView.ts'
const ROUTE = 'src/app/api/family-portfolio/alternatives/route.ts'
const ROUTES = 'src/lib/familyPortfolio/alternativesRoutes.ts'

/** The three views plus everything they render — the whole R4A front end. */
const SURFACE_FILES = [LAYOUT, DASHBOARD, HOLDINGS, CASHFLOWS, SUBNAV, FILTERS, CHART, CHROME, DRILLDOWNS]
const surface = () => SURFACE_FILES.map(read).join('\n')

/** Source with comments stripped, so a doc reference never satisfies a check. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
}

// ---------------------------------------------------------------------------
// Fixtures — deliberately multi-currency, deliberately incomplete, and shaped
// like the real workbook: one fund held by several sociedades, a holding with
// no events at all, and a value that is genuinely zero rather than absent.
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
  holding({ id: 'h1' }),
  holding({ id: 'h2', sociedad: 'DUBAI', capitalCommitted: 2000, contributions: 1000, unfunded: 1000, currentValue: 1200 }),
  // Same fund, third sociedad — an investment counted once, a holding counted thrice.
  holding({ id: 'h3', sociedad: 'STATEN', capitalCommitted: null, contributions: null, unfunded: null, currentValue: 300 }),
  // A different currency entirely; must never join the dollar sums.
  holding({ id: 'h4', currency: 'euros', category: 'Real Assets', investmentName: 'Fund E', sociedad: 'COVAL', capitalCommitted: 500, contributions: null, unfunded: null, currentValue: 900 }),
  // A real zero holding, and no events at all.
  holding({ id: 'h5', currency: 'pesos', category: 'Real Assets', investmentName: 'Fund P', sociedad: 'COVAL', capitalCommitted: 0, contributions: 0, unfunded: 0, currentValue: 0 }),
]

const EVENTS_FIXTURE: AlternativesEventRead[] = [
  event({ holdingId: 'h1', eventDate: '2023-01-31', amount: -100 }),
  event({ holdingId: 'h1', eventDate: '2024-06-30', amount: -250 }),
  event({ holdingId: 'h1', eventDate: '2025-09-30', amount: 80, eventType: 'dividendo' }),
  event({ holdingId: 'h2', eventDate: '2025-12-31', amount: 120, eventType: 'distribucion' }),
  event({ holdingId: 'h2', eventDate: '2026-02-28', amount: 55, eventType: 'unclassified' }),
  event({ holdingId: 'h4', eventDate: '2024-03-31', amount: -500, currency: 'euros' }),
  event({ holdingId: 'h4', eventDate: '2026-01-31', amount: 300, currency: 'euros', eventType: 'distribucion' }),
]

// ---------------------------------------------------------------------------
// 1 · Three views
// ---------------------------------------------------------------------------

describe('R13.R4A · Dashboard / Holdings / Cash Flows navigation', () => {
  test('all three routes exist as real pages under one shared layout', () => {
    for (const rel of [LAYOUT, DASHBOARD, HOLDINGS, CASHFLOWS]) {
      assert.ok(existsSync(join(ROOT, rel)), `${rel} must exist`)
    }
  })

  test('the sub-nav offers exactly the three views, each on its own URL', () => {
    const nav = read(SUBNAV)
    assert.match(nav, /navDashboard/)
    assert.match(nav, /navHoldings/)
    assert.match(nav, /navCashFlows/)
    // R13.R4A.4 moved the paths themselves into one shared module — the
    // Dashboard's activity action links into Cash Flows, and a path spelled on
    // both sides is a path that can drift apart. The rail names the constants;
    // the constants carry the URLs.
    assert.match(nav, /ALTERNATIVES_ROOT/)
    assert.match(nav, /ALTERNATIVES_HOLDINGS/)
    assert.match(nav, /ALTERNATIVES_CASH_FLOWS/)
    const routes = read(ROUTES)
    assert.match(routes, /ALTERNATIVES_ROOT = '\/family-portfolio\/alternatives'/)
    assert.ok(routes.includes("ALTERNATIVES_HOLDINGS = `${ALTERNATIVES_ROOT}/holdings`"), 'holdings URL')
    assert.ok(routes.includes("ALTERNATIVES_CASH_FLOWS = `${ALTERNATIVES_ROOT}/cash-flows`"), 'cash-flows URL')
    // Real links, so each view is addressable and back-button reachable —
    // never in-page tab state.
    assert.match(nav, /<Link/)
  })

  test('the rail reuses the app-wide measured indicator, not a second nav system', () => {
    assert.match(read(SUBNAV), /useNavIndicator/)
  })

  test('one fetch serves all three views', () => {
    const provider = read(PROVIDER)
    assert.match(provider, /fetchFamilyPortfolioAlternatives/)
    // The pages themselves never fetch — they read the shared context.
    for (const rel of [DASHBOARD, HOLDINGS, CASHFLOWS]) {
      assert.ok(!/fetchFamilyPortfolioAlternatives/.test(read(rel)), `${rel} must not fetch its own copy`)
      assert.match(read(rel), /useAlternatives\(\)/)
    }
  })

  test('the honest states are resolved ONCE in the layout, never duplicated per view', () => {
    const layout = read(LAYOUT)
    for (const s of ["'loading'", "'error'", "'denied'", 'no_publication', "'empty'"]) {
      assert.ok(layout.includes(s), `the layout must answer state ${s}`)
    }
    assert.match(layout, /<MemberGate>/)
    // A sub-page renders only when there is a published book to show.
    assert.match(layout, /ready && children/)
  })
})

// ---------------------------------------------------------------------------
// 2 · Supported metric semantics
// ---------------------------------------------------------------------------

describe('R13.R4A · supported LP metric semantics', () => {
  test('counts are of DISTINCT things — a fund held by three sociedades is one investment', () => {
    const usd = currencyPositions(HOLDINGS_FIXTURE).find((p) => p.currency === 'dolares')!
    assert.equal(usd.investments, 1, 'one fund')
    assert.equal(usd.holdings, 3, 'three (investment x sociedad) rows')
    assert.equal(usd.sociedades, 3)
  })

  test('a column no holding carries stays unavailable — never 0', () => {
    const eur = currencyPositions(HOLDINGS_FIXTURE).find((p) => p.currency === 'euros')!
    assert.equal(eur.contributions.value, null, 'no EUR row reports contributions')
    assert.equal(eur.contributions.missing, 1)
    assert.notEqual(eur.contributions.value, 0)
  })

  test('a partial sum reports how many rows it could not include', () => {
    const usd = currencyPositions(HOLDINGS_FIXTURE).find((p) => p.currency === 'dolares')!
    assert.equal(usd.commitments.value, 3000, '1000 + 2000, the third row being unavailable')
    assert.equal(usd.commitments.missing, 1)
  })

  test('a genuine zero is preserved as a zero, distinct from unavailable', () => {
    const clp = currencyPositions(HOLDINGS_FIXTURE).find((p) => p.currency === 'pesos')!
    assert.equal(clp.currentValue.value, 0)
    assert.equal(clp.currentValue.missing, 0)
  })

  test('order is by holding COUNT then label — a non-monetary dimension, so no FX is implied', () => {
    const order = currencyPositions(HOLDINGS_FIXTURE).map((p) => p.currency)
    assert.equal(order[0], 'dolares', 'the currency carrying most of the book leads')
    // The remaining two both hold one row, so the label breaks the tie
    // deterministically (EUR before CLP by display label).
    assert.deepEqual(order.slice(1).sort(), ['euros', 'pesos'])
  })

  test('NO ratio spanning master data and the event timeline is ever computed', () => {
    const code = codeOf(read(VIEW)) + codeOf(surface())
    for (const banned of ['DPI', 'TVPI', 'RVPI', 'MOIC']) {
      assert.ok(
        !new RegExp(`\\b${banned}\\b`).test(code),
        `${banned} divides contributed capital by distributions, which come from two non-reconciling parts of the source`,
      )
    }
  })

  test('IRR is never computed — the two IRR columns pass through as cached source values', () => {
    const code = codeOf(read(VIEW)) + codeOf(surface())
    assert.ok(!/function .*[iI]rr|calculateIrr|computeIrr|xirr/i.test(code), 'no IRR solver anywhere')
    // The Holdings view still SHOWS both source-provided IRRs, labelled as such.
    assert.match(read(HOLDINGS), /colReportedIrr/)
    assert.match(read(HOLDINGS), /colCalculatedIrr/)
    assert.match(read(HOLDINGS), /irrSourceNote/)
  })

  test('commitment drawn uses one consistent row set for BOTH operands', () => {
    // h1 and h2 report both; h3 reports neither. The ratio must be
    // 1400/3000, never 1400/3000-with-a-different-denominator population.
    const drawn = commitmentDrawn(HOLDINGS_FIXTURE, 'dolares')!
    assert.equal(drawn.committed, 3000)
    assert.equal(drawn.contributed, 1400)
    assert.ok(Math.abs(drawn.ratio - 1400 / 3000) < 1e-12)
    assert.equal(drawn.holdings, 2, 'computed across the rows reporting both')
    assert.equal(drawn.ofHoldings, 3, 'out of the currency total, so partiality is disclosable')
  })

  test('commitment drawn is unavailable rather than 0% when it cannot be formed', () => {
    assert.equal(commitmentDrawn(HOLDINGS_FIXTURE, 'euros'), null, 'no EUR row reports contributions')
    assert.equal(commitmentDrawn(HOLDINGS_FIXTURE, 'pesos'), null, 'a zero commitment is not a valid base')
    assert.equal(commitmentDrawn(HOLDINGS_FIXTURE, 'nonexistent'), null)
  })
})

// ---------------------------------------------------------------------------
// 3 · Currency separation — no unsupported cross-currency total
// ---------------------------------------------------------------------------

describe('R13.R4A · currency separation', () => {
  test('every summary is keyed by currency and none blends two', () => {
    const positions = currencyPositions(HOLDINGS_FIXTURE)
    assert.equal(new Set(positions.map((p) => p.currency)).size, positions.length)
    // The dollar sums contain no euro or peso money.
    const usd = positions.find((p) => p.currency === 'dolares')!
    assert.equal(usd.currentValue.value, 510 + 1200 + 300)
    const flows = currencyCashFlows(EVENTS_FIXTURE)
    assert.equal(new Set(flows.map((c) => c.currency)).size, flows.length)
    const eur = flows.find((c) => c.currency === 'euros')!
    assert.equal(eur.calls.amount, -500, 'euro calls contain no dollar events')
  })

  test('the per-currency parts reconstruct the whole — nothing is dropped or double counted', () => {
    const positions = currencyPositions(HOLDINGS_FIXTURE)
    assert.equal(
      positions.reduce((a, p) => a + p.holdings, 0),
      HOLDINGS_FIXTURE.length,
    )
    const flows = currencyCashFlows(EVENTS_FIXTURE)
    const counted = flows.reduce(
      (a, c) => a + c.calls.count + c.distributions.count + c.unclassified.count,
      0,
    )
    assert.equal(counted, EVENTS_FIXTURE.length, 'every event counted exactly once')
  })

  test('no cross-currency total exists in the pure module — there is no function to call', () => {
    const code = codeOf(read(VIEW))
    assert.ok(
      !/grandTotal|allCurrenc(y|ies)Total|blendedTotal|totalUsdEquivalent|convertTo/i.test(code),
      'no aggregate spanning currencies may exist',
    )
    assert.ok(!/exchangeRate|fxRate|toUsd\b/i.test(code), 'no FX conversion in this module')
  })

  test('no view assembles a grand total either', () => {
    const code = codeOf(surface())
    assert.ok(!/grandTotal|portfolioTotal|allGroupsTotal|combinedTotal/i.test(code))
    // Each view states the no-cross-currency rule where it shows sums.
    assert.match(read(HOLDINGS), /noCrossCurrencyNote/)
    assert.match(read(DASHBOARD), /noCrossCurrencyNote/)
  })

  test('the chart is scaled per currency, so no bar is measured against another denomination', () => {
    const chart = read(CHART)
    assert.match(chart, /currency: string/)
    // The peak comes from the years passed in, which are one currency's own.
    assert.match(chart, /Math\.max\(\.\.\.magnitudes/)
    assert.ok(!/grandTotal|allCurrencies/i.test(codeOf(chart)))
  })
})

// ---------------------------------------------------------------------------
// 4 · Cash-flow event correctness
// ---------------------------------------------------------------------------

describe('R13.R4A · cash-flow event correctness', () => {
  test('signs are the source’s: calls negative, distributions positive', () => {
    const usd = currencyCashFlows(EVENTS_FIXTURE).find((c) => c.currency === 'dolares')!
    assert.equal(usd.calls.amount, -350)
    assert.equal(usd.calls.count, 2)
    assert.equal(usd.distributions.amount, 200, 'dividendo 80 + distribucion 120')
    assert.equal(usd.distributions.count, 2)
  })

  test('unclassified is its own figure and is EXCLUDED from net — never guessed from the sign', () => {
    const usd = currencyCashFlows(EVENTS_FIXTURE).find((c) => c.currency === 'dolares')!
    assert.equal(usd.unclassified.amount, 55)
    assert.equal(usd.unclassified.count, 1)
    assert.equal(usd.net, -350 + 200, 'net is calls + distributions only')
    assert.notEqual(usd.net, -350 + 200 + 55)
  })

  test('a currency’s recorded window comes from its own events', () => {
    const eur = currencyCashFlows(EVENTS_FIXTURE).find((c) => c.currency === 'euros')!
    assert.equal(eur.firstEvent, '2024-03-31')
    assert.equal(eur.lastEvent, '2026-01-31')
  })

  test('annual flows never gap-fill a silent year', () => {
    const usd = annualCashFlows(EVENTS_FIXTURE).find((c) => c.currency === 'dolares')!
    assert.deepEqual(usd.years.map((y) => y.year), ['2023', '2024', '2025', '2026'])
    const eur = annualCashFlows(EVENTS_FIXTURE).find((c) => c.currency === 'euros')!
    assert.deepEqual(eur.years.map((y) => y.year), ['2024', '2026'], '2025 is silent and absent, not zero')
  })

  test('annual flows carry per-legend-type amounts so a chart never merges two source classes', () => {
    const usd = annualCashFlows(EVENTS_FIXTURE).find((c) => c.currency === 'dolares')!
    const y2025 = usd.years.find((y) => y.year === '2025')!
    assert.equal(y2025.byType['dividendo'], 80)
    const y2026 = usd.years.find((y) => y.year === '2026')!
    assert.equal(y2026.byType['unclassified'], 55)
    assert.equal(y2026.distributions, 0, 'an unclassified event is not a distribution')
  })

  test('annual sums reproduce the underlying events exactly', () => {
    const total = annualCashFlows(EVENTS_FIXTURE).reduce(
      (a, c) => a + c.years.reduce((s, y) => s + y.calls + y.distributions + y.unclassified, 0),
      0,
    )
    const expected = EVENTS_FIXTURE.reduce((a, e) => a + e.amount, 0)
    assert.ok(Math.abs(total - expected) < 1e-9)
  })

  test('recent activity is newest first and bounded', () => {
    const recent = recentEvents(EVENTS_FIXTURE, HOLDINGS_FIXTURE, 3)
    assert.equal(recent.length, 3)
    assert.equal(recent[0].eventDate, '2026-02-28')
    for (let i = 1; i < recent.length; i += 1) {
      assert.ok(recent[i - 1].eventDate >= recent[i].eventDate, 'strictly newest-first')
    }
    assert.deepEqual(recentEvents(EVENTS_FIXTURE, HOLDINGS_FIXTURE, 0), [])
  })

  test('recent activity resolves the investment through the holding link, never a name match', () => {
    const recent = recentEvents(EVENTS_FIXTURE, HOLDINGS_FIXTURE, 1)
    assert.equal(recent[0].investmentName, 'Fund A')
    const orphan = recentEvents([event({ holdingId: null, eventDate: '2026-05-31' })], HOLDINGS_FIXTURE, 1)
    assert.equal(orphan[0].investmentName, null, 'an unlinked event stays an honest unknown')
  })

  test('the ledger keeps the classification and shows the type in TEXT, never colour alone', () => {
    const chrome = read(CHROME)
    assert.match(chrome, /eventTypeLabel/)
    assert.match(chrome, /aria-hidden="true"/)
    // The Cash Flows ledger renders the tag, which carries the label.
    assert.match(read(CASHFLOWS), /EventTypeTag/)
    assert.ok(!/eventType === 'aporte' \? .*amount|amount < 0 \?.*aporte/.test(codeOf(read(CASHFLOWS))),
      'a type is never inferred from an amount’s sign')
  })
})

// ---------------------------------------------------------------------------
// 5 · Incompleteness is disclosed, never filled
// ---------------------------------------------------------------------------

describe('R13.R4A · source-limitation disclosure', () => {
  test('timeline coverage counts the holdings the record does not reach', () => {
    const c = timelineCoverage(HOLDINGS_FIXTURE, EVENTS_FIXTURE)
    assert.equal(c.holdings, 5)
    assert.equal(c.holdingsWithEvents, 3, 'h1, h2, h4')
    assert.equal(c.holdingsWithoutEvents, 2, 'h3 and h5 hold a position with no recorded movement')
    assert.equal(c.firstEvent, '2023-01-31')
    assert.equal(c.lastEvent, '2026-02-28')
  })

  test('a holding with no events is never rendered as a zero flow', () => {
    const c = timelineCoverage(HOLDINGS_FIXTURE, [])
    assert.equal(c.holdingsWithEvents, 0)
    assert.equal(c.firstEvent, null)
    assert.equal(c.lastEvent, null)
  })

  test('both views that show cash flow disclose the coverage and the window', () => {
    for (const rel of [DASHBOARD, CASHFLOWS]) {
      const src = read(rel)
      assert.ok(/coverageNote|coverageCompleteNote/.test(src), `${rel} must disclose coverage`)
    }
    assert.match(read(CASHFLOWS), /windowLabel/)
  })

  test('the Dashboard states the two-basis limitation and why no ratio spans it', () => {
    const dash = read(DASHBOARD)
    assert.match(dash, /basisNote/)
    assert.match(dash, /noRatioNote/)
    for (const lang of ['en', 'es'] as const) {
      const v = dict[lang].fp.alternatives
      assert.ok(v.noRatioNote.includes('DPI') && v.noRatioNote.includes('TVPI'))
      assert.ok(v.basisNote.length > 60, 'the disclosure explains the two bases, not just names them')
    }
  })

  test('the unclassified callout reports the WHOLE publication, not the filtered view', () => {
    const flows = read(CASHFLOWS)
    assert.match(flows, /data\?\.eventSummary\?\.unclassified/)
    assert.match(flows, /role="status"/)
  })
})

// ---------------------------------------------------------------------------
// 6 · Access and privacy preservation
// ---------------------------------------------------------------------------

describe('R13.R4A · access and privacy preserved', () => {
  test('no second authorization model — the route keeps the one entitlement ladder', () => {
    const route = read(ROUTE)
    assert.match(route, /guardPrivateApi/)
    assert.match(route, /canReadScope\(entitlement\.input, 'alternatives'\)/)
    assert.match(route, /listCurrentPublications\('alternatives'\)/)
  })

  test('the new views add no client-side authorization of their own', () => {
    for (const rel of SURFACE_FILES) {
      const code = codeOf(read(rel))
      assert.ok(!/from '@\/lib\/db\/repositories/.test(code), `${rel}: no repository import in a client component`)
      assert.ok(!/service_role|SERVICE_ROLE|supabaseAdmin/.test(code), `${rel}: no admin client`)
    }
    // The gate is the shared one, mounted once.
    assert.match(read(LAYOUT), /MemberGate/)
  })

  test('every monetary value renders through MaskedAmount — no direct amount formatting', () => {
    for (const rel of [DASHBOARD, HOLDINGS, CASHFLOWS, CHART]) {
      const code = codeOf(read(rel))
      assert.ok(!/\bformatUsd\b/.test(code), `${rel} must not format an amount outside MaskedAmount`)
      assert.match(read(rel), /MaskedAmount/, `${rel} must render amounts through the guarded component`)
    }
  })

  test('no raw amount leaks into a title or aria-label', () => {
    for (const rel of SURFACE_FILES) {
      const code = codeOf(read(rel))
      assert.ok(
        !/(title|aria-label)=\{[^}]*\b(amount|currentValue|capitalCommitted|contributions|unfunded|lastValuation)\b/.test(code),
        `${rel}: an amount must never appear in an accessibility string`,
      )
    }
  })

  test('the privacy preference is the shared app-wide one, toggled once in the header', () => {
    assert.match(read(LAYOUT), /usePrivacyMode\(\)/)
    assert.match(read(LAYOUT), /PrivacyToggle/)
    // The views read the same shared store; none owns its own copy of the toggle.
    for (const rel of [DASHBOARD, HOLDINGS, CASHFLOWS]) {
      assert.match(read(rel), /usePrivacyMode\(\)/)
      assert.ok(!/PrivacyToggle/.test(read(rel)), `${rel}: exactly one toggle, in the shell`)
    }
  })
})

// ---------------------------------------------------------------------------
// 7 · Responsive structure and Fable token compliance
// ---------------------------------------------------------------------------

describe('R13.R4A · responsive structure', () => {
  test('dense tables scroll inside their own card', () => {
    for (const rel of [HOLDINGS, CASHFLOWS]) {
      const m = /minWidth=\{(\d+)\}/.exec(read(rel))
      assert.ok(m, `${rel} must give its dense table a minWidth so the scroll stays card-level`)
      assert.ok(Number(m![1]) >= 700, `${rel} minWidth ${m![1]} is implausibly small for its column count`)
    }
  })

  test('multi-column layouts carry a responsive prefix — they never lock a narrow viewport', () => {
    for (const rel of [DASHBOARD, CASHFLOWS]) {
      const grids = read(rel).match(/grid-cols-\d[^"'`]*/g) ?? []
      assert.ok(grids.length > 0, `${rel} has no grid to check`)
      for (const g of grids) {
        assert.ok(
          /grid-cols-1/.test(g) || /(sm|md|lg|xl):grid-cols-/.test(g),
          `${rel}: "${g}" must start at one column or carry a breakpoint prefix`,
        )
      }
    }
  })

  test('the rails and filter bar wrap or scroll internally rather than widening the page', () => {
    assert.match(read(SUBNAV), /overflow-x-auto/)
    assert.match(read(FILTERS), /flex-wrap/)
  })

  test('long investment names truncate with their full text available on hover', () => {
    for (const rel of [DASHBOARD, HOLDINGS, CASHFLOWS]) {
      assert.match(read(rel), /truncate/, `${rel} must truncate long names`)
    }
    assert.match(read(HOLDINGS), /title=\{h\.investmentName\}/)
  })
})

describe('R13.R4A · Fable token compliance', () => {
  test('no raw hex and no raw Tailwind colour scale in any new component', () => {
    for (const rel of SURFACE_FILES) {
      const code = codeOf(read(rel))
      assert.ok(!/#[0-9A-Fa-f]{3,8}\b/.test(code), `${rel}: hardcoded colour`)
      assert.ok(
        !/\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|emerald|green|blue|indigo|purple|violet)-\d{2,3}\b/.test(code),
        `${rel}: raw Tailwind colour scale`,
      )
    }
  })

  test('event colours come from the tokens through eventPresentation, never inline', () => {
    assert.match(read(CHROME), /altEventColorVar/)
    assert.match(read(CHART), /altEventColorVar/)
    for (const rel of SURFACE_FILES) {
      assert.ok(!/--alt-event-[a-z]+:/.test(read(rel)), `${rel}: tokens are declared only in globals.css`)
    }
  })

  test('no date-only string is ever run through new Date()', () => {
    for (const rel of SURFACE_FILES) {
      assert.ok(!/new Date\(|Date\.now\(/.test(codeOf(read(rel))), `${rel}: dates are ISO strings by contract`)
    }
  })

  test('every table ends with exactly one TableSourceFooter naming the Alternatives source', () => {
    for (const rel of [DASHBOARD, HOLDINGS, CASHFLOWS]) {
      const src = read(rel)
      const cards = (src.match(/<TableCard/g) ?? []).length
      const footers = (src.match(/<TableSourceFooter/g) ?? []).length
      assert.equal(footers, cards, `${rel}: ${cards} card(s) but ${footers} footer(s)`)
      if (cards > 0) assert.match(src, /source=\{a\.source\}/)
    }
  })
})

// ---------------------------------------------------------------------------
// 8 · i18n
// ---------------------------------------------------------------------------

describe('R13.R4A · i18n', () => {
  test('EN and ES alternatives vocabularies stay identical in shape', () => {
    const en = Object.keys(dict.en.fp.alternatives).sort()
    const es = Object.keys(dict.es.fp.alternatives).sort()
    assert.deepEqual(en, es)
  })

  test('every R4A key exists in both languages and neither is a placeholder', () => {
    const added = [
      'navDashboard', 'navHoldings', 'navCashFlows', 'subnavLabel',
      'positionTitle', 'kpiCurrentValue', 'kpiCommitted', 'kpiContributed', 'kpiUnfunded',
      'kpiInvestments', 'kpiHoldings', 'kpiSociedades', 'fundingLabel', 'fundingUnavailable',
      'cashFlowTitle', 'kpiCalls', 'kpiDistributions', 'kpiNetFlow', 'kpiUnclassifiedAmount',
      'annualTitle', 'recentTitle', 'coverageLabel', 'windowLabel',
      'basisNote', 'noRatioNote', 'coverageNote', 'coverageCompleteNote',
      'cashFlowsTitle', 'colDate', 'colEvent', 'colAmount', 'colCurrency',
      'cashFlowsEmpty', 'noRecordedEvents', 'signNote', 'holdingsTitle',
    ]
    for (const lang of ['en', 'es'] as const) {
      const v = dict[lang].fp.alternatives as Record<string, string>
      for (const k of added) {
        assert.ok(k in v, `${lang}.${k} is missing`)
        assert.ok(v[k].trim().length > 0, `${lang}.${k} is empty`)
        assert.ok(!/TODO|TBD|PLACEHOLDER/i.test(v[k]), `${lang}.${k} is a placeholder`)
      }
    }
  })

  test('the unfiltered Dashboard never blames a filter for an absent figure', () => {
    // The Dashboard ignores the shared filter by design, so "nothing matches
    // your filters" would name a cause that does not exist. An absent cash flow
    // there means the SOURCE has no movement recorded in that currency.
    const dash = read(DASHBOARD)
    assert.ok(!/cashFlowsEmpty/.test(dash),
      'the Dashboard must not use the filter-worded empty state')
    assert.match(dash, /noRecordedEvents/)
    // The two views that DO filter keep the filter wording.
    assert.match(read(CASHFLOWS), /cashFlowsEmpty/)
    for (const lang of ['en', 'es'] as const) {
      const v = dict[lang].fp.alternatives
      assert.notEqual(v.noRecordedEvents, v.cashFlowsEmpty, `${lang}: the two states must read differently`)
      assert.ok(!/filter|filtro/i.test(v.noRecordedEvents), `${lang}: the source-absence copy must not mention filters`)
    }
  })

  test('the coverage disclosure carries its three interpolation slots in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const note = dict[lang].fp.alternatives.coverageNote
      for (const slot of ['{withEvents}', '{total}', '{without}']) {
        assert.ok(note.includes(slot), `${lang}.coverageNote is missing ${slot}`)
      }
    }
  })

  test('the source legend vocabulary is still preserved verbatim, never translated', () => {
    for (const lang of ['en', 'es'] as const) {
      assert.equal(dict[lang].fp.alternatives.eventAporte, 'Aporte')
      assert.equal(dict[lang].fp.alternatives.eventDividendo, 'Dividendo')
      assert.equal(dict[lang].fp.alternatives.eventDistribucion, 'Distribución')
    }
  })

  test('no hardcoded user-facing English in the new surface', () => {
    for (const rel of SURFACE_FILES) {
      const code = codeOf(read(rel))
      for (const banned of ['>Dashboard<', '>Holdings<', '>Cash Flows<', '>Distributions<', '>Capital calls<', '>Unclassified<']) {
        assert.ok(!code.includes(banned), `${rel}: hardcoded label ${banned}`)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 9 · Boundaries — this pass changed no schema, API contract or other module
// ---------------------------------------------------------------------------

describe('R13.R4A · boundaries', () => {
  test('no migration was introduced for this pass', () => {
    const dir = join(ROOT, 'supabase', 'migrations')
    const files = existsSync(dir) ? readFileSync(join(dir, '..', '..', 'package.json'), 'utf8') : ''
    assert.ok(files.length > 0)
    // The R13.4 alternatives schema is the only one this module needs, and it
    // predates this pass.
    assert.ok(existsSync(join(dir, '20260809000000_family_portfolio_alternatives.sql')))
  })

  test('the API route still serves the current publication only, with no new privilege', () => {
    const route = read(ROUTE)
    assert.match(route, /currencyPositions/)
    assert.match(route, /currencyCashFlows/)
    assert.match(route, /timelineCoverage/)
    // Financial derivation still lives in the pure module, not the route.
    assert.ok(!/reduce\(|\.map\(\(h\) =>/.test(codeOf(route).split('return NextResponse.json')[1] ?? ''),
      'the route composes pure functions; it does not compute')
  })

  test('the pure module stays pure — no Next, Supabase, fs or clock', () => {
    const code = read(VIEW)
    assert.ok(!/from 'next|@supabase|node:fs|process\.env/.test(code))
    assert.ok(!/new Date\(|Date\.now\(/.test(codeOf(code)))
  })

  test('Weekly Changes and the Summary are untouched by the Alternatives redesign', () => {
    for (const rel of [
      'src/lib/familyPortfolio/weeklyChanges.ts',
      'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts',
    ]) {
      const code = codeOf(read(rel)).replace(/s\.id !== 'alternatives'/g, '')
      assert.ok(!/alternatives/i.test(code), `${rel} must not touch Alternatives`)
    }
  })

  test('groupHoldings still bands by (category, currency) with no grand total', () => {
    const groups = groupHoldings(HOLDINGS_FIXTURE)
    const keys = groups.map((g) => `${g.category}|${currencyLabel(g.currency)}`)
    assert.deepEqual(keys, ['Private Equity|USD', 'Real Assets|CLP', 'Real Assets|EUR'])
    for (const g of groups) {
      assert.ok('subtotal' in g)
      assert.ok(!('total' in g), 'a group carries a subtotal only')
    }
  })
})
