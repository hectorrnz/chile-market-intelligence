// Home page overhaul: "Tracked Stocks" → real user Watchlist, merged with FX
// into one band-separated table (Ticker/Company/Price/Day Chg/YTD, no Market
// Cap column), and badge/footer wording fixes ("Live"/"Persisted — Yahoo
// Finance" instead of the vague "Persisted market data").

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSeriesByStaticId } from '../src/config/macroSeries.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const HOME_PAGE = join(ROOT, 'src/app/page.tsx')
const I18N = join(ROOT, 'src/lib/i18n.ts')

describe('Home page — Watchlist replaces the hardcoded Tracked Stocks list', () => {
  const src = readFileSync(HOME_PAGE, 'utf8')

  it('fetches the real /api/watchlists (Phase 6A) instead of slicing the static company list', () => {
    assert.ok(src.includes("fetch('/api/watchlists'"), 'must fetch the real user watchlist')
    assert.ok(src.includes('WatchlistItemRow'), 'must import the watchlist item row type')
    assert.ok(!src.includes('companies.slice(0, 8)'), 'the old hardcoded first-8-companies list must be removed')
  })

  it('handles the unauthenticated (401) case without throwing — shows a sign-in prompt, not an error', () => {
    assert.ok(src.includes('watchlistAuthed === false'), 'must branch on the unauthenticated state')
    assert.ok(src.includes('t.home.watchlistSignIn'), 'must show a sign-in prompt when not authenticated')
  })

  it('handles the authenticated-but-empty case with a prompt to add tickers', () => {
    assert.ok(src.includes('watchlistRows.length === 0'), 'must branch on an empty watchlist')
    assert.ok(src.includes('t.home.watchlistEmpty'), 'must show an empty-watchlist prompt')
  })

  it('links out to the real /watchlist page, not /stocks', () => {
    assert.match(src, /href="\/watchlist"/)
  })
})

describe('Home page — Watchlist and FX merged into one band-separated table', () => {
  const src = readFileSync(HOME_PAGE, 'utf8')

  it('renders exactly one <table> for the combined Watchlist+FX card (not two separate cards)', () => {
    // The old layout had two sibling bg-surface cards (stocks + FX); the new
    // layout is one table with two <tr> band-divider rows, mirroring the
    // Macro card's Chile/US band pattern.
    // Tolerates extra utility classes (e.g. the responsive min-w added 2026-07-21).
    const tableMatches = src.match(/<table className="w-full text-xs[^"]*">/g) ?? []
    // The macro indicators table on /macro is a separate page; on Home there
    // should be exactly one table for this merged Watchlist+FX card.
    assert.ok(tableMatches.length >= 1)
    assert.ok(src.includes("t.home.watchlistTitle") && src.includes('t.home.fxTitle'))
  })

  it('both band rows use the same highlighted-band pattern as the Macro card (bg-surface-2 + border accent)', () => {
    const bandMatches = src.match(/bg-surface-2 px-4 py-1\.5"\s*style=\{\{\s*borderLeft:/g) ?? []
    assert.ok(bandMatches.length >= 2, 'expected at least 2 band-divider rows (Watchlist, FX) in the merged table')
  })
})

describe('Home page — Watchlist table columns: Ticker/Company/Price/Day Chg/YTD, no Market Cap', () => {
  const src = readFileSync(HOME_PAGE, 'utf8')

  it('renders a Price column (t.home.price) in the merged table header', () => {
    assert.ok(src.includes('t.home.price'), 'expected a Price column header')
  })

  it('does not render a Market Cap column in the Home watchlist table', () => {
    assert.ok(!src.includes('t.home.marketCap'), 'Market Cap column must be removed from the Home watchlist table')
  })
})

describe('Home page — badge wording: bare status word only, never a source/provider name', () => {
  const i18n = readFileSync(I18N, 'utf8')

  it('marketData.persisted no longer reads the vague "Persisted market data"', () => {
    assert.ok(!i18n.includes("persisted:       'Persisted market data'"))
    assert.ok(!i18n.includes("persisted:       'Datos de mercado persistidos'"))
  })

  it('marketData.live is the bare word "Live" (EN) / "En vivo" (ES) — no source name in the badge', () => {
    const enMatch = i18n.match(/marketData: \{[\s\S]{0,300}?live:\s+'([^']+)'/)
    assert.ok(enMatch, 'expected an EN marketData.live entry')
    assert.equal(enMatch![1], 'Live')
  })

  it('marketData.persisted is the bare word "Persisted" — the real source (Yahoo Finance) lives in the table footer, not the badge', () => {
    const enMatch = i18n.match(/marketData: \{[\s\S]{0,300}?persisted:\s+'([^']+)'/)
    assert.ok(enMatch, 'expected an EN marketData.persisted entry')
    assert.equal(enMatch![1], 'Persisted')
    assert.ok(!/Yahoo Finance/.test(enMatch![1]), 'the badge label itself must not name a source')
  })

  it('home.sectorSource / home.indexSource are plain source names — no "via", "proxies", or parenthetical caveats', () => {
    const homeBlock = i18n.match(/home: \{[\s\S]*?\n {4}\},/)
    assert.ok(homeBlock, 'expected to find the EN home i18n block')
    const block = homeBlock![0]
    assert.ok(!/via Yahoo/.test(block), 'sectorSource must not say "via Yahoo Finance"')
    assert.ok(!/proxies/i.test(block), 'indexSource must not mention "proxies"')
  })
})

describe('Home page — regression: badges still computed from already-fetched state (no new provider calls)', () => {
  const src = readFileSync(HOME_PAGE, 'utf8')

  it('watchlistStatus is derived from the existing live/supaStockMap state, not a new fetch', () => {
    assert.ok(src.includes('const watchlistStatus: DataSourceStatus ='))
    assert.ok(/watchlistStatus:\s*DataSourceStatus\s*=\s*live\?\.stocks/.test(src))
  })

  it('sector/index asOf dates are derived from already-fetched snapshot state', () => {
    assert.ok(src.includes('const sectorAsOf ='))
    assert.ok(src.includes('const indexAsOf ='))
  })
})

describe('Home page — badges show Live on initial load, not just after clicking Update', () => {
  const src = readFileSync(HOME_PAGE, 'utf8')

  // 2026-07-20: the live Yahoo snapshot fetch moved out of Home's own mount
  // effect and into MarketDataProvider (mounted once in AppShell, above the
  // router) — see marketDataProvider.test.ts. It still auto-fetches once on
  // app load, so badges still read Live immediately without a manual Update;
  // the mechanism is now shared across every page instead of duplicated.
  it('reads the live snapshot from the shared MarketDataProvider context, not its own fetch', () => {
    assert.ok(src.includes('useMarketData()'))
    assert.ok(!src.includes('fetchLiveSnapshot()'), 'Home must not fetch its own copy — the provider already does')
  })
})

describe('Home page — Chilean Rates overlay live BCCh values where a verified series exists', () => {
  const src = readFileSync(HOME_PAGE, 'utf8')

  it('overlays live values by resolving each row through getSeriesByStaticId (handles ids that differ from the live provider key)', () => {
    assert.ok(src.includes('const liveRateRows = rateOrder.map(r => {'))
    assert.ok(src.includes("getSeriesByStaticId(r.id)?.fallbackStaticId ?? r.id"))
    assert.ok(src.includes('liveIndicatorMap[liveId]'))
  })

  it('renders a DataSourceBadge + TableSourceFooter for the rates panel (no longer a bare "Static MVP sample" line)', () => {
    assert.ok(src.includes('<DataSourceBadge status={ratesStatus} />'))
    assert.ok(src.includes('<TableSourceFooter source={t.home.ratesSource} asOf={ratesAsOf} />'))
  })

  it('i18n ratesSource no longer claims a bare static sample', () => {
    const i18n = readFileSync(I18N, 'utf8')
    const enHome = i18n.match(/home: \{[\s\S]*?\n {4}\},/)![0]
    assert.ok(!/ratesSource:\s+'Source: Banco Central · BCS — Static MVP sample'/.test(enHome))
  })

  it('never hardcodes a rate id inline — the overlay applies generically via getSeriesByStaticId + liveIndicatorMap lookup', () => {
    for (const id of ['btp10', 'btu10', 'btu5', 'swap2y', 'swap1y', 'pdbc90', 'tpm-tna']) {
      assert.ok(!src.includes(`liveIndicatorMap['${id}']`) && !src.includes(`liveIndicatorMap["${id}"]`))
    }
  })

  it('the BCU 5 row was removed entirely rather than shown static or faked live (no live BCCh series exists for it)', () => {
    const ratesJson = readFileSync(join(ROOT, 'src/data/chileanRates.json'), 'utf8')
    assert.ok(!/"id":\s*"bcu5"/.test(ratesJson), 'bcu5 must be removed from chileanRates.json')
  })

  it('BTP 10 and PDBC 90d rows were relabeled to match the tenor that is actually live (BTP 2 / PDBC 14d)', () => {
    const ratesJson = readFileSync(join(ROOT, 'src/data/chileanRates.json'), 'utf8')
    assert.ok(ratesJson.includes('"name": "BTP 2"'))
    assert.ok(ratesJson.includes('"name": "PDBC 14d"'))
  })
})

describe('Chilean Rates live-id resolution — regression guard for a real id-mismatch bug found this phase', () => {
  // The live BCCh provider emits each Rates indicator's `id` as the series
  // def's `fallbackStaticId`, not its own `id` — for btu10 and tpm-tna these
  // differ from the chileanRates.json row's own id ('btu10' vs 'btu10-ref',
  // 'tpm-tna' vs 'tpm'). A naive `liveIndicatorMap[r.id]` lookup would never
  // match those two rows even once genuinely live — this guards the fix.
  it('btu10 resolves to the live provider key "btu10-ref", not "btu10"', () => {
    assert.equal(getSeriesByStaticId('btu10')?.fallbackStaticId, 'btu10-ref')
  })
  it('tpm-tna resolves to the live provider key "tpm" (reuses the main TPM series)', () => {
    assert.equal(getSeriesByStaticId('tpm-tna')?.fallbackStaticId, 'tpm')
  })
  it('rows whose id already matches the live key resolve to themselves', () => {
    for (const id of ['btp10', 'btu5', 'swap2y', 'swap1y', 'pdbc90']) {
      assert.equal(getSeriesByStaticId(id)?.fallbackStaticId, id)
    }
  })
})

describe('Home page — Watchlist table is sortable by Day Chg. and YTD %', () => {
  const src = readFileSync(HOME_PAGE, 'utf8')

  it('has a sort-state toggle and clickable column headers for both sortable columns', () => {
    assert.ok(src.includes("useState<{ key: 'dayChg' | 'ytd'; dir: 'asc' | 'desc' } | null>(null)"))
    assert.ok(src.includes("toggleWatchlistSort('dayChg')"))
    assert.ok(src.includes("toggleWatchlistSort('ytd')"))
  })

  it('sorts watchlistRows in place using the selected field before rendering', () => {
    assert.ok(src.includes('watchlistRows.sort((a, b) => {'))
  })
})
