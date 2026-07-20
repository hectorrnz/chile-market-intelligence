// 2026-07-20 — Compare's Comparative Returns table + Cumulative Return chart,
// wired to persisted Supabase daily snapshot history.
//
// Reuses resolveStockHistory() (the same resolver the Company-page price
// chart and Compare's own Market Data 1D/5D/1M/YTD/1Y performance columns
// already use) — no new provider, no new sufficiency logic. A ticker only
// ever comes back 'persisted' here when resolveStockHistory's own
// isSufficientMarketHistory check (point count AND, as of 2026-07-20, real
// date coverage — see marketHistory.ts) already passed; this module adds no
// separate threshold of its own.
//
// SERVER-ONLY — resolveStockHistory transitively imports Supabase repository
// code. Never import this from a client component; go through
// /api/compare/history + src/lib/data/compareHistory.ts instead.

import { resolveStockHistory } from '../providers/market/marketProvider.ts'
import type { StockTimeframe } from '../providers/market/types.ts'
import { normalizeCompareTickers } from './compareStatic.ts'

/** The timeframes the Comparative Returns table/chart actually offer — kept
 *  in sync with the `TF` array in compare/page.tsx. Never resolve a
 *  timeframe the UI doesn't expose. */
export const COMPARE_HISTORY_TIMEFRAMES: readonly StockTimeframe[] = ['1M', 'YTD', '1Y', '3Y', '5Y']

export type CompareHistoryStatus = 'persisted' | 'static_fallback'

export interface CompareHistorySeries {
  ticker: string
  /** Only populated when status === 'persisted' — the caller already has its
   *  own static series and should use that instead when this is empty. */
  points: { date: string; value: number }[]
  status: CompareHistoryStatus
  source: string | null
  asOfDate: string | null
}

export interface CompareHistoryResult {
  series: CompareHistorySeries[]
  invalidTickers: string[]
}

export async function resolveCompareHistory(
  tickersInput: string[],
  timeframe: StockTimeframe,
): Promise<CompareHistoryResult> {
  const { valid, invalid } = normalizeCompareTickers(tickersInput)

  if (valid.length === 0 || !COMPARE_HISTORY_TIMEFRAMES.includes(timeframe)) {
    return { series: [], invalidTickers: invalid }
  }

  const series = await Promise.all(
    valid.map(async (ticker): Promise<CompareHistorySeries> => {
      const resp = await resolveStockHistory(ticker, timeframe)
      if (resp.metadata.status === 'persisted' && resp.data.length >= 2) {
        return {
          ticker,
          points: resp.data.map((p) => ({ date: p.date, value: p.close })),
          status: 'persisted',
          source: resp.metadata.source || null,
          asOfDate: resp.metadata.lastUpdated || null,
        }
      }
      return { ticker, points: [], status: 'static_fallback', source: null, asOfDate: null }
    }),
  )

  return { series, invalidTickers: invalid }
}
