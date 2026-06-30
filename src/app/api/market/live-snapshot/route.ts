// Phase 4C.1-alt — Live market snapshot via yahoo-finance2 (Yahoo Finance).
//
// Server-only route handler. Fetches real-time price quotes and returns merged
// data (live prices + static YTD / sector / index metadata). Called by the
// refresh button on Home, Stocks, and Company pages.
//
// Data source: Yahoo Finance (unofficial, no API key required). Chilean tickers
// use the ".SN" suffix (Bolsa de Santiago). Quotes are in CLP.
//
// Fallback: if Yahoo is unreachable the client retains the last static JSON
// baseline — this route returns 503 and the UI does NOT crash.

import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

import staticSectors from '@/data/sectorPerformance.json'
import staticIndices from '@/data/indexPerformance.json'
import {
  TICKER_YF, INDEX_YF,
  buildStocks, buildSectors, buildIndices,
  type StaticSector, type StaticIndex, type LiveSnapshot,
} from '@/lib/market/liveOverlay'

// yahoo-finance2 v3 requires explicit instantiation (breaking change from v2).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] })

const TIMEOUT_MS = 15_000

export async function GET(): Promise<NextResponse> {
  try {
    const allSymbols = [...Object.values(TICKER_YF), ...Object.values(INDEX_YF)]

    // Single batch call — yahoo-finance2 v3 maps to v8 /quote?symbols=...
    // validateResult:false skips strict schema checks; we type-cast to our subset.
    const quotePromise = yf.quote(allSymbols, {}, { validateResult: false })
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawQuotes: any = await Promise.race([quotePromise, timeoutPromise])
    const quotes = Array.isArray(rawQuotes) ? rawQuotes : [rawQuotes]

    const { stocks, dayByTicker, succeeded, failed } = buildStocks(quotes)
    const sectors = buildSectors(dayByTicker, staticSectors as StaticSector[])
    const indices = buildIndices(quotes, staticIndices as StaticIndex[])

    const payload: LiveSnapshot = {
      stocks,
      sectors,
      indices,
      lastUpdated:      new Date().toISOString(),
      provider:         'yahoo-finance',
      symbolsSucceeded: succeeded,
      symbolsFailed:    failed,
    }

    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'Timeout'
    const reason    = isTimeout ? 'request timed out' : 'provider unavailable'
    return NextResponse.json(
      { error: `Live snapshot unavailable: ${reason}`, provider: 'yahoo-finance', fallbackAvailable: true },
      { status: 503 },
    )
  }
}
