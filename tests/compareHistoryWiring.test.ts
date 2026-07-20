// 2026-07-20 — Comparative Returns table + chart wired to persisted Supabase
// history, at the user's explicit request after items 1/2/5 were fixed and
// item 3/4 (Comparative Returns always showing "Static sample") turned out
// not to be a bug but a documented, never-built gap (Phase 8B). This reuses
// resolveStockHistory() — the SAME resolver already used by the Company page
// chart and Compare's own Market Data 1D/5D/1M/YTD/1Y performance columns —
// rather than inventing new provider/sufficiency logic.
//
// resolveCompareHistory.ts transitively imports marketProvider.ts (which
// imports '@/data/stocks', an alias Node's native test runner can't resolve
// — the same constraint documented in compareResolver.test.ts's header), so
// these are structural/hygiene checks, matching this codebase's existing
// convention for that class of file (see compareResolver.test.ts's own
// "API route + resolver hygiene" section).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const RESOLVER = join(ROOT, 'src/lib/compare/resolveCompareHistory.ts')
const ROUTE = join(ROOT, 'src/app/api/compare/history/route.ts')
const CLIENT_FETCH = join(ROOT, 'src/lib/data/compareHistory.ts')
const COMPARE_PAGE = join(ROOT, 'src/app/compare/page.tsx')

const read = (p: string) => readFileSync(p, 'utf8')

describe('resolveCompareHistory.ts — reuses the existing resolver, no new provider', () => {
  const src = read(RESOLVER)

  it('imports resolveStockHistory rather than building a new market-data path', () => {
    assert.ok(src.includes("import { resolveStockHistory } from '../providers/market/marketProvider.ts'"))
  })

  it('only marks a series persisted when resolveStockHistory itself said persisted (no separate threshold)', () => {
    assert.ok(src.includes("resp.metadata.status === 'persisted'"))
    assert.ok(!/\bmin\w*points\b/i.test(src), 'must not reimplement a sufficiency threshold — that lives in marketHistory.ts')
  })

  it('never fabricates points for a non-persisted ticker — points stays empty, caller uses its own static series', () => {
    assert.ok(src.includes("points: [], status: 'static_fallback'"))
  })

  it('is server-only (no "use client")', () => {
    assert.ok(!src.includes("'use client'"))
  })

  it('COMPARE_HISTORY_TIMEFRAMES matches the exact 5 timeframes the Comparative Returns UI offers', () => {
    assert.ok(src.includes("['1M', 'YTD', '1Y', '3Y', '5Y']"))
    const pageSrc = read(COMPARE_PAGE)
    assert.ok(pageSrc.includes("const TF: CmpTf[] = ['1M', 'YTD', '1Y', '3Y', '5Y']"), 'compare/page.tsx TF must stay in sync with COMPARE_HISTORY_TIMEFRAMES')
  })
})

describe('/api/compare/history — always 200, validates timeframe', () => {
  const src = read(ROUTE)

  it('never returns a non-200 status', () => {
    assert.ok(!/status:\s*[45]\d\d/.test(src))
  })

  it('rejects a timeframe outside COMPARE_HISTORY_TIMEFRAMES rather than passing it through', () => {
    assert.ok(src.includes('COMPARE_HISTORY_TIMEFRAMES.find'))
  })

  it('empty tickers or missing/invalid timeframe returns an empty series, not an error', () => {
    assert.ok(src.includes('{ series: [], invalidTickers'))
  })
})

describe('compareHistory.ts client fetch helper', () => {
  const src = read(CLIENT_FETCH)

  it('hits /api/compare/history, never Supabase or the resolver directly', () => {
    assert.ok(src.includes("fetch(`/api/compare/history"))
  })
})

describe('compare/page.tsx — Comparative Returns wiring', () => {
  const src = read(COMPARE_PAGE)

  it('fetches persisted history keyed by the selected timeframe', () => {
    assert.ok(src.includes("fetchCompareHistory(validTickerKey.split(','), tf)"))
  })

  it('a custom date range keeps the static-only path — persisted history is never fetched for it', () => {
    assert.ok(src.includes('if (usingCustom || validTickerKey === \'\') return'))
    assert.ok(src.includes('if (!usingCustom && persisted?.status'))
  })

  it('IPSA benchmark always uses the static series — never sent through the persisted-history path', () => {
    // The old `seriesFor('IPSA')` call (which would have gone through the
    // persisted-history gate) is gone; IPSA reads getStockSeriesByPeriod directly.
    assert.ok(!src.includes("seriesFor('IPSA')"))
    const ipsaLine = src.split('\n').find(l => l.includes('ipsaData = benchmark'))
    assert.ok(ipsaLine?.includes('getStockSeriesByPeriod'), 'IPSA must read the static series directly')
  })

  it('renders a dynamic source badge and as-of on the Returns table, not a fixed static label', () => {
    assert.ok(src.includes('<MarketDataSourceBadge status={returnsStatus} />'))
    assert.ok(src.includes('returnsStatus === \'persisted\' ? t.compare.marketSource : t.compare.source'))
  })

  it('the badge is suppressed for a custom range (which never uses persisted data)', () => {
    const badgeLine = src.split('\n').find(l => l.includes('<MarketDataSourceBadge status={returnsStatus} />'))
    assert.ok(badgeLine?.includes('!usingCustom'))
  })
})
