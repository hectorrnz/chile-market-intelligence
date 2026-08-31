// R13.R5C.1 — the final Portfolio polish pass: the Overview card's typography
// and currency mark, the `US$` mark on every scope's AUM figure, the
// zero-to-dash normalisation across the module, and the repair of the
// "Data ingestion needs review" warning.
//
// Two kinds of check, both offline: real behavioural assertions where the code
// under test is pure (`evaluateMacroIngestionHealth`, `buildHero`), and
// source-scan contracts where it is JSX — the same technique
// `responsiveLayout.test.ts` and the R5B suite use. Neither proves pixel
// geometry; both make a silent revert impossible.
//
// NO PRIVATE DATA. Nothing below carries an amount, a holding or a scope label.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import {
  evaluateMacroIngestionHealth,
  evaluateOverallIngestionHealth,
  evaluateMarketIngestionHealth,
} from '../src/lib/observability/ingestionHealth.ts'
import { getEnabledBcchSeries, getEnabledFredSeries } from '../src/config/macroSeries.ts'
import { buildHero, buildPersonalHero } from '../src/lib/familyPortfolio/overview.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Source with comments stripped — a "must not appear" check has to run on CODE. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const HOME = read('src/app/page.tsx')
const HOME_CODE = code(HOME)
const MASKED = read('src/components/familyPortfolio/MaskedAmount.tsx')
const HERO = read('src/components/familyPortfolio/PortfolioValueHero.tsx')
const TABLE = read('src/components/familyPortfolio/HierarchicalTable.tsx')
const CSS = read('src/app/globals.css')

// ───────────────────────────────────────────────────────────────────────────
// 1 · Overview card polish
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.1 § 1 — Overview Portfolio card', () => {
  test('1 · the currency mark lives INSIDE the one guarded render path', () => {
    // The whole point of MaskedAmount is that no call site can assemble an
    // amount out of parts. A `US$` prefix concatenated in JSX beside an
    // unmasked number would be exactly that, so the prop belongs here.
    assert.match(MASKED, /currency\?: boolean/)
    assert.match(MASKED, /currency = false/)
    assert.match(MASKED, /currency \? 'US\$ ' : ''/)
    // …and the marked text still goes through PrivacyValue, not around it.
    // R13.R5C.3 — `text` is now one arm of a ternary INSIDE the mask (the other
    // is the zero mark), so both arms are guarded rather than only this one.
    assert.match(MASKED, /<PrivacyValue masked=\{masked\}[\s\S]*?: text\}[\s\S]*?<\/PrivacyValue>/)
  })

  test('2 · the mark is US$, never a bare $', () => {
    // A bare `$` in a Chilean frame of reference reads as pesos — the exact
    // ambiguity this mark exists to remove.
    const marks = MASKED.match(/'[^']*\$ '/g) ?? []
    assert.ok(marks.length > 0, 'a currency mark must exist')
    for (const m of marks) assert.match(m, /US\$/)
  })

  test('3 · the Overview hero renders marked and one type step up', () => {
    assert.match(
      HOME_CODE,
      /<MaskedAmount\s+value=\{fpHero\?\.totalValue \?\? null\}[\s\S]{0,200}?currency[\s\S]{0,200}?ui-kpi-hero-lg/,
    )
  })

  test('4 · the larger step is a declared token, not a hardcoded size', () => {
    assert.match(CSS, /--fs-kpi-hero-lg:\s*clamp\(/)
    assert.match(CSS, /\.ui-kpi-hero-lg\s*\{[\s\S]*?font-size:\s*var\(--fs-kpi-hero-lg\)/)
    // It extends the existing scale: same weight, leading and tracking tokens
    // as `.ui-kpi-hero`, so the two steps cannot drift into two systems.
    const block = /\.ui-kpi-hero-lg\s*\{([\s\S]*?)\}/.exec(CSS)?.[1] ?? ''
    assert.match(block, /var\(--fw-value\)/)
    assert.match(block, /var\(--tracking-hero\)/)
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,}|\d+px/)
  })

  test('5 · the return beside the amount NAMES its period', () => {
    // The Summary strip may use the bare "Return" because its band title says
    // Weekly. This card has no such title, so the label carries the horizon.
    assert.match(HOME_CODE, /formatRatioPct\(fpHero\.weeklyReturn\)\}\s*\$\{t\.fp\.overview\.weeklyReturn\}/)
    assert.doesNotMatch(HOME_CODE, /t\.fp\.overview\.metricReturn/)
    assert.equal(dict.en.fp.overview.weeklyReturn, 'Weekly Return')
  })

  test('6 · the P&L beneath it names the same period', () => {
    assert.match(HOME_CODE, /t\.fp\.overview\.weeklyProfit/)
    assert.doesNotMatch(HOME_CODE, /t\.fp\.overview\.metricProfit/)
  })

  test('7 · P&L, YTD Return, YTD P&L and Rev. all step up together', () => {
    // One size for the whole supporting row — a partial bump would read as an
    // accident rather than a hierarchy. Exactly four figures, exactly one size
    // token, and nothing else on the page borrows it.
    assert.equal((HOME.match(/ui-card-value/g) ?? []).length, 4)
    for (const re of [
      /value=\{fpHero\?\.weeklyDifference \?\? null\}[\s\S]{0,240}?ui-card-value/,
      /value=\{fpHero\?\.ytdProfit \?\? null\}[\s\S]{0,240}?ui-card-value/,
      /label=\{t\.fp\.overview\.ytdReturn\}[^\n]*valueClass="ui-card-value"/,
      /label=\{t\.fp\.portfolio\.revisionShort\}[^\n]*valueClass="ui-card-value"/,
    ]) {
      assert.match(HOME_CODE, re)
    }
  })

  test('8 · the size step is opt-in — the component still defaults to text-sm', () => {
    // The prop was added rather than the size changed, so a future caller
    // elsewhere on the Overview inherits the original scale and this card's
    // lift stays this card's.
    assert.match(HOME, /valueClass = 'text-sm'/)
    assert.match(HOME, /valueClass\?: string/)
    // Every instance of the size token is an explicit opt-in.
    assert.equal(
      (HOME_CODE.match(/<SnapshotStat/g) ?? []).length,
      (HOME_CODE.match(/valueClass="ui-card-value"/g) ?? []).length,
    )
  })

  test('9 · the added metric is READ from the canonical hero, not computed', () => {
    assert.match(HOME_CODE, /value=\{fpHero\?\.ytdProfit \?\? null\}/)
    // No arithmetic, no second source, no static fallback anywhere on the card.
    assert.doesNotMatch(HOME_CODE, /fpHero[\s\S]{0,40}?[*/+-]\s*fpHero/)
    assert.doesNotMatch(HOME_CODE, /evolution/i)
  })

  test('10 · buildHero reads YTD P&L off the SAME basis as YTD return', () => {
    const rows = [
      { basis: 'with_chilean_equities', metric: 'ytd_return', value: 0.12, boundRowKey: 'main.total' },
      { basis: 'with_chilean_equities', metric: 'ytd_profit', value: 16_000_000 },
      { basis: 'ex_chilean_equities', metric: 'ytd_profit', value: 13_000_000 },
    ] as never
    const hero = buildHero({ totalRow: null, subtotalRow: null } as never, rows)
    assert.equal(hero.ytdProfit, 16_000_000, 'must be the inclusive basis, not the ex-Chile one')
    assert.equal(hero.ytdReturn, 0.12)
  })

  test('11 · a personal scope reads its own `total` basis', () => {
    const rows = [{ basis: 'total', metric: 'ytd_profit', value: 4_321_057 }] as never
    const hero = buildPersonalHero({ totalRow: null, constituentRows: [] } as never, rows)
    assert.equal(hero.ytdProfit, 4_321_057)
  })

  test('12 · a missing metric is null, never zero', () => {
    const hero = buildHero({ totalRow: null, subtotalRow: null } as never, [] as never)
    assert.equal(hero.ytdProfit, null)
  })

  test('13 · still ONE as-of on the surface', () => {
    assert.equal((HOME.match(/fpPublication\.asOfDate/g) ?? []).length, 1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2 · US$ on every scope's AUM figure
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.1 § 2.1 — the AUM mark', () => {
  test('14 · one component marks all four scopes', () => {
    assert.match(HERO, /<MaskedAmount[\s\S]*?currency[\s\S]*?ui-kpi-hero/)
    // Main and each personal Summary render through this one hero.
    assert.equal((read('src/app/portfolio/page.tsx').match(/<PortfolioValueHero/g) ?? []).length, 1)
  })

  test('15 · the printed sheet carries the same mark', () => {
    assert.match(
      read('src/components/familyPortfolio/SummaryPrintSheet.tsx'),
      /<MaskedAmount value=\{totalValue\}[^/]*currency/,
    )
  })

  test('16 · the dense tables are NOT marked', () => {
    // A unit repeated in every cell of a four-column hierarchy is noise, and
    // the scope's own value above already states it.
    assert.doesNotMatch(code(TABLE), /US\$/)
  })

  test('17 · Alternatives is deliberately unmarked — it is not USD-only', () => {
    // Alternatives events carry their OWN currency and the module forbids
    // cross-currency totals, so a blanket US$ there would be a false claim.
    // It labels each figure with its real currency instead.
    for (const p of [
      'src/app/portfolio/alternatives/page.tsx',
      'src/components/familyPortfolio/AlternativesDrilldowns.tsx',
      'src/components/familyPortfolio/AlternativesCashFlowChart.tsx',
    ]) {
      const alt = code(read(p))
      // `currency` as a bare JSX prop — on its own line, or inline before the
      // next prop / the tag close.
      assert.doesNotMatch(alt, /^\s*currency\s*$/m, p)
      assert.doesNotMatch(alt, /\}\s+currency[\s/>]/, p)
    }
    assert.match(read('src/app/portfolio/alternatives/page.tsx'), /currencyLabel\(/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 3 · Zero-display normalisation
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.1 § 2.2 — zeros that mean nothing', () => {
  test('18 · the two marks stay distinct: `-` is nothing, `—` is unestablished', () => {
    // The frozen semantic, and the one part of this section R13.R5C.2 did not
    // widen. A zero flow and an unreadable flow must never collapse into the
    // same mark.
    assert.match(MASKED, /if \(value === null \|\| !Number\.isFinite\(value\)\)[\s\S]{0,400}?—/)
    // R13.R5C.3 — still two distinct marks; the zero mark simply no longer sits
    // in an early return, because privacy now outranks it (see § 4 below).
    assert.match(MASKED, /zeroDash && roundsToZeroAt/)
    assert.match(MASKED, />-</)
  })

  // 19-24 · SUPERSEDED BY R13.R5C.2, and moved rather than deleted.
  //
  // This stage read the owner's rule too narrowly: it dashed changes, flows and
  // "unoccupied taxonomy slot" rows, and deliberately kept a numeric `0` on
  // levels — a liquidated holding, an undrawn commitment of nothing, a
  // reconciliation that left nothing over. The owner's rule is literal and
  // applies to every user-visible numeric zero, so the per-call-site decisions
  // those six tests locked no longer exist to be asserted: the flag is gone
  // from every call site and the renderer applies the rule by default.
  //
  // The contract they defended is now in `tests/portfolioR5c2ZeroDisplay.test.ts`
  // in its widened form, together with the reconciliation proofs that show the
  // widening changed no arithmetic. Only the two marks' distinctness, tested
  // above at 18, belongs to both stages and stays here.

  test('25 · the legend describes the module-wide convention, in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const note = dict[lang].fp.weeklyChanges.zeroDashNote
      assert.ok(note.includes('“-”'), lang)
      assert.ok(note.includes('“—”'), lang)
      // No longer scoped to "the change columns" — the mark now also appears
      // in the value columns.
      assert.doesNotMatch(note, /change columns|columnas de variación/)
    }
  })

  test('26 · both hierarchy tables now show that legend', () => {
    for (const p of ['src/app/portfolio/page.tsx', 'src/app/portfolio/holdings/page.tsx']) {
      assert.match(read(p), /t\.fp\.weeklyChanges\.zeroDashNote/, p)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 4 · The data-ingestion warning
// ───────────────────────────────────────────────────────────────────────────

const RUN_OK = { status: 'success', startedAt: '2026-08-27T13:10:22Z', rowsFailed: 0 }

describe('R13.R5C.1 § 4 — ingestion health', () => {
  test('27 · an indicator no pipeline writes is not scored as stale', () => {
    // `dxy` and `bitcoin` are resolved live from Yahoo at request time and
    // were never designed to accumulate observations; `litio-spot`, `brent`,
    // `credito` and `pib` have no verified live series at all. Six standing
    // false alarms that drowned out the real ones.
    const observations = [
      { indicatorId: 'tpm', maxDate: '2026-08-27' },
      { indicatorId: 'dxy', maxDate: null },
      { indicatorId: 'bitcoin', maxDate: null },
    ]
    const scoped = evaluateMacroIngestionHealth({
      latestRun: RUN_OK,
      observations,
      ingestedIndicatorIds: ['tpm'],
      today: '2026-08-27',
    })
    assert.deepEqual(scoped.staleIndicators, [])
    assert.deepEqual(scoped.notIngestedIndicators.sort(), ['bitcoin', 'dxy'])
    assert.equal(scoped.indicatorsTotal, 1)
    assert.equal(scoped.indicatorsHealthy, 1)
    assert.equal(scoped.status, 'healthy')
  })

  test('28 · a GENUINELY stale ingested indicator is still flagged', () => {
    // The repair must not become a way to silence real staleness.
    const health = evaluateMacroIngestionHealth({
      latestRun: RUN_OK,
      observations: [{ indicatorId: 'us10y', maxDate: '2026-07-17' }],
      ingestedIndicatorIds: ['us10y'],
      today: '2026-08-27',
    })
    assert.deepEqual(health.staleIndicators, ['us10y'])
    assert.notEqual(health.status, 'healthy')
  })

  test('29 · omitting the set preserves the original behaviour exactly', () => {
    const health = evaluateMacroIngestionHealth({
      latestRun: RUN_OK,
      observations: [{ indicatorId: 'dxy', maxDate: null }],
      today: '2026-08-27',
    })
    assert.deepEqual(health.staleIndicators, ['dxy'])
    assert.deepEqual(health.notIngestedIndicators, [])
  })

  test('30 · the scored set comes from the series registry, not a second list', () => {
    // One definition of "ingested", shared with macroIndicatorDbCoverage.
    const ids = [...getEnabledBcchSeries(), ...getEnabledFredSeries()].map(s => s.fallbackStaticId)
    assert.ok(ids.includes('us10y'))
    assert.ok(ids.includes('tpm'))
    for (const notIngested of ['dxy', 'bitcoin', 'litio-spot', 'brent', 'credito', 'pib']) {
      assert.ok(!ids.includes(notIngested), notIngested)
    }
    for (const p of [
      'src/app/api/health/ingestion/route.ts',
      'src/app/api/cron/check-ingestion-health/route.ts',
    ]) {
      const src = read(p)
      assert.match(src, /getEnabledBcchSeries\(\), \.\.\.getEnabledFredSeries\(\)/, p)
      assert.match(src, /ingestedIndicatorIds/, p)
    }
  })

  test('31 · the status endpoint reports what it chose not to score', () => {
    assert.match(read('src/app/api/health/ingestion/route.ts'), /notIngestedIndicators:\s*macroHealth\.notIngestedIndicators/)
  })

  test('32 · a market run that partially failed is NOT suppressed', () => {
    // An unrelated valid warning. The owner asked for the ingestion warning to
    // be repaired, not for the warning mechanism to be blunted.
    const market = evaluateMarketIngestionHealth({
      latestRun: { status: 'partial_success', startedAt: '2026-08-27T00:59:48Z', rowsFailed: 11 },
      latestSnapshotDate: '2026-08-27',
      latestSnapshotType: 'midday',
      today: '2026-08-27',
    })
    assert.equal(market.status, 'warning')
    const overall = evaluateOverallIngestionHealth(
      evaluateMacroIngestionHealth({ latestRun: RUN_OK, observations: [], ingestedIndicatorIds: [], today: '2026-08-27' }),
      market,
    )
    assert.notEqual(overall.overallStatus, 'healthy')
  })

  test('33 · FRED macro is scheduled, on its own slot', () => {
    // The root cause of the six stale US series: persisted FRED observations
    // only ever advanced when the job was run by hand.
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
    const fred = vercel.crons.find(c => c.path === '/api/cron/ingest-fred-macro')
    assert.ok(fred, 'FRED macro ingestion must be scheduled')
    assert.match(fred!.schedule, /1-5$/, 'weekdays, like its BCCh twin')
    const bcch = vercel.crons.find(c => c.path === '/api/cron/ingest-bcch-macro')
    assert.notEqual(fred!.schedule, bcch!.schedule, 'must not contend for the same window')
    // The undocumented-HTML-surface crons stay unscheduled — that policy is
    // about surface stability and still applies to them.
    for (const unscheduled of ['/api/cron/financials/cmf-xbrl', '/api/cron/financials/yahoo']) {
      assert.ok(!vercel.crons.some(c => c.path === unscheduled), unscheduled)
    }
  })

  test('34 · lagging series get an incremental window wide enough to reach them', () => {
    // A 14-day window can never store a print dated months earlier, however
    // often it runs — the bug BCCh fixed for monthlies and FRED had not.
    const src = read('src/lib/ingestion/fredMacroIngestion.ts')
    const monthly = Number(/monthly:\s*(\d+)/.exec(src)?.[1])
    const quarterly = Number(/quarterly:\s*(\d+)/.exec(src)?.[1])
    const evaluator = read('src/lib/observability/ingestionHealth.ts')
    const monthlyStale = Number(/MONTHLY_STALE_DAYS = (\d+)/.exec(evaluator)?.[1])
    const quarterlyStale = Number(/QUARTERLY_STALE_DAYS = (\d+)/.exec(evaluator)?.[1])
    // The window must outrun the threshold, or the evaluator flags a series
    // the ingestion structurally cannot refresh.
    assert.ok(monthly > monthlyStale, `${monthly} must exceed ${monthlyStale}`)
    assert.ok(quarterly > quarterlyStale, `${quarterly} must exceed ${quarterlyStale}`)
    assert.match(src, /opts\.mode === 'incremental' && widened !== undefined/)
    // Same constant BCCh already settled on, so the two cannot drift.
    assert.equal(monthly, Number(/MONTHLY_INCREMENTAL_DAYS_BACK = (\d+)/.exec(read('src/lib/ingestion/bcchMacroIngestion.ts'))?.[1]))
  })

  test('35 · the wider window costs no extra fetch', () => {
    // `fetchFrom` is already a year or more for the yoy/mom bases; only the
    // STORED range was narrow.
    assert.match(read('src/lib/ingestion/fredMacroIngestion.ts'), /fetchFrom = yearsAgoIso\(EXTRA_YEARS_CONTEXT\)/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 5 · Route ownership — the decision, recorded
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.1 § 3 — canonical route', () => {
  // POST-R13.5 — R13.R5C.1 section 3 recorded the canonical-route move as
  // BLOCKED because `/portfolio` was physically occupied by the legacy tracker,
  // which that stage was told not to touch. This stage was authorized to retire
  // it, so these three tests now record the blocker as CLEARED — kept in place
  // rather than deleted, because the point of section 5 was to hand the next
  // stage a fact, and "it was resolved this way" is the fact it hands on.
  test('36 · /portfolio is owned by the released module, blocker cleared', () => {
    // Why the canonical-route move is BLOCKED rather than half-done: the path
    // POST-R13.5 — R13.R5C.1 section 3 recorded the canonical-route move as
    // BLOCKED because `/portfolio` was physically occupied by the legacy tracker,
    // which that stage was told not to touch. This stage was authorized to retire
    // it, so tests 36-38 now record the blocker as CLEARED, kept in place rather
    // than deleted: the point of section 5 was to hand the next stage a fact, and
    // "it was resolved this way" is the fact it hands on.
    assert.ok(readFileSync(join(ROOT, 'src/app/portfolio/page.tsx'), 'utf8').includes('R13.R2'))
    assert.ok(!existsSync(join(ROOT, 'src/app/api/portfolios')), 'the legacy tracker is retired')
  })

  test('37 · the module keeps ONE canonical route; the old path is a redirect only', () => {
    const nav = read('src/lib/navigation.ts')
    assert.match(nav, /href: '\/portfolio'/)
    // Navigation still names exactly ONE destination, which is the ambiguity
    // R13.R5C.1 refused to create. The compatibility redirect lives in
    // next.config.ts, outside the navigation model, and no link points at it.
    assert.doesNotMatch(code(nav), /rewrite/i)
    assert.doesNotMatch(code(nav), /family-portfolio/)
    assert.doesNotMatch(code(HOME), /href="\/family-portfolio"/)
  })

  test('38 · every user-visible entry point still lands on the module', () => {
    assert.match(HOME_CODE, /href=\{PORTFOLIO_SUMMARY\}/)
    assert.doesNotMatch(read('src/lib/navigation.ts'), /matchPrefixes: \['\/portfolio'\]/)
  })
})
