// 2026-07-20 — Platform-wide live market snapshot.
//
// Reported bug: clicking Update on Stocks showed "Live", but navigating to
// another tab and back showed "Static"/an older snapshot — because each page
// held its own `useState<LiveSnapshot | null>`, which Next.js discards on
// route change (the page component unmounts). One Update only ever updated
// the single open tab, never the rest of the app (a second reported ask).
//
// Fixed with a MarketDataProvider mounted once in AppShell, above the router
// outlet, so its state survives client-side navigation — every page now reads
// `live` from the same context instead of holding its own copy.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PROVIDER = join(ROOT, 'src/components/providers/MarketDataProvider.tsx')
const APP_SHELL = join(ROOT, 'src/components/layout/AppShell.tsx')
const PAGES = [
  join(ROOT, 'src/app/page.tsx'),
  join(ROOT, 'src/app/stocks/page.tsx'),
  join(ROOT, 'src/app/companies/[ticker]/page.tsx'),
  join(ROOT, 'src/app/portfolio/page.tsx'),
]

describe('MarketDataProvider — shared platform-wide live snapshot', () => {
  it('exists and exposes useMarketData()', () => {
    const src = readFileSync(PROVIDER, 'utf8')
    assert.ok(src.includes('export function MarketDataProvider'))
    assert.ok(src.includes('export function useMarketData'))
  })

  it('is mounted once in AppShell, above the page content — survives route changes', () => {
    const src = readFileSync(APP_SHELL, 'utf8')
    assert.ok(src.includes('MarketDataProvider'))
    // Must wrap {children} (the router outlet), not sit inside a page.
    const providerIdx = src.indexOf('<MarketDataProvider>')
    const childrenIdx = src.indexOf('{children}')
    assert.ok(providerIdx >= 0 && childrenIdx > providerIdx, 'MarketDataProvider must wrap {children}')
  })

  it('auto-fetches once on mount so a page opened later in the session still shows Live', () => {
    const src = readFileSync(PROVIDER, 'utf8')
    assert.ok(src.includes('useEffect(() => { refresh()'))
  })

  it('reuses an in-flight refresh rather than firing a duplicate fetch', () => {
    const src = readFileSync(PROVIDER, 'utf8')
    assert.ok(src.includes('inFlight'))
    assert.ok(src.includes('if (inFlight.current) return inFlight.current'))
  })

  it('refresh() rejects when the fetch genuinely fails, so UpdateDataButton can show failure', () => {
    const src = readFileSync(PROVIDER, 'utf8')
    assert.ok(src.includes("throw new Error('live snapshot unavailable')"))
  })
})

describe('every market-data page consumes the shared context, not its own local state', () => {
  for (const page of PAGES) {
    it(`${page.split(/[\\/]/).slice(-2).join('/')} uses useMarketData() instead of useState<LiveSnapshot>`, () => {
      const src = readFileSync(page, 'utf8')
      assert.ok(src.includes('useMarketData()'), 'must read live/refresh from the shared context')
      assert.ok(!src.includes('useState<LiveSnapshot'), 'must not hold its own local live-snapshot state')
      assert.ok(!src.includes('fetchLiveSnapshot'), 'must not call the fetch helper directly — only the provider does')
    })
  }
})

describe('the shared Update always refreshes the shared market snapshot', () => {
  it('every UpdateDataButton onRefresh calls refresh() (directly or via a wrapping doRefresh)', () => {
    for (const page of PAGES) {
      const src = readFileSync(page, 'utf8')
      assert.ok(/\brefresh(?:Live)?\(\)/.test(src), `${page} onRefresh must call the shared refresh`)
    }
  })
})
