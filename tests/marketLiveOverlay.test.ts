// Tests for the Yahoo Finance live market overlay.
// Uses mocked quote data — never calls live Yahoo Finance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TICKER_YF, SECTOR_MAP, INDEX_YF,
  buildStocks, buildSectors, buildIndices,
  type YFQuote,
} from '../src/lib/market/liveOverlay.ts'

// ── Ticker map invariants ──────────────────────────────────────────────────────

test('TICKER_YF covers exactly 25 internal tickers', () => {
  assert.equal(Object.keys(TICKER_YF).length, 25)
})

test('all TICKER_YF values end with .SN (Bolsa de Santiago)', () => {
  for (const [internal, yf] of Object.entries(TICKER_YF)) {
    assert.ok(yf.endsWith('.SN'), `${internal} → ${yf} does not end with .SN`)
  }
})

test('SECTOR_MAP tickers are all in TICKER_YF', () => {
  const known = new Set(Object.keys(TICKER_YF))
  for (const [sector, members] of Object.entries(SECTOR_MAP)) {
    for (const t of members) {
      assert.ok(known.has(t), `SECTOR_MAP["${sector}"] contains unknown ticker "${t}"`)
    }
  }
})

test('SECTOR_MAP covers all 25 tickers exactly once', () => {
  const seen: Record<string, string> = {}
  for (const [sector, members] of Object.entries(SECTOR_MAP)) {
    for (const t of members) {
      assert.ok(!seen[t], `Ticker "${t}" appears in both "${seen[t]}" and "${sector}"`)
      seen[t] = sector
    }
  }
  assert.equal(Object.keys(seen).length, 25)
})

test('INDEX_YF covers exactly 11 indices', () => {
  assert.equal(Object.keys(INDEX_YF).length, 11)
})

test('INDEX_YF values start with ^ (Yahoo index prefix)', () => {
  for (const [id, yf] of Object.entries(INDEX_YF)) {
    assert.ok(yf.startsWith('^'), `INDEX_YF["${id}"] = "${yf}" does not start with ^`)
  }
})

// ── buildStocks ────────────────────────────────────────────────────────────────

const mockQuote = (symbol: string, price: number, dayPct: number, mktCap?: number): YFQuote => ({
  symbol,
  regularMarketPrice: price,
  regularMarketChangePercent: dayPct,
  marketCap: mktCap,
})

test('buildStocks extracts price, dayChangePct, marketCapCLP for known symbols', () => {
  const quotes: YFQuote[] = [
    mockQuote('BSANTANDER.SN', 32.50, 1.25, 10_000_000_000),
    mockQuote('SQM-B.SN',      45000, -2.1, 25_000_000_000),
  ]
  const { stocks, dayByTicker, succeeded, failed } = buildStocks(quotes)

  assert.equal(stocks['BSANTANDER'].price, 32.5)
  assert.equal(stocks['BSANTANDER'].dayChangePct, 1.25)
  assert.equal(stocks['BSANTANDER'].marketCapCLP, 10_000)   // millions
  assert.equal(stocks['SQM-B'].price, 45000)
  assert.equal(stocks['SQM-B'].dayChangePct, -2.1)
  assert.equal(dayByTicker['BSANTANDER'], 1.25)
  assert.equal(dayByTicker['SQM-B'], -2.1)
  assert.equal(succeeded, 2)
  assert.equal(failed, 23)  // remaining 23 tickers have no mock data
})

test('buildStocks returns null marketCapCLP when absent', () => {
  const quotes: YFQuote[] = [mockQuote('CMPC.SN', 1200, 0.5)]
  const { stocks } = buildStocks(quotes)
  assert.equal(stocks['CMPC'].marketCapCLP, null)
})

test('buildStocks rounds price to 2dp and dayChangePct to 2dp', () => {
  const quotes: YFQuote[] = [mockQuote('COPEC.SN', 8333.3333, 1.23456)]
  const { stocks } = buildStocks(quotes)
  assert.equal(stocks['COPEC'].price, 8333.33)
  assert.equal(stocks['COPEC'].dayChangePct, 1.23)
})

test('buildStocks skips unknown Yahoo symbols gracefully', () => {
  const quotes: YFQuote[] = [
    { symbol: 'UNKNOWN.SN', regularMarketPrice: 100, regularMarketChangePercent: 1 },
  ]
  const { stocks, succeeded, failed } = buildStocks(quotes)
  assert.equal(Object.keys(stocks).length, 0)
  assert.equal(succeeded, 0)
  assert.equal(failed, 25)
})

test('buildStocks handles empty quote array without throwing', () => {
  const { stocks, succeeded, failed } = buildStocks([])
  assert.equal(Object.keys(stocks).length, 0)
  assert.equal(succeeded, 0)
  assert.equal(failed, 25)
})

test('buildStocks handles missing regularMarketPrice (partial quote) gracefully', () => {
  const quotes: YFQuote[] = [{ symbol: 'BSANTANDER.SN' }]
  const { stocks, failed } = buildStocks(quotes)
  assert.ok(!('BSANTANDER' in stocks))
  assert.equal(failed, 25)
})

// ── buildSectors ───────────────────────────────────────────────────────────────

const BASE_SECTORS = [
  { sector: 'Banking', dayChangePct: 0, ytdChangePct: 5, numberOfStocks: 5, topContributor: 'BSANTANDER', topContributorPct: 0, worstContributor: 'ITAUCORP', worstContributorPct: 0 },
  { sector: 'Retail',  dayChangePct: 0, ytdChangePct: -3, numberOfStocks: 3, topContributor: 'FALABELLA', topContributorPct: 0, worstContributor: 'RIPLEY', worstContributorPct: 0 },
]

test('buildSectors averages day% across live members', () => {
  const dayByTicker = { BSANTANDER: 2.0, CHILE: 1.0, BCI: 0.0, SECURITY: -1.0, ITAUCORP: -2.0 }
  const result = buildSectors(dayByTicker, BASE_SECTORS)
  const banking = result.find(s => s.sector === 'Banking')!
  assert.equal(banking.dayChangePct, 0)          // avg of 2,1,0,-1,-2 = 0
  assert.equal(banking.numberOfStocks, 5)
  assert.equal(banking.topContributor, 'BSANTANDER')
  assert.equal(banking.worstContributor, 'ITAUCORP')
})

test('buildSectors keeps static values when no live members available', () => {
  const result = buildSectors({}, BASE_SECTORS)
  const banking = result.find(s => s.sector === 'Banking')!
  assert.equal(banking.dayChangePct, 0)
  assert.equal(banking.ytdChangePct, 5)
  assert.equal(banking.topContributor, 'BSANTANDER')
})

test('buildSectors handles partial live coverage (some members missing)', () => {
  const dayByTicker = { BSANTANDER: 3.0 }    // only 1 of 5 banking stocks
  const result = buildSectors(dayByTicker, BASE_SECTORS)
  const banking = result.find(s => s.sector === 'Banking')!
  assert.equal(banking.dayChangePct, 3.0)
  assert.equal(banking.numberOfStocks, 1)
  assert.equal(banking.topContributor, 'BSANTANDER')
  assert.equal(banking.worstContributor, 'BSANTANDER')
})

test('buildSectors preserves ytdChangePct from static base', () => {
  const dayByTicker = { FALABELLA: 1.5, CENCOSUD: -0.5, RIPLEY: 0.5 }
  const result = buildSectors(dayByTicker, BASE_SECTORS)
  const retail = result.find(s => s.sector === 'Retail')!
  assert.equal(retail.ytdChangePct, -3)   // from BASE_SECTORS
})

// ── buildIndices ───────────────────────────────────────────────────────────────

const BASE_INDICES = [
  { id: 'ipsa',  value: 6800, dayChangePct: 0.5,  ytdChangePct: 3.2 },
  { id: 'sp500', value: 5500, dayChangePct: 0.1,  ytdChangePct: 8.0 },
]

test('buildIndices overlays live value and dayChangePct', () => {
  const quotes: YFQuote[] = [
    { symbol: '^IPSA', regularMarketPrice: 6900, regularMarketChangePercent: 1.47 },
  ]
  const result = buildIndices(quotes, BASE_INDICES)
  const ipsa = result.find(i => i.id === 'ipsa')!
  assert.equal(ipsa.value, 6900)
  assert.equal(ipsa.dayChangePct, 1.47)
  assert.equal(ipsa.ytdChangePct, 3.2)   // preserved from static
})

test('buildIndices falls back to static when quote missing', () => {
  const result = buildIndices([], BASE_INDICES)
  const sp500 = result.find(i => i.id === 'sp500')!
  assert.equal(sp500.value, 5500)
  assert.equal(sp500.dayChangePct, 0.1)
})

test('buildIndices preserves ytdChangePct from static base in all cases', () => {
  const quotes: YFQuote[] = [
    { symbol: '^IPSA', regularMarketPrice: 7000, regularMarketChangePercent: 2.0 },
  ]
  const result = buildIndices(quotes, BASE_INDICES)
  for (const idx of result) {
    const base = BASE_INDICES.find(b => b.id === idx.id)!
    assert.equal(idx.ytdChangePct, base.ytdChangePct)
  }
})

test('buildIndices rounds dayChangePct to 2dp', () => {
  const quotes: YFQuote[] = [
    { symbol: '^IPSA', regularMarketPrice: 6850, regularMarketChangePercent: 1.23456 },
  ]
  const result = buildIndices(quotes, BASE_INDICES)
  assert.equal(result.find(i => i.id === 'ipsa')!.dayChangePct, 1.23)
})
