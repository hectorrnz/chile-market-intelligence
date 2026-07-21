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
const YEAR_START_TIMEOUT_MS = 9_000

// Each index's YTD baseline is its first close of the current year — a CONSTANT
// for the whole calendar year, so it's memoized per warm serverless instance and
// only the first request pays the ~11 parallel chart fetches. A new year (or a
// cold instance) recomputes it.
let cachedYearStarts: { year: number; map: Record<string, number> } | null = null

// Minimum healthy series to trust a live YTD baseline. Yahoo genuinely lacks
// history for some symbols — most importantly ^IPSA, which returns a SINGLE
// recent bar (verified live) rather than the year's history. Computing YTD from
// that lone bar would print a bogus ~0% and mask the real value, so any index
// without a healthy year-spanning series is skipped and keeps the twice-daily
// GitHub-refreshed static YTD instead (same first-close-of-year convention,
// computed there via Python/yfinance which does reach ^IPSA history).
const MIN_YEAR_BARS = 20
const YEAR_START_CUTOFF_DAYS = 25 // first bar must fall within ~Jan of the year

/**
 * First close of the current year per index id, from Yahoo chart history — the
 * YTD baseline (Yahoo's quote payload carries no YTD field for indices).
 * Best-effort: an index whose Yahoo history is too sparse to trust (e.g. ^IPSA)
 * gets no baseline and keeps its static YTD. Never throws.
 */
async function fetchIndexYearStarts(): Promise<Record<string, number>> {
  const year = new Date().getUTCFullYear()
  if (cachedYearStarts && cachedYearStarts.year === year && Object.keys(cachedYearStarts.map).length > 0) {
    return cachedYearStarts.map
  }

  const period1 = new Date(Date.UTC(year, 0, 1)) // Jan 1 of the current year
  const cutoffIso = new Date(Date.UTC(year, 0, YEAR_START_CUTOFF_DAYS)).toISOString().slice(0, 10)

  const map: Record<string, number> = {}
  const work = Promise.all(
    Object.entries(INDEX_YF).map(async ([id, symbol]) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = await yf.chart(symbol, { period1, interval: '1d' }, { validateResult: false })
        const quotes: { date?: Date | string | number; close?: number | null }[] = Array.isArray(r?.quotes) ? r.quotes : []
        const bars: { iso: string; close: number }[] = []
        for (const q of quotes) {
          if (q.close == null || q.date == null) continue
          const d = q.date instanceof Date ? q.date : new Date(q.date)
          if (Number.isNaN(d.getTime())) continue
          bars.push({ iso: d.toISOString().slice(0, 10), close: q.close })
        }
        // Trust the baseline only for a healthy year-spanning series whose first
        // bar is genuinely near the start of the year — never a lone recent bar.
        const first = bars[0]
        if (bars.length >= MIN_YEAR_BARS && first && first.iso <= cutoffIso && first.close > 0) {
          map[id] = first.close
        }
      } catch {
        // Skip this index — it keeps its static YTD.
      }
    }),
  )

  const timeout = new Promise<void>((resolve) => setTimeout(resolve, YEAR_START_TIMEOUT_MS))
  await Promise.race([work, timeout])

  if (Object.keys(map).length > 0) cachedYearStarts = { year, map }
  return map
}

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

    // Index YTD baselines run in parallel with nothing else here, but only
    // gate the indices — a slow/failed fetch degrades to static YTD, never
    // blocks the price snapshot (own timeout inside).
    const yearStartByIndex = await fetchIndexYearStarts()

    const { stocks, dayByTicker, succeeded, failed } = buildStocks(quotes)
    const sectors = buildSectors(dayByTicker, staticSectors as StaticSector[])
    const indices = buildIndices(quotes, staticIndices as StaticIndex[], yearStartByIndex)

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
