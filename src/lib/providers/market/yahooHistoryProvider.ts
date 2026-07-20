// Live Yahoo Finance historical-chart provider.
//
// SERVER-ONLY. Unlike supabaseMarketProvider.getStockHistory (which reads
// accumulated daily snapshot rows written by the ingestion cron — sparse for
// weeks after the cron's own start date, and structurally unable to cover
// 3Y/5Y at all), this fetches real historical OHLC bars directly from Yahoo
// Finance's public chart endpoint on every call. No API key, no credentials,
// no accumulation wait — a stock or index with years of trading history has
// years of history available immediately. This is now the primary tier
// resolveStockHistory() tries (see marketProvider.ts); Supabase-persisted and
// static remain as resilience fallbacks if Yahoo is briefly unreachable.

import type { ProviderResult } from '../types.ts'
import type { StockHistoryPoint, StockTimeframe } from './types.ts'
import { TICKER_YF, INDEX_YF } from '../../market/liveOverlay.ts'
import { resolveLiveHistoryDateRange, isSufficientMarketHistory } from '../../market/marketHistory.ts'

const SOURCE = 'Yahoo Finance'
const PROVIDER = 'yahoo-finance'
const TIMEOUT_MS = 12_000

/** Chilean equities resolve via TICKER_YF; the IPSA benchmark (not itself a
 *  tracked stock) resolves via the index map instead. */
function yahooSymbolFor(ticker: string): string | null {
  return TICKER_YF[ticker] ?? (ticker === 'IPSA' ? INDEX_YF.ipsa : null) ?? null
}

interface RawChartQuote {
  date?: Date | string | number
  close?: number | null
  volume?: number | null
}

export async function getYahooStockHistory(
  ticker: string,
  timeframe: StockTimeframe,
): Promise<ProviderResult<StockHistoryPoint[]>> {
  const symbol = yahooSymbolFor(ticker)
  if (!symbol) return { ok: false, reason: `No Yahoo Finance symbol mapped for ${ticker}` }

  const range = resolveLiveHistoryDateRange(timeframe)

  try {
    const YahooFinance = (await import('yahoo-finance2')).default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yf = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] })
    const chartPromise = yf.chart(
      symbol,
      { period1: range.from, period2: range.to, interval: '1d' },
      { validateResult: false },
    )
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Yahoo Finance chart request timed out')), TIMEOUT_MS),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await Promise.race([chartPromise, timeoutPromise])
    const rawQuotes: RawChartQuote[] = Array.isArray(result?.quotes) ? result.quotes : []

    const points: StockHistoryPoint[] = []
    for (const q of rawQuotes) {
      if (q.close == null || q.date == null) continue
      const d = q.date instanceof Date ? q.date : new Date(q.date)
      if (Number.isNaN(d.getTime())) continue
      points.push({
        ticker,
        date: d.toISOString().slice(0, 10),
        open: null,
        high: null,
        low: null,
        close: q.close,
        volume: q.volume ?? null,
        source: SOURCE,
        provider: PROVIDER,
      })
    }

    if (!isSufficientMarketHistory(points, timeframe)) {
      return { ok: false, reason: `Yahoo Finance returned insufficient bars for ${timeframe} (${points.length} point(s))` }
    }

    return {
      ok: true,
      data: points,
      source: SOURCE,
      lastUpdated: points[points.length - 1].date,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: `Yahoo Finance history fetch failed: ${msg.slice(0, 200)}` }
  }
}
