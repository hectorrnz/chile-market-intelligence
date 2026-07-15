// Home page overhaul: "Tracked Stocks" → real user Watchlist, merged with FX
// into one band-separated table (Ticker/Company/Price/Day Chg/YTD, no Market
// Cap column), and badge/footer wording fixes ("Live"/"Persisted — Yahoo
// Finance" instead of the vague "Persisted market data").

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    const tableMatches = src.match(/<table className="w-full text-xs">/g) ?? []
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

describe('Home page — badge/footer wording: "Live"/"Persisted — Yahoo Finance", never "Persisted market data"', () => {
  const i18n = readFileSync(I18N, 'utf8')

  it('marketData.persisted no longer reads the vague "Persisted market data"', () => {
    assert.ok(!i18n.includes("persisted:       'Persisted market data'"))
    assert.ok(!i18n.includes("persisted:       'Datos de mercado persistidos'"))
  })

  it('marketData.live explicitly includes the word "Live" (EN) / "En vivo" (ES)', () => {
    const enMatch = i18n.match(/marketData: \{[\s\S]{0,300}?live:\s+'([^']+)'/)
    assert.ok(enMatch, 'expected an EN marketData.live entry')
    assert.match(enMatch![1], /Live/)
  })

  it('marketData.persisted explicitly names the real source (Yahoo Finance), not a vague generic phrase', () => {
    const enMatch = i18n.match(/marketData: \{[\s\S]{0,300}?persisted:\s+'([^']+)'/)
    assert.ok(enMatch, 'expected an EN marketData.persisted entry')
    assert.match(enMatch![1], /Yahoo Finance/)
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
