// R10 — NMI institutional Home command center.
//
// Home (src/app/page.tsx) was the last pre-Fable route. R10 rebuilt it as the
// primary daily decision surface; after the R10.3 width/density rebalance the
// order is: executive command strip → hero row (portfolio snapshot ·
// structured-notes snapshot · Current Actions) → Row A (Macro · Upcoming
// Events · Watchlist) → Row B (Chilean Rates · Sector Heat Map · Markets) →
// News full-width. Every pre-R10 module remains; the new modules consume ONLY
// sources the repository already served.
//
// These tests pin: route/scope, composition, data honesty (states, sources,
// no fabrication), portfolio reuse + privacy masking, structured-notes
// semantics, the merged events timeline, accessibility, localization parity,
// performance discipline, security boundaries, and regression scope.
//
// Convention: bans that a comment could trip run on the comment-stripped
// `code()` view; identity/JSX assertions run on the raw source.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dict } from '../src/lib/i18n.ts'
import { classifyPath, requiresApprovedSession, PUBLIC_PAGE_PATHS } from '../src/lib/auth/accessPolicy.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const HOME = read('src/app/page.tsx')
const HOME_CODE = code(HOME)

// ── 1-8 · Route, shell and platform scope ───────────────────────────────────

describe('R10 · route and platform scope', () => {
  test('1-2. the canonical route remains / — no /home, /dashboard or /overview twin', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/page.tsx')))
    for (const twin of ['src/app/home', 'src/app/dashboard', 'src/app/overview']) {
      assert.ok(!existsSync(join(ROOT, twin)), `${twin} must not exist`)
    }
    assert.doesNotMatch(HOME_CODE, /redirect\(/)
  })

  test('3-4. the existing shell and navigation are untouched', () => {
    const shell = read('src/components/layout/AppShell.tsx')
    assert.match(shell, /<TopBar \/>/)
    assert.match(shell, /<SecondaryNav \/>/)
    // Home still renders inside the full chrome — never a bare route.
    assert.match(read('src/components/layout/ShellGate.tsx'), /BARE_ROUTES = new Set\(\['\/login', '\/forgot-password', '\/auth\/reset-password'\]\)/)
    // No second navigation model on the page at all — R10.2 removed the
    // workspace launcher because it duplicated the top nav rail's routes.
    assert.equal((HOME.match(/<nav /g) ?? []).length, 0)
  })

  test('5-6. no database migration and no auth change', () => {
    // The newest pre-R10 migration is 20260803000000_structured_notes_custodian.
    const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    assert.ok(migrations.every((f) => f < '20260804'), 'R10 adds no migration')
    assert.deepEqual([...PUBLIC_PAGE_PATHS], ['/login', '/forgot-password', '/auth/reset-password'])
    assert.equal(classifyPath('/'), 'private_page')
    assert.ok(requiresApprovedSession('/'))
  })

  test('7-8. no dependency added, no remote-resource surface touched', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2',
    ])
    assert.doesNotMatch(HOME_CODE, /supabase|createAdminClient|service_role|SERVICE_ROLE/i)
  })
})

// ── 16-27 · Composition ─────────────────────────────────────────────────────

describe('R10 · composition — a Fable command center, not a reskin', () => {
  test('16. the pre-R10 page anatomy is gone: PageHeader replaces the custom h1, pinning is gone', () => {
    assert.match(HOME, /import \{ PageHeader \} from '@\/components\/fable\/PageHeader'/)
    assert.match(HOME, /<PageHeader/)
    assert.doesNotMatch(HOME_CODE, /<h1/)
    assert.doesNotMatch(HOME_CODE, /pinH|macroRef|heatRef|useLayoutEffect/)
  })

  test('17. the executive command strip exists — date, data health, attention count', () => {
    assert.match(HOME, /aria-label=\{t\.home\.stripLabel\}/)
    assert.match(HOME, /t\.home\.stripHealth/)
    assert.match(HOME, /t\.home\.stripAttention/)
    assert.match(HOME, /fetch\('\/api\/health\/ingestion'/)
    assert.match(HOME, /t\.settings\.sources\.status/)
    // NOT a welcome banner: no greeting or marketing copy anywhere.
    for (const d of [dict.en.home, dict.es.home]) {
      const all = Object.values(d).join(' ')
      assert.doesNotMatch(all, /welcome|good morning|bienvenido|buenos días/i)
    }
  })

  test('18-22. every section renders: portfolio, notes, actions, merged macro, events, watchlist, rates, heat, markets, news', () => {
    // R10.1 merged the pulse strip, the banded macro card and the FX band
    // into ONE Macro card (pulse-style rows in Chile/US bands) — one surface,
    // no duplicated indicator; see the dedicated R10.1 test below.
    for (const marker of [
      'formatCLP(pfTotals.totalMarketValue)',       // portfolio snapshot
      'book.summary.activeNotes',                   // structured-notes snapshot
      '<CurrentActions actions={actions}',          // attention card
      't.home.macroTitle',                          // merged macro card title
      't.home.eventsTitle',                         // events timeline
      't.home.macroSourceCl',                       // merged macro card (Chile band footer)
      't.home.watchlistTitle',                      // watchlist table
      't.home.chileanRates',                        // rates DnD list
      't.home.sectorHeatMap',                       // heat map
      't.home.marketsTitle',                        // markets list
      't.home.newsTitle',                           // news feed
    ]) {
      assert.ok(HOME.includes(marker), `${marker} must render`)
    }
  })

  test('R10.1 — one macro surface: pulse strip, banded card and FX band merged, nothing duplicated', () => {
    // Each provider band is badged exactly once — the old standalone pulse
    // card and the watchlist FX band would each have added a second badge.
    assert.equal((HOME.match(/DataSourceBadge status=\{macroStatus\}/g) ?? []).length, 1)
    assert.equal((HOME.match(/DataSourceBadge status=\{usMacroStatus\}/g) ?? []).length, 1)
    // Copper joined Chile and UST10 leads US, so no indicator id appears in
    // two rendered lists.
    assert.match(HOME, /CHILE_MACRO_IDS = \['tpm', 'usdclp', 'cobre-lme', 'ipc-anual', 'imacec-anual', 'pib', 'desempleo'\]/)
    assert.match(HOME, /US_MACRO_IDS = \['us10y', 'fed-funds', 'us-cpi-anual', 'us-gdp', 'us-unemployment', 'dxy'\]/)
    // FX renders only its non-curated extras (EUR/CLP) inside the Chile band.
    assert.match(HOME, /fxExtra = fxRows\.filter\(fx => !CHILE_MACRO_IDS\.includes\(fx\.id\)\)/)
    // The standalone pulse card (and its title key) is gone.
    assert.doesNotMatch(HOME, /pulseTitle/)
    assert.equal((dict.en.home as Record<string, string>).pulseTitle, undefined)
  })

  test('23 (superseded by R10.2). the workspace launcher is gone — the top nav rail is the only navigation', () => {
    // R10.2 (user-directed): the launcher duplicated the routes already in the
    // top pill rail, so it was removed. A real phase boundary moving, not a
    // relaxed assertion — the strip keeps date/health/attention only.
    assert.doesNotMatch(HOME, /t\.home\.launcher/)
    assert.equal((dict.en.home as Record<string, string>).launcher, undefined)
    assert.equal((dict.es.home as Record<string, string>).launcher, undefined)
    assert.doesNotMatch(HOME_CODE, /<img|<svg[^>]*icon/i)
  })

  test('24-26. deliberate hero asymmetry on Fable primitives — no page-local design system', () => {
    // The hero row carries three DIFFERENT flex weights (Fable Overview Row A).
    // (R10.3 moved the analytical rows to peer grids — see the R10.3 describe —
    // but the hero keeps its asymmetric composition.)
    assert.match(HOME, /flex: '1\.7 1 400px'/)
    assert.match(HOME, /flex: '1\.15 1 300px'/)
    assert.match(HOME, /flex: '1 1 280px'/)
    // Shared primitives are consumed, not re-implemented.
    for (const imp of [
      "import { GlassSurface } from '@/components/fable/GlassSurface'",
      "import { TableCard } from '@/components/fable/TableCard'",
      "import { AsyncState } from '@/components/fable/AsyncState'",
      "import { ChangeIndicator } from '@/components/fable/ChangeIndicator'",
      "import { CurrentActions, type CurrentAction } from '@/components/fable/CurrentActions'",
      "import { Reveal } from '@/components/fable/motion'",
    ]) {
      assert.ok(HOME.includes(imp), imp)
    }
    assert.doesNotMatch(HOME_CODE, /backdrop-filter|nv-glass-\w+/)
    // No raw 6-digit hex anywhere (the news rows' #fff is the one documented
    // News-Module-Rule exception and is 3-digit).
    assert.doesNotMatch(HOME_CODE, /#[0-9a-fA-F]{6}\b/)
  })

  test('27. Reveal choreography is staggered and coherent', () => {
    const delays = [...HOME.matchAll(/<Reveal delayMs=\{(\d+)\}/g)].map((m) => Number(m[1]))
    assert.ok(delays.length >= 5, 'staggered reveals')
    for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1], 'delays increase down the page')
  })
})

// ── R10.3 · width & density rebalance (user-directed) ───────────────────────

describe('R10.3 · wider canvas, two analytical peer rows, News below', () => {
  test('the desktop canvas is wider via the ONE shell token — no page-local width override', () => {
    // The width restriction provably lived in the shell token; R10.3 widened
    // it 1560 → 1680 so only the refined 24px gutter remains at 1728, and
    // TopBar/SecondaryNav/<main> stay aligned to the same content boundary.
    assert.match(read('src/app/globals.css'), /--content-max-w:\s*1680px/)
    assert.match(read('src/components/layout/AppShell.tsx'), /max-w-\(--content-max-w\)/)
    // The page root fills the shell; Home never declares a canvas width of
    // its own (cell-level truncation caps are not canvas widths).
    assert.match(HOME, /<div className="w-full space-y-4">/)
    assert.doesNotMatch(HOME_CODE, /max-w-screen|content-max-w/)
  })

  test('Row A is Macro · Upcoming Events · Watchlist, in order, in one responsive grid', () => {
    const rowA = HOME.slice(HOME.indexOf('Row A (R10.3)'), HOME.indexOf('Row B (R10.3)'))
    const iMacro = rowA.indexOf('t.home.macroTitle')
    const iEvents = rowA.indexOf('t.home.eventsTitle')
    const iWatch = rowA.indexOf('t.home.watchlistTitle')
    assert.ok(iMacro > -1 && iEvents > iMacro && iWatch > iEvents, 'Macro → Events → Watchlist')
    assert.match(rowA, /className=\{ANALYTIC_ROW\}/)
    // Recently Reported stays inside the Events card, below Upcoming, inside
    // the card-local scroll — it can never dominate the card.
    assert.ok(rowA.includes('t.home.recentlyReported'))
  })

  test('Row B is Chilean Rates · Sector Heat Map · Markets, in order; News sits below both rows', () => {
    const rowB = HOME.slice(HOME.indexOf('Row B (R10.3)'))
    const iRates = rowB.indexOf('t.home.chileanRates')
    const iHeat = rowB.indexOf('t.home.sectorHeatMap')
    const iMkts = rowB.indexOf('t.home.marketsTitle')
    const iNews = rowB.indexOf('t.home.newsTitle')
    assert.ok(iRates > -1 && iHeat > iRates && iMkts > iHeat, 'Rates → Heat → Markets')
    assert.ok(iNews > iMkts, 'News renders after Row B, full width')
    assert.match(rowB, /className=\{ANALYTIC_ROW\}/)
  })

  test('three similar-weight columns at wide desktop; a deliberate 2-col recomposition at lg', () => {
    assert.match(HOME, /ANALYTIC_ROW = 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch'/)
    assert.match(HOME, /ANALYTIC_SPAN = 'lg:col-span-2 xl:col-span-1'/)
    assert.equal((HOME.match(/\{ANALYTIC_ROW\}/g) ?? []).length, 2)
    // Exactly two consumers of the span recipe — the Watchlist wrapper (Row A)
    // and the Markets card (Row B) — so at lg no card sits isolated.
    assert.equal((HOME.match(/ANALYTIC_SPAN\b/g) ?? []).length, 3, '1 declaration + 2 consumers')
    // The hero row is untouched — still the asymmetric wrapping flex row.
    assert.match(HOME, /flex flex-wrap items-stretch gap-4/)
  })

  test('cards keep similar practical heights via a shared CSS cap — no measured-height JS, no data removed', () => {
    assert.match(HOME, /CARD_LIST_MAX_H = 420/)
    assert.equal((HOME.match(/maxHeight: CARD_LIST_MAX_H/g) ?? []).length, 5,
      'macro, events, rates, heat and markets all cap and scroll in-card')
    assert.match(HOME, /maxHeight=\{420\}/) // the Watchlist TableCard's own cap
    assert.doesNotMatch(HOME_CODE, /ResizeObserver|useLayoutEffect/)
    // The Macro card stays a compact Home summary with the deep link — it
    // never reproduces the full Macro page (no history modal, no chart).
    assert.match(HOME, /href="\/macro"/)
    assert.doesNotMatch(HOME_CODE, /getMacroHistoryForTimeframe|ModalShell/)
  })

  test('heat tiles recomposed for the narrower card: 2-across, odd counts span, nothing clipped', () => {
    assert.match(HOME, /grid grid-cols-2 gap-2/)
    assert.doesNotMatch(HOME, /sm:grid-cols-3/)
    assert.match(HOME, /sectors\.length % 2 === 1/)
    assert.match(HOME, /col-span-2/)
  })

  test('the relayout added no fetch, no polling and no hidden duplicate responsive tree', () => {
    assert.doesNotMatch(HOME_CODE, /lg:hidden|md:hidden|sm:hidden|xl:hidden/)
    // Pins the total raw-fetch surface (helpers are pinned per-endpoint in
    // test 87) so a relayout can never quietly add a network call.
    assert.equal((HOME_CODE.match(/fetch\(/g) ?? []).length, 6)
  })
})

// ── 9-15 · Data honesty ─────────────────────────────────────────────────────

describe('R10 · data honesty — real sources, explicit states, no fabrication', () => {
  test('9. every fetched endpoint is a real, existing application endpoint', () => {
    const endpoints = [...HOME_CODE.matchAll(/fetch\('([^']+)'/g)].map((m) => m[1])
    const known = new Set(['/api/watchlists', '/api/portfolios', '/api/structured-notes', '/api/health/ingestion'])
    for (const e of endpoints) assert.ok(known.has(e), `unknown endpoint ${e}`)
    // And each corresponding route handler exists.
    assert.ok(existsSync(join(ROOT, 'src/app/api/portfolios/route.ts')))
    assert.ok(existsSync(join(ROOT, 'src/app/api/structured-notes/route.ts')))
    assert.ok(existsSync(join(ROOT, 'src/app/api/health/ingestion/route.ts')))
    assert.ok(existsSync(join(ROOT, 'src/app/api/watchlists/route.ts')))
  })

  test('10-13. no mock financial data, no hardcoded KPI, no fabricated timestamp or source', () => {
    assert.doesNotMatch(HOME_CODE, /news_mock|Math\.random|sample|mock/i)
    // Every as-of is a variable read from real payloads — never a literal.
    assert.doesNotMatch(HOME_CODE, /asOf=\{['"]/)
    // Sources rendered only through TableSourceFooter with dictionary names.
    assert.doesNotMatch(HOME_CODE, /Bloomberg|CoinMarketCap/)
  })

  test('14. health is never claimed without data — a failed check renders its own word', () => {
    assert.match(HOME, /healthState === 'ready' && health/)
    assert.match(HOME, /t\.home\.stripHealthUnavailable/)
    // The attention item for ingestion fires only on a genuinely non-healthy,
    // non-unknown run.
    assert.match(HOME, /health\.overallStatus !== 'healthy' && health\.overallStatus !== 'unknown'/)
  })

  test('15. every async module distinguishes loading / success / empty / error', () => {
    assert.match(HOME, /pfState === 'loading' && <AsyncState kind="loading"/)
    assert.match(HOME, /pfState === 'error' && <AsyncState kind="error"/)
    assert.match(HOME, /bookState === 'unavailable' && <AsyncState kind="unavailable"/)
    // Empty is a REAL zero, separate from failure.
    assert.match(HOME, /pfDetail\.positions\.length === 0/)
    assert.match(HOME, /book\.summary\.totalNotes === 0/)
    assert.match(HOME, /t\.home\.eventsEmpty/)
  })

  test('R10.2 — no charts on Home: the macro rows render values only', () => {
    // User-directed (R10.2): the macro rows carry no graphs, so the 1Y
    // history fetch and the Sparkline primitive are gone entirely — Home
    // renders no trend from ANY source, live or static. (This supersedes the
    // R10 "status-gated sparkline" contract: the honest-trend rule is now
    // enforced by there being no trend at all.)
    assert.doesNotMatch(HOME_CODE, /Sparkline|fetchMacroHistory|PULSE_IDS/)
    assert.doesNotMatch(HOME_CODE, /getStockHistoryForTimeframe|stockHistory/)
  })
})

// ── 28-35 · Portfolio integration and privacy ───────────────────────────────

describe('R10 · portfolio snapshot — existing calculations, masked amounts', () => {
  test('28-29. reuses the exact valuation helpers /portfolio uses — no second derivation', () => {
    assert.match(HOME, /import \{ valuePositions, calculatePortfolioTotals, type LatestPrice, type PortfolioTotals \} from '@\/lib\/portfolio\/valuation'/)
    assert.match(HOME, /calculatePortfolioTotals\(valued\)/)
    assert.match(HOME, /valuePositions\(/)
    // The overlay builds the price map the same way the Portfolio page does.
    assert.match(HOME, /lv\?\.price \?\? p\.latestPrice/)
    // No inline arithmetic re-derives a total anywhere on Home.
    assert.doesNotMatch(HOME_CODE, /quantity \*|\* p\.quantity|averageCost \*/)
  })

  test('30-31. every private amount renders through the shared boundary', () => {
    for (const expr of [
      'formatCLP(pfTotals.totalMarketValue)',
    ]) {
      const at = HOME.indexOf(expr)
      assert.ok(at > -1, `${expr} must render`)
      assert.ok(HOME.slice(Math.max(0, at - 220), at).includes('<PrivacyValue masked={masked}>'), `${expr} must be masked`)
    }
    for (const stat of [
      'label={t.portfolio.unrealizedPnL}',
      'label={t.portfolio.totalCostBasis} value={formatCLP(pfTotals.totalCostBasis)}',
      'label={t.portfolio.cashBalance} value={formatCLP(pfDetail.cashSummary.netCashBalance)}',
      'label={t.portfolio.realizedPnL} value={formatCLP(pfDetail.realizedPnl.totalRealizedPnl)}',
    ]) {
      const at = HOME.indexOf(stat)
      assert.ok(at > -1, `${stat} must render`)
      assert.ok(HOME.slice(at, at + 400).includes('masked={masked}'), `${stat} must carry the mask`)
    }
    // One page-level read of the ONE shared store; the key is never named.
    assert.equal((HOME.match(/const \[masked\] = usePrivacyMode\(\)/g) ?? []).length, 1)
    assert.doesNotMatch(HOME_CODE, /cmi\.privacyMode|localStorage/)
  })

  test('32-34. public values stay visible; the mask is never a CSS trick', () => {
    // Percentages and counts are deliberately public — same classification
    // the Portfolio page documents.
    assert.match(HOME, /value=\{pfTotals\.totalUnrealizedPnLPct\}/)
    assert.match(HOME, /label=\{t\.portfolio\.positionCount\} value=\{String\(pfTotals\.positionCount\)\} \/>/)
    assert.match(HOME, /formatCLP\(price\)/)
    assert.doesNotMatch(HOME_CODE, /blur\(|opacity: 0(?![.\d])|text-shadow/)
    // No masked-state branch ever alters data flow or a payload.
    assert.doesNotMatch(HOME_CODE, /masked \? 0|masked \? null|if \(masked\) return/)
    for (const m of HOME_CODE.matchAll(/fetch\([^)]*\)/g)) {
      assert.doesNotMatch(m[0], /masked|privacy/i)
    }
  })

  test('35. the portfolio API surface is read-only from Home', () => {
    assert.doesNotMatch(HOME_CODE, /method: '(POST|PATCH|PUT|DELETE)'/)
  })
})

// ── 36-40 · Structured Notes integration ────────────────────────────────────

describe('R10 · structured-notes snapshot — book semantics preserved', () => {
  test('36-37. Nevada-notional and custodian semantics are untouched', () => {
    // The snapshot renders the book summary's ALLOCATION-BASED notional; the
    // product-metadata issue size is never referenced, and no custodian is
    // inferred or rendered here.
    assert.match(HOME, /book\.summary\.totalCurrentNotional/)
    assert.doesNotMatch(HOME_CODE, /issueSize|custodian/i)
    // Mixed-currency books are disclosed, not silently summed.
    assert.match(HOME, /book\.summary\.mixedCurrency/)
    assert.match(HOME, /t\.home\.notesMixedCcy/)
  })

  test('38. no mock note data — the module renders only the fetched payload', () => {
    assert.match(HOME, /fetch\('\/api\/structured-notes', \{ cache: 'no-store'/)
    assert.match(HOME, /res\.status === 503/)
  })

  test('39. the private amount masks; counts and dates stay public', () => {
    const at = HOME.indexOf('book.summary.totalCurrentNotional')
    assert.ok(at > -1)
    assert.ok(HOME.slice(Math.max(0, at - 300), at).includes('<PrivacyValue masked={masked}'), 'notional must be masked')
    for (const pub of ['book.summary.activeNotes', 'book.summary.safeNotes', 'book.summary.watchNotes', 'book.summary.autocallableNotes', 'book.summary.breachedNotes']) {
      assert.ok(HOME.includes(pub), `${pub} renders as a public count`)
    }
  })

  test('40. deep links are valid canonical routes', () => {
    assert.match(HOME, /href="\/structured-notes"/)
    assert.match(HOME, /href=\{`\/structured-notes\/\$\{/)
    assert.ok(existsSync(join(ROOT, 'src/app/structured-notes/[id]/page.tsx')))
  })
})

// ── 53-57 · Upcoming events ─────────────────────────────────────────────────

describe('R10 · upcoming events — real dates, honest urgency, no unified score', () => {
  test('53-54. every event date comes from a real source field, sorted purely by date', () => {
    assert.match(HOME, /date: e\.reportDate/)
    assert.match(HOME, /date: e\.date/)
    assert.match(HOME, /date: m\.nextObservationDate/)
    assert.match(HOME, /list\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)/)
    // FRED importance is the source's own field; only High makes the cut, and
    // only genuinely scheduled releases.
    assert.match(HOME, /e\.status !== 'scheduled' \|\| e\.importance !== 'High'/)
    // No fabricated cross-source scoring model exists.
    assert.doesNotMatch(HOME_CODE, /\bscore\b|weighting|rank\w*\s*\(/i)
  })

  test('55. each event kind deep-links to its own real route', () => {
    assert.match(HOME, /href: `\/companies\/\$\{e\.ticker\}`/)
    assert.match(HOME, /href: '\/macro\/calendar'/)
    assert.match(HOME, /href: `\/structured-notes\/\$\{n\.id\}`/)
  })

  test('56. zero events is distinct from a failed source — per-source disclosure', () => {
    assert.match(HOME, /t\.home\.eventsEmpty/)
    assert.match(HOME, /t\.home\.evCmfUnavailable/)
    assert.match(HOME, /t\.home\.evFredUnavailable/)
    assert.match(HOME, /t\.home\.evNotesUnavailable/)
    // The FRED result distinguishes unconfigured/failed from loaded.
    assert.match(HOME, /fredRes && fredRes\.ok && fredRes\.configured \? fredRes : 'unavailable'/)
  })

  test('57. the window is bounded, disclosed, and the CMF list is not silently capped', () => {
    assert.match(HOME, /EVENT_WINDOW_DAYS = 14/)
    assert.match(HOME, /t\.home\.eventsWindow/)
    assert.match(HOME, /upcomingWithinDays\(earningsCal\.events, EVENT_WINDOW_DAYS\)/)
    assert.doesNotMatch(HOME_CODE, /upcomingWithinDays\([^)]*\)\.slice\(/)
    // Recently Reported (real past CMF dates) remains.
    assert.match(HOME, /recentlyReported\(earningsCal\.events, 5\)/)
    assert.match(HOME, /t\.home\.recentlyReported/)
  })
})

// ── 58-70 · Accessibility ───────────────────────────────────────────────────

describe('R10 · accessibility', () => {
  test('58-60. one h1, real h2/h3 hierarchy, section landmarks, one labeled nav', () => {
    assert.doesNotMatch(HOME_CODE, /<h1/)
    assert.ok((HOME.match(/<h2 className="ui-label/g) ?? []).length >= 3)
    assert.ok((HOME.match(/<h3 className="ui-label/g) ?? []).length >= 2)
    assert.ok((HOME.match(/as="section"/g) ?? []).length >= 4)
  })

  test('61-62. table and list semantics survive the redesign', () => {
    assert.match(HOME, /<caption className="sr-only">/)
    assert.ok((HOME.match(/scope="col"/g) ?? []).length >= 5)
    // Events, risk chips and pulse rows are real lists.
    assert.ok((HOME.match(/<ul/g) ?? []).length >= 3)
  })

  test('63-65. status semantics; no charts remain on Home (R10.2)', () => {
    // Loading/error semantics come from the shared AsyncState
    // (role="status" / role="alert" internally — pinned by fableComponents).
    assert.match(HOME, /<AsyncState kind="loading"/)
    assert.match(HOME, /<AsyncState kind="error"/)
    // R10.2 removed every chart from Home — nothing needs a text equivalent.
    assert.doesNotMatch(HOME_CODE, /<Sparkline/)
  })

  test('66-67. keyboard access — sortable headers are real buttons', () => {
    assert.ok((HOME.match(/aria-sort=/g) ?? []).length === 2)
    const sortable = HOME.slice(HOME.indexOf("toggleWatchlistSort('dayChg')") - 300, HOME.indexOf("toggleWatchlistSort('ytd')") + 100)
    assert.match(sortable, /<button/)
    // No click-only div actions anywhere.
    assert.doesNotMatch(HOME_CODE, /<div[^>]*onClick/)
  })

  test('68-69. reduced motion via shared utilities only; meaning never by color alone', () => {
    assert.doesNotMatch(HOME_CODE, /@keyframes|animation:|setTimeout\(/)
    // Direction/severity always pairs a glyph or word with the color: risk
    // chips print label words, event dots pair with kind words, and
    // ChangeIndicator (glyph+text by contract) carries every delta.
    assert.match(HOME, /eventKindLabel\[e\.kind\]/)
    assert.match(HOME, /<ChangeIndicator/)
  })

  test('70. privacy accessibility — no raw value in any attribute, no hand-rolled mask', () => {
    assert.doesNotMatch(HOME_CODE, /title=\{format|aria-label=\{format|data-value/)
    assert.doesNotMatch(code(HOME), /•/)
  })
})

// ── 82-86 · Localization ────────────────────────────────────────────────────

describe('R10 · localization — full EN/ES parity, nothing hardcoded', () => {
  const NEW_KEYS = [
    'stripLabel', 'stripHealth', 'stripHealthUnavailable', 'stripAttention',
    'pfEmpty', 'notesEmpty', 'notesMixedCcy', 'actHealth', 'actDueObs',
    'eventsTitle', 'eventsWindow',
    'evEarnings', 'evRelease', 'evNoteObs', 'eventsEmpty',
    'evCmfUnavailable', 'evFredUnavailable', 'evNotesUnavailable', 'evNotesSource',
  ] as const

  test('82-84. every R10 key exists in BOTH dictionaries with exact key parity', () => {
    for (const k of NEW_KEYS) {
      const en = (dict.en.home as Record<string, string>)[k]
      const es = (dict.es.home as Record<string, string>)[k]
      assert.ok(typeof en === 'string' && en.length > 0, `en.home.${k}`)
      assert.ok(typeof es === 'string' && es.length > 0, `es.home.${k}`)
    }
    assert.deepEqual(Object.keys(dict.en.home).sort(), Object.keys(dict.es.home).sort())
    // The page identity reflects the redesign in both languages.
    assert.equal(dict.en.home.title, 'Overview')
    assert.equal(dict.es.home.title, 'Resumen')
  })

  test('85. dates and copy localize through the active language', () => {
    assert.match(HOME, /lang === 'es' \? 'es-CL' : 'en-US'/)
    // Card titles, states and labels reach the page through `t.` only.
    assert.doesNotMatch(HOME_CODE, />Loading<|>Unavailable<|>Upcoming Events</)
  })

  test('86. market identifiers, source names and note names are never translated', () => {
    // Tickers/note names render from payload fields verbatim.
    assert.match(HOME, /\{e\.label\}/)
    assert.match(HOME, /\{ticker\}/)
    // Source names in footers are dictionary-carried proper nouns (identical
    // strings in EN and ES).
    assert.equal(dict.en.home.macroSourceCl, dict.es.home.macroSourceCl)
    assert.equal(dict.en.home.watchlistSource, dict.es.home.watchlistSource)
  })
})

// ── 87-94 · Performance ─────────────────────────────────────────────────────

describe('R10 · performance — parallel, deduplicated, progressive', () => {
  test('87. no endpoint is fetched twice on mount', () => {
    for (const [literal, max] of [
      ["fetch('/api/watchlists'", 1],
      ["fetch('/api/portfolios'", 1],
      ["fetch('/api/structured-notes'", 1],
      ["fetch('/api/health/ingestion'", 1],
      ['fetchStockSnapshots()', 1],
      ['fetchSectorPerformance()', 1],
      ['fetchIndexPerformance()', 1],
      ['fetchEarningsCalendar()', 1],
      ['fetchFredReleaseCalendar(', 1],
    ] as const) {
      const n = HOME_CODE.split(literal).length - 1
      assert.ok(n === max, `${literal} called ${n}×, expected ${max}`)
    }
  })

  test('88-89. independent requests run in parallel and abort on unmount', () => {
    // 2 parallel groups since R10.2 (mount batch + doRefresh) — the third was
    // the removed macro-history fetch.
    assert.ok((HOME_CODE.match(/Promise\.all\(/g) ?? []).length >= 2)
    assert.ok((HOME_CODE.match(/new AbortController\(\)/g) ?? []).length >= 3)
    assert.ok((HOME_CODE.match(/controller\.abort\(\)/g) ?? []).length >= 3)
  })

  test('90-91. no full-page blocking loader, no polling', () => {
    // Each module carries its own state — the page never returns a single
    // gate for everything.
    assert.doesNotMatch(HOME_CODE, /if \([^)]*loading[^)]*\) return/i)
    assert.doesNotMatch(HOME_CODE, /setInterval|setTimeout\(/)
  })

  test('92-94. no chart library, no hidden duplicate trees, shared providers reused', () => {
    assert.doesNotMatch(HOME_CODE, /recharts|chart\.js|victory|d3/)
    assert.doesNotMatch(HOME_CODE, /lg:hidden|md:hidden|sm:hidden/)
    // The live snapshot and macro overlay come from the shared providers —
    // never a page-local refetch loop.
    assert.match(HOME, /useMarketData\(\)/)
    assert.match(HOME, /useMacroData\(\)/)
    assert.match(HOME, /useGlobalRefresh\(\)/)
  })
})

// ── 95-100 · Security ───────────────────────────────────────────────────────

describe('R10 · security boundaries', () => {
  test('95-99. no server secrets, no admin surface, no logging of private values', () => {
    assert.doesNotMatch(HOME_CODE, /process\.env/)
    assert.doesNotMatch(HOME_CODE, /console\.(log|debug|info|warn|error)/)
    assert.doesNotMatch(HOME_CODE, /analytics|track\(|gtag/)
    // The one repository reference is the pre-existing TYPE-only import.
    assert.match(HOME, /import type \{ WatchlistItemRow \} from '@\/lib\/db\/repositories\/watchlistRepository'/)
    const valueImports = [...HOME.matchAll(/^import (?!type)[\s\S]*?from '([^']+)'/gm)].map((m) => m[1])
    assert.ok(valueImports.every((s) => !s.includes('@/lib/db/repositories')), 'no value import from a repository')
  })

  test('100. the private-route policy is unchanged — / requires an approved session', () => {
    assert.equal(classifyPath('/'), 'private_page')
    assert.equal(classifyPath('/api/portfolios'), 'private_api')
    assert.equal(classifyPath('/api/structured-notes'), 'private_api')
  })
})

// ── 101-109 · Regression scope ──────────────────────────────────────────────

describe('R10 · regression — Home-scoped; every other surface untouched', () => {
  test('101-108. the consumed pages and platform surfaces keep their own composition', () => {
    assert.match(read('src/app/portfolio/page.tsx'), /FABLE_HERO/)
    assert.match(read('src/app/portfolio/page.tsx'), /<SegmentedControl/)
    assert.match(read('src/app/structured-notes/page.tsx'), /fetch\('\/api\/structured-notes'/)
    assert.match(read('src/app/earnings/page.tsx'), /<TableCard/)
    assert.match(read('src/app/macro/page.tsx'), /<ModalShell/)
    assert.match(read('src/app/settings/SettingsClient.tsx'), /usePrivacyMode/)
    assert.match(read('src/app/watchlist/page.tsx'), /minWidth=\{620\}/)
    assert.match(read('src/components/ui/NotificationBell.tsx'), /aria-/)
  })

  test('109. Home never reaches into Settings, notifications, or another page’s internals', () => {
    assert.doesNotMatch(HOME_CODE, /SettingsClient|NotificationRecipientsCard|notification-recipients/)
    assert.doesNotMatch(HOME_CODE, /from '\.\.\/(?!\.\.)/)
  })

  test('the R10 record exists in the governance docs', () => {
    assert.match(read('docs/fable-integration/03-route-content-mapping.md'), /R10/)
    assert.match(read('docs/fable-integration/04-file-level-implementation-plan.md'), /R10/)
    assert.match(read('docs/fable-integration/06-acceptance-checklist.md'), /R10/)
  })
})
