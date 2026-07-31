// Phase 5C repair — historical-price chart integrity.
//
// Context: company pages for SONDA and ITAUCL showed an empty price chart.
// The runtime diagnostic proved the provider chain is CORRECT for both — a
// direct live fetch returns full history for every timeframe (SONDA.SN and
// ITAUCL.SN, 251 bars at 1Y, 1252 at 5Y). The empty chart was caused entirely
// by MARKET_DATA_MODE resolving to 'static', in which mode the static seed
// (src/data/stockHistory.json) covers only 9 of the 25 tracked tickers.
//
// These tests lock in the verified-correct behaviour so a future regression in
// symbol mapping, date/numeric parsing, timeframe sufficiency, or source
// precedence fails loudly instead of silently reappearing as an empty chart.
// No fabricated series is introduced anywhere; the honest empty state for a
// ticker with no seeded static history is asserted as CORRECT behaviour.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { TICKER_YF, INDEX_YF } from '../src/lib/market/liveOverlay.ts'
import {
  resolveLiveHistoryDateRange,
  resolveHistoryDateRange,
  isSufficientMarketHistory,
  normalizeStockSnapshotsToHistoryPoints,
} from '../src/lib/market/marketHistory.ts'
import type { StockHistoryPoint, StockTimeframe } from '../src/lib/providers/market/types.ts'
import type { StockHistorySnapshotRow } from '../src/lib/db/repositories/marketRepository.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const yahooProviderSrc = read('src/lib/providers/market/yahooHistoryProvider.ts')
const marketProviderSrc = read('src/lib/providers/market/marketProvider.ts')
const staticProviderSrc = read('src/lib/providers/market/staticMarketProvider.ts')
const marketDataModeSrc = read('src/lib/providers/market/marketDataMode.ts')
const companyPageSrc = read('src/app/companies/[ticker]/page.tsx')
const historyRouteSrc = read('src/app/api/market/stocks/[ticker]/history/route.ts')
const marketDataHelperSrc = read('src/lib/data/marketData.ts')

const ALL_TIMEFRAMES: StockTimeframe[] = ['1D', '5D', '1M', 'MTD', 'YTD', '1Y', '3Y', '5Y']

function point(date: string, close: number, ticker = 'SONDA'): StockHistoryPoint {
  return { ticker, date, open: null, high: null, low: null, close, volume: null, source: 'Yahoo Finance', provider: 'yahoo-finance' }
}

/**
 * A realistic run of `n` daily bars ending on `end`, spaced on BUSINESS days —
 * markets are closed at weekends, so a real 251-bar 1Y series spans roughly 365
 * calendar days, not 251. Using calendar-day spacing here would understate the
 * span and make the coverage-ratio guard look stricter than it really is.
 */
function series(end: string, n: number, ticker = 'SONDA'): StockHistoryPoint[] {
  const dates: string[] = []
  const cur = new Date(`${end}T00:00:00Z`)
  while (dates.length < n) {
    const dow = cur.getUTCDay()
    if (dow !== 0 && dow !== 6) dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() - 1)
  }
  dates.reverse()
  return dates.map((d, i) => point(d, 300 + i, ticker))
}

function snapshotRow(ticker: string, snapshotDate: string, price: number | null): StockHistorySnapshotRow {
  return { ticker, snapshotDate, price, volume: null, source: null, provider: null } as StockHistorySnapshotRow
}

// ─── 1-3. Provider symbol mapping and alias safety ────────────────────────────

describe('provider symbol mapping', () => {
  it('1. SONDA maps to its verified provider symbol SONDA.SN', () => {
    assert.equal(TICKER_YF['SONDA'], 'SONDA.SN')
  })

  it('2. ITAUCL maps to its verified provider symbol ITAUCL.SN', () => {
    assert.equal(TICKER_YF['ITAUCL'], 'ITAUCL.SN')
  })

  it('3. bare "ITAU" is not a mapped ticker and cannot silently resolve', () => {
    assert.equal(TICKER_YF['ITAU'], undefined)
    assert.equal(TICKER_YF['ITAU.SN'], undefined)
  })

  it('3b. no map entry aliases ITAU onto ITAUCL\'s symbol', () => {
    const aliases = Object.entries(TICKER_YF).filter(([k, v]) => v === 'ITAUCL.SN' && k !== 'ITAUCL')
    assert.deepEqual(aliases, [], 'ITAUCL.SN must be reachable only via the canonical ITAUCL ticker')
  })

  it('3c. every mapped symbol is unique — no two tickers share one security', () => {
    const values = Object.values(TICKER_YF)
    assert.equal(new Set(values).size, values.length)
  })

  it('3d. the live provider resolves symbols only via TICKER_YF (plus the IPSA index), never name inference', () => {
    assert.match(yahooProviderSrc, /TICKER_YF\[ticker\]/)
    assert.match(yahooProviderSrc, /ticker === 'IPSA'\s*\?\s*INDEX_YF\.ipsa/)
    // An unmapped ticker must fail closed, never be guessed into a symbol.
    assert.match(yahooProviderSrc, /if \(!symbol\) return \{ ok: false/)
    assert.equal(/\.SN`|\+ '\.SN'|\+ "\.SN"/.test(yahooProviderSrc), false,
      'the provider must not construct a Yahoo symbol by string-appending .SN')
  })

  it('3e. IPSA benchmark still resolves through the index map', () => {
    assert.ok(INDEX_YF.ipsa)
  })
})

// ─── 4-7. Parsing and timeframe filtering preserve valid rows ─────────────────

describe('history parsing and timeframe filtering', () => {
  it('4. a full 1Y run of valid bars is sufficient — it must not be filtered to empty', () => {
    const s = series('2026-07-27', 251)
    assert.equal(isSufficientMarketHistory(s, '1Y'), true)
    assert.equal(isSufficientMarketHistory(s, '1Y', resolveLiveHistoryDateRange('1Y', '2026-07-28')), true)
  })

  it('4b. every timeframe resolves a real live date range — 3Y/5Y are not null on the live tier', () => {
    for (const tf of ALL_TIMEFRAMES) {
      const r = resolveLiveHistoryDateRange(tf, '2026-07-28')
      assert.ok(r && r.from && r.to, `${tf} must resolve a live range`)
      assert.ok(r.from < r.to, `${tf} range must be ordered`)
    }
    // The persisted (Supabase-accumulation) tier is the one that legitimately
    // cannot cover 3Y/5Y — that asymmetry is intentional and must stay.
    assert.equal(resolveHistoryDateRange('3Y', '2026-07-28'), null)
    assert.equal(resolveHistoryDateRange('5Y', '2026-07-28'), null)
  })

  it('4c. realistic bar counts clear the sufficiency floor at every timeframe', () => {
    const counts: Record<string, number> = { '1D': 2, '5D': 6, '1M': 23, 'MTD': 18, 'YTD': 142, '1Y': 251, '3Y': 748, '5Y': 1252 }
    for (const tf of ALL_TIMEFRAMES) {
      assert.equal(isSufficientMarketHistory(series('2026-07-27', counts[tf]), tf), true, `${tf} (${counts[tf]} bars) must be sufficient`)
    }
  })

  it('5. date parsing preserves valid Chilean-market rows and drops only unparseable ones', () => {
    const rows = [
      snapshotRow('SONDA', '2026-07-24', 309.99),
      snapshotRow('SONDA', '2026-07-27', 311.5),
    ]
    const out = normalizeStockSnapshotsToHistoryPoints(rows)
    assert.equal(out.length, 2)
    assert.deepEqual(out.map(p => p.date), ['2026-07-24', '2026-07-27'])
  })

  it('6. numeric parsing keeps a legitimate zero close and drops only null/undefined', () => {
    const out = normalizeStockSnapshotsToHistoryPoints([
      snapshotRow('ITAUCL', '2026-07-24', 0),
      snapshotRow('ITAUCL', '2026-07-27', 20678),
      snapshotRow('ITAUCL', '2026-07-28', null),
    ])
    assert.equal(out.length, 2, 'a null price is dropped; a zero price is a real value and is kept')
    assert.equal(out[0].close, 0)
    assert.equal(out[1].close, 20678)
  })

  it('6b. the live provider guards on null-ish, not falsy — a 0 close is never silently dropped', () => {
    assert.match(yahooProviderSrc, /q\.close == null \|\| q\.date == null/)
    assert.equal(/if \(!q\.close/.test(yahooProviderSrc), false,
      'a falsy guard would discard a legitimate 0 close')
  })

  it('6c. the live provider rejects only genuinely unparseable dates', () => {
    assert.match(yahooProviderSrc, /Number\.isNaN\(d\.getTime\(\)\)/)
  })

  it('7. timeframe filtering does not remove a valid recent run', () => {
    const recent = series('2026-07-27', 23)
    assert.equal(isSufficientMarketHistory(recent, '1M'), true)
    assert.equal(isSufficientMarketHistory(recent, '1M', resolveLiveHistoryDateRange('1M', '2026-07-28')), true)
  })

  it('7b. a genuinely truncated window is still rejected — the coverage guard is not weakened', () => {
    // 6 points clears the 1Y point floor only if the floor were naive; it is not.
    assert.equal(isSufficientMarketHistory(series('2026-07-27', 6), '1Y'), false)
    // A run that clears the point floor but spans ~3 weeks must not pass as 1Y.
    assert.equal(
      isSufficientMarketHistory(series('2026-07-27', 61), '1Y', resolveLiveHistoryDateRange('1Y', '2026-07-28')),
      false,
      'coverage-ratio guard must still reject a truncated window labelled 1Y',
    )
  })

  it('7c. the 1D buffer is trimmed to the two most recent bars, not to whatever the buffer caught', () => {
    // R6.2: the trim now runs over `realPoints` — the buffer with Yahoo's
    // carried-forward filler bars (repeated close + volume 0) removed. Same
    // "two most recent" rule, applied to genuine sessions only, because
    // trimming the raw buffer compared a filler against a filler and produced
    // exactly 0.00% for every ticker.
    assert.match(yahooProviderSrc, /timeframe === '1D' && realPoints\.length > 2 \? realPoints\.slice\(-2\) : realPoints/)
    assert.match(yahooProviderSrc, /stripNonTradingFillers\(/)
  })
})

// ─── 8-10. Control tickers unchanged ──────────────────────────────────────────

describe('control tickers remain unchanged', () => {
  const stockHistory = JSON.parse(read('src/data/stockHistory.json')) as { ticker: string; type: string }[]
  const seeded = new Set(stockHistory.map(r => r.ticker))

  it('8. SQM-B mapping and static seed are unchanged', () => {
    assert.equal(TICKER_YF['SQM-B'], 'SQM-B.SN')
    assert.ok(seeded.has('SQM-B'))
  })

  it('9. BSANTANDER mapping and static seed are unchanged', () => {
    assert.equal(TICKER_YF['BSANTANDER'], 'BSANTANDER.SN')
    assert.ok(seeded.has('BSANTANDER'))
  })

  it('10. CHILE mapping and static seed are unchanged', () => {
    assert.equal(TICKER_YF['CHILE'], 'CHILE.SN')
    assert.ok(seeded.has('CHILE'))
  })

  it('10b. the tracked universe is still exactly 25 tickers, all .SN', () => {
    assert.equal(Object.keys(TICKER_YF).length, 25)
    for (const [t, y] of Object.entries(TICKER_YF)) {
      assert.ok(y.endsWith('.SN'), `${t} → ${y}`)
    }
  })
})

// ─── 11-14. Source precedence and honest states ───────────────────────────────

describe('source precedence and honest unavailable states', () => {
  it('11. resolveStockHistory precedence is live Yahoo → persisted Supabase → static, in that order', () => {
    const yahooAt = marketProviderSrc.indexOf('getYahooStockHistory(ticker, timeframe)')
    const supaAt = marketProviderSrc.indexOf('supabaseMarketProvider.getStockHistory(ticker, timeframe)')
    const staticAt = marketProviderSrc.indexOf('return staticResult(prov.reason)')
    assert.ok(yahooAt > 0 && supaAt > 0 && staticAt > 0)
    assert.ok(yahooAt < supaAt, 'live Yahoo must be attempted before persisted Supabase')
    assert.ok(supaAt < staticAt, 'persisted Supabase must be attempted before static fallback')
  })

  it('11b. static mode short-circuits before any provider call', () => {
    assert.match(marketProviderSrc, /if \(requested === 'static'\) \{\s*return staticResult\(\)/)
  })

  it('12. static mode returns an honest empty series when a ticker has no seeded static history', () => {
    // 17 of the 25 tracked tickers (SONDA and ITAUCL among them) have no static
    // seed at all. In static mode the correct behaviour is an EMPTY series and a
    // 'static' status — never an invented one.
    const stockHistory = JSON.parse(read('src/data/stockHistory.json')) as { ticker: string }[]
    const seeded = new Set(stockHistory.map(r => r.ticker))
    assert.equal(seeded.has('SONDA'), false)
    assert.equal(seeded.has('ITAUCL'), false)
    assert.match(staticProviderSrc, /getStockHistoryForTimeframe\(ticker, timeframe\)/)
    assert.equal(/fallbackPrice|synthesi[sz]e|generateSeries|fillMissing/i.test(staticProviderSrc), false,
      'the static provider must never synthesise a series for an unseeded ticker')
  })

  it('12b. an unrecognised MARKET_DATA_MODE resolves to static rather than throwing', () => {
    assert.match(marketDataModeSrc, /if \(v === 'supabase'\) return 'supabase'/)
    assert.match(marketDataModeSrc, /if \(v === 'hybrid'\) return 'hybrid'/)
    assert.match(marketDataModeSrc, /return 'static'/)
  })

  it('13. supabase/hybrid mode reaches the existing legitimate live provider fallback', () => {
    assert.match(marketProviderSrc, /import \{ getYahooStockHistory \} from '\.\/yahooHistoryProvider\.ts'/)
    assert.match(marketProviderSrc, /status: 'live'/)
    assert.match(marketProviderSrc, /provider: 'yahoo-finance'/)
    assert.match(marketProviderSrc, /status: 'persisted'/)
  })

  it('14. unavailable history stays unavailable — never zero-filled', () => {
    assert.match(marketProviderSrc, /data: \[\],\s*metadata: \{[\s\S]*?status: 'live-unavailable'/)
    assert.equal(/close: 0\b|price: 0\b|\?\? 0\b/.test(marketProviderSrc), false,
      'no zero-filling of an unavailable series')
    assert.equal(/close: 0\b|\?\? 0\b/.test(yahooProviderSrc), false)
  })

  it('14b. the company page only accepts a fetched series when it is genuinely live or persisted', () => {
    assert.match(companyPageSrc, /res\.metadata\.status === 'live' \|\| res\.metadata\.status === 'persisted'/)
    assert.match(companyPageSrc, /fetched && res\.data\.length >= 2/)
    assert.match(companyPageSrc, /delete next\[sym\]/)
  })

  it('14c. the chart footer names the real resolved source and never mislabels static as live', () => {
    assert.match(companyPageSrc, /chartStatus !== 'static' \? t\.stocks\.footer : t\.company\.stockChartSource/)
    assert.match(companyPageSrc, /const chartStatus: 'live' \| 'persisted' \| 'static' = liveStockHistory\?\.status \?\? 'static'/)
  })
})

// ─── 15-16. No fabrication, contracts intact ──────────────────────────────────

describe('no fabricated data and unchanged contracts', () => {
  it('15. no hardcoded price series was introduced into the page or providers', () => {
    for (const [name, src] of [
      ['company page', companyPageSrc],
      ['yahoo history provider', yahooProviderSrc],
      ['market provider', marketProviderSrc],
    ] as const) {
      assert.equal(/const\s+\w*(FALLBACK|SAMPLE|DEMO)\w*_?(PRICES|SERIES|HISTORY)\b/i.test(src), false,
        `${name} must not declare a hardcoded price series`)
    }
  })

  it('15b. the page never substitutes the current quote for missing history', () => {
    // lastPrice may fall back to the snapshot for the headline figure, but the
    // CHART data must come only from the resolved series.
    assert.match(companyPageSrc, /const chartData = stockHistory/)
    assert.equal(/chartData\s*=\s*\[\s*\{/.test(companyPageSrc), false)
    assert.equal(/data=\{\[\{ date/.test(companyPageSrc), false)
  })

  it('15c. the honest empty state is preserved when fewer than two points resolve', () => {
    assert.match(companyPageSrc, /stockHistory\.length >= 2 \? \(/)
    assert.match(companyPageSrc, /<AsyncState kind="empty" message=\{t\.common\.noData\} \/>/)
  })

  it('16. the history API response contract is unchanged', () => {
    assert.match(historyRouteSrc, /resolveStockHistory/)
    assert.match(marketDataHelperSrc, /\/api\/market\/stocks\/\$\{encodeURIComponent\(ticker\)\}\/history\?timeframe=\$\{timeframe\}/)
    // { data, metadata } envelope, consumed by the page as res.data / res.metadata
    assert.match(companyPageSrc, /res\.data\.map\(p => \(\{ date: p\.date, value: p\.close \}\)\)/)
    assert.match(companyPageSrc, /res\.metadata\.lastUpdated/)
  })

  it('16b. the chart refetches on ticker, timeframe, and shared-refresh changes', () => {
    assert.match(companyPageSrc, /\}, \[sym, chartTimeframe, live\?\.lastUpdated\]\)/)
  })
})

// ─── 17-18. Prior Phase 5C work intact ────────────────────────────────────────

describe('prior Phase 5C work remains intact', () => {
  it('17. all seven company-page sections remain present', () => {
    for (const anchor of [
      /t\.company\.kpis\./,              // KPI strip
      /businessModel/,                    // business info
      /<LineChart/,                       // price chart
      /earningsResults/,                  // recent results
      /t\.company\.valuation/,            // valuation
      /newsState/,                        // news
      /TableSourceFooter/,                // source disclosure
    ]) {
      assert.match(companyPageSrc, anchor)
    }
  })

  it('18a. the KPI source-footer overlap repair is preserved (no negative margin)', () => {
    assert.equal(/<TableSourceFooter[^>]*className="-mt-2"/.test(companyPageSrc), false)
  })

  it('18b. the News section still renders in every state, including empty', () => {
    assert.match(companyPageSrc, /newsFailed \? 'error'/)
    assert.match(companyPageSrc, /news\.length === 0 \? 'empty'/)
    assert.equal(/\{news\.length > 0 && \(/.test(companyPageSrc), false,
      'News must not be conditionally unmounted when empty')
  })

  it('18c. the bank P/B repair still uses the authoritative registry, not name inference', () => {
    assert.match(companyPageSrc, /import \{ isBankTicker \} from '@\/lib\/financials\/banks\/bankRegistry'/)
    assert.match(companyPageSrc, /const isBank = isBankTicker\(sym\)/)
    assert.match(companyPageSrc, /t\.company\.kpis\.pb/)
    assert.equal(/company\.name.*[Bb]anco/.test(companyPageSrc), false,
      'bank status must never be inferred from company-name text')
  })

  it('18d. the Settings nav repair is preserved — the rail reserves trailing space', () => {
    const nav = read('src/components/layout/PrimaryNav.tsx')
    assert.match(nav, /pr-2\.5/)
    assert.match(nav, /overflow-x-auto/)
  })
})
